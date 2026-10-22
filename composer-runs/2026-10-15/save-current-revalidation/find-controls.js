const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const program = 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo';
const outPath = `${__dirname}/control-samples.json`;
const wanted = new Map([
  [10, 'borrowObligationLiquidity'],
  [15, 'withdrawAndRedeem'],
  [17, 'liquidateAndRedeem'],
  [18, 'redeemFees'],
  [19, 'flashBorrow'],
  [20, 'flashRepay'],
]);

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const json = await response.json();
  if (json.error) throw Error(JSON.stringify(json.error));
  return json.result;
}

function saveInstructions(tx) {
  const message = tx.transaction.message;
  const allKeys = [...message.accountKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])];
  const out = [];
  for (let i = 0; i < message.instructions.length; i++) {
    const ix = message.instructions[i];
    if (allKeys[ix.programIdIndex] !== program || !ix.data) continue;
    // The first base58 character is not the discriminator, so decode through web3's bs58 dependency later.
    out.push({index: i, data: ix.data, accounts: ix.accounts});
  }
  return out;
}

(async () => {
  const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
  const hits = {};
  let before;
  let fetched = 0;
  let pages = 0;
  for (let page = 0; page < 12; page++) {
    const signatures = await rpc('getSignaturesForAddress', [program,
      {limit: 1000, ...(before ? {before} : {})}]);
    if (!signatures.length) break;
    pages++;
    before = signatures.at(-1).signature;
    for (let offset = 0; offset < signatures.length; offset += 25) {
      const group = signatures.slice(offset, offset + 25).filter(row => !row.err);
      const txs = await Promise.allSettled(group.map(row => rpc('getTransaction', [row.signature,
        {encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed'}])));
      for (let i = 0; i < group.length; i++) {
        if (txs[i].status !== 'fulfilled' || !txs[i].value) continue;
        fetched++;
        const tx = txs[i].value;
        const instructions = saveInstructions(tx);
        const discriminators = instructions.map(ix => Buffer.from(bs58.decode(ix.data))[0]);
        for (const discriminator of discriminators) {
          const name = wanted.get(discriminator);
          if (name && !hits[name]) hits[name] = {
            signature: group[i].signature, slot: tx.slot, discriminator, instructions, transaction: tx,
          };
        }
      }
      if (offset % 250 === 0) process.stderr.write(JSON.stringify({page, offset, fetched,
        hits: Object.keys(hits)}) + '\n');
      if ([...wanted.values()].every(name => hits[name])) break;
    }
    if ([...wanted.values()].every(name => hits[name])) break;
  }
  fs.writeFileSync(outPath, JSON.stringify({program, pages, fetched, hits}, null, 2));
  console.log(JSON.stringify({pages, fetched, hits: Object.fromEntries(Object.entries(hits)
    .map(([name, hit]) => [name, {signature: hit.signature, slot: hit.slot,
      instructionIndexes: hit.instructions.map(ix => ix.index)}]))}, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
