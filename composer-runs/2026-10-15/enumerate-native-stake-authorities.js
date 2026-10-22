#!/usr/bin/env node
// Read-only, resumable mainnet census of native Stake-program accounts.
// The withdraw-authority byte space is partitioned into 256 disjoint shards,
// avoiding one provider-sized getProgramAccounts response. Each shard is a
// complete memcmp query on the first withdraw-authority byte.

const fs = require('fs');
const path = require('path');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC_URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!RPC_URL) throw new Error('set HEAVY_RPC_URL or RPC_URL');
const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111';
const OUT = process.argv[2] || path.join(__dirname, 'native-stake-authority-census.json');
const RETAIN_SOL = Number(process.env.RETAIN_SOL || '100');
const RETAIN_LAMPORTS = BigInt(Math.round(RETAIN_SOL * 1e9));
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.CONCURRENCY || '2')));
const OFFCURVE_ONLY = process.env.OFFCURVE_ONLY === '1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, attempts = 6) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      const body = JSON.parse(text);
      if (body.error) throw new Error(`RPC: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt + 1 < attempts) await sleep(750 * (2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

function initialState() {
  if (!fs.existsSync(OUT)) return {
    generatedAt: null,
    startedAt: new Date().toISOString(),
    rpcMethod: 'getProgramAccounts',
    commitment: 'confirmed',
    stakeProgram: STAKE_PROGRAM,
    filters: [{ dataSize: 200 }, { memcmp: { offset: 44, bytes: '<each possible one-byte prefix>' } }],
    dataSlice: { offset: 0, length: 76 },
    requestedShardCount: 256,
    completedShards: [],
    failedShards: [],
    contextSlotMin: null,
    contextSlotMax: null,
    returnedAccountCount: 0,
    initializedOrDelegatedAccountCount: 0,
    initializedOrDelegatedLamports: '0',
    excludedStateCount: 0,
    malformedCount: 0,
    retentionThresholdSol: RETAIN_SOL,
    offCurveOnly: OFFCURVE_ONLY,
    retainedWithdrawerGroups: [],
  };
  const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (old.retentionThresholdSol !== RETAIN_SOL) throw new Error(`checkpoint RETAIN_SOL is ${old.retentionThresholdSol}, requested ${RETAIN_SOL}`);
  if (Boolean(old.offCurveOnly) !== OFFCURVE_ONLY) throw new Error(`checkpoint offCurveOnly is ${old.offCurveOnly}, requested ${OFFCURVE_ONLY}`);
  return old;
}

function save(state) {
  state.generatedAt = new Date().toISOString();
  state.completedShards.sort((a, b) => a - b);
  state.retainedWithdrawerGroups.sort((a, b) => BigInt(a.lamports) === BigInt(b.lamports)
    ? b.accountCount - a.accountCount
    : BigInt(a.lamports) > BigInt(b.lamports) ? -1 : 1);
  fs.writeFileSync(OUT, `${JSON.stringify(state, null, 2)}\n`);
}

async function fetchShard(byte) {
  const prefix = bs58.encode(Buffer.from([byte]));
  const result = await rpc('getProgramAccounts', [STAKE_PROGRAM, {
    commitment: 'confirmed',
    encoding: 'base64',
    withContext: true,
    filters: [{ dataSize: 200 }, { memcmp: { offset: 44, bytes: prefix } }],
    dataSlice: { offset: 0, length: 76 },
  }]);
  return { byte, contextSlot: result.context.slot, rows: result.value };
}

function consumeShard(state, shard) {
  const groups = new Map();
  let initializedCount = 0;
  let initializedLamports = 0n;
  let excluded = 0;
  let malformed = 0;
  for (const row of shard.rows) {
    try {
      const data = Buffer.from(row.account.data[0], 'base64');
      if (data.length !== 76) throw new Error(`slice length ${data.length}`);
      const stateKind = data.readUInt32LE(0);
      if (stateKind !== 1 && stateKind !== 2) { excluded += 1; continue; }
      const staker = new PublicKey(data.subarray(12, 44)).toBase58();
      const withdrawer = new PublicKey(data.subarray(44, 76)).toBase58();
      const lamports = BigInt(row.account.lamports);
      let group = groups.get(withdrawer);
      if (!group) {
        group = { authority: withdrawer, accountCount: 0, lamports: 0n, delegatedAccountCount: 0, distinctStakers: new Set(), examples: [] };
        groups.set(withdrawer, group);
      }
      group.accountCount += 1;
      group.lamports += lamports;
      if (stateKind === 2) group.delegatedAccountCount += 1;
      if (group.distinctStakers.size < 20) group.distinctStakers.add(staker);
      if (group.examples.length < 3) group.examples.push({ address: row.pubkey, lamports: String(row.account.lamports), staker, stateKind });
      initializedCount += 1;
      initializedLamports += lamports;
    } catch (_) { malformed += 1; }
  }
  for (const group of groups.values()) {
    if (group.lamports < RETAIN_LAMPORTS) continue;
    if (OFFCURVE_ONLY && PublicKey.isOnCurve(new PublicKey(group.authority).toBytes())) continue;
    state.retainedWithdrawerGroups.push({
      authority: group.authority,
      accountCount: group.accountCount,
      delegatedAccountCount: group.delegatedAccountCount,
      lamports: group.lamports.toString(),
      sol: Number(group.lamports) / 1e9,
      observedDistinctStakers: [...group.distinctStakers],
      distinctStakerCountLowerBound: group.distinctStakers.size,
      examples: group.examples,
    });
  }
  state.returnedAccountCount += shard.rows.length;
  state.initializedOrDelegatedAccountCount += initializedCount;
  state.initializedOrDelegatedLamports = (BigInt(state.initializedOrDelegatedLamports) + initializedLamports).toString();
  state.excludedStateCount += excluded;
  state.malformedCount += malformed;
  state.contextSlotMin = state.contextSlotMin === null ? shard.contextSlot : Math.min(state.contextSlotMin, shard.contextSlot);
  state.contextSlotMax = state.contextSlotMax === null ? shard.contextSlot : Math.max(state.contextSlotMax, shard.contextSlot);
  state.completedShards.push(shard.byte);
}

(async () => {
  const state = initialState();
  const done = new Set(state.completedShards);
  const queue = Array.from({ length: 256 }, (_, i) => i).filter((i) => !done.has(i));
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const byte = queue[index];
      try {
        const shard = await fetchShard(byte);
        consumeShard(state, shard);
        state.failedShards = state.failedShards.filter((x) => x.byte !== byte);
        save(state);
        console.error(`shard ${byte}/255: ${shard.rows.length} accounts; completed ${state.completedShards.length}/256`);
      } catch (error) {
        state.failedShards = state.failedShards.filter((x) => x.byte !== byte);
        state.failedShards.push({ byte, error: error.message, at: new Date().toISOString() });
        save(state);
        console.error(`shard ${byte}/255 failed: ${error.message}`);
      }
      await sleep(250);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  save(state);
  console.log(JSON.stringify({
    output: OUT,
    completedShardCount: state.completedShards.length,
    failedShardCount: state.failedShards.length,
    returnedAccountCount: state.returnedAccountCount,
    initializedOrDelegatedAccountCount: state.initializedOrDelegatedAccountCount,
    contextSlotMin: state.contextSlotMin,
    contextSlotMax: state.contextSlotMax,
    retainedGroupCount: state.retainedWithdrawerGroups.length,
    top: state.retainedWithdrawerGroups.slice(0, 30).map(({ authority, accountCount, sol }) => ({ authority, accountCount, sol })),
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
