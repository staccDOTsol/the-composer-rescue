#!/usr/bin/env node
'use strict';

const fs = require('fs');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const root = __dirname;
const readRpc = name => {
  const parsed = JSON.parse(fs.readFileSync(`${root}/jupusd-prediction-current-${name}-rpc.json`));
  if (parsed.error) throw new Error(`${name}: ${JSON.stringify(parsed.error)}`);
  return parsed.result;
};
const pubkey = (b, o) => bs58.encode(b.subarray(o, o + 32));
const u64 = (b, o) => b.readBigUInt64LE(o).toString();
const i64 = (b, o) => b.readBigInt64LE(o).toString();
const string = (b, cursor) => {
  const length = b.readUInt32LE(cursor.offset);
  cursor.offset += 4;
  const value = b.subarray(cursor.offset, cursor.offset + length).toString('utf8');
  cursor.offset += length;
  return value;
};

function decodePosition(row) {
  const b = Buffer.from(row.account.data[0], 'base64');
  const c = {offset: 8};
  const owner = pubkey(b, c.offset); c.offset += 32;
  const marketId = string(b, c);
  const isYes = !!b[c.offset++];
  const payoutClaimed = !!b[c.offset++];
  const payoutClaimedUsd = u64(b, c.offset); c.offset += 8;
  const openedAt = i64(b, c.offset); c.offset += 8;
  const contracts = u64(b, c.offset); c.offset += 8;
  const totalCostUsd = u64(b, c.offset); c.offset += 8;
  const openOrders = b.readUInt32LE(c.offset); c.offset += 4;
  const feesPaidUsd = u64(b, c.offset); c.offset += 8;
  const realizedPnlUsd = i64(b, c.offset); c.offset += 8;
  const updatedAt = i64(b, c.offset); c.offset += 8;
  const bump = b[c.offset++];
  const unitVersion = b[c.offset++];
  const payer = pubkey(b, c.offset); c.offset += 32;
  return {pubkey: row.pubkey, owner, marketId, isYes, payoutClaimed, payoutClaimedUsd,
    openedAt, contracts, totalCostUsd, openOrders, feesPaidUsd, realizedPnlUsd,
    updatedAt, bump, unitVersion, payer, accountLength: b.length,
    trailingNonzeroBytes: [...b.subarray(c.offset)].filter(x => x !== 0).length};
}

function decodeMarketResult(row) {
  const b = Buffer.from(row.account.data[0], 'base64');
  const c = {offset: 8};
  const marketId = string(b, c);
  const outcome = b[c.offset++];
  const settlementTime = i64(b, c.offset); c.offset += 8;
  const claimsEnabled = !!b[c.offset++];
  const createdAt = i64(b, c.offset); c.offset += 8;
  const bump = b[c.offset++];
  return {pubkey: row.pubkey, marketId, outcome, settlementTime, claimsEnabled, createdAt, bump,
    accountLength: b.length, trailingNonzeroBytes: [...b.subarray(c.offset)].filter(x => x !== 0).length};
}

function decodeVault(row) {
  const b = Buffer.from(row.account.data[0], 'base64');
  let o = 8;
  const settlementMint = pubkey(b, o); o += 32;
  const currentContracts = u64(b, o); o += 8;
  const currentOpenOrders = b.readUInt32LE(o); o += 4;
  const globalMaxContracts = u64(b, o); o += 8;
  const positionMaxContracts = u64(b, o); o += 8;
  const positionMaxOrders = b.readUInt32LE(o); o += 4;
  const settlementDelaySeconds = u64(b, o); o += 8;
  const depositsDisabled = !!b[o++];
  const withdrawalsDisabled = !!b[o++];
  const protocolFeeBps = b.readUInt16LE(o); o += 2;
  const bump = b[o++];
  const tradingDisabled = !!b[o++];
  const unitVersion = b[o++];
  return {pubkey: row.pubkey, settlementMint, currentContracts, currentOpenOrders,
    globalMaxContracts, positionMaxContracts, positionMaxOrders, settlementDelaySeconds,
    depositsDisabled, withdrawalsDisabled, protocolFeeBps, bump, tradingDisabled,
    unitVersion, accountLength: b.length, trailingNonzeroBytes: [...b.subarray(o)].filter(x => x !== 0).length};
}

