#!/usr/bin/env node
// Read-only batch triage of every residual off-curve Stake authority above a
// configurable SOL threshold after subtracting known stake-pool/program lanes.

const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error('set RPC_URL');
const DIR = __dirname;
const OUT = process.argv[2] || path.join(DIR, 'native-stake-residual-triage.json');
const MIN_SOL = Number(process.env.MIN_SOL || '10000');
const V4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const V3 = 'SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu';
const STAKE = 'Stake11111111111111111111111111111111111111';
const BUILTINS = new Set([
  '11111111111111111111111111111111', STAKE,
  'Vote111111111111111111111111111111111111111',
  'ComputeBudget111111111111111111111111111111',
  'Sysvar1111111111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbKPXCWuBvf9Ss623VQ5DA',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params, attempts = 6) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      const body = JSON.parse(text);
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body.result;
    } catch (error) {
      last = error;
      if (attempt + 1 < attempts) await sleep(500 * (2 ** attempt));
    }
  }
  throw last;
}
async function rpcBatch(calls, attempts = 6) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls.map((call, id) => ({ jsonrpc: '2.0', id, ...call }))) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      const bodies = JSON.parse(text);
      if (!Array.isArray(bodies)) throw new Error(`unexpected batch response: ${text.slice(0, 200)}`);
      const byId = new Map(bodies.map((body) => [body.id, body]));
      return calls.map((_, id) => {
        const body = byId.get(id);
        if (!body || body.error) throw new Error(JSON.stringify(body?.error || { missingId: id }));
        return body.result;
      });
    } catch (error) {
      last = error;
      if (attempt + 1 < attempts) await sleep(750 * (2 ** attempt));
    }
  }
  throw last;
}
function programIds(tx) {
  const out = [];
  for (const ix of tx?.transaction?.message?.instructions || []) if (ix.programId) out.push(ix.programId);
  for (const group of tx?.meta?.innerInstructions || []) for (const ix of group.instructions || []) if (ix.programId) out.push(ix.programId);
  return [...new Set(out)];
}
function authorityMentioned(info, authority) {
  return info && Object.entries(info).some(([key, value]) => /authority/i.test(key) && value === authority);
}
function squadsProof(authority, programId, instruction) {
  const pid = new PublicKey(programId);
  for (const address of instruction.accounts || []) {
    let multisig;
    try { multisig = new PublicKey(address); } catch (_) { continue; }
    const max = programId === V4 ? 256 : 1024;
    for (let index = 0; index < max; index += 1) {
      const indexBytes = programId === V4 ? Buffer.from([index]) : (() => { const b = Buffer.alloc(4); b.writeUInt32LE(index); return b; })();
      const seeds = programId === V4
        ? [Buffer.from('multisig'), multisig.toBuffer(), Buffer.from('vault'), indexBytes]
        : [Buffer.from('squad'), multisig.toBuffer(), indexBytes, Buffer.from('authority')];
      const [pda, bump] = PublicKey.findProgramAddressSync(seeds, pid);
      if (pda.toBase58() === authority) return { programId, multisig: address, index, bump, seedFormula: programId === V4 ? '["multisig", multisig, "vault", u8(index)]' : '["squad", multisig, u32_le(index), "authority"]' };
    }
  }
  return null;
}

