#!/usr/bin/env node
// Deterministic arithmetic over observed mainnet RewardsPublished/PriceVerified events.
const fs = require('fs');

const history = JSON.parse(fs.readFileSync(`${__dirname}/hastra-history-analysis.json`, 'utf8'));
const simulation = JSON.parse(fs.readFileSync(`${__dirname}/hastra-v1-simulations.json`, 'utf8'));
const rows = history.rows.filter((row) => row.err == null).sort((a, b) => a.slot - b.slot);
const verifies = rows.filter((row) => row.instructions.includes('verify_price'));
const publishes = rows.filter((row) => row.instructions.includes('publish_rewards'));
const deposits = rows.filter((row) => row.instructions.includes('deposit'));
const SCALE = 10n ** 18n;
const ONE_MILLION = 1_000_000n * 1_000_000n;
const lenderRaw = BigInt(simulation.lenderInventory.wylds.availableRaw);

function eventData(row, name) {
  return row.events.find((event) => event.name === name)?.data;
}
function model(amount, oldPrice, newPrice) {
  const shares = amount * SCALE / oldPrice;
  const assetsOut = shares * newPrice / SCALE;
  return {
    assetsInRaw: amount.toString(),
    sharesMintedRaw: shares.toString(),
    assetsOutRaw: assetsOut.toString(),
    netWyldsRaw: (assetsOut - amount).toString(),
  };
}

const windows = [];
for (const publish of publishes) {
  const previous = [...verifies].reverse().find((row) => row.slot < publish.slot);
  const next = verifies.find((row) => row.slot > publish.slot);
  const followingPublish = publishes.find((row) => row.slot > publish.slot);
  const cycleVerifies = verifies.filter((row) => row.slot > publish.slot
    && (!followingPublish || row.slot < followingPublish.slot));
  if (!previous || !next) continue;
  const reward = eventData(publish, 'RewardsPublished');
  const oldEvent = eventData(previous, 'PriceVerifiedEvent');
  const newEvent = eventData(next, 'PriceVerifiedEvent');
  if (!reward || !oldEvent || !newEvent) continue;
  const oldPrice = BigInt(oldEvent.price);
  const newPrice = BigInt(newEvent.price);
  const preRewardVaultAssets = BigInt(reward.total_assets) - BigInt(reward.amount);
  const best = cycleVerifies.reduce((winner, row) => {
    const candidate = eventData(row, 'PriceVerifiedEvent');
    if (!candidate) return winner;
    return !winner || BigInt(candidate.price) > BigInt(winner.event.price) ? { row, event: candidate } : winner;
  }, null);
  windows.push({
    publish: { signature: publish.signature, slot: publish.slot, blockTimeIso: publish.blockTimeIso,
      amountRaw: reward.amount, publicationId: reward.id },
    priorPrice: { signature: previous.signature, slot: previous.slot, blockTimeIso: previous.blockTimeIso,
      raw: oldEvent.price, observationTimestamp: oldEvent.price_timestamp },
    nextPrice: { signature: next.signature, slot: next.slot, blockTimeIso: next.blockTimeIso,
      raw: newEvent.price, observationTimestamp: newEvent.price_timestamp },
    openWindowSeconds: next.blockTime - publish.blockTime,
    priceDeltaRaw: (newPrice - oldPrice).toString(),
    priceIncreasePartsPerBillion: ((newPrice - oldPrice) * 1_000_000_000n / oldPrice).toString(),
    depositsObservedInsideWindow: deposits.filter((row) => row.slot > publish.slot && row.slot < next.slot)
      .map((row) => ({ signature: row.signature, slot: row.slot, blockTimeIso: row.blockTimeIso,
        event: eventData(row, 'DepositEvent') })),
    modeledAtOneMillionWylds: model(ONE_MILLION, oldPrice, newPrice),
    modeledAtLiveWyldsLenderInventory: model(lenderRaw - 1n, oldPrice, newPrice),
    modeledAtPreRewardVaultAssets: model(preRewardVaultAssets, oldPrice, newPrice),
    bestObservedExitBeforeNextReward: best ? {
      signature: best.row.signature, slot: best.row.slot, blockTimeIso: best.row.blockTimeIso,
      raw: best.event.price,
      secondsAfterPublish: best.row.blockTime - publish.blockTime,
      modeledAtOneMillionWylds: model(ONE_MILLION, oldPrice, BigInt(best.event.price)),
      modeledAtLiveWyldsLenderInventory: model(lenderRaw - 1n, oldPrice, BigInt(best.event.price)),
      modeledAtPreRewardVaultAssets: model(preRewardVaultAssets, oldPrice, BigInt(best.event.price)),
    } : null,
  });
}

const latestPositive = [...windows].reverse().find((window) => BigInt(window.priceDeltaRaw) > 0n);
const output = {
  generatedAt: new Date().toISOString(),
  method: 'offline deterministic execution of the deployed floor-division formulas over decoded mainnet events',
  formula: {
    deposit: 'shares=floor(assets*1e18/old_price)',
    redeem: 'assets_out=floor(shares*new_price/1e18)',
  },
  caveat: 'This is a two-transaction temporal path. Atomic flash liquidity cannot span the reward-to-price window; modeled lender inventory is only a scale reference, not a claim that a flash loan can finance the path.',
  latestPositiveWindow: latestPositive,
  windows,
};
fs.writeFileSync(`${__dirname}/hastra-reward-window-analysis.json`, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(latestPositive, null, 2));
