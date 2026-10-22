#!/usr/bin/env node
'use strict';

// Materializes the simulation-only SVSP v1 audit record collected by the
// companion probes. This has no transaction-submission path and deliberately
// omits RPC endpoints and private key material.

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const SOURCE = process.argv[2] || '/tmp/svsp-v1-audit-20261015.json';
const PROVIDER_SOURCE = path.join(DIR, 'current-flash-provider-stack-signed-v1.json');
const OUT = path.join(DIR, 'svsp-v1-composition-audit.json');

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function withoutLargeFields(row) {
  if (!row) return null;
  const {logs, pre, post, before, after, innerInstructions, ...small} = row;
  return small;
}

const evidence = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
invariant(evidence.program?.programId === 'SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE',
  'unexpected SVSP program');
invariant(evidence.cases?.every((row) => row.composition?.messageVersion === 1),
  'expected Solana wire v1 for every core case');
invariant(evidence.signedForkEvidence?.results?.length >= 2,
  'signed Surfpool blocker controls missing');
invariant(evidence.delegatedWithdrawalEvidence?.results?.length === 34,
  'expected all 34 delegated-token candidates');
invariant(evidence.onrampHarvestEvidence?.err === null,
  'onramp diagnostic no longer succeeds');

const delegated = evidence.delegatedWithdrawalEvidence;
const e7jj = delegated.results.find((row) =>
  row.address === 'E7JJ8wGLjMHEgZpVMRcxkNZP5Qny7cvuUitUbz16a15s');
const nineYk = delegated.results.find((row) =>
  row.address === '9ykS5NRSSCgTcLu4m5SYNJyd1v5xY92GLNpsWQghnk8J');
invariant(e7jj && nineYk, 'dominant delegated-token controls missing');

const signedDeposit = evidence.signedForkEvidence.results.find((row) =>
  row.label === 'signed_fork_deposit_withdrawer_only_authority_blocker');
const signedApproval = evidence.signedForkEvidence.results.find((row) =>
  row.label === 'signed_fork_unauthorized_victim_lst_approval_blocker');
const signedE7jj = delegated.signedForkDominantControl;
invariant(signedDeposit && signedApproval && signedE7jj,
  'one or more signed blocker controls missing');

const p0Boundary = evidence.lenderEvidence?.project0TargetBoundary;
invariant(p0Boundary?.maximumActuallyBorrowableRaw === '0',
  'Project0 target boundary changed');

let providerStackReference = null;
if (fs.existsSync(PROVIDER_SOURCE)) {
  const provider = JSON.parse(fs.readFileSync(PROVIDER_SOURCE, 'utf8'));
  providerStackReference = {
    evidencePath: PROVIDER_SOURCE,
    generatedAt: provider.generatedAt,
    environment: provider.environment,
    safety: provider.safety,
    forkBaselineSlot: provider.forkBaselineSlot,
    upstreamSourceSlots: provider.upstreamSourceSlots,
    programs: provider.programs,
    capacities: provider.capacities,
    feeAndGateSemantics: provider.feeAndGateSemantics,
    warning: 'These are signed composition/blocker probes, not positive controls: every recorded multi-provider case failed before full borrow/unwind/repay and completeRepayment is false.',
    cases: provider.cases.map((row) => ({
      label: row.label,
      kind: row.kind,
      amounts: row.amounts,
      saveExpectedFeeRaw: row.saveExpectedFeeRaw,
      slots: row.slots,
      wire: row.wire && {
        version: row.wire.version,
        bytes: row.wire.bytes,
        addresses: row.wire.addresses,
        instructions: row.wire.instructions,
        requiredSignatures: row.wire.requiredSignatures,
        signerOrder: row.wire.signerOrder,
        sigVerify: row.wire.sigVerify,
        replaceRecentBlockhash: row.wire.replaceRecentBlockhash,
        sha256: row.wire.sha256,
      },
      err: row.err,
      unitsConsumed: row.unitsConsumed,
      completeRepayment: row.completeRepayment,
    })),
  };
}

