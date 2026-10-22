#!/usr/bin/env node
'use strict';

// Read-only current-mainnet custody census for SanctumSplMulti.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const {
  Connection,
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  StakePoolLayout,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-stake-pool');

const PROGRAM = new PublicKey('SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn');
const STAKE_PROGRAM = new PublicKey('Stake11111111111111111111111111111111111111');
const DIR = __dirname;
const OUT = path.join(DIR, 'sanctum-splmulti-current-custody.json');
const ELF = path.join(DIR, 'sanctum-splmulti-current.so');

function loadEndpoint() {
  const pairs = fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
    .split(/\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2));
  const env = Object.fromEntries(pairs);
  return env.HEAVY_RPC_URL || env.RPC_URL;
}

function bn(value) {
  return BigInt(value.toString());
}

function key(value) {
  return value ? value.toBase58() : null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({length: limit}, worker));
  return out;
}

async function rpc(endpoint, method, params, attempts = 3) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
        signal: controller.signal,
      });
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

async function main() {
  const endpoint = loadEndpoint();
  const connection = new Connection(endpoint, 'confirmed');
  const programAccounts = await connection.getProgramAccounts(PROGRAM, {
    commitment: 'confirmed',
    withContext: true,
    filters: [{dataSize: 611}, {memcmp: {offset: 0, bytes: '2'}}],
  });
  const epoch = await connection.getEpochInfo('confirmed');
  const pools = programAccounts.value.map(({pubkey, account}) => {
    const state = StakePoolLayout.decode(account.data);
    const [withdrawAuthority, bump] = PublicKey.findProgramAddressSync(
      [pubkey.toBuffer(), Buffer.from('withdraw')],
      PROGRAM,
    );
    return {
      stakePool: pubkey.toBase58(),
      stateLamports: String(account.lamports),
      manager: key(state.manager),
      staker: key(state.staker),
      stakeDepositAuthority: key(state.stakeDepositAuthority),
      withdrawAuthority: withdrawAuthority.toBase58(),
      derivedWithdrawBump: bump,
      storedWithdrawBump: state.stakeWithdrawBumpSeed,
      withdrawPdaVerified: bump === state.stakeWithdrawBumpSeed,
      validatorList: key(state.validatorList),
      reserveStake: key(state.reserveStake),
      poolMint: key(state.poolMint),
      managerFeeAccount: key(state.managerFeeAccount),
      tokenProgramId: key(state.tokenProgramId),
      totalLamports: bn(state.totalLamports).toString(),
      poolTokenSupply: bn(state.poolTokenSupply).toString(),
      lastUpdateEpoch: bn(state.lastUpdateEpoch).toString(),
      currentEpoch: String(epoch.epoch),
      currentThisEpoch: bn(state.lastUpdateEpoch) === BigInt(epoch.epoch),
      solDepositAuthority: key(state.solDepositAuthority),
      solWithdrawAuthority: key(state.solWithdrawAuthority),
      solDepositFee: {
        numerator: bn(state.solDepositFee.numerator).toString(),
        denominator: bn(state.solDepositFee.denominator).toString(),
      },
      solWithdrawalFee: {
        numerator: bn(state.solWithdrawalFee.numerator).toString(),
        denominator: bn(state.solWithdrawalFee.denominator).toString(),
      },
      stakeDepositFee: {
        numerator: bn(state.stakeDepositFee.numerator).toString(),
        denominator: bn(state.stakeDepositFee.denominator).toString(),
      },
      stakeWithdrawalFee: {
        numerator: bn(state.stakeWithdrawalFee.numerator).toString(),
        denominator: bn(state.stakeWithdrawalFee.denominator).toString(),
      },
    };
  });

  let completedAuthorityQueries = 0;
  const authorityRows = await mapLimit(pools, 4, async (pool) => {
    const result = await rpc(endpoint, 'getProgramAccounts', [STAKE_PROGRAM.toBase58(), {
      commitment: 'confirmed', encoding: 'base64', withContext: true,
      filters: [{dataSize: 200}, {memcmp: {offset: 44, bytes: pool.withdrawAuthority}}],
      dataSlice: {offset: 0, length: 76},
    }]);
    let lamports = 0n;
    let delegatedLamports = 0n;
    let initializedLamports = 0n;
    let delegatedCount = 0;
    let initializedCount = 0;
    const examples = [];
    for (const row of result.value) {
      const data = Buffer.from(row.account.data[0], 'base64');
      const stateKind = data.readUInt32LE(0);
      const rowLamports = BigInt(row.account.lamports);
      lamports += rowLamports;
      if (stateKind === 2) {
        delegatedCount++;
        delegatedLamports += rowLamports;
      } else if (stateKind === 1) {
        initializedCount++;
        initializedLamports += rowLamports;
      }
      if (examples.length < 5) {
        examples.push({
          address: row.pubkey,
          lamports: rowLamports.toString(),
          stateKind,
          staker: new PublicKey(data.subarray(12, 44)).toBase58(),
        });
      }
    }
    const authority = {
      ...pool,
      stakeQuerySlot: result.context.slot,
      authorityStakeAccountCount: result.value.length,
      authorityStakeLamports: lamports.toString(),
      authorityStakeSol: Number(lamports) / 1e9,
      delegatedStakeAccountCount: delegatedCount,
      delegatedStakeLamports: delegatedLamports.toString(),
      initializedStakeAccountCount: initializedCount,
      initializedStakeLamports: initializedLamports.toString(),
      examples,
    };
    completedAuthorityQueries++;
    console.error(`authority ${completedAuthorityQueries}/${pools.length}: ${pool.withdrawAuthority} -> ${result.value.length}`);
    return authority;
  });

  const reserveInfos = await connection.getMultipleAccountsInfo(
    authorityRows.map((pool) => new PublicKey(pool.reserveStake)),
    'confirmed',
  );
  for (let index = 0; index < authorityRows.length; index++) {
    const info = reserveInfos[index];
    authorityRows[index].reserveExists = Boolean(info);
    authorityRows[index].reserveOwner = info?.owner.toBase58() || null;
    authorityRows[index].reserveLamports = info ? String(info.lamports) : null;
    authorityRows[index].reserveIncludedInAuthorityQuery = authorityRows[index].examples
      .some((row) => row.address === authorityRows[index].reserveStake)
      || (info ? info.owner.equals(STAKE_PROGRAM) : false);
  }

  authorityRows.sort((a, b) => {
    const left = BigInt(a.authorityStakeLamports);
    const right = BigInt(b.authorityStakeLamports);
    return left === right ? a.stakePool.localeCompare(b.stakePool) : (left > right ? -1 : 1);
  });

  const programInfo = await connection.getAccountInfoAndContext(PROGRAM, 'confirmed');
  const programData = programInfo.value?.data?.length >= 36
    ? new PublicKey(programInfo.value.data.subarray(4, 36))
    : null;
  const programDataInfo = programData
    ? await connection.getAccountInfoAndContext(programData, 'confirmed')
    : null;
  const pd = programDataInfo?.value?.data;
  const lastDeployedSlot = pd && pd.length >= 12 ? pd.readBigUInt64LE(4).toString() : null;
  const authorityOption = pd && pd.length >= 13 ? pd[12] : null;
  const upgradeAuthority = authorityOption === 1 && pd.length >= 45
    ? new PublicKey(pd.subarray(13, 45)).toBase58()
    : null;
  const elf = fs.readFileSync(ELF);

  const grossLamports = authorityRows.reduce(
    (sum, pool) => sum + BigInt(pool.authorityStakeLamports),
    0n,
  );
  const stateTotalLamports = authorityRows.reduce(
    (sum, pool) => sum + BigInt(pool.totalLamports),
    0n,
  );
  const reserveLamports = authorityRows.reduce(
    (sum, pool) => sum + BigInt(pool.reserveLamports || '0'),
    0n,
  );

  const census = JSON.parse(fs.readFileSync(path.join(DIR, 'native-stake-authority-census.json')));
  const retained = new Map(census.retainedWithdrawerGroups.map((row) => [row.authority, row]));
  let censusRetainedMatches = 0;
  for (const pool of authorityRows) {
    const prior = retained.get(pool.withdrawAuthority);
    if (prior) {
      censusRetainedMatches++;
      pool.priorCensus = {
        generatedAt: census.generatedAt,
        contextSlotMin: census.contextSlotMin,
        contextSlotMax: census.contextSlotMax,
        accountCount: prior.accountCount,
        lamports: prior.lamports,
      };
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    transport: 'read-only mainnet RPC',
    programId: PROGRAM.toBase58(),
    programAccountSlot: programInfo.context.slot,
    programOwner: programInfo.value?.owner.toBase58() || null,
    programExecutable: programInfo.value?.executable || false,
    programDataAddress: programData?.toBase58() || null,
    programDataSlot: programDataInfo?.context.slot || null,
    lastDeployedSlot,
    upgradeAuthority,
    elfBytes: elf.length,
    elfSha256: crypto.createHash('sha256').update(elf).digest('hex'),
    poolStateSlot: programAccounts.context.slot,
    currentEpoch: epoch.epoch,
    poolCount: authorityRows.length,
    verifiedWithdrawPdaCount: authorityRows.filter((pool) => pool.withdrawPdaVerified).length,
    currentEpochPoolCount: authorityRows.filter((pool) => pool.currentThisEpoch).length,
    grossAuthorityStakeLamports: grossLamports.toString(),
    grossAuthorityStakeSol: Number(grossLamports) / 1e9,
    stateTotalLamports: stateTotalLamports.toString(),
    stateTotalSol: Number(stateTotalLamports) / 1e9,
    reserveLamports: reserveLamports.toString(),
    reserveSol: Number(reserveLamports) / 1e9,
    censusOverlap: {
      priorGeneratedAt: census.generatedAt,
      priorSlotMin: census.contextSlotMin,
      priorSlotMax: census.contextSlotMax,
      retentionThresholdSol: census.retentionThresholdSol,
      retainedAuthorityMatches: censusRetainedMatches,
      note: 'Prior census retained only authority groups at or above its threshold; current per-authority queries are exact at their individual context slots.',
    },
    pools: authorityRows,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    output: OUT,
    programData: output.programDataAddress,
    lastDeployedSlot: output.lastDeployedSlot,
    elfSha256: output.elfSha256,
    poolStateSlot: output.poolStateSlot,
    poolCount: output.poolCount,
    verifiedWithdrawPdaCount: output.verifiedWithdrawPdaCount,
    currentEpochPoolCount: output.currentEpochPoolCount,
    grossAuthorityStakeSol: output.grossAuthorityStakeSol,
    stateTotalSol: output.stateTotalSol,
    reserveSol: output.reserveSol,
    censusRetainedMatches,
    topPools: output.pools.slice(0, 12).map((pool) => ({
      stakePool: pool.stakePool,
      poolMint: pool.poolMint,
      withdrawAuthority: pool.withdrawAuthority,
      stakeAccounts: pool.authorityStakeAccountCount,
      authorityStakeSol: pool.authorityStakeSol,
      stateTotalSol: Number(BigInt(pool.totalLamports)) / 1e9,
      reserveSol: Number(BigInt(pool.reserveLamports || '0')) / 1e9,
      currentThisEpoch: pool.currentThisEpoch,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
