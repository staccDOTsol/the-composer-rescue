#!/usr/bin/env node
'use strict';
// Signed, read-only mainnet-beta simulation. No send/broadcast method is present.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage} = require(MOD + '@solana/web3.js');
const spl = require(MOD + '@solana/spl-token');
const bs58mod = require(MOD + 'bs58');
const bs58 = bs58mod.default || bs58mod;
const {encodeV1} = require('./klend-v1-composition.js');
const P = x => new PublicKey(x);
const DIR = __dirname;
const PROGRAM = P('8ybMhmtJb1VS6cqV4bPapvEUCRg3EGGrjpNhkLBPezA7');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const DEPOSIT_SIG = '3nTDaJTxBYAPo7w5UZDJuoEYnavwCBCmVn2kKpnigbjL2Qsipj54GJD6NSQ2Vuizi6ao5cjoHxHFYMo3G2LA1mMW';
const WITHDRAW_SIG = '4bShjuw3Xhc76sgXF2SYLFSm9s8C4n2K4bmNZSURLawUa2fbADV1V6UMbJPaPhvAoiJAFZbLoxC4yiKNFGwcTzw8';
const secret = JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'));
if (!Array.isArray(secret) || secret.length !== 64 || !secret.every(x => Number.isInteger(x) && x >= 0 && x <= 255))
  throw Error('hooked keypair invalid');
const signer = Keypair.fromSecretKey(Uint8Array.from(secret));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
if (!url) throw Error('RPC unavailable');
const idl = JSON.parse(fs.readFileSync(path.join(DIR, '8yb-onchain-idl.json'), 'utf8'));
const reserve = JSON.parse(fs.readFileSync(path.join(DIR, 'klend-zero-fee-census.json'), 'utf8'))
  .activeZero.find(x => x.reserve === 'AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z');