function decodeOrder(row) {
  const b = Buffer.from(row.account.data[0], 'base64');
  const c = {offset: 8};
  const owner = pubkey(b, c.offset); c.offset += 32;
  const position = pubkey(b, c.offset); c.offset += 32;
  const status = b[c.offset++];
  const marketId = string(b, c);
  const isYes = !!b[c.offset++];
  const isBuy = !!b[c.offset++];
  const createdAt = i64(b, c.offset); c.offset += 8;
  const contracts = u64(b, c.offset); c.offset += 8;
  const maxFillPriceUsd = u64(b, c.offset); c.offset += 8;
  const filledAt = i64(b, c.offset); c.offset += 8;
  const filledContracts = u64(b, c.offset); c.offset += 8;
  const avgFillPriceUsd = u64(b, c.offset); c.offset += 8;
  const orderId = b[c.offset++] ? string(b, c) : null;
  const externalOrderId = string(b, c);
  const bump = b[c.offset++];
  const orderType = b[c.offset++];
  const payer = pubkey(b, c.offset); c.offset += 32;
  const integrator = pubkey(b, c.offset); c.offset += 32;
  const integratorFeeBps = b.readUInt16LE(c.offset); c.offset += 2;
  const unitVersion = b[c.offset++];
  return {pubkey: row.pubkey, owner, position, status, marketId, isYes, isBuy, createdAt,
    contracts, maxFillPriceUsd, filledAt, filledContracts, avgFillPriceUsd, orderId,
    externalOrderId, bump, orderType, payer, integrator, integratorFeeBps, unitVersion,
    accountLength: b.length, trailingNonzeroBytes: [...b.subarray(c.offset)].filter(x => x !== 0).length};
}

function decodeTicket(row) {
  const b = Buffer.from(row.account.data[0], 'base64');
  const c = {offset: 8};
  const owner = pubkey(b, c.offset); c.offset += 32;
  const payer = pubkey(b, c.offset); c.offset += 32;
  const settlementMint = pubkey(b, c.offset); c.offset += 32;
  const ticketId = string(b, c);
  const ticketIdHash = b.subarray(c.offset, c.offset + 32).toString('hex'); c.offset += 32;
  const marketId = string(b, c);
  const venueTicketId = b[c.offset++] ? string(b, c) : null;
  const stakeUsd = u64(b, c.offset); c.offset += 8;
  const maxPayoutUsd = u64(b, c.offset); c.offset += 8;
  const payoutUsd = u64(b, c.offset); c.offset += 8;
  const status = b[c.offset++];
  const payoutClaimed = !!b[c.offset++];
  const createdAt = i64(b, c.offset); c.offset += 8;
  const acceptedAt = i64(b, c.offset); c.offset += 8;
  const settledAt = i64(b, c.offset); c.offset += 8;
  const claimableAt = i64(b, c.offset); c.offset += 8;
  const claimedAt = i64(b, c.offset); c.offset += 8;
  const bump = b[c.offset++];
  const unitVersion = b[c.offset++];
  c.offset += 120;
  return {pubkey: row.pubkey, owner, payer, settlementMint, ticketId, ticketIdHash, marketId,
    venueTicketId, stakeUsd, maxPayoutUsd, payoutUsd, status, payoutClaimed, createdAt,
    acceptedAt, settledAt, claimableAt, claimedAt, bump, unitVersion, accountLength: b.length,
    trailingNonzeroBytes: [...b.subarray(c.offset)].filter(x => x !== 0).length};
}

