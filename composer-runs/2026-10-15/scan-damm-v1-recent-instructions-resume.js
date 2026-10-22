// Read-only recent DAMM v1 instruction census. No transaction submission.
const fs = require('fs');
const { Connection, PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58mod = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58mod.default || bs58mod;

const root = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/';
const outputPath = root + 'damm-v1-recent-instructions-resume.json';
const idl = JSON.parse(fs.readFileSync(root + 'damm-v1-sdk-2.0.0-resume.idl.json'));
const program = new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');
const targetSignatureCount = 6000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const discriminatorNames = new Map(idl.instructions.map(ix => [Buffer.from(ix.discriminator).toString('hex'), ix.name]));

async function retry(label, fn) {
  let delay = 600;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { return await fn(); } catch (error) {
      if (attempt === 6) throw new Error(label + ': ' + error.message);
      await pause(delay);
      delay *= 2;
    }
  }
}

async function main() {
  if (!process.env.RPC_URL) throw new Error('RPC_URL is required');
  const connection = new Connection(process.env.RPC_URL, 'confirmed');
  const signatures = [];
  let before;
  while (signatures.length < targetSignatureCount) {
    const page = await retry('getSignaturesForAddress', () => connection.getSignaturesForAddress(program, { before, limit: 1000 }, 'confirmed'));
    signatures.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
    await pause(180);
  }

  const counts = {};
  const successfulCounts = {};
  const examples = {};
  let fetched = 0;
  let fetchNull = 0;
  for (let i = 0; i < signatures.length; i += 20) {
    const chunk = signatures.slice(i, i + 20);
    const transactions = await retry('getTransactions', () => connection.getTransactions(chunk.map(x => x.signature), { commitment: 'confirmed', maxSupportedTransactionVersion: 1 }));
    for (let j = 0; j < transactions.length; j++) {
      const tx = transactions[j];
      if (!tx) { fetchNull++; continue; }
      fetched++;
      const staticKeys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys || [];
      const allKeys = [...staticKeys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])].map(key => key.toString());
      const top = tx.transaction.message.compiledInstructions || tx.transaction.message.instructions || [];
      const inner = (tx.meta.innerInstructions || []).flatMap(group => group.instructions.map(ix => ({ ...ix, innerAtIndex: group.index })));
      for (const entry of [...top.map(ix => ({ ...ix, innerAtIndex: null })), ...inner]) {
        if (allKeys[entry.programIdIndex] !== program.toBase58()) continue;
        let data;
        try { data = Buffer.from(bs58.decode(entry.data)); } catch { continue; }
        if (data.length < 8) continue;
        const discriminator = data.subarray(0, 8).toString('hex');
        const name = discriminatorNames.get(discriminator) || 'unknown_' + discriminator;
        counts[name] = (counts[name] || 0) + 1;
        if (!tx.meta.err) successfulCounts[name] = (successfulCounts[name] || 0) + 1;
        if (!tx.meta.err && (examples[name] || []).length < 3) {
          const accountIndexes = Array.from(entry.accountKeyIndexes || entry.accounts || []);
          (examples[name] ||= []).push({
            signature: chunk[j].signature,
            slot: tx.slot,
            blockTime: tx.blockTime,
            innerAtIndex: entry.innerAtIndex,
            accounts: accountIndexes.map(index => allKeys[index]),
            dataBase58: entry.data,
          });
        }
      }
    }
    if (i + 20 < signatures.length) await pause(135);
  }

  const output = {
    timestamp: new Date().toISOString(),
    program: program.toBase58(),
    requestedSignatures: targetSignatureCount,
    signatureRows: signatures.length,
    fetchedTransactions: fetched,
    nullTransactions: fetchNull,
    newestSlot: signatures[0]?.slot || null,
    oldestSlot: signatures[signatures.length - 1]?.slot || null,
    counts,
    successfulCounts,
    successfulExamples: examples,
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ outputPath, signatureRows: output.signatureRows, fetchedTransactions: fetched, nullTransactions: fetchNull, successfulCounts }, null, 2));
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
