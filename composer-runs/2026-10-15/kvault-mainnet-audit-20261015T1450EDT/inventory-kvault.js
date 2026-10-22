#!/usr/bin/env node

// Read-only current-mainnet custody inventory for Kamino Kvault.
const fs = require("fs");
const crypto = require("crypto");
const {
  Connection,
  PublicKey,
} = require("/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js");
const bs = require("/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58");
const bs58 = bs.default || bs;

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const OUTPUT = process.argv[2];
if (!OUTPUT) throw new Error("usage: inventory-kvault.js OUTPUT.json");

const KVAULT = new PublicKey("KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd");
const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const ZERO = new PublicKey(Buffer.alloc(32));
const VAULT_ACCOUNT_SIZE = 8 + 62544;
const VAULT_ALLOCATION_OFFSET = 8 + 304;
const VAULT_ALLOCATION_SIZE = 2160;
const MAX_RESERVES = 25;
const Q60 = 1n << 60n;

function discriminator(namespace, name) {
  return crypto.createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);
}

function pubkey(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function u64(data, offset) {
  return data.readBigUInt64LE(offset);
}

function u128(data, offset) {
  return u64(data, offset) | (u64(data, offset + 8) << 64n);
}

function fixed60(bits, digits = 6) {
  const whole = bits / Q60;
  const frac = ((bits % Q60) * (10n ** BigInt(digits))) / Q60;
  return `${whole}.${frac.toString().padStart(digits, "0")}`;
}

function tokenAccount(data) {
  if (!data || data.length < 72) return null;
  return {
    mint: pubkey(data, 0).toBase58(),
    authority: pubkey(data, 32).toBase58(),
    amountRaw: u64(data, 64),
  };
}

function vaultState(address, data, accountOwner) {
  if (!data.subarray(0, 8).equals(discriminator("account", "VaultState"))) {
    throw new Error(`bad VaultState discriminator: ${address}`);
  }
  const state = {
    address,
    accountOwner,
    vaultAdminAuthority: pubkey(data, 8).toBase58(),
    baseVaultAuthority: pubkey(data, 40).toBase58(),
    baseVaultAuthorityBump: u64(data, 72),
    tokenMint: pubkey(data, 80).toBase58(),
    tokenMintDecimals: u64(data, 112),
    tokenVault: pubkey(data, 120).toBase58(),
    tokenProgram: pubkey(data, 152).toBase58(),
    sharesMint: pubkey(data, 184).toBase58(),
    sharesMintDecimals: u64(data, 216),
    tokenAvailableRaw: u64(data, 224),
    sharesIssuedRaw: u64(data, 232),
    availableCrankFundsRaw: u64(data, 240),
    unallocatedWeight: u64(data, 248),
    performanceFeeBps: u64(data, 256),
    managementFeeBps: u64(data, 264),
    lastFeeChargeTimestamp: u64(data, 272),
    previousAumRaw: fixed60(u128(data, 280)),
    pendingFeesRaw: fixed60(u128(data, 296)),
    minDepositAmountRaw: u64(data, 58408),
    minWithdrawAmountRaw: u64(data, 58416),
    minInvestAmountRaw: u64(data, 58424),
    minInvestDelaySlots: u64(data, 58432),
    crankFundFeePerReserveRaw: u64(data, 58440),
    pendingAdmin: pubkey(data, 58448).toBase58(),
    name: data.subarray(58528, 58568).toString("utf8").replace(/\0.*$/, ""),
    vaultLookupTable: pubkey(data, 58568).toBase58(),
    vaultFarm: pubkey(data, 58600).toBase58(),
    creationTimestamp: u64(data, 58632),
    unallocatedTokensCapRaw: u64(data, 58640),
    allocationAdmin: pubkey(data, 58648).toBase58(),
    withdrawalPenaltyLamports: u64(data, 58680),
    withdrawalPenaltyBps: u64(data, 58688),
    firstLossCapitalFarm: pubkey(data, 58696).toBase58(),
    allowAllocationsInWhitelistedReservesOnly: data[58728],
    allowInvestInWhitelistedReservesOnly: data[58729],
    depositCapRaw: u64(data, 58736),
    rewardPerSecondRaw: u64(data, 58744),
    rewardLastIssuanceTimestamp: u64(data, 58752),
    rewardsAvailableRaw: u64(data, 58760),
    permissioningAuthority: pubkey(data, 58840).toBase58(),
    allocations: [],
  };
  for (let index = 0; index < MAX_RESERVES; index += 1) {
    const offset = VAULT_ALLOCATION_OFFSET + index * VAULT_ALLOCATION_SIZE;
    const reserve = pubkey(data, offset);
    if (reserve.equals(ZERO)) continue;
    state.allocations.push({
      index,
      reserve: reserve.toBase58(),
      ctokenVault: pubkey(data, offset + 32).toBase58(),
      targetAllocationWeight: u64(data, offset + 64),
      tokenAllocationCapRaw: u64(data, offset + 72),
      ctokenVaultBump: u64(data, offset + 80),
      ctokenAllocationCapRaw: u64(data, offset + 88),
      ctokenAllocationRawCached: u64(data, offset + 1104),
      lastInvestSlot: u64(data, offset + 1112),
    });
  }
  return state;
}

function reserveState(address, info) {
  if (!info || info.data.length < 8 + 8616) return {address, error: "missing_or_wrong_size"};
  const data = info.data;
  if (!data.subarray(0, 8).equals(discriminator("account", "Reserve"))) {
    return {address, error: "bad_discriminator"};
  }
  const availableRaw = u64(data, 224);
  const borrowedSf = u128(data, 232);
  const protocolFeesSf = u128(data, 344);
  const referrerFeesSf = u128(data, 360);
  const pendingReferrerFeesSf = u128(data, 376);
  const totalLiquiditySf = (availableRaw << 60n) + borrowedSf
    - protocolFeesSf - referrerFeesSf - pendingReferrerFeesSf;
  return {
    address,
    accountOwner: info.owner.toBase58(),
    lendingMarket: pubkey(data, 32).toBase58(),
    liquidityMint: pubkey(data, 128).toBase58(),
    liquiditySupplyVault: pubkey(data, 160).toBase58(),
    availableRaw,
    borrowedRaw: fixed60(borrowedSf),
    protocolFeesRaw: fixed60(protocolFeesSf),
    referrerFeesRaw: fixed60(referrerFeesSf),
    pendingReferrerFeesRaw: fixed60(pendingReferrerFeesSf),
    totalLiquiditySf,
    marketPrice: fixed60(u128(data, 248), 9),
    marketPriceLastUpdatedTimestamp: u64(data, 264),
    mintDecimals: u64(data, 272),
    collateralMint: pubkey(data, 2560).toBase58(),
    collateralMintTotalSupplyRaw: u64(data, 2592),
    collateralSupplyVault: pubkey(data, 2600).toBase58(),
  };
}

async function getMultiple(connection, keys) {
  const out = new Map();
  for (let start = 0; start < keys.length; start += 100) {
    const chunk = keys.slice(start, start + 100);
    const infos = await connection.getMultipleAccountsInfo(chunk.map((key) => new PublicKey(key)), "finalized");
    infos.forEach((info, index) => out.set(chunk[index], info));
  }
  return out;
}

async function getPrices(mints) {
  const prices = {};
  for (let start = 0; start < mints.length; start += 30) {
    const chunk = mints.slice(start, start + 30);
    const ids = chunk.map((mint) => `solana:${mint}`).join(",");
    const response = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
    if (!response.ok) throw new Error(`DefiLlama price HTTP ${response.status}`);
    const body = await response.json();
    Object.assign(prices, body.coins || {});
  }
  return prices;
}

function decimalAmount(raw, decimals) {
  return Number(raw) / (10 ** Number(decimals));
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

(async () => {
  const connection = new Connection(RPC, "finalized");
  const slotBefore = await connection.getSlot("finalized");
  const programAccounts = await connection.getProgramAccounts(KVAULT, {
    commitment: "finalized",
    filters: [
      {dataSize: VAULT_ACCOUNT_SIZE},
      {memcmp: {offset: 0, bytes: bs58.encode(discriminator("account", "VaultState"))}},
    ],
  });
  const vaults = programAccounts.map(({pubkey: key, account}) =>
    vaultState(key.toBase58(), account.data, account.owner.toBase58()));

  const tokenAccountKeys = [...new Set(vaults.flatMap((vault) => [
    vault.tokenVault,
    ...vault.allocations.map((allocation) => allocation.ctokenVault),
  ]))];
  const reserveKeys = [...new Set(vaults.flatMap((vault) => vault.allocations.map((allocation) => allocation.reserve)))];
  const tokenInfos = await getMultiple(connection, tokenAccountKeys);
  const reserveInfos = await getMultiple(connection, reserveKeys);
  const reserves = new Map(reserveKeys.map((address) => [address, reserveState(address, reserveInfos.get(address))]));
  const prices = await getPrices([...new Set(vaults.map((vault) => vault.tokenMint))]);

  const violations = [];
  let totalCustodyUsd = 0;
  let totalDirectUsd = 0;
  for (const vault of vaults) {
    const vaultKey = new PublicKey(vault.address);
    const [expectedAuthority, expectedAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("authority"), vaultKey.toBuffer()], KVAULT);
    const [expectedTokenVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault"), vaultKey.toBuffer()], KVAULT);
    const [expectedSharesMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("shares"), vaultKey.toBuffer()], KVAULT);
    const directInfo = tokenInfos.get(vault.tokenVault);
    const direct = directInfo ? tokenAccount(directInfo.data) : null;
    vault.pdaChecks = {
      stateOwnedByKvault: vault.accountOwner === KVAULT.toBase58(),
      baseAuthorityMatches: vault.baseVaultAuthority === expectedAuthority.toBase58(),
      baseAuthorityBumpMatches: Number(vault.baseVaultAuthorityBump) === expectedAuthorityBump,
      tokenVaultMatches: vault.tokenVault === expectedTokenVault.toBase58(),
      sharesMintMatches: vault.sharesMint === expectedSharesMint.toBase58(),
    };
    vault.directTokenAccount = direct ? {
      ...direct,
      accountOwnerProgram: directInfo.owner.toBase58(),
      mintMatches: direct.mint === vault.tokenMint,
      authorityMatches: direct.authority === vault.baseVaultAuthority,
      tokenProgramMatches: directInfo.owner.toBase58() === vault.tokenProgram,
    } : null;
    let custodyRaw = direct ? direct.amountRaw : 0n;
    vault.allocationCustody = [];
    for (const allocation of vault.allocations) {
      const reserve = reserves.get(allocation.reserve);
      const accountInfo = tokenInfos.get(allocation.ctokenVault);
      const account = accountInfo ? tokenAccount(accountInfo.data) : null;
      const [expectedCtokenVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("ctoken_vault"), vaultKey.toBuffer(), new PublicKey(allocation.reserve).toBuffer()], KVAULT);
      let underlyingRaw = 0n;
      if (account && reserve && !reserve.error && reserve.collateralMintTotalSupplyRaw > 0n) {
        underlyingRaw = (account.amountRaw * reserve.totalLiquiditySf)
          / reserve.collateralMintTotalSupplyRaw / Q60;
      }
      custodyRaw += underlyingRaw;
      const result = {
        ...allocation,
        expectedCtokenVault: expectedCtokenVault.toBase58(),
        pdaMatches: allocation.ctokenVault === expectedCtokenVault.toBase58(),
        tokenAccount: account ? {
          ...account,
          accountOwnerProgram: accountInfo.owner.toBase58(),
          authorityMatches: account.authority === vault.baseVaultAuthority,
          mintMatchesReserve: reserve && !reserve.error ? account.mint === reserve.collateralMint : false,
        } : null,
        reserve,
        reserveOwnedByKlend: reserve && !reserve.error ? reserve.accountOwner === KLEND.toBase58() : false,
        reserveUnderlyingMatchesVault: reserve && !reserve.error ? reserve.liquidityMint === vault.tokenMint : false,
        underlyingRaw,
      };
      vault.allocationCustody.push(result);
    }
    const price = prices[`solana:${vault.tokenMint}`] || null;
    vault.priceEvidence = price;
    vault.directAmount = decimalAmount(direct ? direct.amountRaw : 0n, vault.tokenMintDecimals);
    vault.custodyAmount = decimalAmount(custodyRaw, vault.tokenMintDecimals);
    vault.directUsd = price ? vault.directAmount * price.price : null;
    vault.custodyUsd = price ? vault.custodyAmount * price.price : null;
    if (vault.directUsd !== null) totalDirectUsd += vault.directUsd;
    if (vault.custodyUsd !== null) totalCustodyUsd += vault.custodyUsd;

    const checks = Object.entries(vault.pdaChecks).filter(([, ok]) => !ok).map(([name]) => name);
    if (!vault.directTokenAccount) checks.push("missing_direct_token_account");
    else {
      if (!vault.directTokenAccount.mintMatches) checks.push("direct_token_mint_mismatch");
      if (!vault.directTokenAccount.authorityMatches) checks.push("direct_token_authority_mismatch");
      if (!vault.directTokenAccount.tokenProgramMatches) checks.push("direct_token_program_mismatch");
    }
    for (const allocation of vault.allocationCustody) {
      if (!allocation.pdaMatches) checks.push(`allocation_${allocation.index}_pda_mismatch`);
      if (!allocation.tokenAccount) checks.push(`allocation_${allocation.index}_missing_token_account`);
      else {
        if (!allocation.tokenAccount.authorityMatches) checks.push(`allocation_${allocation.index}_authority_mismatch`);
        if (!allocation.tokenAccount.mintMatchesReserve) checks.push(`allocation_${allocation.index}_mint_mismatch`);
      }
      if (!allocation.reserveOwnedByKlend) checks.push(`allocation_${allocation.index}_reserve_owner_mismatch`);
      if (!allocation.reserveUnderlyingMatchesVault) checks.push(`allocation_${allocation.index}_underlying_mismatch`);
    }
    if (checks.length) violations.push({vault: vault.address, checks});
  }
  vaults.sort((a, b) => (b.custodyUsd ?? -1) - (a.custodyUsd ?? -1));
  const slotAfter = await connection.getSlot("finalized");
  const result = {
    generatedAt: new Date().toISOString(),
    rpc: RPC,
    commitment: "finalized",
    slotBefore,
    slotAfter,
    kvaultProgram: KVAULT.toBase58(),
    klendProgram: KLEND.toBase58(),
    sourceLayoutRevision: "2dadf9449d32cfaa2ad5d1540c8edff378512c8c",
    vaultCount: vaults.length,
    distinctUnderlyingMints: [...new Set(vaults.map((vault) => vault.tokenMint))].length,
    distinctReserveCount: reserveKeys.length,
    totalDirectUsd,
    totalProgramControlledCustodyUsd: totalCustodyUsd,
    priceSource: "https://coins.llama.fi/prices/current/{chain}:{address}",
    controlViolationCount: violations.length,
    controlViolations: violations,
    topVaults: vaults.slice(0, 25).map((vault) => ({
      address: vault.address,
      name: vault.name,
      tokenMint: vault.tokenMint,
      tokenMintDecimals: vault.tokenMintDecimals,
      sharesMint: vault.sharesMint,
      vaultAdminAuthority: vault.vaultAdminAuthority,
      allocationAdmin: vault.allocationAdmin,
      permissioningAuthority: vault.permissioningAuthority,
      directAmount: vault.directAmount,
      custodyAmount: vault.custodyAmount,
      directUsd: vault.directUsd,
      custodyUsd: vault.custodyUsd,
      allocationCount: vault.allocations.length,
      pdaChecks: vault.pdaChecks,
      directTokenAccount: vault.directTokenAccount,
      priceEvidence: vault.priceEvidence,
      allocations: vault.allocationCustody.map((allocation) => ({
        index: allocation.index,
        reserve: allocation.reserve,
        ctokenVault: allocation.ctokenVault,
        pdaMatches: allocation.pdaMatches,
        ctokenAmountRaw: allocation.tokenAccount?.amountRaw ?? null,
        ctokenAuthorityMatches: allocation.tokenAccount?.authorityMatches ?? false,
        ctokenMintMatchesReserve: allocation.tokenAccount?.mintMatchesReserve ?? false,
        reserveOwnedByKlend: allocation.reserveOwnedByKlend,
        reserveUnderlyingMatchesVault: allocation.reserveUnderlyingMatchesVault,
        underlyingRaw: allocation.underlyingRaw,
        reserveLendingMarket: allocation.reserve?.lendingMarket ?? null,
      })),
    })),
    vaults,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, jsonReplacer, 2)}\n`, {flag: "wx"});
  process.stdout.write(`${JSON.stringify({
    generatedAt: result.generatedAt,
    slotBefore,
    slotAfter,
    vaultCount: result.vaultCount,
    distinctUnderlyingMints: result.distinctUnderlyingMints,
    distinctReserveCount: result.distinctReserveCount,
    totalDirectUsd,
    totalProgramControlledCustodyUsd: totalCustodyUsd,
    controlViolationCount: violations.length,
    topVaults: result.topVaults.slice(0, 10).map(({address, name, tokenMint, directUsd, custodyUsd, allocationCount}) =>
      ({address, name, tokenMint, directUsd, custodyUsd, allocationCount})),
  }, null, 2)}\n`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
