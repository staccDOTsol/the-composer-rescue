// Read-only current-mainnet simulation of Manifest withdrawals and KLend-funded
// Manifest global deposit/withdraw cycles. Never signs or submits a transaction.
const fs = require('fs');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-09-11/uhmm-i-want-frost-enabled-wallets/outputs/frost-snap/node_modules';
const {Connection, PublicKey, TransactionInstruction, TransactionMessage} = require(`${MODULES}/@solana/web3.js`);
const b = require(`${MODULES}/bs58`); const bs58 = b.default || b;

const rpcUrl = process.env.SOLANA_RPC;
const conn = new Connection(rpcUrl, 'confirmed');
const P = value => new PublicKey(value);
const manifest = P('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms');
const klend = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const token = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const mint = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const global = P('4SMRzaLXsuvTi2B5cSVs4LuCUUqQhB2uByTWUvbixjfF');
const globalVault = P('6KzHa7L1MDTkaUb4qGiJqMvnmAy1qztGDeLvSHdS9ooU');
const owner = P('qz3xsMziyYAPgiVnpCkzfLgQteFr9EHZAnvTNNhwEc6');
const ownerToken = P('t5HwUUXMbpvtJzqJtQenouYMT4jPpv4Tw4czJFZe9Uh');
const outsider = P('GeaTp2ihgQRMmvBc8m4cEcH3XtpknrZruuioeDy8pocD');
const associated = P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const [outsiderToken] = PublicKey.findProgramAddressSync([outsider.toBuffer(), token.toBuffer(), mint.toBuffer()], associated);
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const u64 = n => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(n)); return out; };

const flashSource = JSON.parse(fs.readFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/kamino-flash-history.json')).hits[0];
const sample = flashSource.transaction;
const msg = sample.transaction.message;
const staticKeys = msg.accountKeys;
const loadedWritable = sample.meta.loadedAddresses?.writable || [];
const loadedReadonly = sample.meta.loadedAddresses?.readonly || [];
const allKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly];
const head = msg.header;
const writable = index => index < staticKeys.length ?
  (index < head.numRequiredSignatures ? index < head.numRequiredSignatures - head.numReadonlySignedAccounts :
    index < staticKeys.length - head.numReadonlyUnsignedAccounts) :
  index < staticKeys.length + loadedWritable.length;
const sampleIx = index => {
  const source = msg.instructions[index];
  return new TransactionInstruction({programId: P(allKeys[source.programIdIndex]),
    keys: source.accounts.map(i => ({pubkey: P(allKeys[i]), isSigner: i < head.numRequiredSignatures,
      isWritable: writable(i)})), data: Buffer.from(bs58.decode(source.data))});
};
const borrowTemplate = sampleIx(3), repayTemplate = sampleIx(13);
if (!borrowTemplate.programId.equals(klend) || !repayTemplate.programId.equals(klend))
  throw new Error('historical KLend flash instruction indexes changed');
const occupied = new Set([manifest, klend, token, mint, global, globalVault, owner, ownerToken,
  ...borrowTemplate.keys.map(key => key.pubkey), ...repayTemplate.keys.map(key => key.pubkey)]
  .map(key => key.toBase58()));
const custodySummary = JSON.parse(fs.readFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/orderbook-dex-custody-summary.json'));
const paddingKeys = [];
for (const address of custodySummary.results.flatMap(result =>
  [...(result.topPricedUniqueVaults || []), ...(result.topUnpricedUniqueVaults || [])]
    .flatMap(row => [row.vault, row.state]).filter(Boolean))) {
  if (occupied.has(address)) continue;
  occupied.add(address); paddingKeys.push(P(address));
  if (paddingKeys.length === 50) break;
}
if (paddingKeys.length !== 50) throw new Error(`needed 50 existing padding accounts, found ${paddingKeys.length}`);
const flashReserve = borrowTemplate.keys[3].pubkey;
const flashSupply = borrowTemplate.keys[5].pubkey;
const flashFeeVault = borrowTemplate.keys[7].pubkey;
const flashIx = (template, amount, repayIndex) => {
  const keys = template.keys.map(k => ({...k}));
  keys[0].pubkey = owner;
  keys[6].pubkey = ownerToken;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(BigInt(amount), 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: klend, keys, data});
};

