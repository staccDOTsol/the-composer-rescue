#!/usr/bin/env node
// Read-only current-mainnet snapshot for the verified Hastra PRIME vault-stake deployment.
// This script only calls JSON-RPC reads and writes a sanitized JSON artifact; it never signs or submits.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const { unpackAccount, unpackMint, TOKEN_PROGRAM_ID } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');

const baseDir = __dirname;
const programId = new PublicKey('97V7JsExNC6yFWu5KjK1FLfVkNVvtMpAFL5QkLWKEGxY');
const upgradeableLoader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const idlPath = path.join(baseDir, 'hastra-release-v0.0.6/idl/vault_stake.json');
const outputPath = path.join(baseDir, 'hastra-live-state.json');

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^export\s+/, '');
    if (!cleaned || cleaned.startsWith('#')) continue;
    const index = cleaned.indexOf('=');
    if (index < 1) continue;
    out[cleaned.slice(0, index)] = cleaned.slice(index + 1).replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = { ...readEnv('/tmp/composer-helius-rpc.env'), ...process.env };
const rpcUrl = env.RPC_URL || env.HEAVY_RPC_URL;
if (!rpcUrl) throw new Error('RPC_URL or HEAVY_RPC_URL is required');

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function pda(seeds) {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

function accountInfo(pubkey, value) {
  if (!value) return { address: pubkey.toBase58(), exists: false };
  const data = Buffer.from(value.data[0], 'base64');
  return {
    address: pubkey.toBase58(),
    exists: true,
    owner: value.owner,
    executable: value.executable,
    lamports: value.lamports,
    dataLength: data.length,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
    data,
  };
}

function clean(value) {
  if (value == null) return value;
  if (typeof value === 'bigint') return value.toString();
  if (anchor.BN.isBN(value)) return value.toString(10);
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(clean);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  }
  return value;
}

function field(object, camel, snake) {
  return object[camel] ?? object[snake];
}

function parseUpgradeableProgram(program) {
  if (!program.exists || program.data.length < 36 || program.data.readUInt32LE(0) !== 2) return null;
  return { programDataAddress: new PublicKey(program.data.subarray(4, 36)).toBase58() };
}

function parseProgramData(programData) {
  if (!programData.exists || programData.data.length < 13 || programData.data.readUInt32LE(0) !== 3) return null;
  const deploySlot = programData.data.readBigUInt64LE(4);
  const hasAuthority = programData.data[12] === 1;
  const metadataBytes = hasAuthority ? 45 : 13;
  const executable = programData.data.subarray(metadataBytes);
  return {
    deploySlot: deploySlot.toString(),
    upgradeAuthority: hasAuthority ? new PublicKey(programData.data.subarray(13, 45)).toBase58() : null,
    metadataBytes,
    executableBytes: executable.length,
    executableSha256: crypto.createHash('sha256').update(executable).digest('hex'),
  };
}

function parseToken(pubkey, info) {
  const raw = {
    data: info.data,
    owner: new PublicKey(info.owner),
    executable: info.executable,
    lamports: info.lamports,
    rentEpoch: 0,
  };
  const decoded = unpackAccount(pubkey, raw, TOKEN_PROGRAM_ID);
  return clean({
    mint: decoded.mint,
    owner: decoded.owner,
    amount: decoded.amount,
    delegate: decoded.delegate,
    delegatedAmount: decoded.delegatedAmount,
    isFrozen: decoded.isFrozen,
    closeAuthority: decoded.closeAuthority,
  });
}

function parseMint(pubkey, info) {
  const raw = {
    data: info.data,
    owner: new PublicKey(info.owner),
    executable: info.executable,
    lamports: info.lamports,
    rentEpoch: 0,
  };
  const decoded = unpackMint(pubkey, raw, TOKEN_PROGRAM_ID);
  return clean({
    decimals: decoded.decimals,
    supply: decoded.supply,
    mintAuthority: decoded.mintAuthority,
    freezeAuthority: decoded.freezeAuthority,
    isInitialized: decoded.isInitialized,
  });
}

