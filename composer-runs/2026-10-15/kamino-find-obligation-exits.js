const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const program = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const targets = ['BorrowObligationLiquidity', 'BorrowObligationLiquidityV2',
  'WithdrawObligationCollateral', 'WithdrawObligationCollateralV2',
  'WithdrawObligationCollateralAndRedeemReserveCollateral',
  'WithdrawObligationCollateralAndRedeemReserveCollateralV2'];
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const json = await response.json();
  if (json.error) throw Error(JSON.stringify(json.error));
  return json.result;
}
(async () => {
  const hits = Object.fromEntries(targets.map(name => [name, []]));
  let before, fetched = 0;
  for (let page = 0; page < 1; page++) {
    const sigs = await rpc('getSignaturesForAddress', [program, {limit: 1000, ...(before ? {before} : {})}]);
    if (!sigs.length) break;
    before = sigs.at(-1).signature;
    for (let offset = 0; offset < sigs.length; offset += 20) {
      const group = sigs.slice(offset, offset + 20).filter(row => !row.err);
      const txs = await Promise.allSettled(group.map(row => rpc('getTransaction', [row.signature,
        {encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed'}])));
      for (let i = 0; i < group.length; i++) {
        if (txs[i].status !== 'fulfilled' || !txs[i].value) continue;
        fetched++;
        const tx = txs[i].value;
        const logs = tx.meta?.logMessages || [];
        for (const name of targets) {
          if (hits[name].length < 20 && logs.includes(`Program log: Instruction: ${name}`))
            hits[name].push({signature: group[i].signature, slot: tx.slot, transaction: tx});
        }
      }
      if (offset % 200 === 0) process.stderr.write(JSON.stringify({page, offset, fetched,
        hits: Object.fromEntries(targets.map(name => [name, hits[name].length]))}) + '\n');
    }
  }
  fs.writeFileSync('composer-runs/2026-10-15/kamino-obligation-history.json',
    JSON.stringify({fetched, hits}, null, 2));
  console.log(JSON.stringify({fetched, hits: Object.fromEntries(targets.map(name =>
    [name, hits[name].map(h => ({signature: h.signature, slot: h.slot}))]))}));
})().catch(e => {console.error(e.message); process.exitCode = 1});