const manifestIx = (tag, amount, options = {}) => {
  const keys = [
    {pubkey: options.owner || owner, isSigner: options.signer !== false, isWritable: true},
    {pubkey: global, isSigner: false, isWritable: true},
    {pubkey: mint, isSigner: false, isWritable: false},
    {pubkey: globalVault, isSigner: false, isWritable: true},
    {pubkey: options.destination || ownerToken, isSigner: false, isWritable: true},
    {pubkey: token, isSigner: false, isWritable: false},
  ];
  if (options.aliasVault) keys[4].pubkey = globalVault;
  if (options.swapStateVault) [keys[1].pubkey, keys[3].pubkey] = [keys[3].pubkey, keys[1].pubkey];
  for (const pubkey of options.extraKeys || [])
    keys.push({pubkey, isSigner: false, isWritable: false});
  return new TransactionInstruction({programId: manifest, keys,
    data: Buffer.concat([Buffer.from([tag]), u64(amount)])});
};
const deposit = (amount, options) => manifestIx(9, amount, options);
const withdraw = (amount, options) => manifestIx(10, amount, options);

// Encode Solana transaction version 1 exactly, enforcing its current 4,096-byte,
// 64-inline-address, and 64-instruction limits. No address lookup tables are used.
function encodeV1(instructions, payer, blockhash, computeLimit = 1_400_000, dataLimit = 67_108_864) {
  const v0 = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const sv = n => n < 128 ? 1 : n < 16384 ? 2 : 3;
  const v0Bytes = sv(v0.header.numRequiredSignatures) + 64 * v0.header.numRequiredSignatures +
    1 + 3 + sv(v0.staticAccountKeys.length) + 32 * v0.staticAccountKeys.length + 32 +
    sv(v0.compiledInstructions.length) + v0.compiledInstructions.reduce((sum, ix) => sum + 1 +
      sv(ix.accountKeyIndexes.length) + ix.accountKeyIndexes.length + sv(ix.data.length) + ix.data.length, 0) + sv(0);
  if (v0.addressTableLookups.length) throw new Error('v1 has no ALTs');
  const keys = v0.staticAccountKeys, items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64) throw new Error('current v1 address/instruction limit');
  const config = Buffer.alloc(8); config.writeUInt32LE(computeLimit, 0); config.writeUInt32LE(dataLimit, 4);
  const heads = items.map(ix => { const out = Buffer.alloc(4); out[0] = ix.programIdIndex;
    out[1] = ix.accountKeyIndexes.length; out.writeUInt16LE(ix.data.length, 2); return out; });
  const payloads = items.map(ix => Buffer.concat([Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]));
  const wire = Buffer.concat([Buffer.from([0x81, v0.header.numRequiredSignatures,
    v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]), Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]), ...keys.map(x => x.toBuffer()), config,
    ...heads, ...payloads, Buffer.alloc(64 * v0.header.numRequiredSignatures)]);
  if (wire.length > 4096) throw new Error(`v1 size limit: ${wire.length}`);
  return {wire, wireSha256: sha256(wire), wireBase64: wire.toString('base64'), sizeBytes: wire.length,
    v0Bytes, addressCount: keys.length, addresses: keys.map(x => x.toBase58()),
    writableCount: keys.length - v0.header.numReadonlySignedAccounts - v0.header.numReadonlyUnsignedAccounts,
    instructionCount: items.length, requiredSignatures: v0.header.numRequiredSignatures,
    config: {computeLimit, loadedAccountsDataLimit: dataLimit}};
}

function parseGlobal(data, trader) {
  if (!data || data.length < 96 || data.readBigUInt64LE(0) !== 10787423733276977665n) return null;
  const root = data.readUInt32LE(76), dynamic = data.subarray(96), NIL = 0xffffffff, seen = new Set();
  let found = null;
  const walk = index => {
    if (index === NIL || found) return;
    if (seen.has(index) || index % 8 || index + 64 > dynamic.length) throw new Error(`invalid global tree node ${index}`);
    seen.add(index); walk(dynamic.readUInt32LE(index));
    if (new PublicKey(dynamic.subarray(index + 16, index + 48)).equals(trader))
      found = dynamic.readBigUInt64LE(index + 48).toString();
    walk(dynamic.readUInt32LE(index + 4));
  };
  walk(root); return {traderBalanceRaw: found, reachableNodesVisited: seen.size, sha256: sha256(data)};
}
function parseAccount(account, label) {
  if (!account) return null;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const accountOwner = typeof account.owner === 'string' ? account.owner : account.owner.toBase58();
  if (label === 'manifestGlobal') return {kind: 'manifestGlobal', ...parseGlobal(data, owner)};
  if (label === 'klendReserve') return {kind: 'klendReserve', availableLiquidityRaw: data.readBigUInt64LE(224).toString(),
    flashLoanFeeSf: data.readBigUInt64LE(4904).toString(), sha256: sha256(data)};
  if (accountOwner === token.toBase58() && data.length >= 72)
    return {kind: 'splToken', amountRaw: data.readBigUInt64LE(64).toString(), sha256: sha256(data)};
  return {kind: 'account', dataLength: data.length, sha256: sha256(data)};
}

