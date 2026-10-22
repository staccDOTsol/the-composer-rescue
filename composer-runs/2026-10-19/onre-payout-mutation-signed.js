#!/usr/bin/env node
'use strict';

// Signed, rollback-only mutation of the largest observed post-deploy OnRe
// OpenSwapSell payout. It runs only against a local Surfpool fork and has no
// transaction submission path.

const fs = require('fs');
const path = require('path');
const {createRequire} = require('module');
const requireAudit = createRequire(path.join(__dirname, '../2026-10-15/onre-harness/package.json'));
const {PublicKey, SystemProgram} = requireAudit('@solana/web3.js');
const audit = require('../2026-10-15/onre-signed-fork-audit.js');

const OUTPUT = process.env.ONRE_MUTATION_OUTPUT || path.join(__dirname, 'onre-payout-mutation-signed.json');
const RECEIPTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'onre-payout-receipts.json'), 'utf8'));
const receipt = RECEIPTS.highestValueReceipt;
if (!receipt || receipt.handlers?.[0] !== 'OpenSwapSell') throw new Error('expected highest OpenSwapSell receipt');
const source = receipt.onreInstructions.find(row => row.handler === 'OpenSwapSell');
if (!source || source.accounts.length !== 31) throw new Error('unexpected source instruction shape');

const HISTORICAL_USER = new PublicKey(source.accounts[26]);
const HISTORICAL_INPUT = new PublicKey(source.accounts[12]);
const HISTORICAL_RECIPIENT = new PublicKey(source.accounts[13]);
const SOURCE_DATA = Buffer.from((requireAudit('bs58').default || requireAudit('bs58')).decode(source.data));
const AMOUNT = SOURCE_DATA.readBigUInt64LE(8);
const MINIMUM_OUT = SOURCE_DATA.readBigUInt64LE(16);

const watch = [...audit.PROTOCOL_WATCH,
  audit.remember(HISTORICAL_INPUT, 'historicalUserOnyc'),
  audit.remember(HISTORICAL_RECIPIENT, 'historicalUserUsdG')];