const positionsRpc = readRpc('positions');
const marketsRpc = readRpc('market-results');
const vaultsRpc = readRpc('vaults');
const ordersRpc = readRpc('orders');
const ticketsRpc = readRpc('tickets');
const positions = positionsRpc.value.map(decodePosition);
const markets = marketsRpc.value.map(decodeMarketResult);
const vaults = vaultsRpc.value.map(decodeVault);
const orders = ordersRpc.value.map(decodeOrder);
const tickets = ticketsRpc.value.map(decodeTicket);
const marketById = new Map(markets.map(m => [m.marketId, m]));
const enriched = positions.map(p => ({...p, marketResult: marketById.get(p.marketId) || null}));
const unclaimedWithContracts = enriched.filter(p => !p.payoutClaimed && BigInt(p.contracts) > 0n);
const claimEnabled = unclaimedWithContracts.filter(p => p.marketResult?.claimsEnabled);
const observedUnixTime = Math.floor(Date.now() / 1000);
const winningClaimable = claimEnabled.filter(p =>
  BigInt(p.marketResult.settlementTime) <= BigInt(observedUnixTime) &&
  ((p.marketResult.outcome === 1 && p.isYes) || (p.marketResult.outcome === 0 && !p.isYes)));
const winningLiabilityRaw = winningClaimable.reduce((sum, p) => sum + BigInt(p.contracts), 0n);
const pendingOrders = orders.filter(o => o.status === 0 || o.status === 3);
const claimableTickets = tickets.filter(t => t.status === 3 && !t.payoutClaimed &&
  BigInt(t.payoutUsd) > 0n && BigInt(t.claimableAt) <= BigInt(observedUnixTime));
const ticketLiabilityRaw = claimableTickets.reduce((sum, t) => sum + BigInt(t.payoutUsd), 0n);
const claimedOutcomeMatrix = {};
for (const p of enriched.filter(p => p.payoutClaimed && p.marketResult)) {
  const key = `outcome_${p.marketResult.outcome}_${p.isYes ? 'yes' : 'no'}`;
  claimedOutcomeMatrix[key] = (claimedOutcomeMatrix[key] || 0) + 1;
}
const summary = {
  generatedAt: new Date().toISOString(),
  slots: {positions: positionsRpc.context.slot, markets: marketsRpc.context.slot,
    orders: ordersRpc.context.slot, vaults: vaultsRpc.context.slot, tickets: ticketsRpc.context.slot},
  counts: {positions: positions.length, marketResults: markets.length, orders: ordersRpc.value.length,
    vaults: vaults.length, tickets: ticketsRpc.value.length, unclaimedWithContracts: unclaimedWithContracts.length,
    claimEnabledUnclaimedWithContracts: claimEnabled.length,
    winningClaimable: winningClaimable.length, pendingOrPartiallyFilledOrders: pendingOrders.length,
    claimableTickets: claimableTickets.length},
  observedUnixTime,
  winningLiabilityRaw: winningLiabilityRaw.toString(),
  ticketLiabilityRaw: ticketLiabilityRaw.toString(),
  claimedOutcomeMatrix,
  vaults,
  largestWinningClaimablePositions: winningClaimable
    .sort((a,b) => Number(BigInt(b.contracts)-BigInt(a.contracts))).slice(0, 25),
  pendingOrders: pendingOrders.slice(0, 25),
  largestClaimableTickets: claimableTickets
    .sort((a,b) => Number(BigInt(b.payoutUsd)-BigInt(a.payoutUsd))).slice(0, 25),
  newestUnclaimedWithContracts: unclaimedWithContracts.sort((a,b) => Number(BigInt(b.updatedAt)-BigInt(a.updatedAt))).slice(0, 25)
};
fs.writeFileSync(`${root}/jupusd-prediction-current-state-census.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({generatedAt: summary.generatedAt, slots: summary.slots, counts: summary.counts,
  observedUnixTime, winningLiabilityRaw: summary.winningLiabilityRaw,
  ticketLiabilityRaw: summary.ticketLiabilityRaw, vaults: summary.vaults,
  largestWinningClaimablePositions: summary.largestWinningClaimablePositions.slice(0, 5)}, null, 2));
