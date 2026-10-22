#!/usr/bin/env node
'use strict';

// Read-only/static construction audit. Fetches current accounts but never signs,
// simulates, or submits a transaction.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const M = '../2026-10-15/onre-harness/node_modules/';
const {Connection, PublicKey, TransactionInstruction} = require(M + '@solana/web3.js');
const spl = require(M + '@solana/spl-token');
const bs58Package = require(M + 'bs58');
const bs58 = bs58Package.default || bs58Package;
const {
  Hadron, HADRON_PROGRAM_ID, decodeCurveUpdates,
} = require('./hadron-sdk/package/dist/index.js');
const {encodeV1} = require('../2026-10-15/klend-v1-composition.js');

const P = x => new PublicKey(x);
const POOL = P('rQsUkcKpia3v3VykWVNZWALuYehNZSTTjDa7qJ3oxWs');
const DGLD = P('dg1dmo6NZNagkwB6EAfUeaco6CFXFLRhb1KCrsqXTVz');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WALLET = P('331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');

const row = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8')
  .split(/\r?\n/).find(x => /^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if (!row) throw new Error('SOLANA_RPC missing');
const rpcUrl = row.slice(row.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
const connection = new Connection(rpcUrl, 'confirmed');

function historyIx(sample, index) {
  const msg = sample.transaction.message;
  const loaded = sample.meta.loadedAddresses || {writable: [], readonly: []};
  const all = [...msg.accountKeys, ...loaded.writable, ...loaded.readonly];
  const h = msg.header;
  const writable = i => i < msg.accountKeys.length ?
    i < h.numRequiredSignatures ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts :
      i < msg.accountKeys.length - h.numReadonlyUnsignedAccounts :
    i < msg.accountKeys.length + loaded.writable.length;
  const x = msg.instructions[index];
  return new TransactionInstruction({
    programId: P(all[x.programIdIndex]),
    keys: x.accounts.map(i => ({
      pubkey: P(all[i]), isSigner: i < h.numRequiredSignatures, isWritable: writable(i),
    })),
    data: Buffer.from(bs58.decode(x.data)),
  });
}

function flash(template, reserve, amount, borrowIndex) {
  const market = P(reserve.market);
  const lma = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  const keys = template.keys.map(k => ({...k}));
  const replacements = {
    0: WALLET, 1: lma, 2: market, 3: P(reserve.reserve), 4: USDC,
    5: P(reserve.supplyVault), 6: spl.getAssociatedTokenAddressSync(USDC, WALLET),
    7: P(reserve.feeVault), 11: spl.TOKEN_PROGRAM_ID,
  };
  for (const [i, key] of Object.entries(replacements)) keys[Number(i)].pubkey = key;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (borrowIndex !== undefined) data[16] = borrowIndex;
  return new TransactionInstruction({programId: KLEND, keys, data});
}

async function main() {
  const genesis = await connection.getGenesisHash();
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('wrong cluster');
  const startSlot = await connection.getSlot('confirmed');
  const hadron = await Hadron.load(connection, POOL);
  const mintInfo = await connection.getAccountInfo(DGLD, 'confirmed');
  const mint = spl.unpackMint(DGLD, mintInfo, spl.TOKEN_2022_PROGRAM_ID);
  const vaultInfo = await connection.getAccountInfo(hadron.addresses.vaultX, 'confirmed');
  const vault = spl.unpackAccount(hadron.addresses.vaultX, vaultInfo, spl.TOKEN_2022_PROGRAM_ID);
  const curveUpdatesInfo = await connection.getAccountInfo(hadron.addresses.curveUpdates, 'confirmed');
  const curveUpdates = decodeCurveUpdates(curveUpdatesInfo.data);
  const fee = spl.getTransferFeeConfig(mint);
  const pausable = spl.getPausableConfig(mint);
  const permanentDelegate = spl.getPermanentDelegate(mint);
  const withheld = spl.getTransferFeeAmount(vault);
  const dgldAta = spl.getAssociatedTokenAddressSync(DGLD, WALLET, false, spl.TOKEN_2022_PROGRAM_ID);
  const usdcAta = spl.getAssociatedTokenAddressSync(USDC, WALLET);
  const [dgldAtaInfo, usdcAtaInfo] = await connection.getMultipleAccountsInfo([dgldAta, usdcAta], 'confirmed');

  const history = JSON.parse(fs.readFileSync(path.join(__dirname, '../2026-10-15/kamino-flash-history.json'), 'utf8'));
  const sample = history.hits[0].transaction;
  const reserve = JSON.parse(fs.readFileSync(path.join(__dirname, '../2026-10-15/klend-zero-fee-census.json'), 'utf8'))
    .activeZero.find(x => x.reserve === 'AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z');
  if (!reserve) throw new Error('KLend zero-fee USDC reserve not found in census');
  const amount = 1_000_000n;
  const setup = dgldAtaInfo ? [] : [spl.createAssociatedTokenAccountIdempotentInstruction(
    WALLET, dgldAta, WALLET, DGLD, spl.TOKEN_2022_PROGRAM_ID,
  )];
  const borrow = flash(historyIx(sample, 3), reserve, amount);
  const buy = hadron.swap(WALLET, {isX: false, amountIn: amount, minOut: 0n});
  const repay = flash(historyIx(sample, 13), reserve, amount, setup.length);
  const ixs = [...setup, borrow, buy, repay];
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const encoded = encodeV1(ixs, WALLET, blockhash);
  const remainingByteCapacity = 4096 - encoded.sizeBytes;
  const remainingAccountCapacity = 64 - encoded.addressCount;
  const output = {
    observedAtUtc: new Date().toISOString(), genesis, startSlot,
    endSlot: await connection.getSlot('confirmed'), noTransactions: true,
    program: HADRON_PROGRAM_ID.toBase58(), pool: POOL.toBase58(), sdkVersion: '0.1.9',
    wallet: {publicKey: WALLET.toBase58(), lamports: await connection.getBalance(WALLET, 'confirmed'),
      atas: {dgld: {address: dgldAta.toBase58(), exists: Boolean(dgldAtaInfo)},
        usdc: {address: usdcAta.toBase58(), exists: Boolean(usdcAtaInfo)}}},
    token2022: {
      mint: DGLD.toBase58(), mintDataLength: mintInfo.data.length,
      mintExtensions: spl.getExtensionTypes(mint.tlvData).map(id => ({id,
        name: Object.entries(spl.ExtensionType).find(([, value]) => value === id)?.[0]})),
      transferFee: fee && {
        authority: fee.transferFeeConfigAuthority?.toBase58(),
        withdrawWithheldAuthority: fee.withdrawWithheldAuthority?.toBase58(),
        withheldAmount: fee.withheldAmount.toString(),
        older: {epoch: fee.olderTransferFee.epoch.toString(),
          basisPoints: fee.olderTransferFee.transferFeeBasisPoints,
          maximumFee: fee.olderTransferFee.maximumFee.toString()},
        newer: {epoch: fee.newerTransferFee.epoch.toString(),
          basisPoints: fee.newerTransferFee.transferFeeBasisPoints,
          maximumFee: fee.newerTransferFee.maximumFee.toString()},
      },
      pausable: pausable && {authority: pausable.authority?.toBase58(), paused: pausable.paused},
      permanentDelegate: permanentDelegate?.delegate?.toBase58(),
      transferHook: null,
      vault: {address: hadron.addresses.vaultX.toBase58(), amount: vault.amount.toString(),
        dataLength: vaultInfo.data.length,
        extensions: spl.getExtensionTypes(vault.tlvData).map(id => ({id,
          name: Object.entries(spl.ExtensionType).find(([, value]) => value === id)?.[0]})),
        withheldAmount: withheld?.withheldAmount.toString() || '0'},
    },
    hadronSwapInstruction: {
      direction: 'USDC->DGLD', dataBytes: buy.data.length, accountMetas: buy.keys.length,
      signerMetas: buy.keys.filter(x => x.isSigner).map(x => x.pubkey.toBase58()),
      accounts: buy.keys.map((x, index) => ({index, pubkey: x.pubkey.toBase58(),
        signer: x.isSigner, writable: x.isWritable})),
    },
    curveUpdateQueue: {
      address: hadron.addresses.curveUpdates.toBase58(),
      authority: curveUpdates.authority.toBase58(), sequence: curveUpdates.sequence.toString(),
      numOps: curveUpdates.numOps,
      ops: curveUpdates.ops.map(op => ({curveType: op.curveType, opKind: op.opKind,
        pointIndex: op.pointIndex, interpolation: op.interpolation,
        amountIn: op.amountIn.toString(), priceFactorQ32: op.priceFactorQ32.toString(),
        targetSlot: op.targetSlot, expectedXIn: op.expectedXIn.toString()})),
      note: 'The swap instruction passes this account writable. SDK-side static quote state alone is therefore insufficient if numOps is nonzero.',
    },
    baselineEnvelope: {
      description: 'optional DGLD ATA creation -> zero-fee KLend USDC borrow -> Hadron USDC-to-DGLD swap -> KLend repayment; no independent exit included',
      instructionCount: encoded.instructionCount, addressCount: encoded.addressCount,
      writableCount: encoded.writableCount, requiredSignatures: encoded.requiredSignatures,
      sizeBytes: encoded.sizeBytes, equivalentV0Bytes: encoded.v0Bytes,
      remainingByteCapacity, remainingAccountCapacity,
      computeLimit: encoded.config.computeLimit, loadedAccountDataLimit: encoded.config.dataLimit,
      sha256UnsignedZeroSignatureWire: crypto.createHash('sha256').update(encoded.wire).digest('hex'),
      simulated: false,
      simulationGate: 'No current after-cost positive independent-exit candidate was supplied to this branch.',
    },
    caveats: [
      'The baseline envelope deliberately excludes an independent exit, so its byte/account headroom is necessary but not sufficient for a complete route.',
      'The DGLD permanent delegate and pausable authorities are privileged mint controls; they are not outsider capabilities.',
      'No transaction was signed, simulated, or broadcast by this script.',
    ],
  };
  fs.writeFileSync(path.join(__dirname, 'hadron-sdk-envelope-audit.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({startSlot: output.startSlot, endSlot: output.endSlot,
    swapMetas: output.hadronSwapInstruction.accountMetas,
    baselineEnvelope: output.baselineEnvelope, token2022: output.token2022}, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
