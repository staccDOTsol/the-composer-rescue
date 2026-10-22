#!/usr/bin/env node
'use strict';

// Current-mainnet accounts imported into an isolated Surfpool fork. The only
// writes create a disposable, zero-token outsider fixture on that fork. Every
// candidate is fully signed in memory and passed only to simulateTransaction.
const fs = require('fs');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage,
  VersionedTransaction} = require(`${MODULES}/@solana/web3.js`);
const {getAssociatedTokenAddressSync} = require(`${MODULES}/@solana/spl-token`);
const {encodeV1} = require('./klend-v1-composition.js');

const ROOT = __dirname;
const OUT = `${ROOT}/chnry-usdg-daybreak-provider-jupiter-main-signed-v1.json`;
const FORK = process.env.CHNRY_DAYBREAK_FORK_RPC || 'http://127.0.0.1:9167';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK)) throw new Error('Fork URL must be loopback');
const P = value => new PublicKey(value);
const CHANCERY = P('ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz');
const FLASH = P('jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS');
const LIQUIDITY_PROGRAM = P('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC');
const [LIQUIDITY] = PublicKey.findProgramAddressSync([Buffer.from('liquidity')], LIQUIDITY_PROGRAM);
const TOKEN_2022 = P('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM = P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM = P('11111111111111111111111111111111');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const USDG = P('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH');
const USDV = P('USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk');
const FLASH_RESERVE = P('G4KAenCBfybnZLtVe4LdNrmEtQoW3x93oTowFJUPSvx6');
const FLASH_RATE = P('6iHHKAK9Mqjn57CVmWe4szAPyTH8s8pniXSj6vWaKW5r');
const FLASH_VAULT = P('E1prFSvCtp5ze1hAegjdtN3kQWVoRuSGWLoc8Vj9h4nm');
const FLASH_POSITION = P('5XX3ygaiSj1yxrCxC9neX4Nw3SN4GjUKr2YWgZjfQ2Bj');
const [FLASH_ADMIN] = PublicKey.findProgramAddressSync([Buffer.from('flashloan_admin')], FLASH);
const state = JSON.parse(fs.readFileSync(`${ROOT}/chnry-usdg-current-state.json`, 'utf8'));
const idl = JSON.parse(fs.readFileSync(`${ROOT}/chnry-usdg-source/programs/chancery/idl/idl.json`, 'utf8'));
const outsider = Keypair.generate();
const outsiderUsdg = getAssociatedTokenAddressSync(USDG, outsider.publicKey, false, TOKEN_2022);
const outsiderUsdv = getAssociatedTokenAddressSync(USDV, outsider.publicKey, false, TOKEN_2022);
const named = state.historicalControl.namedAccounts;
const pathwayPolicy = P(named.pathway_policy);
const [outsiderPermission] = PublicKey.findProgramAddressSync([
  Buffer.from('permission'), outsider.publicKey.toBuffer(), Buffer.from([2]), pathwayPolicy.toBuffer(),
], CHANCERY);
const pathId = Buffer.from(state.historicalControl.pathwayIdHex, 'hex');
const config = state.currentHistoricalAccounts.accounts[named.chancery_config].decoded;
const U64 = value => {const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b;};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
let requestId = 0;

async function rpc(method, params) {
  const allowed = new Set(['getAccountInfo', 'getMultipleAccounts', 'getLatestBlockhash',
    'surfnet_setAccount', 'simulateTransaction']);
  if (!allowed.has(method)) throw new Error(`Disallowed RPC method ${method}`);
  const response = await fetch(FORK, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function flashIx(discriminator, amount) {
  return new TransactionInstruction({programId: FLASH, keys: [
    [outsider.publicKey, true, true], [FLASH_ADMIN, false, true], [outsiderUsdg, false, true],
    [USDG, false, false], [FLASH_RESERVE, false, true], [FLASH_POSITION, false, true],
    [FLASH_RATE, false, false], [FLASH_VAULT, false, true], [LIQUIDITY, false, false],
    [LIQUIDITY_PROGRAM, false, false], [TOKEN_2022, false, false], [ATA_PROGRAM, false, false],
    [SYSTEM, false, false], [IX_SYSVAR, false, false],
  ].map(([pubkey, isSigner, isWritable]) => ({pubkey, isSigner, isWritable})),
  data: Buffer.concat([Buffer.from(discriminator), U64(amount)])});
}

function chanceryIx(kind, amount) {
  const spec = idl.instructions.find(ix => ix.name === `${kind}_direct`);
  if (!spec || spec.accounts.length !== 31) throw new Error('Chancery direct IDL unavailable');
  const addresses = [...state.historicalControl.accountList];
  addresses[6] = outsiderPermission.toBase58();
  addresses[15] = outsider.publicKey.toBase58();
  if (kind === 'mint') {
    addresses[7] = outsiderUsdg.toBase58();
    addresses[9] = outsiderUsdv.toBase58();
    addresses[12] = config.mint_authority_pda;
  } else {
    addresses[7] = outsiderUsdv.toBase58();
    addresses[9] = outsiderUsdg.toBase58();
  }
  const keys = spec.accounts.map((account, i) => ({pubkey: P(addresses[i]),
    isSigner: !!account.signer, isWritable: !!account.writable}));
  return new TransactionInstruction({programId: CHANCERY, keys,
    data: Buffer.concat([Buffer.from(spec.discriminator), pathId, U64(amount), U64(amount)])});
}

async function cloneZeroToken(source, target, mint) {
  const sourceAccount = (await rpc('getAccountInfo', [source,
    {encoding: 'base64', commitment: 'processed'}])).value;
  if (!sourceAccount || sourceAccount.owner !== TOKEN_2022.toBase58()) throw new Error('Token source unavailable');
  const data = Buffer.from(sourceAccount.data[0], 'base64');
  if (!data.subarray(0, 32).equals(mint.toBuffer())) throw new Error('Wrong token template mint');
  outsider.publicKey.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(0n, 64);
  data.writeUInt32LE(0, 72); data.fill(0, 76, 108);
  data.writeUInt32LE(0, 109); data.fill(0, 113, 121);
  data.writeBigUInt64LE(0n, 121); data.writeUInt32LE(0, 129); data.fill(0, 133, 165);
  await rpc('surfnet_setAccount', [target.toBase58(), {data: data.toString('hex'),
    executable: false, lamports: Math.max(sourceAccount.lamports, 20_000_000),
    owner: TOKEN_2022.toBase58(), rentEpoch: 0}]);
}

function tokenAmount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function signV1(instructions, blockhash) {
  const encoded = encodeV1(instructions, outsider.publicKey, blockhash);
  const compiled = new TransactionMessage({payerKey: outsider.publicKey,
    recentBlockhash: blockhash, instructions}).compileToV0Message();
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  if (signerOrder.length !== 1 || signerOrder[0] !== outsider.publicKey.toBase58())
    throw new Error(`Unexpected signer set: ${signerOrder.join(',')}`);
  const wire = Buffer.from(encoded.wire);
  const message = wire.subarray(0, wire.length - 64);
  const privateKey = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(outsider.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8'});
  crypto.sign(null, message, privateKey).copy(wire, wire.length - 64);
  const publicKey = crypto.createPublicKey({key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'), outsider.publicKey.toBuffer(),
  ]), format: 'der', type: 'spki'});
  const localEd25519Verified = crypto.verify(null, message, publicKey, wire.subarray(wire.length - 64));
  if (!localEd25519Verified) throw new Error('Local Ed25519 verification failed');
  const decoded = VersionedTransaction.deserialize(wire);
  if (decoded.version !== 1 || decoded.signatures.length !== 1)
    throw new Error('Signed v1 decode failed');
  return {wire, encoded, signerOrder, localEd25519Verified};
}

async function run(label, instructions, watched) {
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const signed = signV1(instructions, blockhash);
  const result = await rpc('simulateTransaction', [signed.wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  return {label, slot: result.context.slot, sigVerify: true, signatureAccepted: true,
    err: result.value.err, computeUnits: result.value.unitsConsumed,
    wire: {version: 1, bytes: signed.encoded.sizeBytes,
      addresses: signed.encoded.addressCount, instructions: signed.encoded.instructionCount,
      signatures: signed.encoded.requiredSignatures, signerOrder: signed.signerOrder,
      localEd25519Verified: signed.localEd25519Verified,
      sha256: sha(signed.wire), within4096Bytes: signed.encoded.sizeBytes <= 4096,
      within64Accounts: signed.encoded.addressCount <= 64},
    postTokenAmounts: Object.fromEntries(watched.map((address, i) =>
      [String(address), tokenAmount(result.value.accounts?.[i])])),
    logs: result.value.logs || [],
  };
}

async function main() {
  await rpc('surfnet_setAccount', [outsider.publicKey.toBase58(), {
    data: '', executable: false, lamports: 20_000_000_000,
    owner: SYSTEM.toBase58(), rentEpoch: 0}]);
  await cloneZeroToken(named.destination_asset_token_account, outsiderUsdg, USDG);
  await cloneZeroToken(named.source_issued_token_account, outsiderUsdv, USDV);
  const watched = [outsiderUsdg, outsiderUsdv, FLASH_VAULT, P(named.reserve_asset_token_account)];
  const beforeResult = await rpc('getMultipleAccounts', [watched.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const before = Object.fromEntries(watched.map((address, i) =>
    [String(address), tokenAmount(beforeResult.value[i])]));
  const outsiderPermissionExists = (await rpc('getAccountInfo', [outsiderPermission.toBase58(),
    {encoding: 'base64', commitment: 'processed'}])).value !== null;
  if (outsiderPermissionExists) throw new Error('Fresh outsider unexpectedly has a permission record');
  if (before[String(outsiderUsdg)] !== '0' || before[String(outsiderUsdv)] !== '0')
    throw new Error('Outsider token fixture must start at zero');
  const amount = 1_000_000_000n;
  const borrow = flashIx([103, 19, 78, 24, 240, 9, 135, 63], amount);
  const repay = flashIx([213, 47, 153, 137, 84, 243, 94, 232], amount);
  const cases = [
    ['flash_pair_control', [borrow, repay]],
    ['flash_pair_100k_control', [flashIx([103, 19, 78, 24, 240, 9, 135, 63],
      100_000_000_000n), flashIx([213, 47, 153, 137, 84, 243, 94, 232],
      100_000_000_000n)]],
    ['flash_mint_redeem_repay_outsider', [borrow, chanceryIx('mint', amount),
      chanceryIx('redeem', amount), repay]],
    ['flash_redeem_mint_repay_outsider', [borrow, chanceryIx('redeem', amount),
      chanceryIx('mint', amount), repay]],
  ];
  const results = [];
  for (const [label, instructions] of cases) {
    const row = await run(label, instructions, watched);
    row.atomicRollback = row.err !== null;
    row.committedEquivalentTokenAmounts = Object.fromEntries(watched.map(address => {
      const key = String(address);
      return [key, row.atomicRollback ? before[key] : row.postTokenAmounts[key] ?? before[key]];
    }));
    row.netCommittedTokenDeltasRaw = Object.fromEntries(watched.map(address => {
      const key = String(address);
      const prior = before[key], after = row.committedEquivalentTokenAmounts[key];
      return [key, prior === null || after === null ? null : (BigInt(after) - BigInt(prior)).toString()];
    }));
    row.chanceryError = row.err?.InstructionError?.[1]?.Custom === 514
      ? {code:514, name:'AccountOwnerMismatch', idlMessage:'invalid account owner',
        canonicalOutsiderPermissionAccountExists:outsiderPermissionExists} : null;
    results.push(row);
    console.log(JSON.stringify({label, err: row.err, bytes: row.wire.bytes,
      addresses: row.wire.addresses, instructions: row.wire.instructions,
      computeUnits: row.computeUnits}));
  }
  const output = {observedAt: new Date().toISOString(), fork: FORK,
    upstream: 'Solana mainnet fork with current account imports',
    safety: {mainnetTransactionsSubmitted: false, forkTransactionsSubmitted: false,
      simulationOnly: true, forkMutation: 'Disposable outsider system account and zero-balance Token-2022 accounts only',
      privateKeyPersisted: false},
    provider: {flashProgram: String(FLASH), liquidityProgram: String(LIQUIDITY_PROGRAM),
      flashAdmin: String(FLASH_ADMIN), mint: String(USDG),
      reserve: String(FLASH_RESERVE), position: String(FLASH_POSITION), vault: String(FLASH_VAULT)},
    outsider: {publicKey: String(outsider.publicKey), usdgAta: String(outsiderUsdg),
      usdvAta: String(outsiderUsdv), permissionPda: String(outsiderPermission)},
    amountRaw: amount.toString(), outsiderPermissionExists, beforeTokenAmounts: before, results};
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUT}`);
}

main().catch(error => {console.error(error.stack || String(error)); process.exitCode = 1;});
