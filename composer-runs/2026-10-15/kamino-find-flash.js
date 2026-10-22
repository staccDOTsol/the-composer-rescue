const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const program = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const outPath = 'composer-runs/2026-10-15/kamino-flash-history.json';

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const json = await response.json();
  if (json.error) throw Error(JSON.stringify(json.error));
  return json.result;
}

(async () => {
  const hits = [];
  let before;
  let fetched = 0;
  for (let page = 0; page < 4; page++) {
    const signatures = await rpc('getSignaturesForAddress', [program,
      {limit: 1000, ...(before ? {before} : {})}]);
    if (!signatures.length) break;
    before = signatures.at(-1).signature;
    for (let offset = 0; offset < signatures.length; offset += 20) {
      const group = signatures.slice(offset, offset + 20).filter(row => !row.err);
      const txs = await Promise.allSettled(group.map(row => rpc('getTransaction', [row.signature,
        {encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed'}])));
      for (let i = 0; i < group.length; i++) {
        if (txs[i].status !== 'fulfilled' || !txs[i].value) continue;
        fetched++;
        const tx = txs[i].value;
        const logs = tx.meta?.logMessages || [];
        if (logs.some(line => /Instruction: Flash(Borrow|Repay)ReserveLiquidity/.test(line))) {
          hits.push({signature: group[i].signature, slot: tx.slot, transaction: tx});
        }
      }
      if (offset % 200 === 0) process.stderr.write(JSON.stringify({page, offset, fetched, hits: hits.length}) + '\n');
      if (hits.length >= 3) break;
    }
    if (hits.length >= 3) break;
  }
  fs.writeFileSync(outPath, JSON.stringify({fetched, hits}, null, 2));
  console.log(JSON.stringify({fetched, hits: hits.map(h => ({signature: h.signature, slot: h.slot}))}));
})().catch(e => {console.error(e.message); process.exitCode = 1});
