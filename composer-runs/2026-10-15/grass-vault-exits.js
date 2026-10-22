#!/usr/bin/env node
// Bounded read-only recent outbound-transfer provenance for all nine GRASS vaults.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const programId = 'EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'grass-custody-recheck.json')));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(`${method}: ${JSON.stringify(data.error)}`);
      return data.result;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(300 * 2 ** attempt);
    }
  }
  throw lastError;
}
function findOutgoing(tx, vault, authority) {
  const top = tx.transaction.message.instructions;
  const matches = [];
  for (const group of tx.meta.innerInstructions || []) {
    const topLevelProgramId = top[group.index]?.programId;
    const stack = [];
    stack[1] = topLevelProgramId;
    for (const ix of group.instructions) {
      const height = ix.stackHeight ?? 2;
      const immediateCaller = stack[height - 1] ?? null;
      stack[height] = ix.programId;
      stack.length = height + 1;
      const info = ix.parsed?.info || {};
      if (info.source !== vault || info.authority !== authority ||
        !['transfer', 'transferChecked'].includes(ix.parsed?.type)) continue;
      matches.push({ topLevelProgramId, immediateCaller, tokenProgramId: ix.programId,
        stackHeight: ix.stackHeight, destination: info.destination,
        rawAmount: String(info.amount ?? info.tokenAmount?.amount ?? ''),
        callerMatchesProgram: immediateCaller === programId });
    }
  }
  return matches;
}
async function main() {
  const rows = [];
  for (const vault of snapshot.vaults) {
    const signatures = (await rpc('getSignaturesForAddress', [vault.vault,
      { limit: 20, commitment: 'confirmed' }])).filter((row) => !row.err);
    const row = { authority: vault.authority, vault: vault.vault,
      latestSignatureSlot: signatures[0]?.slot ?? null,
      successfulSignatureCountInWindow: signatures.length,
      inspected: 0, outgoing: [] };
    for (const sig of signatures) {
      const tx = await rpc('getTransaction', [sig.signature, { encoding: 'jsonParsed',
        commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
      row.inspected++;
      if (!tx || tx.meta?.err) continue;
      const matches = findOutgoing(tx, vault.vault, vault.authority);
      if (matches.length) {
        row.outgoing.push({ signature: sig.signature, slot: tx.slot,
          blockTime: tx.blockTime, transfers: matches });
        break;
      }
    }
    rows.push(row);
    console.log(`${vault.vault}: ${row.outgoing.length ? row.outgoing[0].signature : 'none'} (${row.inspected} inspected)`);
  }
  const output = { generatedAt: new Date().toISOString(), source: 'Helius confirmed Solana RPC',
    programId, limitPerVault: 20, rows };
  fs.writeFileSync(path.join(dir, 'grass-vault-exits.json'), JSON.stringify(output, null, 2) + '\n');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
