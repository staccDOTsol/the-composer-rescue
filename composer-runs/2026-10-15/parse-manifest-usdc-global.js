// Read-only, bounds-checked parser for the Manifest USDC global-deposit tree.
const fs = require('fs');
const MODULES = '/Users/stacc/Documents/Codex/2026-09-11/uhmm-i-want-frost-enabled-wallets/outputs/frost-snap/node_modules';
const {Connection, PublicKey} = require(`${MODULES}/@solana/web3.js`);
const conn = new Connection(process.env.SOLANA_RPC, 'confirmed');
const address = new PublicKey('4SMRzaLXsuvTi2B5cSVs4LuCUUqQhB2uByTWUvbixjfF');
const NIL = 0xffffffff;

(async () => {
  const response = await conn.getAccountInfoAndContext(address, 'confirmed');
  const data = response.value.data;
  if (data.readBigUInt64LE(0) !== 10787423733276977665n) throw new Error('wrong discriminant');
  const root = data.readUInt32LE(76), dynamic = data.subarray(96), seen = new Set(), deposits = [];
  const walk = index => {
    if (index === NIL) return;
    if (seen.has(index)) throw new Error(`cycle at ${index}`);
    if (index % 8 || index + 64 > dynamic.length) throw new Error(`invalid node ${index}`);
    seen.add(index);
    const left = dynamic.readUInt32LE(index), right = dynamic.readUInt32LE(index + 4);
    walk(left);
    deposits.push({index, trader: new PublicKey(dynamic.subarray(index + 16, index + 48)).toBase58(),
      balanceRaw: dynamic.readBigUInt64LE(index + 48).toString()});
    walk(right);
  };
  walk(root);
  deposits.sort((a, b) => BigInt(a.balanceRaw) === BigInt(b.balanceRaw) ? 0 : BigInt(a.balanceRaw) > BigInt(b.balanceRaw) ? -1 : 1);
  const out = {timestamp: new Date().toISOString(), slot: response.context.slot,
    global: address.toBase58(), accountDataLength: data.length, root, reachableDepositNodes: deposits.length,
    positiveDeposits: deposits.filter(x => x.balanceRaw !== '0'),
    zeroDepositCount: deposits.filter(x => x.balanceRaw === '0').length};
  fs.writeFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/manifest-usdc-global-deposits.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({...out, positiveDeposits: out.positiveDeposits.slice(0, 20)}, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
