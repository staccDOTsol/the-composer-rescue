#!/usr/bin/env node
'use strict';

// Fresh, read-only Meteora DLMM custody sample and executable metadata.
// The Data API is used only to rank candidate pools. Every pair, mint, reserve,
// authority, PDA and balance included in the USD total is checked over Solana RPC.

const fs = require('fs');
const crypto = require('crypto');
const {
  Connection,
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const { BN } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const dlmm = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@meteora-ag/dlmm');

const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const PROGRAM = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);
const OUT = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-current-custody.json';
const DATA_API = 'https://dlmm.datapi.meteora.ag/pools?page=1&page_size=100&sort_by=tvl%3Adesc&filter_by=is_blacklisted%3Dfalse';

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function uniquePublicKeys(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toBase58();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asPublicKey(value) {
  return value instanceof PublicKey ? value : new PublicKey(value);
}

function u64le(buffer, offset) {
  return Number(buffer.readBigUInt64LE(offset));
}

function decodeUpgradeableProgram(programInfo, programDataInfo) {
  const programData = programInfo.data;
  if (programData.readUInt32LE(0) !== 2) throw new Error('program account is not upgradeable-loader Program state');
  const programDataAddress = new PublicKey(programData.subarray(4, 36));
  const bytes = programDataInfo.data;
  if (bytes.readUInt32LE(0) !== 3) throw new Error('ProgramData account has unexpected state tag');
  const option = bytes[12];
  const executableBytes = bytes.subarray(option === 1 ? 45 : 13);
  let trimmedLength = executableBytes.length;
  while (trimmedLength > 0 && executableBytes[trimmedLength - 1] === 0) trimmedLength -= 1;
  return {
    programDataAddress: programDataAddress.toBase58(),
    lastDeploySlot: u64le(bytes, 4),
    upgradeAuthority: option === 1 ? new PublicKey(bytes.subarray(13, 45)).toBase58() : null,
    programDataLength: bytes.length,
    executableAllocationBytes: executableBytes.length,
    executableAllocationSha256: crypto.createHash('sha256').update(executableBytes).digest('hex'),
    trailingZeroTrimmedBytes: trimmedLength,
    trailingZeroTrimmedSha256: crypto.createHash('sha256').update(executableBytes.subarray(0, trimmedLength)).digest('hex'),
  };
}

function parseTokenAccount(pubkey, info) {
  if (!info || !TOKEN_PROGRAMS.has(info.owner.toBase58()) || info.data.length < 72) return null;
  return {
    address: pubkey.toBase58(),
    ownerProgram: info.owner.toBase58(),
    mint: new PublicKey(info.data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(info.data.subarray(32, 64)).toBase58(),
    rawAmount: info.data.readBigUInt64LE(64).toString(),
  };
}

function parseMint(pubkey, info) {
  if (!info || !TOKEN_PROGRAMS.has(info.owner.toBase58()) || info.data.length < 45) return null;
  return {
    address: pubkey.toBase58(),
    ownerProgram: info.owner.toBase58(),
    decimals: info.data[44],
  };
}

function pairPdaProof(pairKey, account, presetParameters) {
  const tokenX = asPublicKey(account.tokenXMint);
  const tokenY = asPublicKey(account.tokenYMint);
  const pairType = account.pairType;
  let candidates = [];
  if (pairType === 0) {
    const derived = account.requireBaseFactorSeed
      ? dlmm.deriveLbPair2(tokenX, tokenY, new BN(account.binStep), new BN(account.parameters.baseFactor), PROGRAM)
      : dlmm.deriveLbPair(tokenX, tokenY, new BN(account.binStep), PROGRAM);
    candidates = [{ address: derived[0], bump: derived[1], kind: account.requireBaseFactorSeed ? 'permissionless-base-factor' : 'permissionless-legacy' }];
  } else if (pairType === 1) {
    const derived = dlmm.derivePermissionLbPair(asPublicKey(account.baseKey), tokenX, tokenY, new BN(account.binStep), PROGRAM);
    candidates = [{ address: derived[0], bump: derived[1], kind: 'permissioned-base-key' }];
  } else if (pairType === 2) {
    const derived = dlmm.deriveCustomizablePermissionlessLbPair(tokenX, tokenY, PROGRAM);
    candidates = [{ address: derived[0], bump: derived[1], kind: 'customizable-permissionless' }];
  } else if (pairType === 3) {
    // LbPair stores FunctionType (1=LiquidityMining, 2=LimitOrder), while the
    // preset stores ConcreteFunctionType (1=LiquidityMining, 0=LimitOrder).
    const concreteFunctionType = account.parameters.functionType === 2 ? 0 : 1;
    const matchingPresets = presetParameters.filter(({ account: preset }) => (
      preset.binStep === account.binStep
      && preset.baseFactor === account.parameters.baseFactor
      && preset.baseFeePowerFactor === account.parameters.baseFeePowerFactor
      && preset.concreteFunctionType === concreteFunctionType
      && preset.collectFeeMode === account.parameters.collectFeeMode
    ));
    candidates = matchingPresets.map(({ publicKey, account: preset }) => {
      const derived = dlmm.deriveLbPairWithPresetParamWithIndexKey(publicKey, tokenX, tokenY, PROGRAM);
      return { address: derived[0], bump: derived[1], kind: 'permissionless-v2-preset', preset: publicKey.toBase58(), presetIndex: preset.index };
    });
  }
  const match = candidates.find(({ address }) => address.equals(pairKey));
  return {
    pairType,
    verified: Boolean(match) && match.bump === account.bumpSeed[0],
    storedBump: account.bumpSeed[0],
    matchedDerivation: match ? {
      kind: match.kind,
      derivedAddress: match.address.toBase58(),
      derivedBump: match.bump,
      preset: match.preset || null,
      presetIndex: match.presetIndex ?? null,
    } : null,
    candidateCount: candidates.length,
  };
}

async function fetchPrices(mints) {
  const prices = {};
  for (const batch of chunks([...new Set(mints)], 50)) {
    const ids = batch.map((mint) => `solana:${mint}`).join(',');
    const response = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
    if (!response.ok) throw new Error(`price API: HTTP ${response.status}`);
    const body = await response.json();
    for (const [key, row] of Object.entries(body.coins || {})) prices[key.slice('solana:'.length)] = row;
  }
  return prices;
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const program = dlmm.createProgram(connection);
  const apiResponse = await fetch(DATA_API);
  if (!apiResponse.ok) throw new Error(`DLMM Data API: HTTP ${apiResponse.status}`);
  const apiBody = await apiResponse.json();
  const candidates = apiBody.data || [];
  if (candidates.length !== 100) throw new Error(`expected 100 candidate pools, received ${candidates.length}`);

  const programInfo = await connection.getAccountInfo(PROGRAM, 'confirmed');
  if (!programInfo || !programInfo.executable || programInfo.owner.toBase58() !== UPGRADEABLE_LOADER) {
    throw new Error('current program account is not executable upgradeable-loader state');
  }
  const programDataKey = new PublicKey(programInfo.data.subarray(4, 36));
  const programDataInfo = await connection.getAccountInfo(programDataKey, 'confirmed');
  if (!programDataInfo || programDataInfo.owner.toBase58() !== UPGRADEABLE_LOADER) throw new Error('ProgramData ownership mismatch');
  const executable = decodeUpgradeableProgram(programInfo, programDataInfo);

  const presetParameters = await program.account.presetParameter2.all();
  const pubkeys = uniquePublicKeys(candidates.flatMap((row) => [
    new PublicKey(row.address),
    new PublicKey(row.reserve_x),
    new PublicKey(row.reserve_y),
    new PublicKey(row.token_x.address),
    new PublicKey(row.token_y.address),
  ]));
  const infos = new Map();
  const accountSlots = [];
  for (const batch of chunks(pubkeys, 100)) {
    const response = await connection.getMultipleAccountsInfoAndContext(batch, 'confirmed');
    accountSlots.push(response.context.slot);
    response.value.forEach((info, index) => infos.set(batch[index].toBase58(), info));
  }

  const prices = await fetchPrices(candidates.flatMap((row) => [row.token_x.address, row.token_y.address]));
  const rows = [];
  for (const api of candidates) {
    const pairKey = new PublicKey(api.address);
    const pairInfo = infos.get(api.address);
    let account = null;
    let decodeError = null;
    try { account = pairInfo ? program.coder.accounts.decode('lbPair', pairInfo.data) : null; }
    catch (error) { decodeError = String(error?.message || error); }
    const pairOwnerVerified = pairInfo?.owner?.equals(PROGRAM) || false;
    const xMintInfo = parseMint(new PublicKey(api.token_x.address), infos.get(api.token_x.address));
    const yMintInfo = parseMint(new PublicKey(api.token_y.address), infos.get(api.token_y.address));
    const xReserveInfo = parseTokenAccount(new PublicKey(api.reserve_x), infos.get(api.reserve_x));
    const yReserveInfo = parseTokenAccount(new PublicKey(api.reserve_y), infos.get(api.reserve_y));
    const pda = account ? pairPdaProof(pairKey, account, presetParameters) : { verified: false };
    const derivedX = dlmm.deriveReserve(new PublicKey(api.token_x.address), pairKey, PROGRAM);
    const derivedY = dlmm.deriveReserve(new PublicKey(api.token_y.address), pairKey, PROGRAM);

    const stateMatchesApi = Boolean(account)
      && account.tokenXMint.equals(new PublicKey(api.token_x.address))
      && account.tokenYMint.equals(new PublicKey(api.token_y.address))
      && account.reserveX.equals(new PublicKey(api.reserve_x))
      && account.reserveY.equals(new PublicKey(api.reserve_y));
    const xControlVerified = Boolean(xReserveInfo && xMintInfo)
      && derivedX[0].toBase58() === api.reserve_x
      && xReserveInfo.mint === api.token_x.address
      && xReserveInfo.authority === api.address
      && xReserveInfo.ownerProgram === xMintInfo.ownerProgram;
    const yControlVerified = Boolean(yReserveInfo && yMintInfo)
      && derivedY[0].toBase58() === api.reserve_y
      && yReserveInfo.mint === api.token_y.address
      && yReserveInfo.authority === api.address
      && yReserveInfo.ownerProgram === yMintInfo.ownerProgram;
    const controlVerified = pairOwnerVerified && stateMatchesApi && pda.verified && xControlVerified && yControlVerified;

    const reserves = [
      { side: 'x', reserve: xReserveInfo, mint: xMintInfo, price: prices[api.token_x.address] || null },
      { side: 'y', reserve: yReserveInfo, mint: yMintInfo, price: prices[api.token_y.address] || null },
    ].map((entry) => {
      const raw = entry.reserve ? BigInt(entry.reserve.rawAmount) : 0n;
      const amount = entry.mint ? Number(raw) / (10 ** entry.mint.decimals) : null;
      return {
        side: entry.side,
        address: entry.reserve?.address || null,
        tokenProgram: entry.reserve?.ownerProgram || null,
        mint: entry.reserve?.mint || null,
        authority: entry.reserve?.authority || null,
        rawAmount: entry.reserve?.rawAmount || null,
        decimals: entry.mint?.decimals ?? null,
        amount,
        priceUsd: entry.price?.price ?? null,
        priceTimestamp: entry.price?.timestamp ?? null,
        usdValue: amount != null && entry.price?.price != null ? amount * entry.price.price : null,
      };
    });

    rows.push({
      rank: rows.length + 1,
      address: api.address,
      name: api.name,
      apiTvlUsd: api.tvl,
      pairOwnerVerified,
      stateMatchesApi,
      pda,
      reservePda: {
        x: { derived: derivedX[0].toBase58(), bump: derivedX[1], matches: derivedX[0].toBase58() === api.reserve_x },
        y: { derived: derivedY[0].toBase58(), bump: derivedY[1], matches: derivedY[0].toBase58() === api.reserve_y },
      },
      xControlVerified,
      yControlVerified,
      controlVerified,
      decodeError,
      reserves,
    });
  }

  const verified = rows.filter((row) => row.controlVerified);
  const uniqueVaults = new Map();
  for (const row of verified) {
    for (const reserve of row.reserves) if (reserve.address && !uniqueVaults.has(reserve.address)) uniqueVaults.set(reserve.address, reserve);
  }
  const vaults = [...uniqueVaults.values()];
  const priced = vaults.filter((row) => row.usdValue != null);
  const slot = await connection.getSlot('confirmed');
  const output = {
    observedAt: new Date().toISOString(),
    observedSlot: slot,
    accountSlotRange: [Math.min(...accountSlots), Math.max(...accountSlots)],
    rpc: RPC,
    dataApi: DATA_API,
    dataApiTotalPools: apiBody.total,
    candidateSelection: 'top 100 non-blacklisted pools ordered by Data API TVL descending; API TVL is discovery-only',
    pricingSource: 'https://coins.llama.fi/prices/current',
    program: {
      programId: PROGRAM.toBase58(),
      owner: programInfo.owner.toBase58(),
      executable: programInfo.executable,
      idlVersion: dlmm.IDL.metadata.version,
      sdkVersion: require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@meteora-ag/dlmm/package.json').version,
      ...executable,
    },
    summary: {
      candidatePools: candidates.length,
      authorityVerifiedPools: verified.length,
      excludedPools: rows.length - verified.length,
      authorityVerifiedVaults: vaults.length,
      pricedVerifiedVaults: priced.length,
      unpricedVerifiedVaults: vaults.length - priced.length,
      pricedGrossUsd: priced.reduce((sum, row) => sum + row.usdValue, 0),
      dataApiTvlSumUsdForVerifiedPools: verified.reduce((sum, row) => sum + Number(row.apiTvlUsd || 0), 0),
      pairTypeCounts: Object.fromEntries([...new Set(verified.map((row) => row.pda.pairType))].map((type) => [type, verified.filter((row) => row.pda.pairType === type).length])),
      topVerifiedVaults: priced.slice().sort((a, b) => b.usdValue - a.usdValue).slice(0, 12),
    },
    rows,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUT, program: output.program, summary: output.summary, accountSlotRange: output.accountSlotRange }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
