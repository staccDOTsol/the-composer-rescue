// Read-only lookup for same-asset Project 0 Bank and Kamino Lend Reserve.
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
const mint = 'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs';
async function rpc(id, method, params) {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id, method, params})});
  const json = await response.json();
  if (json.error) return {error: json.error};
  return json.result;
}
(async () => {
  const probes = [
    {label: 'project0', program: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', offset: 8},
    {label: 'kamino', program: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', offset: 128},
  ];
  const output = {timestamp: new Date().toISOString(), mint, probes: []};
  for (const probe of probes) {
    const result = await rpc(probe.label, 'getProgramAccounts', [probe.program, {
      encoding: 'base64', commitment: 'confirmed', withContext: true,
      filters: [{memcmp: {offset: probe.offset, bytes: mint}}],
      dataSlice: {offset: 0, length: 160},
    }]);
    output.probes.push({...probe, result: result.error ? {error: result.error} :
      {slot: result.context.slot, accounts: result.value.map(x => ({address: x.pubkey,
        owner: x.account.owner, dataLength: x.account.space,
        dataPrefixHex: Buffer.from(x.account.data[0], 'base64').toString('hex')}))}});
  }
  const path = 'composer-runs/2026-10-15/flashloan-grass-market-check.json';
  fs.writeFileSync(path, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({...output, probes: output.probes.map(x => ({...x, result: x.result.error ? x.result :
    {slot: x.result.slot, accounts: x.result.accounts.map(y => ({address: y.address,
      owner: y.owner, dataLength: y.dataLength}))}}))}, null, 2));
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
