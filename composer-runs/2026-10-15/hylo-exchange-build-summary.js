#!/usr/bin/env node
// Builds the compact machine-readable audit result from the detailed evidence files.
'use strict';

const fs = require('fs');

const ROOT = __dirname;
const SIM_PATH = `${ROOT}/hylo-exchange-klend-v1-sim.json`;
const LIQUIDITY_PATH = `${ROOT}/hylo-exchange-jitosol-liquidity.json`;
const DEPLOYMENT_PATH = `${ROOT}/hylo-exchange-deployment-attestation.json`;
const OUTPUT_PATH = `${ROOT}/hylo-exchange-audit-summary.json`;

const sim = JSON.parse(fs.readFileSync(SIM_PATH, 'utf8'));
const liquidity = JSON.parse(fs.readFileSync(LIQUIDITY_PATH, 'utf8'));
const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf8'));
const byLabel = new Map(sim.cases.map(testCase => [testCase.label, testCase]));

function requireCase(label) {
  const testCase = byLabel.get(label);
  if (!testCase) throw new Error(`Missing simulation case: ${label}`);
  return testCase;
}

function decimal(raw, decimals) {
  const value = BigInt(raw);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = magnitude / base;
  const fraction = (magnitude % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function selectedCase(label) {
  const testCase = requireCase(label);
  return {
    label,
    slot: testCase.slot,
    err: testCase.err,
    wire: {
      version: 1,
      sizeBytes: testCase.sizeBytes,
      maximumBytes: 4096,
      accountCount: testCase.addressCount,
      instructionCount: testCase.instructionCount,
      sha256: testCase.wireSha256,
    },
    flashAmountRaw: testCase.flashAmountRaw || null,
    fullRepaymentProven: testCase.fullRepaymentProven === true,
    outsiderNetAssetGain: testCase.outsiderNetAssetGain === true,
    balanceDeltasRaw: testCase.balanceDeltasRaw,
  };
}

const fullRoundTripLabels = [
  'lever_dust_10_raw_flash_mint_redeem_full_repay',
  'lever_one_jitosol_flash_mint_redeem_full_repay',
  'lever_hundred_jitosol_flash_mint_redeem_full_repay',
  'lever_near_liquidity_90pct_flash_mint_redeem_full_repay',
  'lever_near_liquidity_minus_one_flash_mint_redeem_full_repay',
  'lever_exact_liquidity_flash_mint_redeem_full_repay',
];
const fullRoundTrips = fullRoundTripLabels.map(selectedCase);

const oneJitoQuote = requireCase('lever_one_jitosol_flash_mint_quote_then_repay');
const twoCycle = requireCase('lever_ordering_two_sequential_mint_redeem_cycles_full_repay');
const residualXsolRaw = BigInt(twoCycle.balanceDeltasRaw.outsider_xsol);
const oneJitoMintedXsolRaw = BigInt(oneJitoQuote.derivedMintedXsolRaw);
const residualXsolJitoEquivalentRawFloor = residualXsolRaw * 1_000_000_000n / oneJitoMintedXsolRaw;
const twoCycleNetJitoEquivalentRawUpperBound = BigInt(twoCycle.balanceDeltasRaw.outsider_jitosol)
  + residualXsolJitoEquivalentRawFloor;

const stableSmall = requireCase('one_jitosol_flash_mint_redeem_full_repay');
const stableLarge = requireCase('near_liquidity_90pct_flash_mint_quote_then_repay');
const historicalOracle = requireCase('lever_oracle_substitution_verified_historical_same_feed');
const wrongVault = requireCase('lever_account_substitution_hylo_lst_vault_with_klend_supply_vault');
const wrongHeader = requireCase('lever_account_substitution_redeem_lst_header_with_hylo_state');
const wrongOracleOwner = requireCase('lever_account_substitution_sol_usd_feed_with_lst_header');
const redeemBeforeMint = requireCase('lever_ordering_redeem_before_mint');
const repayBeforeRedeem = requireCase('lever_ordering_repay_before_redeem');

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  target: {
    chain: 'Solana mainnet',
    programId: sim.programs.hylo,
    asset: sim.mints.jitosol,
  },
  verdict: {
    status: 'no_validated_outsider_unauthorized_net_asset_gain_in_tested_scope',
    validatedFindings: [],
    reportableOutsiderGainObserved: false,
    confidence: 'high for the exercised JitoSOL/xSOL mint-redeem surface; limited for unexercised instructions because the current on-chain processor source was not reproducibly matched',
  },
  safety: {
    readOnlyMainnetSimulationOnly: true,
    noTransactionsSubmitted: sim.noTransactionsSubmitted === true,
    operatorContacted: false,
    rpcEndpointRedacted: true,
    simulationSignatureVerificationDisabled: true,
    signerModel: sim.signerModel,
  },
  liveCustody: {
    observationSlot: liquidity.observations.liquidityAccountsSlot,
    vault: liquidity.addresses.hyloJitosolVault,
    vaultAuthority: sim.accounts.vaultAuth,
    mint: liquidity.addresses.poolMint,
    raw: liquidity.hyloVault.jitosolRaw,
    jitosol: liquidity.hyloVault.jitosol,
    nominalSolBackingBeforePoolFee: liquidity.hyloVault.nominalBackingSolBeforePoolFee,
    censusGrossUsdApprox: '31821000',
    sameMintCensusInventoryUsdApprox: {
      kamino: '120158000',
      project0: '7587000',
      total: '127745000',
      caveat: 'Census inventory is routing context, not a proof that the entire amount is flash-borrowable.',
    },
  },
  atomicHarness: {
    transport: sim.transport,
    observationSlot: sim.preObservationSlot,
    flashProvider: 'Kamino Lend v2',
    flashReserve: sim.klendReserve.reserve,
    flashMint: sim.klendReserve.mint,
    flashFeeRateScaledFraction: sim.klendReserve.currentFlashFeeSf,
    flashFeeExactlyZero: sim.klendReserve.currentFlashFeeExactZero,
    availableRaw: sim.klendReserve.currentAvailableRaw,
    availableJitosol: decimal(sim.klendReserve.currentAvailableRaw, 9),
    operation: 'ATA idempotent create -> KLend flash borrow JitoSOL -> Hylo mint xSOL -> Hylo redeem all minted xSOL -> KLend exact repay',
    successfulFullRoundTrips: fullRoundTrips,
    invariantAcrossSuccessfulFullRoundTrips: {
      klendSupplyVaultDeltaRaw: '0',
      klendFeeVaultDeltaRaw: '0',
      callerXsolDeltaRaw: '0',
      callerJitosolDeltaAlwaysNegative: true,
    },
  },
  sameTransactionOrdering: {
    redeemBeforeMint: {
      slot: redeemBeforeMint.slot,
      result: 'rejected and atomically rolled back',
      error: redeemBeforeMint.err,
    },
    repayBeforeRedeem: {
      slot: repayBeforeRedeem.slot,
      result: 'accepted using the caller pre-balance, then redeemed; full lender balances restored and caller JitoSOL delta remained negative',
      balanceDeltasRaw: repayBeforeRedeem.balanceDeltasRaw,
    },
    twoSequentialCycles: {
      slot: twoCycle.slot,
      result: 'accepted and fully repaid; residual xSOL dust did not offset the JitoSOL loss',
      wireSizeBytes: twoCycle.sizeBytes,
      balanceDeltasRaw: twoCycle.balanceDeltasRaw,
      valuationControl: {
        oneJitosolMintQuoteXsolRaw: oneJitoMintedXsolRaw.toString(),
        residualXsolJitosolEquivalentRawFloorAtObservedMintRate: residualXsolJitoEquivalentRawFloor.toString(),
        netJitosolEquivalentRawUpperBound: twoCycleNetJitoEquivalentRawUpperBound.toString(),
        netJitosolEquivalentUpperBound: decimal(twoCycleNetJitoEquivalentRawUpperBound, 9),
        note: 'Using the mint rate overvalues the residual for this control because a redeem also charges fees.',
      },
    },
  },
  stablecoinPath: {
    smallRoundTrip: {
      slot: stableSmall.slot,
      result: 'rejected and atomically rolled back',
      error: stableSmall.err,
      errorName: 'NoValidStablecoinRedeemFee',
      reason: 'projected collateral ratio above the configured redeem-fee curve domain',
    },
    nearLiquidityMint: {
      slot: stableLarge.slot,
      result: 'rejected and atomically rolled back',
      error: stableLarge.err,
      errorName: 'NoValidStablecoinMintFee',
      reason: 'projected collateral ratio below the configured mint-fee curve domain',
    },
    outsiderGainObserved: false,
  },
  accountAndOracleControls: {
    wrongVault: {error: wrongVault.err, result: 'rejected by token owner/associated-account constraint'},
    wrongLstHeader: {error: wrongHeader.err, result: 'rejected by Anchor discriminator constraint'},
    wrongOracleOwner: {error: wrongOracleOwner.err, result: 'rejected by Pyth Receiver owner constraint'},
    verifiedHistoricalSameFeedAccount: {
      substitutedAddress: sim.accounts.historicalSameFeedControl,
      canonicalAddress: sim.accounts.solUsdPythFeed,
      error: historicalOracle.err,
      result: 'rejected by static address constraint before freshness evaluation',
    },
    publicMathFreshnessChecks: [
      'positive price and supported exponent',
      'publish-time interval',
      'posted-slot interval and no future slot',
      'confidence tolerance',
    ],
  },
  jitosolRedemptionAndLiquidity: {
    observationSlots: liquidity.observations,
    identityChecks: liquidity.identityChecks,
    totalPoolSol: liquidity.backing.totalSol,
    immediateDirectSolBeforePoolFee: liquidity.directSolLiquidity.immediatelyWithdrawableSolBeforePoolFee,
    immediateDirectSolCoverageBpsOfHyloVault: liquidity.hyloVault.immediateReserveCoverageBpsBeforePoolFee,
    immediateDirectSolCoversFullHyloVault: liquidity.hyloVault.immediateReserveCanCoverFullHyloVaultBeforePoolFee,
    solWithdrawalFee: liquidity.directSolLiquidity.solWithdrawalFee,
    alternateExit: 'Permissionless withdraw-stake can return delegated stake inventory, but realization as liquid SOL requires stake deactivation/cooldown.',
    exploitHarnessDenomination: 'JitoSOL; no JitoSOL-to-SOL exit was required to repay the flash liability.',
  },
  deploymentAndSource: {
    program: deployment.program,
    localDump: deployment.localMainnetDump,
    publicSdk: deployment.publicSdk,
    december2025Audit: deployment.december2025Audit,
    verifiedBuildRegistry: {
      isVerified: deployment.verifiedBuildRegistry.status.body.is_verified,
      message: deployment.verifiedBuildRegistry.status.body.message,
      programBuildCount: deployment.verifiedBuildRegistry.statusAll.body.length,
      currentHashBuildCount: deployment.verifiedBuildRegistry.currentHashResolution.body.builds.length,
    },
    sourceToCurrentBinaryMatchEstablished: false,
  },
  publicSdkTests: {
    command: 'cargo test -p hylo-core',
    result: 'pass',
    passed: 221,
    failed: 0,
    ignored: 2,
    notes: [
      'The public conversion property test asserts token_to_lst(lst_to_token(x)) <= x.',
      'These tests increase confidence in published math but do not prove that the unmatched current executable was built from that source.',
    ],
  },
  limitations: [
    'No reproducible source-to-current-binary match was available; the public SDK contains IDL/client/math code but not the full on-chain processor.',
    'The current executable hash differs from the December 2025 audit-attested build hash, and the public verified-build registry returned no build for it.',
    'Read-only simulation used sigVerify=false and a real on-curve system-owned outsider account model; no private key was used and no transaction was submitted.',
    'The conclusion is not a claim that all 77 IDL instructions or all economic states are vulnerability-free.',
    'An upgrade-authority/operator path is intentionally not treated as an outsider finding.',
  ],
  artifacts: {
    report: `${ROOT}/hylo-exchange-security-audit.md`,
    detailedSimulation: SIM_PATH,
    simulationHarness: `${ROOT}/hylo-exchange-klend-v1-sim.js`,
    transactionV1Encoder: `${ROOT}/hylo-exchange-v1-wire.js`,
    liveProbe: `${ROOT}/hylo-exchange-live-probe.js`,
    instructionMap: `${ROOT}/hylo-exchange-instruction-map.json`,
    jitosolLiquidityProbe: `${ROOT}/hylo-exchange-jitosol-liquidity.js`,
    jitosolLiquidity: LIQUIDITY_PATH,
    deploymentProbe: `${ROOT}/hylo-exchange-deployment-attestation.js`,
    deploymentAttestation: DEPLOYMENT_PATH,
    currentExecutableDump: `${ROOT}/hylo-exchange-current.so`,
    publicSdkCheckout: `${ROOT}/hylo-exchange-sdk-source`,
  },
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  output: OUTPUT_PATH,
  status: summary.verdict.status,
  successfulFullRoundTrips: fullRoundTrips.length,
  exactLiquidityJitosol: summary.atomicHarness.availableJitosol,
  exactLiquidityCallerDeltaRaw: fullRoundTrips.at(-1).balanceDeltasRaw.outsider_jitosol,
}, null, 2)}\n`);