if (!reserve || reserve.mint !== USDC.toBase58() || reserve.flashFeeSf !== '0') throw Error('zero-fee USDC reserve unavailable');
const USER_USDC = spl.getAssociatedTokenAddressSync(USDC, signer.publicKey);
const lma = PublicKey.findProgramAddressSync([Buffer.from('lma'), P(reserve.market).toBuffer()], KLEND)[0];
let requestId = 0;
async function rpc(method, params) {
  if (!['getTransaction', 'getMultipleAccounts', 'getLatestBlockhash', 'simulateTransaction'].includes(method))
    throw Error('RPC method not allowlisted');
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params})});
  const j = await r.json();
  if (!r.ok || j.error) throw Error(`${method}: ${j.error?.code || r.status} ${j.error?.message || ''}`);
  return j.result;
}
function assert(x, label) { if (!x) throw Error(`Validation failed: ${label}`); }
function histFlashIx(index) {
  const sample = JSON.parse(fs.readFileSync(path.join(DIR, 'kamino-flash-history.json'), 'utf8')).hits[0].transaction;
  const msg = sample.transaction.message;
  const loaded = sample.meta.loadedAddresses || {writable: [], readonly: []};
  const all = [...msg.accountKeys, ...loaded.writable, ...loaded.readonly];
  const h = msg.header;
  const writable = i => i < msg.accountKeys.length ? i < h.numRequiredSignatures ?
    i < h.numRequiredSignatures - h.numReadonlySignedAccounts :
    i < msg.accountKeys.length - h.numReadonlyUnsignedAccounts :
    i < msg.accountKeys.length + loaded.writable.length;
  const x = msg.instructions[index];
  return new TransactionInstruction({programId: P(all[x.programIdIndex]),
    keys: x.accounts.map(i => ({pubkey: P(all[i]), isSigner: i < h.numRequiredSignatures,
      isWritable: writable(i)})), data: Buffer.from(bs58.decode(x.data))});
}
function flash(template, amount, borrowIndex) {
  const keys = template.keys.map(x => ({...x}));
  const replacements = {0: signer.publicKey, 1: lma, 2: P(reserve.market), 3: P(reserve.reserve),
    4: USDC, 5: P(reserve.supplyVault), 6: USER_USDC, 7: P(reserve.feeVault),
    11: spl.TOKEN_PROGRAM_ID};
  for (const [i, address] of Object.entries(replacements)) keys[Number(i)].pubkey = address;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (borrowIndex !== undefined) data[16] = borrowIndex;
  return new TransactionInstruction({programId: KLEND, keys, data});
}
function histRouteIx(tx, type, amount) {
  assert(tx && tx.meta.err === null, `${type} historical success`);
  const raw = tx.transaction.message.instructions.find(x => x.programId === PROGRAM.toBase58());
  assert(raw, `${type} historical instruction`);
  const ids = tx.transaction.message.accountKeys;
  const meta = new Map(ids.map(x => [x.pubkey, x]));
  const old = raw.accounts;
  const parsed = idl.instructions.find(x => x.name === `perena_${type}`);
  const data = Buffer.from(bs58.decode(raw.data));
  assert(data.subarray(0, 8).equals(Buffer.from(parsed.discriminator)), `${type} discriminator`);
  assert(old[1] === USDC.toBase58() && old[5] === '8ARQDiMfCHsPZDpVNjoJPmRom8Mp2peE8k1dZntSZ7RP', `${type} mints`);
  const vaultId = P(data.subarray(8, 40));
  const vault = PublicKey.findProgramAddressSync([Buffer.from('vault'), vaultId.toBuffer()], PROGRAM)[0];
  assert(old[7] === vault.toBase58(), `${type} vault PDA`);
  const internalProgramIndex = parsed.accounts.findIndex(x => x.name === 'internal_token_program');
  assert(internalProgramIndex >= 0, `${type} internal token program role`);
  const receiptAta = spl.getAssociatedTokenAddressSync(P(old[5]), signer.publicKey, false, P(old[internalProgramIndex]));
  const oldUserAta = spl.getAssociatedTokenAddressSync(P(old[5]), P(old[0]), false, P(old[internalProgramIndex]));
  assert(old[6] === oldUserAta.toBase58(), `${type} source receipt ATA`);
  assert(old[2] === spl.getAssociatedTokenAddressSync(USDC, P(old[0])).toBase58(), `${type} source USDC ATA`);
  const replacements = new Map([[old[0], signer.publicKey.toBase58()], [old[2], USER_USDC.toBase58()],
    [old[6], receiptAta.toBase58()]]);
  const keys = old.map(address => ({pubkey: P(replacements.get(address) || address),
    isSigner: !!meta.get(address)?.signer, isWritable: !!meta.get(address)?.writable}));
  assert(keys.filter(x => x.isSigner).length === 1 && keys[0].pubkey.equals(signer.publicKey), `${type} only user signs`);
  data.writeBigUInt64LE(amount, 40);
  return {ix: new TransactionInstruction({programId: PROGRAM, keys, data}),
    historicalSlot: tx.slot, historicalPayloadBytes: Buffer.from(bs58.decode(raw.data)).length,
    receiptAta, vault, vaultId, oldAmountRaw: Buffer.from(bs58.decode(raw.data)).readBigUInt64LE(40).toString(),
    extraAccounts: old.length - parsed.accounts.length};
}
function signV1(ixs, blockhash) {
  const e = encodeV1(ixs, signer.publicKey, blockhash);
  const compiled = new TransactionMessage({payerKey: signer.publicKey, recentBlockhash: blockhash,
    instructions: ixs}).compileToV0Message();
  assert(e.requiredSignatures === 1 && compiled.staticAccountKeys[0].equals(signer.publicKey), 'single hooked signer');
  const wire = Buffer.from(e.wire);
  const key = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(signer.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8'});
  crypto.sign(null, wire.subarray(0, wire.length - 64), key).copy(wire, wire.length - 64);
  return {wire, e, compiled};
}
function amountOf(info) {return info?.data ? Buffer.from(info.data[0], 'base64').readBigUInt64LE(64).toString() : null;}
function mintSupply(info) {return info?.data ? Buffer.from(info.data[0], 'base64').readBigUInt64LE(36).toString() : null;}
function reserveAvailable(info) {return info?.data ? Buffer.from(info.data[0], 'base64').readBigUInt64LE(224).toString() : null;}
function decodeInner(sim, compiled) {
  const keys = compiled.staticAccountKeys.map(x => x.toBase58());
  const failedOuterIndex = sim.value.err?.InstructionError?.[0];
  return (sim.value.innerInstructions || []).flatMap(group => (group.instructions || []).map(ix => {
    if (ix.parsed?.info) {
      const info = ix.parsed.info;
      const raw = info.tokenAmount?.amount || info.amount || null;
      return {outerIndex: group.index, completedBeforeFailure: failedOuterIndex == null || group.index < failedOuterIndex,
        program: ix.programId,
        op: ix.parsed.type, amountRaw: raw, mint: info.mint || null,
        source: info.source || null, destination: info.destination || info.account || null};
    }
    const program = keys[ix.programIdIndex];
    const bytes = ix.data ? Buffer.from(bs58.decode(ix.data)) : null;
    const token = program === spl.TOKEN_PROGRAM_ID.toBase58() || program === spl.TOKEN_2022_PROGRAM_ID.toBase58();
    const op = token && bytes?.length ? bytes[0] : null;
    const raw = token && [3, 7, 8, 12, 14, 15].includes(op) && bytes.length >= 9 ? bytes.readBigUInt64LE(1).toString() : null;
    return {outerIndex: group.index, completedBeforeFailure: failedOuterIndex == null || group.index < failedOuterIndex,
      program, op, amountRaw: raw,
      accounts: ix.accounts?.map(i => keys[i]) || []};
  })).filter(x => x.amountRaw !== null);
}
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(x => x.split('=')));
  const depositAmount = BigInt(args['--deposit'] || '1000000000');
  const borrowAmount = BigInt(args['--borrow'] || depositAmount.toString());
  const burnAmount = BigInt(args['--burn'] || '900000000');
  assert(depositAmount > 0n && borrowAmount >= depositAmount && burnAmount > 0n, 'amounts');
  const [depHist, wdHist] = await Promise.all([DEPOSIT_SIG, WITHDRAW_SIG].map(s =>
    rpc('getTransaction', [s, {encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed'}])));
  const dep = histRouteIx(depHist, 'deposit', depositAmount);
  const wd = histRouteIx(wdHist, 'withdraw', burnAmount);
  assert(dep.vault.equals(wd.vault) && dep.receiptAta.equals(wd.receiptAta) && dep.vaultId.equals(wd.vaultId), 'same vault and receipt');
  const receiptAta = dep.receiptAta;
  const setup = spl.createAssociatedTokenAccountIdempotentInstruction(signer.publicKey,
    receiptAta, signer.publicKey, P('8ARQDiMfCHsPZDpVNjoJPmRom8Mp2peE8k1dZntSZ7RP'), spl.TOKEN_2022_PROGRAM_ID);
  const borrow = flash(histFlashIx(3), borrowAmount);
  const repay = flash(histFlashIx(13), borrowAmount, 1);
  const instructions = [setup, borrow, dep.ix, wd.ix, repay];
  const watched = [USER_USDC.toBase58(), receiptAta.toBase58(), dep.ix.keys[4].pubkey.toBase58(),
    dep.ix.keys[3].pubkey.toBase58(), dep.ix.keys[13].pubkey.toBase58(),
    dep.ix.keys[5].pubkey.toBase58(), reserve.supplyVault, reserve.feeVault, reserve.reserve];
  const pre = await rpc('getMultipleAccounts', [watched, {encoding: 'base64', commitment: 'confirmed'}]);
  const rawReserve = Buffer.from(pre.value[8].data[0], 'base64');
  assert(rawReserve.readBigUInt64LE(4904) === 0n, 'current KLend flash fee zero');
  assert(BigInt(reserveAvailable(pre.value[8])) > borrowAmount, 'current reserve liquidity');
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const signed = signV1(instructions, blockhash);
  const output = {generatedAt: new Date().toISOString(), network: 'mainnet-beta',
    method: 'simulateTransaction', sigVerify: true, broadcast: false,
    signer: signer.publicKey.toBase58(), depositSignature: DEPOSIT_SIG,
    depositHistoricalSlot: dep.historicalSlot, withdrawSignature: WITHDRAW_SIG,
    withdrawHistoricalSlot: wd.historicalSlot, depositHistoricalPayloadBytes: dep.historicalPayloadBytes,
    withdrawHistoricalPayloadBytes: wd.historicalPayloadBytes, withdrawExtraAccounts: wd.extraAccounts,
    vault: dep.vault.toBase58(), receiptAta: receiptAta.toBase58(),
    borrowRaw: borrowAmount.toString(), depositRaw: depositAmount.toString(), burnRaw: burnAmount.toString(),
    reserve: reserve.reserve, flashFeeSf: '0', preSlot: pre.context.slot,
    packet: {version: 1, bytes: signed.e.sizeBytes, equivalentV0Bytes: signed.e.v0Bytes,
      addressCount: signed.e.addressCount, instructionCount: signed.e.instructionCount,
      requiredSignatures: signed.e.requiredSignatures, sha256: crypto.createHash('sha256').update(signed.wire).digest('hex')},
    watched: watched.map((address, i) => ({address, role: ['signerUsdc', 'signerReceipt', 'vaultExternal',
      'vaultUsdc', 'perenaYieldingUsdc', 'receiptMint', 'lenderSupply', 'lenderFee', 'lenderReserve'][i],
      preRaw: i === 5 ? mintSupply(pre.value[i]) : i === 8 ? reserveAvailable(pre.value[i]) : amountOf(pre.value[i])})),
  };
  if (!process.argv.includes('--compile-only')) {
    const sim = await rpc('simulateTransaction', [signed.wire.toString('base64'), {
      encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed',
      innerInstructions: true, accounts: {encoding: 'base64', addresses: watched},
    }]);
    output.simulationSlot = sim.context.slot;
    output.err = sim.value.err;
    output.unitsConsumed = sim.value.unitsConsumed;
    output.logs = sim.value.logs;
    output.innerInstructions = sim.value.innerInstructions || null;
    output.simulationAccountReturnCount = sim.value.accounts?.length || 0;
    output.innerTokenMovements = decodeInner(sim, signed.compiled);
    output.watched = output.watched.map((row, i) => ({...row,
      postRaw: sim.value.err ? null : i === 5 ? mintSupply(sim.value.accounts?.[i]) :
        i === 8 ? reserveAvailable(sim.value.accounts?.[i]) : amountOf(sim.value.accounts?.[i])}));
  }
  const suffix = process.argv.includes('--compile-only') ? 'compile' : `sim-${depositAmount}-${burnAmount}`;
  const outfile = path.join(DIR, `8yb-perena-flash-${suffix}.json`);
  fs.writeFileSync(outfile, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({file: path.basename(outfile), packet: output.packet, err: output.err,
    unitsConsumed: output.unitsConsumed, innerTokenMovements: output.innerTokenMovements,
    errorLogs: output.logs?.filter(x => /Error|failed|insufficient|Instruction:/.test(x)).slice(-16)}));
}
main().catch(e => {console.error(e.stack || String(e)); process.exitCode = 1;});
