#!/usr/bin/env node
// Read-only verification of native-SOL / Stake-program custody for controllers
// found after removing standard SPL Stake Pool, Marinade and other known sets.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const envPath = ['/tmp/composer-helius-only.env', '/tmp/composer-helius-rpc.env']
  .find((candidate) => fs.existsSync(candidate));
const localEnv = envPath ? Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  .filter((line) => line.includes('=')).map((line) => line.split(/=(.*)/s).slice(0, 2))) : {};
const RPC_URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL || localEnv.HEAVY_RPC_URL || localEnv.RPC_URL;
if (!RPC_URL) throw new Error('set HEAVY_RPC_URL or RPC_URL');

const DIR = __dirname;
const OUT = process.argv[2] || path.join(DIR, 'native-stake-secondary-controllers.json');
const CENSUS = process.argv[3] || path.join(DIR, 'native-stake-offcurve-census.json');
const census = JSON.parse(fs.readFileSync(CENSUS, 'utf8'));
if (census.completedShards.length !== 256 || census.failedShards.length !== 0) {
  throw new Error('off-curve census is not complete');
}
const censusByAuthority = new Map(census.retainedWithdrawerGroups.map((x) => [x.authority, x]));

const PROGRAMS = {
  singlePool: new PublicKey('SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE'),
  vaultLiquidUnstaker: new PublicKey('2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo'),
  sanctumUnstake: new PublicKey('unpXTU2Ndrc7WWNyEhQWe4udTzSibLPi25SXv2xbCHQ'),
  validatorBonds: new PublicKey('vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, attempts = 5) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
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
      if (attempt + 1 < attempts) await sleep(500 * (2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

function accountDiscriminator(name) {
  return crypto.createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
}

function pda(program, seeds) {
  const [address, bump] = PublicKey.findProgramAddressSync(seeds, program);
  return { address: address.toBase58(), bump };
}

function stakeGroup(authority) {
  const group = censusByAuthority.get(authority);
  return group ? {
    stakeAccountCount: group.accountCount,
    delegatedStakeAccountCount: group.delegatedAccountCount,
    stakeLamports: group.lamports,
    stakeSol: group.sol,
  } : {
    stakeAccountCount: 0,
    delegatedStakeAccountCount: 0,
    stakeLamports: '0',
    stakeSol: 0,
  };
}

async function multipleAccounts(addresses) {
  const out = new Map();
  const slots = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const result = await rpc('getMultipleAccounts', [chunk, { commitment: 'confirmed', encoding: 'base64' }]);
    slots.push(result.context.slot);
    for (let j = 0; j < chunk.length; j += 1) out.set(chunk[j], result.value[j]);
  }
  return { accounts: out, slots };
}

function compactAccount(account) {
  if (!account) return null;
  return {
    owner: account.owner,
    lamports: String(account.lamports),
    dataBytes: Buffer.from(account.data[0], 'base64').length,
  };
}

async function getProgramAccounts(program, filters) {
  const result = await rpc('getProgramAccounts', [program.toBase58(), {
    commitment: 'confirmed',
    encoding: 'base64',
    withContext: true,
    filters,
  }]);
  return { slot: result.context.slot, rows: result.value };
}

async function verifySinglePool() {
  const result = await getProgramAccounts(PROGRAMS.singlePool, [{ dataSize: 33 }]);
  const pools = [];
  for (const row of result.rows) {
    const data = Buffer.from(row.account.data[0], 'base64');
    if (data.length !== 33 || data[0] !== 1) continue;
    const vote = new PublicKey(data.subarray(1, 33));
    const pool = pda(PROGRAMS.singlePool, [Buffer.from('pool'), vote.toBuffer()]);
    const stakeAuthority = pda(PROGRAMS.singlePool, [Buffer.from('stake_authority'), new PublicKey(row.pubkey).toBuffer()]);
    const canonicalStake = pda(PROGRAMS.singlePool, [Buffer.from('stake'), new PublicKey(row.pubkey).toBuffer()]);
    const onramp = pda(PROGRAMS.singlePool, [Buffer.from('onramp'), new PublicKey(row.pubkey).toBuffer()]);
    pools.push({
      pool: row.pubkey,
      voteAccount: vote.toBase58(),
      poolPda: pool,
      poolPdaVerified: pool.address === row.pubkey,
      stakeAuthority,
      canonicalStake,
      onramp,
      ...stakeGroup(stakeAuthority.address),
    });
  }
  const onramps = await multipleAccounts(pools.map((x) => x.onramp.address));
  let stakeLamports = 0n;
  let onrampLamports = 0n;
  for (const pool of pools) {
    const onrampAccount = onramps.accounts.get(pool.onramp.address);
    pool.onrampAccount = compactAccount(onrampAccount);
    pool.onrampLamports = String(onrampAccount?.lamports || 0);
    pool.onrampSol = Number(BigInt(pool.onrampLamports)) / 1e9;
    stakeLamports += BigInt(pool.stakeLamports);
    onrampLamports += BigInt(pool.onrampLamports);
  }
  pools.sort((a, b) => (BigInt(b.stakeLamports) + BigInt(b.onrampLamports)) > (BigInt(a.stakeLamports) + BigInt(a.onrampLamports)) ? 1 : -1);
  return {
    programId: PROGRAMS.singlePool.toBase58(),
    programAccountSlot: result.slot,
    linkedNativeAccountSlots: onramps.slots,
    decodedPoolCount: pools.length,
    canonicalPoolPdaVerifiedCount: pools.filter((x) => x.poolPdaVerified).length,
    stakeAuthorityPdaSeed: ['stake_authority', '<pool pubkey>'],
    onrampPdaSeed: ['onramp', '<pool pubkey>'],
    stakeLamports: stakeLamports.toString(),
    stakeSol: Number(stakeLamports) / 1e9,
    onrampLamports: onrampLamports.toString(),
    onrampSol: Number(onrampLamports) / 1e9,
    grossNativeLamports: (stakeLamports + onrampLamports).toString(),
    grossNativeSol: Number(stakeLamports + onrampLamports) / 1e9,
    pools,
  };
}

async function verifyVaultLiquidUnstaker() {
  const discriminator = accountDiscriminator('Pool');
  const result = await getProgramAccounts(PROGRAMS.vaultLiquidUnstaker, [
    { dataSize: 316 },
    { memcmp: { offset: 0, bytes: bs58.encode(discriminator) } },
  ]);
  const pools = result.rows.map((row) => {
    const data = Buffer.from(row.account.data[0], 'base64');
    const authority = new PublicKey(data.subarray(8, 40));
    const solVaultStored = new PublicKey(data.subarray(40, 72)).toBase58();
    const lpMint = new PublicKey(data.subarray(72, 104)).toBase58();
    const managerFeeAccount = new PublicKey(data.subarray(104, 136)).toBase58();
    // These offsets are the stable common prefix in the published client IDL.
    // The current mainnet account is longer (316 bytes), so keep the assertion
    // scoped to fields that still fit that prefix instead of guessing at the
    // later extension.
    const totalLpSupply = data.readBigUInt64LE(136).toString();
    const totalAccruedFees = data.readBigUInt64LE(144).toString();
    const deactivatingStakeLamports = data.readBigUInt64LE(152).toString();
    const feeMax = data.readUInt32LE(160);
    const feeMin = data.readUInt32LE(164);
    const minSolBalance = data.readBigUInt64LE(168).toString();
    const managerFeePercentage = data.readUInt8(176);
    const poolBump = data.readUInt8(177);
    const solVaultBump = data.readUInt8(178);
    const stateVaultLamports = data.readBigUInt64LE(179).toString();
    const cap = data.readBigUInt64LE(187).toString();
    const withdrawSolFee = data.readUInt16LE(195);
    const withdrawStakeFee = data.readUInt16LE(197);
    const flashLoanFee = data.readUInt32LE(199);
    const flashBorrowed = data.readBigUInt64LE(203).toString();
    const flashEnabled = data.readUInt8(211);
    const pool = pda(PROGRAMS.vaultLiquidUnstaker, [Buffer.from('pool'), authority.toBuffer()]);
    const solVault = pda(PROGRAMS.vaultLiquidUnstaker, [Buffer.from('sol_vault'), new PublicKey(row.pubkey).toBuffer()]);
    return {
      pool: row.pubkey,
      authority: authority.toBase58(),
      poolPda: pool,
      poolPdaVerified: pool.address === row.pubkey,
      solVaultStored,
      solVaultPda: solVault,
      solVaultPdaVerified: solVault.address === solVaultStored,
      lpMint,
      managerFeeAccount,
      currentAccountDataBytes: data.length,
      publishedIdlCommonPrefix: {
        totalLpSupply,
        totalAccruedFees,
        deactivatingStakeLamports,
        feeMax,
        feeMin,
        minSolBalance,
        managerFeePercentage,
        poolBump,
        solVaultBump,
        stateVaultLamports,
        cap,
        withdrawSolFee,
        withdrawStakeFee,
        flashLoanFee,
        flashBorrowed,
        flashEnabled,
      },
      ...stakeGroup(row.pubkey),
    };
  });
  const vaults = await multipleAccounts(pools.map((x) => x.solVaultStored));
  let stakeLamports = 0n;
  let solVaultLamports = 0n;
  for (const pool of pools) {
    const vault = vaults.accounts.get(pool.solVaultStored);
    pool.solVaultAccount = compactAccount(vault);
    pool.solVaultLamports = String(vault?.lamports || 0);
    pool.solVaultSol = Number(BigInt(pool.solVaultLamports)) / 1e9;
    stakeLamports += BigInt(pool.stakeLamports);
    solVaultLamports += BigInt(pool.solVaultLamports);
  }
  return {
    programId: PROGRAMS.vaultLiquidUnstaker.toBase58(),
    programAccountSlot: result.slot,
    linkedNativeAccountSlots: vaults.slots,
    decodedPoolCount: pools.length,
    poolPdaSeed: ['pool', '<pool authority pubkey>'],
    solVaultPdaSeed: ['sol_vault', '<pool pubkey>'],
    stakeAuthority: 'the program-owned Pool account itself',
    stakeLamports: stakeLamports.toString(),
    stakeSol: Number(stakeLamports) / 1e9,
    solVaultLamports: solVaultLamports.toString(),
    solVaultSol: Number(solVaultLamports) / 1e9,
    grossNativeLamports: (stakeLamports + solVaultLamports).toString(),
    grossNativeSol: Number(stakeLamports + solVaultLamports) / 1e9,
    pools,
  };
}

async function verifySanctumUnstake() {
  const discriminator = accountDiscriminator('Pool');
  const result = await getProgramAccounts(PROGRAMS.sanctumUnstake, [
    // The current mainnet Pool has one additional u64 field relative to the
    // 80-byte source snapshot, so its total serialized size is 88 bytes.
    { dataSize: 88 },
    { memcmp: { offset: 0, bytes: bs58.encode(discriminator) } },
  ]);
  const pools = result.rows.map((row) => {
    const data = Buffer.from(row.account.data[0], 'base64');
    const reserve = pda(PROGRAMS.sanctumUnstake, [new PublicKey(row.pubkey).toBuffer()]);
    return {
      pool: row.pubkey,
      feeAuthority: new PublicKey(data.subarray(8, 40)).toBase58(),
      lpMint: new PublicKey(data.subarray(40, 72)).toBase58(),
      stateIncomingStakeLamports: data.readBigUInt64LE(72).toString(),
      reservePda: reserve,
      ...stakeGroup(reserve.address),
    };
  });
  const reserves = await multipleAccounts(pools.map((x) => x.reservePda.address));
  let stakeLamports = 0n;
  let reserveLamports = 0n;
  for (const pool of pools) {
    const reserve = reserves.accounts.get(pool.reservePda.address);
    pool.reserveAccount = compactAccount(reserve);
    pool.reserveLamports = String(reserve?.lamports || 0);
    pool.reserveSol = Number(BigInt(pool.reserveLamports)) / 1e9;
    pool.liveMinusStateIncomingStakeLamports = (BigInt(pool.stakeLamports) - BigInt(pool.stateIncomingStakeLamports)).toString();
    stakeLamports += BigInt(pool.stakeLamports);
    reserveLamports += BigInt(pool.reserveLamports);
  }
  pools.sort((a, b) => (BigInt(b.stakeLamports) + BigInt(b.reserveLamports)) > (BigInt(a.stakeLamports) + BigInt(a.reserveLamports)) ? 1 : -1);
  return {
    programId: PROGRAMS.sanctumUnstake.toBase58(),
    programAccountSlot: result.slot,
    linkedNativeAccountSlots: reserves.slots,
    decodedPoolCount: pools.length,
    reserveAndStakeAuthorityPdaSeed: ['<pool pubkey>'],
    stakeLamports: stakeLamports.toString(),
    stakeSol: Number(stakeLamports) / 1e9,
    reserveLamports: reserveLamports.toString(),
    reserveSol: Number(reserveLamports) / 1e9,
    grossNativeLamports: (stakeLamports + reserveLamports).toString(),
    grossNativeSol: Number(stakeLamports + reserveLamports) / 1e9,
    pools,
  };
}

async function verifyValidatorBonds() {
  const discriminator = accountDiscriminator('Config');
  const result = await getProgramAccounts(PROGRAMS.validatorBonds, [
    { memcmp: { offset: 0, bytes: bs58.encode(discriminator) } },
  ]);
  const configs = result.rows.map((row) => {
    const authority = pda(PROGRAMS.validatorBonds, [Buffer.from('bonds_authority'), new PublicKey(row.pubkey).toBuffer()]);
    return {
      config: row.pubkey,
      configAccountBytes: Buffer.from(row.account.data[0], 'base64').length,
      bondsWithdrawerAuthorityPda: authority,
      ...stakeGroup(authority.address),
    };
  });
  let stakeLamports = 0n;
  for (const config of configs) stakeLamports += BigInt(config.stakeLamports);
  configs.sort((a, b) => BigInt(b.stakeLamports) > BigInt(a.stakeLamports) ? 1 : -1);
  return {
    programId: PROGRAMS.validatorBonds.toBase58(),
    programAccountSlot: result.slot,
    decodedConfigCount: configs.length,
    bondsWithdrawerAuthorityPdaSeed: ['bonds_authority', '<config pubkey>'],
    stakeLamports: stakeLamports.toString(),
    stakeSol: Number(stakeLamports) / 1e9,
    configs,
  };
}

(async () => {
  const [singlePool, vaultLiquidUnstaker, sanctumUnstake, validatorBonds] = await Promise.all([
    verifySinglePool(),
    verifyVaultLiquidUnstaker(),
    verifySanctumUnstake(),
    verifyValidatorBonds(),
  ]);
  const output = {
    generatedAt: new Date().toISOString(),
    transport: 'read-only getProgramAccounts/getMultipleAccounts; no transaction submitted',
    census: {
      source: path.basename(CENSUS),
      contextSlotMin: census.contextSlotMin,
      contextSlotMax: census.contextSlotMax,
      returnedAccountCount: census.returnedAccountCount,
      initializedOrDelegatedAccountCount: census.initializedOrDelegatedAccountCount,
      completedShardCount: census.completedShards.length,
      failedShardCount: census.failedShards.length,
    },
    singlePool,
    vaultLiquidUnstaker,
    sanctumUnstake,
    validatorBonds,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    output: OUT,
    singlePool: { pools: singlePool.decodedPoolCount, grossNativeSol: singlePool.grossNativeSol },
    vaultLiquidUnstaker: { pools: vaultLiquidUnstaker.decodedPoolCount, grossNativeSol: vaultLiquidUnstaker.grossNativeSol },
    sanctumUnstake: { pools: sanctumUnstake.decodedPoolCount, grossNativeSol: sanctumUnstake.grossNativeSol },
    validatorBonds: { configs: validatorBonds.decodedConfigCount, stakeSol: validatorBonds.stakeSol },
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
