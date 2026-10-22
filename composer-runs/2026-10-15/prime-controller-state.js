#!/usr/bin/env node
'use strict';

// Read-only live-state and successful-exit evidence for the PRIME CCIP pool.
// The script never signs, simulates, or submits a transaction and never emits RPC URLs.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {PublicKey} = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const RUN = __dirname;
const PROGRAM = new PublicKey('8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC');
const PRIME_MINT = new PublicKey('3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7');
const EXPECTED_VAULT = new PublicKey('4pQktybtQuVmqavFui8rmC21CtEEZxtgM9q3YGFNwPDd');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const KLEND = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const RESERVE = new PublicKey('BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh');
const PROVENANCE_SIGNATURES = [
  '5BfXHxzDmy3ejsamg2DRZ34k9XdxWbamyYyQnEjPLnmuEJiRQBoMQENbkFWxDo1Nioo2zr65wmyoPxb3sjs7hw5i',
  '3MFtxEsEEZrHZFqWnjPw8xpnpJ3LTpcsK895Ho4D5tcQY2XQyxE5buq5KUtQnkFQrcxHTiYm1dNrK566Vjw1gU9D',
  '2LCBq98DTUwkmVBjWZ1kcx4W8SFpGT34hYcy3miZxSYtBWLDuekycDXhwPagws4G1swjxpuL8izzenLCQFRbSnMW',
  '2ii1eseU2E7Nb5uyVb94J2C16waZnWXhxFuKsa2mDUzeXyVKcXtFCMVkUJhypfHw3AEgSZw7aHSFGEhNF1ipNVFG',
];
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrls = [...new Set([env.HEAVY_RPC_URL, env.RPC_URL].filter(Boolean))];
if (!rpcUrls.length) throw new Error('No read-only RPC configured');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const discriminator = (kind, name) => crypto.createHash('sha256')
  .update(`${kind}:${name}`).digest().subarray(0, 8);
const pk = (data, offset) => new PublicKey(data.subarray(offset, offset + 32)).toBase58();

async function rpc(method, params, preferArchive = false) {
  let lastError;
  const endpoints = preferArchive ? [...rpcUrls].reverse() : rpcUrls;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(endpoints[attempt % endpoints.length], {method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
      if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
    }
  }
  throw lastError;
}

function tokenAccount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const delegateOption = data.readUInt32LE(72);
  const nativeOption = data.readUInt32LE(109);
  const closeAuthorityOption = data.readUInt32LE(129);
  return {ownerProgram: account.owner, dataBytes: data.length, dataSha256: sha256(data),
    mint: pk(data, 0), authority: pk(data, 32), rawAmount: data.readBigUInt64LE(64).toString(),
    state: data[108], delegateOption, delegate: delegateOption ? pk(data, 76) : null,
    delegatedAmountRaw: data.readBigUInt64LE(121).toString(),
    nativeOption, nativeReserveRaw: nativeOption ? data.readBigUInt64LE(113).toString() : null,
    closeAuthorityOption,
    closeAuthority: closeAuthorityOption ? pk(data, 133) : null};
}

function mintAccount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const mintAuthorityOption = data.readUInt32LE(0);
  const freezeAuthorityOption = data.readUInt32LE(46);
  return {ownerProgram: account.owner, dataBytes: data.length, dataSha256: sha256(data),
    mintAuthority: mintAuthorityOption ? pk(data, 4) : null,
    supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44], initialized: data[45],
    freezeAuthority: freezeAuthorityOption ? pk(data, 50) : null};
}

