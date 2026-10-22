#!/usr/bin/env node
'use strict';

// Offline assertion and report generator for the target-specific PRIME audit.

const fs = require('fs');
const path = require('path');

const RUN = __dirname;
const read = (name) => JSON.parse(fs.readFileSync(path.join(RUN, name), 'utf8'));
const identity = read('prime-controller-identity.json');
const state = read('prime-controller-state.json');
const simulations = read('prime-controller-simulations.json');
const idl = read('prime-controller-onchain-idl.json');
const cases = new Map(simulations.cases.map((item) => [item.label, item]));

function requireCase(label) {
  const item = cases.get(label);
  if (!item) throw new Error(`Missing simulation case: ${label}`);
  return item;
}

function customError(item) {
  return item.err?.InstructionError?.[1]?.Custom ?? null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactAssetZero(item) {
  const tokenValues = Object.values(item.deltas?.tokens || {});
  const reserveValues = Object.values(item.deltas?.reserve || {});
  return item.err === null && tokenValues.length === 4 && reserveValues.length === 6 &&
    [...tokenValues, ...reserveValues, item.deltas.mintSupplyRaw].every((value) => value === '0');
}

const successLabels = [
  'flash_pair_zero',
  'flash_pair_one_raw',
  'flash_pair_one_prime',
  'flash_pair_near_available',
  'flash_pair_exact_available',
  'controller_roundtrip_one_raw_control',
  'controller_roundtrip_one_prime_control_v1_4096',
  'release_zero_amount_control',
  'release_double_control_no_pool_nonce',
];
const expectedErrors = {
  flash_one_raw_no_repay: 6032,
  flash_one_prime_underpay: 6033,
  flash_one_prime_wrong_repay_index: 6033,
  flash_pair_over_available: 6008,
  controller_roundtrip_one_prime_outsider_authority_v1_4096: 2006,
  controller_roundtrip_wrong_offramp_program: 2006,
  controller_roundtrip_allowed_offramp_substitution: 2006,
  controller_roundtrip_state_substitution: 3002,
  controller_roundtrip_pool_signer_substitution: 2006,
  controller_roundtrip_pool_vault_substitution: 2012,
  controller_roundtrip_receiver_account_mismatch: 2012,
  controller_roundtrip_invalid_source_pool: 6007,
  controller_roundtrip_wrong_chain_selector: 2006,
  release_u64_overflow_control: 6009,
  release_double_outsider_authority: 2006,
  withdraw_liquidity_outsider: 6002,
  withdraw_liquidity_configured_rebalancer_control: 6020,
  provide_liquidity_outsider: 6002,
};

for (const label of successLabels)
  assert(exactAssetZero(requireCase(label)), `${label} did not reconcile all asset/debt fields to zero`);
for (const [label, code] of Object.entries(expectedErrors))
  assert(customError(requireCase(label)) === code, `${label} did not fail with custom error ${code}`);

const exactControl = requireCase('controller_roundtrip_one_prime_control_v1_4096');
const exactOutsider = requireCase('controller_roundtrip_one_prime_outsider_authority_v1_4096');
assert(exactControl.v1Bytes === 4096 && exactControl.exact4096 && exactControl.err === null,
  'Authorized exact-size composition did not succeed at 4,096 bytes');
assert(exactOutsider.v1Bytes === 4096 && exactOutsider.exact4096 && customError(exactOutsider) === 2006,
  'Outsider exact-size composition did not fail at the OffRamp authority seed constraint');
assert(identity.comparison.exactArtifactPlusZeroPadding,
  'Mainnet bytes no longer match the official release artifact plus zero padding');
assert(state.vault.authority === state.derivations.poolSigner &&
  state.vault.mint === state.primeMint && state.vault.delegate === null &&
  state.vault.delegatedAmountRaw === '0' && state.vault.closeAuthority === null,
  'Vault SPL authority/delegate/close-authority invariant failed');
assert(state.klend.flashFeeExactZero && state.klend.availableRaw ===
  state.klend.supplyVaultState.rawAmount, 'KLend fee or available-liquidity invariant failed');
assert(state.state.rebalancer === '11111111111111111111111111111111' &&
  state.state.canAcceptLiquidity === false, 'Live rebalancer disablement changed');

const allInstructionNames = idl.instructions.map((item) => item.name);
const allAccountNames = idl.accounts.map((item) => item.name);
const accountSurfaceAbsent = ![...allInstructionNames, ...allAccountNames]
  .some((name) => /claim|receipt|share|debt|order|oracle|price/i.test(name));
assert(accountSurfaceAbsent, 'Unexpected claim/receipt/share/debt/order/oracle/price surface in IDL');

const caseSummary = simulations.cases.map((item) => ({
  label: item.label,
  result: item.err === null ? 'success' : 'atomic failure',
  customError: customError(item),
  v1Bytes: item.v1Bytes,
  exact4096: item.exact4096,
  outsiderTokenDeltaRaw: item.deltas?.tokens?.outsiderToken ?? null,
  controllerVaultDeltaRaw: item.deltas?.tokens?.controllerVault ?? null,
  klendSupplyDeltaRaw: item.deltas?.tokens?.klendSupply ?? null,
  klendFeeDeltaRaw: item.deltas?.tokens?.klendFeeVault ?? null,
  reserveDebtDeltaSf: item.deltas?.reserve?.borrowedAmountSf ?? null,
  collateralShareSupplyDeltaRaw: item.deltas?.reserve?.collateralMintSupplyRaw ?? null,
  mintSupplyDeltaRaw: item.deltas?.mintSupplyRaw ?? null,
}));

const validation = {
  generatedAt: new Date().toISOString(),
  verdict: {
    reportableFinding: false,
    findingCount: 0,
    conclusion: 'No outsider-accessible unauthorized positive net PRIME equity was demonstrated.',
    reportingRule: 'Only positive outsider equity after every liability is a finding.',
  },
  observation: {
    stateSlots: state.observedSlots,
    simulationPreSlot: simulations.preSlot,
    simulationSlots: [...new Set(simulations.cases.map((item) => item.simulationSlot).filter(Boolean))],
    programId: state.programId,
    version: identity.mainnet.idl.metadata.version,
    currentBinaryMatchesOfficialRelease: identity.comparison.exactArtifactPlusZeroPadding,
    sourceCommit: identity.officialRelease.sourceCommit,
  },
  custody: {
    primeMint: state.primeMint,
    poolSigner: state.derivations.poolSigner,
    vault: state.derivations.poolVault,
    vaultRaw: state.vault.rawAmount,
    vaultUi: (Number(state.vault.rawAmount) / 1e6).toFixed(6),
    vaultDelegate: state.vault.delegate,
    vaultDelegatedAmountRaw: state.vault.delegatedAmountRaw,
    vaultCloseAuthority: state.vault.closeAuthority,
  },
  klend: {
    reserve: state.klend.reserve,
    availableRaw: state.klend.availableRaw,
    availableUi: state.klend.realisticFlashLiquidityUi,
    flashFeeSf: state.klend.flashFeeSf,
    flashFeeExactZero: state.klend.flashFeeExactZero,
  },
  exact4096Composition: {
    sequence: ['KLend flash borrow', 'padding memo', 'SPL transfer into controller vault',
      'controller release to receiver ATA', 'KLend full repay'],
    authorizedPositiveControl: {
      label: exactControl.label,
      v1Bytes: exactControl.v1Bytes,
      v0EquivalentBytes: exactControl.v0Bytes,
      paddingBytes: exactControl.paddingBytes,
      addressCount: exactControl.addressCount,
      instructionCount: exactControl.instructionCount,
      requiredSignatures: exactControl.requiredSignatures,
      unitsConsumed: exactControl.unitsConsumed,
      deltas: exactControl.deltas,
      allAssetsDebtsSharesZero: exactAssetZero(exactControl),
    },
    outsiderAttempt: {
      label: exactOutsider.label,
      v1Bytes: exactOutsider.v1Bytes,
      requiredSignatures: exactOutsider.requiredSignatures,
      failure: exactOutsider.err,
      customError: customError(exactOutsider),
      failureMeaning: 'Anchor ConstraintSeeds on the OffRamp authority; transaction atomically rolls back.',
    },
  },
  surfaces: {
    custodyExits: [
      {name: 'release_or_mint_tokens', direction: 'vault outflow',
        control: 'OffRamp signer PDA + router-owned allowed-OffRamp PDA + bound state/mint/signer/vault/chain/RMN/receiver ATA + source-pool/rate checks'},
      {name: 'withdraw_liquidity', direction: 'vault outflow',
        control: 'configured rebalancer signer + can_accept_liquidity; live rebalancer is default and flag is false'},
      {name: 'provide_liquidity', direction: 'vault inflow',
        control: 'same configured rebalancer signer + flag'},
      {name: 'lock_or_burn_tokens', direction: 'lock/event path, no vault outflow',
        control: 'configured router onramp authority + bound state and chain configuration'},
    ],
    claimReceiptShareDebtAccounts: 'absent from the 25-instruction on-chain IDL and reviewed state model',
    priceOracleOrderSurface: 'not applicable: this lock/release program consumes no price, oracle, or order account',
    replayBoundary: 'pool has no nonce; only authenticated OffRamp can call release, so cross-chain replay/order integrity is an OffRamp control',
  },
  simulations: caseSummary,
  assertions: {
    exactBinaryIdentity: true,
    allNamedSuccessCasesReconcileAssetsDebtsShares: true,
    missingRepayRejected: true,
    underpayRejected: true,
    wrongRepayIndexRejected: true,
    amountAboveLiquidityRejected: true,
    outsiderExact4096Rejected: true,
    accountAndPdaSubstitutionsRejected: true,
    u64OverflowRejected: true,
    outsiderLiquidityExitRejected: true,
    noPositiveOutsiderEquity: true,
  },
  limitations: [
    'Read-only current-mainnet simulateTransaction only; no transaction was submitted.',
    '`sigVerify:false` permits positive-control modeling of protocol PDAs; outsider failures are independently backed by current binary account constraints and exact matched source.',
    'The registered security workspace covers a broad directory snapshot, but this report covers the user-requested executable, its exact source, live accounts, custody exits, and KLend composition only.',
    'The user-supplied USD spot mark was not used in the exploitability decision and was not independently repriced.',
  ],
};

const errorName = {
  2006: 'ConstraintSeeds', 2012: 'ConstraintAddress', 3002: 'AccountDiscriminatorMismatch',
  6002: 'Unauthorized', 6007: 'InvalidSourcePoolAddress', 6008: 'InsufficientLiquidity',
  6009: 'InvalidTokenAmountConversion', 6020: 'LiquidityNotAccepted',
  6032: 'NoFlashRepayFound', 6033: 'InvalidFlashRepay',
};
const matrixRows = caseSummary.map((item) => {
  const outcome = item.result === 'success' ? 'Success; exact asset/debt/share deltas zero' :
    `Atomic failure: ${errorName[item.customError] || 'error'} (${item.customError ?? 'transport'})`;
  return `| \`${item.label}\` | ${item.v1Bytes} | ${outcome} |`;
}).join('\n');

const report = `# PRIME Controller Current-Binary Asset-Gain Audit

## Verdict

**No reportable outsider asset-gain finding.** Across the current executable, live account state, exact matched source, and 27 current-mainnet read-only simulations, no unprivileged path finished with positive outsider PRIME equity after flash principal, fees, protocol balances, debt fields, and collateral-share supply were reconciled.

The exact 4,096-byte Solana v1 authorized control completes and returns every watched asset/debt/share field to its starting value. Replacing the authenticated OffRamp PDA with the outsider signer produces Anchor \`ConstraintSeeds\` (2006) and atomically rolls back.

## Scope and method

- Program: \`${state.programId}\` (Chainlink \`lockrelease-token-pool 1.6.2\`).
- Mainnet observations: state slots ${state.observedSlots.primary}/${state.observedSlots.secondary}; simulation pre-slot ${simulations.preSlot}; individual simulation slots are recorded in the JSON evidence.
- Reporting rule: only positive outsider equity after all liabilities is a finding. Administrative owner, router, OffRamp, rebalancer, rate-limit-admin, and upgrade-authority actions are controls.
- Validation: current mainnet account reads plus \`simulateTransaction\` with \`sigVerify:false\`; no live transaction, operator contact, or state mutation.

## Program and source identity

The on-chain IDL account identifies \`lockrelease_token_pool\` version \`1.6.2\`, and the current binary's \`type_version\` simulation returns \`lockrelease-token-pool 1.6.2\`. The official \`solana-v1.6.2\` ELF (${identity.officialRelease.lockreleaseElfBytes.toLocaleString()} bytes; SHA-256 \`${identity.officialRelease.lockreleaseElfSha256}\`) is byte-for-byte the prefix of the dumped mainnet allocation; all ${identity.comparison.allocatedTailBytes.toLocaleString()} remaining allocation bytes are zero. Reviewed source commit: \`${identity.officialRelease.sourceCommit}\`.

## Live custody and liquidity

| Item | Current value |
|---|---:|
| PRIME vault | \`${state.derivations.poolVault}\` |
| Vault authority | \`${state.derivations.poolSigner}\` |
| Vault PRIME | ${validation.custody.vaultUi} (${state.vault.rawAmount} raw) |
| Vault delegate / delegated raw | none / 0 |
| Vault close authority | none |
| KLend reserve | \`${state.klend.reserve}\` |
| Realistic flash liquidity | ${state.klend.realisticFlashLiquidityUi} PRIME (${state.klend.realisticFlashLiquidityRaw} raw) |
| Flash fee scaled fraction | 0 (exact zero) |
| Rebalancer / liquidity enabled | system default / false |

## All custody-relevant instructions

| Instruction | Asset effect | Outsider-relevant controls |
|---|---|---|
| \`release_or_mint_tokens\` | PRIME leaves the pool vault | OffRamp authority PDA, router-owned allowed-OffRamp PDA, pool state/mint/signer/vault and chain PDAs, RMN accounts, canonical receiver ATA, configured source pool, token, rate limit, and amount conversion |
| \`withdraw_liquidity\` | PRIME leaves the pool vault | configured rebalancer signer plus \`can_accept_liquidity\`; live values disable the path |
| \`provide_liquidity\` | PRIME enters the pool vault | same rebalancer and flag; not an outflow |
| \`lock_or_burn_tokens\` | locking/event path; no vault outflow in this program | configured router onramp authority and bound state/chain accounts |
| Administrative configuration / upgrade | may change future authority or policy | privileged owner, rate-limit admin, or upgrade authority; excluded unless outsider authority acquisition is shown |

The 25-instruction IDL exposes only \`PoolConfig\`, \`State\`, and \`ChainConfig\` accounts. There is no claim, receipt, share, debt, order, oracle, or price account in this program. PRIME's configured remote and local decimals are both six, so the live route does not enter a decimal down-rounding branch. Amounts above \`u64::MAX\` fail conversion (6009). A privileged double-release control confirms the pool itself owns no message nonce, but the same call with outsider authority fails immediately; replay/order authorization remains at the authenticated OffRamp boundary.

## Exact 4,096-byte flash composition

Sequence: KLend borrow → padding memo → SPL transfer to controller vault → controller release to receiver ATA → KLend full repay.

| Property | Authorized OffRamp control | Outsider signer attempt |
|---|---:|---:|
| Serialized v1 bytes | ${exactControl.v1Bytes} | ${exactOutsider.v1Bytes} |
| v0-equivalent bytes | ${exactControl.v0Bytes} | ${exactOutsider.v0Bytes} |
| Padding bytes | ${exactControl.paddingBytes} | ${exactOutsider.paddingBytes} |
| Addresses / instructions | ${exactControl.addressCount} / ${exactControl.instructionCount} | ${exactOutsider.addressCount} / ${exactOutsider.instructionCount} |
| Required signatures | ${exactControl.requiredSignatures} | ${exactOutsider.requiredSignatures} |
| Result | success | atomic \`ConstraintSeeds\` 2006 at release authority |
| Outsider token delta | 0 raw | none committed |
| Controller vault delta | 0 raw | none committed |
| KLend supply / fee delta | 0 / 0 raw | none committed |
| Reserve available / debt delta | 0 raw / 0 sf | none committed |
| Collateral-share / mint-supply delta | 0 / 0 raw | none committed |

The authorized simulation's inbound rate bucket increased because the stale pre-snapshot bucket refilled by elapsed time before consuming the one-PRIME release. That rate-limiter bookkeeping is not an asset, liability, or outsider gain.

## Simulation matrix

| Case | v1 bytes | Result |
|---|---:|---|
${matrixRows}

Missing repayment fails with \`NoFlashRepayFound\` (6032). Underpayment and wrong borrow-index repayment both fail with \`InvalidFlashRepay\` (6033). Borrowing exactly the live realistic liquidity succeeds with full reconciliation; one raw unit more fails \`InsufficientLiquidity\` (6008).

## Conclusion and limitations

Account/PDA substitutions, receiver mismatch, source-pool mutation, wrong chain selector, outsider replay, liquidity exits, integer overflow, missing repay, underpay, wrong repay index, and the full-liquidity boundary did not produce positive outsider equity. The conclusion is target-specific and current-state-specific, not a guarantee about future upgrades or privileged configuration changes.

- Simulations use \`sigVerify:false\` so an authorized-PDA positive control can be modeled without operator keys. The outsider case requires only the outsider signer and fails in current-binary account validation.
- No live submission occurred. Failed simulations have no committed post-state by Solana atomicity.
- The broad repository snapshot outside this executable, exact source, relevant live accounts, and target-specific tooling was not audited.
- The user-supplied USD mark was not needed for exploitability and was not independently repriced.

## Evidence

- \`prime-controller-validation.json\`: machine-readable verdict, assertions, exact composition, and all case results.
- \`prime-controller-identity.json\`: binary, IDL, release artifact, and source-commit binding.
- \`prime-controller-state.json\`: live state, vault authority details, KLend reserve, chain config, and successful historical exits.
- \`prime-controller-simulations.json\`: full logs, pre/post snapshots, and reconciled deltas for all 27 cases.
- \`prime-controller-identity.js\`, \`prime-controller-runtime-probe.js\`, \`prime-controller-state.js\`, and \`prime-controller-simulate.js\`: reproducible read-only/offline tooling.
`;

fs.writeFileSync(path.join(RUN, 'prime-controller-validation.json'),
  `${JSON.stringify(validation, null, 2)}\n`);
fs.writeFileSync(path.join(RUN, 'prime-controller-audit.md'), report);
console.log(JSON.stringify({
  reportPath: path.join(RUN, 'prime-controller-audit.md'),
  validationPath: path.join(RUN, 'prime-controller-validation.json'),
  findingCount: validation.verdict.findingCount,
  simulationCount: simulations.cases.length,
  assertionsPassed: Object.values(validation.assertions).every(Boolean),
}, null, 2));