const watched = [ownerToken, globalVault, global, flashSupply, flashFeeVault, flashReserve];
const watchedLabels = ['ownerUsdc', 'manifestGlobalVault', 'manifestGlobal',
  'klendLiquiditySupply', 'klendFlashFeeVault', 'klendReserve'];
const decodeWatched = accounts => Object.fromEntries(watchedLabels.map((label, i) =>
  [label, parseAccount(accounts?.[i], label)]));

async function deployment(program) {
  const programInfo = await conn.getAccountInfo(program, 'confirmed');
  const record = {program: program.toBase58(), executable: programInfo?.executable || false,
    loader: programInfo?.owner.toBase58(), programAccountSha256: programInfo ? sha256(programInfo.data) : null};
  if (programInfo?.data.length >= 36 && programInfo.data.readUInt32LE(0) === 2) {
    const programData = new PublicKey(programInfo.data.subarray(4, 36));
    const info = await conn.getAccountInfo(programData, 'confirmed');
    const authorityPresent = info?.data[12] === 1;
    const bytesOffset = authorityPresent ? 45 : 13;
    Object.assign(record, {programData: programData.toBase58(), deploymentSlot: Number(info.data.readBigUInt64LE(4)),
      upgradeAuthority: authorityPresent ? new PublicKey(info.data.subarray(13, 45)).toBase58() : null,
      programDataSha256: sha256(info.data), executableBytesOffset: bytesOffset,
      executableBytesLength: info.data.length - bytesOffset, executableBytesSha256: sha256(info.data.subarray(bytesOffset))});
  }
  return record;
}

async function simulate(label, instructions, payer, blockhash) {
  const encoded = encodeV1(instructions, payer, blockhash);
  const request = {jsonrpc: '2.0', id: label, method: 'simulateTransaction', params: [
    encoded.wireBase64, {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
      commitment: 'confirmed', accounts: {encoding: 'base64', addresses: watched.map(x => x.toBase58())}},
  ]};
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(request)});
  const json = await response.json(), value = json.result?.value;
  return {label, payer: payer.toBase58(), transportError: json.error || null, slot: json.result?.context?.slot,
    err: value?.err || null, unitsConsumed: value?.unitsConsumed, loadedAccountsDataSize: value?.loadedAccountsDataSize,
    ...encoded, post: decodeWatched(value?.accounts), logs: value?.logs || null};
}

