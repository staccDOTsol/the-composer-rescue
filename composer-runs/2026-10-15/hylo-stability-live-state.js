#!/usr/bin/env node
// Read-only current-mainnet identity/state capture for the Hylo earn pool.
// This script performs account reads only and never constructs or sends a transaction.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const zlib = require('zlib');
const {
  Connection,
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const spl = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');

const ROOT = __dirname;
const OUTPUT = path.join(ROOT, 'hylo-stability-live-state.json');
const ELF_OUTPUT = path.join(ROOT, 'hylo-stability-current.so');
const ONCHAIN_IDL_OUTPUT = path.join(ROOT, 'hylo-stability-onchain-idl.json');
const SDK = path.join(ROOT, 'hylo-stability-sdk-source');
const IDL_PATH = path.join(SDK, 'hylo-idl/idls/hylo_earn_pool.json');
const ENV_PATH = '/tmp/composer-helius-rpc.env';

const env = Object.fromEntries(fs.readFileSync(ENV_PATH, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
// Prefer the primary current-state endpoint; archival/heavy endpoints may lag.
const rpcUrl = env.RPC_URL || env.HEAVY_RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const connection = new Connection(rpcUrl, 'confirmed');

const P = (value) => new PublicKey(value);
const PROGRAM = P('HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ');
const EXCHANGE = P('HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn');
const HYUSD = P('5YMkXAYccHSGnHn9nob9xEvv6Pvka9DZWH7nTbotTu9E');
const EXPECTED_VAULT = P('EqozKyMj7FVnLHc2cJj3VC25aBr4AhVh1cGM2WDajGe9');
const EXPECTED_AUTHORITY = P('5YrRAQag9BbJkauDtJkd1vsTquXT6N46oU8rJ66GDxHd');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const ATA = spl.ASSOCIATED_TOKEN_PROGRAM_ID;
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = P('BPFLoaderUpgradeab1e11111111111111111111111');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const key = (data) => new PublicKey(data).toString();
const pda = (seeds, program = PROGRAM) =>
  PublicKey.findProgramAddressSync(seeds.map((seed) => Buffer.isBuffer(seed) ? seed : Buffer.from(seed)), program);

function jsonValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (value instanceof PublicKey) return value.toString();
  if (anchor.BN?.isBN?.(value)) return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, jsonValue(item)]));
  }
  return value;
}

function decodeToken(address, info) {
  if (!info || !info.owner.equals(TOKEN) || info.data.length < 165) return null;
  return {
    address: address.toString(),
    mint: key(info.data.subarray(0, 32)),
    authority: key(info.data.subarray(32, 64)),
    amountRaw: info.data.readBigUInt64LE(64).toString(),
    state: info.data[108],
    isNativeOption: info.data.readUInt32LE(109),
    delegatedAmountRaw: info.data.readBigUInt64LE(121).toString(),
    closeAuthorityOption: info.data.readUInt32LE(129),
  };
}

function decodeMint(address, info) {
  if (!info || !info.owner.equals(TOKEN) || info.data.length < 82) return null;
  const mintAuthorityOption = info.data.readUInt32LE(0);
  const freezeAuthorityOption = info.data.readUInt32LE(46);
  return {
    address: address.toString(),
    mintAuthority: mintAuthorityOption ? key(info.data.subarray(4, 36)) : null,
    supplyRaw: info.data.readBigUInt64LE(36).toString(),
    decimals: info.data[44],
    initialized: info.data[45] !== 0,
    freezeAuthority: freezeAuthorityOption ? key(info.data.subarray(50, 82)) : null,
  };
}

function accountMeta(address, info) {
  if (!info) return {address: address.toString(), exists: false};
  return {
    address: address.toString(),
    exists: true,
    owner: info.owner.toString(),
    executable: info.executable,
    lamports: info.lamports,
    dataLength: info.data.length,
    dataSha256: sha256(info.data),
  };
}

function parseProgram(programInfo) {
  if (!programInfo || !programInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) ||
      programInfo.data.length !== 36 || programInfo.data.readUInt32LE(0) !== 2) {
    throw new Error('Program is not an Upgradeable Loader Program account');
  }
  return key(programInfo.data.subarray(4, 36));
}

