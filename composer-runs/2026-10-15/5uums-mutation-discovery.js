#!/usr/bin/env node
// Read-only historical/current-state discovery for the 5UuMS program.
// This script never calls sendTransaction.
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\n/).filter(line => line.includes('='))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
const program = '5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9';
const vaults = {
  MIM: '7Lzp4oZietdSBSojPsXsD8VSffBNnmuEZPrYzpuDQ83w',
  DOG: '5yXSQmeFkxCYrfcPpgu8UBpy3gqThvXXGVAUyRPAvVWb',
  PUPS: 'A7w8ytRtX225qiPmn52kMGsob5aR3obVfL4qcqVBHeK1',
};
let id = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
      if (response.status === 429 || response.status >= 500) throw Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json.error) throw Error(JSON.stringify(json.error));
      return json.result;
    } catch (e) {
      last = e;
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw last;
}
async function summarize(sig) {
  const tx = await rpc('getTransaction', [sig, {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
  if (!tx) return {signature: sig, missing: true};
  const instructions = tx.transaction.message.instructions || [];
  return {
    signature: sig, slot: tx.slot, blockTime: tx.blockTime, err: tx.meta?.err,
    signerKeys: tx.transaction.message.accountKeys.filter(x => x.signer).map(x => x.pubkey),
    targetInstructions: instructions.filter(ix => ix.programId === program).map(ix => ({
      accounts: ix.accounts, data: ix.data, stackHeight: ix.stackHeight,
    })),
    innerToken: (tx.meta?.innerInstructions || []).flatMap(group => group.instructions
      .filter(ix => ix.parsed?.type === 'transfer' || ix.parsed?.type === 'transferChecked')
      .map(ix => ({parentInstructionIndex: group.index, tokenProgram: ix.programId,
        stackHeight: ix.stackHeight, type: ix.parsed.type, info: ix.parsed.info}))),
    logTail: tx.meta?.logMessages?.slice(-16),
  };
}
async function main() {
  const selected = {};
  for (const [symbol, address] of Object.entries(vaults)) {
    const signatures = await rpc('getSignaturesForAddress', [address, {limit: 100, commitment: 'confirmed'}]);
    selected[symbol] = {address, signatures: signatures.map(x => ({signature: x.signature, slot: x.slot,
      blockTime: x.blockTime, err: x.err}))};
  }
  const unique = [...new Set(Object.values(selected).flatMap(x => x.signatures.map(y => y.signature)))];
  const txs = [];
  for (const signature of unique) txs.push(await summarize(signature));
  const output = {generatedAt: new Date().toISOString(), transport: 'get* RPC only', program, selected, txs};
  fs.writeFileSync(path.join(DIR, '5uums-mutation-discovery.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({signatureCount: unique.length, perVault: Object.fromEntries(Object.entries(selected)
    .map(([k,v]) => [k, v.signatures.length])), txs: txs.map(tx => ({signature: tx.signature,
      err: tx.err, targetInstructions: tx.targetInstructions?.length,
      innerToken: tx.innerToken?.length}))}, null, 2));
}
main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1});
