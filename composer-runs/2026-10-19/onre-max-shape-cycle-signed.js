#!/usr/bin/env node
'use strict';

// Measures the Jupiter leg's maximum usable amount in the complete signed OnRe
// KLend + Jupiter cycle shape. Every transaction is simulated with sigVerify on
// an isolated current-mainnet-backed Surfpool fork; no send path is present.

const fs = require('fs');
const path = require('path');
const {createRequire} = require('module');
const requireAudit = createRequire(path.join(__dirname, '../2026-10-15/onre-harness/package.json'));
const {SystemProgram} = requireAudit('@solana/web3.js');
const {getAssociatedTokenAddressSync} = requireAudit('@solana/spl-token');
const audit = require('../2026-10-15/onre-signed-fork-audit.js');

const OUTPUT = process.env.ONRE_MAX_SHAPE_OUTPUT ||
  path.join(__dirname, 'onre-max-shape-cycle-signed.json');
const INVENTORY = path.join(__dirname, 'onre-focused-multiflash-signed.json');
const STARTING_USDG = 100_000_000_000_000n;

const bossUsdG = getAssociatedTokenAddressSync(
  audit.USDG, audit.BOSS, true, audit.TOKEN_2022_PROGRAM_ID);
audit.remember(bossUsdG, 'onreBossUsdG');

const sumDeltas = (row, roles) => roles.reduce((sum, role) => {
  const value = row.deltas?.[role]?.tokenAmountRaw;
  return value == null ? sum : sum + BigInt(value);
}, 0n);

