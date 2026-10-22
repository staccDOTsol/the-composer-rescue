#!/usr/bin/env node
// Get read-only exemplars to construct current-state mutation simulations.
const fs = require('fs');
const path = require('path');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter(line => line.includes('=')).map(line => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
const program = '5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9';
const sigs = {
  MIM: '2HMjoo5om3t8ho8Ac3jT6DHwL5oFxwdaQGj5RCHBJARb41KPo6eh1YhGDgnaSRF9dkTuiA4whFkDoAgvG5pkzmZR',
  DOG: '5oj19hPgME9PR1dbHtUrbiaG4hY5TjcZCa7ubYwZfYvqjWpsTg6WT7P1FfRmmmQUEC5oyi7dZ6g4qTfeQxUnAeC3',
  PUPS: '26hNmbXEiBoLdYBorWLMjb8NELX5hEQsXJthvXwbowDSfxvDLdpuyJuSfjgsmC4K6cDhqKzw1WJQ3AwKPkU2uaaQ',
  MIM_deposit: '349SoXmiTeYahfQVefUnRiLLKEurfb8gsgccN4YNviDuSfsgAUrvpdKKmtT1mzF2f6h6c43xute8rXWCVXjMGPey',
};
let id = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  const json = await response.json();
  if (json.error) throw Error(JSON.stringify(json.error));
  return json.result;
}
async function main() {
  const rows = {};
  for (const [name, signature] of Object.entries(sigs)) {
    const tx = await rpc('getTransaction', [signature, {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
    const raw = await rpc('getTransaction', [signature, {encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
    rows[name] = {signature, slot: tx?.slot, blockTime: tx?.blockTime, err: tx?.meta?.err,
      version: tx?.version, accountKeys: tx?.transaction?.message?.accountKeys,
      addressTableLookups: tx?.transaction?.message?.addressTableLookups,
      topInstructions: tx?.transaction?.message?.instructions,
      innerInstructions: tx?.meta?.innerInstructions?.map(x => ({index: x.index,
        instructions: x.instructions.filter(ix => ix.programId === program ||
          ix.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')})),
      logs: tx?.meta?.logMessages,
      wireBase64: raw?.transaction?.[0],
      rawMeta: {loadedAddresses: raw?.meta?.loadedAddresses, preTokenBalances: raw?.meta?.preTokenBalances,
        postTokenBalances: raw?.meta?.postTokenBalances},
    };
  }
  fs.writeFileSync(path.join(__dirname, '5uums-mutation-exemplars.json'), JSON.stringify({generatedAt: new Date().toISOString(), rows}, null, 2) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(rows).map(([k,r]) => [k,
    {slot: r.slot, err: r.err, version: r.version, topPrograms: r.topInstructions?.map(x => x.programId),
      targetInstructions: r.innerInstructions?.flatMap(x => x.instructions.filter(ix => ix.programId === program).map(ix => ({parentIndex: x.index, accounts: ix.accounts, data: ix.data, stackHeight: ix.stackHeight}))) }])), null, 2));
}
main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1});
