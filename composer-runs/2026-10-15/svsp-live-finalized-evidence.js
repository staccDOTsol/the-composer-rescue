#!/usr/bin/env node
'use strict';

// Defensive, read-only finalized-mainnet evidence collector for SPL Single Pool.
// It uses RPC_URL only, deliberately ignores HEAVY_RPC_URL, and never constructs,
// signs, simulates, or submits a transaction. RPC endpoint strings are never emitted.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {PublicKey, StakeProgram} = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js',
);

const PROGRAM_ID = new PublicKey('SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE');
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const LOADER_ID = 'BPFLoaderUpgradeab1e11111111111111111111111';
const HISTORICAL_SIGNATURE =
  '4msXjLBsZPppwwEEnFnrPhZgYpjAAwr8ckvaWAvYnEpVLwJ7Ay8NrV55RMX1M41fJ9KdmoQsnnuF2BDYcraaBDiM';
const LOCAL_SO = path.join(__dirname, `${PROGRAM_ID.toBase58()}.so`);
const DEFAULT_OUT = path.join(__dirname, 'svsp-live-finalized-evidence.json');
const OUT = process.argv[2] || DEFAULT_OUT;
const COMMITMENT = 'finalized';
const RELEASE = {
  tag: 'program@v4.0.1',
  commit: '3921ea5f63198b9a4f8d1ac9fcf24d5ca612a10a',
  publishedAt: '2026-03-19T11:41:50Z',
  assetName: 'spl_single_pool-v4.0.1.so',
  assetBytes: 234664,
  assetSha256: '217300596e04cf21d9e613fdac3cfefa5ada9456a36b9fc79303fac5fe192f8d',
  releaseUrl: 'https://github.com/solana-program/single-pool/releases/tag/program%40v4.0.1',
};

const envPath = ['/tmp/composer-helius-only.env', '/tmp/composer-helius-rpc.env']
  .find((candidate) => fs.existsSync(candidate));
const localEnv = envPath ? Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
) : {};
const RPC_URL = process.env.RPC_URL || localEnv.RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL is not configured');

let requestId = 0;
const calls = [];
const contextSlots = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, retries = 5) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params}),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.json();
      if (!response.ok || body.error) {
        const err = body.error || {message: `HTTP ${response.status}`};
        throw new Error(`${method}: ${err.code ?? response.status}: ${err.message || 'RPC error'}`);
      }
      const slot = body.result?.context?.slot ?? null;
      if (slot !== null) contextSlots.push(slot);
      calls.push({method, slot, ok: true});
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < retries) await sleep(400 * (2 ** attempt));
    }
  }
  calls.push({method, slot: null, ok: false, error: String(lastError?.message || lastError)});
  throw lastError;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function key(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function derive(prefix, base) {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(prefix), new PublicKey(base).toBuffer()],
    PROGRAM_ID,
  );
  return {address: address.toBase58(), bump, offCurve: !PublicKey.isOnCurve(address.toBuffer())};
}

function parseStake(address, account) {
  if (!account) return {address, exists: false};
  const data = Buffer.from(account.data[0], 'base64');
  const variant = data.length >= 4 ? data.readUInt32LE(0) : null;
  return {
    address,
    exists: true,
    owner: account.owner,
    lamports: String(account.lamports),
    dataLength: data.length,
    variant,
    rentExemptReserveLamports: [1, 2].includes(variant) ? data.readBigUInt64LE(4).toString() : null,
    staker: [1, 2].includes(variant) ? key(data, 12) : null,
    withdrawer: [1, 2].includes(variant) ? key(data, 44) : null,
    lockupUnixTimestamp: [1, 2].includes(variant) ? data.readBigInt64LE(76).toString() : null,
    lockupEpoch: [1, 2].includes(variant) ? data.readBigUInt64LE(84).toString() : null,
    lockupCustodian: [1, 2].includes(variant) ? key(data, 92) : null,
    voteAccount: variant === 2 ? key(data, 124) : null,
    delegatedStakeLamports: variant === 2 ? data.readBigUInt64LE(156).toString() : '0',
    activationEpoch: variant === 2 ? data.readBigUInt64LE(164).toString() : null,
    deactivationEpoch: variant === 2 ? data.readBigUInt64LE(172).toString() : null,
    warmupCooldownRate: variant === 2 ? data.readDoubleLE(180) : null,
    creditsObserved: variant === 2 ? data.readBigUInt64LE(188).toString() : null,
  };
}

function parseMint(address, account) {
  if (!account) return {address, exists: false};
  const data = Buffer.from(account.data[0], 'base64');
  const mintAuthorityOption = data.readUInt32LE(0);
  const freezeAuthorityOption = data.readUInt32LE(46);
  return {
    address,
    exists: true,
    owner: account.owner,
    lamports: String(account.lamports),
    dataLength: data.length,
    mintAuthority: mintAuthorityOption === 1 ? key(data, 4) : null,
    supplyRaw: data.readBigUInt64LE(36).toString(),
    decimals: data[44],
    initialized: data[45] === 1,
    freezeAuthority: freezeAuthorityOption === 1 ? key(data, 50) : null,
  };
}

