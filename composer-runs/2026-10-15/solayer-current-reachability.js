#!/usr/bin/env node
'use strict';

// Bounded, read-only current-mainnet reachability proof for Solayer restaking.
// RPC methods are limited to account/signature/transaction reads; no transaction
// is constructed or submitted by this collector.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey} = require(`${MODULES}/@solana/web3.js`);
const bs58Module = require(`${MODULES}/bs58`);
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const OUT = path.join(DIR, 'solayer-current-reachability.json');
const PROGRAM = 'sSo1iU21jBrU9VaJ8PJib1MtorefUV4fzC9GURa2KNn';
const BNSOL = 'BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85';
const LP_SOLAYER = 'sSo1wxKKr6zW2hqf5hZrp2CawLibcwi1pMBqk5bg2G4';
const SSOL = 'sSo14endRuUbvQaJS3dq36Q829a3A6BEfoeeRGJywEh';
const CURRENT_BALANCE_ACCOUNTS = {
  lpSolayerBackingVault: '4eimDGZonDS41b7YEEtxuX1JbSRLanH2BLJfG5sqbCsB',
  bnsolBackingVault: '9Qj3UvSYbyDFotud3BQeFfrwqXcrKQ92MR3yjqpzA771',
  klendBnsolSupply: 'DvB11zGUS4RxMGNNpLD9s93N4nuNsu6Yjhg1mhoLHjgw',
  project0BnsolLiquidity: '3PwE35mHJoKbknDSgGzRtTe59wJUiNfYFr5gAq8qKS4v',
};
const names = ['initialize', 'restake', 'unrestake', 'batch_thaw_lst_accounts'];
const discriminators = Object.fromEntries(names.map(name => [
  crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex'), name,
]));
const accountNames = {
  initialize: ['signer', 'solayerAdmin', 'lstMint', 'lstVault', 'rstMint', 'pool', 'associatedTokenProgram', 'tokenProgram', 'systemProgram'],
  restake: ['signer', 'lstMint', 'lstAta', 'rstAta', 'rstMint', 'vault', 'pool', 'associatedTokenProgram', 'tokenProgram', 'systemProgram'],
  unrestake: ['signer', 'lstMint', 'lstAta', 'rstAta', 'rstMint', 'vault', 'pool', 'associatedTokenProgram', 'tokenProgram', 'systemProgram'],
  batch_thaw_lst_accounts: ['signer', 'solayerAdmin', 'lstMint', 'rstMint', 'pool', 'associatedTokenProgram', 'tokenProgram', 'systemProgram'],
};

const envFile = ['/tmp/composer-helius-rpc.env', '/tmp/composer-helius-only.env'].find(fs.existsSync);
if (!envFile) throw new Error('authenticated read-only RPC configuration unavailable');
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const RPCS = [...new Set([env.RPC_URL, env.HEAVY_RPC_URL].filter(Boolean))];
if (!RPCS.length) throw new Error('RPC URL unavailable');

let rpcId = 0;
async function rpc(method, params) {
  const failures = [];
  for (const url of RPCS) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
          body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
          continue;
        }
        const json = await response.json();
        if (json.error) throw new Error(JSON.stringify(json.error));
        return json.result;
      } catch (error) { failures.push(error.message); }
    }
  }
  throw new Error(`${method}: ${failures.join(' | ')}`);
}

const keyString = value => typeof value === 'string' ? value : value.pubkey || String(value);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function decodeInstruction(ix, keys, outerIndex, inner) {
  if (!ix.data) return null;
  const programId = ix.programId || keys[ix.programIdIndex];
  if (programId !== PROGRAM) return null;
  const accounts = ix.accounts.map(value => typeof value === 'number' ? keys[value] : value);
  const data = Buffer.from(bs58.decode(ix.data));
  const discriminatorHex = data.subarray(0, 8).toString('hex');
  const name = discriminators[discriminatorHex] || null;
  const namedAccounts = Object.fromEntries(accounts.map((address, index) => [accountNames[name]?.[index] || `remaining${index}`, address]));
  return {
    outerIndex, inner, name, discriminatorHex, dataHex: data.toString('hex'),
    amountRaw: data.length >= 16 && (name === 'restake' || name === 'unrestake') ? data.readBigUInt64LE(8).toString() : null,
    accounts, namedAccounts,
  };
}

function tokenBalanceMap(rows, keys) {
  return Object.fromEntries((rows || []).map(row => [keys[row.accountIndex], {
    mint: row.mint, owner: row.owner || null, raw: row.uiTokenAmount.amount,
  }]));
}

