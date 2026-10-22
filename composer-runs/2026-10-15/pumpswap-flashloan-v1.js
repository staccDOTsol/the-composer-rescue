#!/usr/bin/env node
/*
 * PumpSwap + fee-free Project 0 flashloan current-mainnet v1 simulations.
 * Read only: this file only calls read RPC methods and simulateTransaction. It never signs
 * or submits a transaction. The v1 transaction signatures are zero-filled.
 */
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  Connection, PublicKey, TransactionInstruction, TransactionMessage,
  VersionedTransaction, SystemProgram,
} = require(modules + '/@solana/web3.js');
const {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction,
} = require(modules + '/@solana/spl-token');
const bs58Module = require(modules + '/bs58');
const bs58 = bs58Module.default || bs58Module;

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = (env.HEAVY_RPC_URL || env.RPC_URL).replace(/^['"]|['"]$/g, '');
if (!rpcUrl) throw new Error('No read-only RPC configured');
const connection = new Connection(rpcUrl, 'confirmed');
let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const P = value => new PublicKey(value);
const P0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const PUMP = P('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const SYSTEM = P('11111111111111111111111111111111');
const p0SourceSignature = '2WxD766a1LAyiHiMYK8REpBsNpDhA8GQAkNb3occqXXooFF5xyUKz6Xim4m9tVQMiyFrhCYbKKcb6o4FibMBBdwG';
const pumpSourceSignature = '3mA9WxvLEKSGuFF9TyHborMTuLbPRNHyBkfmZPykSiNpUp1YpTWs6pZqZzxahtGWXZbBQGpDp7nVrnLzkf1Cm1oC';
const START = Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]);
const END = Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]);
const BORROW = Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]);
const REPAY = Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]);
const idlPath = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/repos/pump-public-docs/idl/pump_amm.json';
const poolsPath = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/amm-canvass/pumpswap-verified-10p.json';
const idl = JSON.parse(fs.readFileSync(idlPath));
const defs = Object.fromEntries(idl.instructions.map(x => [x.name, x]));
const poolRow = JSON.parse(fs.readFileSync(poolsPath)).pools.find(x =>
  x.address === '4MJ9A8Uy9xW3szjXd9jMdwNLEr4EpR8v1Aiep55PVPBg');
if (!poolRow) throw new Error('Pinned PumpSwap pool missing from verified pool inventory');
const thinPoolRow = JSON.parse(fs.readFileSync(poolsPath)).pools.find(x =>
  x.address === 'EqsWoSsc1rMJi8gH4KfmmqSjXh9SZLn1kFKAQge3qPtx');
if (!thinPoolRow) throw new Error('Pinned thin PumpSwap pool missing from verified pool inventory');

const clone = ix => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map(k => ({...k})), data: Buffer.from(ix.data)});
const matching = (ix, id, disc) => ix.programId.equals(id) &&
  Buffer.from(ix.data).subarray(0, 8).equals(disc);
const u64 = value => {const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b;};
const args = (name, ...values) => Buffer.concat([Buffer.from(defs[name].discriminator),
  ...values.map(u64)]);

async function decompile(signature) {
  const tx = await rpc('getTransaction', [signature,
    {encoding: 'base64', maxSupportedTransactionVersion: 1, commitment: 'confirmed'}]);
  if (!tx) throw new Error(`Missing source transaction ${signature}`);
  const wire = VersionedTransaction.deserialize(Buffer.from(tx.transaction[0], 'base64'));
  const alts = await Promise.all((wire.message.addressTableLookups || []).map(async lookup => {
    const result = await connection.getAddressLookupTable(lookup.accountKey);
    if (!result.value) throw new Error(`Missing ALT ${lookup.accountKey}`);
    return result.value;
  }));
  return {slot: tx.slot, message: TransactionMessage.decompile(wire.message,
    {addressLookupTableAccounts: alts})};
}

async function pumpTemplate() {
  const tx = await connection.getParsedTransaction(pumpSourceSignature,
    {maxSupportedTransactionVersion: 1, commitment: 'confirmed'});
  if (!tx || tx.meta?.err) throw new Error('PumpSwap source transaction unavailable');
  const metas = new Map(tx.transaction.message.accountKeys.map(x => [x.pubkey.toBase58(), x]));
  const raw = tx.transaction.message.instructions.find(ix => ix.programId?.equals(PUMP) &&
    ix.data && Buffer.from(bs58.decode(ix.data)).subarray(0, 8)
      .equals(Buffer.from(defs.buy.discriminator)));
  if (!raw) throw new Error('Pinned PumpSwap buy instruction unavailable');
  return {slot: tx.slot, ix: new TransactionInstruction({programId: PUMP,
    keys: raw.accounts.map(pubkey => ({pubkey,
      isSigner: !!metas.get(pubkey.toBase58())?.signer,
      isWritable: !!metas.get(pubkey.toBase58())?.writable})),
    data: Buffer.from(bs58.decode(raw.data))})};
}