evidence.finalAssessment = {
  generatedAt: new Date().toISOString(),
  safety: {
    mainnetSend: false,
    mainnetSimulationOnly: true,
    signedExecutionEndpoint: 'isolated Surfpool mainnet fork only',
    signedForkMutation: evidence.signedForkEvidence.forkStateMutation,
    clonedTargetAccountsExact: evidence.signedForkEvidence.allClonedTargetsExact,
  },
  signedSigVerifyTrueMatrix: [
    withoutLargeFields(signedDeposit),
    withoutLargeFields(signedApproval),
    withoutLargeFields(signedE7jj),
  ],
  delegatedTokenMatrix: {
    observation: delegated.sourceObservation,
    candidateCount: delegated.candidateCount,
    positiveBalanceCandidateCount: delegated.positiveBalanceCandidateCount,
    aggregateMaxBurnableRaw: delegated.totalMaxBurnableRaw,
    successCount: delegated.successCount,
    dominant: [withoutLargeFields(e7jj), withoutLargeFields(nineYk)],
    attemptedAggregate: delegated.allPositiveCandidateAggregateComposition,
    aggregationAnalysis: delegated.aggregationAnalysis,
  },
  flashProviderMatrix: [
    {
      provider: 'KLend',
      target: 'all 57 current SVSP LST mints',
      observedSlots: [evidence.lenderEvidence.klend.requestedAnchorSlot,
        evidence.lenderEvidence.klend.klendReserveReadSlotMax],
      reserveCount: evidence.lenderEvidence.klend.klendReserveCount,
      compatibleReserveCount: evidence.lenderEvidence.klend.svspMintReserveMatchCount,
      exactZeroFeeCompatibleCount: evidence.lenderEvidence.klend.activeExactZeroFeeSvspMatchCount,
      effectiveDirectCapacityRaw: '0',
      blocker: 'No KLend reserve exists for any deployed SVSP LST mint.',
    },
    {
      provider: 'Project0',
      target: p0Boundary.mint,
      bank: p0Boundary.bank,
      liquidityVault: p0Boundary.liquidityVault,
      vaultAuthority: p0Boundary.vaultAuthority,
      observationSlot: p0Boundary.blockhashContext.slot,
      displayedVaultRaw: p0Boundary.availableVaultRaw,
      configuredBorrowLimitRaw: p0Boundary.configuredBorrowLimitRaw,
      effectiveDirectCapacityRaw: p0Boundary.maximumActuallyBorrowableRaw,
      testedRaw: ['1', '2', '3'],
      blocker: 'BankLiabilityCapacityExceeded (custom 6027) from the configured zero borrow limit.',
    },
    {
      provider: 'Project0',
      target: '77YLpVLQXr2KU66GM2JykbT9g5du7LarWgehbWD3CJaB',
      bank: '9dZiyG51FBR4BWpAs69XbDpr7GfVAEB1ZB89v38maV36',
      liquidityVault: '7nuBgqYgCMAndRLCkFkmvPYFRvVco664kCbmqu7JcwRA',
      observationSlot: 457364430,
      displayedVaultRaw: '0',
      effectiveDirectCapacityRaw: '0',
      blocker: 'The exact onramp-harvest LST bank liquidity vault was empty.',
    },
    {
      provider: 'Save / KLend / Project0 / Jupiter stack',
      target: 'unrelated WSOL, USDC, and USDe inventory',
      evidencePath: PROVIDER_SOURCE,
      effectiveDirectSvspCapacityRaw: '0',
      maxAttemptedComposition: providerStackReference ? {
        bytes: 1773,
        addresses: 39,
        instructions: 16,
        requiredSignatures: 2,
      } : null,
      blocker: 'No tested leg directly lends the required SVSP LST; every signed combo probe failed early in Save with custom 14/math overflow, so no complete repayment or route-positive control exists.',
    },
  ],
  flashRelevance: {
    danglingStakeAuthority: 'Capital-independent. Borrowed SOL/USDC/LST cannot make an outsider the canonical stake staker required by DepositStake.',
    delegatedVictimToken: 'Capital-independent until a compatible same-mint top-up exists. Unrelated flash assets cannot authorize transfer/burn of a victim token account. Each current victim source is individually below the 1 SOL stake split threshold.',
    onrampHarvest: 'Capital-sensitive, but the only successful exact-state sequence used already-active stake and unavailable live signers. Fresh SOL stake cannot become fully active/merge-compatible in the same epoch. No direct current same-mint lender was available; no signed DEX buy/replenish/sell/unwind/repay route was established.',
    multiProviderStatus: 'The four-provider signed v1 envelope fits 1,773 bytes/39 addresses/16 instructions, but all stack cases are blocker evidence, not successful flash controls. Therefore no validated flash-wrapped drain is claimed.',
  },
  onrampHarvest: {
    classification: 'economically successful sigVerify:false diagnostic; not a validated outsider drain',
    exactMissingLiveSigners: [
      evidence.onrampHarvestEvidence.inputs.sourceAuthority,
      evidence.onrampHarvestEvidence.inputs.tokenOwnerAndPayer,
    ],
    freshDestinationStakeSigner: 'attacker-generatable; not a blocker',
    sourceStake: evidence.onrampHarvestEvidence.inputs.sourceStake,
    D_sourceDelegatedStakeRaw: evidence.onrampHarvestEvidence.inputs.sourceDelegatedStakeRaw,
    T_mintedAndBurnedSharesRaw: evidence.onrampHarvestEvidence.inputs.calculatedMintedSharesRaw,
    preOnrampDelegatedStakeRaw: evidence.onrampHarvestEvidence.inputs.preOnrampDelegatedStakeRaw,
    realizedDelegatedProfitRaw: evidence.onrampHarvestEvidence.reconciliation.realizedDelegatedProfitRaw,
    composition: evidence.onrampHarvestEvidence.composition,
    compute: {
      unitsConsumed: evidence.onrampHarvestEvidence.unitsConsumed,
      observedTransactionEnvelope: 1400000,
      headroom: 1400000 - evidence.onrampHarvestEvidence.unitsConsumed,
      conclusion: '239,519 CU is below the observed 1,400,000-CU simulation envelope; compute was not the blocker.',
    },
    pre: evidence.onrampHarvestEvidence.pre,
    post: evidence.onrampHarvestEvidence.post,
    reconciliation: evidence.onrampHarvestEvidence.reconciliation,
  },
  findings: [
    'The two withdrawer-only HHZn stake accounts are not bearer deposits: signed exact-clone DepositStake fails because the staker is not the canonical PDA.',
    'All 34 delegated-token candidates fail at their current maximum burnable balance; the two dominant balances remain below the one-SOL split threshold and failed atomically.',
    'Permissionless Replenish creates a reproducible value-transfer opportunity for a depositor holding already-active same-vote stake, but outsider exploitability was not validated because the exact live user signers and a compatible signed flash acquisition/unwind route were unavailable.',
    'Operator-only metadata/update paths are non-findings for outsider threat modeling.',
  ],
  infeasibleOrUnvalidated: [
    'A mainnet sigVerify:true diagnostic with someone else\'s stake/token authority is cryptographically impossible without their private key; signed tests therefore used an exact-account Surfpool fork and fresh attacker key.',
    'Failed mainnet simulations returned null requested post accounts; atomic rollback follows Solana transaction semantics and was additionally checked through signed fork failure controls. No transaction was sent.',
    'No successful tri-/four-source flash composition was obtained. The largest signed provider-stack envelope fit the byte/account limits but failed before complete repayment.',
    'A same-transaction fresh-stake route is infeasible because the stake activation epoch cannot match an already-active pool/onramp in that transaction.',
  ],
  evidencePaths: [
    SOURCE,
    path.join(DIR, 'svsp-live-finalized-evidence.json'),
    path.join(DIR, 'klend-v1-composition.js'),
    path.join(DIR, 'marginfi-vaults-current.json'),
    PROVIDER_SOURCE,
    path.join(DIR, 'SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE.so'),
  ],
};
evidence.providerStackReference = providerStackReference;

// Refuse to persist secrets/endpoints if an upstream artifact ever grows them.
const serialized = JSON.stringify(evidence, null, 2) + '\n';
for (const forbidden of ['http://', 'https://', 'api-key', 'api_key', 'HELIUS']) {
  invariant(!serialized.includes(forbidden), `refusing to write possible endpoint/secret marker: ${forbidden}`);
}
fs.writeFileSync(OUT, serialized, {mode: 0o644});
console.log(JSON.stringify({output: OUT, bytes: Buffer.byteLength(serialized),
  delegatedCandidates: delegated.candidateCount,
  signedControls: evidence.finalAssessment.signedSigVerifyTrueMatrix.length,
  mainnetSend: false}, null, 2));
