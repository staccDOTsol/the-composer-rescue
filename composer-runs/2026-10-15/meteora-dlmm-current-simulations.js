#!/usr/bin/env node
'use strict';

// Read-only v1 simulations for current Meteora DLMM value-moving controls and
// adversarial account/order mutations. No signatures are verified and no
// transaction is submitted.

const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, TransactionInstruction, TransactionMessage, MessageV1, VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const ENV = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC = ENV.HEAVY_RPC_URL || ENV.RPC_URL;
const CONNECTION = new Connection(RPC, 'confirmed');
const PROGRAM = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const OUTSIDER = new PublicKey('ACiDHb2zjBY3jWRTRFGG9m3KDzYEtTns2KYXfpK1eG1j');
const OUT = process.env.OUT || '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-current-simulations.json';
const SOURCES = JSON.parse(fs.readFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-control-signatures.json'));
const TOP_SOURCES = JSON.parse(fs.readFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-top-controls.json'));
const CUSTODY = JSON.parse(fs.readFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-current-custody.json'));
const DLMM = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@meteora-ag/dlmm');
const SPL = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const TARGETS = {
  swap2: { discriminator: '414b3f4ceb5b5b88', signer: 10, pair: 0, reserveX: 2, reserveY: 3, userX: 4, userY: 5, mintX: 6, mintY: 7, tokenProgramX: 11, tokenProgramY: 12 },
  claimFee2: { discriminator: '70bf65ab1c907fbb', signer: 2, pair: 0, position: 1, reserveX: 3, reserveY: 4, userX: 5, userY: 6, mintX: 7, mintY: 8, tokenProgramX: 9, tokenProgramY: 10 },
  claimReward2: { discriminator: 'be037f77b2579db7', signer: 2, pair: 0, position: 1, reserveX: 3, userX: 5, mintX: 4, tokenProgramX: 6 },
  removeLiquidityByRange2: { discriminator: 'cc02c391359191cd', signer: 9, pair: 1, position: 0, reserveX: 5, reserveY: 6, userX: 3, userY: 4, mintX: 7, mintY: 8, tokenProgramX: 10, tokenProgramY: 11 },
  withdrawProtocolFee: { discriminator: '9ec99ebd215da267', signer: 8, pair: 0, reserveX: 1, reserveY: 2, mintX: 3, mintY: 4, userX: 5, userY: 6, tokenProgramX: 9, tokenProgramY: 10 },
};

function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function serializeV1(payer, blockhash, instructions) {
  const compiled = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  if (compiled.addressTableLookups.length) throw new Error('lookup tables are not permitted in v1');
  if (compiled.staticAccountKeys.length > 64) throw new Error(`64-key cap exceeded (${compiled.staticAccountKeys.length})`);
  const configMask = 0b01100;
  const message = Buffer.concat([
    Buffer.from([0x81, compiled.header.numRequiredSignatures, compiled.header.numReadonlySignedAccounts, compiled.header.numReadonlyUnsignedAccounts]),
    u32(configMask), Buffer.from(bs58.decode(blockhash)), Buffer.from([compiled.compiledInstructions.length, compiled.staticAccountKeys.length]),
    ...compiled.staticAccountKeys.map((key) => key.toBuffer()), u32(1_400_000), u32(64 * 1024 * 1024),
    ...compiled.compiledInstructions.map((ix) => {
      const header = Buffer.alloc(4); header[0] = ix.programIdIndex; header[1] = ix.accountKeyIndexes.length; header.writeUInt16LE(ix.data.length, 2); return header;
    }),
    ...compiled.compiledInstructions.flatMap((ix) => [Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]),
  ]);
  const decoded = MessageV1.deserialize(message);
  const wire = Buffer.concat([message, Buffer.alloc(decoded.header.numRequiredSignatures * 64)]);
  if (wire.length > 4096) throw new Error(`4096-byte cap exceeded (${wire.length})`);
  if (VersionedTransaction.deserialize(wire).version !== 1) throw new Error('v1 wire round-trip failed');
  return { message, wire, decoded };
}

async function rpc(method, params) {
  const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function transactionKeys(tx) {
  const message = tx.transaction.message;
  return [...message.accountKeys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])].map(String);
}

function metaFunctions(tx) {
  const message = tx.transaction.message;
  const staticLength = message.accountKeys.length;
  const header = message.header;
  const writableLoaded = tx.meta.loadedAddresses?.writable?.length || 0;
  return {
    signer(index) { return index < header.numRequiredSignatures; },
    writable(index) {
      if (index < staticLength) {
        if (index < header.numRequiredSignatures) return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
        return index < staticLength - header.numReadonlyUnsignedAccounts;
      }
      return index < staticLength + writableLoaded;
    },
  };
}

function locateInstruction(tx, discriminator) {
  const keys = transactionKeys(tx);
  const metas = metaFunctions(tx);
  const candidates = [
    ...(tx.transaction.message.instructions || []).map((ix, index) => ({ ix, source: 'top', index })),
    ...(tx.meta.innerInstructions || []).flatMap((group) => (group.instructions || []).map((ix, index) => ({ ix, source: `inner:${group.index}`, index }))),
  ];
  for (const candidate of candidates) {
    const ix = candidate.ix;
    if (keys[ix.programIdIndex] !== PROGRAM.toBase58()) continue;
    const data = Buffer.from(bs58.decode(ix.data));
    if (data.subarray(0, 8).toString('hex') !== discriminator) continue;
    return {
      instruction: new TransactionInstruction({
        programId: PROGRAM, data,
        keys: ix.accounts.map((accountIndex) => ({ pubkey: new PublicKey(keys[accountIndex]), isSigner: metas.signer(accountIndex), isWritable: metas.writable(accountIndex) })),
      }),
      source: candidate.source, index: candidate.index, payer: new PublicKey(tx.transaction.message.accountKeys[0]),
    };
  }
  return null;
}

function cloneInstruction(ix, mutate) {
  const keys = ix.keys.map((meta) => ({ ...meta }));
  const data = Buffer.from(ix.data);
  mutate(keys, data);
  return new TransactionInstruction({ programId: ix.programId, keys, data });
}

function replaceKey(ix, index, pubkey) { return cloneInstruction(ix, (keys) => { keys[index].pubkey = pubkey; }); }
function replaceProgram(ix, index) { return replaceKey(ix, index, SYSTEM); }

function alternateVault(mint, excluded) {
  for (const row of CUSTODY.rows.filter((candidate) => candidate.controlVerified)) {
    for (const reserve of row.reserves) {
      if (reserve.mint === mint.toBase58() && reserve.address !== excluded.toBase58()) return new PublicKey(reserve.address);
    }
  }
  return null;
}

function decodeAccount(data, owner) {
  if (!data) return null;
  if ((owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' || owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') && data.length >= 72) {
    return { kind: 'token', mint: new PublicKey(data.subarray(0, 32)).toBase58(), authority: new PublicKey(data.subarray(32, 64)).toBase58(), amount: data.readBigUInt64LE(64).toString(), sha256: sha256(data) };
  }
  return { kind: 'state', dataLength: data.length, sha256: sha256(data) };
}

async function currentTokenAccount(owner, mint) {
  const rows = await CONNECTION.getTokenAccountsByOwner(owner, { mint }, 'confirmed');
  const candidates = rows.value.map((row) => ({ key: row.pubkey, amount: row.account.data.length >= 72 ? row.account.data.readBigUInt64LE(64) : 0n }));
  candidates.sort((a, b) => a.amount === b.amount ? 0 : (a.amount > b.amount ? -1 : 1));
  return candidates[0]?.key || null;
}

async function largestTokenAccount(mint) {
  try {
    const rows = await CONNECTION.getTokenLargestAccounts(mint, 'confirmed');
    return rows.value[0]?.address || null;
  } catch { return null; }
}

async function hydrateCurrentUserTokenAccounts(name, control, spec) {
  // Recent aggregator transactions often create/close ephemeral ATAs. Replace
  // only missing user token accounts with a current account for the same
  // authorized signer and mint; reserve/pair/position bindings stay untouched.
  control.keys[spec.signer].isSigner = true;
  const signer = control.keys[spec.signer].pubkey;
  let expectedX = spec.mintX != null ? control.keys[spec.mintX].pubkey : null;
  let expectedY = spec.mintY != null ? control.keys[spec.mintY].pubkey : null;
  if (name === 'swap2') {
    const inputInfo = await CONNECTION.getAccountInfo(control.keys[spec.userX].pubkey, 'confirmed');
    if (inputInfo && inputInfo.data.length >= 32) {
      const inputMint = new PublicKey(inputInfo.data.subarray(0, 32));
      expectedX = inputMint;
      expectedY = inputMint.equals(control.keys[spec.mintX].pubkey) ? control.keys[spec.mintY].pubkey : control.keys[spec.mintX].pubkey;
    }
  }
  const replacements = {};
  for (const [label, index, mint] of [['x', spec.userX, expectedX], ['y', spec.userY, expectedY]]) {
    if (index == null || !mint) continue;
    const info = await CONNECTION.getAccountInfo(control.keys[index].pubkey, 'confirmed');
    const valid = info && info.data.length >= 72 && new PublicKey(info.data.subarray(0, 32)).equals(mint);
    if (!valid) {
      let replacement = await currentTokenAccount(signer, mint);
      const destinationMayBeArbitrary = name !== 'swap2' || label === 'y';
      if (!replacement && destinationMayBeArbitrary) replacement = await largestTokenAccount(mint);
      if (replacement) {
        replacements[label] = { source: control.keys[index].pubkey.toBase58(), current: replacement.toBase58(), mint: mint.toBase58() };
        control.keys[index].pubkey = replacement;
      }
    }
  }
  return replacements;
}

async function snapshot(addresses) {
  const response = await CONNECTION.getMultipleAccountsInfoAndContext(addresses, 'confirmed');
  return { slot: response.context.slot, accounts: Object.fromEntries(addresses.map((key, index) => {
    const info = response.value[index]; return [key.toBase58(), info ? decodeAccount(info.data, info.owner.toBase58()) : null];
  })) };
}

async function simulate(label, payer, instructions, monitor, before, blockhash) {
  try {
    const serialized = serializeV1(payer, blockhash, instructions);
    const result = await rpc('simulateTransaction', [serialized.wire.toString('base64'), {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
      accounts: { encoding: 'base64', addresses: monitor.map((key) => key.toBase58()) },
    }]);
    const value = result.value;
    const after = Object.fromEntries(monitor.map((key, index) => {
      const row = value.accounts?.[index];
      return [key.toBase58(), row ? decodeAccount(Buffer.from(row.data[0], 'base64'), row.owner) : null];
    }));
    const deltas = {};
    const changedState = {};
    for (const key of monitor) {
      const address = key.toBase58();
      if (before[address]?.amount != null && after[address]?.amount != null) deltas[address] = (BigInt(after[address].amount) - BigInt(before[address].amount)).toString();
      if (before[address]?.sha256 && after[address]?.sha256) changedState[address] = before[address].sha256 !== after[address].sha256;
    }
    return {
      label, contextSlot: result.context.slot, err: value.err, unitsConsumed: value.unitsConsumed, tokenDeltas: deltas, changedState, after,
      logs: value.logs || [], message: {
        version: 1, messageBytes: serialized.message.length, wireBytes: serialized.wire.length,
        staticAccountKeys: serialized.decoded.staticAccountKeys.length, instructions: instructions.length,
        sha256: sha256(serialized.wire), base64: serialized.wire.toString('base64'),
      },
    };
  } catch (error) { return { label, constructionOrTransportError: String(error?.message || error) }; }
}

async function testSource(name, hit, blockhash) {
  const spec = TARGETS[name];
  const tx = await rpc('getTransaction', [hit.signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
  const located = locateInstruction(tx, spec.discriminator);
  if (!located) return { name, signature: hit.signature, error: 'instruction not located in source transaction' };
  const control = located.instruction;
  const hydratedUserTokenAccounts = await hydrateCurrentUserTokenAccounts(name, control, spec);
  const altX = spec.mintX != null ? alternateVault(control.keys[spec.mintX].pubkey, control.keys[spec.reserveX].pubkey) : null;
  const altY = spec.mintY != null && spec.reserveY != null ? alternateVault(control.keys[spec.mintY].pubkey, control.keys[spec.reserveY].pubkey) : null;
  const monitoredIndexes = [spec.pair, spec.position, spec.reserveX, spec.reserveY, spec.userX, spec.userY, spec.mintX, spec.mintY]
    .filter((index) => index != null && index < control.keys.length);
  const monitorSet = new Map(monitoredIndexes.map((index) => [control.keys[index].pubkey.toBase58(), control.keys[index].pubkey]));
  for (const key of [OUTSIDER, altX, altY].filter(Boolean)) monitorSet.set(key.toBase58(), key);
  const monitor = [...monitorSet.values()];
  const pre = await snapshot(monitor);

  const cases = [['source_control', [control]]];
  if (name === 'swap2') {
    for (const amount of [1n, 2n, 10n, 100n, 1_000n, 10_000n, 100_000n]) {
      cases.push([`amount_${amount}_min_out_zero`, [cloneInstruction(control, (_keys, data) => { data.writeBigUInt64LE(amount, 8); data.writeBigUInt64LE(0n, 16); })]]);
    }
  }
  if (name === 'removeLiquidityByRange2') {
    cases.push(['one_bps_control', [cloneInstruction(control, (_keys, data) => data.writeUInt16LE(1, 16))]]);
  }
  cases.push(['outsider_signer', [replaceKey(control, spec.signer, OUTSIDER)]]);
  if (spec.reserveX != null && altX) cases.push(['reserve_x_other_same_mint_vault', [replaceKey(control, spec.reserveX, altX)]]);
  if (spec.reserveY != null && altY) cases.push(['reserve_y_other_same_mint_vault', [replaceKey(control, spec.reserveY, altY)]]);
  if (spec.tokenProgramX != null) cases.push(['token_program_x_system', [replaceProgram(control, spec.tokenProgramX)]]);
  if (spec.userX != null && spec.reserveX != null) cases.push(['destination_or_user_x_aliases_reserve_x', [replaceKey(control, spec.userX, control.keys[spec.reserveX].pubkey)]]);
  if (spec.userY != null && spec.reserveY != null) cases.push(['destination_or_user_y_aliases_reserve_y', [replaceKey(control, spec.userY, control.keys[spec.reserveY].pubkey)]]);
  if (control.keys.length > 16) cases.push(['duplicate_first_remaining_account', [cloneInstruction(control, (keys) => { keys[keys.length - 1].pubkey = keys[16].pubkey; })]]);
  cases.push(['control_then_outsider_atomic', [control, replaceKey(control, spec.signer, OUTSIDER)]]);
  cases.push(['outsider_then_control_atomic', [replaceKey(control, spec.signer, OUTSIDER), control]]);

  const results = [];
  for (const [label, instructions] of cases) {
    const result = await simulate(label, located.payer, instructions, monitor, pre.accounts, blockhash);
    results.push(result);
    process.stdout.write(`${JSON.stringify({ name, label, err: result.err, transport: result.constructionOrTransportError, cu: result.unitsConsumed, bytes: result.message?.wireBytes, keys: result.message?.staticAccountKeys, deltas: result.tokenDeltas })}\n`);
  }
  return {
    name, sourceSignature: hit.signature, sourceSlot: hit.slot, sourceLocation: located.source,
    hydratedUserTokenAccounts,
    sourceInstructionDataHex: control.data.toString('hex'), payer: located.payer.toBase58(),
    accounts: control.keys.map((meta, index) => ({ index, address: meta.pubkey.toBase58(), signer: meta.isSigner, writable: meta.isWritable })),
    alternateSameMintVaults: { x: altX?.toBase58() || null, y: altY?.toBase58() || null }, pre, results,
  };
}

async function testConstructedProtocolWithdraw(blockhash, operatorAddress) {
  const program = DLMM.createProgram(CONNECTION);
  const pairRow = CUSTODY.rows.find((row) => row.controlVerified && row.address === '9d9mb8kooFfaD3SctgZtkxQypkshx6ezhbKio89ixyy2')
    || CUSTODY.rows.find((row) => row.controlVerified);
  const pair = new PublicKey(pairRow.address);
  const state = await program.account.lbPair.fetch(pair);
  const operator = new PublicKey(operatorAddress);
  const operatorState = await program.account.operator.fetch(operator);
  const signer = operatorState.signer;
  const mintInfos = await CONNECTION.getMultipleAccountsInfo([state.tokenXMint, state.tokenYMint], 'confirmed');
  const receiverOwner = process.env.RECEIVER_OWNER ? new PublicKey(process.env.RECEIVER_OWNER) : signer;
  const receiverX = SPL.getAssociatedTokenAddressSync(state.tokenXMint, receiverOwner, true, mintInfos[0].owner);
  const receiverY = SPL.getAssociatedTokenAddressSync(state.tokenYMint, receiverOwner, true, mintInfos[1].owner);
  const createReceivers = [
    SPL.createAssociatedTokenAccountIdempotentInstruction(OUTSIDER, receiverX, receiverOwner, state.tokenXMint, mintInfos[0].owner),
    SPL.createAssociatedTokenAccountIdempotentInstruction(OUTSIDER, receiverY, receiverOwner, state.tokenYMint, mintInfos[1].owner),
  ];
  const altX = alternateVault(state.tokenXMint, state.reserveX);
  const altY = alternateVault(state.tokenYMint, state.reserveY);
  const data = Buffer.alloc(28);
  Buffer.from(TARGETS.withdrawProtocolFee.discriminator, 'hex').copy(data, 0);
  data.writeBigUInt64LE(0xffffffffffffffffn, 8);
  data.writeBigUInt64LE(0xffffffffffffffffn, 16);
  data.writeUInt32LE(0, 24);
  const control = new TransactionInstruction({ programId: PROGRAM, data, keys: [
    { pubkey: pair, isSigner: false, isWritable: true },
    { pubkey: state.reserveX, isSigner: false, isWritable: true },
    { pubkey: state.reserveY, isSigner: false, isWritable: true },
    { pubkey: state.tokenXMint, isSigner: false, isWritable: false },
    { pubkey: state.tokenYMint, isSigner: false, isWritable: false },
    { pubkey: receiverX, isSigner: false, isWritable: true },
    { pubkey: receiverY, isSigner: false, isWritable: true },
    { pubkey: operator, isSigner: false, isWritable: false },
    { pubkey: signer, isSigner: true, isWritable: false },
    { pubkey: mintInfos[0].owner, isSigner: false, isWritable: false },
    { pubkey: mintInfos[1].owner, isSigner: false, isWritable: false },
  ] });
  const monitor = [pair, state.reserveX, state.reserveY, receiverX, receiverY, operator, signer, altX, altY].filter(Boolean);
  const pre = await snapshot(monitor);
  const prefix = () => createReceivers.map((ix) => ix);
  const cases = [['constructed_current_control', [...prefix(), control]], ['outsider_signer', [...prefix(), replaceKey(control, 8, OUTSIDER)]],
    ['token_program_x_system', [...prefix(), replaceKey(control, 9, SYSTEM)]], ['receiver_x_aliases_reserve_x', [...prefix(), replaceKey(control, 5, state.reserveX)]],
    ['control_twice', [...prefix(), control, control]], ['control_then_outsider_atomic', [...prefix(), control, replaceKey(control, 8, OUTSIDER)]],
    ['outsider_then_control_atomic', [...prefix(), replaceKey(control, 8, OUTSIDER), control]]];
  if (altX) cases.push(['reserve_x_other_same_mint_vault', [...prefix(), replaceKey(control, 1, altX)]]);
  if (altY) cases.push(['reserve_y_other_same_mint_vault', [...prefix(), replaceKey(control, 2, altY)]]);
  const results = [];
  for (const [label, instructions] of cases) {
    const result = await simulate(label, OUTSIDER, instructions, monitor, pre.accounts, blockhash);
    results.push(result);
    process.stdout.write(`${JSON.stringify({ name: 'withdrawProtocolFee', operator: operatorAddress, label, err: result.err, transport: result.constructionOrTransportError, cu: result.unitsConsumed, bytes: result.message?.wireBytes, deltas: result.tokenDeltas })}\n`);
  }
  return { name: 'withdrawProtocolFee', constructedFromCurrentState: true, pair: pair.toBase58(), pairName: pairRow.name,
    protocolFeeBefore: { amountX: state.protocolFee.amountX.toString(), amountY: state.protocolFee.amountY.toString() },
    operator: operator.toBase58(), operatorSigner: signer.toBase58(), receiverOwner: receiverOwner.toBase58(), operatorPermissionHex: operatorState.permission.toString(16),
    sourceInstructionDataHex: data.toString('hex'), accounts: control.keys.map((meta, index) => ({ index, address: meta.pubkey.toBase58(), signer: meta.isSigner, writable: meta.isWritable })),
    alternateSameMintVaults: { x: altX?.toBase58() || null, y: altY?.toBase58() || null }, pre, results };
}

async function testConstructedPositionControls(blockhash) {
  const program = DLMM.createProgram(CONNECTION);
  const pairRow = CUSTODY.rows.find((row) => row.controlVerified && row.address === '9d9mb8kooFfaD3SctgZtkxQypkshx6ezhbKio89ixyy2');
  const pair = new PublicKey(pairRow.address);
  const pairState = await program.account.lbPair.fetch(pair);
  const positions = await program.account.positionV2.all([DLMM.positionLbPairFilter(pair)]);
  const hasLiquidity = (row) => row.account.liquidityShares.some((share) => !share.isZero());
  const hasPendingFee = (row) => row.account.feeInfos.some((fee) => !fee.feeXPending.isZero() || !fee.feeYPending.isZero());
  const selected = positions.find((row) => hasLiquidity(row) && hasPendingFee(row)) || positions.find(hasLiquidity);
  if (!selected) throw new Error('no current nonempty PositionV2 in selected pool');
  const position = selected.publicKey, positionState = selected.account, owner = positionState.owner;
  const mintInfos = await CONNECTION.getMultipleAccountsInfo([pairState.tokenXMint, pairState.tokenYMint], 'confirmed');
  const userX = SPL.getAssociatedTokenAddressSync(pairState.tokenXMint, owner, true, mintInfos[0].owner);
  const userY = SPL.getAssociatedTokenAddressSync(pairState.tokenYMint, owner, true, mintInfos[1].owner);
  const creates = [
    SPL.createAssociatedTokenAccountIdempotentInstruction(OUTSIDER, userX, owner, pairState.tokenXMint, mintInfos[0].owner),
    SPL.createAssociatedTokenAccountIdempotentInstruction(OUTSIDER, userY, owner, pairState.tokenYMint, mintInfos[1].owner),
  ];
  const eventAuthority = DLMM.deriveEventAuthority(PROGRAM)[0];
  const memo = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  const binArrays = DLMM.getBinArraysRequiredByPositionRange2(pair, new (require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bn.js'))(positionState.lowerBinId), new (require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bn.js'))(positionState.upperBinId), PROGRAM);
  const claimData = program.coder.instruction.encode('claimFee2', { minBinId: positionState.lowerBinId, maxBinId: positionState.upperBinId, remainingAccountsInfo: { slices: [] } });
  const claim = new TransactionInstruction({ programId: PROGRAM, data: claimData, keys: [
    { pubkey: pair, isSigner: false, isWritable: true }, { pubkey: position, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false }, { pubkey: pairState.reserveX, isSigner: false, isWritable: true },
    { pubkey: pairState.reserveY, isSigner: false, isWritable: true }, { pubkey: userX, isSigner: false, isWritable: true },
    { pubkey: userY, isSigner: false, isWritable: true }, { pubkey: pairState.tokenXMint, isSigner: false, isWritable: false },
    { pubkey: pairState.tokenYMint, isSigner: false, isWritable: false }, { pubkey: mintInfos[0].owner, isSigner: false, isWritable: false },
    { pubkey: mintInfos[1].owner, isSigner: false, isWritable: false }, { pubkey: memo, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false }, { pubkey: PROGRAM, isSigner: false, isWritable: false },
    ...binArrays.map((row) => ({ pubkey: row.key, isSigner: false, isWritable: true })),
  ] });
  const bitmapDerived = DLMM.deriveBinArrayBitmapExtension(pair, PROGRAM)[0];
  const bitmapInfo = await CONNECTION.getAccountInfo(bitmapDerived, 'confirmed');
  const bitmap = bitmapInfo ? bitmapDerived : PROGRAM;
  const removeData = program.coder.instruction.encode('removeLiquidityByRange2', { fromBinId: positionState.lowerBinId, toBinId: positionState.upperBinId, bpsToRemove: 1, remainingAccountsInfo: { slices: [] } });
  const remove = new TransactionInstruction({ programId: PROGRAM, data: removeData, keys: [
    { pubkey: position, isSigner: false, isWritable: true }, { pubkey: pair, isSigner: false, isWritable: true },
    { pubkey: bitmap, isSigner: false, isWritable: true }, { pubkey: userX, isSigner: false, isWritable: true },
    { pubkey: userY, isSigner: false, isWritable: true }, { pubkey: pairState.reserveX, isSigner: false, isWritable: true },
    { pubkey: pairState.reserveY, isSigner: false, isWritable: true }, { pubkey: pairState.tokenXMint, isSigner: false, isWritable: false },
    { pubkey: pairState.tokenYMint, isSigner: false, isWritable: false }, { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: mintInfos[0].owner, isSigner: false, isWritable: false }, { pubkey: mintInfos[1].owner, isSigner: false, isWritable: false },
    { pubkey: memo, isSigner: false, isWritable: false }, { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: PROGRAM, isSigner: false, isWritable: false }, ...binArrays.map((row) => ({ pubkey: row.key, isSigner: false, isWritable: true })),
  ] });
  const altX = alternateVault(pairState.tokenXMint, pairState.reserveX), altY = alternateVault(pairState.tokenYMint, pairState.reserveY);
  const monitor = [pair, position, pairState.reserveX, pairState.reserveY, userX, userY, owner, bitmapDerived, ...binArrays.map((row) => row.key), altX, altY].filter(Boolean).slice(0, 15);
  const pre = await snapshot(monitor);
  const controls = [];
  for (const [name, instruction, signerIndex, reserveXIndex, reserveYIndex, tokenProgramIndex] of [
    ['claimFee2', claim, 2, 3, 4, 9], ['removeLiquidityByRange2', remove, 9, 5, 6, 10],
  ]) {
    const cases = [['constructed_current_control', [...creates, instruction]], ['outsider_signer', [...creates, replaceKey(instruction, signerIndex, OUTSIDER)]],
      ['token_program_x_system', [...creates, replaceKey(instruction, tokenProgramIndex, SYSTEM)]],
      ['control_then_outsider_atomic', [...creates, instruction, replaceKey(instruction, signerIndex, OUTSIDER)]],
      ['outsider_then_control_atomic', [...creates, replaceKey(instruction, signerIndex, OUTSIDER), instruction]]];
    if (altX) cases.push(['reserve_x_other_same_mint_vault', [...creates, replaceKey(instruction, reserveXIndex, altX)]]);
    if (altY) cases.push(['reserve_y_other_same_mint_vault', [...creates, replaceKey(instruction, reserveYIndex, altY)]]);
    const results = [];
    for (const [label, instructions] of cases) {
      const result = await simulate(label, OUTSIDER, instructions, monitor, pre.accounts, blockhash); results.push(result);
      process.stdout.write(`${JSON.stringify({ name, label, err: result.err, transport: result.constructionOrTransportError, cu: result.unitsConsumed, bytes: result.message?.wireBytes, deltas: result.tokenDeltas })}\n`);
    }
    controls.push({ name, constructedFromCurrentState: true, pair: pair.toBase58(), pairName: pairRow.name,
      position: position.toBase58(), positionOwner: owner.toBase58(), lowerBinId: positionState.lowerBinId, upperBinId: positionState.upperBinId,
      nonzeroLiquidityShareBins: positionState.liquidityShares.filter((share) => !share.isZero()).length,
      sourceInstructionDataHex: instruction.data.toString('hex'), accounts: instruction.keys.map((meta, index) => ({ index, address: meta.pubkey.toBase58(), signer: meta.isSigner, writable: meta.isWritable })), pre, results });
  }
  return controls;
}

async function main() {
  const blockhash = (await CONNECTION.getLatestBlockhash('confirmed')).blockhash;
  const groups = [];
  if (process.env.ONLY_WITHDRAW !== '1') {
    for (const name of Object.keys(TARGETS)) {
      const preferred = TOP_SOURCES.found[name]?.length ? TOP_SOURCES.found[name] : (SOURCES.found[name] || []);
      for (const hit of preferred.slice(0, 3)) groups.push(await testSource(name, hit, blockhash));
    }
  }
  if (process.env.ONLY_POSITION === '1') groups.push(...await testConstructedPositionControls(blockhash));
  if (process.env.ONLY_POSITION !== '1') for (const operator of ['3ufqCAjSypP51HbMf8LRFzdtknjDpXyEqvBR665PcgHa', 'CCzxVej9tnrpwcvZ3DitTV9jyn3Fj7nLcQhZyvB8fao6', 'Gmdg2HkLtawm68JcjwqVQNWdpZKiuhiCPw6EQsjMCPCk'].filter((value) => !process.env.ONLY_OPERATOR || value === process.env.ONLY_OPERATOR)) {
    try { groups.push(await testConstructedProtocolWithdraw(blockhash, operator)); }
    catch (error) { groups.push({ name: 'withdrawProtocolFee', operator, constructionError: String(error?.message || error) }); }
  }
  const migrationPayer = OUTSIDER;
  const migrationPre = await snapshot([migrationPayer]);
  const migration = await simulate('removed_legacy_migrate_position_discriminator', migrationPayer, [new TransactionInstruction({
    programId: PROGRAM, keys: [], data: Buffer.from('0f843b32c706fb2e', 'hex'),
  })], [migrationPayer], migrationPre.accounts, blockhash);
  const output = {
    observedAt: new Date().toISOString(), rpcHost: new URL(RPC).hostname, programId: PROGRAM.toBase58(),
    signerVerification: false, transactionVersion: 1, sizeLimitBytes: 4096, inlineAccountLimit: 64,
    sourceIndex: '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-control-signatures.json', groups, migration,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUT, groups: groups.length, observedAt: output.observedAt }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
