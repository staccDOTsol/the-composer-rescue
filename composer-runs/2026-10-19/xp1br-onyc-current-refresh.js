#!/usr/bin/env node
'use strict';

// Public, read-only refresh for the XP1BR ONyc adapter. This script only calls
// Composer GET endpoints and Solana get* RPC methods. It never signs or sends.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const RPC = process.env.XP1BR_PUBLIC_RPC || 'https://api.mainnet-beta.solana.com';
const COMPOSER = 'https://the-composer-svc.fly.dev';
const PROGRAM = 'XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy';
const META = 'BmLiVHRb9ppTrEA5jhTgNJ2WFtjUZEkfzJZGswEidxzu';
const PRINCIPAL_VAULT = '2bBGqb9qY7e2q6pFDKdsHqDoQiGmaeDKktezXJ2AcGDo';
const ONYC = '5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5';
const SY_MINT = 'G1qbuP11CdquJCzuDjruWqatQAHroajmxhLfeQVgHosF';
const SY_ESCROW = '5muRaHt3Zb2c1NK8T11ygTMUpf2sAhxQU6Z7Ayx2iCvU';
const SCOPE = '3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH';
const KNOWN_RECEIPT = '2tnvGujdVCUzijtSgMzcwfTSPGioVYMNBpB6y6mJfNokHpg2nAuRMYmQw5dmDenxQseBTw54YApBxHBQkMpQLZKr';
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const IDL_PATH = path.join(DIR, '..', '2026-10-15', 'xp1br-generic-standard-idl.json');
let rpcId = 0;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, options = {}) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, {...options, signal: AbortSignal.timeout(180000)});
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = {raw: text}; }
      if (response.status === 429 || response.status >= 500)
        throw new Error(`HTTP ${response.status}`);
      return {status: response.status, body};
    } catch (error) {
      last = error;
      if (attempt < 5) await sleep(750 * (attempt + 1));
    }
  }
  throw last;
}

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetchJson(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
    if (!response.body.error) return response.body.result;
    last = new Error(`${method}: ${JSON.stringify(response.body.error)}`);
    if (response.body.error.code !== 429 || attempt === 7) break;
    await sleep(1000 * (attempt + 1));
  }
  throw last;
}

function accountKeys(tx) {
  const staticKeys = tx?.transaction?.message?.accountKeys || [];
  const keys = staticKeys.map((item) => typeof item === 'string' ? item : item.pubkey);
  const loaded = tx?.meta?.loadedAddresses || {};
  return [...keys, ...(loaded.writable || []), ...(loaded.readonly || [])];
}

function programInstructions(tx, programId) {
  const keys = accountKeys(tx);
  const outer = (tx?.transaction?.message?.instructions || []).map((ix, outerIndex) => ({...ix,
    outerIndex, stackHeight: 1, inner: false}));
  const inner = (tx?.meta?.innerInstructions || []).flatMap((group) => group.instructions.map((ix) => ({...ix,
    outerIndex: group.index, stackHeight: ix.stackHeight || null, inner: true})));
  return [...outer, ...inner].filter((ix) => keys[ix.programIdIndex] === programId).map((ix) => ({
    outerIndex: ix.outerIndex, inner: ix.inner, stackHeight: ix.stackHeight,
    programId, discriminator: ix.data ? Buffer.from(bs58.decode(ix.data))[0] : null,
    data: ix.data || null, accounts: (ix.accounts || []).map((index) => keys[index]),
  }));
}

function tokenDeltas(tx, address) {
  const keys = accountKeys(tx);
  const index = keys.indexOf(address);
  const before = (tx?.meta?.preTokenBalances || []).find((row) => row.accountIndex === index);
  const after = (tx?.meta?.postTokenBalances || []).find((row) => row.accountIndex === index);
  if (!before && !after) return null;
  const a = BigInt(after?.uiTokenAmount?.amount || 0);
  const b = BigInt(before?.uiTokenAmount?.amount || 0);
  return {accountIndex: index, mint: after?.mint || before?.mint, owner: after?.owner || before?.owner,
    beforeRaw: b.toString(), afterRaw: a.toString(), deltaRaw: (a - b).toString()};
}

function hashAccount(address, account) {
  if (!account) return {address, missing: true};
  const data = Buffer.from(account.data[0], 'base64');
  return {address, owner: account.owner, executable: account.executable, lamports: account.lamports,
    dataLength: data.length, dataSha256: sha256(data)};
}

function json(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value && typeof value.toBase58 === 'function') return value.toBase58();
  if (value && value.constructor?.name === 'BN') return value.toString(10);
  if (Array.isArray(value)) return value.map(json);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]));
  return value;
}