// web3.js 1.99 compiles account ordering/privileges, but not the 4,096-byte v1 wire.
function encodeV1(instructions, payer, blockhash, computeLimit = 1400000,
    dataLimit = 67108864) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message([]);
  if (compiled.addressTableLookups.length) throw new Error('v1 does not use ALTs');
  const keys = compiled.staticAccountKeys;
  const items = compiled.compiledInstructions;
  if (keys.length > 64 || items.length > 64)
    throw new Error(`v1 key/instruction limit: ${keys.length}/${items.length}`);
  const cfg = Buffer.alloc(8); cfg.writeUInt32LE(computeLimit, 0); cfg.writeUInt32LE(dataLimit, 4);
  const heads = items.map(ix => {const b = Buffer.alloc(4); b[0] = ix.programIdIndex;
    b[1] = ix.accountKeyIndexes.length; b.writeUInt16LE(ix.data.length, 2); return b;});
  const payloads = items.map(ix => Buffer.concat([Buffer.from(ix.accountKeyIndexes),
    Buffer.from(ix.data)]));
  const message = Buffer.concat([
    Buffer.from([0x81, compiled.header.numRequiredSignatures,
      compiled.header.numReadonlySignedAccounts, compiled.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]), Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]), ...keys.map(k => k.toBuffer()), cfg,
    ...heads, ...payloads,
  ]);
  const wire = Buffer.concat([message,
    Buffer.alloc(64 * compiled.header.numRequiredSignatures)]);
  if (wire.length > 4096) throw new Error(`v1 size limit: ${wire.length}`);
  const header = compiled.header;
  const accounts = keys.map((key, i) => ({index: i, address: key.toBase58(),
    signer: i < header.numRequiredSignatures,
    writable: i < header.numRequiredSignatures ?
      i < header.numRequiredSignatures - header.numReadonlySignedAccounts :
      i < keys.length - header.numReadonlyUnsignedAccounts}));
  return {wire, message, bytes: wire.length, messageBytes: message.length,
    accountCount: keys.length, instructionCount: items.length,
    requiredSignatures: header.numRequiredSignatures, accounts};
}

function snapshot(info) {
  if (!info) return null;
  const token = (info.owner.equals ? info.owner.toBase58() : info.owner);
  const raw = Buffer.isBuffer(info.data) ? info.data : Buffer.from(info.data[0], 'base64');
  const tokenOwned = token === TOKEN_PROGRAM_ID.toBase58() || token === TOKEN_2022_PROGRAM_ID.toBase58();
  const mintSupplyRaw = tokenOwned && raw.length === 82 ? raw.readBigUInt64LE(36).toString() : null;
  const tokenAmountRaw = tokenOwned && raw.length >= 165 ? raw.readBigUInt64LE(64).toString() : null;
  return {owner: token, lamports: info.lamports, tokenAmountRaw, mintSupplyRaw,
    dataSha256: crypto.createHash('sha256').update(raw).digest('hex')};
}

function traceTokenMutations(innerInstructions) {
  const trace = [], tokenDeltas = {}, mintSupplyDeltas = {};
  const add = (map, key, value) => {map[key] = (BigInt(map[key] || 0) + value).toString();};
  for (const group of innerInstructions || []) for (const ix of group.instructions || []) {
    const parsed = ix.parsed, info = parsed?.info;
    if (!parsed || !info) continue;
    if (parsed.type === 'transfer' || parsed.type === 'transferChecked') {
      const amount = BigInt(info.amount || info.tokenAmount?.amount || 0);
      trace.push({topLevelInstructionIndex: group.index, type: parsed.type,
        mint: info.mint || null, source: info.source, destination: info.destination,
        amountRaw: amount.toString()});
      add(tokenDeltas, info.source, -amount); add(tokenDeltas, info.destination, amount);
    } else if (parsed.type === 'mintTo' || parsed.type === 'burn') {
      const amount = BigInt(info.amount || 0), sign = parsed.type === 'mintTo' ? 1n : -1n;
      trace.push({topLevelInstructionIndex: group.index, type: parsed.type,
        mint: info.mint, account: info.account, amountRaw: amount.toString()});
      add(tokenDeltas, info.account, sign * amount); add(mintSupplyDeltas, info.mint, sign * amount);
    }
  }
  return {trace, tokenDeltas, mintSupplyDeltas};
}

