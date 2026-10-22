#!/usr/bin/env node
'use strict';

// Read committed transactions from the isolated local fork and reconcile both
// actor-owned LP deposits with final wallet and lender token balances.
const fs = require('fs');
const path = require('path');
const {rpc} = require('./real-flash-envelope.js');
const FORK = process.env.ORCA_DUAL_OWNED_FORK || 'http://127.0.0.1:64341';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK)) throw Error('Local fork only');
const BASE = __dirname;
const CONTROL = path.join(BASE, 'dual-owned-flash-control.json');
const OUT = path.join(BASE, 'dual-owned-flash-ledger.json');
const SIGS = {
  setup1: '2PuLSGUjm5Ryv21QToC1pVCQCHvnC1D3KKX2AjdkwHxUYUiEWcHNTdrspLiSCJYudJqz4VSzfroPmJE7DCX21G2i',
  setup2: '2CVeW4XMj2LuBFV1u3SqnxPzjGEnmeGVrNSQ8Rk2qfjxgKYxKaZkAiT6iGmSyvvC8aikvnhAwtLCMQtbMsaJqM3E',
  atomic: '5mbDwW9zyJoEqnzgPjppJt4HAzs4X1C4N4gVNsM5Rd88NtoTfBpd15J2gGhxatQ5s9VcRihMaCHTKTogscAgfVQU',
};
const actorA = 'KATPoaM7vBxH7jBPsfgwM8v68soZ3eeZg7NAnccKykX';
const actorB = 'CBsfxSvqkA8u1KJkCzdmNd5cCb2ivybaqfUVAw76YQQV';
const lenderVaults = [
  '3SdrFTt4Ye5yppzpT9axNMj8W1x71nDYXdjv7vDuBpnR',
  '2eicbpitfJXDwqCuFAmPgDP7t2oUotnAzbGzRKLMgSLe',
];
const ws = x => BigInt(x || 0);
async function transaction(signature) {
  const tx = await rpc(FORK, 'getTransaction', [signature,
    {encoding: 'jsonParsed', commitment: 'processed', maxSupportedTransactionVersion: 1}]);
  if (!tx || tx.meta.err || tx.version !== 1) throw Error(`Missing/failed v1 receipt ${signature}`);
  return tx;
}
function transfers(tx) {
  return (tx.meta.innerInstructions || []).flatMap(group =>
    group.instructions.filter(ix => ix.parsed?.type === 'transfer' && ix.parsed?.info?.amount)
      .map(ix => ({outerIndex: group.index, ...ix.parsed.info})));
}
function balances(tx) {
  const keys = tx.transaction.message.accountKeys.map(x => x.pubkey);
  const extract = arr => Object.fromEntries((arr || []).map(x =>
    [keys[x.accountIndex], x.uiTokenAmount.amount]));
  const pre = extract(tx.meta.preTokenBalances);
  const post = extract(tx.meta.postTokenBalances);
  return {pre, post};
}
async function main() {
  const control = JSON.parse(fs.readFileSync(CONTROL, 'utf8'));
  const tx1 = await transaction(SIGS.setup1), tx2 = await transaction(SIGS.setup2);
  const atomic = await transaction(SIGS.atomic);
  const setup1 = transfers(tx1), setup2 = transfers(tx2), inner = transfers(atomic);
  const pool1 = control.positions[0], pool2 = control.positions[1];
  function deposits(rows, pool) {
    const a = rows.find(t => t.source === actorA && t.destination === pool.vaultA);
    const b = rows.find(t => t.source === actorB && t.destination === pool.vaultB);
    if (!a || !b) throw Error(`Missing LP deposit transfers for ${pool.pool}`);
    return {wsolLamports: a.amount, usdcRaw: b.amount};
  }
  const d1 = deposits(setup1, pool1), d2 = deposits(setup2, pool2);
  const totals = {wsolLamports: String(ws(d1.wsolLamports) + ws(d2.wsolLamports)),
    usdcRaw: String(ws(d1.usdcRaw) + ws(d2.usdcRaw))};
  const {pre, post} = balances(atomic);
  const lenderDeltas = Object.fromEntries(lenderVaults.map(a =>
    [a, String(ws(post[a]) - ws(pre[a]))]));
  const actorBefore = {wsolLamports: pre[actorA], usdcRaw: pre[actorB]};
  const actorAfter = {wsolLamports: post[actorA], usdcRaw: post[actorB]};
  const delta = {wsolLamports: String(ws(actorAfter.wsolLamports) - ws(totals.wsolLamports)),
    usdcRaw: String(ws(actorAfter.usdcRaw) - ws(totals.usdcRaw))};
  const solUsdIllustrative = 104.5;
  const usd = row => Number(row.wsolLamports) / 1e9 * solUsdIllustrative + Number(row.usdcRaw) / 1e6;
  const audit = {
    schema: 'orca-dual-owned-flash-ledger-audit/v1', mainnetSubmission: false,
    fork: FORK, actor: control.actor, secondLeg: control.secondLeg,
    setupReceipts: [
      {pool: pool1.pool, position: pool1.position, signature: SIGS.setup1,
        slot: tx1.slot, version: tx1.version, err: tx1.meta.err, deposit: d1,
        innerTransfers: setup1},
      {pool: pool2.pool, position: pool2.position, signature: SIGS.setup2,
        slot: tx2.slot, version: tx2.version, err: tx2.meta.err, deposit: d2,
        innerTransfers: setup2},
    ],
    depositedTotal: totals,
    atomicReceipt: {signature: SIGS.atomic, slot: atomic.slot, version: atomic.version,
      err: atomic.meta.err, cu: atomic.meta.computeUnitsConsumed,
      feeLamports: atomic.meta.fee, actorTokenBefore: actorBefore,
      actorTokenAfter: actorAfter, lenderVaultDeltas: lenderDeltas,
      innerTransfers: inner,
      positionsAfter: control.positions.map(p => ({position: p.position,
        image: control.after[p.position]}))},
    consolidatedDelta: delta,
    illustrativeUsdAt104_5PerSol: {initial: usd(totals), final: usd(actorAfter),
      change: usd(delta)},
  };
  if (Object.values(lenderDeltas).some(x => x !== '0') ||
      control.positions.some(p => control.after[p.position]?.liquidity !== '0'))
    throw Error('Ledger invariants failed');
  fs.writeFileSync(OUT, `${JSON.stringify(audit, null, 2)}\n`);
  control.audit = {path: OUT, setupSignatures: [SIGS.setup1, SIGS.setup2],
    atomicSignature: SIGS.atomic, depositedTotal: totals, actorTokenAfter: actorAfter,
    lenderVaultDeltas: lenderDeltas, consolidatedDelta: delta,
    illustrativeUsdAt104_5PerSol: audit.illustrativeUsdAt104_5PerSol};
  fs.writeFileSync(CONTROL, `${JSON.stringify(control, null, 2)}\n`);
  console.log(JSON.stringify({out: OUT, setupSignatures: control.audit.setupSignatures,
    lenderVaultDeltas: lenderDeltas, depositedTotal: totals, actorTokenAfter: actorAfter,
    consolidatedDelta: delta, usd: audit.illustrativeUsdAt104_5PerSol}));
}
main().catch(error => {console.error(String(error.stack || error).replace(/api-key=[^&\s"']+/gi,
  'api-key=[REDACTED]')); process.exitCode = 1;});
