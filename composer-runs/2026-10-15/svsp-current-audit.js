#!/usr/bin/env node
'use strict';

// Read-only current-mainnet census for SPL Single-Validator Stake Pool.
// RPC methods are limited to account and slot reads; this script never builds,
// signs, simulates, or submits a transaction and never emits an RPC endpoint.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  PublicKey,
  StakeProgram,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const PROGRAM_ID = new PublicKey('SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE');
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const UPGRADEABLE_LOADER_ID = 'BPFLoaderUpgradeab1e11111111111111111111111';
const RELEASE_V4_0_1 = {
  tag: 'program@v4.0.1',
  commit: '3921ea5f63198b9a4f8d1ac9fcf24d5ca612a10a',
  publishedAt: '2026-03-19T11:41:50Z',
  assetName: 'spl_single_pool-v4.0.1.so',
  assetBytes: 234664,
  assetSha256: '217300596e04cf21d9e613fdac3cfefa5ada9456a36b9fc79303fac5fe192f8d',
  releaseUrl: 'https://github.com/solana-program/single-pool/releases/tag/program%40v4.0.1',
};
const DEFAULT_OUT = path.join(__dirname, 'svsp-current-audit.json');
const OUT = process.argv[2] || DEFAULT_OUT;
const ENV_FILES = ['/tmp/composer-helius-only.env', '/tmp/composer-helius-rpc.env'];
const envPath = ENV_FILES.find((candidate) => fs.existsSync(candidate));
const localEnv = envPath ? Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
) : {};
const RPC_URL = process.env.RPC_URL || localEnv.RPC_URL;
const HEAVY_RPC_URL = process.env.HEAVY_RPC_URL || localEnv.HEAVY_RPC_URL || RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL is not configured');

let requestId = 0;
const slots = [];
const calls = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, endpoint = RPC_URL, retries = 5) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params}),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error(`${method}: HTTP ${response.status}: ${JSON.stringify(body.error || body).slice(0, 500)}`);
      }
      const slot = body.result?.context?.slot ?? null;
      if (slot !== null) slots.push(slot);
      calls.push({method, slot, ok: true});
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < retries) await sleep(500 * (2 ** attempt));
    }
  }
  calls.push({method, slot: null, ok: false, error: String(lastError?.message || lastError)});
  throw lastError;
}

function pda(prefix, base) {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(prefix), new PublicKey(base).toBuffer()],
    PROGRAM_ID,
  );
  return {address: address.toBase58(), bump};
}

function key(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
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
    const result = await rpc('getMultipleAccounts', [chunk, {encoding: 'base64', commitment: 'confirmed'}]);
    chunk.forEach((address, j) => out.set(address, {account: result.value[j], slot: result.context.slot}));
  }
  return out;
}

async function getStakeAccountsByWithdrawer(withdrawer) {
  const result = await rpc('getProgramAccounts', [StakeProgram.programId.toBase58(), {
    encoding: 'base64',
    commitment: 'confirmed',
    withContext: true,
    filters: [{dataSize: 200}, {memcmp: {offset: 44, bytes: withdrawer}}],
  }]);
  return {
    slot: result.context.slot,
    accounts: result.value.map((row) => parseStake(row.pubkey, row.account)),
  };
}

async function getTokenAccountsByMint(mint) {
  // Scanning directly on the delegate field can exceed provider result limits
  // even when a second memcmp should narrow it.  A pool mint has a small,
  // bounded account set, so enumerate that complete set and verify both Token
  // owner and active-delegate authority paths locally.
  const result = await rpc('getProgramAccounts', [TOKEN_PROGRAM_ID, {
    encoding: 'base64', commitment: 'confirmed', withContext: true,
    filters: [{dataSize: 165}, {memcmp: {offset: 0, bytes: mint}}],
  }], RPC_URL);
  return {
    slot: result.context.slot,
    accounts: result.value.map(parseTokenAccount),
  };
}

