#!/usr/bin/env node
// Current read-only deployment, exact 21-proof, value and receipt refresh for Jupiter Lock.
// No send/broadcast method is present.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..', '2026-10-15');
const MOD = path.join(BASE, 'kliquidity-sdk-official', 'node_modules');
const { PublicKey } = require(`${MOD}/@solana/web3.js`);
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require(`${MOD}/@solana/spl-token`);

const PROGRAM = new PublicKey('LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn');
const PROGRAMDATA = new PublicKey('7yXf8ZG1qdc6GdRUc6LxmwUJuUDUAqta84oPU7fsJ6Yy');
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const EXPECTED_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const RPC_ENV = '/Users/stacc/.config/stacc-ladder/rpc.env';
const KNOWN_RECEIPTS = [
  'BeY3h8qqvFbRAEwanYgErNitdYTCu7PHzi3SkzC6geCWc5Q5cgv5fw6Ad5WpHVhUXGQsTR73JAaoBXeuA6Sn7Ao',
  'Pp94BjG7zg9EGKKRRw2NGLJDQU2W8gEv6ac7RaVZnypcJLY98NDzrn2oSwibDWB5fCUhxXN5PvBLVKkfJVNc1Bz',
];

function parseEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}
const env = parseEnv(RPC_ENV);
const RPC = process.env.LOCP_RPC || env.RPC || env.SOLANA_RPC || env.RPC_URL || env.SOLANA_RPC_URL || env.MAINNET_RPC_URL;
if (!RPC) throw new Error('approved RPC endpoint missing from RPC config');

let rpcId = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(RPC, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
        signal: AbortSignal.timeout(45_000),
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 400 * (2 ** attempt)));
    }
  }
  throw last;
}

function pk(bytes) { return new PublicKey(bytes).toBase58(); }
function accountData(value) { return Buffer.from(value.data[0], 'base64'); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function tokenAmount(value) { return accountData(value).readBigUInt64LE(64); }

async function tokenMetadata(mint, fallback) {
  let metadataError = null;
  try {
    const response = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, {signal: AbortSignal.timeout(20_000)});
    const body = await response.json();
    const exact = Array.isArray(body) ? body.find(row => row.id === mint) : null;
    if (exact && Number.isFinite(exact.usdPrice)) return {symbol: exact.symbol || fallback.symbol,
      decimals: exact.decimals ?? fallback.decimals, usdPrice: exact.usdPrice,
      priceSource: 'Jupiter token search usdPrice'};
    metadataError = body?.message || 'Jupiter token search returned no current usdPrice';
  } catch (error) {
    metadataError = error.message;
  }
  try {
    const key = `solana:${mint}`;
    const response = await fetch(`https://coins.llama.fi/prices/current/${key}`, {signal: AbortSignal.timeout(20_000)});
    const body = await response.json();
    const coin = body?.coins?.[key];
    if (coin && Number.isFinite(coin.price)) return {symbol: coin.symbol || fallback.symbol,
      decimals: coin.decimals ?? fallback.decimals, usdPrice: coin.price,
      priceTimestamp: coin.timestamp ?? null, confidence: coin.confidence ?? null,
      priceSource: 'DefiLlama current token price', jupiterMetadataError: metadataError};
  } catch (error) {
    metadataError = `${metadataError}; DefiLlama: ${error.message}`;
  }
  return {...fallback, usdPrice: null, priceSource: null, metadataError};
}

function parsedTransfers(tx, vaultSet) {
  if (!tx || tx.meta?.err) return [];
  const top = tx.transaction.message.instructions || [];
  const rows = [];
  for (const group of tx.meta.innerInstructions || []) {
    const stack = [];
    stack[1] = top[group.index]?.programId || null;
    for (const instruction of group.instructions || []) {
      const height = instruction.stackHeight ?? 2;
      const caller = stack[height - 1] || null;
      stack[height] = instruction.programId;
      stack.length = height + 1;
      const info = instruction.parsed?.info;
      if (!info || !vaultSet.has(info.source) || !['transfer', 'transferChecked'].includes(instruction.parsed?.type)) continue;
      rows.push({topIndex: group.index, topProgramId: top[group.index]?.programId || null,
        stackHeight: height, immediateCaller: caller, tokenProgramId: instruction.programId,
        transferType: instruction.parsed.type, source: info.source, authority: info.authority,
        destination: info.destination, rawAmount: String(info.amount ?? info.tokenAmount?.amount ?? '')});
    }
  }
  return rows;
}

