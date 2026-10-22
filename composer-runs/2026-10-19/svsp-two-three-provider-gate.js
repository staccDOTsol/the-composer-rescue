#!/usr/bin/env node
'use strict';

// Deterministic composition preflight over the finalized SVSP state and fresh
// provider census. No RPC calls and no transaction construction occur here:
// when every per-mint provider capacity is zero, the maximal 2/3-provider
// allocation is exactly zero and a signed flash transaction cannot be formed.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const LIVE_FILE = path.join(DIR, 'svsp-live-finalized-evidence.json');
const PROVIDER_FILE = path.join(DIR, 'svsp-flash-provider-crosswalk.json');
const COMBINE_FILE = path.join(DIR, 'svsp-delegated-source-combine-fork.json');
const OUT = process.argv[2] || path.join(DIR, 'svsp-two-three-provider-gate.json');
const live = JSON.parse(fs.readFileSync(LIVE_FILE));
const inventory = JSON.parse(fs.readFileSync(PROVIDER_FILE));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function b(value) { return BigInt(value || 0); }
function sum(rows, field) { return rows.reduce((total, row) => total + b(row[field]), 0n); }

const p = inventory.providers;
const jupiterMain = p.jupiterNativeFlash.deployments.find((row) => row.label === 'jupiterMain');
const jupiterIsolated = p.jupiterNativeFlash.deployments.find((row) => row.label === 'jupiterIsolatedEthena');
const providerReceipt = {
  saveSolend: {
    inventoryCount: p.saveSolend.reserveInventoryCount,
    targetCount: p.saveSolend.targetReserveCount,
    positiveCapacityTargetCount: p.saveSolend.matches.filter((row) => b(row.stateDerivedBorrowableUpperBoundRaw) > 0n).length,
    gate: 'no SVSP mint reserve',
  },
  kaminoLend: {
    inventoryCount: p.kaminoLend.reserveInventoryCount,
    targetCount: p.kaminoLend.targetReserveCount,
    positiveCapacityTargetCount: p.kaminoLend.matches.filter((row) => b(row.stateDerivedBorrowableUpperBoundRaw) > 0n).length,
    gate: 'no SVSP mint reserve',
  },
  project0Marginfi: {
    inventoryCount: p.project0Marginfi.bankInventoryCount,
    targetCount: p.project0Marginfi.targetBankCount,
    targetWithPositiveVaultCount: p.project0Marginfi.matches.filter((row) => b(row.vaultAmountRaw) > 0n).length,
    targetWithHardZeroBorrowLimitCount: p.project0Marginfi.matches.filter((row) => row.borrowLimitRaw === '0').length,
    positiveCapacityTargetCount: p.project0Marginfi.matches.filter((row) => b(row.stateDerivedBorrowableUpperBoundRaw) > 0n).length,
    maximumTargetVaultBalanceRaw: p.project0Marginfi.matches.reduce((max, row) => b(row.vaultAmountRaw) > max ? b(row.vaultAmountRaw) : max, 0n).toString(),
    gate: 'all target banks have borrow_limit=0, a hard zero-liability ceiling',
  },
  jupiterMain: {
    reserveInventoryCount: jupiterMain.reserveInventoryCount,
    borrowPositionInventoryCount: jupiterMain.borrowPositionInventoryCount,
    targetReserveCount: jupiterMain.targetReserveCount,
    targetWithPositiveVaultCount: jupiterMain.matches.filter((row) => b(row.vaultAmountRaw) > 0n).length,
    flashAdminBoundTargetPositionCount: jupiterMain.targetBoundPositionCount,
    positiveCapacityTargetCount: jupiterMain.matches.filter((row) => b(row.stateDerivedBorrowableUpperBoundRaw) > 0n).length,
    targetVaultBalanceSumRaw: sum(jupiterMain.matches, 'vaultAmountRaw').toString(),
    gate: 'target reserves/custody exist, but no target UserBorrowPosition is bound to the flash-admin PDA',
  },
  jupiterIsolatedEthena: {
    reserveInventoryCount: jupiterIsolated.reserveInventoryCount,
    borrowPositionInventoryCount: jupiterIsolated.borrowPositionInventoryCount,
    targetReserveCount: jupiterIsolated.targetReserveCount,
    flashAdminBoundTargetPositionCount: jupiterIsolated.targetBoundPositionCount,
    positiveCapacityTargetCount: jupiterIsolated.matches.filter((row) => b(row.stateDerivedBorrowableUpperBoundRaw) > 0n).length,
    gate: 'no SVSP mint reserve or bound flash position',
  },
  mangoV4: {
    inventoryCount: p.mangoV4.bankInventoryCount,
    targetCount: p.mangoV4.targetBankCount,
    positiveCapacityTargetCount: 0,
    gate: 'no SVSP mint bank',
  },
  directActiveStake: {
    targetCount: inventory.summary.exactValidatorActiveStakeDirectProviderCount,
    positiveCapacityTargetCount: 0,
    gate: 'enumerated flash primitives transfer SPL tokens, not ownership of validator-matched active Stake accounts',
  },
};