async function main() {
  const startSlot = await rpc('getSlot', [{commitment: 'confirmed'}]);

  const programResult = await rpc('getAccountInfo', [PROGRAM_ID.toBase58(), {
    encoding: 'base64', commitment: 'confirmed',
  }]);
  if (!programResult.value) throw new Error('program account does not exist');
  const programData = Buffer.from(programResult.value.data[0], 'base64');
  if (programData.readUInt32LE(0) !== 2) throw new Error('program is not UpgradeableLoader Program state');
  const programDataAddress = key(programData, 4);

  const programDataResult = await rpc('getAccountInfo', [programDataAddress, {
    encoding: 'base64', commitment: 'confirmed',
  }]);
  const rawProgramData = Buffer.from(programDataResult.value.data[0], 'base64');
  if (rawProgramData.readUInt32LE(0) !== 3) throw new Error('programdata account has wrong loader state');
  const lastDeployedSlot = rawProgramData.readBigUInt64LE(4).toString();
  const hasUpgradeAuthority = rawProgramData[12] === 1;
  const payloadOffset = hasUpgradeAuthority ? 45 : 13;
  const payload = rawProgramData.subarray(payloadOffset);
  const releasePrefix = payload.subarray(0, RELEASE_V4_0_1.assetBytes);
  const releasePadding = payload.subarray(RELEASE_V4_0_1.assetBytes);
  const releasePrefixSha256 = crypto.createHash('sha256').update(releasePrefix).digest('hex');
  const executable = {
    programId: PROGRAM_ID.toBase58(),
    programObservationSlot: programResult.context.slot,
    programOwner: programResult.value.owner,
    programExecutable: programResult.value.executable,
    programDataAddress,
    programDataObservationSlot: programDataResult.context.slot,
    programDataOwner: programDataResult.value.owner,
    expectedLoaderOwner: UPGRADEABLE_LOADER_ID,
    lastDeployedSlot,
    upgradeAuthority: hasUpgradeAuthority ? key(rawProgramData, 13) : null,
    allocatedProgramDataBytes: rawProgramData.length,
    payloadBytes: payload.length,
    payloadSha256: crypto.createHash('sha256').update(payload).digest('hex'),
    releasePin: {
      ...RELEASE_V4_0_1,
      deployedPayloadPrefixBytes: releasePrefix.length,
      deployedPayloadPrefixSha256: releasePrefixSha256,
      deployedTrailingPaddingBytes: releasePadding.length,
      deployedTrailingPaddingAllZero: releasePadding.every((byte) => byte === 0),
      exactReleaseAssetMatch:
        releasePrefixSha256 === RELEASE_V4_0_1.assetSha256
        && releasePadding.every((byte) => byte === 0),
    },
  };

  const poolResult = await rpc('getProgramAccounts', [PROGRAM_ID.toBase58(), {
    encoding: 'base64', commitment: 'confirmed', withContext: true,
    filters: [{dataSize: 33}],
  }]);
  const pools = poolResult.value.map((row) => {
    const data = Buffer.from(row.account.data[0], 'base64');
    const voteAccount = key(data, 1);
    const canonicalPool = pda('pool', voteAccount);
    return {
      pool: row.pubkey,
      poolLamports: String(row.account.lamports),
      poolOwner: row.account.owner,
      accountType: data[0],
      voteAccount,
      canonicalPool,
      poolPdaVerified: canonicalPool.address === row.pubkey,
      stake: pda('stake', row.pubkey),
      onramp: pda('onramp', row.pubkey),
      mint: pda('mint', row.pubkey),
      stakeAuthority: pda('stake_authority', row.pubkey),
      mintAuthority: pda('mint_authority', row.pubkey),
      mplAuthority: pda('mpl_authority', row.pubkey),
    };
  });

  const linkedAddresses = pools.flatMap((pool) => [pool.stake.address, pool.onramp.address, pool.mint.address]);
  const linked = await getMultipleAccounts(linkedAddresses);

  for (let i = 0; i < pools.length; i += 1) {
    const pool = pools[i];
    const stakeResult = linked.get(pool.stake.address);
    const onrampResult = linked.get(pool.onramp.address);
    const mintResult = linked.get(pool.mint.address);
    pool.stakeAccount = {...parseStake(pool.stake.address, stakeResult.account), observationSlot: stakeResult.slot};
    pool.onrampAccount = {...parseStake(pool.onramp.address, onrampResult.account), observationSlot: onrampResult.slot};
    pool.mintAccount = {...parseMint(pool.mint.address, mintResult.account), observationSlot: mintResult.slot};

    try {
      const stakeAuthorityAccounts = await getStakeAccountsByWithdrawer(pool.stakeAuthority.address);
      pool.stakeAuthorityScan = stakeAuthorityAccounts;
      const canonicalAddresses = new Set([pool.stake.address, pool.onramp.address]);
      pool.noncanonicalStakeAuthorityAccounts = stakeAuthorityAccounts.accounts.filter((account) =>
        !canonicalAddresses.has(account.address)
        && account.staker === pool.stakeAuthority.address
        && account.withdrawer === pool.stakeAuthority.address,
      );
      pool.noncanonicalWithdrawerOnlyAccounts = stakeAuthorityAccounts.accounts.filter((account) =>
        !canonicalAddresses.has(account.address)
        && account.staker !== pool.stakeAuthority.address
        && account.withdrawer === pool.stakeAuthority.address,
      );
    } catch (error) {
      pool.stakeAuthorityScan = {slot: null, accounts: null, error: String(error.message || error)};
      pool.noncanonicalStakeAuthorityAccounts = null;
    }

    try {
      const delegateAccounts = await getTokenAccountsByMint(pool.mint.address);
      pool.mintAuthorityDelegateScan = delegateAccounts;
      pool.withdrawalExposedTokenAccounts = delegateAccounts.accounts.filter((account) =>
        account.mint === pool.mint.address
        && (
          (account.tokenOwner === pool.mintAuthority.address && BigInt(account.amountRaw) > 0n)
          || (
            account.delegate === pool.mintAuthority.address
            && BigInt(account.delegatedAmountRaw) > 0n
          )
        ),
      );
    } catch (error) {
      pool.mintAuthorityDelegateScan = {slot: null, accounts: null, error: String(error.message || error)};
      pool.withdrawalExposedTokenAccounts = null;
    }
    process.stderr.write(`${i + 1}/${pools.length} ${pool.pool}\n`);
    await sleep(50);
  }

  pools.sort((a, b) => {
    const av = BigInt(a.stakeAccount.lamports || 0) + BigInt(a.onrampAccount.lamports || 0);
    const bv = BigInt(b.stakeAccount.lamports || 0) + BigInt(b.onrampAccount.lamports || 0);
    return av === bv ? 0 : av > bv ? -1 : 1;
  });

  const sums = pools.reduce((acc, pool) => {
    acc.canonicalStakeLamports += BigInt(pool.stakeAccount.lamports || 0);
    acc.canonicalDelegatedStakeLamports += BigInt(pool.stakeAccount.delegatedStakeLamports || 0);
    acc.onrampLamports += BigInt(pool.onrampAccount.lamports || 0);
    acc.onrampDelegatedStakeLamports += BigInt(pool.onrampAccount.delegatedStakeLamports || 0);
    acc.mintSupplyRaw += BigInt(pool.mintAccount.supplyRaw || 0);
    return acc;
  }, {
    canonicalStakeLamports: 0n,
    canonicalDelegatedStakeLamports: 0n,
    onrampLamports: 0n,
    onrampDelegatedStakeLamports: 0n,
    mintSupplyRaw: 0n,
  });

  const endSlot = await rpc('getSlot', [{commitment: 'confirmed'}]);
  const report = {
    generatedAt: new Date().toISOString(),
    transport: 'read-only getSlot/getAccountInfo/getMultipleAccounts/getProgramAccounts; no transaction built, simulated, or submitted',
    commitment: 'confirmed',
    contextSlotMin: slots.length ? Math.min(...slots) : null,
    contextSlotMax: slots.length ? Math.max(...slots) : null,
    startSlot,
    endSlot,
    executable,
    design: {
      programId: PROGRAM_ID.toBase58(),
      poolSeed: ['pool', '<vote account>'],
      stakeSeed: ['stake', '<pool>'],
      onrampSeed: ['onramp', '<pool>'],
      mintSeed: ['mint', '<pool>'],
      stakeAuthoritySeed: ['stake_authority', '<pool>'],
      mintAuthoritySeed: ['mint_authority', '<pool>'],
      mplAuthoritySeed: ['mpl_authority', '<pool>'],
      tokenProgramId: TOKEN_PROGRAM_ID,
      stakeProgramId: StakeProgram.programId.toBase58(),
    },
    summary: {
      decodedPoolCount: pools.length,
      canonicalPoolPdaVerifiedCount: pools.filter((pool) => pool.poolPdaVerified).length,
      canonicalStakePdaExistingCount: pools.filter((pool) => pool.stakeAccount.exists).length,
      onrampPdaExistingCount: pools.filter((pool) => pool.onrampAccount.exists).length,
      canonicalMintPdaExistingCount: pools.filter((pool) => pool.mintAccount.exists).length,
      canonicalMintAuthorityVerifiedCount: pools.filter((pool) =>
        pool.mintAccount.mintAuthority === pool.mintAuthority.address,
      ).length,
      canonicalMintFreezeAuthorityNullCount: pools.filter((pool) => !pool.mintAccount.freezeAuthority).length,
      canonicalStakeAuthorityVerifiedCount: pools.filter((pool) =>
        pool.stakeAccount.staker === pool.stakeAuthority.address
        && pool.stakeAccount.withdrawer === pool.stakeAuthority.address,
      ).length,
      onrampStakeAuthorityVerifiedCount: pools.filter((pool) =>
        pool.onrampAccount.staker === pool.stakeAuthority.address
        && pool.onrampAccount.withdrawer === pool.stakeAuthority.address,
      ).length,
      stakeAuthorityScanCompleteCount: pools.filter((pool) => Array.isArray(pool.stakeAuthorityScan.accounts)).length,
      mintDelegateScanCompleteCount: pools.filter((pool) => Array.isArray(pool.mintAuthorityDelegateScan.accounts)).length,
      poolsWithNoncanonicalStakeAuthorityAccounts: pools.filter((pool) =>
        Array.isArray(pool.noncanonicalStakeAuthorityAccounts)
        && pool.noncanonicalStakeAuthorityAccounts.length > 0,
      ).length,
      noncanonicalStakeAuthorityAccountCount: pools.reduce((n, pool) =>
        n + (pool.noncanonicalStakeAuthorityAccounts?.length || 0), 0,
      ),
      noncanonicalStakeAuthorityLamports: pools.reduce((n, pool) =>
        n + (pool.noncanonicalStakeAuthorityAccounts || []).reduce((m, account) => m + BigInt(account.lamports), 0n), 0n,
      ).toString(),
      noncanonicalWithdrawerOnlyAccountCount: pools.reduce((n, pool) =>
        n + (pool.noncanonicalWithdrawerOnlyAccounts?.length || 0), 0,
      ),
      noncanonicalWithdrawerOnlyLamports: pools.reduce((n, pool) =>
        n + (pool.noncanonicalWithdrawerOnlyAccounts || []).reduce(
          (m, account) => m + BigInt(account.lamports), 0n,
        ), 0n,
      ).toString(),
      poolsWithWithdrawalExposedTokenAccounts: pools.filter((pool) =>
        Array.isArray(pool.withdrawalExposedTokenAccounts)
        && pool.withdrawalExposedTokenAccounts.length > 0,
      ).length,
      withdrawalExposedTokenAccountCount: pools.reduce((n, pool) =>
        n + (pool.withdrawalExposedTokenAccounts?.length || 0), 0,
      ),
      withdrawalExposedDelegatedAmountRaw: pools.reduce((n, pool) =>
        n + (pool.withdrawalExposedTokenAccounts || []).reduce(
          (m, account) => m + BigInt(account.delegatedAmountRaw), 0n,
        ), 0n,
      ).toString(),
      withdrawalExposedBurnableAmountRaw: pools.reduce((n, pool) =>
        n + (pool.withdrawalExposedTokenAccounts || []).reduce((m, account) => {
          const amount = BigInt(account.amountRaw);
          if (account.tokenOwner === pool.mintAuthority.address) return m + amount;
          const delegated = BigInt(account.delegatedAmountRaw);
          return m + (amount < delegated ? amount : delegated);
        }, 0n), 0n,
      ).toString(),
      canonicalStakeLamports: sums.canonicalStakeLamports.toString(),
      canonicalDelegatedStakeLamports: sums.canonicalDelegatedStakeLamports.toString(),
      onrampLamports: sums.onrampLamports.toString(),
      onrampDelegatedStakeLamports: sums.onrampDelegatedStakeLamports.toString(),
      grossNativeLamports: (sums.canonicalStakeLamports + sums.onrampLamports).toString(),
      grossNativeSol: Number(sums.canonicalStakeLamports + sums.onrampLamports) / 1e9,
      aggregateMintSupplyRawAcrossDistinctPoolMints: sums.mintSupplyRaw.toString(),
    },
    pools,
    rpcCallSummary: {
      total: calls.length,
      failed: calls.filter((call) => !call.ok).length,
      methods: [...new Set(calls.map((call) => call.method))].sort(),
    },
  };
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, generatedAt: report.generatedAt, summary: report.summary}, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