function decodeState(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const expected = discriminator('account', 'State');
  if (!data.subarray(0, 8).equals(expected)) throw new Error('PRIME pool state discriminator mismatch');
  let o = 8;
  const out = {ownerProgram: account.owner, dataBytes: data.length, dataSha256: sha256(data)};
  out.version = data[o]; o += 1;
  out.tokenProgram = pk(data, o); o += 32;
  out.mint = pk(data, o); o += 32;
  out.decimals = data[o]; o += 1;
  out.poolSigner = pk(data, o); o += 32;
  out.poolTokenAccount = pk(data, o); o += 32;
  out.owner = pk(data, o); o += 32;
  out.proposedOwner = pk(data, o); o += 32;
  out.rateLimitAdmin = pk(data, o); o += 32;
  out.routerOnrampAuthority = pk(data, o); o += 32;
  out.router = pk(data, o); o += 32;
  out.rebalancer = pk(data, o); o += 32;
  out.canAcceptLiquidity = data[o] !== 0; o += 1;
  out.allowListEnabled = data[o] !== 0; o += 1;
  const allowListLength = data.readUInt32LE(o); o += 4;
  out.allowList = [];
  for (let i = 0; i < allowListLength; i += 1) { out.allowList.push(pk(data, o)); o += 32; }
  out.rmnRemote = pk(data, o); o += 32;
  out.decodedBytes = o;
  out.trailingBytes = data.length - o;
  return out;
}

function readVec(data, cursor) {
  const length = data.readUInt32LE(cursor.offset); cursor.offset += 4;
  const value = data.subarray(cursor.offset, cursor.offset + length); cursor.offset += length;
  return value;
}

function readBucket(data, cursor) {
  const tokens = data.readBigUInt64LE(cursor.offset); cursor.offset += 8;
  const lastUpdated = data.readBigUInt64LE(cursor.offset); cursor.offset += 8;
  const enabled = data[cursor.offset] !== 0; cursor.offset += 1;
  const capacity = data.readBigUInt64LE(cursor.offset); cursor.offset += 8;
  const rate = data.readBigUInt64LE(cursor.offset); cursor.offset += 8;
  return {tokens: tokens.toString(), lastUpdated: lastUpdated.toString(), enabled,
    capacity: capacity.toString(), rate: rate.toString()};
}

function decodeChainConfigAccount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const expected = discriminator('account', 'ChainConfig');
  if (!data.subarray(0, 8).equals(expected)) throw new Error('Chain config discriminator mismatch');
  const cursor = {offset: 8};
  const poolCount = data.readUInt32LE(cursor.offset); cursor.offset += 4;
  const poolAddresses = [];
  for (let i = 0; i < poolCount; i += 1) poolAddresses.push(readVec(data, cursor).toString('hex'));
  const tokenAddress = readVec(data, cursor).toString('hex');
  const decimals = data[cursor.offset]; cursor.offset += 1;
  const inbound = readBucket(data, cursor);
  const outbound = readBucket(data, cursor);
  return {ownerProgram: account.owner, dataBytes: data.length, dataSha256: sha256(data),
    remote: {poolAddresses, tokenAddress, decimals}, inbound, outbound,
    decodedBytes: cursor.offset, trailingBytes: data.length - cursor.offset};
}

function decodeReserve(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const expected = discriminator('account', 'Reserve');
  if (account.owner !== KLEND.toBase58() || data.length !== 8624 ||
      !data.subarray(0, 8).equals(expected)) throw new Error('KLend reserve layout mismatch');
  const feeSf = data.readBigUInt64LE(4904);
  return {ownerProgram: account.owner, dataBytes: data.length, dataSha256: sha256(data),
    market: pk(data, 32), mint: pk(data, 128), supplyVault: pk(data, 160),
    feeVault: pk(data, 192), availableRaw: data.readBigUInt64LE(224).toString(),
    decimals: Number(data.readBigUInt64LE(272)), status: data[4856],
    emergencyMode: data[4864], name: data.subarray(5032, 5064).toString('utf8').split('\0', 1)[0],
    flashFeeSf: feeSf.toString(), flashFeeExactZero: feeSf === 0n};
}

function decodeReleaseArgs(raw) {
  const data = Buffer.from(raw);
  const expected = discriminator('global', 'release_or_mint_tokens');
  if (!data.subarray(0, 8).equals(expected)) return null;
  const cursor = {offset: 8};
  const originalSender = readVec(data, cursor).toString('hex');
  const remoteChainSelector = data.readBigUInt64LE(cursor.offset); cursor.offset += 8;
  const receiver = pk(data, cursor.offset); cursor.offset += 32;
  const amountBytes = data.subarray(cursor.offset, cursor.offset + 32); cursor.offset += 32;
  const localToken = pk(data, cursor.offset); cursor.offset += 32;
  const sourcePoolAddress = readVec(data, cursor).toString('hex');
  const sourcePoolData = readVec(data, cursor).toString('hex');
  const offchainTokenData = readVec(data, cursor).toString('hex');
  let amount = 0n;
  for (let i = 31; i >= 0; i -= 1) amount = (amount << 8n) + BigInt(amountBytes[i]);
  return {originalSender, remoteChainSelector: remoteChainSelector.toString(), receiver,
    amount: amount.toString(), amountLeHex: amountBytes.toString('hex'), localToken,
    sourcePoolAddress, sourcePoolData, offchainTokenData, decodedBytes: cursor.offset,
    trailingBytes: data.length - cursor.offset};
}

