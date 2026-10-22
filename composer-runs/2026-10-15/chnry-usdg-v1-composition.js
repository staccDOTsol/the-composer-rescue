#!/usr/bin/env node
// Read-only Solana v1 Chancery/KLend composition and mutation harness.
// Every transaction is unsigned, simulated with sigVerify:false, and never submitted.

const fs = require('fs');
const crypto = require('crypto');
const {
  PublicKey, TransactionInstruction, TransactionMessage,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const root = 'composer-runs/2026-10-15';
const envPath = '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  .filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const currentRpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const archiveRpcUrl = env.RPC_URL || env.HEAVY_RPC_URL;
if (!currentRpcUrl || !archiveRpcUrl) throw new Error(`No RPC configured in ${envPath}`);

const P = value => new PublicKey(value);
const programId = P('ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz');
const klendId = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const token2022 = P('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const systemProgram = P('11111111111111111111111111111111');
const associatedTokenProgram = P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const historicalSignature = '32sBxLB3zYh4efsMnBPnsCNdEenL2zfnjk48q8YVxAV9cXDZT44AFHiyHnvbypwq724uy94Jg9k2qRjKpiwqovXX';
const attacker = P('C68a6RCGLiPskbPYtAcsCjhG8tfTWYcoB4JjCrXFdqyo');
const attackerUsdg = P('8T8DLKDtoMUKNgCdY9b7USDGJaP6RVYP6QmRgCKLtyxR');
const idl = JSON.parse(fs.readFileSync(`${root}/chnry-usdg-source/programs/chancery/idl/idl.json`));
const state = JSON.parse(fs.readFileSync(`${root}/chnry-usdg-current-state.json`));
const flashHistory = JSON.parse(fs.readFileSync(`${root}/kamino-flash-history.json`));
const named = state.historicalControl.namedAccounts;
const principal = P(named.principal);
const principalUsdg = P(named.destination_asset_token_account);
const principalUsdv = P(named.source_issued_token_account);
const vault = P(named.reserve_asset_token_account);
const usdgMint = P(named.asset_mint);
const usdvMint = P(named.issued_token_mint);
const reserveAuthority = P(named.reserve_authority_pda);
const configState = state.currentHistoricalAccounts.accounts[named.chancery_config].decoded;
const mintAuthority = P(configState.mint_authority_pda);
const pathwayPolicy = P(named.pathway_policy);
const pathwayId = Buffer.from(state.historicalControl.pathwayIdHex, 'hex');
const attackerPermission = PublicKey.findProgramAddressSync([
  Buffer.from('permission'), attacker.toBuffer(), Buffer.from([2]), pathwayPolicy.toBuffer(),
], programId)[0];
const attackerUsdv = PublicKey.findProgramAddressSync([
  attacker.toBuffer(), token2022.toBuffer(), usdvMint.toBuffer(),
], associatedTokenProgram)[0];
const assetState = state.currentHistoricalAccounts.accounts[named.asset_config].decoded;
const minimum = BigInt(assetState.minimum_deposit_amount);
const maximum = BigInt(assetState.maximum_single_settlement_amount);
const historicalAmount = BigInt(state.historicalControl.inputAmountRaw);
const vaultAmount = BigInt(state.vault.decoded.amountRaw);
const selectedReserve = state.klendUsdGCensus.reserves.find(row =>
  row.reserve === 'ESCkPWKHmgNE7Msf77n9yzqJd5kQVWWGy3o5Mgxhvavp' &&
  row.status === 0 && row.emergencyMode === 0 && row.flashFeeSf === '0') ||
  state.klendUsdGCensus.reserves.find(row => row.eligibleExactZeroActive);
if (!selectedReserve) throw new Error('No current exact-zero-rate active USDG KLend reserve');

async function rpc(url, method, params) {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  return json.result;
}

const u64 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const cloneIx = ix => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map(key => ({...key})), data: Buffer.from(ix.data)});
const replaceKey = (ix, index, pubkey, flags = {}) => {
  const out = cloneIx(ix);
  out.keys[index] = {...out.keys[index], pubkey: P(pubkey), ...flags};
  return out;
};
const replaceKeys = (ix, replacements) => {
  const out = cloneIx(ix);
  for (const [index, value] of Object.entries(replacements)) {
    const replacement = value.pubkey ? value : {pubkey: value};
    out.keys[Number(index)] = {...out.keys[Number(index)], ...replacement,
      pubkey: P(replacement.pubkey)};
  }
  return out;
};

