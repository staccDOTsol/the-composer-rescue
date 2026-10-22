#!/usr/bin/env node
'use strict';

// Read-only current-binary validation for Circle CCTP receive paths.
// Historical successful transactions are positive controls. Re-simulation of
// the already-consumed attestation is a replay-negative control. No send RPC
// method exists in this script.
const fs = require('fs');
const crypto = require('crypto');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC = process.env.SOLANA_RPC;
if (!RPC) throw new Error('SOLANA_RPC is required');
const OUT = process.argv[2] || 'cctp-current-binary-validation.json';
const PAIRS = [
  {label: 'CCTP V1', messageProgram: 'CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd', tokenProgram: 'CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3', custody: 'FSxJ85FXVsXSr51SeWf9ciJWTcRnqKFSmBgRDeL3KyWw', handlerLogs: ['Instruction: HandleReceiveMessage']},
  {label: 'CCTP V2', messageProgram: 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC', tokenProgram: 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe', custody: '6xTBTqJMBr5m7BKqVxmW2x11DfqUwtD3TJsqpxELx72L', handlerLogs: ['Instruction: HandleReceiveFinalizedMessage', 'Instruction: HandleReceiveUnfinalizedMessage']},
];
let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params, retries = 6) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: id++, method, params})});
    if ((res.status === 429 || res.status >= 500) && i < retries) { await sleep(700 * (i + 1)); continue; }
    const j = await res.json();
    if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
    return j.result;
  }
}
function pk(b, o) { return new PublicKey(b.subarray(o, o + 32)).toBase58(); }
async function programMeta(program) {
  const a = await rpc('getAccountInfo', [program, {encoding: 'base64', commitment: 'confirmed'}]);
  const d = Buffer.from(a.value.data[0], 'base64');
  const programData = pk(d, 4);
  const p = await rpc('getAccountInfo', [programData, {encoding: 'base64', commitment: 'confirmed'}]);
  const pd = Buffer.from(p.value.data[0], 'base64');
  const hasAuthority = pd.readUInt32LE(12) === 1;
  const elfOffset = hasAuthority ? 48 : 16;
  return {program, programData, lastDeployedSlot: Number(pd.readBigUInt64LE(4)), upgradeAuthority: hasAuthority ? pk(pd, 16) : null, programDataLength: pd.length, elfSha256: crypto.createHash('sha256').update(pd.subarray(elfOffset)).digest('hex')};
}
async function custodyBalance(address) {
  const r = await rpc('getTokenAccountBalance', [address, {commitment: 'confirmed'}]);
  return {slot: r.context.slot, rawAmount: r.value.amount, decimals: r.value.decimals, uiAmountString: r.value.uiAmountString};
}
async function findReceive(pair) {
  let before;
  let inspected = 0;
  for (let page = 0; page < 4; page++) {
    const opts = {limit: 100, commitment: 'confirmed'};
    if (before) opts.before = before;
    const sigs = await rpc('getSignaturesForAddress', [pair.messageProgram, opts]);
    if (!sigs.length) break;
    for (const s of sigs) {
      if (s.err) continue;
      inspected++;
      const tx = await rpc('getTransaction', [s.signature, {encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
      await sleep(70);
      if (!tx || tx.meta?.err) continue;
      const logs = tx.meta?.logMessages || [];
      const isReceive = logs.some((x) => x.includes('Instruction: ReceiveMessage')) && pair.handlerLogs.some((needle) => logs.some((x) => x.includes(needle))) && logs.some((x) => x.includes(pair.tokenProgram));
      if (!isReceive) continue;
      return {inspected, signature: s.signature, slot: tx.slot, blockTime: tx.blockTime, confirmationStatus: s.confirmationStatus, metaErr: tx.meta.err, logs, transactionBase64: tx.transaction[0]};
    }
    before = sigs[sigs.length - 1].signature;
  }
  return {inspected, notFound: true};
}
async function testPair(pair) {
  const before = await custodyBalance(pair.custody);
  const [messageMeta, tokenMeta] = await Promise.all([programMeta(pair.messageProgram), programMeta(pair.tokenProgram)]);
  const historical = await findReceive(pair);
  let replaySimulation = null;
  if (historical.transactionBase64) {
    const sim = await rpc('simulateTransaction', [historical.transactionBase64, {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed', innerInstructions: true}]);
    replaySimulation = {contextSlot: sim.context.slot, err: sim.value.err, logs: sim.value.logs, unitsConsumed: sim.value.unitsConsumed};
    delete historical.transactionBase64;
  }
  const after = await custodyBalance(pair.custody);
  return {
    ...pair,
    messageMeta,
    tokenMeta,
    historicalPositiveControl: historical,
    historicalPostdatesCurrentDeployments: !!historical.slot && historical.slot >= messageMeta.lastDeployedSlot && historical.slot >= tokenMeta.lastDeployedSlot,
    replayNegativeControl: replaySimulation,
    replayRejected: replaySimulation?.err != null,
    custodyBefore: before,
    custodyAfter: after,
    custodyUnchangedAcrossReadOnlyProbe: before.rawAmount === after.rawAmount,
  };
}
async function main() {
  const out = {generatedAt: new Date().toISOString(), rpcReadsAndSimulationOnly: true, submittedTransactions: 0, probes: []};
  for (const pair of PAIRS) out.probes.push(await testPair(pair));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out.probes.map((x) => ({label: x.label, signature: x.historicalPositiveControl.signature, positiveAfterCurrentDeploy: x.historicalPostdatesCurrentDeployments, replayRejected: x.replayRejected, replayErr: x.replayNegativeControl?.err, unchanged: x.custodyUnchangedAcrossReadOnlyProbe})), null, 2));
}
main().catch((e) => { console.error(e.stack || e); process.exit(1); });
