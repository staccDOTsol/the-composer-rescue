#!/usr/bin/env node
'use strict';

// Read-only mapping of the currently deployed ProgramData upgrade boundary and
// the transaction at its recorded last-deployment slot.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const snapshot = JSON.parse(fs.readFileSync(path.join(HERE, 'current-snapshot.json'), 'utf8'));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
if (!env.RPC_URL) throw new Error('RPC_URL missing from private environment file');

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

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizeAccount(address, row) {
  if (!row) return null;
  const bytes = Buffer.from(row.data[0], 'base64');
  return {
    address,
    owner: row.owner,
    executable: row.executable,
    lamports: row.lamports,
    rentEpoch: row.rentEpoch,
    dataLength: bytes.length,
    dataSha256: hash(bytes),
  };
}

function keyText(row) {
  return typeof row === 'string' ? row : row.pubkey;
}

function instructionSummary(ix, level, parentIndex) {
  const parsed = ix.parsed && typeof ix.parsed === 'object' ? ix.parsed : null;
  return {
    level,
    parentIndex,
    program: ix.program || null,
    programId: ix.programId || null,
    parsedType: parsed?.type || null,
    parsedInfo: parsed?.info || null,
    accountCount: ix.accounts?.length ?? null,
    accounts: ix.accounts || null,
    data: ix.data || null,
  };
}

async function main() {
  const {address: programdata, lastDeploymentSlot, upgradeAuthority} = snapshot.programdata;
  const authorityFetch = await rpc('getAccountInfo', [upgradeAuthority, {
    commitment: 'finalized', encoding: 'base64', minContextSlot: snapshot.observedSlot,
  }]);
  const [programdataHistory, authorityHistory, deployedBlockTime] = await Promise.all([
    rpc('getSignaturesForAddress', [programdata, {commitment: 'finalized', limit: 1000}]),
    rpc('getSignaturesForAddress', [upgradeAuthority, {commitment: 'finalized', limit: 1000}]),
    rpc('getBlockTime', [lastDeploymentSlot]),
  ]);
  const candidates = [...new Map([
    ...programdataHistory.filter((row) => row.slot === lastDeploymentSlot),
    ...authorityHistory.filter((row) => row.slot === lastDeploymentSlot),
  ].map((row) => [row.signature, row])).values()];
  const deploymentTransactions = [];
  for (const candidate of candidates) {
    const tx = await rpc('getTransaction', [candidate.signature, {
      commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1,
    }]);
    if (!tx) throw new Error(`deployment transaction unavailable: ${candidate.signature}`);
    const keys = tx.transaction.message.accountKeys;
    const instructions = [];
    tx.transaction.message.instructions.forEach((ix, index) => instructions.push(instructionSummary(ix, 'outer', index)));
    for (const group of tx.meta.innerInstructions || []) {
      for (const ix of group.instructions || []) instructions.push(instructionSummary(ix, 'inner', group.index));
    }
    const authorityMeta = keys.find((row) => keyText(row) === upgradeAuthority);
    deploymentTransactions.push({
      signature: candidate.signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      err: tx.meta.err,
      fee: tx.meta.fee,
      upgradeAuthorityKeyMeta: authorityMeta || null,
      programdataPresent: keys.some((row) => keyText(row) === programdata),
      programPresent: keys.some((row) => keyText(row) === snapshot.program.address),
      instructions,
      logMessages: tx.meta.logMessages,
    });
  }
  const output = {
    generatedAt: new Date().toISOString(),
    commitment: 'finalized',
    observedSnapshotSlot: snapshot.observedSlot,
    program: snapshot.program.address,
    programdata,
    currentElfSha256: snapshot.programdata.elfSha256,
    lastDeploymentSlot,
    lastDeploymentBlockTime: deployedBlockTime,
    upgradeAuthority: normalizeAccount(upgradeAuthority, authorityFetch.value),
    programdataHistory: {
      requestedLimit: 1000,
      returned: programdataHistory.length,
      newestSlot: programdataHistory[0]?.slot ?? null,
      oldestSlot: programdataHistory.at(-1)?.slot ?? null,
      atLastDeploymentSlot: programdataHistory.filter((row) => row.slot === lastDeploymentSlot),
    },
    upgradeAuthorityHistory: {
      requestedLimit: 1000,
      returned: authorityHistory.length,
      newestSlot: authorityHistory[0]?.slot ?? null,
      oldestSlot: authorityHistory.at(-1)?.slot ?? null,
      atLastDeploymentSlot: authorityHistory.filter((row) => row.slot === lastDeploymentSlot),
    },
    deploymentTransactions,
    noTransactionsSubmitted: true,
  };
  const outputPath = path.join(HERE, 'upgrade-path.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    outputPath,
    lastDeploymentSlot,
    lastDeploymentBlockTime: deployedBlockTime,
    upgradeAuthority: output.upgradeAuthority,
    historyCounts: {programdata: programdataHistory.length, upgradeAuthority: authorityHistory.length},
    deployments: deploymentTransactions.map((row) => ({
      signature: row.signature, err: row.err,
      upgradeAuthorityKeyMeta: row.upgradeAuthorityKeyMeta,
      loaderInstructions: row.instructions.filter((ix) => ix.program === 'bpf-upgradeable-loader' || ix.programId === 'BPFLoaderUpgradeab1e11111111111111111111111'),
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
