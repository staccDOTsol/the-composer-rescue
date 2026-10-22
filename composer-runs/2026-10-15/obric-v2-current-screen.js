#!/usr/bin/env node
// Bounded, read-only mainnet-beta activity/authority screen. Never submits transactions.
const fs = require('fs');
const path = require('path');
const program = 'obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y';
const signerBytes = JSON.parse(fs.readFileSync(path.join(process.env.HOME, 'hooked.json'), 'utf8'));
if (!Array.isArray(signerBytes) || signerBytes.length !== 64) throw Error('runtime signer must be 64 bytes');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
if (!url) throw Error('RPC endpoint unavailable');
let id = 0;
async function rpc(method, params) {
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  const j = await r.json();
  if (j.error) throw Error(method + ': ' + JSON.stringify(j.error));
  return j.result;
}
async function main() {
  const genesis = await rpc('getGenesisHash', []);
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw Error('not mainnet-beta');
  const signatures = await rpc('getSignaturesForAddress', [program, {limit: 40, commitment: 'confirmed'}]);
  const transactions = [];
  for (let i = 0; i < signatures.length; i += 8) {
    const batch = await Promise.all(signatures.slice(i, i + 8).map(async s => {
      const tx = await rpc('getTransaction', [s.signature, {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
      if (!tx) return null;
      const message = tx.transaction.message;
      const top = message.instructions.filter(x => x.programId === program)
        .map(x => ({data: x.data, accounts: x.accounts}));
      const invokes = (tx.meta.logMessages || []).filter(x => x.startsWith('Program log: Instruction: '))
        .map(x => x.slice('Program log: Instruction: '.length));
      const transfers = (tx.meta.innerInstructions || []).flatMap(g => {
        const root = message.instructions[g.index]?.programId;
        const stack = [root];
        return g.instructions.flatMap(ix => {
          const h = ix.stackHeight || 2, parent = stack[h - 2] || null;
          stack[h - 1] = ix.programId; stack.length = h;
          const info = ix.parsed?.info;
          if (!/transfer/i.test(ix.parsed?.type || '') || !info?.source || !info?.destination) return [];
          return [{parent, root, programId: ix.programId, source: info.source,
            destination: info.destination, authority: info.authority,
            mint: info.mint || null, amount: info.amount || info.tokenAmount?.amount || null}];
        });
      });
      return {signature: s.signature, slot: s.slot, err: tx.meta.err, top, invokes,
        signerKeys: message.accountKeys.filter(x => x.signer).map(x => x.pubkey), transfers,
        tokenBalances: tx.meta.postTokenBalances?.map(x => ({accountIndex: x.accountIndex,
          mint: x.mint, owner: x.owner, amount: x.uiTokenAmount.amount})) || [],
        accountKeys: message.accountKeys.map(x => x.pubkey)};
    }));
    transactions.push(...batch.filter(Boolean));
  }
  const direct = transactions.flatMap(x => x.transfers.filter(y => y.parent === program));
  const authorities = [...new Set(direct.map(x => x.authority).filter(Boolean))];
  const state = authorities.length ? (await rpc('getMultipleAccounts', [authorities,
    {encoding: 'base64', commitment: 'confirmed'}])).value.map((x, i) => ({
      address: authorities[i], owner: x?.owner || null, lamports: x?.lamports || null,
      dataLength: x?.data?.[0] ? Buffer.from(x.data[0], 'base64').length : null})) : [];
  const output = {generatedAt: new Date().toISOString(), program, genesis, sampleLimit: 40,
    returnedSignatures: signatures.length, parsedTransactions: transactions.length,
    successfulTransactions: transactions.filter(x => !x.err).length,
    directTokenOutflowCount: direct.length, authorityState: state, transactions};
  const dest = path.join(__dirname, 'obric-v2-current-screen.json');
  fs.writeFileSync(dest, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({file: dest, returnedSignatures: output.returnedSignatures,
    parsedTransactions: output.parsedTransactions, successful: output.successfulTransactions,
    directTokenOutflowCount: direct.length,
    topLevel: transactions.filter(x => x.top.length).length,
    transferCount: transactions.reduce((a, x) => a + x.transfers.length, 0),
    invokeCounts: [...new Set(transactions.flatMap(x => x.invokes))].slice(0, 30)}));
}
main().catch(e => {console.error(e.stack || e); process.exitCode = 1;});