async function main() {
  const [publishedIdl, learned] = await Promise.all([
    fetchJson(`${COMPOSER}/idl/${PROGRAM}`),
    fetchJson(`${COMPOSER}/learn/${PROGRAM}?limit=100`),
  ]);
  fs.writeFileSync(path.join(DIR, 'xp1br-composer-idl-response.json'), `${JSON.stringify(publishedIdl, null, 2)}\n`);
  fs.writeFileSync(path.join(DIR, 'xp1br-composer-learn.json'), `${JSON.stringify(learned.body, null, 2)}\n`);

  const accounts = await rpc('getMultipleAccounts', [[PROGRAM, META, PRINCIPAL_VAULT, ONYC, SY_MINT, SY_ESCROW, SCOPE],
    {encoding: 'base64', commitment: 'finalized'}]);
  const [programAccount, metaAccount, vaultAccount, onycAccount, syMintAccount, syEscrowAccount, scopeAccount] = accounts.value;
  const programRaw = Buffer.from(programAccount.data[0], 'base64');
  const programDataAddress = new PublicKey(programRaw.subarray(4, 36)).toBase58();
  const pdResult = await rpc('getAccountInfo', [programDataAddress, {encoding: 'base64', commitment: 'finalized'}]);
  const pd = Buffer.from(pdResult.value.data[0], 'base64');
  const authorityPresent = pd[12] !== 0;
  const executableOffset = authorityPresent ? 45 : 13;
  const elf = pd.subarray(executableOffset);
  fs.writeFileSync(path.join(DIR, 'xp1br-onyc-current.so'), elf);

  const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
  const coder = new anchor.BorshAccountsCoder(idl);
  const metaRaw = Buffer.from(metaAccount.data[0], 'base64');
  const decodedMeta = coder.decode('SyMeta', metaRaw);
  const metaJson = json(decodedMeta);

  const signatures = await rpc('getSignaturesForAddress', [PRINCIPAL_VAULT, {limit: 40, commitment: 'finalized'}]);
  const selected = [];
  for (const row of signatures) {
    const tx = await rpc('getTransaction', [row.signature,
      {encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0}]);
    if (!tx || tx.meta?.err) continue;
    const vaultDelta = tokenDeltas(tx, PRINCIPAL_VAULT);
    const xpInstructions = programInstructions(tx, PROGRAM);
    if (vaultDelta && (BigInt(vaultDelta.deltaRaw) !== 0n || xpInstructions.length)) {
      selected.push({signature: row.signature, slot: row.slot, blockTime: row.blockTime,
        vaultDelta, xpInstructions, logMessages: tx.meta.logMessages});
    }
    if (selected.length >= 12) break;
    await sleep(120);
  }
  if (!selected.some((row) => row.signature === KNOWN_RECEIPT)) {
    const tx = await rpc('getTransaction', [KNOWN_RECEIPT,
      {encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0}]);
    if (tx) selected.push({signature: KNOWN_RECEIPT, slot: tx.slot, blockTime: tx.blockTime,
      vaultDelta: tokenDeltas(tx, PRINCIPAL_VAULT), xpInstructions: programInstructions(tx, PROGRAM),
      logMessages: tx.meta?.logMessages || []});
  }

  const vaultBalance = await rpc('getTokenAccountBalance', [PRINCIPAL_VAULT, {commitment: 'finalized'}]);
  const sySupply = await rpc('getTokenSupply', [SY_MINT, {commitment: 'finalized'}]);
  const syEscrowBalance = await rpc('getTokenAccountBalance', [SY_ESCROW, {commitment: 'finalized'}]);
  const output = {
    generatedAt: new Date().toISOString(), safety: 'public Composer GET and Solana get* RPC only; no signing or submission',
    rpcEndpointClass: RPC.includes('api.mainnet-beta.solana.com') ? 'public-solana-mainnet' : 'user-supplied-public-read-only',
    composer: {publishedIdlStatus: publishedIdl.status, publishedIdlBody: publishedIdl.body,
      learnedStatus: learned.status, learnedSha256: sha256(Buffer.from(JSON.stringify(learned.body))),
      learnedInstructionCount: learned.body?.instructions?.length ?? null},
    deployment: {programId: PROGRAM, programOwner: programAccount.owner,
      loaderMatchesExpected: programAccount.owner === LOADER && pdResult.value.owner === LOADER,
      programDataAddress, deploySlot: pd.readBigUInt64LE(4).toString(),
      upgradeAuthority: authorityPresent ? new PublicKey(pd.subarray(13, 45)).toBase58() : null,
      programDataBytes: pd.length, executableOffset, executableBytes: elf.length, executableSha256: sha256(elf)},
    observation: {slot: accounts.context.slot, vaultBalanceContextSlot: vaultBalance.context.slot,
      sySupplyContextSlot: sySupply.context.slot, syEscrowBalanceContextSlot: syEscrowBalance.context.slot},
    accounts: [hashAccount(PROGRAM, programAccount), hashAccount(META, metaAccount),
      hashAccount(PRINCIPAL_VAULT, vaultAccount), hashAccount(ONYC, onycAccount),
      hashAccount(SY_MINT, syMintAccount), hashAccount(SY_ESCROW, syEscrowAccount),
      hashAccount(SCOPE, scopeAccount)],
    meta: metaJson,
    balances: {principalVaultRaw: vaultBalance.value.amount, principalVaultUi: vaultBalance.value.uiAmountString,
      syMintSupplyRaw: sySupply.value.amount, syMintSupplyUi: sySupply.value.uiAmountString,
      syEscrowRaw: syEscrowBalance.value.amount, syEscrowUi: syEscrowBalance.value.uiAmountString},
    latestVaultSignatures: signatures,
    selectedSuccessfulReceipts: selected,
  };
  fs.writeFileSync(path.join(DIR, 'xp1br-onyc-current-refresh.json'), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({deployment: output.deployment, observation: output.observation,
    balances: output.balances, composer: {publishedIdlStatus: publishedIdl.status,
      learnedStatus: learned.status, learnedInstructionCount: output.composer.learnedInstructionCount},
    receipts: selected.map((row) => ({signature: row.signature, slot: row.slot,
      vaultDeltaRaw: row.vaultDelta?.deltaRaw, xpInstructions: row.xpInstructions.length}))}, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