(async () => {
  const census = JSON.parse(fs.readFileSync(path.join(DIR, 'native-stake-offcurve-census.json'), 'utf8'));
  const standard = JSON.parse(fs.readFileSync('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/outputs/current-stake-pool-pdas.json', 'utf8'));
  const sp12 = JSON.parse(fs.readFileSync(path.join(DIR, 'sanctum-spl-live-stake-custody-complete.json'), 'utf8'));
  const spmb = JSON.parse(fs.readFileSync(path.join(DIR, 'sanctum-spl-multi-live-stake-custody-complete.json'), 'utf8'));
  const firstSquads = JSON.parse(fs.readFileSync(path.join(DIR, 'native-stake-squads-classification.json'), 'utf8'));
  const known = new Set([
    ...standard.pools.map((pool) => pool.withdrawAuthority),
    ...sp12.pools.map((pool) => pool.withdrawAuthority),
    ...spmb.pools.map((pool) => pool.withdrawAuthority),
    ...firstSquads.results.filter((row) => row.proof).map((row) => row.authority),
    '9eG63CdHjsfhHmobHgLtESGC8GabbmRcaSpHAZrtmhco',
    'AVzP2GeRmqGphJsMxWoqjpUifPpCret7LqWhD8NWQK49',
    '4qL62rxhqaYjXLzQNVJJ74iLhaXSZutQiQWSSiJjf19f',
    '59oXzz6wUujTAN3LK5qqmzE9pby6nNHLAujeg9NKuYt8',
  ]);
  const residual = census.retainedWithdrawerGroups.filter((row) => row.sol >= MIN_SOL && !known.has(row.authority));
  const accountInfos = await rpcBatch(residual.map((row) => ({ method: 'getAccountInfo', params: [row.authority, { encoding: 'base64', commitment: 'confirmed' }] })));
  const results = [];
  for (let rowIndex = 0; rowIndex < residual.length; rowIndex += 1) {
    const row = residual[rowIndex];
    const signatureMap = new Map();
    for (const address of [row.authority, ...row.examples.map((x) => x.address)].slice(0, 4)) {
      const signatures = await rpc('getSignaturesForAddress', [address, { limit: address === row.authority ? 50 : 15, commitment: 'confirmed' }]);
      for (const signature of signatures) signatureMap.set(signature.signature, signature);
    }
    const signatures = [...signatureMap.keys()].slice(0, 80);
    const txs = [];
    for (let offset = 0; offset < signatures.length; offset += 20) {
      txs.push(...await rpcBatch(signatures.slice(offset, offset + 20).map((signature) => ({ method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }] }))));
    }
    const candidateCounts = new Map();
    const directControllerProofs = [];
    let multisigProof = null;
    for (let txIndex = 0; txIndex < txs.length; txIndex += 1) {
      const tx = txs[txIndex];
      if (!tx) continue;
      for (const programId of programIds(tx)) if (!BUILTINS.has(programId)) candidateCounts.set(programId, (candidateCounts.get(programId) || 0) + 1);
      for (const instruction of tx.transaction.message.instructions || []) {
        if (!multisigProof && (instruction.programId === V4 || instruction.programId === V3)) {
          const proof = squadsProof(row.authority, instruction.programId, instruction);
          if (proof) multisigProof = { signature: signatures[txIndex], slot: tx.slot, ...proof };
        }
      }
      for (const group of tx.meta.innerInstructions || []) {
        const outer = tx.transaction.message.instructions[group.index];
        for (const ix of group.instructions || []) {
          if (ix.programId !== STAKE || !authorityMentioned(ix.parsed?.info, row.authority)) continue;
          directControllerProofs.push({ signature: signatures[txIndex], slot: tx.slot, outerProgramId: outer?.programId || null, stakeInstructionType: ix.parsed?.type || null, stakeInstructionInfo: ix.parsed?.info || null });
        }
      }
    }
    const info = accountInfos[rowIndex];
    results.push({
      authority: row.authority,
      sol: row.sol,
      stakeAccountCount: row.accountCount,
      delegatedStakeAccountCount: row.delegatedAccountCount,
      authorityAccount: info.value ? { owner: info.value.owner, lamports: String(info.value.lamports), dataBytes: Buffer.from(info.value.data[0], 'base64').length } : null,
      sampledUniqueSignatureCount: signatures.length,
      squadsVaultProof: multisigProof,
      directControllerProofs: directControllerProofs.slice(0, 10),
      candidateProgramsByTransactionCount: [...candidateCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([programId, transactionCount]) => ({ programId, transactionCount })),
    });
    console.error(`${rowIndex + 1}/${residual.length} ${row.authority}: ${row.sol} SOL; ${multisigProof ? 'Squads' : directControllerProofs.length ? 'direct CPI' : 'unattributed'}`);
    fs.writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), transport: 'read-only getAccountInfo/getSignaturesForAddress/getTransaction; no transaction submitted', thresholdSol: MIN_SOL, censusContextSlotMin: census.contextSlotMin, censusContextSlotMax: census.contextSlotMax, knownSetDescription: 'standard SPL Stake Pool + SP12 + SPMB + Marinade + Jupiter Perps + 5eSX + bn1d + first-pass verified Squads authorities', residualGroupCount: residual.length, completedGroupCount: results.length, results }, null, 2)}\n`);
    await sleep(250);
  }
  const output = {
    generatedAt: new Date().toISOString(),
    transport: 'read-only getAccountInfo/getSignaturesForAddress/getTransaction; no transaction submitted',
    thresholdSol: MIN_SOL,
    censusContextSlotMin: census.contextSlotMin,
    censusContextSlotMax: census.contextSlotMax,
    knownSetDescription: 'standard SPL Stake Pool + SP12 + SPMB + Marinade + Jupiter Perps + 5eSX + bn1d + first-pass verified Squads authorities',
    residualGroupCount: residual.length,
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
