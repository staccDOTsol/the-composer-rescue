#!/usr/bin/env node
'use strict';

// Deduplicates route records and refreshes the small set of material live balances.
// Read-only RPC and public price API; no transaction construction or submission.
const fs = require('fs');
const path = require('path');

const RPC = process.env.SOLANA_RPC;
if (!RPC) throw new Error('SOLANA_RPC is required');
const directory = path.dirname(process.argv[1]);
const main = JSON.parse(fs.readFileSync(path.join(directory, 'mainnet-bridge-custody.json')));
const expansion = JSON.parse(fs.readFileSync(path.join(directory, 'bridge-expansion-custody.json')));
const marginfi = JSON.parse(fs.readFileSync(path.join(directory, 'marginfi-vaults-current.json')));
const project0Composition = JSON.parse(fs.readFileSync(path.join(directory, 'project0-v1-composition.json')));
const kaminoMutation = JSON.parse(fs.readFileSync(path.join(directory, 'kamino-flash-mutation.json')));
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const outputPath = process.argv[2] || path.join(directory, 'bridge-ranked-summary.json');

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const KAMINO_USDC_SUPPLY = '8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB';
let id = 1;
async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: id++, method, params}),
  });
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function tokenBalance(address) {
  const result = await rpc('getTokenAccountBalance', [address, {commitment: 'confirmed'}]);
  return {address, slot: result.context.slot, ...result.value};
}

async function transactionShape(signature) {
  const tx = await rpc('getTransaction', [signature, {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0}]);
  const message = tx.transaction.message;
  const loadedWritable = tx.meta.loadedAddresses?.writable?.length || 0;
  const loadedReadonly = tx.meta.loadedAddresses?.readonly?.length || 0;
  return {
    signature,
    slot: tx.slot,
    version: tx.version,
    staticAccountKeys: message.accountKeys.length,
    loadedWritable,
    loadedReadonly,
    totalResolvedAccounts: message.accountKeys.length + loadedWritable + loadedReadonly,
    topLevelInstructions: message.instructions.length,
    instructionDataBytes: message.instructions.map((instruction) => bs58.decode(instruction.data).length),
    computeUnitsConsumed: tx.meta.computeUnitsConsumed,
  };
}

async function pricesFor(mints) {
  const unique = [...new Set(mints)];
  const prices = {};
  for (let offset = 0; offset < unique.length; offset += 100) {
    const ids = unique.slice(offset, offset + 100).map((mint) => `solana:${mint}`).join(',');
    const response = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
    if (response.ok) Object.assign(prices, (await response.json()).coins || {});
  }
  return {unique, prices};
}