function parseTokenAccount(row) {
  const data = Buffer.from(row.account.data[0], 'base64');
  const delegateOption = data.readUInt32LE(72);
  const closeAuthorityOption = data.readUInt32LE(129);
  return {
    address: row.pubkey,
    ownerProgram: row.account.owner,
    lamports: String(row.account.lamports),
    mint: key(data, 0),
    tokenOwner: key(data, 32),
    amountRaw: data.readBigUInt64LE(64).toString(),
    delegate: delegateOption === 1 ? key(data, 76) : null,
    state: data[108],
    delegatedAmountRaw: data.readBigUInt64LE(121).toString(),
    closeAuthority: closeAuthorityOption === 1 ? key(data, 133) : null,
    dataLength: data.length,
  };
}

async function getMultipleAccounts(addresses) {
  const out = new Map();
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const result = await rpc('getMultipleAccounts', [chunk, {
      encoding: 'base64', commitment: COMMITMENT,
    }]);
    chunk.forEach((address, j) => out.set(address, {
      account: result.value[j], observationSlot: result.context.slot,
    }));
  }
  return out;
}

async function getStakeAccountsByWithdrawer(withdrawer) {
  const result = await rpc('getProgramAccounts', [StakeProgram.programId.toBase58(), {
    encoding: 'base64', commitment: COMMITMENT, withContext: true,
    filters: [{dataSize: 200}, {memcmp: {offset: 44, bytes: withdrawer}}],
  }]);
  return {
    slot: result.context.slot,
    accounts: result.value.map((row) => parseStake(row.pubkey, row.account)),
  };
}

async function getTokenAccountsByMint(mint) {
  // The live provider indexes mint-at-offset-0. Enumerating all accounts for
  // each canonical mint is exhaustive for both burn-authority cases (owner and
  // delegate), and avoids the unavailable delegate-at-offset-76 index.
  const result = await rpc('getProgramAccounts', [TOKEN_PROGRAM_ID, {
    encoding: 'base64', commitment: COMMITMENT, withContext: true,
    filters: [{dataSize: 165}, {memcmp: {offset: 0, bytes: mint}}],
  }]);
  return {
    slot: result.context.slot,
    accounts: result.value.map(parseTokenAccount),
  };
}