(async () => {
  if (!rpcUrl) throw new Error('SOLANA_RPC is required');
  const preContext = await conn.getMultipleAccountsInfoAndContext(watched, 'confirmed');
  const pre = decodeWatched(preContext.value);
  const ownerBalance = BigInt(pre.manifestGlobal.traderBalanceRaw);
  const available = BigInt(pre.klendReserve.availableLiquidityRaw);
  const feeRate = BigInt(pre.klendReserve.flashLoanFeeSf);
  if (feeRate !== 0n) throw new Error(`selected KLend reserve is not fee-free: ${feeRate}`);
  const outsiderInfo = await conn.getAccountInfo(outsiderToken, 'confirmed');
  if (!outsiderInfo) throw new Error(`outsider USDC ATA missing: ${outsiderToken}`);
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const pair = amount => [flashIx(borrowTemplate, amount), flashIx(repayTemplate, amount, 0)];
  const cycle = amount => [flashIx(borrowTemplate, amount), deposit(amount), withdraw(amount), flashIx(repayTemplate, amount, 0)];
  const cycles = (count, amount, options) => [flashIx(borrowTemplate, amount),
    ...Array.from({length: count}, () => [deposit(amount, options), withdraw(amount, options)]).flat(),
    flashIx(repayTemplate, amount, 0)];
  const cases = [
    ['direct_withdraw_one_positive_control', [withdraw(1n)], owner],
    ['direct_withdraw_full_positive_control', [withdraw(ownerBalance)], owner],
    ['direct_withdraw_zero_boundary', [withdraw(0n)], owner],
    ['direct_withdraw_over_balance', [withdraw(ownerBalance + 1n)], owner],
    ['duplicate_full_withdraw_atomicity', [withdraw(ownerBalance), withdraw(ownerBalance)], owner],
    ['missing_owner_signature', [withdraw(1n, {signer: false})], outsider],
    ['destination_owned_by_other_signer', [withdraw(1n, {destination: outsiderToken})], owner],
    ['alias_global_vault_as_destination', [withdraw(1n, {aliasVault: true})], owner],
    ['swap_global_and_vault_account_order', [withdraw(1n, {swapStateVault: true})], owner],
    ['klend_fee_free_pair_one_raw', pair(1n), owner],
    ['klend_manifest_cycle_one_raw', cycle(1n), owner],
    ['klend_manifest_cycle_two_raw', cycle(2n), owner],
    ['klend_manifest_cycle_nine_raw', cycle(9n), owner],
    ['klend_manifest_cycle_ten_raw', cycle(10n), owner],
    ['klend_manifest_cycle_available_minus_one', cycle(available - 1n), owner],
    ['klend_manifest_cycle_available', cycle(available), owner],
    ['klend_pair_available_plus_one', pair(available + 1n), owner],
    ['klend_manifest_two_cycles', cycles(2, 1_000_000n), owner],
    ['klend_manifest_four_cycles', cycles(4, 1_000_000n), owner],
    ['klend_manifest_eight_cycles', cycles(8, 1_000_000n), owner],
    ['klend_manifest_one_cycle_64_addresses', cycles(1, 1_000_000n, {extraKeys: paddingKeys}), owner],
    ['klend_manifest_thirteen_cycles_64_addresses_near_max_bytes', cycles(13, 1_000_000n, {extraKeys: paddingKeys}), owner],
    ['klend_manifest_alias_destination', [flashIx(borrowTemplate, 1_000_000n), deposit(1_000_000n),
      withdraw(1_000_000n, {aliasVault: true}), flashIx(repayTemplate, 1_000_000n, 0)], owner],
    ['klend_wrong_repay_index', [flashIx(borrowTemplate, 1_000_000n), deposit(1_000_000n),
      withdraw(1_000_000n), flashIx(repayTemplate, 1_000_000n, 1)], owner],
  ];
  const results = [];
  for (const [label, instructions, payer] of cases) {
    try {
      const result = await simulate(label, instructions, payer, blockhash);
      results.push(result);
      console.log(JSON.stringify({label, err: result.err, transportError: result.transportError,
        bytes: result.sizeBytes, accounts: result.addressCount, units: result.unitsConsumed,
        wallet: result.post?.ownerUsdc?.amountRaw, manifestVault: result.post?.manifestGlobalVault?.amountRaw,
        deposit: result.post?.manifestGlobal?.traderBalanceRaw,
        klendSupply: result.post?.klendLiquiditySupply?.amountRaw,
        feeVault: result.post?.klendFlashFeeVault?.amountRaw}));
    } catch (error) {
      results.push({label, localError: error.stack || error.message});
      console.log(JSON.stringify({label, localError: error.message}));
    }
  }
  const output = {timestamp: new Date().toISOString(), liveSubmission: false, sigVerify: false,
    sourceFlashSignature: flashSource.signature, sourceFlashSlot: flashSource.slot,
    target: {program: manifest.toBase58(), path: 'GlobalDeposit/GlobalWithdraw', mint: mint.toBase58(),
      global: global.toBase58(), globalVault: globalVault.toBase58(), owner: owner.toBase58(), ownerToken: ownerToken.toBase58(),
      ownerDepositRaw: ownerBalance.toString()},
    deployments: {manifest: await deployment(manifest), klend: await deployment(klend)},
    v1Limits: {maxWireBytes: 4096, maxInlineAddresses: 64, maxInstructions: 64,
      addressLookupTables: false, computeUnitLimit: 1_400_000, loadedAccountsDataLimit: 67_108_864},
    flashReserve: {address: flashReserve.toBase58(), liquiditySupply: flashSupply.toBase58(),
      feeVault: flashFeeVault.toBase58(), availableLiquidityRaw: available.toString(),
      flashLoanFeeSf: feeRate.toString(), feeInterpretation: 'Actual current config field is exactly zero; this is not fee rounding.'},
    watched: Object.fromEntries(watchedLabels.map((x, i) => [x, watched[i].toBase58()])), preSlot: preContext.context.slot,
    pre, debtAndShares: 'KLend flash loans have no obligation/debt account. Repayment is proved by successful indexed repay plus unchanged liquidity-supply, fee-vault, and reserve state. Manifest global trader balance is the target credit/share-equivalent field.',
    updateCrankApplicability: 'Manifest GlobalDeposit/GlobalWithdraw has no price refresh, crank, or update account/instruction dependency; no such interleave exists for this path.',
    results};
  fs.writeFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/manifest-klend-v1-sim.json', JSON.stringify(output, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
