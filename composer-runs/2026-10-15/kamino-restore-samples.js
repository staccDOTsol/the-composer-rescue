const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const dir = 'composer-runs/2026-10-15';
const flash = '588vb6rp6QWDC1hAF2aZ9z3teLdMRrQRVy87RWwY6VijmSG9ZLRXAHdxicJZPG1mErYCcvRz43NmmWZyRjf6zZcd';
const borrow = '4YGu6QkK3XBm2E5dNc8E6Xx3j56uvErJVuTaYKPuF72mxLZvqfs1DXYDGPwJmo8Tk1FTVRBzc7yGVSjUrjm42iLe';
const withdraw = '5L5HMERwc3f9iT3BxkAK2KvErJ7cED45ENtb2bQ3D6w9x9vjBNyayZjgiweyNdV2yiqnnVkmphbW4ejMNvtesAmA';
async function get(signature) {
  const body = {jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature,
    {encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed'}]};
  const reply = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify(body)}).then(response => response.json());
  if (reply.error || !reply.result) throw Error(JSON.stringify(reply.error || {signature, missing: true}));
  if (reply.result.meta.err) throw Error(`Source transaction failed: ${signature}`);
  return {signature, slot: reply.result.slot, transaction: reply.result};
}
(async () => {
  const [f, b, w] = await Promise.all([get(flash), get(borrow), get(withdraw)]);
  fs.writeFileSync(`${dir}/kamino-flash-history.json`, JSON.stringify({fetched: 1, hits: [f]}, null, 2));
  const hits = {BorrowObligationLiquidity: [], BorrowObligationLiquidityV2: [b],
    WithdrawObligationCollateral: [], WithdrawObligationCollateralV2: [],
    WithdrawObligationCollateralAndRedeemReserveCollateral: [],
    WithdrawObligationCollateralAndRedeemReserveCollateralV2: [w]};
  fs.writeFileSync(`${dir}/kamino-obligation-history.json`, JSON.stringify({fetched: 2, hits}, null, 2));
  console.log(JSON.stringify({flash: f.slot, borrow: b.slot, withdraw: w.slot}));
})().catch(e => {console.error(e.message); process.exitCode = 1});
