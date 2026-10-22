// Read-only, current-state inventory proof for same-asset GOHOME flash liquidity.
const fs = require('fs');

const envPath = fs.existsSync('/tmp/composer-helius-only.env')
  ? '/tmp/composer-helius-only.env' : '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL || env.SOLANA_RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');

const GOHOME = '2Wu1g2ft7qZHfTpfzP3wLdfPeV1is4EwQ3CXBfRYAciD';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDS = 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA';
const probes = [
  {label: 'project0_gohome', program: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
    mint: GOHOME, offset: 8, dataSize: 3912},
  {label: 'project0_positive_usds', program: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
    mint: USDS, offset: 8, dataSize: 3912},
  {label: 'klend_gohome', program: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
    mint: GOHOME, offset: 128, dataSize: 8624},
  {label: 'klend_positive_usdc', program: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
    mint: USDC, offset: 128, dataSize: 8624},
];

async function rpc(id, method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id, method, params})});
  const json = await response.json();
  return json.error ? {error: json.error} : json.result;
}

(async () => {
  const output = {generatedAt: new Date().toISOString(), liveSubmission: false,
    commitment: 'confirmed', targetMint: GOHOME, probes: []};
  for (const probe of probes) {
    const result = await rpc(probe.label, 'getProgramAccounts', [probe.program, {
      encoding: 'base64', commitment: 'confirmed', withContext: true,
      filters: [{dataSize: probe.dataSize}, {memcmp: {offset: probe.offset, bytes: probe.mint}}],
      dataSlice: {offset: 0, length: 160},
    }]);
    output.probes.push({...probe, result: result.error ? {error: result.error} : {
      slot: result.context.slot, matchCount: result.value.length,
      accounts: result.value.map(x => ({address: x.pubkey, owner: x.account.owner,
        dataLength: x.account.space,
        dataPrefixHex: Buffer.from(x.account.data[0], 'base64').toString('hex')})),
    }});
  }
  const outPath = 'composer-runs/2026-10-15/vesfcn-current-audit-work/gohome-flash-inventory.json';
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({outPath, probes: output.probes.map(x => ({label: x.label,
    slot: x.result.slot, matchCount: x.result.matchCount, error: x.result.error || null}))}, null, 2));
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