function allKeys(transaction) {
  const staticKeys = transaction.transaction.message.accountKeys.map((item) =>
    typeof item === 'string' ? item : item.pubkey);
  return [...staticKeys, ...(transaction.meta.loadedAddresses?.writable || []),
    ...(transaction.meta.loadedAddresses?.readonly || [])];
}

function balanceMap(entries, keys) {
  return Object.fromEntries((entries || []).map((item) => [keys[item.accountIndex], {
    mint: item.mint, owner: item.owner, amountRaw: item.uiTokenAmount.amount,
    decimals: item.uiTokenAmount.decimals}]));
}

async function sourceExit(signature) {
  const tx = await rpc('getTransaction', [signature,
    {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}], true);
  if (!tx) throw new Error(`Source transaction unavailable: ${signature}`);
  const keys = allKeys(tx);
  const target = [];
  for (const group of tx.meta.innerInstructions || []) {
    for (const ix of group.instructions || []) {
      if (keys[ix.programIdIndex] !== PROGRAM.toBase58()) continue;
      const data = Buffer.from(bs58.decode(ix.data));
      const accounts = ix.accounts.map((index) => keys[index]);
      target.push({outerInstructionIndex: group.index, stackHeight: ix.stackHeight,
        dataBase58: ix.data, dataHex: data.toString('hex'), accounts,
        release: decodeReleaseArgs(data)});
    }
  }
  const pre = balanceMap(tx.meta.preTokenBalances, keys);
  const post = balanceMap(tx.meta.postTokenBalances, keys);
  const changedPrime = [...new Set([...Object.keys(pre), ...Object.keys(post)])]
    .filter((key) => (pre[key]?.mint || post[key]?.mint) === PRIME_MINT.toBase58())
    .map((key) => ({account: key, owner: post[key]?.owner || pre[key]?.owner,
      preRaw: pre[key]?.amountRaw || '0', postRaw: post[key]?.amountRaw || '0',
      deltaRaw: (BigInt(post[key]?.amountRaw || 0) - BigInt(pre[key]?.amountRaw || 0)).toString()}));
  return {signature, slot: tx.slot, blockTime: tx.blockTime,
    version: tx.version, payer: keys[0], staticAccountCount: tx.transaction.message.accountKeys.length,
    loadedWritableCount: tx.meta.loadedAddresses?.writable?.length || 0,
    loadedReadonlyCount: tx.meta.loadedAddresses?.readonly?.length || 0,
    err: tx.meta.err, targetInstructions: target, changedPrime,
    targetLogLines: tx.meta.logMessages?.filter((line) => line.includes(PROGRAM.toBase58()) ||
      line.includes('Instruction: ReleaseOrMintTokens') || line.includes('Released')) || []};
}

