// Read-only scan of the Meteora protocol-fee wrapper for DAMM v1 CPIs.
const fs = require('fs');
const { Connection, PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58mod = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58mod.default || bs58mod;
const root = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/';
const outputPath = root + 'damm-v1-protocol-fee-wrapper-history-resume.json';
const idl = JSON.parse(fs.readFileSync(root + 'damm-v1-sdk-2.0.0-resume.idl.json'));
const damm = new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');
const wrapper = new PublicKey('pFee3tb7qh5z53jRF4PbLwmNd148Q8ypLNZbqsMeinA');
const discNames = new Map(idl.instructions.map(ix => [Buffer.from(ix.discriminator).toString('hex'), ix.name]));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const dataBuffer = data => Buffer.isBuffer(data) ? data : typeof data === 'string' ? Buffer.from(bs58.decode(data)) : Buffer.from(data);

async function retry(fn) {
  let wait = 500;
  for (let attempt = 0; attempt < 6; attempt++) {
    try { return await fn(); } catch (error) { if (attempt === 5) throw error; await pause(wait); wait *= 2; }
  }
}

async function main() {
  const connection = new Connection(process.env.RPC_URL, 'confirmed');
  const signatures = [];
  let before;
  while (signatures.length < 3000) {
    const page = await retry(() => connection.getSignaturesForAddress(wrapper, { before, limit: 1000 }, 'confirmed'));
    signatures.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
    await pause(200);
  }
  const hits = [];
  let fetched = 0;
  for (let i = 0; i < signatures.length; i += 20) {
    const chunk = signatures.slice(i, i + 20);
    const txs = await retry(() => connection.getTransactions(chunk.map(x => x.signature), { commitment: 'confirmed', maxSupportedTransactionVersion: 1 }));
    for (let j = 0; j < txs.length; j++) {
      const tx = txs[j]; if (!tx) continue; fetched++;
      const keys = [...tx.transaction.message.staticAccountKeys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])].map(x => x.toString());
      for (const group of tx.meta.innerInstructions || []) {
        for (const ix of group.instructions) {
          if (keys[ix.programIdIndex] !== damm.toBase58()) continue;
          const data = dataBuffer(ix.data);
          const discriminator = data.subarray(0, 8).toString('hex');
          hits.push({
            signature: chunk[j].signature,
            slot: tx.slot,
            blockTime: tx.blockTime,
            transactionError: tx.meta.err,
            outerInstructionIndex: group.index,
            name: discNames.get(discriminator) || 'unknown_' + discriminator,
            dataBase58: typeof ix.data === 'string' ? ix.data : bs58.encode(data),
            accounts: Array.from(ix.accounts).map(index => keys[index]),
          });
        }
      }
    }
    if (hits.filter(hit => !hit.transactionError && hit.name === 'claim_protocol_fee2').length >= 3) break;
    if (i + 20 < signatures.length) await pause(150);
  }
  const output = { timestamp: new Date().toISOString(), wrapper: wrapper.toBase58(), dammV1: damm.toBase58(), signatureRows: signatures.length, fetchedTransactions: fetched, hits };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ outputPath, signatureRows: signatures.length, fetchedTransactions: fetched, hits: hits.map(x => ({ signature: x.signature, slot: x.slot, name: x.name, err: x.transactionError })) }, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
