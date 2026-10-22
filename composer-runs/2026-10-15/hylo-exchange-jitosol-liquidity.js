#!/usr/bin/env node
// Read-only current-mainnet JitoSOL backing and direct-SOL reserve census.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const {
  Connection,
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  StakePoolLayout,
  STAKE_POOL_PROGRAM_ID,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-stake-pool');

const ROOT = __dirname;
const ENV = '/tmp/composer-helius-rpc.env';
const OUT = `${ROOT}/hylo-exchange-jitosol-liquidity.json`;
const POOL = new PublicKey('Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb');
const JITOSOL = new PublicKey('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');
const HYLO_VAULT = new PublicKey('2Y3TLkdGoJwbdizxqrZmQwNLYJyGKTgzC4tbetbkvQ43');

function readEnv(path) {
  const out = {};
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function tokenAmount(account) {
  if (!account || account.data.length < 72) throw new Error('Invalid SPL token account');
  return account.data.readBigUInt64LE(64);
}

function mintSupply(account) {
  if (!account || account.data.length < 45) throw new Error('Invalid SPL mint account');
  return {
    supply: account.data.readBigUInt64LE(36),
    decimals: account.data[44],
  };
}

function feeJson(fee) {
  return {
    numerator: fee.numerator.toString(),
    denominator: fee.denominator.toString(),
  };
}

function decimal(raw, decimals = 9) {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function main() {
  const env = readEnv(ENV);
  const rpcUrl = env.RPC_URL || env.HEAVY_RPC_URL;
  if (!rpcUrl) throw new Error('No read-only RPC configured');
  const connection = new Connection(rpcUrl, {commitment: 'confirmed'});

  const poolResponse = await connection.getAccountInfoAndContext(POOL, 'confirmed');
  if (!poolResponse.value) throw new Error('JitoSOL stake pool is missing');
  const poolAccount = poolResponse.value;
  const pool = StakePoolLayout.decode(poolAccount.data);
  const reserve = pool.reserveStake;

  const page = await connection.getMultipleAccountsInfoAndContext(
    [reserve, pool.poolMint, HYLO_VAULT],
    {commitment: 'confirmed'},
  );
  const [reserveAccount, mintAccount, hyloVaultAccount] = page.value;
  if (!reserveAccount || !mintAccount || !hyloVaultAccount) throw new Error('Missing JitoSOL liquidity account');

  const epochInfo = await connection.getEpochInfo('confirmed');
  const reserveRentExemptRaw = BigInt(await connection.getMinimumBalanceForRentExemption(reserveAccount.data.length, 'confirmed'));
  // SPL stake-pool v2 uses rent_exempt_reserve + MINIMUM_RESERVE_LAMPORTS;
  // MINIMUM_RESERVE_LAMPORTS is zero in the published program source.
  const reserveImmediateSolRaw = BigInt(reserveAccount.lamports) > reserveRentExemptRaw
    ? BigInt(reserveAccount.lamports) - reserveRentExemptRaw
    : 0n;

  const totalLamports = BigInt(pool.totalLamports.toString());
  const poolTokenSupply = BigInt(pool.poolTokenSupply.toString());
  const mint = mintSupply(mintAccount);
  const hyloVaultJitoRaw = tokenAmount(hyloVaultAccount);
  const hyloVaultBackingSolRaw = poolTokenSupply === 0n
    ? 0n
    : hyloVaultJitoRaw * totalLamports / poolTokenSupply;
  const directSolCapacityJitoRawBeforeFee = totalLamports === 0n
    ? 0n
    : reserveImmediateSolRaw * poolTokenSupply / totalLamports;
  const reserveCoverageBpsOfHyloVault = hyloVaultBackingSolRaw === 0n
    ? 0n
    : reserveImmediateSolRaw * 10_000n / hyloVaultBackingSolRaw;

  const output = {
    generatedAt: new Date().toISOString(),
    transport: 'read-only current-mainnet account reads; no signing, simulation, or submission',
    rpcEndpointRedacted: true,
    noTransactionsSubmitted: true,
    observations: {
      poolAccountSlot: poolResponse.context.slot,
      liquidityAccountsSlot: page.context.slot,
      epoch: epochInfo.epoch,
    },
    addresses: {
      stakePool: POOL.toBase58(),
      stakePoolProgram: STAKE_POOL_PROGRAM_ID.toBase58(),
      reserveStake: reserve.toBase58(),
      poolMint: pool.poolMint.toBase58(),
      expectedJitosolMint: JITOSOL.toBase58(),
      hyloJitosolVault: HYLO_VAULT.toBase58(),
    },
    identityChecks: {
      poolOwner: poolAccount.owner.toBase58(),
      poolOwnerMatchesPublishedSplStakePoolProgram: poolAccount.owner.equals(STAKE_POOL_PROGRAM_ID),
      poolMintMatchesJitosol: pool.poolMint.equals(JITOSOL),
      tokenMintSupplyMatchesPoolState: mint.supply === poolTokenSupply,
      poolLastUpdateEpoch: pool.lastUpdateEpoch.toString(),
      currentEpoch: epochInfo.epoch.toString(),
      poolUpdatedThisEpoch: BigInt(pool.lastUpdateEpoch.toString()) === BigInt(epochInfo.epoch),
    },
    backing: {
      totalLamportsRaw: totalLamports.toString(),
      totalSol: decimal(totalLamports),
      poolTokenSupplyRaw: poolTokenSupply.toString(),
      poolTokenSupplyJitosol: decimal(poolTokenSupply, mint.decimals),
      jitosolSolRateNumerator: totalLamports.toString(),
      jitosolSolRateDenominator: poolTokenSupply.toString(),
    },
    directSolLiquidity: {
      reserveAccountLamportsRaw: reserveAccount.lamports.toString(),
      reserveRentExemptRaw: reserveRentExemptRaw.toString(),
      splMinimumReserveLamportsConstantRaw: '0',
      immediatelyWithdrawableSolRawBeforePoolFee: reserveImmediateSolRaw.toString(),
      immediatelyWithdrawableSolBeforePoolFee: decimal(reserveImmediateSolRaw),
      jitosolEquivalentRawBeforePoolFee: directSolCapacityJitoRawBeforeFee.toString(),
      jitosolEquivalentBeforePoolFee: decimal(directSolCapacityJitoRawBeforeFee, mint.decimals),
      solWithdrawalFee: feeJson(pool.solWithdrawalFee),
      solWithdrawAuthorityConfigured: Boolean(pool.solWithdrawAuthority),
      solWithdrawAuthority: pool.solWithdrawAuthority?.toBase58() || null,
      scopeNote: 'Direct SOL withdrawal is reserve-limited; SPL withdraw-stake can instead return a stake account from validator inventory.',
    },
    hyloVault: {
      jitosolRaw: hyloVaultJitoRaw.toString(),
      jitosol: decimal(hyloVaultJitoRaw, mint.decimals),
      nominalBackingSolRawBeforePoolFee: hyloVaultBackingSolRaw.toString(),
      nominalBackingSolBeforePoolFee: decimal(hyloVaultBackingSolRaw),
      immediateReserveCoverageBpsBeforePoolFee: reserveCoverageBpsOfHyloVault.toString(),
      immediateReserveCanCoverFullHyloVaultBeforePoolFee: reserveImmediateSolRaw >= hyloVaultBackingSolRaw,
    },
    accountDataSha256: {
      stakePool: crypto.createHash('sha256').update(poolAccount.data).digest('hex'),
      reserveStake: crypto.createHash('sha256').update(reserveAccount.data).digest('hex'),
      poolMint: crypto.createHash('sha256').update(mintAccount.data).digest('hex'),
      hyloVault: crypto.createHash('sha256').update(hyloVaultAccount.data).digest('hex'),
    },
    methodology: {
      reserveFormula: 'reserve account lamports - rent-exempt reserve - SPL MINIMUM_RESERVE_LAMPORTS (0)',
      nominalBackingFormula: 'floor(JitoSOL raw * pool total_lamports / pool_token_supply)',
      primaryReferences: [
        'https://github.com/jito-foundation/jito-omnidocs/blob/master/jitosol/jitosol-liquid-staking/security/deployed-programs/index.md',
        'https://docs.rs/spl-stake-pool/latest/src/spl_stake_pool/lib.rs.html',
        'https://docs.rs/crate/spl-stake-pool/latest/source/src/processor.rs',
      ],
    },
  };

  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    outputPath: OUT,
    observations: output.observations,
    identityChecks: output.identityChecks,
    backing: output.backing,
    directSolLiquidity: output.directSolLiquidity,
    hyloVault: output.hyloVault,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
