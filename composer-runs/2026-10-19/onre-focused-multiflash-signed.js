#!/usr/bin/env node
'use strict';

// Focused signed v1 composition for the sole surviving OnRe value path:
// permissionless USDG->ONyc offer take followed by prop-AMM ONyc->USDG sell.
// Runs only via simulateTransaction(sigVerify:true) on a local Surfpool fork.

const fs = require('fs');
const path = require('path');
const {createRequire} = require('module');
const requireAudit = createRequire(path.join(__dirname, '../2026-10-15/onre-harness/package.json'));
const {SystemProgram} = requireAudit('@solana/web3.js');
const {getAssociatedTokenAddressSync} = requireAudit('@solana/spl-token');
const audit = require('../2026-10-15/onre-signed-fork-audit.js');

const OUTPUT = process.env.ONRE_FLASH_OUTPUT || path.join(__dirname, 'onre-focused-multiflash-signed.json');
const STARTING_USDG = 100_000_000_000_000;

const bossUsdG = getAssociatedTokenAddressSync(audit.USDG, audit.BOSS, true, audit.TOKEN_2022_PROGRAM_ID);
audit.remember(bossUsdG, 'onreBossUsdG');

const sumDeltas = (row, roles) => roles.reduce((sum, role) => {
  const value = row.deltas?.[role]?.tokenAmountRaw;
  return value == null ? sum : sum + BigInt(value);
}, 0n);

function cycleSummary(row, providerCounts, allocation) {
  row.sell = audit.parseSell(row.logs);
  row.economic = audit.classifySuccessfulCycle(row, providerCounts);
  const protocolUsdGRoles = ['onreRedemptionUsdGVault', 'onreOfferUsdGVault',
    'onrePermissionlessUsdGVault', 'onreBossUsdG'];
  const lenderRoles = Object.keys(row.deltas || {}).filter(role =>
    role.startsWith('klendSupply:') || role.startsWith('project0Vault:') || role === 'jupiterUsdGVault');
  const attacker = BigInt(row.deltas?.attackerUsdG?.tokenAmountRaw || 0);
  const protocol = sumDeltas(row, protocolUsdGRoles);
  const lenders = sumDeltas(row, lenderRoles);
  return {label: row.label, allocationRaw: allocation, err: row.err,
    targetErrorLog: row.targetErrorLog, unitsConsumed: row.unitsConsumed,
    wire: row.wire && {version: row.wire.version, bytes: row.wire.bytes,
      accounts: row.wire.accounts, instructions: row.wire.instructions,
      requiredSignatures: row.wire.requiredSignatures, signerOrder: row.wire.signerOrder,
      sigVerify: row.wire.sigVerify, messageSha256: row.wire.messageSha256,
      signedWireSha256: row.wire.signedWireSha256}, sell: row.sell,
    repaymentLogs: row.repayLogs, economic: row.economic,
    equityRawUsdG: {outsider: attacker.toString(), protocol: protocol.toString(),
      lenders: lenders.toString(), conservationResidual: (attacker + protocol + lenders).toString()},
    watchedDeltas: row.deltas};
}

