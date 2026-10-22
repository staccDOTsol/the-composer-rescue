#!/usr/bin/env node
// Read-only, resumable authority-exact Stake-account scan for every decoded
// Sanctum SPL stake-pool state. This closes the <100 SOL long tail omitted by
// the broad authority census's retention threshold.

const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC_URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!RPC_URL) throw new Error('set HEAVY_RPC_URL or RPC_URL');
const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111';
const POOLS_PATH = process.env.POOLS_PATH || path.join(__dirname, 'sanctum-spl-stake-pools.json');
const OUT = process.argv[2] || path.join(__dirname, 'sanctum-spl-live-stake-custody.json');
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.CONCURRENCY || '4')));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, attempts = 6) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
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

function save(state) {
  state.generatedAt = new Date().toISOString();
  state.results.sort((a, b) => BigInt(a.liveStakeLamports) === BigInt(b.liveStakeLamports) ? a.stakePool.localeCompare(b.stakePool) : BigInt(a.liveStakeLamports) > BigInt(b.liveStakeLamports) ? -1 : 1);
  fs.writeFileSync(OUT, `${JSON.stringify(state, null, 2)}\n`);
}

async function scan(pool) {
  const result = await rpc('getProgramAccounts', [STAKE_PROGRAM, {
    commitment: 'confirmed', encoding: 'base64', withContext: true,
    filters: [{ dataSize: 200 }, { memcmp: { offset: 44, bytes: pool.withdrawAuthority } }],
    dataSlice: { offset: 0, length: 76 },
  }]);
  let lamports = 0n;
  let malformed = 0;
  const examples = [];
  for (const row of result.value) {
    try {
      const data = Buffer.from(row.account.data[0], 'base64');
      const stateKind = data.readUInt32LE(0);
      const withdrawer = new PublicKey(data.subarray(44, 76)).toBase58();
      if ((stateKind !== 1 && stateKind !== 2) || withdrawer !== pool.withdrawAuthority) throw new Error('authority/state mismatch');
      lamports += BigInt(row.account.lamports);
      if (examples.length < 3) examples.push({ address: row.pubkey, lamports: String(row.account.lamports), stateKind, staker: new PublicKey(data.subarray(12, 44)).toBase58() });
    } catch (_) { malformed += 1; }
  }
  return { ...pool, observationSlot: result.context.slot, liveStakeAccountCount: result.value.length - malformed, liveStakeLamports: lamports.toString(), liveStakeSol: Number(lamports) / 1e9, malformedCount: malformed, examples };
}

(async () => {
  const source = JSON.parse(fs.readFileSync(POOLS_PATH, 'utf8'));
  const state = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {
    generatedAt: null,
    startedAt: new Date().toISOString(),
    programId: source.programId,
    sourcePoolStateObservationSlot: source.observedSlot,
    decodedPoolDenominator: source.decodablePoolCount,
    completedPoolCount: 0,
    failed: [],
    contextSlotMin: null,
    contextSlotMax: null,
    results: [],
  };
  const done = new Set(state.results.map((r) => r.stakePool));
  const queue = source.pools.filter((p) => !done.has(p.stakePool));
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const i = cursor; cursor += 1;
      const pool = queue[i];
      try {
        const result = await scan(pool);
        state.results.push(result);
        state.failed = state.failed.filter((f) => f.stakePool !== pool.stakePool);
        state.completedPoolCount = state.results.length;
        state.contextSlotMin = state.contextSlotMin === null ? result.observationSlot : Math.min(state.contextSlotMin, result.observationSlot);
        state.contextSlotMax = state.contextSlotMax === null ? result.observationSlot : Math.max(state.contextSlotMax, result.observationSlot);
      } catch (error) {
        state.failed = state.failed.filter((f) => f.stakePool !== pool.stakePool);
        state.failed.push({ stakePool: pool.stakePool, error: error.message });
      }
      if ((state.results.length + state.failed.length) % 20 === 0) {
        save(state);
        console.error(`processed ${state.results.length + state.failed.length}/${source.pools.length}; failures ${state.failed.length}`);
      }
      await sleep(100);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  state.totalLiveStakeAccountCount = state.results.reduce((sum, p) => sum + p.liveStakeAccountCount, 0);
  state.totalLiveStakeLamports = state.results.reduce((sum, p) => sum + BigInt(p.liveStakeLamports), 0n).toString();
  state.totalLiveStakeSol = Number(state.totalLiveStakeLamports) / 1e9;
  state.nonzeroPoolCount = state.results.filter((p) => p.liveStakeLamports !== '0').length;
  save(state);
  console.log(JSON.stringify({ output: OUT, decodedPoolDenominator: state.decodedPoolDenominator, completedPoolCount: state.completedPoolCount, failedCount: state.failed.length, contextSlotMin: state.contextSlotMin, contextSlotMax: state.contextSlotMax, totalLiveStakeAccountCount: state.totalLiveStakeAccountCount, totalLiveStakeSol: state.totalLiveStakeSol, nonzeroPoolCount: state.nonzeroPoolCount, top: state.results.slice(0, 40).map(({ stakePool, withdrawAuthority, poolMint, liveStakeAccountCount, liveStakeSol }) => ({ stakePool, withdrawAuthority, poolMint, liveStakeAccountCount, liveStakeSol })) }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