function parseProgramData(programDataInfo) {
  if (!programDataInfo || !programDataInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) ||
      programDataInfo.data.length < 13 || programDataInfo.data.readUInt32LE(0) !== 3) {
    throw new Error('ProgramData account is missing or malformed');
  }
  const slot = programDataInfo.data.readBigUInt64LE(4);
  const hasAuthority = programDataInfo.data[12] === 1;
  const headerBytes = hasAuthority ? 45 : 13;
  return {
    deployedSlot: slot.toString(),
    upgradeAuthority: hasAuthority ? key(programDataInfo.data.subarray(13, 45)) : null,
    headerBytes,
    payload: programDataInfo.data.subarray(headerBytes),
  };
}

function offsets(haystack, needle) {
  const found = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    found.push(at);
    from = at + 1;
  }
  return found;
}

function decodeLegacyAnchorIdl(info) {
  if (!info || info.data.length < 44) return null;
  const compressedLength = info.data.readUInt32LE(40);
  const compressed = info.data.subarray(44, 44 + compressedLength);
  if (compressed.length !== compressedLength) throw new Error('truncated legacy Anchor IDL account');
  const json = JSON.parse(zlib.inflateSync(compressed).toString('utf8'));
  return {
    discriminatorHex: info.data.subarray(0, 8).toString('hex'),
    authority: key(info.data.subarray(8, 40)),
    compressedLength,
    json,
  };
}

async function anchorIdlAddress(program) {
  const [base] = PublicKey.findProgramAddressSync([], program);
  return PublicKey.createWithSeed(base, 'anchor:idl', program);
}

