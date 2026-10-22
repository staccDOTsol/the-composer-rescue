#!/usr/bin/env node
// Read-only current vault history and exact immediate SPL caller proof.
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const LOC = 'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn';
const src = JSON.parse(fs.readFileSync(path.join(DIR, 'mainnet-token-authority-census.raw.json')));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split('\n').filter(s => s.includes('=')).map(s => s.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let id = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({jsonrpc:'2.0', id: ++id, method, params})});
      if (response.status === 429 || response.status >= 500) throw Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json.error) throw Error(`${method}: ${json.error.code} ${json.error.message}`);
      return json.result;
    } catch (error) {
      last = error;
      if (attempt < 6) await sleep(300 * 2 ** attempt);
    }
  }
  throw last;
}
async function pool(items, limit, fn) {
  const output = Array(items.length); let next = 0;
  await Promise.all(Array.from({length: limit}, async () => {
    while (next < items.length) {
      const index = next++;
      try { output[index] = await fn(items[index], index); }
      catch (error) { output[index] = {error: error.message}; }
    }
  }));
  return output;
}
function transfers(tx, vault, authority) {
  if (!tx || tx.meta?.err) return [];
  const top = tx.transaction.message.instructions;
  const rows = [];
  for (const group of tx.meta.innerInstructions || []) {
    const stack = [];
    stack[1] = top[group.index].programId;
    for (const ix of group.instructions) {
      const h = ix.stackHeight ?? 2;
      const caller = stack[h - 1] || null;
      stack[h] = ix.programId;
      stack.length = h + 1;
      const info = ix.parsed?.info;
      if (info?.source !== vault || info?.authority !== authority ||
          !['transfer','transferChecked'].includes(ix.parsed?.type)) continue;
      rows.push({topIndex: group.index, topProgramId: top[group.index].programId,
        stackHeight: h, immediateCaller: caller, tokenProgramId: ix.programId,
        transferType: ix.parsed.type, source: info.source, authority: info.authority,
        destination: info.destination, rawAmount: String(info.amount ?? info.tokenAmount?.amount ?? '')});
    }
  }
  return rows;
}
async function main() {
  const vaults = src.authorities.filter(a => a.directExecutableOwner === LOC && !a.onCurve)
    .flatMap(a => a.tokenAccounts.map(v => ({authority: a.authority, ...v})));
  const histories = await pool(vaults, 8, async v => {
    const sigs = await rpc('getSignaturesForAddress', [v.address,{limit: 40,commitment:'confirmed'}]);
    return {...v, signatures: sigs.filter(s => !s.err).map(s =>
      ({signature: s.signature, slot: s.slot, blockTime: s.blockTime})),
      failedHistoryCount: sigs.filter(s => !!s.err).length};
  });
  const historyOutput = {generatedAt: new Date().toISOString(), programId: LOC,
    sourceCensus: 'mainnet-token-authority-census.raw.json', vaultCount: vaults.length,
    historyLimitPerVault: 40, noTransactionsSubmitted: true, histories};
  fs.writeFileSync(path.join(DIR,'locp-vault-histories.json'), JSON.stringify(historyOutput,null,2)+'\n');
  console.log(JSON.stringify({phase:'histories', vaultCount:vaults.length,
    errors:histories.filter(h => h.error).length,
    withMoreThanOne:histories.filter(h => h.signatures?.length > 1).length,
    totalSignatures:histories.reduce((n,h)=>n+(h.signatures?.length||0),0)}));
  const candidates = histories.filter(h => h.signatures?.length > 1)
    .sort((a,b) => (b.signatures[0].slot - a.signatures[0].slot) || (b.usdValue - a.usdValue))
    .flatMap(h => h.signatures.slice(0, 16).map(s => ({vault:h.address, authority:h.authority,
      symbol:h.symbol, usdValue:h.usdValue, ...s})));
  const unique = [...new Map(candidates.map(c => [c.signature,c])).values()];
  const traces = await pool(unique, 8, async c => {
    const tx = await rpc('getTransaction',[c.signature,{encoding:'jsonParsed',commitment:'confirmed',
      maxSupportedTransactionVersion:0}]);
    return {...c, fetched:!!tx, success:tx?.meta?.err === null,
      transfers:transfers(tx,c.vault,c.authority)};
  });
  const out = {generatedAt:new Date().toISOString(),programId:LOC,
    selection:'vaults with >1 successful signature among latest 40, latest 16 per vault',
    candidateCount:unique.length, noTransactionsSubmitted:true,
    signerProofs:traces.filter(t => t.transfers?.some(x=>x.immediateCaller===LOC)),
    otherOutgoing:traces.filter(t => t.transfers?.length && !t.transfers.some(x=>x.immediateCaller===LOC)),
    transactionErrors:traces.filter(t => t.error), traces};
  fs.writeFileSync(path.join(DIR,'locp-outbound-signer-traces.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({phase:'transactions',candidateCount:unique.length,
    errors:out.transactionErrors.length, signerProofs:out.signerProofs.length,
    otherOutgoing:out.otherOutgoing.length,
    samples:out.signerProofs.slice(0,5).map(({vault,authority,symbol,signature,slot,transfers})=>
      ({vault,authority,symbol,signature,slot,transfers}))}));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