(async () => {
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  const coder = new anchor.BorshAccountsCoder(idl);
  const [stakeConfig, stakeConfigBump] = pda([Buffer.from('stake_config')]);
  const [vaultAuthority, vaultAuthorityBump] = pda([Buffer.from('vault_authority')]);
  const [mintAuthority, mintAuthorityBump] = pda([Buffer.from('mint_authority')]);
  const [vaultConfig, vaultConfigBump] = pda([
    Buffer.from('stake_vault_token_account_config'),
    stakeConfig.toBuffer(),
  ]);
  const [priceConfig, priceConfigBump] = pda([Buffer.from('stake_price_config'), stakeConfig.toBuffer()]);
  const [rewardConfig, rewardConfigBump] = pda([Buffer.from('stake_reward_config'), stakeConfig.toBuffer()]);
  const [lastReward, lastRewardBump] = pda([
    Buffer.from('last_reward_publication'),
    stakeConfig.toBuffer(),
  ]);

  const latest = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  let freshnessFloor = latest.context.slot;
  try {
    const priorSimulation = JSON.parse(fs.readFileSync(path.join(baseDir, 'hastra-v1-simulations.json'), 'utf8'));
    for (const row of priorSimulation.results || []) {
      if (Number.isSafeInteger(row.slot)) freshnessFloor = Math.max(freshnessFloor, row.slot);
    }
  } catch (_) {
    // Simulation evidence is optional; the latest-blockhash slot remains the floor.
  }
  const initial = await rpc('getMultipleAccounts', [[
    programId.toBase58(),
    stakeConfig.toBase58(),
    vaultConfig.toBase58(),
    priceConfig.toBase58(),
    rewardConfig.toBase58(),
    lastReward.toBase58(),
  ], { encoding: 'base64', commitment: 'confirmed', minContextSlot: freshnessFloor }]);
  const slot = initial.context.slot;
  const initialKeys = [programId, stakeConfig, vaultConfig, priceConfig, rewardConfig, lastReward];
  const initialInfos = Object.fromEntries(initialKeys.map((key, index) => [key.toBase58(), accountInfo(key, initial.value[index])]));

  const program = initialInfos[programId.toBase58()];
  const programPointer = parseUpgradeableProgram(program);
  if (!programPointer) throw new Error('target is not an upgradeable program');
  const programDataKey = new PublicKey(programPointer.programDataAddress);

  const decodedStake = clean(coder.decode('StakeConfig', initialInfos[stakeConfig.toBase58()].data));
  const decodedVaultConfig = clean(coder.decode('StakeVaultTokenAccountConfig', initialInfos[vaultConfig.toBase58()].data));
  const decodedPrice = clean(coder.decode('StakePriceConfig', initialInfos[priceConfig.toBase58()].data));
  const decodedReward = initialInfos[rewardConfig.toBase58()].exists
    ? clean(coder.decode('StakeRewardConfig', initialInfos[rewardConfig.toBase58()].data))
    : null;
  const decodedLastReward = initialInfos[lastReward.toBase58()].exists
    ? clean(coder.decode('LastRewardPublication', initialInfos[lastReward.toBase58()].data))
    : null;

  const dependentKeys = [
    programDataKey,
    new PublicKey(field(decodedVaultConfig, 'vaultTokenAccount', 'vault_token_account')),
    new PublicKey(decodedStake.vault),
    new PublicKey(decodedStake.mint),
  ];
  const dependent = await rpc('getMultipleAccounts', [dependentKeys.map(String), {
    encoding: 'base64',
    commitment: 'confirmed',
    minContextSlot: slot,
  }]);
  const dependentInfos = Object.fromEntries(dependentKeys.map((key, index) => [key.toBase58(), accountInfo(key, dependent.value[index])]));
  const programData = dependentInfos[programDataKey.toBase58()];
  const configuredVaultTokenAccount = field(decodedVaultConfig, 'vaultTokenAccount', 'vault_token_account');
  const configuredVaultAuthority = field(decodedVaultConfig, 'vaultAuthority', 'vault_authority');
  const vaultToken = dependentInfos[configuredVaultTokenAccount];
  const vaultMint = dependentInfos[decodedStake.vault];
  const shareMint = dependentInfos[decodedStake.mint];
  const blockTime = await rpc('getBlockTime', [dependent.context.slot]);
  const token = parseToken(new PublicKey(configuredVaultTokenAccount), vaultToken);
  const vaultMintDecoded = parseMint(new PublicKey(decodedStake.vault), vaultMint);
  const shareMintDecoded = parseMint(new PublicKey(decodedStake.mint), shareMint);
  const price = BigInt(decodedPrice.price);
  const priceScale = BigInt(field(decodedPrice, 'priceScale', 'price_scale'));
  const assetsPerShareScaled1e9 = price > 0n && priceScale > 0n
    ? (price * 1_000_000_000n / priceScale).toString()
    : null;

  const output = {
    generatedAt: new Date().toISOString(),
    method: 'read-only getMultipleAccounts at confirmed commitment, freshness-pinned with minContextSlot from getLatestBlockhash; no transaction constructed, signed, or submitted',
    rpcEndpointRedacted: true,
    source: {
      repository: 'https://github.com/provenance-io/hastra-sol-vault',
      verifiedCommit: '121e4cc600b976a97faa018359e00bda48113ec2',
      releaseTag: 'v0.0.6',
      idlSha256: crypto.createHash('sha256').update(fs.readFileSync(idlPath)).digest('hex'),
    },
    observation: {
      requestedFreshnessFloor: freshnessFloor,
      initialSlot: slot,
      dependentSlot: dependent.context.slot,
      blockTime,
      blockTimeIso: blockTime == null ? null : new Date(blockTime * 1000).toISOString(),
    },
    program: {
      id: programId.toBase58(),
      owner: program.owner,
      loaderExpected: upgradeableLoader.toBase58(),
      executable: program.executable,
      programDataAddress: programDataKey.toBase58(),
      ...parseProgramData(programData),
    },
    pdas: {
      stakeConfig: { address: stakeConfig.toBase58(), bump: stakeConfigBump },
      vaultConfig: { address: vaultConfig.toBase58(), bump: vaultConfigBump },
      vaultAuthority: { address: vaultAuthority.toBase58(), bump: vaultAuthorityBump },
      mintAuthority: { address: mintAuthority.toBase58(), bump: mintAuthorityBump },
      priceConfig: { address: priceConfig.toBase58(), bump: priceConfigBump },
      rewardConfig: { address: rewardConfig.toBase58(), bump: rewardConfigBump },
      lastRewardPublication: { address: lastReward.toBase58(), bump: lastRewardBump },
    },
    decoded: {
      stakeConfig: decodedStake,
      vaultConfig: decodedVaultConfig,
      priceConfig: decodedPrice,
      rewardConfig: decodedReward,
      lastRewardPublication: decodedLastReward,
      vaultTokenAccount: token,
      vaultMint: vaultMintDecoded,
      shareMint: shareMintDecoded,
    },
    derived: {
      vaultAuthorityMatches: token.owner === vaultAuthority.toBase58(),
      configuredVaultAuthorityMatches: configuredVaultAuthority === vaultAuthority.toBase58(),
      configuredVaultAccountMatches: configuredVaultTokenAccount === vaultToken.address,
      vaultMintMatches: token.mint === decodedStake.vault,
      shareMintAuthorityMatches: shareMintDecoded.mintAuthority === mintAuthority.toBase58(),
      vaultRawAmount: token.amount,
      shareSupplyRaw: shareMintDecoded.supply,
      assetsPerShareScaled1e9,
      priceAgeSeconds: blockTime == null ? null : blockTime - Number(field(decodedPrice, 'priceTimestamp', 'price_timestamp')),
      priceWithinConfiguredStaleness: blockTime == null
        ? null
        : blockTime - Number(field(decodedPrice, 'priceTimestamp', 'price_timestamp')) <= Number(field(decodedPrice, 'priceMaxStaleness', 'price_max_staleness')),
    },
    accountDigests: Object.fromEntries(
      [...Object.values(initialInfos), ...Object.values(dependentInfos)].map((info) => [info.address, {
        exists: info.exists,
        owner: info.owner,
        executable: info.executable,
        lamports: info.lamports,
        dataLength: info.dataLength,
        dataSha256: info.dataSha256,
      }]),
    ),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    outputPath,
    slot: output.observation.dependentSlot,
    blockTimeIso: output.observation.blockTimeIso,
    program: output.program,
    stakeConfig: output.decoded.stakeConfig,
    vaultConfig: output.decoded.vaultConfig,
    priceConfig: output.decoded.priceConfig,
    vaultTokenAccount: output.decoded.vaultTokenAccount,
    shareMint: output.decoded.shareMint,
    derived: output.derived,
  }, null, 2) + '\n');
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