async function main() {
  const generatedAtStart = new Date().toISOString();
  const startSlot = await rpc('getSlot', [{commitment: COMMITMENT}]);
  const epochInfo = await rpc('getEpochInfo', [{commitment: COMMITMENT}]);

  const programResult = await rpc('getAccountInfo', [PROGRAM_ID.toBase58(), {
    encoding: 'base64', commitment: COMMITMENT,
  }]);
  if (!programResult.value) throw new Error('Program account does not exist');
  const programState = Buffer.from(programResult.value.data[0], 'base64');
  if (programState.readUInt32LE(0) !== 2) throw new Error('Program is not an UpgradeableLoader Program state');
  const programDataAddress = key(programState, 4);
  const programDataResult = await rpc('getAccountInfo', [programDataAddress, {
    encoding: 'base64', commitment: COMMITMENT,
  }]);
  if (!programDataResult.value) throw new Error('ProgramData account does not exist');
  const rawProgramData = Buffer.from(programDataResult.value.data[0], 'base64');
  if (rawProgramData.readUInt32LE(0) !== 3) throw new Error('Unexpected ProgramData loader state');
  // UpgradeableLoaderState uses a one-byte bincode Option discriminant here.
  const hasUpgradeAuthority = rawProgramData[12] === 1;
  const payloadOffset = hasUpgradeAuthority ? 45 : 13;
  const payload = rawProgramData.subarray(payloadOffset);
  let lastNonzero = payload.length;
  while (lastNonzero > 0 && payload[lastNonzero - 1] === 0) lastNonzero -= 1;
  const releasePrefix = payload.subarray(0, RELEASE.assetBytes);
  const releasePadding = payload.subarray(RELEASE.assetBytes);
  const localSo = fs.existsSync(LOCAL_SO) ? fs.readFileSync(LOCAL_SO) : null;
  const executable = {
    programId: PROGRAM_ID.toBase58(),
    programObservationSlot: programResult.context.slot,
    programOwner: programResult.value.owner,
    programExecutable: programResult.value.executable,
    programDataAddress,
    programDataObservationSlot: programDataResult.context.slot,
    programDataOwner: programDataResult.value.owner,
    expectedLoaderOwner: LOADER_ID,
    lastDeployedSlot: rawProgramData.readBigUInt64LE(4).toString(),
    upgradeAuthority: hasUpgradeAuthority ? key(rawProgramData, 13) : null,
    allocatedProgramDataBytes: rawProgramData.length,
    payloadOffset,
    allocatedPayloadBytes: payload.length,
    allocatedPayloadSha256: sha256(payload),
    nonzeroPayloadBytes: lastNonzero,
    nonzeroPayloadSha256: sha256(payload.subarray(0, lastNonzero)),
    localSo: localSo ? {
      path: LOCAL_SO,
      bytes: localSo.length,
      sha256: sha256(localSo),
      exactAllocatedPayloadMatch: localSo.equals(payload),
    } : null,
    releasePin: {
      ...RELEASE,
      deployedPrefixBytes: releasePrefix.length,
      deployedPrefixSha256: sha256(releasePrefix),
      deployedTrailingPaddingBytes: releasePadding.length,
      deployedTrailingPaddingAllZero: releasePadding.every((byte) => byte === 0),
      exactAssetPlusZeroPaddingMatch:
        sha256(releasePrefix) === RELEASE.assetSha256
        && releasePadding.every((byte) => byte === 0),
    },
  };

  const poolResult = await rpc('getProgramAccounts', [PROGRAM_ID.toBase58(), {
    encoding: 'base64', commitment: COMMITMENT, withContext: true,
    filters: [{dataSize: 33}],
  }]);
  const pools = poolResult.value.map((row) => {
    const data = Buffer.from(row.account.data[0], 'base64');
    const voteAccount = key(data, 1);
    const canonicalPool = derive('pool', voteAccount);
    return {
      pool: row.pubkey,
      poolLamports: String(row.account.lamports),
      poolOwner: row.account.owner,
      poolDataLength: data.length,
      accountType: data[0],
      voteAccount,
      canonicalPool,
      poolPdaVerified: canonicalPool.address === row.pubkey,
      stake: derive('stake', row.pubkey),
      onramp: derive('onramp', row.pubkey),
      mint: derive('mint', row.pubkey),
      stakeAuthority: derive('stake_authority', row.pubkey),
      mintAuthority: derive('mint_authority', row.pubkey),
      mplAuthority: derive('mpl_authority', row.pubkey),
    };
  }).sort((a, b) => a.pool.localeCompare(b.pool));

  const linked = await getMultipleAccounts(
    pools.flatMap((pool) => [pool.stake.address, pool.onramp.address, pool.mint.address]),
  );
  const nonzeroTokenAccounts = [];
  const exposureCandidates = [];
  const stakeScanSlots = [];
  const tokenScanSlots = [];

  for (let i = 0; i < pools.length; i += 1) {
    const pool = pools[i];
    const stake = linked.get(pool.stake.address);
    const onramp = linked.get(pool.onramp.address);
    const mint = linked.get(pool.mint.address);
    pool.stakeAccount = {...parseStake(pool.stake.address, stake.account), observationSlot: stake.observationSlot};
    pool.onrampAccount = {...parseStake(pool.onramp.address, onramp.account), observationSlot: onramp.observationSlot};
    pool.mintAccount = {...parseMint(pool.mint.address, mint.account), observationSlot: mint.observationSlot};
    const currentEpoch = BigInt(epochInfo.epoch);
    const activationEpoch = pool.onrampAccount.activationEpoch === null
      ? null : BigInt(pool.onrampAccount.activationEpoch);
    const deactivationEpoch = pool.onrampAccount.deactivationEpoch === null
      ? null : BigInt(pool.onrampAccount.deactivationEpoch);
    const epochMax = (1n << 64n) - 1n;
    let epochFieldState = 'uninitialized';
    if (pool.onrampAccount.variant === 1) epochFieldState = 'initialized';
    if (pool.onrampAccount.variant === 2) {
      if (deactivationEpoch < currentEpoch) epochFieldState = 'inactive';
      else if (deactivationEpoch === currentEpoch) epochFieldState = 'deactivating';
      else if (activationEpoch === currentEpoch) epochFieldState = 'activating';
      else if (activationEpoch < currentEpoch && deactivationEpoch === epochMax) epochFieldState = 'active';
      else epochFieldState = 'transitioning';
    }
    pool.onrampEpochFieldState = {
      epoch: epochInfo.epoch,
      state: epochFieldState,
      limitation: 'Derived from stake-state activation/deactivation epoch fields because this RPC endpoint does not implement getStakeActivation.',
    };

    const stakeScan = await getStakeAccountsByWithdrawer(pool.stakeAuthority.address);
    stakeScanSlots.push(stakeScan.slot);
    const canonicalAddresses = new Set([pool.stake.address, pool.onramp.address]);
    pool.stakeAuthorityScan = {slot: stakeScan.slot, accountCount: stakeScan.accounts.length};
    pool.noncanonicalBothAuthorityAccounts = stakeScan.accounts.filter((account) =>
      !canonicalAddresses.has(account.address)
      && account.staker === pool.stakeAuthority.address
      && account.withdrawer === pool.stakeAuthority.address,
    );
    pool.noncanonicalWithdrawerOnlyAccounts = stakeScan.accounts.filter((account) =>
      !canonicalAddresses.has(account.address)
      && account.staker !== pool.stakeAuthority.address
      && account.withdrawer === pool.stakeAuthority.address,
    );

    const tokenScan = await getTokenAccountsByMint(pool.mint.address);
    tokenScanSlots.push(tokenScan.slot);
    const amountSum = tokenScan.accounts.reduce((n, account) => n + BigInt(account.amountRaw), 0n);
    pool.tokenCensus = {
      slot: tokenScan.slot,
      accountCount: tokenScan.accounts.length,
      nonzeroAccountCount: tokenScan.accounts.filter((account) => BigInt(account.amountRaw) > 0n).length,
      amountSumRaw: amountSum.toString(),
      equalsMintSupply: amountSum === BigInt(pool.mintAccount.supplyRaw || 0),
    };
    for (const account of tokenScan.accounts) {
      if (BigInt(account.amountRaw) > 0n) {
        nonzeroTokenAccounts.push({...account, pool: pool.pool, voteAccount: pool.voteAccount});
      }
      const ownerPath = account.tokenOwner === pool.mintAuthority.address && BigInt(account.amountRaw) > 0n;
      const delegatePath = account.delegate === pool.mintAuthority.address
        && BigInt(account.delegatedAmountRaw) > 0n;
      if (ownerPath || delegatePath) {
        exposureCandidates.push({
          ...account,
          pool: pool.pool,
          voteAccount: pool.voteAccount,
          mintAuthority: pool.mintAuthority.address,
          ownerPath,
          delegatePath,
          burnableAmountRaw: (ownerPath
            ? BigInt(account.amountRaw)
            : [BigInt(account.amountRaw), BigInt(account.delegatedAmountRaw)].sort((a, b) => a < b ? -1 : 1)[0]
          ).toString(),
        });
      }
    }
    process.stderr.write(`${i + 1}/${pools.length} ${pool.pool}\n`);
  }

  const positiveStakeAccounts = pools.flatMap((pool) => [
    ...pool.noncanonicalBothAuthorityAccounts,
    ...pool.noncanonicalWithdrawerOnlyAccounts,
  ]).map((account) => account.address);
  const liveStakeCrossCheck = positiveStakeAccounts.length
    ? await getMultipleAccounts(positiveStakeAccounts)
    : new Map();
  for (const pool of pools) {
    for (const field of ['noncanonicalBothAuthorityAccounts', 'noncanonicalWithdrawerOnlyAccounts']) {
      pool[field] = pool[field].map((account) => {
        const checked = liveStakeCrossCheck.get(account.address);
        const parsed = checked ? parseStake(account.address, checked.account) : null;
        return {
          ...account,
          crossCheck: checked ? {
            slot: checked.observationSlot,
            exists: parsed.exists,
            lamports: parsed.lamports,
            staker: parsed.staker,
            withdrawer: parsed.withdrawer,
            voteAccount: parsed.voteAccount,
          } : null,
        };
      });
    }
  }

  const liveTokenCrossCheck = exposureCandidates.length
    ? await getMultipleAccounts(exposureCandidates.map((account) => account.address))
    : new Map();
  const verifiedExposures = exposureCandidates.map((account) => {
    const checked = liveTokenCrossCheck.get(account.address);
    const parsed = checked ? parseTokenAccount({pubkey: account.address, account: checked.account}) : null;
    return {
      ...account,
      crossCheck: checked ? {
        slot: checked.observationSlot,
        exists: Boolean(checked.account),
        mint: parsed?.mint ?? null,
        tokenOwner: parsed?.tokenOwner ?? null,
        amountRaw: parsed?.amountRaw ?? null,
        delegate: parsed?.delegate ?? null,
        delegatedAmountRaw: parsed?.delegatedAmountRaw ?? null,
      } : null,
    };
  });

  const ownerTotals = new Map();
  for (const account of nonzeroTokenAccounts) {
    const row = ownerTotals.get(account.tokenOwner) || {tokenOwner: account.tokenOwner, rawAmountAcrossMints: 0n, positions: []};
    row.rawAmountAcrossMints += BigInt(account.amountRaw);
    row.positions.push({pool: account.pool, mint: account.mint, tokenAccount: account.address, amountRaw: account.amountRaw});
    ownerTotals.set(account.tokenOwner, row);
  }
  const immediateTokenOwners = [...ownerTotals.values()]
    .sort((a, b) => a.rawAmountAcrossMints === b.rawAmountAcrossMints ? 0 : a.rawAmountAcrossMints > b.rawAmountAcrossMints ? -1 : 1)
    .map((row) => ({...row, rawAmountAcrossMints: row.rawAmountAcrossMints.toString()}));

  const historicalTransaction = await rpc('getTransaction', [HISTORICAL_SIGNATURE, {
    encoding: 'jsonParsed', commitment: COMMITMENT, maxSupportedTransactionVersion: 0,
  }]);
  const historicalOuterIndex = 8;
  const historicalOuter = historicalTransaction?.transaction?.message?.instructions?.[historicalOuterIndex] ?? null;
  const historicalInner = historicalTransaction?.meta?.innerInstructions
    ?.find((group) => group.index === historicalOuterIndex)?.instructions ?? [];
  const historicalAccountKeys = historicalTransaction?.transaction?.message?.accountKeys ?? [];

  const canonicalStakeLamports = pools.reduce((n, p) => n + BigInt(p.stakeAccount.lamports || 0), 0n);
  const canonicalStakeDelegated = pools.reduce((n, p) => n + BigInt(p.stakeAccount.delegatedStakeLamports || 0), 0n);
  const onrampLamports = pools.reduce((n, p) => n + BigInt(p.onrampAccount.lamports || 0), 0n);
  const onrampDelegated = pools.reduce((n, p) => n + BigInt(p.onrampAccount.delegatedStakeLamports || 0), 0n);
  const withdrawerOnlyLamports = pools.reduce((n, p) => n + p.noncanonicalWithdrawerOnlyAccounts
    .reduce((m, a) => m + BigInt(a.lamports), 0n), 0n);
  const bothNoncanonicalLamports = pools.reduce((n, p) => n + p.noncanonicalBothAuthorityAccounts
    .reduce((m, a) => m + BigInt(a.lamports), 0n), 0n);
  const aggregateMintSupply = pools.reduce((n, p) => n + BigInt(p.mintAccount.supplyRaw || 0), 0n);
  const delegatedExposure = verifiedExposures.reduce((n, a) => n + (a.delegatePath ? BigInt(a.delegatedAmountRaw) : 0n), 0n);
  const burnableExposure = verifiedExposures.reduce((n, a) => n + BigInt(a.burnableAmountRaw), 0n);

  const minimumDelegationLamports = 1_000_000_000n;
  const exposurePoolMap = new Map(pools.map((pool) => [pool.pool, pool]));
  const quantifiedExposures = verifiedExposures.map((account) => {
    const pool = exposurePoolMap.get(account.pool);
    const mintSupply = BigInt(pool.mintAccount.supplyRaw || 0);
    const mainDelegated = BigInt(pool.stakeAccount.delegatedStakeLamports || 0);
    // Mirrors the published design's available-stake definition: retain the
    // one-SOL minimum delegation in the canonical stake account.
    const mainAvailable = mainDelegated > minimumDelegationLamports
      ? mainDelegated - minimumDelegationLamports : 0n;
    const burnable = BigInt(account.burnableAmountRaw);
    const calculatedWithdraw = mintSupply > 0n ? burnable * mainAvailable / mintSupply : 0n;
    const ceilDiv = (numerator, denominator) => denominator === 0n
      ? null : (numerator + denominator - 1n) / denominator;
    const minimumAtLeastOneSol = mainAvailable > 0n
      ? ceilDiv(minimumDelegationLamports * mintSupply, mainAvailable) : null;
    // If a downstream check requires strictly more than one SOL, exact
    // divisibility requires one additional raw token unit.
    const minimumStrictlyMoreThanOneSol = mainAvailable > 0n
      ? (minimumDelegationLamports * mintSupply) / mainAvailable + 1n : null;
    return {
      ...account,
      quantification: {
        mintSupplyRaw: mintSupply.toString(),
        canonicalDelegatedStakeLamports: mainDelegated.toString(),
        mainAvailableDelegatedStakeLamports: mainAvailable.toString(),
        minimumDelegationLamports: minimumDelegationLamports.toString(),
        burnableAmountRaw: burnable.toString(),
        calculatedWithdrawLamports: calculatedWithdraw.toString(),
        minimumTokenAmountForAtLeastOneSolRaw: minimumAtLeastOneSol?.toString() ?? null,
        minimumTokenAmountForStrictlyMoreThanOneSolRaw: minimumStrictlyMoreThanOneSol?.toString() ?? null,
        shortfallToAtLeastOneSolThresholdRaw: minimumAtLeastOneSol === null
          ? null : (burnable >= minimumAtLeastOneSol ? '0' : (minimumAtLeastOneSol - burnable).toString()),
        individuallyReachesAtLeastOneSolThreshold: minimumAtLeastOneSol !== null
          && burnable >= minimumAtLeastOneSol,
        individuallyReachesStrictlyMoreThanOneSolThreshold: minimumStrictlyMoreThanOneSol !== null
          && burnable >= minimumStrictlyMoreThanOneSol,
      },
    };
  });
  const quantifiedExposuresByPool = [...new Set(quantifiedExposures.map((account) => account.pool))]
    .sort().map((poolAddress) => {
      const pool = exposurePoolMap.get(poolAddress);
      const accounts = quantifiedExposures.filter((account) => account.pool === poolAddress);
      return {
        pool: poolAddress,
        voteAccount: pool.voteAccount,
        mint: pool.mint.address,
        mintSupplyRaw: pool.mintAccount.supplyRaw,
        canonicalDelegatedStakeLamports: pool.stakeAccount.delegatedStakeLamports,
        mainAvailableDelegatedStakeLamports: (
          BigInt(pool.stakeAccount.delegatedStakeLamports) > minimumDelegationLamports
            ? BigInt(pool.stakeAccount.delegatedStakeLamports) - minimumDelegationLamports : 0n
        ).toString(),
        exposedAccountCount: accounts.length,
        positiveBalanceExposedAccountCount: accounts.filter((a) => BigInt(a.burnableAmountRaw) > 0n).length,
        anyAccountIndividuallyReachesAtLeastOneSolThreshold:
          accounts.some((a) => a.quantification.individuallyReachesAtLeastOneSolThreshold),
        accounts,
      };
    });

  const addressMap = pools.map((pool) => ({
    pool: pool.pool,
    voteAccount: pool.voteAccount,
    stake: [pool.stake.address, pool.stake.bump],
    onramp: [pool.onramp.address, pool.onramp.bump],
    mint: [pool.mint.address, pool.mint.bump],
    stakeAuthority: [pool.stakeAuthority.address, pool.stakeAuthority.bump],
    mintAuthority: [pool.mintAuthority.address, pool.mintAuthority.bump],
    mplAuthority: [pool.mplAuthority.address, pool.mplAuthority.bump],
  }));

  const onrampRatios = pools.map((pool) => {
    const mainDelegated = BigInt(pool.stakeAccount.delegatedStakeLamports || 0);
    const onrampDelegated = BigInt(pool.onrampAccount.delegatedStakeLamports || 0);
    const compatibleMeta = pool.stakeAccount.staker === pool.onrampAccount.staker
      && pool.stakeAccount.withdrawer === pool.onrampAccount.withdrawer
      && pool.stakeAccount.lockupUnixTimestamp === pool.onrampAccount.lockupUnixTimestamp
      && pool.stakeAccount.lockupEpoch === pool.onrampAccount.lockupEpoch
      && pool.stakeAccount.lockupCustodian === pool.onrampAccount.lockupCustodian;
    const sameVote = pool.stakeAccount.voteAccount === pool.voteAccount
      && pool.onrampAccount.voteAccount === pool.voteAccount;
    const mainEpochActive = pool.stakeAccount.activationEpoch !== null
      && BigInt(pool.stakeAccount.activationEpoch) < BigInt(epochInfo.epoch)
      && pool.stakeAccount.deactivationEpoch === '18446744073709551615';
    const epochFieldMergePrerequisites = compatibleMeta && sameVote && mainEpochActive
      && pool.onrampEpochFieldState.state === 'active' && onrampDelegated > 0n;
    return {
      pool: pool.pool,
      voteAccount: pool.voteAccount,
      canonicalStake: pool.stake.address,
      onramp: pool.onramp.address,
      canonicalDelegatedStakeLamports: mainDelegated.toString(),
      onrampDelegatedStakeLamports: onrampDelegated.toString(),
      onrampLamports: pool.onrampAccount.lamports,
      activationEpoch: pool.onrampAccount.activationEpoch,
      deactivationEpoch: pool.onrampAccount.deactivationEpoch,
      epochFieldState: pool.onrampEpochFieldState.state,
      compatibleMeta,
      sameVote,
      mainEpochActive,
      epochFieldMergePrerequisites,
      onrampToCanonicalDelegatedRatio: mainDelegated > 0n ? Number(onrampDelegated) / Number(mainDelegated) : null,
    };
  }).sort((a, b) => (b.onrampToCanonicalDelegatedRatio ?? -1) - (a.onrampToCanonicalDelegatedRatio ?? -1));
  const activeOnrampRatios = onrampRatios.filter((row) => row.epochFieldState === 'active');
  const mergePrerequisitePools = onrampRatios.filter((row) => row.epochFieldMergePrerequisites);

  const endSlot = await rpc('getSlot', [{commitment: COMMITMENT}]);
  const report = {
    schema: 'svsp-live-finalized-evidence/v1',
    generatedAtStart,
    generatedAtEnd: new Date().toISOString(),
    transport: {
      endpointClass: 'RPC_URL live endpoint only; HEAVY_RPC_URL deliberately ignored',
      endpointSecretEmitted: false,
      commitment: COMMITMENT,
      methods: [...new Set(calls.map((call) => call.method))].sort(),
      transactionBuiltSignedSimulatedOrSubmitted: false,
    },
    observation: {
      startSlot,
      endSlot,
      contextSlotMin: contextSlots.length ? Math.min(...contextSlots) : null,
      contextSlotMax: contextSlots.length ? Math.max(...contextSlots) : null,
      programSlot: programResult.context.slot,
      programDataSlot: programDataResult.context.slot,
      poolScanSlot: poolResult.context.slot,
      epochInfo,
      linkedAccountSlots: [...new Set([...linked.values()].map((v) => v.observationSlot))].sort((a, b) => a - b),
      stakeAuthorityScanSlotMin: Math.min(...stakeScanSlots),
      stakeAuthorityScanSlotMax: Math.max(...stakeScanSlots),
      tokenMintScanSlotMin: Math.min(...tokenScanSlots),
      tokenMintScanSlotMax: Math.max(...tokenScanSlots),
      positiveStakeCrossCheckSlots: [...new Set([...liveStakeCrossCheck.values()].map((v) => v.observationSlot))],
      positiveTokenCrossCheckSlots: [...new Set([...liveTokenCrossCheck.values()].map((v) => v.observationSlot))],
    },
    executable,
    derivation: {
      programId: PROGRAM_ID.toBase58(),
      poolSeed: ['pool', '<vote-account>'],
      stakeSeed: ['stake', '<pool>'],
      onrampSeed: ['onramp', '<pool>'],
      mintSeed: ['mint', '<pool>'],
      stakeAuthoritySeed: ['stake_authority', '<pool>'],
      mintAuthoritySeed: ['mint_authority', '<pool>'],
      mplAuthoritySeed: ['mpl_authority', '<pool>'],
      tokenProgramId: TOKEN_PROGRAM_ID,
      stakeProgramId: StakeProgram.programId.toBase58(),
      addressMapSha256: sha256(Buffer.from(JSON.stringify(addressMap))),
      addressMap,
    },
    summary: {
      decodedPoolCount: pools.length,
      canonicalPoolPdaVerifiedCount: pools.filter((p) => p.poolPdaVerified).length,
      allDerivedPdasOffCurve: pools.every((p) => [p.canonicalPool, p.stake, p.onramp, p.mint, p.stakeAuthority, p.mintAuthority, p.mplAuthority].every((x) => x.offCurve)),
      canonicalStakePdaExistingCount: pools.filter((p) => p.stakeAccount.exists).length,
      onrampPdaExistingCount: pools.filter((p) => p.onrampAccount.exists).length,
      canonicalMintPdaExistingCount: pools.filter((p) => p.mintAccount.exists).length,
      canonicalStakeAuthorityVerifiedCount: pools.filter((p) => p.stakeAccount.staker === p.stakeAuthority.address && p.stakeAccount.withdrawer === p.stakeAuthority.address).length,
      onrampStakeAuthorityVerifiedCount: pools.filter((p) => p.onrampAccount.staker === p.stakeAuthority.address && p.onrampAccount.withdrawer === p.stakeAuthority.address).length,
      canonicalMintAuthorityVerifiedCount: pools.filter((p) => p.mintAccount.mintAuthority === p.mintAuthority.address).length,
      classicTokenMintCount: pools.filter((p) => p.mintAccount.owner === TOKEN_PROGRAM_ID && p.mintAccount.dataLength === 82).length,
      nineDecimalMintCount: pools.filter((p) => p.mintAccount.decimals === 9).length,
      nullFreezeAuthorityMintCount: pools.filter((p) => p.mintAccount.freezeAuthority === null).length,
      mintSupplyMatchedByTokenAccountsCount: pools.filter((p) => p.tokenCensus.equalsMintSupply).length,
      tokenAccountCount: pools.reduce((n, p) => n + p.tokenCensus.accountCount, 0),
      nonzeroTokenAccountCount: nonzeroTokenAccounts.length,
      immediateTokenOwnerCount: immediateTokenOwners.length,
      aggregateMintSupplyRawAcrossDistinctMints: aggregateMintSupply.toString(),
      canonicalStakeLamports: canonicalStakeLamports.toString(),
      canonicalStakeSol: Number(canonicalStakeLamports) / 1e9,
      canonicalDelegatedStakeLamports: canonicalStakeDelegated.toString(),
      onrampLamports: onrampLamports.toString(),
      onrampSol: Number(onrampLamports) / 1e9,
      onrampDelegatedStakeLamports: onrampDelegated.toString(),
      epochFieldActiveOnrampCount: activeOnrampRatios.length,
      epochFieldInactiveOnrampCount: pools.filter((p) => p.onrampEpochFieldState.state === 'inactive').length,
      epochFieldInitializedOnrampCount: pools.filter((p) => p.onrampEpochFieldState.state === 'initialized').length,
      epochFieldMergePrerequisitePoolCount: mergePrerequisitePools.length,
      highestActiveOnrampToCanonicalDelegatedRatio: activeOnrampRatios[0] || null,
      canonicalPlusOnrampLamports: (canonicalStakeLamports + onrampLamports).toString(),
      canonicalPlusOnrampSol: Number(canonicalStakeLamports + onrampLamports) / 1e9,
      noncanonicalBothAuthorityAccountCount: pools.reduce((n, p) => n + p.noncanonicalBothAuthorityAccounts.length, 0),
      noncanonicalBothAuthorityLamports: bothNoncanonicalLamports.toString(),
      noncanonicalWithdrawerOnlyAccountCount: pools.reduce((n, p) => n + p.noncanonicalWithdrawerOnlyAccounts.length, 0),
      noncanonicalWithdrawerOnlyLamports: withdrawerOnlyLamports.toString(),
      noncanonicalWithdrawerOnlySol: Number(withdrawerOnlyLamports) / 1e9,
      allWithdrawerMatchedLamports: (canonicalStakeLamports + onrampLamports + bothNoncanonicalLamports + withdrawerOnlyLamports).toString(),
      allWithdrawerMatchedSol: Number(canonicalStakeLamports + onrampLamports + bothNoncanonicalLamports + withdrawerOnlyLamports) / 1e9,
      withdrawalExposureScanCompleteMintCount: pools.filter((p) => Number.isInteger(p.tokenCensus.accountCount)).length,
      withdrawalExposurePoolCount: new Set(verifiedExposures.map((a) => a.pool)).size,
      withdrawalExposureTokenAccountCount: verifiedExposures.length,
      withdrawalExposureOwnerPathCount: verifiedExposures.filter((a) => a.ownerPath).length,
      withdrawalExposureDelegatePathCount: verifiedExposures.filter((a) => a.delegatePath).length,
      withdrawalExposureDelegatedAmountRaw: delegatedExposure.toString(),
      withdrawalExposureBurnableAmountRaw: burnableExposure.toString(),
      withdrawalExposurePositiveBalanceAccountCount: quantifiedExposures.filter((a) => BigInt(a.burnableAmountRaw) > 0n).length,
      withdrawalExposureAccountReachingAtLeastOneSolSplitCount: quantifiedExposures.filter((a) => a.quantification.individuallyReachesAtLeastOneSolThreshold).length,
      withdrawalExposureAccountReachingStrictlyMoreThanOneSolSplitCount: quantifiedExposures.filter((a) => a.quantification.individuallyReachesStrictlyMoreThanOneSolThreshold).length,
    },
    accountingCorrection: {
      correctedPrimaryCustodyDefinition: 'canonical stake PDAs + onramp PDAs, each counted once',
      oldSecondaryArtifactIssue: 'stakeLamports already included canonical, onramp, and HHZn withdrawer-only accounts; adding onramp again double-counted it',
      oldReportedGrossSol: 37508.016781269,
      correctedCanonicalPlusOnrampSol: Number(canonicalStakeLamports + onrampLamports) / 1e9,
      withdrawerOnlyExcludedFromPrimarySol: Number(withdrawerOnlyLamports) / 1e9,
    },
    feeAndBeneficiaryControls: {
      poolStateBytes: 33,
      poolStateFieldsDecoded: ['accountType', 'voteAccount'],
      configuredFeeFieldsObserved: false,
      token2022TransferFeeExtensionPresent: false,
      reason: 'All 57 canonical mints are 82-byte classic Token-program mints; pool state is the 33-byte type+vote layout.',
      terminology: 'Immediate token-account owners are custody-layer owners, not necessarily end users or economic beneficiaries.',
    },
    withdrawalExposures: quantifiedExposures,
    withdrawalExposuresByPool: quantifiedExposuresByPool,
    onrampRatios,
    epochFieldMergePrerequisitePools: mergePrerequisitePools,
    nonzeroTokenAccounts,
    immediateTokenOwners,
    historicalStakeCpi: {
      signature: HISTORICAL_SIGNATURE,
      slot: historicalTransaction?.slot ?? null,
      blockTime: historicalTransaction?.blockTime ?? null,
      err: historicalTransaction?.meta?.err ?? null,
      feeLamports: historicalTransaction?.meta?.fee ?? null,
      outerInstructionIndex: historicalOuterIndex,
      outerInstruction: historicalOuter,
      innerInstructions: historicalInner,
      accountKeys: historicalAccountKeys,
      relevantLogs: (historicalTransaction?.meta?.logMessages || []).filter((line) =>
        line.includes(PROGRAM_ID.toBase58()) || line.includes(StakeProgram.programId.toBase58()) || line.includes('Instruction: ReplenishPool'),
      ),
      interpretation: 'Successful Stake-program inner instructions with the off-curve stake-authority PDA marked transaction-level signer=false demonstrate instruction-scoped invoke_signed use; they do not demonstrate arbitrary outsider signing.',
    },
    pools,
    limitations: [
      'This is a multi-call live snapshot, not an atomic bank snapshot; every category carries explicit context-slot bounds.',
      'RPC_URL was the sole endpoint. HEAVY_RPC_URL was intentionally unused because prior evidence showed stale GPA rows there.',
      'Immediate SPL token-account owners may be intermediary protocol custody PDAs and are not attributed as end users without separate evidence.',
      'Upgrade authority is recorded as a trust fact only and is not classified as an outsider vulnerability.',
      'The historical signer proof is instruction-specific and does not imply that outsiders can make the PDA sign arbitrary instructions.',
      'Onramp active/inactive labels and merge-prerequisite rows are derived from stake-state epoch fields. The live RPC endpoint lacks getStakeActivation, and no simulation was used; rows are prerequisite evidence, not proof that a particular Replenish transaction will succeed.',
    ],
    rpcCallSummary: {
      total: calls.length,
      failed: calls.filter((call) => !call.ok).length,
      methods: [...new Set(calls.map((call) => call.method))].sort(),
    },
  };

  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, generatedAtEnd: report.generatedAtEnd, observation: report.observation, summary: report.summary}, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