async function main() {
  const [state] = PublicKey.findProgramAddressSync(
    [Buffer.from('ccip_tokenpool_config'), PRIME_MINT.toBuffer()], PROGRAM);
  const [poolSigner] = PublicKey.findProgramAddressSync(
    [Buffer.from('ccip_tokenpool_signer'), PRIME_MINT.toBuffer()], PROGRAM);
  const [derivedVault] = PublicKey.findProgramAddressSync(
    [poolSigner.toBuffer(), TOKEN_PROGRAM.toBuffer(), PRIME_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM);
  const [globalConfig] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM);

  const exits = [];
  for (const signature of PROVENANCE_SIGNATURES) exits.push(await sourceExit(signature));
  const knownChainConfigs = [...new Set(exits.flatMap((entry) =>
    entry.targetInstructions.map((ix) => ix.accounts[8]).filter(Boolean)))];

  const first = await rpc('getMultipleAccounts', [[state, poolSigner, derivedVault, PRIME_MINT,
    globalConfig, RESERVE].map((key) => key.toBase58()),
  {encoding: 'base64', commitment: 'confirmed'}]);
  const stateDecoded = decodeState(first.value[0]);
  if (derivedVault.toBase58() !== EXPECTED_VAULT.toBase58()) throw new Error('Derived PRIME vault mismatch');
  if (stateDecoded.poolSigner !== poolSigner.toBase58() ||
      stateDecoded.poolTokenAccount !== derivedVault.toBase58()) throw new Error('State PDA bindings mismatch');
  const reserveDecoded = decodeReserve(first.value[5]);
  const secondKeys = [reserveDecoded.supplyVault, reserveDecoded.feeVault, ...knownChainConfigs];
  const second = await rpc('getMultipleAccounts', [secondKeys,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const chainConfigs = Object.fromEntries(knownChainConfigs.map((key, index) =>
    [key, decodeChainConfigAccount(second.value[index + 2])]));

  for (const exit of exits) {
    for (const ix of exit.targetInstructions) {
      if (ix.release && ix.accounts[8] && chainConfigs[ix.accounts[8]])
        ix.chainConfig = chainConfigs[ix.accounts[8]];
    }
  }

  const vaultState = tokenAccount(first.value[2]);
  const reserveSupply = tokenAccount(second.value[0]);
  const reserveFeeVault = tokenAccount(second.value[1]);
  const realisticRaw = [BigInt(reserveDecoded.availableRaw), BigInt(reserveSupply.rawAmount)]
    .reduce((a, b) => a < b ? a : b);
  const output = {generatedAt: new Date().toISOString(), readOnly: true,
    submittedTransactions: 0, observedSlots: {primary: first.context.slot, secondary: second.context.slot},
    programId: PROGRAM.toBase58(), primeMint: PRIME_MINT.toBase58(),
    derivations: {state: state.toBase58(), poolSigner: poolSigner.toBase58(),
      poolVault: derivedVault.toBase58(), globalConfig: globalConfig.toBase58(),
      expectedAuthorityMatches: poolSigner.toBase58() === 'AjKrG87tF3rFNvW1U4Ja8pZ8KsQ1LLiDjiF79G9xj3a7',
      expectedVaultMatches: derivedVault.equals(EXPECTED_VAULT)},
    state: stateDecoded, vault: vaultState, mint: mintAccount(first.value[3]),
    globalConfig: {ownerProgram: first.value[4]?.owner || null,
      dataSha256: first.value[4] ? sha256(Buffer.from(first.value[4].data[0], 'base64')) : null,
      dataBytes: first.value[4] ? Buffer.from(first.value[4].data[0], 'base64').length : null},
    klend: {programId: KLEND.toBase58(), reserve: RESERVE.toBase58(), ...reserveDecoded,
      supplyVaultState: reserveSupply, feeVaultState: reserveFeeVault,
      realisticFlashLiquidityRaw: realisticRaw.toString(),
      realisticFlashLiquidityUi: (Number(realisticRaw) / 10 ** reserveDecoded.decimals).toString()},
    chainConfigs, successfulReleaseEvidence: exits};
  const outputPath = path.join(RUN, 'prime-controller-state.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({outputPath, observedSlots: output.observedSlots,
    derivations: output.derivations, state: {owner: stateDecoded.owner,
      rebalancer: stateDecoded.rebalancer, canAcceptLiquidity: stateDecoded.canAcceptLiquidity,
      router: stateDecoded.router, rmnRemote: stateDecoded.rmnRemote},
    vaultRaw: vaultState.rawAmount, klend: {availableRaw: reserveDecoded.availableRaw,
      supplyVaultRaw: reserveSupply.rawAmount, flashFeeSf: reserveDecoded.flashFeeSf,
      realisticRaw: realisticRaw.toString()},
    releases: exits.map((item) => ({signature: item.signature, slot: item.slot,
      targetCount: item.targetInstructions.length, changedPrime: item.changedPrime}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
