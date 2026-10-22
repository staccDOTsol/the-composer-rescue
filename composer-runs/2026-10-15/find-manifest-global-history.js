// Read-only lookup of recent Manifest USDC global deposit/withdraw instructions.
const fs = require('fs');
const MODULES = '/Users/stacc/Documents/Codex/2026-09-11/uhmm-i-want-frost-enabled-wallets/outputs/frost-snap/node_modules';
const {Connection, PublicKey} = require(`${MODULES}/@solana/web3.js`);
const b = require(`${MODULES}/bs58`); const bs58 = b.default || b;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const conn = new Connection(process.env.SOLANA_RPC, 'confirmed');
const rpcUrl = process.env.SOLANA_RPC;
const program = new PublicKey('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms');
const global = new PublicKey('4SMRzaLXsuvTi2B5cSVs4LuCUUqQhB2uByTWUvbixjfF');

(async () => {
  const sigs = await conn.getSignaturesForAddress(global, {limit: 200}, 'confirmed');
  const hits = [];
  for (let i = 0; i < sigs.length && hits.length < 12; i += 20) {
    const request = sigs.slice(i, i + 20).map((x, j) => ({jsonrpc: '2.0', id: j,
      method: 'getTransaction', params: [x.signature, {encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 1, commitment: 'confirmed'}]}));
    const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify(request)});
    const rpcRows = await response.json();
    const txs = request.map((_, j) => rpcRows.find(x => x.id === j)?.result || null);
    for (let j = 0; j < txs.length; j++) {
      const tx = txs[j]; if (!tx || tx.meta?.err) continue;
      const top = tx.transaction.message.instructions.map((ix, k) => ({ix, k, inner: false}));
      const inner = (tx.meta?.innerInstructions || []).flatMap(group =>
        group.instructions.map((ix, k) => ({ix, k: `${group.index}.${k}`, inner: true})));
      for (const candidate of [...top, ...inner]) {
        const {ix, k} = candidate;
        if (ix.programId !== program.toBase58() || !ix.data || !ix.accounts) continue;
        const data = Buffer.from(bs58.decode(ix.data));
        if (data[0] !== 9 && data[0] !== 10) continue;
        hits.push({signature: sigs[i + j].signature, slot: tx.slot, instructionIndex: k,
          inner: candidate.inner,
          kind: data[0] === 9 ? 'GlobalDeposit' : 'GlobalWithdraw',
          amountRaw: data.length >= 9 ? data.readBigUInt64LE(1).toString() : null,
          accounts: ix.accounts,
          signers: tx.transaction.message.accountKeys.filter(x => x.signer).map(x => x.pubkey)});
      }
    }
    await sleep(500);
  }
  const out = {timestamp: new Date().toISOString(), address: global.toBase58(),
    signaturesRequested: sigs.length, successfulGlobalIxsFound: hits.length, hits};
  fs.writeFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/manifest-global-history.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