async function mainTask() {
  const cctpAccounts = [main.cctpV1.balances[0].address, main.cctpV2.balances[0].address];
  const cctp = await Promise.all(cctpAccounts.map(tokenBalance));
  const usdcPriceResponse = await pricesFor([USDC]);
  const usdcPrice = usdcPriceResponse.prices[`solana:${USDC}`]?.price ?? null;
  const cctpRows = cctp.map((row, index) => ({
    version: index === 0 ? 'CCTP V1' : 'CCTP V2',
    tokenMinterPda: index === 0 ? main.cctpV1.tokenMinter : main.cctpV2.tokenMinter,
    custody: row.address,
    slot: row.slot,
    rawAmount: row.amount,
    uiAmount: Number(row.uiAmountString),
    priceUsd: usdcPrice,
    valueUsd: usdcPrice == null ? null : Number(row.uiAmountString) * usdcPrice,
  }));

  const uniqueClassicVaults = [...new Map(main.allbridgeClassic.custody.map((row) => [row.address, row])).values()];
  const classicLocked = uniqueClassicVaults.map((row) => ({
    address: row.address,
    mint: row.mint,
    authority: row.authority,
    authorityMatches: row.authorityMatches,
    uiAmount: row.uiAmount,
    priceUsd: row.priceUsd,
    valueUsd: row.valueUsd,
  }));
  const uniqueWrapped = [...new Map(main.allbridgeClassic.wrapped.map((row) => [row.mint, row])).values()];
  const wrappedPricing = await pricesFor(uniqueWrapped.map((row) => row.mint));
  const classicMintRisk = uniqueWrapped.map((row) => {
    const supplyUi = Number(row.supply) / (10 ** row.decimals);
    const priceUsd = wrappedPricing.prices[`solana:${row.mint}`]?.price ?? null;
    return {...row, supplyUi, priceUsd, supplyValueUsd: priceUsd == null ? null : supplyUi * priceUsd};
  });

  const layerZeroAdapters = expansion.layerZeroOft.configs.filter((row) => row.kind === 'adapter-lock-release');
  const layerZeroNative = expansion.layerZeroOft.configs.filter((row) => row.kind === 'native-burn-mint');
  const mayanSampleRows = main.mayan.flatMap((program) => program.positiveTokenAccounts.map((row) => ({program: program.name, ...row})));
  const mayanSampleUnique = [...new Map(mayanSampleRows.map((row) => [row.address, row])).values()];

  const marginfiUsdc = marginfi.rows.filter((row) => row.kind === 'liquidity' && row.mint === USDC && row.controlVerified);
  const kaminoUsdc = await tokenBalance(KAMINO_USDC_SUPPLY);
  const cctpTransactionShapes = await Promise.all([
    transactionShape('2igvKXcwDZK6dsjAizaEMUpaRnZHTCgMo8jupj6cMWZKTBHYamJtbshYBX3P4BrwB3xKnhHoGMrAYAsuUCApBPM'),
    transactionShape('4zT1QRQYi6uw1YDUbZ9XDuQgozgSFnenu2Z3qadcc2j7CqboAaPW5BLoKjZc4UPKAARFvqgi2hue5Ac3EMQyp4bv'),
  ]);
  const summary = {
    generatedAt: new Date().toISOString(),
    rpcReadsOnly: true,
    cctp: {
      exactLocalTokenStateCount: main.cctpV1.exactLocalTokenCount + main.cctpV2.exactLocalTokenCount,
      rows: cctpRows,
      combinedUiAmount: cctpRows.reduce((sum, row) => sum + row.uiAmount, 0),
      combinedValueUsd: cctpRows.every((row) => row.valueUsd != null) ? cctpRows.reduce((sum, row) => sum + row.valueUsd, 0) : null,
    },
    allbridgeClassic: {
      exactAssetRecordCount: main.allbridgeClassic.exactAssetCount,
      nativeAssetRecordCount: main.allbridgeClassic.nativeAssetCount,
      exactDistinctNativeVaultCount: classicLocked.length,
      locked: classicLocked,
      pricedLockedValueUsd: classicLocked.reduce((sum, row) => sum + (row.valueUsd || 0), 0),
      wrappedAssetRecordCount: main.allbridgeClassic.wrappedAssetCount,
      exactDistinctWrappedMintCount: classicMintRisk.length,
      mintRisk: classicMintRisk,
      pricedMintRiskSupplyValueUsd: classicMintRisk.reduce((sum, row) => sum + (row.supplyValueUsd || 0), 0),
      unpricedPositiveMintRiskCount: classicMintRisk.filter((row) => row.supplyUi > 0 && row.priceUsd == null).length,
    },
    allbridgeCore: {
      exactPoolStateCount: main.allbridgeCore.exactPoolCount,
      poolStates: main.allbridgeCore.pools,
      derivedTokenAccounts: main.allbridgeCore.custody,
      liveCustodyAccountCount: main.allbridgeCore.custody.filter((row) => row.exists !== false).length,
      conclusion: 'Both legacy pool states derive to closed/missing bridge-token PDAs; accounting tokenBalance fields are not counted as custody.',
    },
    layerZero: {
      exactOftConfigCount: expansion.layerZeroOft.exactOftConfigCount,
      exactAdapterCount: expansion.layerZeroOft.exactAdapterCount,
      exactNativeCount: expansion.layerZeroOft.exactNativeCount,
      adapters: layerZeroAdapters,
      nativeMintRisk: layerZeroNative,
      pricedLockedValueUsd: layerZeroAdapters.reduce((sum, row) => sum + (row.lockedValueUsd || 0), 0),
      unpricedPositiveAdapterCount: layerZeroAdapters.filter((row) => row.escrowAmountUi > 0 && row.priceUsd == null).length,
      pricedNativeMintRiskSupplyValueUsd: layerZeroNative.reduce((sum, row) => sum + (row.mintRiskSupplyValueUsd || 0), 0),
      unpricedPositiveNativeMintRiskCount: layerZeroNative.filter((row) => row.supplyUi > 0 && row.priceUsd == null).length,
    },
    mayanBoundedOwnerScan: {
      programs: main.mayan.map((row) => ({name: row.name, exactProgramAccountCount: row.exactProgramAccountCount, scannedOwnerCount: row.scannedOwnerCount, fullOwnerScan: row.fullOwnerScan, positiveTokenAccounts: row.positiveTokenAccounts.length})),
      distinctPositiveTokenAccountsObserved: mayanSampleUnique.length,
      pricedObservedValueUsd: mayanSampleUnique.reduce((sum, row) => sum + (row.valueUsd || 0), 0),
      unpricedPositiveTokenAccountsObserved: mayanSampleUnique.filter((row) => row.valueUsd == null).length,
    },
    flashLiquidityScreen: {
      usdcMint: USDC,
      marginfiProject0: {
        evidenceSlot: marginfi.observationSlot,
        exactVerifiedPositiveLiquidityVaultCount: marginfiUsdc.length,
        aggregateCustodyUiUsdc: marginfiUsdc.reduce((sum, row) => sum + Number(row.rawAmount) / 1e6, 0),
        availabilityQualification: 'Program-controlled liquidity is not by itself proof that every bank permits an uncollateralized flash route; only a separate wSOL Project 0 v1 composition was positively simulated.',
      },
      kamino: {
        supplyAccount: KAMINO_USDC_SUPPLY,
        slot: kaminoUsdc.slot,
        availableCustodyUiUsdc: Number(kaminoUsdc.uiAmountString),
        availabilityQualification: 'A same-reserve borrow/repay positive simulation exists; maximum borrow remains bounded by current reserve rules and fees.',
      },
      transactionShapeEvidence: {
        cctpPositiveControls: cctpTransactionShapes,
        project0V1StandaloneFlash: project0Composition.cases.find((row) => row.name === 'start_borrow_repay_end'),
        project0V1ComposedReference: project0Composition.cases.find((row) => row.name === 'start_borrow_vault_borrow_repay_end'),
        kaminoPositiveDirectPair: kaminoMutation.results.find((row) => row.label === 'positive_direct_pair'),
      },
      atomicRouteConclusion: 'The v1 transport envelope has ample mechanical room in the observed controls, but CCTP custody exits require a Circle-attested message bound to recipient/amount and replay protection; flash liquidity cannot supply that authorization. No unauthorized withdrawal/claim/settlement route was reached.',
    },
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({
    outputPath,
    cctp: summary.cctp,
    allbridgeClassic: {
      vaults: summary.allbridgeClassic.exactDistinctNativeVaultCount,
      lockedUsd: summary.allbridgeClassic.pricedLockedValueUsd,
      wrappedMints: summary.allbridgeClassic.exactDistinctWrappedMintCount,
      mintRiskPricedUsd: summary.allbridgeClassic.pricedMintRiskSupplyValueUsd,
      unpricedPositiveMintRiskCount: summary.allbridgeClassic.unpricedPositiveMintRiskCount,
    },
    allbridgeCore: summary.allbridgeCore,
    layerZero: {
      configs: summary.layerZero.exactOftConfigCount,
      pricedLockedValueUsd: summary.layerZero.pricedLockedValueUsd,
      unpricedPositiveAdapterCount: summary.layerZero.unpricedPositiveAdapterCount,
    },
    mayan: summary.mayanBoundedOwnerScan,
    flash: summary.flashLiquidityScreen,
  }, null, 2));
}

mainTask().catch((error) => { console.error(error.stack || error); process.exit(1); });