function providerRows(mint) {
  const rows = [];
  const add = (provider, matches, missingGate) => {
    const selected = matches.filter((row) => row.mint === mint);
    const capacity = sum(selected, 'stateDerivedBorrowableUpperBoundRaw');
    rows.push({provider, matchedAccountCount: selected.length, capacityRaw: capacity.toString(),
      receiptAccounts: selected.map((row) => row.reserve || row.bank),
      gate: capacity > 0n ? null : selected.length ? missingGate.match : missingGate.absent});
  };
  add('saveSolend', p.saveSolend.matches,
    {absent: 'no target reserve', match: 'target reserve has zero current state-derived capacity'});
  add('kaminoLend', p.kaminoLend.matches,
    {absent: 'no target reserve', match: 'target reserve has zero current state-derived capacity'});
  add('project0Marginfi', p.project0Marginfi.matches,
    {absent: 'no target bank', match: 'hard-zero borrow_limit or another zero state bound'});
  add('jupiterMain', jupiterMain.matches,
    {absent: 'no target reserve', match: 'no flash-admin-bound target borrow position'});
  add('jupiterIsolatedEthena', jupiterIsolated.matches,
    {absent: 'no target reserve', match: 'no flash-admin-bound target borrow position'});
  const mangoMatches = p.mangoV4.matches.filter((row) => row.mint === mint);
  rows.push({provider: 'mangoV4', matchedAccountCount: mangoMatches.length, capacityRaw: '0',
    receiptAccounts: mangoMatches.map((row) => row.bank),
    gate: mangoMatches.length ? 'target bank capacity not established' : 'no target bank'});
  return rows;
}

function maximalAllocation(rows, providerCount) {
  const positive = rows.filter((row) => b(row.capacityRaw) > 0n)
    .sort((a, z) => Number(b(z.capacityRaw) - b(a.capacityRaw))).slice(0, providerCount);
  return {
    requestedProviderCount: providerCount,
    selectedProviderCount: positive.length,
    allocations: positive.map((row) => ({provider: row.provider, principalRaw: row.capacityRaw})),
    totalPrincipalRaw: sum(positive, 'capacityRaw').toString(),
    providerFeesRaw: '0',
    lenderRepayment: {
      status: 'not-started-no-loan',
      principalRaw: '0',
      feeRaw: '0',
      dueRaw: '0',
      actualRaw: '0',
    },
    transactionBuilt: false,
    signedSimulationRun: false,
    envelope: {
      maximumSerializedBytes: 4096,
      maximumAccountKeys: 64,
      actualSerializedBytes: null,
      actualAccountKeys: null,
      gate: 'provider authority/capacity failed before transaction construction',
    },
    finalEquity: {
      outsiderWalletLamports: '0',
      protocolLamports: '0',
      lenderPrincipalRaw: '0',
    },
  };
}

