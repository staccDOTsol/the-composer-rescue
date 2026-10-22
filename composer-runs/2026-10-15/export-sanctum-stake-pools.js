#!/usr/bin/env node
// Read-only export of every decodable Sanctum SPL stake-pool state and its
// canonical withdraw-authority PDA, joined to the full Stake-account census.

const fs = require('fs');
const path = require('path');
const { Connection, PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const { getStakePoolAccounts } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-stake-pool');

const RPC_URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!RPC_URL) throw new Error('set HEAVY_RPC_URL or RPC_URL');
const PROGRAM = new PublicKey(process.env.PROGRAM_ID || 'SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY');
const CENSUS = process.env.CENSUS_FILE || path.join(__dirname, 'native-stake-authority-census.json');
const OUT = process.argv[2] || path.join(__dirname, 'sanctum-spl-stake-pools.json');
const pk = (value) => value?.toBase58?.() ?? null;
const dec = (value) => value?.toString?.() ?? null;

(async () => {
  const connection = new Connection(RPC_URL, 'confirmed');
  const observedSlot = await connection.getSlot('confirmed');
  const accounts = await getStakePoolAccounts(connection, PROGRAM);
  const census = JSON.parse(fs.readFileSync(CENSUS, 'utf8'));
  const authorityGroups = new Map(census.retainedWithdrawerGroups.map((g) => [g.authority, g]));
  const pools = accounts
    .filter(({ account }) => pk(account.data.poolMint))
    .map(({ pubkey, account }) => {
      const data = account.data;
      const [withdrawAuthority, bump] = PublicKey.findProgramAddressSync([pubkey.toBuffer(), Buffer.from('withdraw')], PROGRAM);
      const live = authorityGroups.get(pk(withdrawAuthority));
      return {
        stakePool: pk(pubkey),
        withdrawAuthority: pk(withdrawAuthority),
        derivedWithdrawBump: bump,
        storedWithdrawBump: data.stakeWithdrawBumpSeed,
        withdrawPdaVerified: bump === data.stakeWithdrawBumpSeed,
        manager: pk(data.manager),
        staker: pk(data.staker),
        stakeDepositAuthority: pk(data.stakeDepositAuthority),
        poolMint: pk(data.poolMint),
        reserveStake: pk(data.reserveStake),
        validatorList: pk(data.validatorList),
        managerFeeAccount: pk(data.managerFeeAccount),
        tokenProgramId: pk(data.tokenProgramId),
        stateTotalLamports: dec(data.totalLamports),
        poolTokenSupply: dec(data.poolTokenSupply),
        lastUpdateEpoch: dec(data.lastUpdateEpoch),
        liveStakeAccountCount: live?.accountCount || 0,
        liveStakeLamports: live?.lamports || '0',
        liveStakeSol: live?.sol || 0,
      };
    })
    .sort((a, b) => BigInt(b.liveStakeLamports) > BigInt(a.liveStakeLamports) ? 1 : -1);
  const output = {
    generatedAt: new Date().toISOString(),
    programId: pk(PROGRAM),
    observedSlot,
    accountObservationCount: accounts.length,
    decodablePoolCount: pools.length,
    withdrawPdaVerifiedCount: pools.filter((p) => p.withdrawPdaVerified).length,
    censusContextSlotMin: census.contextSlotMin,
    censusContextSlotMax: census.contextSlotMax,
    censusRetentionThresholdSol: census.retentionThresholdSol,
    pools,
    liveStakeAccountCount: pools.reduce((sum, p) => sum + p.liveStakeAccountCount, 0),
    liveStakeLamports: pools.reduce((sum, p) => sum + BigInt(p.liveStakeLamports), 0n).toString(),
    liveStakeSol: pools.reduce((sum, p) => sum + Number(p.liveStakeLamports), 0) / 1e9,
    poolsBelowCensusRetentionThreshold: pools.filter((p) => p.liveStakeLamports === '0').length,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUT, observedSlot, accountObservationCount: accounts.length, decodablePoolCount: pools.length, withdrawPdaVerifiedCount: output.withdrawPdaVerifiedCount, liveStakeAccountCount: output.liveStakeAccountCount, liveStakeSol: output.liveStakeSol, poolsBelowCensusRetentionThreshold: output.poolsBelowCensusRetentionThreshold, top: pools.slice(0, 30).map(({ stakePool, withdrawAuthority, poolMint, liveStakeAccountCount, liveStakeSol }) => ({ stakePool, withdrawAuthority, poolMint, liveStakeAccountCount, liveStakeSol })) }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