async function simulate(label, instructions, payer, watched) {
  try {
    const {blockhash} = await connection.getLatestBlockhash('confirmed');
    const encoded = encodeV1(instructions, payer, blockhash);
    const unique = [...new Map(watched.map(x => [x.toBase58(), x])).values()];
    const before = await connection.getMultipleAccountsInfoAndContext(unique, 'confirmed');
    const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'),
      {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
        commitment: 'confirmed', innerInstructions: true,
        accounts: {encoding: 'base64', addresses: unique.map(String)}}]);
    const value = result.value;
    const mutations = traceTokenMutations(value.innerInstructions);
    const watchedRows = unique.map((key, i) => ({address: key.toBase58(),
      pre: snapshot(before.value[i]), post: snapshot(value.accounts?.[i])}));
    for (const row of watchedRows) {
      if (row.post?.tokenAmountRaw !== null && row.post?.tokenAmountRaw !== undefined) {
        const delta = BigInt(mutations.tokenDeltas[row.address] || 0);
        row.inferredSameSlotPreTokenAmountRaw = (BigInt(row.post.tokenAmountRaw) - delta).toString();
        row.transactionLocalTokenDeltaRaw = delta.toString();
      }
      if (row.post?.mintSupplyRaw !== null && row.post?.mintSupplyRaw !== undefined) {
        const delta = BigInt(mutations.mintSupplyDeltas[row.address] || 0);
        row.inferredSameSlotPreMintSupplyRaw = (BigInt(row.post.mintSupplyRaw) - delta).toString();
        row.transactionLocalMintSupplyDeltaRaw = delta.toString();
      }
    }
    const byAddress = Object.fromEntries(watchedRows.map(x => [x.address, x]));
    const poolBase = byAddress[poolRow.baseVault], poolQuote = byAddress[poolRow.quoteVault];
    const poolInvariant = poolBase?.post?.tokenAmountRaw && poolQuote?.post?.tokenAmountRaw ? {
      preK: (BigInt(poolBase.inferredSameSlotPreTokenAmountRaw) *
        BigInt(poolQuote.inferredSameSlotPreTokenAmountRaw)).toString(),
      postK: (BigInt(poolBase.post.tokenAmountRaw) * BigInt(poolQuote.post.tokenAmountRaw)).toString(),
    } : null;
    if (poolInvariant) poolInvariant.deltaK =
      (BigInt(poolInvariant.postK) - BigInt(poolInvariant.preK)).toString();
    return {label, simulatedOnly: true, signatureVerification: false,
      v1Bytes: encoded.bytes, v1MessageBytes: encoded.messageBytes,
      transactionWireBase64: encoded.wire.toString('base64'),
      transactionWireSha256: crypto.createHash('sha256').update(encoded.wire).digest('hex'),
      accountCount: encoded.accountCount, instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures, orderedAccounts: encoded.accounts,
      preSlot: before.context.slot, simulationSlot: result.context?.slot,
      err: value.err, unitsConsumed: value.unitsConsumed,
      loadedAccountsDataSize: value.loadedAccountsDataSize,
      watched: watchedRows, tokenTransferTrace: mutations.trace,
      transactionLocalTokenDeltasRaw: mutations.tokenDeltas,
      transactionLocalMintSupplyDeltasRaw: mutations.mintSupplyDeltas,
      poolConstantProductReconciliation: poolInvariant,
      innerInstructions: value.innerInstructions || null, logs: value.logs || []};
  } catch (error) {
    return {label, localError: error.stack || error.message};
  }
}

function p0AmountPair(borrowTemplate, repayTemplate, destination, amount) {
  const borrow = clone(borrowTemplate), repay = clone(repayTemplate);
  borrow.keys[4].pubkey = destination; repay.keys[4].pubkey = destination;
  borrow.data.writeBigUInt64LE(BigInt(amount), 8);
  repay.data.writeBigUInt64LE(BigInt(amount), 8);
  return [borrow, repay];
}

function flashEnvelope(startTemplate, endTemplate, pair, setup, middle,
    order = 'normal') {
  const start = clone(startTemplate), end = clone(endTemplate);
  let body;
  if (order === 'repay_before_middle') body = [clone(pair[0]), clone(pair[1]), ...middle.map(clone)];
  else if (order === 'middle_before_borrow') body = [...middle.map(clone), clone(pair[0]), clone(pair[1])];
  else body = [clone(pair[0]), ...middle.map(clone), clone(pair[1])];
  const all = [...setup.map(clone), start, ...body, end];
  start.data.writeBigUInt64LE(BigInt(all.length - 1), 8);
  return all;
}