async function main() {
  const genesisHash = await rpc('getGenesisHash', []);
  if (genesisHash !== EXPECTED_GENESIS) throw new Error(`wrong genesis ${genesisHash}`);
  const proofsDoc = JSON.parse(fs.readFileSync(path.join(BASE, 'mainnet-token-authority-state-proofs.json')));
  const selected = proofsDoc.rows.filter(row => row.stateOwner === PROGRAM.toBase58());
  if (selected.length !== 21) throw new Error(`expected exact 21 proof rows, got ${selected.length}`);

  const programPair = await rpc('getMultipleAccounts', [[PROGRAM.toBase58(), PROGRAMDATA.toBase58()], {encoding: 'base64', commitment: 'confirmed'}]);
  const programValue = programPair.value[0], programdataValue = programPair.value[1];
  const programBytes = accountData(programValue), programdataBytes = accountData(programdataValue);
  if (programValue.owner !== LOADER || programdataValue.owner !== LOADER || !programValue.executable) throw new Error('unexpected loader/executable state');
  if (programBytes.readUInt32LE(0) !== 2 || programdataBytes.readUInt32LE(0) !== 3) throw new Error('unexpected upgradeable loader variants');
  const pointer = pk(programBytes.subarray(4, 36));
  if (pointer !== PROGRAMDATA.toBase58()) throw new Error('ProgramData pointer changed');
  const deploySlot = Number(programdataBytes.readBigUInt64LE(4));
  const authorityOption = programdataBytes[12];
  const upgradeAuthority = authorityOption === 1 ? pk(programdataBytes.subarray(13, 45)) : null;
  const elf = programdataBytes.subarray(45);

  const stateAddresses = selected.map(row => row.authority);
  const vaultAddresses = selected.map(row => row.stateReferences[0].tokenAccount);
  const stateResult = await rpc('getMultipleAccounts', [stateAddresses, {encoding: 'base64', commitment: 'confirmed'}]);
  const vaultResult = await rpc('getMultipleAccounts', [vaultAddresses, {encoding: 'base64', commitment: 'confirmed'}]);
  const mintSet = new Set();
  const decoded = selected.map((proof, index) => {
    const stateValue = stateResult.value[index], vaultValue = vaultResult.value[index];
    if (!stateValue || !vaultValue) throw new Error(`missing current proof account ${proof.authority}`);
    const state = accountData(stateValue), vault = accountData(vaultValue);
    if (state.length !== 296 || stateValue.owner !== PROGRAM.toBase58()) throw new Error(`bad state ${proof.authority}`);
    const recipient = pk(state.subarray(8, 40)), mint = pk(state.subarray(40, 72));
    const creator = pk(state.subarray(72, 104)), base = new PublicKey(state.subarray(104, 136));
    const bump = state[136], updateRecipientMode = state[137], cancelMode = state[138], tokenProgramFlag = state[139];
    const [derived, derivedBump] = PublicKey.findProgramAddressSync([Buffer.from('escrow'), base.toBuffer()], PROGRAM);
    const tokenProgram = tokenProgramFlag === 0 ? TOKEN_PROGRAM_ID : tokenProgramFlag === 1 ? TOKEN_2022_PROGRAM_ID : null;
    if (!tokenProgram) throw new Error(`unknown token program flag ${tokenProgramFlag}`);
    const derivedVault = getAssociatedTokenAddressSync(new PublicKey(mint), derived, true, tokenProgram).toBase58();
    const currentVault = vaultAddresses[index];
    const pdaMatches = derived.toBase58() === proof.authority && derivedBump === bump;
    const ataMatches = derivedVault === currentVault;
    const vaultMint = pk(vault.subarray(0, 32)), vaultAuthority = pk(vault.subarray(32, 64));
    const vaultBindingsMatch = vaultMint === mint && vaultAuthority === proof.authority && vaultValue.owner === tokenProgram.toBase58();
    mintSet.add(mint);
    return {authority: proof.authority, symbol: proof.stateReferences[0].symbol, mint, recipient, creator, base: base.toBase58(),
      bump, updateRecipientMode, cancelMode, tokenProgramFlag, tokenProgram: tokenProgram.toBase58(),
      vault: currentVault, rawAmount: tokenAmount(vaultValue).toString(), pdaMatches, ataMatches, vaultBindingsMatch,
      proofPass: pdaMatches && ataMatches && vaultBindingsMatch};
  });
  if (!decoded.every(row => row.proofPass)) throw new Error('one or more of the 21 current proofs failed');

  const mintAddresses = [...mintSet];
  const mintResult = await rpc('getMultipleAccounts', [mintAddresses, {encoding: 'base64', commitment: 'confirmed'}]);
  const mintDecimals = Object.fromEntries(mintAddresses.map((mint, index) => [mint, accountData(mintResult.value[index])[44]]));
  const prior = JSON.parse(fs.readFileSync(path.join(BASE, 'locp-source-current-state.json'))).byMint;
  const grouped = {};
  for (const row of decoded) {
    const decimals = mintDecimals[row.mint];
    if (!grouped[row.mint]) grouped[row.mint] = {mint: row.mint, symbol: row.symbol, decimals, escrowCount: 0, rawAmount: 0n};
    grouped[row.mint].escrowCount += 1;
    grouped[row.mint].rawAmount += BigInt(row.rawAmount);
  }
  const major = Object.values(grouped).sort((a, b) => Number(b.rawAmount) / 10 ** b.decimals - Number(a.rawAmount) / 10 ** a.decimals);
  const majorValues = [];
  for (const row of major) {
    const metadata = await tokenMetadata(row.mint, {symbol: row.symbol, decimals: row.decimals});
    const uiAmount = Number(row.rawAmount) / 10 ** row.decimals;
    const usdValue = metadata.usdPrice == null ? null : uiAmount * metadata.usdPrice;
    majorValues.push({...row, rawAmount: row.rawAmount.toString(), uiAmount, symbol: metadata.symbol,
      currentUsdPrice: metadata.usdPrice, currentMarkedUsd: usdValue, priceTimestamp: metadata.priceTimestamp ?? null,
      priceConfidence: metadata.confidence ?? null, priceSource: metadata.priceSource,
      priorAll308MintMarkedUsd: prior[row.mint]?.freshMarkedGrossUsd ?? null});
  }

  const vaultSet = new Set(vaultAddresses);
  const receipts = [];
  for (const signature of KNOWN_RECEIPTS) {
    const tx = await rpc('getTransaction', [signature, {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0}]);
    const transfers = parsedTransfers(tx, vaultSet);
    receipts.push({signature, fetched: Boolean(tx), slot: tx?.slot ?? null, blockTime: tx?.blockTime ?? null,
      postDeploy: tx ? tx.slot > deploySlot : null, transactionSuccess: tx?.meta?.err === null,
      transfers, locpImmediateCallerProof: transfers.some(row => row.immediateCaller === PROGRAM.toBase58())});
  }

  const output = {generatedAtUtc: new Date().toISOString(), network: 'mainnet-beta', genesisHash,
    safety: {readOnlyRpc: true, simulations: 0, submittedTransactions: 0, rpcUrlRedacted: true},
    deployment: {observationSlot: programPair.context.slot, program: PROGRAM.toBase58(), owner: programValue.owner,
      executable: programValue.executable, programdata: PROGRAMDATA.toBase58(), pointerMatches: pointer === PROGRAMDATA.toBase58(),
      lastDeploySlot: deploySlot, upgradeAuthority, elfLength: elf.length, elfSha256: sha256(elf),
      priorElfSha256: 'e0ace82e092741fe0dfe9e5c8ec45dfdbc642bfc510bb9e126f1fb8a6142ab92'},
    exact21Proofs: {source: '2026-10-15/mainnet-token-authority-state-proofs.json exact Locp rows', count: decoded.length,
      stateObservationSlot: stateResult.context.slot, vaultObservationSlot: vaultResult.context.slot,
      allPass: decoded.every(row => row.proofPass), rows: decoded},
    currentMajorTokenVaultValue: {scope: 'exact 21 selected escrow PDAs only', priceLimit: 'spot registry marks; not liquidation value or outsider equity', rows: majorValues},
    postDeployProgramSignedOutflows: receipts,
  };
  const outputPath = path.join(__dirname, 'locp-current-refresh.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({outputPath, deployment: output.deployment, exact21: output.exact21Proofs.count,
    allProofsPass: output.exact21Proofs.allPass, majorValues, receipts}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