function encodeV1(instructions, payer, blockhash, computeLimit = 1400000, dataLimit = 67108864) {
  const v0 = new TransactionMessage({payerKey: P(payer), recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (v0.addressTableLookups.length) throw new Error('v1 no-ALT harness unexpectedly produced lookups');
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64)
    throw new Error(`Current v1 limit exceeded (${keys.length} addresses, ${items.length} instructions)`);
  const sv = number => number < 128 ? 1 : number < 16384 ? 2 : 3;
  const v0Bytes = sv(v0.header.numRequiredSignatures) + 64 * v0.header.numRequiredSignatures +
    1 + 3 + sv(keys.length) + 32 * keys.length + 32 + sv(items.length) +
    items.reduce((sum, ix) => sum + 1 + sv(ix.accountKeyIndexes.length) +
      ix.accountKeyIndexes.length + sv(ix.data.length) + ix.data.length, 0) + sv(0);
  const config = Buffer.alloc(8);
  config.writeUInt32LE(computeLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const heads = items.map(ix => {
    const out = Buffer.alloc(4);
    out[0] = ix.programIdIndex;
    out[1] = ix.accountKeyIndexes.length;
    out.writeUInt16LE(ix.data.length, 2);
    return out;
  });
  const payloads = items.map(ix => Buffer.concat([Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]));
  const wire = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures, v0.header.numReadonlySignedAccounts,
      v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]),
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]),
    ...keys.map(key => key.toBuffer()), config, ...heads, ...payloads,
    Buffer.alloc(64 * v0.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 size limit exceeded (${wire.length} > 4096)`);
  return {wire, sizeBytes: wire.length, v0Bytes, addressCount: keys.length,
    instructionCount: items.length, requiredSignatures: v0.header.numRequiredSignatures,
    computeLimit, dataLimit};
}

function metaResolver(tx) {
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey);
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  const allKeys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const header = message.header;
  const writable = index => index < staticKeys.length ?
    (index < header.numRequiredSignatures ?
      index < header.numRequiredSignatures - header.numReadonlySignedAccounts :
      index < staticKeys.length - header.numReadonlyUnsignedAccounts) :
    index < staticKeys.length + loaded.writable.length;
  return {message, allKeys, header, writable};
}

function transactionIx(tx, instructionIndex) {
  const {message, allKeys, header, writable} = metaResolver(tx);
  const source = message.instructions[instructionIndex];
  return new TransactionInstruction({programId: P(allKeys[source.programIdIndex]),
    keys: source.accounts.map(index => ({pubkey: P(allKeys[index]),
      isSigner: index < header.numRequiredSignatures, isWritable: writable(index)})),
    data: Buffer.from(bs58.decode(source.data))});
}

function historyIx(index) {
  const tx = flashHistory.hits[0].transaction;
  return transactionIx(tx, index);
}
const borrowTemplate = historyIx(3);
const repayTemplate = historyIx(13);
if (!borrowTemplate.programId.equals(klendId) || !repayTemplate.programId.equals(klendId))
  throw new Error('KLend historical instruction template indexes changed');

function flashIx(template, user, userToken, amount, repayIndex) {
  const market = P(selectedReserve.market);
  const marketAuthority = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], klendId)[0];
  const replacements = {0: user, 1: marketAuthority, 2: market,
    3: selectedReserve.reserve, 4: selectedReserve.mint,
    5: selectedReserve.supplyVault, 6: userToken, 7: selectedReserve.feeVault,
    11: token2022};
  const out = replaceKeys(template, replacements);
  out.data.writeBigUInt64LE(BigInt(amount), 8);
  if (repayIndex !== undefined) out.data[16] = repayIndex;
  return out;
}

function controllerData(moduleInstruction, amount, minimumOutput = amount) {
  return Buffer.concat([Buffer.from([4, moduleInstruction]), pathwayId, u64(amount), u64(minimumOutput)]);
}

function redeemIx(template, amount, minimumOutput = amount) {
  const out = cloneIx(template);
  out.data = controllerData(2, amount, minimumOutput);
  return out;
}

function mintIx(template, amount, minimumOutput = amount) {
  const out = replaceKeys(template, {7: principalUsdg, 9: principalUsdv, 12: mintAuthority});
  out.data = controllerData(1, amount, minimumOutput);
  return out;
}

function outsiderMint(template, amount) {
  return replaceKeys(mintIx(template, amount), {6: attackerPermission, 7: attackerUsdg,
    9: attackerUsdv, 15: attacker});
}

function outsiderRedeem(template, amount) {
  return replaceKeys(redeemIx(template, amount), {6: attackerPermission, 7: attackerUsdv,
    9: attackerUsdg, 15: attacker});
}

const idlErrors = new Map((idl.errors || []).map(error => [error.code, error]));
function describeError(err) {
  const custom = err?.InstructionError?.[1]?.Custom;
  if (custom === undefined) return null;
  const known = idlErrors.get(custom);
  return known ? {code: custom, program: 'Chancery', name: known.name, message: known.msg} :
    {code: custom, program: 'unknown-or-KLend'};
}

const tokenAddresses = new Set([
  principalUsdg.toBase58(), principalUsdv.toBase58(), attackerUsdg.toBase58(),
  attackerUsdv.toBase58(), vault.toBase58(), selectedReserve.supplyVault, selectedReserve.feeVault,
]);
const mintAddresses = new Set([usdgMint.toBase58(), usdvMint.toBase58()]);
const watch = [...new Set([
  ...tokenAddresses, ...mintAddresses, selectedReserve.reserve,
  named.daily_usage_window,
])];

function decodeImage(address, account) {
  if (!account) return {exists: false};
  const data = Buffer.from(account.data[0], 'base64');
  const out = {exists: true, owner: account.owner, dataBytes: data.length,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex')};
  if (tokenAddresses.has(address) && data.length >= 72) {
    out.token = {mint: new PublicKey(data.subarray(0, 32)).toBase58(),
      owner: new PublicKey(data.subarray(32, 64)).toBase58(),
      amountRaw: data.readBigUInt64LE(64).toString(), state: data[108]};
  } else if (mintAddresses.has(address) && data.length >= 45) {
    out.mint = {supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44]};
  } else if (address === selectedReserve.reserve && data.length > 4912) {
    out.klendReserve = {availableRaw: data.readBigUInt64LE(224).toString(), status: data[4856],
      emergencyMode: data[4864], flashFeeSf: data.readBigUInt64LE(4904).toString()};
  }
  return out;
}

const imageMap = (accounts) => Object.fromEntries(watch.map((address, index) =>
  [address, decodeImage(address, accounts?.[index])]));
const tokenAmount = (image, address) => BigInt(image[address]?.token?.amountRaw || 0);
const mintSupply = (image, address) => BigInt(image[address]?.mint?.supplyRaw || 0);

function accounting(pre, post, subject, flashPrincipalRaw, fullRepayInstructionIncluded, err) {
  const usdgAccount = subject === 'attacker' ? attackerUsdg.toBase58() : principalUsdg.toBase58();
  const usdvAccount = subject === 'attacker' ? attackerUsdv.toBase58() : principalUsdv.toBase58();
  const delta = address => tokenAmount(post, address) - tokenAmount(pre, address);
  const usdgDelta = delta(usdgAccount);
  const usdvDelta = delta(usdvAccount);
  const transactionSucceeded = err === null;
  const outstandingLiability = transactionSucceeded && !fullRepayInstructionIncluded ?
    BigInt(flashPrincipalRaw || 0) : 0n;
  return {subject, valuation: 'raw 6-decimal units; USDG and USDv at configured 1:1 mint/redeem rate',
    subjectUsdGDeltaRaw: usdgDelta.toString(), subjectUsdVDeltaRaw: usdvDelta.toString(),
    subjectValueEquivalentDeltaRaw: (usdgDelta + usdvDelta).toString(),
    vaultUsdGDeltaRaw: delta(vault.toBase58()).toString(),
    klendSupplyUsdGDeltaRaw: delta(selectedReserve.supplyVault).toString(),
    klendFeeUsdGDeltaRaw: delta(selectedReserve.feeVault).toString(),
    usdGMintSupplyDeltaRaw: (mintSupply(post, usdgMint.toBase58()) - mintSupply(pre, usdgMint.toBase58())).toString(),
    usdVMintSupplyDeltaRaw: (mintSupply(post, usdvMint.toBase58()) - mintSupply(pre, usdvMint.toBase58())).toString(),
    requestedFlashPrincipalRaw: String(flashPrincipalRaw || 0),
    fullRepayInstructionIncluded,
    outstandingLiabilityAfterTransactionRaw: outstandingLiability.toString(),
    netEquityAfterLiabilitiesRaw: (usdgDelta + usdvDelta - outstandingLiability).toString(),
    positiveNetEquityAfterLiabilities: usdgDelta + usdvDelta - outstandingLiability > 0n};
}

async function simulate(spec, blockhash) {
  let encoded;
  try {
    encoded = encodeV1(spec.instructions, spec.payer, blockhash);
  } catch (error) {
    return {label: spec.label, category: spec.category, expected: spec.expected,
      controllerAuthorization: spec.controllerAuthorization, localConstructionError: error.message};
  }
  // A zero-lamport self-transfer is a state-neutral baseline. Extra readonly
  // metas make the watched accounts eligible for RPC post-image return.
  const baselineData = Buffer.alloc(12);
  baselineData.writeUInt32LE(2, 0); // SystemInstruction::Transfer
  const baselineIx = new TransactionInstruction({programId: systemProgram, keys: [
    {pubkey: P(spec.payer), isSigner: true, isWritable: true},
    {pubkey: P(spec.payer), isSigner: true, isWritable: true},
    ...watch.map(address => ({pubkey: P(address), isSigner: false, isWritable: false})),
  ], data: baselineData});
  const baselineWire = encodeV1([baselineIx], spec.payer, blockhash);
  const baselineResult = await rpc(currentRpcUrl, 'simulateTransaction', [baselineWire.wire.toString('base64'),
    {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
      accounts: {encoding: 'base64', addresses: watch}}]);
  if (baselineResult.value.err) throw new Error(`Baseline simulation failed: ${JSON.stringify(baselineResult.value.err)}`);
  let baseline = baselineResult;
  const result = await rpc(currentRpcUrl, 'simulateTransaction', [encoded.wire.toString('base64'),
    {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
      accounts: {encoding: 'base64', addresses: watch}}]);
  const value = result.value;
  const err = value.err || null;
  if (baselineResult.context.slot !== result.context.slot) {
    const after = await rpc(currentRpcUrl, 'simulateTransaction', [baselineWire.wire.toString('base64'),
      {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
        accounts: {encoding: 'base64', addresses: watch}}]);
    if (!after.value.err && (after.context.slot === result.context.slot ||
      Math.abs(after.context.slot - result.context.slot) < Math.abs(baselineResult.context.slot - result.context.slot)))
      baseline = after;
  }
  const pre = imageMap(baseline.value.accounts);
  const returnedPost = imageMap(value.accounts);
  // Solana transactions are atomic. Some RPC backends omit simulated account
  // images after an error; the committed-equivalent post-state is the pre-state.
  const post = err === null ? returnedPost : pre;
  const isBorrow = instruction => instruction.programId.equals(klendId) &&
    instruction.data.subarray(0, 8).equals(borrowTemplate.data.subarray(0, 8));
  const isRepay = instruction => instruction.programId.equals(klendId) &&
    instruction.data.subarray(0, 8).equals(repayTemplate.data.subarray(0, 8));
  const flashPrincipalRaw = spec.instructions.filter(isBorrow)
    .reduce((sum, instruction) => sum + instruction.data.readBigUInt64LE(8), 0n);
  const fullRepayInstructionIncluded = spec.instructions.some(isRepay);
  return {label: spec.label, category: spec.category, expected: spec.expected,
    controllerAuthorization: spec.controllerAuthorization, notes: spec.notes || null,
    payer: P(spec.payer).toBase58(), baselineSimulationSlot: baseline.context.slot,
    baselineMatchesActionSlot: baseline.context.slot === result.context.slot,
    simulationSlot: result.context.slot, err, decodedError: describeError(err),
    transaction: {version: 1, exactWireBase64Sha256: crypto.createHash('sha256').update(encoded.wire).digest('hex'),
      sizeBytes: encoded.sizeBytes, sizeLimitBytes: 4096, withinSizeLimit: encoded.sizeBytes <= 4096,
      v0ComparisonBytes: encoded.v0Bytes, addressCount: encoded.addressCount,
      addressLimit: 64, instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures, signaturesVerified: false,
      computeLimit: encoded.computeLimit, loadedAccountsDataLimit: encoded.dataLimit},
    unitsConsumed: value.unitsConsumed, loadedAccountsDataSize: value.loadedAccountsDataSize,
    failedTransactionAccountingUsesAtomicRollback: err !== null,
    accounting: accounting(pre, post, spec.subject || 'operator', flashPrincipalRaw,
      fullRepayInstructionIncluded, err),
    changedAccountHashes: Object.fromEntries(watch.filter(address =>
      pre[address]?.dataSha256 !== post[address]?.dataSha256).map(address => [address,
      {pre: pre[address]?.dataSha256 || null, post: post[address]?.dataSha256 || null}])),
    preTokenAmounts: Object.fromEntries([...tokenAddresses].map(address =>
      [address, pre[address]?.token?.amountRaw || null])),
    postTokenAmounts: Object.fromEntries([...tokenAddresses].map(address =>
      [address, post[address]?.token?.amountRaw || null])),
    logs: (value.logs || []).filter(line => line.includes('Instruction:') || line.includes('Program log:') ||
      line.includes('failed') || line.includes('success')).slice(-80),
  };
}

async function main() {
  const historical = await rpc(archiveRpcUrl, 'getTransaction', [historicalSignature,
    {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0}]);
  if (!historical) throw new Error('Historical Chancery control transaction unavailable');
  const resolver = metaResolver(historical);
  const controllerIndex = resolver.message.instructions.findIndex(ix =>
    resolver.allKeys[ix.programIdIndex] === programId.toBase58());
  if (controllerIndex < 0) throw new Error('Historical control instruction unavailable');
  const directTemplate = transactionIx(historical, controllerIndex);
  if (directTemplate.keys.length !== 31) throw new Error(`Unexpected Chancery account count ${directTemplate.keys.length}`);
  const blockhash = (await rpc(currentRpcUrl, 'getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;

  const operatorMint = amount => mintIx(directTemplate, amount);
  const operatorRedeem = amount => redeemIx(directTemplate, amount);
  const outsiderMintIx = amount => outsiderMint(directTemplate, amount);
  const outsiderRedeemIx = amount => outsiderRedeem(directTemplate, amount);
  const borrow = (user, token, amount) => flashIx(borrowTemplate, user, token, amount);
  const repay = (user, token, amount, index) => flashIx(repayTemplate, user, token, amount, index);
  const specs = [];
  const add = spec => specs.push(spec);

  add({label: 'operator_redeem_historical_20808_control', category: 'positive-control',
    expected: 'success; authorized 1:1 USDv burn for USDG', controllerAuthorization: 'authorized operator',
    payer: principal, instructions: [operatorRedeem(historicalAmount)]});
  add({label: 'operator_redeem_minimum_control', category: 'boundary-control',
    expected: 'success at configured minimum', controllerAuthorization: 'authorized operator',
    payer: principal, instructions: [operatorRedeem(minimum)]});
  for (const [label, amount] of [['zero', 0n], ['one_raw', 1n], ['minimum_minus_one', minimum - 1n]])
    add({label: `operator_redeem_${label}`, category: 'dust-boundary',
      expected: 'failure before asset outflow', controllerAuthorization: 'authorized operator',
      payer: principal, instructions: [operatorRedeem(amount)]});
  add({label: 'operator_redeem_maximum_plus_one', category: 'arithmetic-boundary',
    expected: 'failure at configured maximum guard', controllerAuthorization: 'authorized operator',
    payer: principal, instructions: [operatorRedeem(maximum + 1n)]});
  for (const [label, amount] of [['vault_minus_one', vaultAmount - 1n], ['vault_exact', vaultAmount],
    ['vault_plus_one', vaultAmount + 1n]])
    add({label: `operator_redeem_${label}`, category: 'vault-capacity-boundary',
      expected: 'failure at per-settlement maximum before vault capacity is reachable',
      controllerAuthorization: 'authorized operator', payer: principal,
      instructions: [operatorRedeem(amount)], notes: 'Current vault exceeds the stricter 500,000 USDG action cap.'});

  add({label: 'outsider_redeem_direct_no_permission', category: 'outsider-auth',
    expected: 'failure; canonical outsider permission PDA is absent', controllerAuthorization: 'unauthorized outsider',
    payer: attacker, subject: 'attacker', instructions: [outsiderRedeemIx(minimum)]});
  add({label: 'outsider_mint_direct_no_permission', category: 'outsider-auth',
    expected: 'failure; canonical outsider permission PDA is absent', controllerAuthorization: 'unauthorized outsider',
    payer: attacker, subject: 'attacker', instructions: [outsiderMintIx(minimum)]});
  add({label: 'substitution_outsider_principal_operator_permission', category: 'account-substitution',
    expected: 'failure; permission subject/PDA does not bind to outsider', controllerAuthorization: 'unauthorized outsider',
    payer: attacker, subject: 'attacker', instructions: [replaceKeys(operatorRedeem(minimum),
      {7: attackerUsdv, 9: attackerUsdg, 15: attacker})]});
  add({label: 'substitution_operator_principal_outsider_permission', category: 'account-substitution',
    expected: 'failure; missing/noncanonical permission account', controllerAuthorization: 'authorized operator with substituted account',
    payer: principal, instructions: [replaceKey(operatorRedeem(minimum), 6, attackerPermission)]});
  add({label: 'substitution_redeem_destination_outsider', category: 'account-substitution',
    expected: 'failure; destination token owner must be principal', controllerAuthorization: 'authorized operator with outsider destination',
    payer: principal, instructions: [replaceKey(operatorRedeem(minimum), 9, attackerUsdg)]});
  add({label: 'substitution_reserve_vault_klend_supply', category: 'account-substitution',
    expected: 'failure; reserve must be canonical authority ATA', controllerAuthorization: 'authorized operator with substituted vault',
    payer: principal, instructions: [replaceKey(operatorRedeem(minimum), 8, selectedReserve.supplyVault)]});
  add({label: 'substitution_redeem_reserve_authority_mint_authority', category: 'pda-cpi-authority',
    expected: 'failure; reserve authority must be canonical PDA', controllerAuthorization: 'authorized operator with substituted PDA',
    payer: principal, instructions: [replaceKey(operatorRedeem(minimum), 12, mintAuthority)]});
  add({label: 'substitution_mint_authority_reserve_authority', category: 'pda-cpi-authority',
    expected: 'failure; mint authority must be configured canonical PDA', controllerAuthorization: 'authorized operator with substituted PDA',
    payer: principal, instructions: [replaceKey(operatorMint(minimum), 12, reserveAuthority)]});
  add({label: 'substitution_asset_mint_issued_mint', category: 'account-substitution',
    expected: 'failure; asset config/mint binding', controllerAuthorization: 'authorized operator with substituted mint',
    payer: principal, instructions: [replaceKey(operatorRedeem(minimum), 10, usdvMint)]});
  add({label: 'principal_not_instruction_signer', category: 'signer-auth',
    expected: 'failure; external principal signer required', controllerAuthorization: 'unsigned operator identity',
    payer: attacker, instructions: [replaceKey(operatorRedeem(minimum), 15, principal, {isSigner: false})]});
  const configAsPrincipalPermission = PublicKey.findProgramAddressSync([
    Buffer.from('permission'), P(named.chancery_config).toBuffer(), Buffer.from([2]), pathwayPolicy.toBuffer(),
  ], programId)[0];
  add({label: 'program_owned_state_as_principal', category: 'pda-cpi-authority',
    expected: 'failure; program-owned identities cannot serve as external signers', controllerAuthorization: 'program-owned substituted identity',
    payer: attacker, instructions: [replaceKeys(operatorRedeem(minimum), {6: configAsPrincipalPermission,
      15: {pubkey: named.chancery_config, isSigner: true}})]});

  add({label: 'operator_mint_redeem_no_flash_control', category: 'same-transaction-ordering',
    expected: 'success with zero value-equivalent delta', controllerAuthorization: 'authorized operator',
    payer: principal, instructions: [operatorMint(minimum), operatorRedeem(minimum)]});
  add({label: 'klend_flash_pair_control', category: 'flash-control',
    expected: 'success; exact-zero-rate borrow and full repay', controllerAuthorization: 'no controller action',
    payer: principal, instructions: [borrow(principal, principalUsdg, minimum),
      repay(principal, principalUsdg, minimum, 0)]});
  add({label: 'operator_flash_mint_redeem_minimum', category: 'flash-controller-composition',
    expected: 'success; full unwind and repay with zero net equity', controllerAuthorization: 'authorized operator',
    payer: principal, instructions: [borrow(principal, principalUsdg, minimum), operatorMint(minimum),
      operatorRedeem(minimum), repay(principal, principalUsdg, minimum, 0)]});
  add({label: 'operator_flash_redeem_mint_minimum', category: 'same-transaction-ordering',
    expected: 'success; reverse controller order remains value-neutral', controllerAuthorization: 'authorized operator',
    payer: principal, instructions: [borrow(principal, principalUsdg, minimum), operatorRedeem(minimum),
      operatorMint(minimum), repay(principal, principalUsdg, minimum, 0)]});
  add({label: 'operator_flash_mint_redeem_maximum', category: 'arithmetic-boundary',
    expected: 'success at configured maximum; full unwind and repay', controllerAuthorization: 'authorized operator',
    payer: principal, instructions: [borrow(principal, principalUsdg, maximum), operatorMint(maximum),
      operatorRedeem(maximum), repay(principal, principalUsdg, maximum, 0)]});
  add({label: 'operator_flash_mint_redeem_maximum_plus_one', category: 'arithmetic-boundary',
    expected: 'failure at configured maximum; atomic rollback', controllerAuthorization: 'authorized operator',
    payer: principal, instructions: [borrow(principal, principalUsdg, maximum + 1n), operatorMint(maximum + 1n),
      operatorRedeem(maximum + 1n), repay(principal, principalUsdg, maximum + 1n, 0)]});
  add({label: 'operator_flash_mint_repay_then_redeem_maximum', category: 'same-transaction-ordering',
    expected: 'failure or value-neutral completion; no unpaid liability gain', controllerAuthorization: 'authorized operator',
    payer: principal, instructions: [borrow(principal, principalUsdg, maximum), operatorMint(maximum),
      repay(principal, principalUsdg, maximum, 0), operatorRedeem(maximum)]});
  add({label: 'operator_flash_mint_redeem_one_raw', category: 'dust-flash-composition',
    expected: 'failure at Chancery minimum; atomic KLend rollback', controllerAuthorization: 'authorized operator',
    payer: principal, instructions: [borrow(principal, principalUsdg, 1n), operatorMint(1n),
      operatorRedeem(1n), repay(principal, principalUsdg, 1n, 0)]});
  add({label: 'outsider_flash_mint_redeem_minimum', category: 'outsider-flash-composition',
    expected: 'failure at outsider permission; atomic rollback and no equity gain', controllerAuthorization: 'unauthorized outsider',
    payer: attacker, subject: 'attacker', instructions: [borrow(attacker, attackerUsdg, minimum),
      outsiderMintIx(minimum), outsiderRedeemIx(minimum), repay(attacker, attackerUsdg, minimum, 0)]});
  add({label: 'outsider_controller_before_flash', category: 'same-transaction-ordering',
    expected: 'failure before borrow; no equity gain', controllerAuthorization: 'unauthorized outsider',
    payer: attacker, subject: 'attacker', instructions: [outsiderMintIx(minimum),
      borrow(attacker, attackerUsdg, minimum), outsiderRedeemIx(minimum),
      repay(attacker, attackerUsdg, minimum, 1)]});
  add({label: 'klend_flash_missing_repay', category: 'liability-enforcement',
    expected: 'failure; KLend requires same-transaction repay', controllerAuthorization: 'no controller action',
    payer: attacker, subject: 'attacker', instructions: [borrow(attacker, attackerUsdg, minimum)]});
  add({label: 'klend_repay_before_borrow', category: 'same-transaction-ordering',
    expected: 'failure; repay cannot precede referenced borrow', controllerAuthorization: 'no controller action',
    payer: attacker, subject: 'attacker', instructions: [repay(attacker, attackerUsdg, minimum, 1),
      borrow(attacker, attackerUsdg, minimum)]});
  add({label: 'klend_wrong_repay_index', category: 'liability-enforcement',
    expected: 'failure; repay must reference exact borrow index', controllerAuthorization: 'no controller action',
    payer: attacker, subject: 'attacker', instructions: [borrow(attacker, attackerUsdg, minimum),
      repay(attacker, attackerUsdg, minimum, 1)]});
  add({label: 'klend_two_flash_cycles', category: 'same-transaction-ordering',
    expected: 'failure if KLend one-borrow invariant applies; no gain', controllerAuthorization: 'no controller action',
    payer: attacker, subject: 'attacker', instructions: [borrow(attacker, attackerUsdg, minimum),
      repay(attacker, attackerUsdg, minimum, 0), borrow(attacker, attackerUsdg, minimum),
      repay(attacker, attackerUsdg, minimum, 2)]});
  const batchAmount = maximum * 5n;
  add({label: 'operator_flash_five_max_mints_then_five_redeems', category: 'near-liquidity-batch',
    expected: 'bounded by v1/CU/volume controls or succeeds value-neutrally; full repay required',
    controllerAuthorization: 'authorized operator', payer: principal,
    instructions: [borrow(principal, principalUsdg, batchAmount),
      ...Array.from({length: 5}, () => operatorMint(maximum)),
      ...Array.from({length: 5}, () => operatorRedeem(maximum)),
      repay(principal, principalUsdg, batchAmount, 0)],
    notes: 'Temporarily moves 2.5M USDG into the Chancery vault before unwinding; no live state is committed.'});

  const results = [];
  for (const spec of specs) {
    const result = await simulate(spec, blockhash);
    results.push(result);
    console.log(JSON.stringify({label: result.label, err: result.err || result.localConstructionError || null,
      decodedError: result.decodedError?.name || null, sizeBytes: result.transaction?.sizeBytes,
      addresses: result.transaction?.addressCount, units: result.unitsConsumed,
      net: result.accounting?.netEquityAfterLiabilitiesRaw}));
  }
  const outsiderResults = results.filter(result => result.controllerAuthorization?.includes('unauthorized outsider'));
  const output = {observedAt: new Date().toISOString(), readOnly: true, noSubmission: true,
    signerVerification: false, transactionVersion: 1, exactWireLimitBytes: 4096,
    programId: programId.toBase58(), historicalControlSignature: historicalSignature,
    historicalControlSlot: historical.slot, sourceRevision: state.program.expected.sourceRevision,
    selectedKlendReserve: {reserve: selectedReserve.reserve, market: selectedReserve.market,
      supplyVault: selectedReserve.supplyVault, feeVault: selectedReserve.feeVault,
      reserveReportedAvailableRaw: selectedReserve.availableRaw,
      supplyVaultBalanceRaw: selectedReserve.supplyVaultBalanceRaw,
      flashFeeSf: selectedReserve.flashFeeSf, status: selectedReserve.status,
      emergencyMode: selectedReserve.emergencyMode},
    actors: {operator: principal.toBase58(), operatorUsdG: principalUsdg.toBase58(),
      operatorUsdV: principalUsdv.toBase58(), outsider: attacker.toBase58(),
      outsiderUsdG: attackerUsdg.toBase58(), outsiderUsdVDerivedAta: attackerUsdv.toBase58(),
      outsiderPermissionPda: attackerPermission.toBase58()},
    controllerParameters: {minimumRaw: minimum.toString(), maximumRaw: maximum.toString(),
      depositRateE9: assetState.deposit_rate_e9, redeemRateE9: assetState.redeem_rate_e9,
      feePolicyPresent: named.fee_policy !== systemProgram.toBase58(), vaultBalanceRaw: vaultAmount.toString()},
    watch, results,
    conclusion: {outsiderCases: outsiderResults.length,
      outsiderSuccessfulTransactions: outsiderResults.filter(result => result.err === null && !result.localConstructionError).length,
      outsiderPositiveNetEquityCases: outsiderResults.filter(result =>
        result.accounting?.positiveNetEquityAfterLiabilities).map(result => result.label),
      positiveUnauthorizedNetAssetGainObserved: outsiderResults.some(result =>
        result.accounting?.positiveNetEquityAfterLiabilities),
      operatorCasesAreControlsNotFindings: true},
  };
  fs.writeFileSync(`${root}/chnry-usdg-v1-simulations.json`, JSON.stringify(output, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
