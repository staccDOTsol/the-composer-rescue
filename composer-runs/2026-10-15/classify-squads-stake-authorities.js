#!/usr/bin/env node
// Read-only proof that candidate Stake withdraw authorities are Squads vault PDAs.
// V4 source formula:
//   ["multisig", multisig, "vault", vault_index_u8]
// V3 source formula:
//   ["squad", multisig, authority_index_u32_le, "authority"]

const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error('set RPC_URL');
const DIR = __dirname;
const TRACE = process.argv[2] || path.join(DIR, 'native-stake-unknown-controller-traces.json');
const OUT = process.argv[3] || path.join(DIR, 'native-stake-squads-classification.json');
const V4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const V3 = 'SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params, attempts = 5) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const body = await response.json();
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body.result;
    } catch (error) {
      last = error;
      if (attempt + 1 < attempts) await sleep(400 * (2 ** attempt));
    }
  }
  throw last;
}

async function rpcBatch(calls) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(calls.map((call, id) => ({ jsonrpc: '2.0', id, method: call.method, params: call.params }))),
  });
  const bodies = await response.json();
  if (!Array.isArray(bodies)) throw new Error(`unexpected batch response: ${JSON.stringify(bodies).slice(0, 300)}`);
  const byId = new Map(bodies.map((body) => [body.id, body]));
  return calls.map((_, id) => {
    const body = byId.get(id);
    if (!body || body.error) throw new Error(JSON.stringify(body?.error || { missingId: id }));
    return body.result;
  });
}

function deriveAgainstInstruction(authority, programId, instruction) {
  const pid = new PublicKey(programId);
  const target = authority;
  for (const maybeMultisig of instruction.accounts || []) {
    let multisig;
    try { multisig = new PublicKey(maybeMultisig); } catch (_) { continue; }
    if (programId === V4) {
      for (let index = 0; index < 256; index += 1) {
        const [pda, bump] = PublicKey.findProgramAddressSync([
          Buffer.from('multisig'), multisig.toBuffer(), Buffer.from('vault'), Buffer.from([index]),
        ], pid);
        if (pda.toBase58() === target) return { multisig: maybeMultisig, index, bump, seedFormula: '["multisig", multisig, "vault", u8(index)]' };
      }
    } else {
      for (let index = 0; index < 1024; index += 1) {
        const indexLe = Buffer.alloc(4);
        indexLe.writeUInt32LE(index);
        const [pda, bump] = PublicKey.findProgramAddressSync([
          Buffer.from('squad'), multisig.toBuffer(), indexLe, Buffer.from('authority'),
        ], pid);
        if (pda.toBase58() === target) return { multisig: maybeMultisig, index, bump, seedFormula: '["squad", multisig, u32_le(index), "authority"]' };
      }
    }
  }
  return null;
}

async function searchOlderTransactions(row, programId) {
  const addresses = [row.authority, ...row.census.examples.map((x) => x.address)].slice(0, 4);
  const signatureMap = new Map();
  for (const address of addresses) {
    const signatures = await rpc('getSignaturesForAddress', [address, { limit: address === row.authority ? 50 : 20, commitment: 'confirmed' }]);
    for (const signature of signatures) signatureMap.set(signature.signature, signature);
  }
  const signatures = [...signatureMap.keys()];
  for (let offset = 0; offset < signatures.length; offset += 20) {
    const batch = signatures.slice(offset, offset + 20);
    const transactions = await rpcBatch(batch.map((signature) => ({
      method: 'getTransaction',
      params: [signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }],
    })));
    for (let index = 0; index < transactions.length; index += 1) {
      const tx = transactions[index];
      for (const instruction of tx?.transaction?.message?.instructions || []) {
        if (instruction.programId !== programId || !Array.isArray(instruction.accounts)) continue;
        const derived = deriveAgainstInstruction(row.authority, programId, instruction);
        if (derived) return { signature: batch[index], slot: tx.slot, ...derived };
      }
    }
  }
  return null;
}

(async () => {
  const source = JSON.parse(fs.readFileSync(TRACE, 'utf8'));
  const results = [];
  for (const row of source.results) {
    const candidatePrograms = new Set(row.candidateProgramsByTransactionCount.map((x) => x.programId));
    const targetPrograms = [V4, V3].filter((p) => candidatePrograms.has(p));
    if (!targetPrograms.length) continue;
    let proof = null;
    for (const programId of targetPrograms) {
      const samples = row.transactions.filter((tx) => tx.programs.includes(programId));
      for (const sample of samples) {
        const tx = await rpc('getTransaction', [sample.signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]);
        for (const instruction of tx?.transaction?.message?.instructions || []) {
          if (instruction.programId !== programId || !Array.isArray(instruction.accounts)) continue;
          const derived = deriveAgainstInstruction(row.authority, programId, instruction);
          if (derived) {
            proof = {
              programId,
              generation: programId === V4 ? 'Squads v4' : 'Squads v3',
              signature: sample.signature,
              slot: tx.slot,
              ...derived,
            };
            break;
          }
        }
        if (proof) break;
      }
      if (!proof) {
        const derived = await searchOlderTransactions(row, programId);
        if (derived) proof = {
          programId,
          generation: programId === V4 ? 'Squads v4' : 'Squads v3',
          ...derived,
        };
      }
      if (proof) break;
    }
    results.push({
      authority: row.authority,
      sol: row.census.sol,
      stakeAccountCount: row.census.accountCount,
      classification: proof ? 'verified Squads vault PDA' : 'Squads co-occurrence only',
      proof,
    });
  }
  const output = {
    generatedAt: new Date().toISOString(),
    transport: 'read-only getTransaction; no transaction submitted',
    sourceTrace: path.basename(TRACE),
    publishedSeedSources: {
      v4: 'https://github.com/Squads-Protocol/v4/blob/main/sdk/multisig/src/pda.ts',
      v3: 'https://github.com/Squads-Protocol/squads-mpl/blob/main/sdk/src/address.ts',
    },
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