async function run() {
  const health = await audit.rpc('getHealth', []);
  if (health !== 'ok') throw new Error(`fork health ${health}`);
  await audit.rpc('surfnet_setAccount', [audit.USER.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  await audit.rpc('surfnet_setTokenAccount', [audit.USER.toBase58(), audit.ONYC.toBase58(),
    {amount: Number(AMOUNT * 2n)}, audit.TOKEN_PROGRAM_ID.toBase58()]);
  await audit.rpc('surfnet_setTokenAccount', [audit.USER.toBase58(), audit.USDG.toBase58(),
    {amount: 0}, audit.TOKEN_2022_PROGRAM_ID.toBase58()]);

  const baseline = await audit.getAccounts([audit.USER, audit.USER_ONYC, audit.USER_USDG,
    audit.USDG_REDEMPTION_VAULT]);
  if (baseline.rows[audit.USER_ONYC.toBase58()]?.tokenAmountRaw !== (AMOUNT * 2n).toString())
    throw new Error('fork-only ONyc seed failed');

  // All three user-controlled slots are remapped to the fresh outsider while
  // retaining the exact historical amount and minimum-out bytes.
  const exactFresh = await audit.simulate('historical_receipt_exact_data_fresh_outsider',
    audit.compose({actions: [audit.openSwapSell(AMOUNT, {}, MINIMUM_OUT)]}), watch,
    {sourceSignature: receipt.signature, sourceSlot: receipt.slot,
      mutation: 'accounts 12/13/26 remapped together to fresh outsider canonical ATAs/signer',
      historicalAmountRaw: AMOUNT.toString(), historicalMinimumOutRaw: MINIMUM_OUT.toString()},
    {fullLogs: true, includeWire: true});

  // Recipient substitution keeps the fresh signer and canonical debit ATA but
  // points the payout at the historical user's USDG ATA.
  const redirectedRecipient = await audit.simulate('fresh_outsider_redirect_to_historical_recipient',
    audit.compose({actions: [audit.openSwapSell(AMOUNT, {13: HISTORICAL_RECIPIENT}, 0n)]}), watch,
    {sourceSignature: receipt.signature, mutation: 'account 13 only; third-party payout ATA'},
    {fullLogs: true});

  // Signer-only mutation keeps both historical token accounts. This separates
  // signer verification from canonical-ATA ownership binding.
  const signerOnly = await audit.simulate('fresh_outsider_with_historical_input_and_recipient',
    audit.compose({actions: [audit.openSwapSell(AMOUNT,
      {12: HISTORICAL_INPUT, 13: HISTORICAL_RECIPIENT}, 0n)]}), watch,
    {sourceSignature: receipt.signature, mutation: 'account 26 signer only'},
    {fullLogs: true});

  // Current-price control: same historical input size, fresh signer and both
  // canonical fresh ATAs, with minimum-out reset to zero.
  const currentControl = await audit.simulate('historical_amount_current_price_fresh_outsider_control',
    audit.compose({actions: [audit.openSwapSell(AMOUNT)]}), watch,
    {sourceSignature: receipt.signature,
      mutation: 'accounts 12/13/26 remapped; minimum-out repriced to zero'},
    {fullLogs: true, includeWire: true});

  for (const row of audit.cases) for (const side of ['before', 'post']) {
    for (const image of Object.values(row[side] || {})) if (image) delete image.dataBase64;
  }
  const summarize = row => ({label: row.label, err: row.err, targetErrorLog: row.targetErrorLog,
    wire: row.wire && {version: row.wire.version, bytes: row.wire.bytes, accounts: row.wire.accounts,
      instructions: row.wire.instructions, requiredSignatures: row.wire.requiredSignatures,
      signerOrder: row.wire.signerOrder, sigVerify: row.wire.sigVerify,
      messageSha256: row.wire.messageSha256, signedWireSha256: row.wire.signedWireSha256},
    unitsConsumed: row.unitsConsumed, sell: audit.parseSell(row.logs), deltas: row.deltas,
    relevantLogs: (row.logs || []).filter(line => /Instruction: OpenSwapSell|Open swap sell|AnchorError|failed/.test(line))});
  const cases = [exactFresh, redirectedRecipient, signerOnly, currentControl].map(summarize);
  const control = cases[3];
  const output = {generatedAt: new Date().toISOString(), safety: {
    environment: 'isolated current-mainnet-backed Surfpool fork', transport: 'simulateTransaction only',
    sigVerify: true, replaceRecentBlockhash: false, transactionSubmitted: false,
    sendPathPresent: false, rpcCredentialRecorded: false,
    forkWrites: 'Only synthetic fresh-outsider SOL/ONyc/USDG setup; simulations roll back.'},
    sourceReceipt: {signature: receipt.signature, slot: receipt.slot, blockTime: receipt.blockTime,
      handler: 'OpenSwapSell', historicalUser: HISTORICAL_USER.toBase58(),
      historicalInputAta: HISTORICAL_INPUT.toBase58(), historicalRecipientAta: HISTORICAL_RECIPIENT.toBase58(),
      tokenInRaw: AMOUNT.toString(), minimumOutRaw: MINIMUM_OUT.toString(),
      observedPayoutRaw: receipt.payoutRaw, observedVaultDeltaRaw: receipt.redemptionVaultDeltaRaw,
      exactInstructionDataBase58: source.data, accountCount: source.accounts.length},
    freshOutsider: {address: audit.USER.toBase58(), onycAta: audit.USER_ONYC.toBase58(),
      usdGAta: audit.USER_USDG.toBase58(), privateKeyPersisted: false,
      syntheticStartingOnycRaw: (AMOUNT * 2n).toString(), syntheticStartingUsdGRaw: '0'},
    result: {exactHistoricalDataAcceptedAtCurrentState: exactFresh.err === null,
      recipientRedirectAccepted: redirectedRecipient.err === null,
      signerOnlyMutationAccepted: signerOnly.err === null,
      currentPricePaidControlAccepted: currentControl.err === null,
      currentControlAttackerOnycDeltaRaw: control.deltas.attackerOnyc?.tokenAmountRaw,
      currentControlAttackerUsdGDeltaRaw: control.deltas.attackerUsdG?.tokenAmountRaw,
      currentControlRedemptionVaultUsdGDeltaRaw: control.deltas.onreRedemptionUsdGVault?.tokenAmountRaw,
      findingDemonstrated: false,
      conclusion: 'Recipient and debit ATAs remained bound to the fresh signer; the only accepted path was a paid permissionless sell.'},
    cases};
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({output: OUTPUT, sourceReceipt: output.sourceReceipt,
    freshOutsider: output.freshOutsider.address, result: output.result,
    cases: cases.map(row => ({label: row.label, err: row.err, targetErrorLog: row.targetErrorLog,
      bytes: row.wire?.bytes, accounts: row.wire?.accounts, sell: row.sell}))}, null, 2));
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