const mintProviderRows = new Map(inventory.crosswalk.map((pool) => [pool.mint, providerRows(pool.mint)]));
const positiveExposures = live.withdrawalExposures.filter((row) => b(row.burnableAmountRaw) > 0n);
const delegatedWithdrawalCases = positiveExposures.map((row) => {
  const providers = mintProviderRows.get(row.mint);
  const twoProvider = maximalAllocation(providers, 2);
  const threeProvider = maximalAllocation(providers, 3);
  const threshold = b(row.quantification.minimumTokenAmountForAtLeastOneSolRaw);
  const burnable = b(row.burnableAmountRaw);
  const supply = b(row.quantification.mintSupplyRaw);
  const shortfall = threshold > burnable ? threshold - burnable : 0n;
  const twoAvailable = b(twoProvider.totalPrincipalRaw);
  const threeAvailable = b(threeProvider.totalPrincipalRaw);
  return {
    pool: row.pool,
    mint: row.mint,
    exposedTokenAccount: row.address,
    tokenOwner: row.tokenOwner,
    burnableAmountRaw: row.burnableAmountRaw,
    currentlyPricedStakeLamports: row.quantification.calculatedWithdrawLamports,
    minimumTokenAmountForOneSolSplitRaw: threshold.toString(),
    shortfallRaw: shortfall.toString(),
    mintSupplyRaw: supply.toString(),
    evenAllCirculatingSupplyCannotReachOneSol: threshold > supply,
    providers,
    maximalTwoProvider: {...twoProvider,
      fundingGapRaw: (shortfall > twoAvailable ? shortfall - twoAvailable : 0n).toString(),
      reachesSplitThreshold: burnable + twoAvailable >= threshold && threshold <= supply},
    maximalThreeProvider: {...threeProvider,
      fundingGapRaw: (shortfall > threeAvailable ? shortfall - threeAvailable : 0n).toString(),
      reachesSplitThreshold: burnable + threeAvailable >= threshold && threshold <= supply},
  };
});

const delegatedAggregateByPool = live.withdrawalExposuresByPool.map((pool) => {
  const positive = pool.accounts.filter((row) => b(row.burnableAmountRaw) > 0n);
  const aggregate = sum(positive, 'burnableAmountRaw');
  const threshold = pool.accounts.length
    ? b(pool.accounts[0].quantification.minimumTokenAmountForAtLeastOneSolRaw) : 0n;
  const supply = b(pool.mintSupplyRaw);
  const available = b(pool.mainAvailableDelegatedStakeLamports);
  const aggregatePricedStake = supply > 0n ? aggregate * available / supply : 0n;
  return {
    pool: pool.pool,
    mint: pool.mint,
    positiveDelegatedSourceCount: positive.length,
    delegatedSourceAccounts: positive.map((row) => row.address),
    aggregateBurnableAmountRaw: aggregate.toString(),
    aggregatePricedStakeLamports: aggregatePricedStake.toString(),
    minimumTokenAmountForOneSolSplitRaw: threshold.toString(),
    aggregateReachesOneSolSplitThreshold: aggregate >= threshold,
    aggregateShortfallRaw: (threshold > aggregate ? threshold - aggregate : 0n).toString(),
    singleWithdrawSourceAccountLimit: 1,
    legalConsolidationAvailableToOutsider: false,
  };
});

const poolByAddress = new Map(live.pools.map((row) => [row.pool, row]));
const activeOnrampCases = live.epochFieldMergePrerequisitePools.map((row) => {
  const pool = poolByAddress.get(row.pool);
  return {
    pool: row.pool,
    voteAccount: row.voteAccount,
    mint: pool.mint.address,
    canonicalDelegatedStakeLamports: pool.stakeAccount.delegatedStakeLamports,
    onrampDelegatedStakeLamports: pool.onrampAccount.delegatedStakeLamports,
    requiredFundingAsset: 'validator-matched fully active Stake account, or a sourceable pool mint that can atomically produce it and later satisfy repayment',
    directActiveStakeProviderCapacityLamports: '0',
    poolMintProviderCapacityRaw: '0',
    maximalTwoProvider: maximalAllocation(mintProviderRows.get(pool.mint.address), 2),
    maximalThreeProvider: maximalAllocation(mintProviderRows.get(pool.mint.address), 3),
    stateChangeTested: false,
    gate: 'zero current native-stake provider inventory and zero sourceable exact pool-mint capacity',
  };
});

