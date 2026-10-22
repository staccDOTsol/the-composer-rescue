#!/usr/bin/env node
'use strict';

// Compact deterministic projection from svsp-live-finalized-evidence.json.
// No RPC or other network call is made by this script.

const fs = require('fs');
const path = require('path');

const input = process.argv[2] || path.join(__dirname, 'svsp-live-finalized-evidence.json');
const output = process.argv[3] || path.join(__dirname, 'svsp-active-onramp-envelope.json');
const evidence = JSON.parse(fs.readFileSync(input, 'utf8'));
const oneSol = 1_000_000_000n;

const rows = evidence.epochFieldMergePrerequisitePools.map((candidate) => {
  const pool = evidence.pools.find((row) => row.pool === candidate.pool);
  const delegated = BigInt(pool.stakeAccount.delegatedStakeLamports);
  const pricingDenominator = delegated > oneSol ? delegated - oneSol : 0n;
  const pendingOnramp = BigInt(pool.onrampAccount.delegatedStakeLamports);
  return {
    pool: pool.pool,
    voteAccount: pool.voteAccount,
    mint: pool.mint.address,
    mintSupplyRaw: pool.mintAccount.supplyRaw,
    canonicalStake: pool.stake.address,
    onramp: pool.onramp.address,
    canonicalDelegatedStakeLamports: delegated.toString(),
    pricingDenominatorMRaw: pricingDenominator.toString(),
    pendingActiveOnrampRRaw: pendingOnramp.toString(),
    pendingActiveOnrampRSol: Number(pendingOnramp) / 1e9,
    ratioRToCanonicalDelegated: delegated > 0n ? Number(pendingOnramp) / Number(delegated) : null,
    ratioRToPricingDenominatorM: pricingDenominator > 0n
      ? Number(pendingOnramp) / Number(pricingDenominator) : null,
    activationEpoch: pool.onrampAccount.activationEpoch,
    deactivationEpoch: pool.onrampAccount.deactivationEpoch,
    canonicalCreditsObserved: pool.stakeAccount.creditsObserved,
    onrampCreditsObserved: pool.onrampAccount.creditsObserved,
    compatibleMeta: candidate.compatibleMeta,
    sameVote: candidate.sameVote,
    maximumGrossCaptureEnvelopeLamports: pendingOnramp.toString(),
    maximumGrossCaptureEnvelopeSol: Number(pendingOnramp) / 1e9,
  };
}).sort((a, b) => {
  const av = BigInt(a.pendingActiveOnrampRRaw);
  const bv = BigInt(b.pendingActiveOnrampRRaw);
  return av === bv ? 0 : av > bv ? -1 : 1;
});

const total = rows.reduce((sum, row) => sum + BigInt(row.pendingActiveOnrampRRaw), 0n);
const report = {
  schema: 'svsp-active-onramp-envelope/v1',
  generatedFrom: path.resolve(input),
  sourceGeneratedAt: evidence.generatedAtEnd,
  observation: evidence.observation,
  programId: evidence.executable.programId,
  currentEpoch: evidence.observation.epochInfo.epoch,
  formulas: {
    pricingDenominatorM: 'max(canonical delegated stake - 1_000_000_000 lamports, 0)',
    pendingActiveOnrampR: 'onramp delegated stake for rows whose epoch fields indicate active and whose authority/lockup/vote prerequisites match',
    finiteCapitalGrossCapture: 'R * X / (M + X), before rounding, fees, capital costs, ordering loss, and execution constraints',
    maximumGrossCaptureEnvelope: 'lim(X -> infinity) R*X/(M+X) = R',
  },
  summary: {
    epochFieldPrerequisitePoolCount: rows.length,
    totalPendingActiveOnrampRRaw: total.toString(),
    totalPendingActiveOnrampRSol: Number(total) / 1e9,
    aggregateAsymptoticMaximumGrossCaptureEnvelopeLamports: total.toString(),
    aggregateAsymptoticMaximumGrossCaptureEnvelopeSol: Number(total) / 1e9,
    highestRToPricingDenominatorM: [...rows].sort((a, b) =>
      (b.ratioRToPricingDenominatorM ?? -1) - (a.ratioRToPricingDenominatorM ?? -1))[0] || null,
    largestPendingOnrampR: rows[0] || null,
  },
  rows,
  limitations: [
    'StakeHistory was not evaluated. The RPC endpoint returned Method not found for getStakeActivation; active labels use activation/deactivation epoch fields only.',
    'No Replenish transaction was simulated. These rows establish static epoch/meta/vote prerequisites, not successful merge execution.',
    'The maximum envelope is an asymptotic gross upper bound. It does not establish source compatibility, available flash inventory, feasible capital, atomic ordering, fees, or profit.',
    'Final vulnerability validation requires a source-compatible end-to-end path and sigVerify:true evidence; neither is supplied by this projection.',
  ],
};

fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({output: path.resolve(output), summary: report.summary}, null, 2));