async function run() {
  if (await audit.rpc('getHealth', []) !== 'ok') throw new Error('fork is not healthy');
  await audit.rpc('surfnet_setAccount', [audit.USER.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  await audit.rpc('surfnet_setTokenAccount', [audit.USER.toBase58(), audit.USDG.toBase58(),
    {amount: Number(STARTING_USDG)}, audit.TOKEN_2022_PROGRAM_ID.toBase58()]);
  await audit.rpc('surfnet_setTokenAccount', [audit.USER.toBase58(), audit.ONYC.toBase58(),
    {amount: 0}, audit.TOKEN_PROGRAM_ID.toBase58()]);

  const providers = await audit.loadProviders();
  const klend = providers.klendRows.find(row => row.flashFeeSf === 0n);
  if (!klend) throw new Error('no current zero-fee KLend USDG reserve');
  const klendLoans = amount => [{row: klend, amount}];

  const priceProbe = await audit.simulate('max_shape_current_price_probe',
    audit.compose({actions: [audit.takeOffer(1_000_000n)]}), audit.PROTOCOL_WATCH,
    {class: 'price-discovery'}, {fullLogs: true});
  const priceRaw = audit.parsePrice(priceProbe.logs);
  if (priceProbe.err || !priceRaw) throw new Error('current price probe failed');

  const previous = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
  const cachedDualUpper = BigInt(
    previous.providerInventory.jupiter.dualWithFullKlendBoundary.maximumUsableRaw);
  const liveJupUpper = providers.jup.vaultRaw < BigInt(providers.jup.positionState.maxDebtCeilingRaw)
    ? providers.jup.vaultRaw : BigInt(providers.jup.positionState.maxDebtCeilingRaw);
  const upper = cachedDualUpper < liveJupUpper ? cachedDualUpper : liveJupUpper;

  const source = amount => ({klendLoans: klendLoans(klend.availableRaw), jupLoans: [amount]});
  const build = amount => audit.compose({...source(amount),
    actions: audit.cycleActions(klend.availableRaw + amount, priceRaw)});
  const lenderAddresses = audit.lenderWatch(klendLoans(klend.availableRaw), [], true);
  // Keep the capacity search to one replay (<=10 watched accounts) while retaining
  // every account needed to prove outsider equity, closure, and lender conservation.
  const boundaryWatch = [audit.USER_USDG, audit.USER_ONYC, audit.PROTOCOL_WATCH[2],
    audit.USDG_REDEMPTION_VAULT, bossUsdG, lenderAddresses[0], lenderAddresses[3]];
  const boundary = await audit.testBoundary('max_shape_onre_cycle', build, 1_000n, upper,
    boundaryWatch, {providers: ['KLend', 'Jupiter'],
      klendAmountRaw: klend.availableRaw.toString(),
      shape: 'take-offer -> prop-AMM sell -> close -> exact lender repayments'});
  if (!boundary.maximumUsableRaw) throw new Error(`complete cycle lower bound failed: ${boundary.blocker}`);
  const jupiterMax = BigInt(boundary.maximumUsableRaw);
  const total = klend.availableRaw + jupiterMax;
  // Reuse the last successful signed search transaction itself. Jupiter's
  // utilization boundary moves with Clock-accrued interest, so a later replay of
  // the same nominal amount is not evidence about the earlier observation slot.
  const final = audit.cases.find(row => row.label === `max_shape_onre_cycle_search_${jupiterMax}`);
  if (!final || final.err) throw new Error('last successful boundary sample was not retained');
  const economic = audit.classifySuccessfulCycle(final, {klend: 1, p0: 0, jup: 1});
  const sell = audit.parseSell(final.logs);
  const protocolRoles = ['onreRedemptionUsdGVault', 'onreBossUsdG'];
  const lenderRoles = Object.keys(final.deltas || {}).filter(role =>
    role.startsWith('klendSupply:') || role === 'jupiterUsdGVault');
  const outsider = BigInt(final.deltas?.attackerUsdG?.tokenAmountRaw || 0);
  const protocol = sumDeltas(final, protocolRoles);
  const lenders = sumDeltas(final, lenderRoles);

  const output = {
    generatedAt: new Date().toISOString(),
    safety: {environment: 'isolated current-mainnet-backed Surfpool fork',
      transport: 'simulateTransaction only', sigVerify: true, transactionVersion: 1,
      transactionSubmitted: false, maxWireBytes: 4096, maxAccounts: 64,
      rpcCredentialRecorded: false,
      forkWrites: 'Only synthetic fresh-outsider SOL/USDG setup; all tested transactions roll back.'},
    currentPriceScale9Raw: priceRaw.toString(),
    providerAllocationRaw: {klend: klend.availableRaw.toString(),
      jupiter: jupiterMax.toString(), total: total.toString()},
    boundary: {...boundary, interpretation:
      'maximum successful sampled amount; the adjacent failure was observed later, and the live utilization boundary moves with Clock-accrued interest'},
    exactBoundaryCycle: {err: final.err, targetErrorLog: final.targetErrorLog,
      unitsConsumed: final.unitsConsumed, sell, repaymentLogs: final.repayLogs, economic,
      equityRawUsdG: {outsider: outsider.toString(), protocol: protocol.toString(),
        lenders: lenders.toString(), conservationResidual: (outsider + protocol + lenders).toString()},
      wire: final.wire && {version: final.wire.version, bytes: final.wire.bytes,
        accounts: final.wire.accounts, instructions: final.wire.instructions,
        requiredSignatures: final.wire.requiredSignatures, signerOrder: final.wire.signerOrder,
        sigVerify: final.wire.sigVerify, messageSha256: final.wire.messageSha256,
        signedWireSha256: final.wire.signedWireSha256}, watchedDeltas: final.deltas},
    result: {exactBoundarySucceeded: final.err === null,
      fullyRepaidLiabilityFree: economic.atomicSuccess && economic.repaymentsLogged &&
        economic.lenderVaultsConserved && economic.attackerOnycClosedOrZero && economic.requestClosed,
      positiveOutsiderNetEquity: economic.positiveNetEquity,
      findingDemonstrated: economic.positiveNetEquity,
      conclusion: economic.positiveNetEquity
        ? 'A positive, fully repaid, liability-free outsider cycle was reproduced.'
        : 'The maximum complete two-provider cycle was not profitable after exact repayment and full unwind.'}
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({output: OUTPUT, providerAllocationRaw: output.providerAllocationRaw,
    boundary: {maximumUsableRaw: boundary.maximumUsableRaw, firstFailRaw: boundary.firstFailRaw,
      probes: boundary.trace.length}, exactBoundaryCycle: {err: final.err,
      unitsConsumed: final.unitsConsumed, wire: output.exactBoundaryCycle.wire,
      equityRawUsdG: output.exactBoundaryCycle.equityRawUsdG,
      economic}, result: output.result}, null, 2));
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
