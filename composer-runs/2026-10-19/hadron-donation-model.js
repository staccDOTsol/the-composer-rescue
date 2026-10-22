#!/usr/bin/env node
'use strict';
// Conservative value bounds for donation-induced curve changes. No RPC calls.
const fs = require('fs');
const path = require('path');
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'hadron-donation-state.json'), 'utf8'));

function model(pool) {
  const dx = pool.mints.decimalsX, dy = pool.mints.decimalsY;
  const xTokens = Number(pool.vaults.rawX) / 10 ** dx;
  const yTokens = Number(pool.vaults.rawY) / 10 ** dy;
  const humanMid = pool.oracle.midpriceRawAtoms * 10 ** (dx - dy);
  const xValueQuote = xTokens * humanMid;
  const yValueQuote = yTokens;
  const points = pool.curves.priceBid.points;
  let maxAbsSlope = 0;
  for (let i = 1; i < points.length; i++) {
    const x0 = Number(points[i - 1].amountIn) / 2 ** 32;
    const x1 = Number(points[i].amountIn) / 2 ** 32;
    if (x1 > x0) maxAbsSlope = Math.max(maxAbsSlope,
      Math.abs((points[i].priceFactor - points[i - 1].priceFactor) / (x1 - x0)));
  }
  // Favorable upper bound: assume the swap drains the entire opposite vault and
  // every unit of factor improvement applies to it. This intentionally ignores
  // ordinary spread/fee/slippage, so a bound below 1 is dispositive.
  const priceDonationXGainPerValue = maxAbsSlope * yValueQuote / xValueQuote;
  const priceDonationYGainPerValue = maxAbsSlope * xValueQuote / yValueQuote;
  const result = {label: pool.label, pool: pool.pool,
    balances: {xTokens, yTokens, humanMidQuotePerX: humanMid, xValueQuote, yValueQuote},
    priceCurve: {maxAbsFactorSlopePerVaultFraction: maxAbsSlope,
      donationIntoXSourceUpperBoundGainPerDonatedValue: priceDonationXGainPerValue,
      donationIntoYSourceUpperBoundGainPerDonatedValue: priceDonationYGainPerValue},
    riskCurve: {flat: pool.curves.riskBid.points.every(p => p.priceFactor === 1) &&
      pool.curves.riskAsk.points.every(p => p.priceFactor === 1)},
  };
  if (pool.label === 'USDC_USDT') {
    const m = pool.oracle.midpriceRawAtoms;
    const x = xTokens, y = yTokens, totalBase = x + y / m;
    const p = x / totalBase;
    // Current p<0.5. Bid slope is -1e-5 per p and ask slope is +8e-5 per p.
    const bidDfDy = 1e-5 * x / (m * totalBase ** 2);
    const askDfDx = 8e-5 * (y / m) / totalBase ** 2;
    result.riskCurve = {flat: false, pctBase: p,
      favorableQuoteDonationForBid: {
        factorGainPerDonatedQuote: bidDfDy,
        upperBoundGainPerDonatedValueAssumingEntireYVaultOutput: bidDfDy * yValueQuote,
      },
      favorableBaseDonationForAsk: {
        factorGainPerDonatedBase: askDfDx,
        upperBoundGainPerDonatedValueAssumingEntireXVaultOutput: askDfDx * xTokens,
      },
    };
  }
  const riskMax = result.riskCurve.flat ? 0 : Math.max(
    result.riskCurve.favorableQuoteDonationForBid.upperBoundGainPerDonatedValueAssumingEntireYVaultOutput,
    result.riskCurve.favorableBaseDonationForAsk.upperBoundGainPerDonatedValueAssumingEntireXVaultOutput,
  );
  result.combinedConservativeUpperBoundGainPerDonatedValue = Math.max(
    priceDonationXGainPerValue, priceDonationYGainPerValue,
  ) + riskMax;
  result.donationCanBreakEvenBeforeFees = result.combinedConservativeUpperBoundGainPerDonatedValue >= 1;
  return result;
}

const out = {derivedFrom: {observedAtUtc: state.observedAtUtc, startSlot: state.startSlot,
  endSlot: state.endSlot}, assumptions: [
  'Unsolicited SPL transfers are irreversible to the outsider except through a subsequent swap.',
  'The bound grants the attacker the full opposite vault as factor-adjusted output, which overstates realizable gain.',
  'Protocol fee, spread, flash fee, network fee, rounding, and independent-exit slippage are omitted; each can only worsen the result.',
], pools: state.pools.map(model)};
fs.writeFileSync(path.join(__dirname, 'hadron-donation-model.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
