#!/usr/bin/env node
'use strict';

// Deterministic compact projection of the full PRIME NTT evidence bundle.
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const read = name => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
const state = read('prime-second-state-snapshot.json');
const live = read('prime-second-live-evidence.json');
const history = read('prime-second-history.json');
const simulations = read('prime-second-adversarial-v1.json');

const pick = result => ({label: result.label, category: result.category,
  slot: result.slot, wireVersion: result.wireVersion, wireBytes: result.wireBytes,
  wireSha256: result.wireSha256, err: result.err, unitsConsumed: result.unitsConsumed,
  accounting: result.accounting});
const result = label => {
  const found = simulations.results.find(row => row.label === label);
  if (!found) throw new Error(`missing simulation ${label}`);
  return pick(found);
};

const guardedCategories = new Set([
  'release-replay', 'release-account-substitution', 'signer-check', 'claim-boundary',
  'claim-boundary-replay', 'redeem-replay', 'redeem-account-substitution',
  'receive-replay', 'receive-account-substitution', 'same-transaction-ordering',
  'flash-target-ordering', 'exact-v1-adversarial-replay',
]);
const guardResults = simulations.results.filter(row => guardedCategories.has(row.category)).map(pick);

const output = {
  generatedAt: simulations.generatedAt,
  noTransactionsSubmitted: true,
  conclusion: {
    validatedFindings: 0,
    positiveOutsiderNetEquityCases: simulations.positiveOutsiderNetEquityCount,
    statement: 'No tested public outsider path ended with positive realizable PRIME equity after flash repayment and all other liabilities.',
  },
  deployment: {
    programId: live.programId,
    programData: live.programDataAddress,
    deploySlot: live.programData.deploySlot,
    upgradeAuthority: live.programData.upgradeAuthority,
    elfLength: live.programData.elfLength,
    elfSha256: live.programData.elfSha256,
    idlName: live.anchorIdl.idlName,
    idlVersion: live.anchorIdl.idlVersion,
    idlSha256: live.anchorIdl.dataSha256,
    sourceStatus: 'No matching Rust source tree, exact source commit, or reproducible-build attestation was present locally; the IDL and ELF strings were used only as interface/control evidence, not as source equivalence proof.',
  },
  currentState: {
    contextSlot: state.contextSlot,
    config: state.config,
    derived: state.derived,
    custodyBalanceRaw: live.accounts['7ND1JXFtoH8nn4rvRUvukDwAKgGuJ6uDtFTfTaR9VXiC'].amountRaw,
    mintSupplyRaw: live.accounts['3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7'].supplyRaw,
    reserve: live.reserve,
    programAccountCount: state.programAccountCount,
    accountTypes: state.byType,
    releaseStatusCounts: state.releaseStatusCounts,
    pendingInboxItems: state.pendingInboxItems,
  },
  history: {
    recentTransactionCount: history.recentCount,
    amountStats: history.amountStats,
    suppliedExit: {signature: live.exitTransaction.signature, slot: live.exitTransaction.slot,
      err: live.exitTransaction.err, computeUnitsConsumed: live.exitTransaction.computeUnitsConsumed,
      tokenDeltas: live.exitTransaction.tokenDeltas,
      instructionDiscriminators: live.exitTransaction.instructions.map(ix => ({index: ix.index,
        discriminator: ix.anchorDiscriminatorHex}))},
  },
  simulations: {
    preContextSlot: simulations.preContextSlot,
    resultCount: simulations.resultCount,
    successfulCount: simulations.successfulCount,
    failedCount: simulations.failedCount,
    transportOrLocalFailureCount: simulations.transportOrLocalFailureCount,
    positiveOutsiderNetEquityCount: simulations.positiveOutsiderNetEquityCount,
    targetControl: result('target_version_control'),
    flashBoundaries: [
      result('flash_dust_1_raw_repay'),
      result('flash_1_prime_repay'),
      result('flash_99_percent_available_repay'),
      result('flash_full_available_repay'),
      result('flash_available_plus_1_repay'),
    ],
    targetKlendComposition: result('flash_target_version_repay'),
    exactV1: [
      result('exact_4096_flash_target_version_repay'),
      result('exact_4096_flash_release_replay_repay'),
    ],
    guardedCaseCount: guardResults.length,
    guardedCasesWithUnexpectedSuccess: guardResults.filter(row => row.err === null),
    guardedCases: guardResults,
    exploratoryOutboundReplays: simulations.results
      .filter(row => row.category === 'outbound-replay' ||
        row.category === 'outbound-source-authorization').map(pick),
  },
  errorLegend: {
    '0:System': 'Account creation/re-initialization failed because the historical state account already exists.',
    '2003': 'Anchor ConstraintRaw',
    '2006': 'Anchor ConstraintSeeds',
    '2009': 'Anchor ConstraintAssociated',
    '2012': 'Anchor ConstraintAddress',
    '2015': 'Anchor ConstraintTokenOwner',
    '3002': 'Anchor AccountDiscriminatorMismatch',
    '3007': 'Anchor AccountOwnedByWrongProgram',
    '3008': 'Anchor InvalidProgramId',
    '3010': 'Anchor AccountNotSigner',
    '6007:target': 'TransferAlreadyRedeemed',
    '6008:target': 'TransferCannotBeRedeemed',
    '6008:klend': 'InsufficientLiquidity',
  },
  limitations: [
    'Current-state replay simulations cannot recreate an unconsumed inbound message; the supplied historical exit provides the corresponding successful fresh-state path under the same deployed ELF.',
    'No matching local Rust source or reproducible build was available, so source-line equivalence to the current ELF remains unproven.',
    'The two outbound replay probes preserve a historical outbox signer meta while sigVerify is disabled; they are exploratory state-reuse checks, not proof of an outsider-reachable outbound authorization path.',
    'Administrative key compromise, intended operator actions, Wormhole guardian compromise, and the separate 8eqh8w/97V7 programs are outside the public-outsider finding model.',
  ],
};

if (output.simulations.guardedCasesWithUnexpectedSuccess.length)
  throw new Error('one or more adversarial guard cases unexpectedly succeeded');
if (output.conclusion.positiveOutsiderNetEquityCases !== 0)
  throw new Error('positive outsider equity requires finding validation');

const outputPath = path.join(DIR, 'prime-second-results-summary.json');
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({outputPath, resultCount: output.simulations.resultCount,
  guardedCaseCount: output.simulations.guardedCaseCount,
  validatedFindings: output.conclusion.validatedFindings}));
