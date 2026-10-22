#!/usr/bin/env node
// Read-only final Program/ProgramData pointer and upgrade-slot recheck.
const fs = require('fs');
const path = require('path');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter((s) => s.includes('=')).map((s) => s.split(/=(.*)/s).slice(0, 2)));
const ids = ['EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc',
  'HZyc3e9xuPRPXyVXti863VYUeMFKYgXRC4L3aMgx71vY'];
(async () => {
  const response = await fetch(env.RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [ids,
      {encoding: 'base64', commitment: 'confirmed', dataSlice: {offset: 0, length: 45}}]})});
  const json = await response.json();
  if (json.error) throw Error(JSON.stringify(json.error));
  const accounts = json.result.value.map((value, i) => {
    const data = Buffer.from(value.data[0], 'base64');
    return {address: ids[i], owner: value.owner, executable: value.executable,
      loaderTag: data.readUInt32LE(0), dataPrefixHex: data.toString('hex'),
      lastUpgradeSlot: i === 1 ? data.readBigUInt64LE(4).toString() : null};
  });
  const output = {observedAt: new Date().toISOString(), slot: json.result.context.slot, accounts};
  const target = path.join(__dirname, 'eyx-programdata-final-check.json');
  fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({file: target, slot: output.slot, lastUpgradeSlot: accounts[1].lastUpgradeSlot}));
})().catch((e) => {console.error(e.stack || e.message); process.exitCode = 1;});