async function main() {
  const [p0, pump] = await Promise.all([decompile(p0SourceSignature), pumpTemplate()]);
  const start = p0.message.instructions.find(ix => matching(ix, P0, START));
  const end = p0.message.instructions.find(ix => matching(ix, P0, END));
  const borrow = p0.message.instructions.find(ix => matching(ix, P0, BORROW));
  const repay = p0.message.instructions.find(ix => matching(ix, P0, REPAY));
  if (!start || !end || !borrow || !repay) throw new Error('Project 0 source incomplete');
  const owner = borrow.keys[2].pubkey;
  if (!owner.equals(p0.message.payerKey)) throw new Error('Project 0 borrower is not payer');
  const baseMint = P(poolRow.baseMint), quoteMint = P(poolRow.quoteMint), lpMint = P(poolRow.lpMint);
  const buyNames = defs.buy.accounts.map(x => x.name);
  const templateByName = Object.fromEntries(buyNames.map((name, i) => [name, pump.ix.keys[i].pubkey]));
  const baseProgram = templateByName.base_token_program;
  const quoteProgram = templateByName.quote_token_program;
  if (!baseMint.equals(NATIVE_MINT) || !baseProgram.equals(TOKEN_PROGRAM_ID))
    throw new Error('Pinned PumpSwap pool is not WSOL-based');
  const userBase = getAssociatedTokenAddressSync(baseMint, owner, true, baseProgram);
  const userQuote = getAssociatedTokenAddressSync(quoteMint, owner, true, quoteProgram);
  const [lpMintInfo, quoteMintInfo] = await connection.getMultipleAccountsInfo(
    [lpMint, quoteMint], 'confirmed');
  const lpProgram = lpMintInfo.owner;
  const userLp = getAssociatedTokenAddressSync(lpMint, owner, true, lpProgram);
  const userVolume = PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), owner.toBuffer()], PUMP)[0];
  const globalVolume = templateByName.global_volume_accumulator;
  const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PUMP)[0];
  const globalConfig = templateByName.global_config;
  const setup = [
    createAssociatedTokenAccountIdempotentInstruction(owner, userQuote, owner, quoteMint, quoteProgram),
    createAssociatedTokenAccountIdempotentInstruction(owner, userBase, owner, baseMint, baseProgram),
    createAssociatedTokenAccountIdempotentInstruction(owner, userLp, owner, lpMint, lpProgram),
    SystemProgram.transfer({fromPubkey: owner, toPubkey: userBase, lamports: 20_000_000}),
    createSyncNativeInstruction(userBase, baseProgram),
  ];
  if (!await connection.getAccountInfo(userVolume, 'confirmed')) setup.push(new TransactionInstruction({
    programId: PUMP, keys: [
      {pubkey: owner, isSigner: true, isWritable: true},
      {pubkey: owner, isSigner: false, isWritable: false},
      {pubkey: userVolume, isSigner: false, isWritable: true},
      {pubkey: SYSTEM, isSigner: false, isWritable: false},
      {pubkey: eventAuthority, isSigner: false, isWritable: false},
      {pubkey: PUMP, isSigner: false, isWritable: false},
    ], data: Buffer.from(defs.init_user_volume_accumulator.discriminator)}));

  const replacements = {user: owner, user_base_token_account: userBase,
    user_quote_token_account: userQuote, user_volume_accumulator: userVolume};
  const remainingSwapKeys = pump.ix.keys.slice(buyNames.length).map(k => ({...k}));
  const swapKeys = name => [...defs[name].accounts.map(account => ({
    pubkey: replacements[account.name] || templateByName[account.name],
    isSigner: !!account.signer, isWritable: !!account.writable,
  })), ...remainingSwapKeys.map(k => ({...k}))];
  const buy = (base, maxQuote) => new TransactionInstruction({programId: PUMP,
    keys: swapKeys('buy'), data: Buffer.concat([args('buy', base, maxQuote), Buffer.from([1])])});
  const sell = base => new TransactionInstruction({programId: PUMP,
    keys: swapKeys('sell'), data: args('sell', base, 0n)});

  // An independently selected current dust pool has exactly one raw WSOL unit.
  // Build its canonical legacy swap accounts from the same IDL and live fee config.
  const thinBaseMint = P(thinPoolRow.baseMint), thinQuoteMint = P(thinPoolRow.quoteMint);
  const thinMintInfos = await connection.getMultipleAccountsInfo(
    [thinBaseMint, thinQuoteMint, P(thinPoolRow.address)], 'confirmed');
  const thinBaseProgram = thinMintInfos[0].owner, thinQuoteProgram = thinMintInfos[1].owner;
  const thinUserQuote = getAssociatedTokenAddressSync(thinQuoteMint, owner, true, thinQuoteProgram);
  const thinProtocolFeeAta = getAssociatedTokenAddressSync(thinQuoteMint,
    templateByName.protocol_fee_recipient, true, thinQuoteProgram);
  const thinCoinCreator = P(thinMintInfos[2].data.subarray(211, 243));
  const thinCreatorAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), thinCoinCreator.toBuffer()], PUMP)[0];
  const thinCreatorAta = getAssociatedTokenAddressSync(thinQuoteMint,
    thinCreatorAuthority, true, thinQuoteProgram);
  const buybackConfig = remainingSwapKeys[0].pubkey;
  const thinBuybackAta = getAssociatedTokenAddressSync(thinQuoteMint,
    buybackConfig, true, thinQuoteProgram);
  const thinByName = {...templateByName, pool: P(thinPoolRow.address), base_mint: thinBaseMint,
    quote_mint: thinQuoteMint, user_base_token_account: userBase,
    user_quote_token_account: thinUserQuote, pool_base_token_account: P(thinPoolRow.baseVault),
    pool_quote_token_account: P(thinPoolRow.quoteVault), base_token_program: thinBaseProgram,
    quote_token_program: thinQuoteProgram, protocol_fee_recipient_token_account: thinProtocolFeeAta,
    coin_creator_vault_ata: thinCreatorAta, coin_creator_vault_authority: thinCreatorAuthority,
    user: owner, user_volume_accumulator: userVolume};
  const thinKeys = name => [...defs[name].accounts.map(account => ({
    pubkey: thinByName[account.name], isSigner: !!account.signer,
    isWritable: !!account.writable})),
    {...remainingSwapKeys[0]}, {pubkey: thinBuybackAta, isSigner: false, isWritable: true}];
  const thinSell = amount => new TransactionInstruction({programId: PUMP,
    keys: thinKeys('sell'), data: args('sell', amount, 0n)});
  const thinBuy = (amount, maxQuote) => new TransactionInstruction({programId: PUMP,
    keys: thinKeys('buy'), data: Buffer.concat([args('buy', amount, maxQuote), Buffer.from([1])])});
  const sync = new TransactionInstruction({programId: PUMP, keys: [
    {pubkey: owner, isSigner: false, isWritable: false},
    {pubkey: globalVolume, isSigner: false, isWritable: false},
    {pubkey: userVolume, isSigner: false, isWritable: true},
    {pubkey: eventAuthority, isSigner: false, isWritable: false},
    {pubkey: PUMP, isSigner: false, isWritable: false},
  ], data: Buffer.from(defs.sync_user_volume_accumulator.discriminator)});
  const deposit = (lp, maxBase, maxQuote) => new TransactionInstruction({programId: PUMP,
    keys: [P(poolRow.address), globalConfig, owner, baseMint, quoteMint, lpMint,
      userBase, userQuote, userLp, P(poolRow.baseVault), P(poolRow.quoteVault),
      TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, eventAuthority, PUMP]
      .map((pubkey, i) => ({pubkey, isSigner: i === 2,
        isWritable: [0,5,6,7,8,9,10].includes(i)})),
    data: args('deposit', lp, maxBase, maxQuote)});
  const withdraw = lp => new TransactionInstruction({programId: PUMP,
    keys: [P(poolRow.address), globalConfig, owner, baseMint, quoteMint, lpMint,
      userBase, userQuote, userLp, P(poolRow.baseVault), P(poolRow.quoteVault),
      TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, eventAuthority, PUMP]
      .map((pubkey, i) => ({pubkey, isSigner: i === 2,
        isWritable: [0,5,6,7,8,9,10].includes(i)})),
    data: args('withdraw', lp, 0n, 0n)});

  const watched = [userBase, userQuote, userLp, lpMint, owner, borrow.keys[6].pubkey,
    P(poolRow.address), P(poolRow.baseVault), P(poolRow.quoteVault), userVolume,
    globalVolume, templateByName.protocol_fee_recipient_token_account,
    templateByName.coin_creator_vault_ata, templateByName.fee_config,
    ...remainingSwapKeys.map(x => x.pubkey)];
  const reserveInfo = await connection.getAccountInfo(borrow.keys[6].pubkey, 'confirmed');
  const available = reserveInfo.data.readBigUInt64LE(64);
  const poolBaseInfo = await connection.getAccountInfo(P(poolRow.baseVault), 'confirmed');
  const poolBase = poolBaseInfo.data.readBigUInt64LE(64);
  const [thinBaseVaultInfo, thinQuoteVaultInfo] = await connection.getMultipleAccountsInfo(
    [P(thinPoolRow.baseVault), P(thinPoolRow.quoteVault)], 'confirmed');
  const thinBaseRaw = thinBaseVaultInfo.data.readBigUInt64LE(64);
  const thinQuoteRaw = thinQuoteVaultInfo.data.readBigUInt64LE(64);
  const results = [];

  // Establish the actual PumpSwap minimum successful WSOL sell and quote output.
  const thresholdProbes = [];
  let firstSuccess = null;
  for (const base of [1n,2n,4n,8n,16n,32n,64n,128n,256n,512n,1024n,2048n,
    4096n,8192n,16384n,32768n,65536n,131072n,262144n,524288n,1048576n]) {
    const result = await simulate(`pump_sell_threshold_${base}`, [...setup, sell(base)], owner, watched);
    thresholdProbes.push(result);
    console.log(JSON.stringify({label: result.label, err: result.err,
      localError: result.localError?.split('\n')[0], units: result.unitsConsumed,
      logTail: result.logs?.filter(x => x.includes('Instruction:') ||
        x.includes('Error') || x.includes('failed')).slice(-4)}));
    const quotePost = result.watched?.find(x => x.address === userQuote.toBase58())?.post?.tokenAmountRaw;
    if (!result.err && !result.localError && BigInt(quotePost || 0) > 0n) {firstSuccess = {base,
      quote: BigInt(quotePost)}; break;}
  }
  results.push(...thresholdProbes);
  if (!firstSuccess) {
    fs.writeFileSync(__dirname + '/pumpswap-flashloan-v1-debug.json',
      JSON.stringify({generatedAt: new Date().toISOString(), thresholdProbes}, null, 2) + '\n');
    throw new Error('No PumpSwap sell threshold succeeded through 1,048,576 raw WSOL');
  }
  let lo = firstSuccess.base / 2n, hi = firstSuccess.base;
  while (hi - lo > 1n) {
    const mid = (hi + lo) / 2n;
    const result = await simulate(`pump_sell_threshold_binary_${mid}`, [...setup, sell(mid)], owner, watched);
    results.push(result);
    const quotePost = result.watched?.find(x => x.address === userQuote.toBase58())?.post?.tokenAmountRaw;
    if (!result.err && !result.localError && BigInt(quotePost || 0) > 0n) hi = mid; else lo = mid;
  }
  const thresholdCases = [];
  for (const base of [...new Set([hi > 1n ? hi - 1n : 1n, hi, hi + 1n].map(String))].map(BigInt)) {
    const result = await simulate(`pump_sell_rounding_${base}`, [...setup, sell(base)], owner, watched);
    results.push(result); thresholdCases.push(result);
    if (base === hi && !result.err) firstSuccess = {base,
      quote: BigInt(result.watched.find(x => x.address === userQuote.toBase58()).post.tokenAmountRaw)};
  }

  // Measure quote proceeds from a stable small sale before constructing reverse swaps.
  const tradeBase = hi < 100000n ? 100000n : hi;
  const sellProbe = await simulate('pump_sell_output_probe', [...setup, sell(tradeBase)], owner, watched);
  results.push(sellProbe);
  const measuredQuote = BigInt(sellProbe.watched?.find(x =>
    x.address === userQuote.toBase58())?.post?.tokenAmountRaw || 0);
  if (sellProbe.err || measuredQuote === 0n) throw new Error('PumpSwap funded sell probe failed');
  const conservativeBuyBase = tradeBase * 90n / 100n;

  const pairFor = amount => p0AmountPair(borrow, repay, userBase, amount);
  const envelope = (amount, middle, order) => flashEnvelope(start, end, pairFor(amount), setup, middle, order);
  const thinSetup = [...setup,
    createAssociatedTokenAccountIdempotentInstruction(owner, thinUserQuote, owner,
      thinQuoteMint, thinQuoteProgram)];
  const thinEnvelope = (amount, middle) => flashEnvelope(start, end, pairFor(amount),
    thinSetup, middle);
  const thinWatched = [...watched, P(thinPoolRow.address), P(thinPoolRow.baseVault),
    P(thinPoolRow.quoteVault), thinUserQuote, thinProtocolFeeAta, thinCreatorAta,
    thinBuybackAta];
  results.push(await simulate('positive_funded_flash_pair_control', envelope(1000000n, []), owner, watched));
  for (const amount of [1n,2n,available * 90n / 100n,available * 95n / 100n,
    available * 99n / 100n,available - 1n])
    results.push(await simulate(`flash_pair_boundary_${amount}`, envelope(amount, []), owner, watched));

  results.push(await simulate('flash_swap_roundtrip_small',
    envelope(1000000n, [sell(tradeBase), buy(conservativeBuyBase, measuredQuote)]), owner, watched));
  results.push(await simulate('flash_swap_roundtrip_near_lender_liquidity',
    envelope(available * 90n / 100n, [sell(tradeBase),
      buy(conservativeBuyBase, measuredQuote)]), owner, watched));
  results.push(await simulate('flash_swap_roundtrip_near_pool_base_liquidity',
    envelope(poolBase * 90n / 100n, [sell(poolBase * 90n / 100n),
      buy(poolBase * 80n / 100n, 0xffffffffffffffffn)]), owner, watched));
  results.push(await simulate('thin_pool_one_raw_wsol_sell_in_flash',
    thinEnvelope(2n, [thinSell(1n)]), owner, thinWatched));
  results.push(await simulate('thin_pool_one_raw_wsol_sell_buy_roundtrip',
    thinEnvelope(2n, [thinSell(1n), thinBuy(1n, 0xffffffffffffffffn)]),
    owner, thinWatched));
  results.push(await simulate('flash_swap_sync_before_between_after',
    envelope(1000000n, [sync, sell(tradeBase), sync,
      buy(conservativeBuyBase, measuredQuote), sync]), owner, watched));
  results.push(await simulate('flash_two_swap_roundtrips', envelope(2000000n,
    [sell(tradeBase), buy(conservativeBuyBase * 9n / 10n, measuredQuote),
      sell(tradeBase), buy(conservativeBuyBase * 9n / 10n, measuredQuote)]), owner, watched));
  for (const count of [4, 6, 8, 10]) {
    const cycles = Array.from({length: count}, () =>
      [sell(tradeBase), buy(conservativeBuyBase, measuredQuote)]).flat();
    results.push(await simulate(`flash_${count}_reverse_swap_roundtrips`,
      envelope(4000000n, cycles), owner, watched));
  }

  // LP round trip using a one-unit LP output; permissive maxima exercise rounding safely.
  const lpStage = await simulate('pump_sell_deposit_withdraw_probe',
    [...setup, sell(tradeBase), deposit(1n, 20000000n, measuredQuote), withdraw(1n)], owner, watched);
  results.push(lpStage);
  results.push(await simulate('flash_sell_deposit_withdraw_buy_repay',
    envelope(2000000n, [sell(tradeBase), deposit(1n, 20000000n, measuredQuote),
      withdraw(1n), buy(conservativeBuyBase, measuredQuote)]), owner, watched));
  for (const count of [2, 4, 8]) {
    const lpCycles = Array.from({length: count}, () =>
      [deposit(1n, 20000000n, measuredQuote), withdraw(1n)]).flat();
    results.push(await simulate(`flash_${count}_lp_mint_burn_roundtrips`,
      envelope(2000000n, [sell(tradeBase), ...lpCycles,
        buy(conservativeBuyBase, measuredQuote)]), owner, watched));
  }

  const aliasQuote = sell(tradeBase);
  aliasQuote.keys[defs.sell.accounts.findIndex(x => x.name === 'user_quote_token_account')]
    .pubkey = P(poolRow.quoteVault);
  const aliasBase = sell(tradeBase);
  aliasBase.keys[defs.sell.accounts.findIndex(x => x.name === 'user_base_token_account')]
    .pubkey = P(poolRow.baseVault);
  results.push(await simulate('flash_alias_user_quote_to_pool_quote',
    envelope(1000000n, [aliasQuote, buy(conservativeBuyBase, measuredQuote)]), owner, watched));
  results.push(await simulate('flash_alias_user_base_to_pool_base',
    envelope(1000000n, [aliasBase, buy(conservativeBuyBase, measuredQuote)]), owner, watched));
  results.push(await simulate('flash_buy_before_sell_order',
    envelope(1000000n, [buy(conservativeBuyBase, measuredQuote), sell(tradeBase)]), owner, watched));
  results.push(await simulate('flash_repay_before_pump_roundtrip',
    envelope(1000000n, [sell(tradeBase), buy(conservativeBuyBase, measuredQuote)], 'repay_before_middle'),
    owner, watched));
  results.push(await simulate('pump_roundtrip_before_flash_borrow',
    envelope(1000000n, [sell(tradeBase), buy(conservativeBuyBase, measuredQuote)], 'middle_before_borrow'),
    owner, watched));

  async function valueResidual(inputMint, outputMint, amountRaw) {
    try {
      if (!amountRaw || amountRaw === '0') return null;
      const url = 'https://lite-api.jup.ag/swap/v1/quote?inputMint=' + inputMint.toBase58()
        + '&outputMint=' + outputMint.toBase58() + '&amount=' + amountRaw
        + '&slippageBps=100&restrictIntermediateTokens=true';
      const response = await fetch(url);
      const responseText = await response.text();
      let quote;
      try { quote = JSON.parse(responseText); }
      catch { return {provider: 'Jupiter quote API (read only)', requestedUrl: url,
        fetchedAt: new Date().toISOString(), inputRaw: amountRaw, outputRaw: null,
        contextSlot: null, priceImpactPct: null, route: null,
        error: `HTTP ${response.status}: ${responseText.slice(0, 200)}`}; }
      return {provider: 'Jupiter quote API (read only)', requestedUrl: url,
        fetchedAt: new Date().toISOString(), inputRaw: amountRaw,
        outputRaw: quote.outAmount || null, contextSlot: quote.contextSlot || null,
        priceImpactPct: quote.priceImpactPct || null,
        route: quote.routePlan?.map(x => ({ammKey: x.swapInfo?.ammKey,
          label: x.swapInfo?.label, inAmount: x.swapInfo?.inAmount,
          outAmount: x.swapInfo?.outAmount})) || null,
        error: quote.error || quote.errorCode || (!response.ok ? `HTTP ${response.status}` : null)};
    } catch (error) { return {error: error.message}; }
  }
  const small = results.find(x => x.label === 'flash_swap_roundtrip_small');
  const residual = small?.watched?.find(x => x.address === userQuote.toBase58())
    ?.post?.tokenAmountRaw;
  const residualValuation = await valueResidual(quoteMint, baseMint, residual);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const thinSellResult = results.find(x => x.label === 'thin_pool_one_raw_wsol_sell_in_flash');
  const thinResidual = thinSellResult?.watched?.find(x => x.address === thinUserQuote.toBase58())
    ?.post?.tokenAmountRaw;
  const thinResidualValuation = await valueResidual(thinQuoteMint, thinBaseMint, thinResidual);
  async function dexScreenerSpotValue(inputMint, pairAddress, amountRaw, decimals) {
    try {
      const url = 'https://api.dexscreener.com/latest/dex/tokens/' + inputMint.toBase58();
      const response = await fetch(url);
      const responseText = await response.text();
      let body;
      try { body = JSON.parse(responseText); }
      catch { return {provider: 'DexScreener token API (read only)', requestedUrl: url,
        fetchedAt: new Date().toISOString(), inputRaw: amountRaw, inputDecimals: decimals,
        error: `HTTP ${response.status}: ${responseText.slice(0, 200)}`}; }
      const pair = body.pairs?.find(x => x.chainId === 'solana'
        && x.pairAddress === pairAddress && x.quoteToken?.address === NATIVE_MINT.toBase58());
      if (!pair) return {provider: 'DexScreener token API (read only)', requestedUrl: url,
        fetchedAt: new Date().toISOString(), inputRaw: amountRaw, inputDecimals: decimals,
        error: 'No matching PumpSwap pair quoted against WSOL'};
      const tokenAmount = Number(amountRaw) / 10 ** decimals;
      const estimatedSol = tokenAmount * Number(pair.priceNative);
      return {provider: 'DexScreener token API (read only)', requestedUrl: url,
        fetchedAt: new Date().toISOString(), inputRaw: amountRaw, inputDecimals: decimals,
        pairAddress: pair.pairAddress, dexId: pair.dexId, priceNativeSol: pair.priceNative,
        priceUsd: pair.priceUsd, liquidityUsd: pair.liquidity?.usd ?? null,
        estimatedOutputLamportsAtDisplayedSpotPrice: Math.floor(estimatedSol * 1e9).toString(),
        caveat: 'Displayed spot-price estimate, not an executable quote; underlying venue is PumpSwap.',
        error: response.ok ? null : `HTTP ${response.status}`};
    } catch (error) { return {error: error.message}; }
  }
  const dexScreenerSpotValuation = {
    primaryResidual: await dexScreenerSpotValue(quoteMint, poolRow.address, residual,
      quoteMintInfo.data[44]),
    thinResidual: await dexScreenerSpotValue(thinQuoteMint, thinPoolRow.address, thinResidual,
      thinMintInfos[1].data[44])
  };

  const output = {generatedAt: new Date().toISOString(), simulatedOnly: true,
    liveSubmission: false, transactionVersion: 1, byteLimit: 4096, addressLimit: 64,
    programs: {pumpSwap: PUMP.toBase58(), project0Marginfi: P0.toBase58()},
    sources: {project0: {signature: p0SourceSignature, slot: p0.slot},
      pumpSwap: {signature: pumpSourceSignature, slot: pump.slot}},
    borrower: owner.toBase58(), pool: poolRow,
    thinPool: {...thinPoolRow, observedBaseVaultRaw: thinBaseRaw.toString(),
      observedQuoteVaultRaw: thinQuoteRaw.toString()},
    accounts: {userBase: userBase.toBase58(),
      userQuote: userQuote.toBase58(), userLp: userLp.toBase58(),
      userVolume: userVolume.toBase58(), project0LiquidityVault: borrow.keys[6].pubkey.toBase58(),
      protocolFeeTokenAccount: templateByName.protocol_fee_recipient_token_account.toBase58(),
      coinCreatorVaultAta: templateByName.coin_creator_vault_ata.toBase58(),
      remainingBuybackAccounts: remainingSwapKeys.map(x => x.pubkey.toBase58())},
    balances: {project0AvailableRaw: available.toString(), poolBaseRaw: poolBase.toString(),
      prefundRaw: '20000000'}, pumpThreshold: {
      minimumSuccessfulBaseRaw: hi.toString(), measuredQuoteAtTradeBaseRaw: measuredQuote.toString(),
      tradeBaseRaw: tradeBase.toString(), conservativeBuyBaseRaw: conservativeBuyBase.toString()},
    project0SignerAndDebtBinding: {payer: owner.toBase58(), borrowAuthority: borrow.keys[2].pubkey.toBase58(),
      borrowBank: borrow.keys[3].pubkey.toBase58(), repayBank: repay.keys[3].pubkey.toBase58(),
      destinationAndRepaySource: userBase.toBase58(), exactSamePrincipalRequired: true},
    residualValuation, thinResidualValuation, dexScreenerSpotValuation,
    earlierPoolSpecificBlocker: {pool: 'Fk5MuGv2H3Qpt6AxdhS2KHgDL2os424BvfEoqFNTdv9Y',
      instruction: 'buy_exact_quote_in_v2', attemptedQuoteRawRange: ['1', '1048576'],
      exactError: {InstructionError: [5, {Custom: 6001}]},
      programError: 'ZeroBaseAmount (6001)',
      resolution: 'Selected a verified WSOL-base PumpSwap pool with a fresh landed legacy buy control.'},
    klendZeroFeeComposition: {attempted: false,
      currentConfigEvidence: {
        sourceArtifact: 'klend-jupiter-v1-extremes.json',
        reserve: 'AYL4vEZdGSLdjvVGMMyAa16NNfXXrTqx9P73gwhgcNaX',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decodedFlashLoanFeeSf: '0',
        observedAvailableRaw: '7868315584088',
        successfulNinetyNinePercentBorrowRaw: '7789632497552',
        transactionVersion: 1,
        transactionBytes: 531,
        accountCount: 11,
        unitsConsumed: 52644,
        supplyRestored: true,
        feeVaultDeltaRaw: '0'
      },
      blocker: 'The current-config verified zero-fee KLend control reserve is USDC '
        + '(EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v), while this assigned '
        + 'PumpSwap pool uses WSOL as its base mint (So11111111111111111111111111111111111111112). '
        + 'A same-asset atomic PumpSwap repayment path cannot be constructed without an '
        + 'additional exchange leg, which would no longer isolate PumpSwap.'},
    results};
  fs.writeFileSync(__dirname + '/pumpswap-flashloan-v1-results.json',
    JSON.stringify(output, null, 2) + '\n');
  for (const result of results) console.log(JSON.stringify({label: result.label,
    err: result.err, localError: result.localError?.split('\n')[0], v1Bytes: result.v1Bytes,
    accounts: result.accountCount, instructions: result.instructionCount,
    units: result.unitsConsumed, slot: result.simulationSlot,
    logTail: result.logs?.filter(x => x.includes('Instruction:') || x.includes('Error') ||
      x.includes('failed')).slice(-6)}));
}

main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
