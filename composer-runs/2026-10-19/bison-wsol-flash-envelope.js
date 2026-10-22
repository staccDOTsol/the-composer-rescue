#!/usr/bin/env node
'use strict';

// Signed, simulation-only current-mainnet-fork validation for compatible
// outsider flash-liquidity providers. There is deliberately no send path.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram,
} = require(`${MOD}/@solana/web3.js`);
const {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} = require(`${MOD}/@solana/spl-token`);
const anchor = require(`${MOD}/@coral-xyz/anchor`);
const bsModule = require(`${MOD}/bs58`);
const bs58 = bsModule.default || bsModule;
const DIR = __dirname;
const SOURCE_DIR = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15';
const {encodeV1} = require(path.join(SOURCE_DIR, 'klend-v1-composition.js'));
const OUT = path.join(DIR, 'bison-wsol-flash-envelope-output.json');
const FORK = process.env.FLASH_FORK_RPC || 'http://127.0.0.1:9177';
const UPSTREAM = process.env.RPC || process.env.SOLANA_RPC || process.env.SOLANA_RPC_URL ||
  'https://api.mainnet-beta.solana.com';

const P = (value) => new PublicKey(value);
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const P0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const SAVE = P('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const JUP_FLASH = P('jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF');
const JUP_LIQUIDITY_PROGRAM = P('jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS');
const JUP_LIQUIDITY = P('6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL');
const JUP_ADMIN = P('G1qKidJxv6dxBn7TDEx7KSbvovCJQkwzpXbAHQCZxhrn');
const WSOL = P('So11111111111111111111111111111111111111112');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const P0_WSOL_BANK = P('CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh');
const P0_WSOL_VAULT = P('2eicbpitfJXDwqCuFAmPgDP7t2oUotnAzbGzRKLMgSLe');
const P0_WSOL_AUTH = P('DD3AeAssFvjqTvRTrRAtpfjkBF8FpVKnFuwnMLN9haXD');
const P0_WSOL_ORACLE = P('7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE');
const USDE = P('DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const SAVE_SOURCE = '2qayMSpGb2jDgx4ovSEYSNkpY3nVH622kJ6rTNyWSMBeoTFXPLpWKdNnHoAQ3sK9KrjfaKQMLkNTmvbRLHX5CHtA';
const P0_SOURCE = '2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
const BISON_ROUTE_SOURCE = '3iZaw2tCKtjAHVmT6ddWbYokYm18KhgejPaAG7VyTpAMdBM61hcXF5uEPnPgq8QzdSbUxi4BfQurppWPzYM8jEVU';
const JUP_BORROW_DISC = Buffer.from([103, 19, 78, 24, 240, 9, 135, 63]);
const JUP_REPAY_DISC = Buffer.from([213, 47, 153, 137, 84, 243, 94, 232]);
const JUP = {
  reserve: P('GSadisGhwK2bokEHa6ZyEJsXLXmCYAJreeJ4Wo9NL5Uw'),
  rateModel: P('vNiLDiUi6ur36mF2UxcNDzWNgV8xHmzR6jc4bTHbfLY'),
  vault: P('3V949ufzT2viNuvTNHNmJyRMeof9JBSxZ4qQ3XsHTrb3'),
  position: P('c9j4YxC7NfPAjrBmr6cquda6W4hVvaKCpaZ6NFVzG5h'),
};

const klendCensus = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'klend-zero-fee-census.json')));
const klendReserve = klendCensus.activeZero.find((row) =>
  row.reserve === '4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM');
if (!klendReserve) throw new Error('Pinned zero-fee KLend WSOL reserve missing');
const marginfiIdl = JSON.parse(fs.readFileSync(
  path.join(SOURCE_DIR, 'marginfi-source/fuzz/crucible/idls/marginfi_program.json')));
const jupFlashIdl = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'jup6qf-onchain-flash-idl.json')));
const jupLiquidityIdl = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'jup6qf-onchain-idl.json')));
jupFlashIdl.address = JUP_FLASH.toBase58();
jupLiquidityIdl.address = JUP_LIQUIDITY_PROGRAM.toBase58();
const marginCoder = new anchor.BorshAccountsCoder(marginfiIdl);
const jupFlashCoder = new anchor.BorshAccountsCoder(jupFlashIdl);
const jupLiquidityCoder = new anchor.BorshAccountsCoder(jupLiquidityIdl);
let requestId = 0;