async function main() {
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
  const coder = new anchor.BorshAccountsCoder(idl);
  const [poolConfig, poolConfigBump] = pda(['pool_config']);
  const [poolAuth, poolAuthBump] = pda(['pool_auth']);
  const [lpMint, lpMintBump] = pda(['staked_hyUSD']);
  const [lpMintAuth, lpMintAuthBump] = pda(['mint_auth', lpMint.toBuffer()]);
  const [hylo, hyloBump] = pda(['hylo'], EXCHANGE);
  const [feeAuth, feeAuthBump] = pda(['fee_auth', HYUSD.toBuffer()], EXCHANGE);
  const [eventAuthority, eventAuthorityBump] = pda(['__event_authority']);
  const stablecoinPool = spl.getAssociatedTokenAddressSync(HYUSD, poolAuth, true, TOKEN, ATA);
  const feeVault = spl.getAssociatedTokenAddressSync(HYUSD, feeAuth, true, TOKEN, ATA);
  const idlAddress = await anchorIdlAddress(PROGRAM);

  const initialKeys = [PROGRAM, poolConfig, poolAuth, lpMint, lpMintAuth, hylo,
    HYUSD, stablecoinPool, feeAuth, feeVault, eventAuthority, EXPECTED_VAULT,
    EXPECTED_AUTHORITY, idlAddress];
  const initial = await connection.getMultipleAccountsInfoAndContext(initialKeys, 'confirmed');
  const initialMap = Object.fromEntries(initialKeys.map((address, index) =>
    [address.toString(), initial.value[index]]));
  const programDataAddress = P(parseProgram(initialMap[PROGRAM.toString()]));
  const dependent = await connection.getMultipleAccountsInfoAndContext([programDataAddress], 'confirmed');
  const programData = parseProgramData(dependent.value[0]);
  fs.writeFileSync(ELF_OUTPUT, programData.payload);

  const poolConfigInfo = initialMap[poolConfig.toString()];
  const hyloInfo = initialMap[hylo.toString()];
  const decodedPoolConfig = coder.decode('PoolConfig', poolConfigInfo.data);
  const decodedHylo = coder.decode('Hylo', hyloInfo.data);
  const decodedOnchainIdl = decodeLegacyAnchorIdl(initialMap[idlAddress.toString()]);
  if (decodedOnchainIdl) {
    fs.writeFileSync(ONCHAIN_IDL_OUTPUT, `${JSON.stringify(decodedOnchainIdl.json, null, 2)}\n`);
  }
  const poolToken = decodeToken(stablecoinPool, initialMap[stablecoinPool.toString()]);
  const expectedToken = decodeToken(EXPECTED_VAULT, initialMap[EXPECTED_VAULT.toString()]);
  const hyusdMint = decodeMint(HYUSD, initialMap[HYUSD.toString()]);
  const shareMint = decodeMint(lpMint, initialMap[lpMint.toString()]);

  const blockTime = await connection.getBlockTime(initial.context.slot);
  const sdkCommit = require('child_process').execFileSync('git', ['-C', SDK, 'rev-parse', 'HEAD'],
    {encoding: 'utf8'}).trim();
  const instructionEvidence = idl.instructions.map((instruction) => {
    const discriminator = Buffer.from(instruction.discriminator);
    const hits = offsets(programData.payload, discriminator);
    return {
      name: instruction.name,
      discriminatorHex: discriminator.toString('hex'),
      elfOccurrences: hits.length,
      elfOffsets: hits,
    };
  });
  const accountEvidence = idl.accounts.map((account) => {
    const discriminator = Buffer.from(account.discriminator);
    const hits = offsets(programData.payload, discriminator);
    return {
      name: account.name,
      discriminatorHex: discriminator.toString('hex'),
      elfOccurrences: hits.length,
      elfOffsets: hits,
    };
  });

  const poolRaw = BigInt(poolToken.amountRaw);
  const shareSupplyRaw = BigInt(shareMint.supplyRaw);
  const navNumerator = shareSupplyRaw === 0n ? 1_000_000n : poolRaw;
  const navDenominator = shareSupplyRaw === 0n ? 1_000_000n : shareSupplyRaw;
  const navScaled1e12 = navNumerator * 1_000_000_000_000n / navDenominator;

  const output = {
    generatedAt: new Date().toISOString(),
    method: 'Read-only confirmed getMultipleAccounts/getBlockTime; no transaction constructed, signed, or submitted',
    rpcEndpointRedacted: true,
    observation: {
      initialSlot: initial.context.slot,
      dependentSlot: dependent.context.slot,
      blockTime,
      blockTimeIso: blockTime == null ? null : new Date(blockTime * 1000).toISOString(),
    },
    program: {
      id: PROGRAM.toString(),
      expectedId: idl.address,
      idMatchesIdl: PROGRAM.toString() === idl.address,
      owner: initialMap[PROGRAM.toString()].owner.toString(),
      executable: initialMap[PROGRAM.toString()].executable,
      programDataAddress: programDataAddress.toString(),
      deployedSlot: programData.deployedSlot,
      upgradeAuthority: programData.upgradeAuthority,
      elfBytes: programData.payload.length,
      elfSha256: sha256(programData.payload),
    },
    sdk: {
      repository: 'hylo-so/sdk',
      commit: sdkCommit,
      workspaceVersion: '2.6.5',
      idlPath: path.relative(ROOT, IDL_PATH),
      idlName: idl.metadata?.name || null,
      idlVersion: idl.metadata?.version || null,
      idlSha256: sha256(fs.readFileSync(IDL_PATH)),
      onchainLegacyIdlAddress: idlAddress.toString(),
      onchainLegacyIdlExists: Boolean(initialMap[idlAddress.toString()]),
      onchainLegacyIdlDecoded: Boolean(decodedOnchainIdl),
      onchainLegacyIdlDiscriminatorHex: decodedOnchainIdl?.discriminatorHex || null,
      onchainLegacyIdlAuthority: decodedOnchainIdl?.authority || null,
      onchainLegacyIdlCompressedBytes: decodedOnchainIdl?.compressedLength || null,
      onchainLegacyIdlPath: decodedOnchainIdl ? path.basename(ONCHAIN_IDL_OUTPUT) : null,
      onchainLegacyIdlSha256: decodedOnchainIdl ?
        sha256(Buffer.from(`${JSON.stringify(decodedOnchainIdl.json, null, 2)}\n`)) : null,
      sdkAndOnchainIdlStructurallyEqual: decodedOnchainIdl ?
        JSON.stringify(idl) === JSON.stringify(decodedOnchainIdl.json) : null,
      sdkAndOnchainInstructionSchemasEqual: decodedOnchainIdl ?
        JSON.stringify(idl.instructions) === JSON.stringify(decodedOnchainIdl.json.instructions) : null,
      sdkAndOnchainAccountSchemasEqual: decodedOnchainIdl ?
        JSON.stringify(idl.accounts) === JSON.stringify(decodedOnchainIdl.json.accounts) : null,
      observedSdkOnchainDifference: decodedOnchainIdl ?
        'One non-instruction type-field label differs: YieldHarvestConfig.allocation on chain versus YieldHarvestConfig.ceil_mult in the SDK IDL; serialized layout is unchanged.' : null,
      instructionDiscriminatorEvidence: instructionEvidence,
      accountDiscriminatorEvidence: accountEvidence,
      rawDiscriminatorScanCaveat: 'A compiled SBF ELF need not contain each 8-byte discriminator contiguously; live dispatch simulations are the authoritative deployed-binary compatibility check.',
    },
    pdas: {
      poolConfig: {address: poolConfig.toString(), bump: poolConfigBump},
      poolAuth: {address: poolAuth.toString(), bump: poolAuthBump},
      lpMint: {address: lpMint.toString(), bump: lpMintBump},
      lpMintAuth: {address: lpMintAuth.toString(), bump: lpMintAuthBump},
      hylo: {address: hylo.toString(), bump: hyloBump, program: EXCHANGE.toString()},
      feeAuth: {address: feeAuth.toString(), bump: feeAuthBump, program: EXCHANGE.toString()},
      eventAuthority: {address: eventAuthority.toString(), bump: eventAuthorityBump},
      stablecoinPool: stablecoinPool.toString(),
      feeVault: feeVault.toString(),
    },
    decoded: {
      poolConfig: jsonValue(decodedPoolConfig),
      hylo: jsonValue(decodedHylo),
      hyusdMint,
      shareMint,
      stablecoinPool: poolToken,
      feeVault: decodeToken(feeVault, initialMap[feeVault.toString()]),
      priorQueueVault: expectedToken,
    },
    identityChecks: {
      priorQueueAuthorityIsPoolAuth: EXPECTED_AUTHORITY.equals(poolAuth),
      priorQueueVaultIsDerivedStablecoinPool: EXPECTED_VAULT.equals(stablecoinPool),
      stablecoinPoolAuthorityMatches: poolToken.authority === poolAuth.toString(),
      stablecoinPoolMintMatches: poolToken.mint === HYUSD.toString(),
      lpMintAuthorityMatches: shareMint.mintAuthority === lpMintAuth.toString(),
      hyloStablecoinMintMatches: decodedHylo.stablecoin_mint.toString() === HYUSD.toString(),
      poolConfigBumpMatches: decodedPoolConfig.pool_auth_bump === poolAuthBump,
      lpMintBumpMatches: decodedPoolConfig.lp_token_mint_bump === lpMintBump,
      lpMintAuthorityBumpMatches: decodedPoolConfig.lp_token_auth_bump === lpMintAuthBump,
    },
    accounting: {
      poolHyusdRaw: poolRaw.toString(),
      shareSupplyRaw: shareSupplyRaw.toString(),
      hyusdPerShareScaled1e12: navScaled1e12.toString(),
      hyusdPerShare: `${navScaled1e12 / 1_000_000_000_000n}.${(navScaled1e12 % 1_000_000_000_000n).toString().padStart(12, '0')}`,
    },
    accounts: Object.fromEntries(initialKeys.map((address) =>
      [address.toString(), accountMeta(address, initialMap[address.toString()])])),
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: path.basename(OUTPUT),
    elf: path.basename(ELF_OUTPUT),
    onchainIdl: decodedOnchainIdl ? path.basename(ONCHAIN_IDL_OUTPUT) : null,
    slot: output.observation.initialSlot,
    programData: output.program.programDataAddress,
    elfSha256: output.program.elfSha256,
    vaultMatches: output.identityChecks.priorQueueVaultIsDerivedStablecoinPool,
    authorityMatches: output.identityChecks.priorQueueAuthorityIsPoolAuth,
    poolHyusdRaw: output.accounting.poolHyusdRaw,
    shareSupplyRaw: output.accounting.shareSupplyRaw,
  })}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
