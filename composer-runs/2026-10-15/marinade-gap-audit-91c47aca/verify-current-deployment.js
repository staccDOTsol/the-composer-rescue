// Read-only current Program/ProgramData identity and deployed ELF digest.
const fs = require('fs');
const crypto = require('crypto');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const program = 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD';
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: method, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
async function main() {
  const p = await rpc('getAccountInfo', [program, {encoding: 'base64', commitment: 'confirmed'}]);
  const pData = Buffer.from(p.value.data[0], 'base64');
  if (pData.readUInt32LE(0) !== 2) throw new Error('program is not upgradeable-loader Program state');
  const programdata = new PublicKey(pData.subarray(4, 36)).toBase58();
  const d = await rpc('getAccountInfo', [programdata, {encoding: 'base64', commitment: 'confirmed'}]);
  const raw = Buffer.from(d.value.data[0], 'base64');
  if (raw.readUInt32LE(0) !== 3) throw new Error('pointer is not ProgramData state');
  const option = raw.readUInt8(12);
  const elfOffset = option === 1 ? 45 : 13;
  const elf = raw.subarray(elfOffset);
  const result = {observedSlot: Math.min(p.context.slot, d.context.slot), program, programdata,
    loader: p.value.owner, deploySlot: raw.readBigUInt64LE(4).toString(),
    upgradeAuthority: option === 1 ? bs58.encode(raw.subarray(13, 45)) : null,
    binaryBytes: elf.length, binarySha256: crypto.createHash('sha256').update(elf).digest('hex')};
  fs.writeFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/marinade-gap-audit-91c47aca/current-deployment.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