async function rpc(url, method, params) {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params})});
  const body = await response.json();
  if (body.error) throw Object.assign(new Error(`${method}: ${JSON.stringify(body.error)}`),
    {rpcError: body.error});
  return body.result;
}

const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const clone = (ix) => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map((key) => ({...key})), data: Buffer.from(ix.data)});
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function historyIx(tx, index) {
  const message = tx.transaction.message;
  const keys = [...message.accountKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])];
  const header = message.header;
  const staticCount = message.accountKeys.length;
  const writable = (keyIndex) => keyIndex < staticCount
    ? (keyIndex < header.numRequiredSignatures
      ? keyIndex < header.numRequiredSignatures - header.numReadonlySignedAccounts
      : keyIndex < staticCount - header.numReadonlyUnsignedAccounts)
    : keyIndex < staticCount + (tx.meta.loadedAddresses?.writable || []).length;
  const source = message.instructions[index];
  return new TransactionInstruction({programId: P(keys[source.programIdIndex]),
    keys: source.accounts.map((keyIndex) => ({pubkey: P(keys[keyIndex]),
      isSigner: keyIndex < header.numRequiredSignatures, isWritable: writable(keyIndex)})),
    data: Buffer.from(bs58.decode(source.data))});
}

function signV1(encoded, instructions, payer, keypairs, blockhash) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions})
    .compileToV0Message();
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const byAddress = new Map(keypairs.map((keypair) => [keypair.publicKey.toBase58(), keypair]));
  signerOrder.forEach((address, index) => {
    const keypair = byAddress.get(address);
    if (!keypair) throw new Error(`Uncontrolled required signer ${address}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey)
      .copy(signed, signed.length - 64 * encoded.requiredSignatures + index * 64);
  });
  return {signed, signerOrder};
}

function tokenImage(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const image = {owner: account.owner, lamports: String(account.lamports),
    dataLength: data.length, dataSha256: sha256(data)};
  if (account.owner === TOKEN_PROGRAM_ID.toBase58() && data.length >= 72) {
    image.mint = new PublicKey(data.subarray(0, 32)).toBase58();
    image.tokenAuthority = new PublicKey(data.subarray(32, 64)).toBase58();
    image.rawAmount = data.readBigUInt64LE(64).toString();
  }
  return image;
}

function fixedRaw(value) {
  const bytes = Buffer.from(value.value);
  let result = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if (bytes[15] & 0x80) result -= 1n << 128n;
  return result.toString();
}

function decodedImages(accounts, addresses) {
  const byAddress = Object.fromEntries(addresses.map((address, index) =>
    [address.toBase58(), tokenImage(accounts[index])]));
  const decode = (address, coder, name) => {
    const index = addresses.findIndex((item) => item.equals(address));
    const row = accounts[index];
    if (!row) return null;
    try { return coder.decode(name, Buffer.from(row.data[0], 'base64')); }
    catch (error) { return {decodeError: error.message}; }
  };
  const bank = decode(CURRENT.p0Bank, marginCoder, 'Bank');
  const marginAccount = decode(CURRENT.marginAccount, marginCoder, 'MarginfiAccount');
  const jupAdmin = decode(JUP_ADMIN, jupFlashCoder, 'FlashloanAdmin');
  const jupPosition = decode(JUP.position, jupLiquidityCoder, 'UserBorrowPosition');
  return {byAddress,
    p0Bank: bank && !bank.decodeError ? {mint: bank.mint.toBase58(),
      assetShares: fixedRaw(bank.total_asset_shares),
      liabilityShares: fixedRaw(bank.total_liability_shares)} : bank,
    p0Account: marginAccount && !marginAccount.decodeError ? {
      authority: marginAccount.authority.toBase58(), group: marginAccount.group.toBase58(),
      activeBalances: marginAccount.lending_account.balances.filter((balance) => balance.active)
        .map((balance) => ({bank: balance.bank_pk.toBase58(),
          assetShares: String(balance.asset_shares.value),
          liabilityShares: String(balance.liability_shares.value)})),
    } : marginAccount,
    jupAdmin: jupAdmin && !jupAdmin.decodeError ? {
      feeBps: Number(jupAdmin.flashloan_fee), active: !!jupAdmin.is_flashloan_active,
      amountRaw: String(jupAdmin.active_flashloan_amount),
      liquidityProgram: jupAdmin.liquidity_program.toBase58(),
    } : jupAdmin,
    jupPosition: jupPosition && !jupPosition.decodeError ? {
      protocol: jupPosition.protocol.toBase58(), mint: jupPosition.mint.toBase58(),
      amountRaw: String(jupPosition.amount), debtCeilingRaw: String(jupPosition.debt_ceiling),
      maxDebtCeilingRaw: String(jupPosition.max_debt_ceiling), status: Number(jupPosition.status),
    } : jupPosition};
}

const CURRENT = {};

function savePair(templates, authority, destination, amount) {
  const borrow = clone(templates.borrow);
  const repay = clone(templates.repay);
  borrow.keys[1].pubkey = destination;
  repay.keys[0].pubkey = destination;
  // Save's fourth repay account is the optional host-fee receiver. In the
  // successful source it aliases the borrower's destination, so remap both.
  repay.keys[3].pubkey = destination;
  repay.keys[6].pubkey = authority;
  borrow.data.writeBigUInt64LE(amount, 1);
  repay.data.writeBigUInt64LE(amount, 1);
  return {borrow, repay};
}

function klendPair(templates, authority, destination, amount) {
  const borrow = clone(templates.borrow);
  const repay = clone(templates.repay);
  const market = P(klendReserve.market);
  const marketAuthority = PublicKey.findProgramAddressSync([
    Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  for (const ix of [borrow, repay]) {
    for (const [index, pubkey] of Object.entries({0: authority, 1: marketAuthority, 2: market,
      3: P(klendReserve.reserve), 4: WSOL, 5: P(klendReserve.supplyVault),
      6: destination, 7: P(klendReserve.feeVault), 11: TOKEN_PROGRAM_ID})) {
      ix.keys[Number(index)].pubkey = pubkey;
    }
    ix.data.writeBigUInt64LE(amount, 8);
  }
  return {borrow, repay};
}

function p0Set(templates, authority, marginAccount, destination, amount) {
  const start = clone(templates.start);
  const borrow = clone(templates.borrow);
  const repay = clone(templates.repay);
  const end = clone(templates.end);
  start.keys[0].pubkey = marginAccount;
  start.keys[1].pubkey = authority;
  borrow.keys[1].pubkey = marginAccount;
  borrow.keys[2].pubkey = authority;
  borrow.keys[3].pubkey = P0_WSOL_BANK;
  borrow.keys[4].pubkey = destination;
  borrow.keys[5].pubkey = P0_WSOL_AUTH;
  borrow.keys[6].pubkey = P0_WSOL_VAULT;
  borrow.keys[8].pubkey = P0_WSOL_BANK;
  borrow.keys[9].pubkey = P0_WSOL_ORACLE;
  repay.keys[1].pubkey = marginAccount;
  repay.keys[2].pubkey = authority;
  repay.keys[3].pubkey = P0_WSOL_BANK;
  repay.keys[4].pubkey = destination;
  repay.keys[5].pubkey = P0_WSOL_VAULT;
  repay.keys[6].pubkey = TOKEN_PROGRAM_ID;
  end.keys[0].pubkey = marginAccount;
  end.keys[2].pubkey = authority;
  borrow.data.writeBigUInt64LE(amount, 8);
  repay.data.writeBigUInt64LE(amount, 8);
  return {start, borrow, repay, end};
}

function bisonRoute(template, authority, wsolAta, usdcAta, amount) {
  const ix = clone(template);
  for (const index of [1, 10, 22]) ix.keys[index].pubkey = authority;
  for (const index of [2, 3, 14, 27]) ix.keys[index].pubkey = wsolAta;
  for (const index of [15, 26]) ix.keys[index].pubkey = usdcAta;
  ix.data.writeBigUInt64LE(amount, 21);
  // Same-mint route: require at least principal back before lender fees.
  ix.data.writeBigUInt64LE(amount, 29);
  return ix;
}

function jupPair(authority, destination, amount) {
  const keys = [
    {pubkey: authority, isSigner: true, isWritable: true},
    {pubkey: JUP_ADMIN, isSigner: false, isWritable: true},
    {pubkey: destination, isSigner: false, isWritable: true},
    {pubkey: USDE, isSigner: false, isWritable: false},
    {pubkey: JUP.reserve, isSigner: false, isWritable: true},
    {pubkey: JUP.position, isSigner: false, isWritable: true},
    {pubkey: JUP.rateModel, isSigner: false, isWritable: false},
    {pubkey: JUP.vault, isSigner: false, isWritable: true},
    {pubkey: JUP_LIQUIDITY, isSigner: false, isWritable: false},
    {pubkey: JUP_LIQUIDITY_PROGRAM, isSigner: false, isWritable: false},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
    {pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    {pubkey: IX_SYSVAR, isSigner: false, isWritable: false},
  ];
  const make = (disc) => new TransactionInstruction({programId: JUP_FLASH,
    keys: keys.map((key) => ({...key})), data: Buffer.concat([disc, u64(amount)])});
  return {borrow: make(JUP_BORROW_DISC), repay: make(JUP_REPAY_DISC)};
}

function p0Initialize(group, account, authority) {
  return new TransactionInstruction({programId: P0, keys: [
    {pubkey: group, isSigner: false, isWritable: false},
    {pubkey: account, isSigner: true, isWritable: true},
    {pubkey: authority, isSigner: true, isWritable: false},
    {pubkey: authority, isSigner: true, isWritable: true},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
  ], data: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154])});
}

function saveFee(amount) {
  return (amount * 4n + 9_999n) / 10_000n;
}

function compose(kind, amounts, ctx) {
  const includeSave = kind.includes('save');
  const includeKlend = kind.includes('klend');
  const includeP0 = kind.includes('p0');
  const includeJup = kind.includes('jup');
  const save = includeSave ? savePair(ctx.saveTemplates, ctx.authority.publicKey,
    ctx.wsolAta, amounts.save) : null;
  const klend = includeKlend ? klendPair(ctx.klendTemplates, ctx.authority.publicKey,
    ctx.wsolAta, amounts.klend) : null;
  const p0 = includeP0 ? p0Set(ctx.p0Templates, ctx.authority.publicKey,
    ctx.marginAccount.publicKey, ctx.wsolAta, amounts.p0) : null;
  const jup = includeJup ? jupPair(ctx.authority.publicKey, ctx.usdeAta, amounts.jup) : null;
  const route = amounts.route > 0n ? bisonRoute(ctx.bisonRouteTemplate,
    ctx.authority.publicKey, ctx.wsolAta, ctx.usdcAta, amounts.route) : null;
  const instructions = [];
  if (includeP0) instructions.push(p0Initialize(ctx.p0Group, ctx.marginAccount.publicKey,
    ctx.authority.publicKey));
  if (includeSave || includeKlend || includeP0) instructions.push(
    createAssociatedTokenAccountIdempotentInstruction(ctx.authority.publicKey,
      ctx.wsolAta, ctx.authority.publicKey, WSOL));
  if (includeJup) instructions.push(createAssociatedTokenAccountIdempotentInstruction(
    ctx.authority.publicKey, ctx.usdeAta, ctx.authority.publicKey, USDE));
  if (route) instructions.push(createAssociatedTokenAccountIdempotentInstruction(
    ctx.authority.publicKey, ctx.usdcAta, ctx.authority.publicKey, USDC));
  if (includeP0) instructions.push(p0.start);
  if (includeSave) instructions.push(save.borrow);
  if (includeKlend) instructions.push(klend.borrow);
  if (includeJup) instructions.push(jup.borrow);
  if (includeP0) instructions.push(p0.borrow);
  if (route) instructions.push(route);
  if (includeP0) instructions.push(p0.repay);
  if (includeJup) instructions.push(jup.repay);
  const fee = includeSave ? saveFee(amounts.save) : 0n;
  if (includeSave && fee > 0n && !route) {
    instructions.push(SystemProgram.transfer({fromPubkey: ctx.authority.publicKey,
      toPubkey: ctx.wsolAta, lamports: fee}));
    instructions.push(new TransactionInstruction({programId: TOKEN_PROGRAM_ID,
      keys: [{pubkey: ctx.wsolAta, isSigner: false, isWritable: true}], data: Buffer.from([17])}));
  }
  if (includeKlend) instructions.push(klend.repay);
  if (includeSave) instructions.push(save.repay);
  if (includeP0) instructions.push(p0.end);
  p0 && p0.start.data.writeBigUInt64LE(BigInt(instructions.length - 1), 8);
  if (includeKlend) klend.repay.data[16] = instructions.indexOf(klend.borrow);
  if (includeSave) save.repay.data[9] = instructions.indexOf(save.borrow);
  return {instructions, fee};
}

async function importInstructions(instructions) {
  const addresses = [...new Map(instructions.flatMap((ix) => [ix.programId,
    ...ix.keys.map((key) => key.pubkey)]).map((address) => [address.toBase58(), address])).values()];
  for (const address of addresses) {
    await rpc(FORK, 'getAccountInfo', [address.toBase58(),
      {encoding: 'base64', commitment: 'processed'}]);
  }
}

async function getAccounts(addresses) {
  return rpc(FORK, 'getMultipleAccounts', [addresses.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
}

async function simulate(label, kind, amounts, ctx, metadata = {}) {
  const composed = compose(kind, amounts, ctx);
  await importInstructions(composed.instructions);
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1(composed.instructions, ctx.authority.publicKey, blockhash);
  if (encoded.sizeBytes > 4096 || encoded.addressCount > 64)
    throw new Error(`${label}: v1 envelope exceeded`);
  const {signed, signerOrder} = signV1(encoded, composed.instructions, ctx.authority.publicKey,
    [ctx.authority, ctx.marginAccount], blockhash);
  const before = await getAccounts(ctx.watched);
  let result;
  try {
    result = await rpc(FORK, 'simulateTransaction', [signed.toString('base64'), {
      encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: ctx.watched.map(String)},
    }]);
  } catch (error) {
    return {label, kind, amounts: Object.fromEntries(Object.entries(amounts)
      .map(([key, value]) => [key, value.toString()])), metadata,
      transportError: error.message, rpcError: error.rpcError || null,
      wire: {version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
        instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
        sigVerify: true, sha256: sha256(signed)}};
  }
  const after = result.value.accounts || [];
  const beforeDecoded = decodedImages(before.value, ctx.watched);
  const afterDecoded = decodedImages(after, ctx.watched);
  const tokenDeltas = {};
  for (const [role, address] of Object.entries(ctx.roles)) {
    const pre = beforeDecoded.byAddress[address]?.rawAmount;
    const post = afterDecoded.byAddress[address]?.rawAmount;
    tokenDeltas[role] = pre != null && post != null ? (BigInt(post) - BigInt(pre)).toString() : null;
  }
  const row = {label, kind,
    amounts: Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value.toString()])),
    saveExpectedFeeRaw: composed.fee.toString(), metadata,
    slots: {before: before.context.slot, simulation: result.context.slot},
    err: result.value.err || null, unitsConsumed: result.value.unitsConsumed,
    loadedAccountsDataSize: result.value.loadedAccountsDataSize,
    wire: {version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
      instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      signerOrder, sigVerify: true, replaceRecentBlockhash: false, sha256: sha256(signed),
      signedBase64: signed.toString('base64')},
    tokenDeltas, before: beforeDecoded, after: afterDecoded,
    logs: result.value.logs || [], innerInstructions: result.value.innerInstructions || []};
  row.completeRepayment = row.err === null &&
    [...(kind.includes('save') ? ['saveSupply'] : []),
      ...(kind.includes('klend') ? ['klendSupply'] : []),
      ...(kind.includes('p0') ? ['p0Vault'] : []),
      ...(kind.includes('jup') ? ['jupVault'] : [])]
      .every((role) => tokenDeltas[role] === '0');
  fs.writeFileSync(path.join(DIR, `current-flash-provider-stack-${label}.json`),
    `${JSON.stringify(row, null, 2)}\n`);
  console.log(JSON.stringify({label, err: row.err, bytes: row.wire.bytes,
    accounts: row.wire.addresses, instructions: row.wire.instructions,
    units: row.unitsConsumed, completeRepayment: row.completeRepayment,
    tokenDeltas: row.tokenDeltas}));
  return row;
}

async function main() {
  const authority = Keypair.generate();
  const marginAccount = Keypair.generate();
  await rpc(FORK, 'surfnet_setAccount', [authority.publicKey.toBase58(), {
    data: '', executable: false, lamports: 2_000_000_000_000_000,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
  const timeTravelMs = Number(process.env.FLASH_TIME_TRAVEL_MS || 0);
  if (timeTravelMs > 0) {
    await rpc(FORK, 'surfnet_timeTravel', [{absoluteTimestamp: Date.now() + timeTravelMs}]);
  }
  const [saveSource, p0Source, bisonRouteSource] = await Promise.all([
    rpc(UPSTREAM, 'getTransaction', [SAVE_SOURCE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    rpc(UPSTREAM, 'getTransaction', [P0_SOURCE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    rpc(UPSTREAM, 'getTransaction', [BISON_ROUTE_SOURCE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
  ]);
  if (!saveSource || !p0Source || !bisonRouteSource) throw new Error('Source transaction unavailable');
  const saveTemplates = {borrow: historyIx(saveSource, 6), repay: historyIx(saveSource, 12)};
  const p0Templates = {start: historyIx(p0Source, 1), borrow: historyIx(p0Source, 2),
    repay: historyIx(p0Source, 5), end: historyIx(p0Source, 6)};
  const bisonRouteTemplate = historyIx(bisonRouteSource, 3);
  const klendHistory = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'kamino-flash-history.json')));
  const klendSource = klendHistory.hits[0].transaction;
  const klendTemplates = {borrow: historyIx(klendSource, 3), repay: historyIx(klendSource, 13)};
  if (!saveTemplates.borrow.programId.equals(SAVE) || !saveTemplates.repay.programId.equals(SAVE) ||
      !p0Templates.start.programId.equals(P0) || !p0Templates.end.programId.equals(P0) ||
      !klendTemplates.borrow.programId.equals(KLEND) || !klendTemplates.repay.programId.equals(KLEND))
    throw new Error('Historical template mismatch');

  const wsolAta = getAssociatedTokenAddressSync(WSOL, authority.publicKey);
  const usdcAta = getAssociatedTokenAddressSync(USDC, authority.publicKey);
  const usdeAta = getAssociatedTokenAddressSync(USDE, authority.publicKey);
  const p0Group = p0Templates.borrow.keys[0].pubkey;
  CURRENT.p0Bank = P0_WSOL_BANK;
  CURRENT.p0Vault = P0_WSOL_VAULT;
  CURRENT.marginAccount = marginAccount.publicKey;
  CURRENT.saveReserve = saveTemplates.borrow.keys[2].pubkey;
  CURRENT.saveSupply = saveTemplates.borrow.keys[0].pubkey;
  CURRENT.saveFee = saveTemplates.repay.keys[2].pubkey;
  CURRENT.klendReserve = P(klendReserve.reserve);
  CURRENT.klendSupply = P(klendReserve.supplyVault);
  CURRENT.klendFee = P(klendReserve.feeVault);

  const watched = [authority.publicKey, marginAccount.publicKey, wsolAta, usdcAta, usdeAta,
    CURRENT.saveSupply, CURRENT.saveFee, CURRENT.saveReserve,
    CURRENT.klendSupply, CURRENT.klendFee, CURRENT.klendReserve,
    CURRENT.p0Vault, CURRENT.p0Bank, JUP.vault, JUP.reserve, JUP.position, JUP_ADMIN];
  const roles = {attacker: authority.publicKey.toBase58(), marginAccount: marginAccount.publicKey.toBase58(),
    attackerWsol: wsolAta.toBase58(), attackerUsdc: usdcAta.toBase58(),
    attackerUsde: usdeAta.toBase58(), saveSupply: CURRENT.saveSupply.toBase58(),
    saveFee: CURRENT.saveFee.toBase58(), saveReserve: CURRENT.saveReserve.toBase58(),
    klendSupply: CURRENT.klendSupply.toBase58(), klendFee: CURRENT.klendFee.toBase58(),
    klendReserve: CURRENT.klendReserve.toBase58(), p0Vault: CURRENT.p0Vault.toBase58(),
    p0Bank: CURRENT.p0Bank.toBase58(), jupVault: JUP.vault.toBase58(),
    jupReserve: JUP.reserve.toBase58(), jupPosition: JUP.position.toBase58(),
    jupAdmin: JUP_ADMIN.toBase58()};
  const ctx = {authority, marginAccount, wsolAta, usdcAta, usdeAta, p0Group,
    saveTemplates, p0Templates, klendTemplates, bisonRouteTemplate, watched, roles};

  for (const address of watched.filter((address) => ![authority.publicKey, marginAccount.publicKey,
    wsolAta, usdcAta, usdeAta].some((fresh) => fresh.equals(address)))) {
    await rpc(FORK, 'getAccountInfo', [address.toBase58(),
      {encoding: 'base64', commitment: 'processed'}]);
  }
  const current = await getAccounts(watched);
  const currentByAddress = Object.fromEntries(watched.map((address, index) =>
    [address.toBase58(), current.value[index]]));
  const saveReserveData = Buffer.from(currentByAddress[CURRENT.saveReserve]?.data?.[0] || '', 'base64');
  const klendReserveData = Buffer.from(currentByAddress[CURRENT.klendReserve]?.data?.[0] || '', 'base64');
  const p0VaultData = Buffer.from(currentByAddress[CURRENT.p0Vault]?.data?.[0] || '', 'base64');
  if (saveReserveData.length < 179 || klendReserveData.length < 4912 || p0VaultData.length < 72)
    throw new Error('Current provider account unavailable or wrong layout');
  const capacities = {
    saveAvailableRaw: saveReserveData.readBigUInt64LE(171),
    saveSupplyVaultRaw: Buffer.from(currentByAddress[CURRENT.saveSupply].data[0], 'base64')
      .readBigUInt64LE(64),
    klendAvailableRaw: klendReserveData.readBigUInt64LE(224),
    klendSupplyVaultRaw: Buffer.from(currentByAddress[CURRENT.klendSupply].data[0], 'base64')
      .readBigUInt64LE(64),
    klendFlashFeeSf: klendReserveData.readBigUInt64LE(4904),
    p0VaultRaw: p0VaultData.readBigUInt64LE(64),
    jupVaultRaw: Buffer.from(currentByAddress[JUP.vault].data[0], 'base64').readBigUInt64LE(64),
  };
  const decodedCurrent = decodedImages(current.value, watched);
  capacities.jupPositionCeilingRaw = BigInt(decodedCurrent.jupPosition.maxDebtCeilingRaw);
  capacities.jupConfiguredFeeBps = BigInt(decodedCurrent.jupAdmin.feeBps);
  if (capacities.klendFlashFeeSf !== 0n || capacities.jupConfiguredFeeBps !== 0n)
    throw new Error('Expected exact-zero configuration changed');

  const small = {save: 1_000_000n, klend: 1_000_000_000n,
    p0: 100_000_000n, jup: 1_000_000_000n};
  const cases = [];
  cases.push(await simulate('dual_klend_p0_control', 'klend+p0', small, ctx,
    {class: 'two-provider-positive-control'}));
  cases.push(await simulate('triple_save_klend_p0_control', 'save+klend+p0', small, ctx,
    {class: 'three-provider-positive-control'}));
  for (const [suffix, amount] of [['exact', capacities.saveAvailableRaw],
    ['plus_1', capacities.saveAvailableRaw + 1n]]) {
    cases.push(await simulate(`save_capacity_${suffix}_with_klend`, 'save+klend',
      {...small, save: amount}, ctx, {class: 'save-capacity-sweep'}));
  }
  for (const [suffix, amount] of [['exact', capacities.klendAvailableRaw],
    ['plus_1', capacities.klendAvailableRaw + 1n]]) {
    cases.push(await simulate(`klend_capacity_${suffix}_with_p0`, 'klend+p0',
      {...small, klend: amount}, ctx, {class: 'klend-capacity-sweep'}));
  }

  const p0ControlAmount = 100_000_000n;
  const p0One = await simulate('p0_wsol_minimum_positive', 'klend+p0',
    {...small, klend: 1n, p0: p0ControlAmount}, ctx, {class: 'project0-capacity-sweep'});
  cases.push(p0One);
  const p0Exact = await simulate('p0_wsol_vault_exact', 'klend+p0',
    {...small, klend: 1n, p0: capacities.p0VaultRaw}, ctx,
    {class: 'project0-capacity-sweep'});
  cases.push(p0Exact);
  cases.push(await simulate('p0_wsol_vault_plus_1', 'klend+p0',
    {...small, klend: 1n, p0: capacities.p0VaultRaw + 1n}, ctx,
    {class: 'project0-capacity-sweep'}));
  // The utilization boundary moves as interest accrues. A prior same-fork
  // binary search found 504,760,797,122 raw successful at slot 458756615,
  // then the same amount failed 110 slots later. Use a stable lower bound in
  // composed route cases and retain the exact snapshot artifacts separately.
  const p0Usable = p0Exact.err === null ? capacities.p0VaultRaw : 504_000_000_000n;
  cases.push(await simulate('p0_wsol_conservative_usable', 'klend+p0',
    {...small, klend: 1n, p0: p0Usable}, ctx,
    {class: 'project0-current-conservative-capacity'}));
  capacities.p0UsableRaw = p0Usable;

  const observedRouteRaw = 1_998_792_182n;
  const observedP0Raw = 100_000_000n;
  for (const routeRaw of [200_000_000n, 500_000_000n, 1_000_000_000n, 1_500_000_000n]) {
    cases.push(await simulate(`bison_route_two_provider_probe_${routeRaw}`, 'klend+p0',
      {save: 0n, klend: routeRaw - observedP0Raw, p0: observedP0Raw,
        jup: 0n, route: routeRaw}, ctx,
      {class: 'bison-route-size-probe', route: 'Bison WSOL->USDC then independent HBV USDC->WSOL'}));
  }
  cases.push(await simulate('bison_route_two_provider_observed_size', 'klend+p0',
    {save: 0n, klend: observedRouteRaw - observedP0Raw, p0: observedP0Raw,
      jup: 0n, route: observedRouteRaw}, ctx,
    {class: 'bison-route-two-provider-control', route: 'Bison WSOL->USDC then independent HBV USDC->WSOL'}));
  cases.push(await simulate('bison_route_three_provider_observed_size', 'save+klend+p0',
    {save: 3n, klend: observedRouteRaw - observedP0Raw - 3n, p0: observedP0Raw,
      jup: 0n, route: observedRouteRaw}, ctx,
    {class: 'bison-route-three-provider-control', route: 'Bison WSOL->USDC then independent HBV USDC->WSOL'}));

  cases.push(await simulate('dual_klend_p0_maximum', 'klend+p0',
    {...small, klend: capacities.klendAvailableRaw, p0: p0Usable}, ctx,
    {class: 'maximum-two-provider-envelope'}));
  cases.push(await simulate('triple_save_klend_p0_maximum', 'save+klend+p0',
    {save: capacities.saveAvailableRaw, klend: capacities.klendAvailableRaw,
      p0: p0Usable, jup: 0n}, ctx, {class: 'maximum-three-provider-envelope'}));

  const output = {generatedAt: new Date().toISOString(),
    environment: 'isolated Surfpool current-mainnet fork; signed v1 simulateTransaction only',
    safety: {mainnetTransactionsSubmitted: false, sendTransactionPathPresent: false,
      forkStateMutation: 'Only the fresh outsider system account received synthetic lamports; lender state was imported read-only and simulation state did not persist.'},
    forkRpc: FORK, upstreamSourceSlots: {save: saveSource.slot, project0: p0Source.slot,
      klend: klendHistory.hits[0].slot}, forkBaselineSlot: current.context.slot,
    outsider: {authority: authority.publicKey.toBase58(), marginAccount: marginAccount.publicKey.toBase58(),
      wsolAta: wsolAta.toBase58(), usdcAta: usdcAta.toBase58(), usdeAta: usdeAta.toBase58(),
      syntheticLamports: '2000000000000000', privateKeysPersisted: false},
    programs: {save: SAVE.toBase58(), klend: KLEND.toBase58(), project0: P0.toBase58(),
      jupiterFlash: JUP_FLASH.toBase58(), jupiterLiquidity: JUP_LIQUIDITY_PROGRAM.toBase58()},
    accounts: Object.fromEntries(Object.entries(roles)),
    capacities: Object.fromEntries(Object.entries(capacities).map(([key, value]) => [key, value.toString()])),
    feeAndGateSemantics: {
      save: '4 bps runtime control; fee = ceil(principal*4/10000), minimum successful principal 3 raw, one borrow per transaction, indexed same-transaction repay required',
      klend: 'flashLoanFeeSf is exactly zero for the selected reserve; one borrow per transaction; indexed same-transaction repay required',
      project0: 'no protocol flash fee; start/end flash session; authority-owned marginfi account required; borrow capacity can be below token-vault balance due bank controls',
      jupiter: 'FlashloanAdmin fee exactly zero bps; minimum 1000 raw; one active wrapper loan; exact matching later repay and bound position ceiling',
    },
    currentDecoded: decodedCurrent,
    cases};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, generatedAt: output.generatedAt,
    capacities: output.capacities, cases: cases.map((row) => ({label: row.label,
      err: row.err || null, transportError: row.transportError || null,
      bytes: row.wire?.bytes, accounts: row.wire?.addresses,
      units: row.unitsConsumed, completeRepayment: row.completeRepayment}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