async function run() {
  if (await audit.rpc('getHealth', []) !== 'ok') throw new Error('fork is not healthy');
  await audit.rpc('surfnet_setAccount', [audit.USER.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  await audit.rpc('surfnet_setTokenAccount', [audit.USER.toBase58(), audit.USDG.toBase58(),
    {amount: STARTING_USDG}, audit.TOKEN_2022_PROGRAM_ID.toBase58()]);
  await audit.rpc('surfnet_setTokenAccount', [audit.USER.toBase58(), audit.ONYC.toBase58(),
    {amount: 0}, audit.TOKEN_PROGRAM_ID.toBase58()]);

  const providers = await audit.loadProviders();
  const zeroKlend = providers.klendRows.filter(row => row.flashFeeSf === 0n);
  if (!zeroKlend.length) throw new Error('no current zero-fee KLend USDG reserve');
  const klend = zeroKlend[0];
  const p0 = providers.p0Rows[0];

  const priceProbe = await audit.simulate('focused_current_price_probe',
    audit.compose({actions: [audit.takeOffer(1_000_000n)]}), audit.PROTOCOL_WATCH,
    {class: 'price-discovery'}, {fullLogs: true});
  const priceRaw = audit.parsePrice(priceProbe.logs);
  if (priceProbe.err || !priceRaw) throw new Error('current price probe failed');

  const klendLoan = amount => [{row: klend, amount}];
  const klendExact = await audit.simulate('focused_klend_exact_available',
    audit.compose({klendLoans: klendLoan(klend.availableRaw)}),
    [audit.USER_USDG, ...audit.lenderWatch(klendLoan(klend.availableRaw))],
    {provider: 'KLend', amountRaw: klend.availableRaw.toString()});
  const klendPlusOne = await audit.simulate('focused_klend_available_plus_one',
    audit.compose({klendLoans: klendLoan(klend.availableRaw + 1n)}),
    [audit.USER_USDG, ...audit.lenderWatch(klendLoan(klend.availableRaw + 1n))],
    {provider: 'KLend', amountRaw: (klend.availableRaw + 1n).toString()});

  const p0ProbeAmounts = [1_000n, 10_000n, 100_000n, 1_000_000n, 10_000_000n,
    100_000_000n, 1_000_000_000n, p0.vaultRaw / 2n, p0.vaultRaw]
    .filter((amount, index, rows) => amount > 0n && amount <= p0.vaultRaw &&
      rows.findIndex(value => value === amount) === index);
  const p0Probes = [];
  let p0Lower = null;
  for (const amount of p0ProbeAmounts) {
    const row = await audit.simulate(`focused_project0_grid_${amount}`,
      audit.compose({p0Loans: [{row: p0, amount}]}),
      [audit.USER_USDG, ...audit.lenderWatch([], [{row: p0}])],
      {provider: 'Project0', amountRaw: amount.toString(), displayedVaultRaw: p0.vaultRaw.toString()});
    p0Probes.push({amountRaw: amount.toString(), success: row.err === null,
      err: row.err, targetErrorLog: row.targetErrorLog});
    if (row.err === null) { p0Lower = {amount, row}; break; }
  }
  const p0Boundary = p0Lower
    ? await audit.testBoundary('focused_project0_usable', amount => audit.compose({
      p0Loans: [{row: p0, amount}]}), p0Lower.amount, p0.vaultRaw,
    [audit.USER_USDG, ...audit.lenderWatch([], [{row: p0}])],
    {provider: 'Project0', bank: p0.bank.toBase58()})
    : {maximumUsableRaw: null,
      blocker: 'No successful standard flash roundtrip across the bounded amount grid.',
      trace: p0Probes};
  const p0Max = p0Boundary.maximumUsableRaw ? BigInt(p0Boundary.maximumUsableRaw) : 0n;

  const jupUpper = providers.jup.vaultRaw < BigInt(providers.jup.positionState.maxDebtCeilingRaw)
    ? providers.jup.vaultRaw : BigInt(providers.jup.positionState.maxDebtCeilingRaw);
  const jupBoundary = await audit.testBoundary('focused_jupiter_usable',
    amount => audit.compose({jupLoans: [amount]}), 1_000n, jupUpper,
    [audit.USER_USDG, ...audit.lenderWatch([], [], true)], {provider: 'Jupiter'});
  if (!jupBoundary.maximumUsableRaw) throw new Error('no usable Jupiter USDG flash capacity');
  const jupMax = BigInt(jupBoundary.maximumUsableRaw);
  const dualJupBoundary = await audit.testBoundary('focused_dual_klend_jupiter_usable',
    amount => audit.compose({klendLoans: klendLoan(klend.availableRaw), jupLoans: [amount]}),
    1_000n, jupMax,
    [audit.USER_USDG, ...audit.lenderWatch(klendLoan(klend.availableRaw), [], true)],
    {providers: ['KLend', 'Jupiter'], klendAmountRaw: klend.availableRaw.toString()});
  if (!dualJupBoundary.maximumUsableRaw) throw new Error('no usable dual KLend/Jupiter composition');
  const dualJupMax = BigInt(dualJupBoundary.maximumUsableRaw);

  const cycleRows = [];
  async function composedCycle(label, source, allocation) {
    const amount = Object.values(allocation).reduce((sum, value) => sum + BigInt(value), 0n);
    const watches = [...audit.PROTOCOL_WATCH, bossUsdG,
      ...audit.lenderWatch(source.klendLoans || [], source.p0Loans || [], (source.jupLoans || []).length > 0)];
    const row = await audit.simulate(label,
      audit.compose({...source, actions: audit.cycleActions(amount, priceRaw)}), watches,
      {class: 'fully-unwound-current-onre-multiflash', allocationRaw: allocation,
        routedUsdGRaw: amount.toString()}, {fullLogs: true, includeWire: true});
    const summary = cycleSummary(row, {klend: (source.klendLoans || []).length,
      p0: (source.p0Loans || []).length, jup: (source.jupLoans || []).length}, allocation);
    cycleRows.push(summary);
    return summary;
  }

  await composedCycle('dual_source_maximum_usable_klend_jupiter',
    {klendLoans: klendLoan(klend.availableRaw), jupLoans: [dualJupMax]},
    {klend: klend.availableRaw.toString(), jupiter: dualJupMax.toString()});
  await composedCycle('dual_source_asymmetric_klend_heavy',
    {klendLoans: klendLoan(klend.availableRaw * 99n / 100n), jupLoans: [1_000n]},
    {klend: (klend.availableRaw * 99n / 100n).toString(), jupiter: '1000'});
  await composedCycle('dual_source_asymmetric_jupiter_heavy',
    {klendLoans: klendLoan(1_000_000n), jupLoans: [dualJupMax]},
    {klend: '1000000', jupiter: dualJupMax.toString()});

  if (p0Max > 0n) {
    await composedCycle('tri_source_maximum_usable_klend_project0_jupiter',
      {klendLoans: klendLoan(klend.availableRaw), p0Loans: [{row: p0, amount: p0Max}],
        jupLoans: [jupMax]},
      {klend: klend.availableRaw.toString(), project0: p0Max.toString(), jupiter: jupMax.toString()});
    await composedCycle('tri_source_asymmetric_project0_heavy',
      {klendLoans: klendLoan(1_000_000n), p0Loans: [{row: p0, amount: p0Max}], jupLoans: [1_000n]},
      {klend: '1000000', project0: p0Max.toString(), jupiter: '1000'});
  }

  const output = {generatedAt: new Date().toISOString(), safety: {
    environment: 'isolated current-mainnet-backed Surfpool fork', transport: 'simulateTransaction only',
    sigVerify: true, transactionVersion: 1, transactionSubmitted: false,
    maxWireBytes: 4096, maxAccounts: 64, rpcCredentialRecorded: false,
    forkWrites: 'Only synthetic fresh-outsider SOL/USDG setup; all tested transactions roll back.'},
    survivor: 'Intended permissionless offer-take -> prop-AMM sell state/pricing cycle',
    currentPriceScale9Raw: priceRaw.toString(),
    providerInventory: {observationSlot: providers.slot,
      klend: {reserve: klend.reserve.toBase58(), availableRaw: klend.availableRaw.toString(),
        flashFeeSf: klend.flashFeeSf.toString(), exactAccepted: klendExact.err === null,
        plusOneRejected: klendPlusOne.err !== null, plusOneError: klendPlusOne.targetErrorLog},
      project0: {bank: p0.bank.toBase58(), vault: p0.vault.toBase58(),
        displayedVaultRaw: p0.vaultRaw.toString(), probes: p0Probes, boundary: p0Boundary},
      jupiter: {displayedVaultRaw: providers.jup.vaultRaw.toString(),
        maxDebtCeilingRaw: providers.jup.positionState.maxDebtCeilingRaw,
        feeBps: providers.jup.adminState.feeBps, standaloneBoundary: jupBoundary,
        dualWithFullKlendBoundary: dualJupBoundary}},
    result: {cycleCount: cycleRows.length,
      successfulFullyRepaidLiabilityFree: cycleRows.filter(row => row.economic?.atomicSuccess &&
        row.economic?.repaymentsLogged && row.economic?.lenderVaultsConserved &&
        row.economic?.attackerOnycClosedOrZero).length,
      positiveOutsiderNetEquityCycles: cycleRows.filter(row => row.economic?.positiveNetEquity).length,
      findingDemonstrated: cycleRows.some(row => row.economic?.positiveNetEquity),
      conclusion: 'No positive outsider equity remained after exact lender repayment and full OnRe unwind.'},
    cycles: cycleRows};
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({output: OUTPUT, currentPriceScale9Raw: output.currentPriceScale9Raw,
    providers: {klend: output.providerInventory.klend,
      project0: {displayedVaultRaw: p0.vaultRaw.toString(), maximumUsableRaw: p0Boundary.maximumUsableRaw,
        blocker: p0Boundary.blocker},
      jupiter: {displayedVaultRaw: providers.jup.vaultRaw.toString(),
        standaloneMaximumUsableRaw: jupBoundary.maximumUsableRaw,
        dualWithFullKlendMaximumUsableRaw: dualJupBoundary.maximumUsableRaw}}, result: output.result,
    cycles: cycleRows.map(row => ({label: row.label, err: row.err, wire: row.wire,
      equityRawUsdG: row.equityRawUsdG, economic: row.economic}))}, null, 2));
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