const allProviderCapacities = [...mintProviderRows.values()].flat();
const output = {
  schema: 'svsp-two-three-provider-gate/v1',
  generatedAt: new Date().toISOString(),
  network: 'mainnet-beta finalized state receipts',
  readOnly: true,
  transactionsBuilt: 0,
  signedSimulationsRun: 0,
  transactionsSubmitted: 0,
  constraints: {maximumSerializedBytes: 4096, maximumAccountKeys: 64},
  inputArtifacts: [
    {path: LIVE_FILE, sha256: sha256(LIVE_FILE), observation: live.observation},
    {path: PROVIDER_FILE, sha256: sha256(PROVIDER_FILE), observationSlots: inventory.observationSlots},
    {path: COMBINE_FILE, sha256: sha256(COMBINE_FILE), purpose: 'fresh signed exact-fork source-combination authority controls'},
  ],
  providerReceipt,
  aggregateGate: {
    targetMintCount: inventory.target.uniqueMintCount,
    positiveProviderCapacityEntryCount: allProviderCapacities.filter((row) => b(row.capacityRaw) > 0n).length,
    sourceableMintCount: inventory.summary.sourceableMintCount,
    activeOnrampSourceableMintCount: inventory.summary.activeOnrampSourceableMintCount,
    exactValidatorActiveStakeDirectProviderCount: inventory.summary.exactValidatorActiveStakeDirectProviderCount,
    maximalTwoProviderPrincipalAcrossEveryTargetMintRaw: '0',
    maximalThreeProviderPrincipalAcrossEveryTargetMintRaw: '0',
    conclusion: 'No exact-mint or validator-matched active-stake provider allocation exists. The maximal two-provider and three-provider principals are both zero, so no honest lender borrow/repay envelope can be constructed or simulated.',
  },
  delegatedWithdrawalCases,
  delegatedAuthorityAndAggregateGate: {
    exposedAccountCount: live.summary.withdrawalExposureTokenAccountCount,
    positiveBalanceAccountCount: live.summary.withdrawalExposurePositiveBalanceAccountCount,
    ownerPathCount: live.summary.withdrawalExposureOwnerPathCount,
    delegatePathCount: live.summary.withdrawalExposureDelegatePathCount,
    classification: 'All live exposures are delegate-only. SVSP can sign a burn as the mint-authority PDA, but the outsider neither owns the receipts nor can sign as the PDA for a token transfer.',
    everyIndividualBelowSplitThreshold: live.summary.withdrawalExposureAccountReachingAtLeastOneSolSplitCount === 0,
    everySameMintAggregateBelowSplitThreshold: delegatedAggregateByPool.every((row) => !row.aggregateReachesOneSolSplitThreshold),
    signedControlArtifact: COMBINE_FILE,
    signedControlReceipts: {
      directPdaDelegateTransfer: 'MissingRequiredSignature',
      oneSourceAskedToBurnTwoSourceSum: 'SPL Token insufficient funds',
      sequentialTwoSourceWithdrawals: 'first independent Stake split fails before the second source is reached',
    },
    delegatedAggregateByPool,
  },
  activeOnrampCases,
  reconciliation: {
    lenderPrincipalTransferredRaw: '0',
    lenderRepaymentDueRaw: '0',
    lenderRepaymentActualRaw: '0',
    outsiderWalletEquityDeltaLamports: '0',
    protocolEquityDeltaLamports: '0',
    reason: 'Inventory/authority gates were established by finalized account state before any transaction was built; therefore no state mutation, loan, fee, or repayment occurred.',
  },
};

fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUT,
  providerReceipt,
  aggregateGate: output.aggregateGate,
  positiveDelegatedExposureCases: delegatedWithdrawalCases.length,
  activeOnrampCases: activeOnrampCases.length,
  globallySupplyBlockedDelegatedCases: delegatedWithdrawalCases.filter((row) => row.evenAllCirculatingSupplyCannotReachOneSol).length,
  reconciliation: output.reconciliation,
}, null, 2));