async function main() {
  const [slot, programInfo, programAccounts, signatures] = await Promise.all([
    rpc('getSlot', [{commitment: 'finalized'}]),
    rpc('getAccountInfo', [PROGRAM, {encoding: 'base64', commitment: 'finalized'}]),
    rpc('getProgramAccounts', [PROGRAM, {encoding: 'base64', commitment: 'finalized', withContext: true}]),
    rpc('getSignaturesForAddress', [PROGRAM, {limit: 100, commitment: 'finalized'}]),
  ]);
  const [bnsolPool] = PublicKey.findProgramAddressSync([Buffer.from('pool'), new PublicKey(BNSOL).toBuffer()], new PublicKey(PROGRAM));
  const [lpPool] = PublicKey.findProgramAddressSync([Buffer.from('pool'), new PublicKey(LP_SOLAYER).toBuffer()], new PublicKey(PROGRAM));
  const currentBalances = {};
  for (const [label, address] of Object.entries(CURRENT_BALANCE_ACCOUNTS)) {
    const balance = await rpc('getTokenAccountBalance', [address, {commitment: 'finalized'}]);
    currentBalances[label] = {address, observationSlot: balance.context.slot,
      rawAmount: balance.value.amount, decimals: balance.value.decimals, uiAmountString: balance.value.uiAmountString};
  }

  const transactions = [];
  const selected = [];
  for (const row of signatures.filter(row => !row.err).slice(0, 50)) {
    const tx = await rpc('getTransaction', [row.signature, {encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1}]);
    if (!tx) continue;
    const message = tx.transaction.message;
    const staticKeys = message.accountKeys.map(keyString);
    const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
    const keys = [...staticKeys, ...(loaded.writable || []), ...(loaded.readonly || [])];
    const instructions = [];
    message.instructions.forEach((ix, index) => {
      const decoded = decodeInstruction(ix, keys, index, false);
      if (decoded) instructions.push(decoded);
    });
    for (const group of tx.meta.innerInstructions || []) {
      for (const ix of group.instructions) {
        const decoded = decodeInstruction(ix, keys, group.index, true);
        if (decoded) instructions.push(decoded);
      }
    }
    if (!instructions.length) continue;
    const pre = tokenBalanceMap(tx.meta.preTokenBalances, keys);
    const post = tokenBalanceMap(tx.meta.postTokenBalances, keys);
    const tokenDeltas = [];
    for (const address of new Set([...Object.keys(pre), ...Object.keys(post)])) {
      const before = pre[address]?.raw || '0';
      const after = post[address]?.raw || '0';
      const delta = (BigInt(after) - BigInt(before)).toString();
      if (delta !== '0') tokenDeltas.push({address, mint: post[address]?.mint || pre[address]?.mint,
        owner: post[address]?.owner || pre[address]?.owner, before, after, delta});
    }
    const summary = {
      signature: row.signature, slot: tx.slot, blockTime: tx.blockTime, err: tx.meta.err,
      requiredSigners: message.accountKeys.filter(key => typeof key !== 'string' && key.signer).map(keyString), instructions, tokenDeltas,
      logs: (tx.meta.logMessages || []).filter(line => line.includes('Instruction:') || line.includes(PROGRAM) || line.includes('failed')),
    };
    transactions.push(summary);
    if (instructions.some(ix => ix.name === 'unrestake')) selected.push(summary);
    if (selected.length >= 5) break;
  }

  const ownedAccounts = programAccounts.value.map(row => {
    const data = Buffer.from(row.account.data[0], 'base64');
    const entry = {address: row.pubkey, dataLength: data.length, dataSha256: sha256(data)};
    if (data.length === 73 || data.length === 74) {
      entry.discriminatorHex = data.subarray(0, 8).toString('hex');
      entry.lstMint = new PublicKey(data.subarray(8, 40)).toBase58();
      entry.rstMint = new PublicKey(data.subarray(40, 72)).toBase58();
      entry.bump = data[72];
    }
    return entry;
  });
  const output = {
    capturedAt: new Date().toISOString(), commitment: 'finalized', finalizedSlot: slot,
    transport: 'read-only getSlot/getAccountInfo/getProgramAccounts/getSignaturesForAddress/getTransaction; no transaction submitted',
    program: PROGRAM,
    programAccount: {owner: programInfo.value.owner, executable: programInfo.value.executable,
      dataLength: Buffer.from(programInfo.value.data[0], 'base64').length,
      dataSha256: sha256(Buffer.from(programInfo.value.data[0], 'base64'))},
    derivedPools: {bnsol: bnsolPool.toBase58(), lpSolayer: lpPool.toBase58()},
    currentBalances,
    programAccountsContextSlot: programAccounts.context.slot,
    ownedAccounts,
    recentSignatureCount: signatures.length,
    decodedTransactions: transactions,
    selectedUnrestakes: selected,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, finalizedSlot: slot, ownedAccounts: ownedAccounts.length,
    decodedTransactions: transactions.length, selectedUnrestakes: selected.length,
    instructionCounts: transactions.flatMap(tx => tx.instructions).reduce((out, ix) => {
      out[ix.name || ix.discriminatorHex] = (out[ix.name || ix.discriminatorHex] || 0) + 1; return out;
    }, {}), derivedPools: output.derivedPools}, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
