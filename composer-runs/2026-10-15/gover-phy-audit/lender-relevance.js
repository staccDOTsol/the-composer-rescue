#!/usr/bin/env node
'use strict';

// Read-only current inventory check for the custody mint and the two governing
// mints against the scoped zero-fee KLend and Project0/marginfi bank surfaces.

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const {PublicKey} = require(path.join(HERE, '../onre-harness/node_modules/@solana/web3.js'));
const snapshot = JSON.parse(fs.readFileSync(path.join(HERE, 'current-snapshot.json'), 'utf8'));
const graph = JSON.parse(fs.readFileSync(path.join(HERE, 'governance-graph-decoded.json'), 'utf8'));
const upgradeGraph = JSON.parse(fs.readFileSync(path.join(HERE, 'upgrade-control-graph-decoded.json'), 'utf8'));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
if (!env.RPC_URL) throw new Error('RPC_URL missing from private environment file');

const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const PROJECT0 = 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const PHY = snapshot.mint.address;
const COMMUNITY = graph.realms[0].communityMint;
const COUNCIL = graph.realms[0].config.councilMint;
const UPGRADE_COMMUNITY = upgradeGraph.realms[0].communityMint;
const UPGRADE_COUNCIL = upgradeGraph.realms[0].config.councilMint;
const MINTS = [
  {role: 'custody_PHY', address: PHY},
  {role: 'community_governing_token', address: COMMUNITY},
  {role: 'council_membership_token', address: COUNCIL},
  {role: 'upgrade_controller_community_token', address: UPGRADE_COMMUNITY},
  {role: 'upgrade_controller_council_membership_token', address: UPGRADE_COUNCIL},
];

let id = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(env.RPC_URL, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}),
      });
      const body = await response.json();
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 6) await sleep(500 * (2 ** attempt));
    }
  }
  throw last;
}

function pk(bytes) { return new PublicKey(bytes).toBase58(); }
function optionPk(bytes, offset) {
  const tag = bytes.readUInt32LE(offset);
  if (tag === 0) return null;
  if (tag !== 1) throw new Error(`invalid COption at ${offset}`);
  return pk(bytes.subarray(offset + 4, offset + 36));
}
function mintImage(row) {
  const bytes = Buffer.from(row.data[0], 'base64');
  if (row.owner !== TOKEN || bytes.length !== 82) throw new Error('unexpected mint account');
  return {
    ownerProgram: row.owner,
    mintAuthority: optionPk(bytes, 0),
    supplyRaw: bytes.readBigUInt64LE(36).toString(),
    decimals: bytes[44],
    initialized: bytes[45] === 1,
    freezeAuthority: optionPk(bytes, 46),
  };
}
function tokenOwner(row) {
  const bytes = Buffer.from(row.data[0], 'base64');
  if (row.owner !== TOKEN || bytes.length !== 165) return null;
  return {mint: pk(bytes.subarray(0, 32)), owner: pk(bytes.subarray(32, 64)), amountRaw: bytes.readBigUInt64LE(64).toString()};
}
async function gpa(program, filters) {
  const result = await rpc('getProgramAccounts', [program, {
    commitment: 'finalized', encoding: 'base64', withContext: true,
    minContextSlot: snapshot.observedSlot, filters,
  }]);
  return {slot: result.context.slot, rows: result.value};
}

async function main() {
  const rows = [];
  for (const mint of MINTS) {
    const [mintResult, largest, klend, project0] = await Promise.all([
      rpc('getAccountInfo', [mint.address, {commitment: 'finalized', encoding: 'base64', minContextSlot: snapshot.observedSlot}]),
      rpc('getTokenLargestAccounts', [mint.address, {commitment: 'finalized'}]),
      gpa(KLEND, [{dataSize: 8624}, {memcmp: {offset: 128, bytes: mint.address}}]),
      gpa(PROJECT0, [{dataSize: 3912}, {memcmp: {offset: 8, bytes: mint.address}}]),
    ]);
    const largestAddresses = largest.value.map((item) => item.address);
    let largestOwners = {context: {slot: null}, value: []};
    if (largestAddresses.length) {
      largestOwners = await rpc('getMultipleAccounts', [largestAddresses, {
        commitment: 'finalized', encoding: 'base64', minContextSlot: snapshot.observedSlot,
      }]);
    }
    const largestSum = largest.value.reduce((sum, item) => sum + BigInt(item.amount), 0n);
    const parsedMint = mintImage(mintResult.value);
    rows.push({
      role: mint.role,
      mint: mint.address,
      mintSlot: mintResult.context.slot,
      mintState: parsedMint,
      positiveSupplyInventory: {
        sumOfReturnedLargestAccountsRaw: largestSum.toString(),
        mintSupplyRaw: parsedMint.supplyRaw,
        entirePositiveSupplyAccountedFor: largestSum.toString() === parsedMint.supplyRaw,
        implication: largestSum.toString() === parsedMint.supplyRaw ?
          'No additional token account can hold a positive balance outside this returned set.' :
          'Returned set does not account for full mint supply.',
      },
      largestAccountsSlot: largest.context.slot,
      largestAccounts: largest.value.map((item, index) => ({
        address: item.address,
        amountRaw: item.amount,
        decimals: item.decimals,
        tokenState: tokenOwner(largestOwners.value[index]),
      })),
      klend: {
        program: KLEND, slot: klend.slot, reserveDataSize: 8624, liquidityMintOffset: 128,
        matchingReserveCount: klend.rows.length,
        matches: klend.rows.map(({pubkey, account}) => ({
          address: pubkey,
          availableRaw: Buffer.from(account.data[0], 'base64').readBigUInt64LE(224).toString(),
          flashFeeSf: Buffer.from(account.data[0], 'base64').readBigUInt64LE(4904).toString(),
        })),
      },
      project0: {
        program: PROJECT0, slot: project0.slot, bankDataSize: 3912, mintOffset: 8,
        matchingBankCount: project0.rows.length,
        matches: project0.rows.map(({pubkey}) => ({address: pubkey})),
      },
    });
  }
  const output = {
    generatedAt: new Date().toISOString(),
    commitment: 'finalized',
    minimumContextSlot: snapshot.observedSlot,
    rpcMethods: ['getAccountInfo', 'getTokenLargestAccounts', 'getMultipleAccounts', 'getProgramAccounts'],
    noTransactionsSubmitted: true,
    rows,
  };
  const outputPath = path.join(HERE, 'lender-relevance.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({outputPath, rows: rows.map((row) => ({
    role: row.role, mint: row.mint, mintState: row.mintState, positiveSupplyInventory: row.positiveSupplyInventory,
    largestAccounts: row.largestAccounts,
    klend: {slot: row.klend.slot, matchingReserveCount: row.klend.matchingReserveCount},
    project0: {slot: row.project0.slot, matchingBankCount: row.project0.matchingBankCount},
  }))}, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
