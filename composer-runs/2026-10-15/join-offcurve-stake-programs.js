#!/usr/bin/env node
// Join a complete off-curve Stake-authority census to decoded SPL Stake Pool
// state, avoiding one getProgramAccounts call per pool.

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CENSUS = process.argv[2] || path.join(DIR, 'native-stake-offcurve-census.json');
const jobs = [
  {
    input: path.join(DIR, 'sanctum-spl-stake-pools.json'),
    output: path.join(DIR, 'sanctum-spl-live-stake-custody-complete.json'),
  },
  {
    input: path.join(DIR, 'sanctum-spl-multi-stake-pools.json'),
    output: path.join(DIR, 'sanctum-spl-multi-live-stake-custody-complete.json'),
  },
];

const census = JSON.parse(fs.readFileSync(CENSUS, 'utf8'));
if (census.completedShards.length !== 256 || census.failedShards.length !== 0) {
  throw new Error('off-curve census is not complete');
}
const byAuthority = new Map(census.retainedWithdrawerGroups.map((group) => [group.authority, group]));

for (const job of jobs) {
  const source = JSON.parse(fs.readFileSync(job.input, 'utf8'));
  const seen = new Set();
  const pools = source.pools.map((pool) => {
    if (seen.has(pool.withdrawAuthority)) throw new Error(`duplicate withdraw authority ${pool.withdrawAuthority}`);
    seen.add(pool.withdrawAuthority);
    const group = byAuthority.get(pool.withdrawAuthority);
    return {
      ...pool,
      liveStakeAccountCount: group?.accountCount || 0,
      liveDelegatedStakeAccountCount: group?.delegatedAccountCount || 0,
      liveStakeLamports: group?.lamports || '0',
      liveStakeSol: group?.sol || 0,
    };
  }).sort((a, b) => b.liveStakeSol - a.liveStakeSol);
  const liveStakeLamports = pools.reduce((sum, pool) => sum + BigInt(pool.liveStakeLamports), 0n);
  const stateTotalLamports = pools.reduce((sum, pool) => sum + BigInt(pool.stateTotalLamports), 0n);
  const output = {
    generatedAt: new Date().toISOString(),
    programId: source.programId,
    method: 'Decoded program-owned pool states joined to the complete 256-shard off-curve native Stake-account census by canonical withdraw PDA.',
    census: {
      source: path.basename(CENSUS),
      completedShardCount: census.completedShards.length,
      failedShardCount: census.failedShards.length,
      returnedAccountCount: census.returnedAccountCount,
      initializedOrDelegatedAccountCount: census.initializedOrDelegatedAccountCount,
      contextSlotMin: census.contextSlotMin,
      contextSlotMax: census.contextSlotMax,
      retentionThresholdSol: census.retentionThresholdSol,
      offCurveOnly: census.offCurveOnly,
    },
    poolStateObservationSlot: source.observedSlot,
    programAccountObservationCount: source.accountObservationCount,
    decodablePoolCount: source.decodablePoolCount,
    withdrawPdaVerifiedCount: source.withdrawPdaVerifiedCount,
    joinedPoolCount: pools.length,
    nonzeroPoolCount: pools.filter((pool) => pool.liveStakeLamports !== '0').length,
    zeroPoolCount: pools.filter((pool) => pool.liveStakeLamports === '0').length,
    liveStakeAccountCount: pools.reduce((sum, pool) => sum + pool.liveStakeAccountCount, 0),
    liveDelegatedStakeAccountCount: pools.reduce((sum, pool) => sum + pool.liveDelegatedStakeAccountCount, 0),
    liveStakeLamports: liveStakeLamports.toString(),
    liveStakeSol: Number(liveStakeLamports) / 1e9,
    summedStateTotalLamports: stateTotalLamports.toString(),
    liveMinusStateLamports: (liveStakeLamports - stateTotalLamports).toString(),
    pools,
  };
  fs.writeFileSync(job.output, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ output: job.output, programId: output.programId, decodablePoolCount: output.decodablePoolCount, nonzeroPoolCount: output.nonzeroPoolCount, liveStakeAccountCount: output.liveStakeAccountCount, liveStakeSol: output.liveStakeSol, liveMinusStateLamports: output.liveMinusStateLamports }, null, 2));
}
