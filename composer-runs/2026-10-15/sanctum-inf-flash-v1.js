#!/usr/bin/env node
'use strict';

// Read-only current-mainnet stress harness. It creates unsigned Solana v1
// simulation packets and calls simulateTransaction only. There is no send path.
const crypto = require('crypto');
const fs = require('fs');
const {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const bs = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs.default || bs;

const RPC_URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL || process.env.SOLANA_RPC;
if (!RPC_URL) throw new Error('HEAVY_RPC_URL, RPC_URL, or SOLANA_RPC is required');
const OUT = __dirname + '/sanctum-inf-flash-v1.json';
const CONTROL_INDEX = __dirname + '/sanctum-inf-control-index.json';
const MARGINFI = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const INF = new PublicKey('5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx');
const INF_MINT = new PublicKey('5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm');
const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const POOL = new PublicKey('AYhux5gJzCoeoc1PoJ1VxwPDe22RwcvpHviLDD1oCGvW');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const P0_SOURCE = '2WxD766a1LAyiHiMYK8REpBsNpDhA8GQAkNb3occqXXooFF5xyUKz6Xim4m9tVQMiyFrhCYbKKcb6o4FibMBBdwG';
const START = Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]);
const END = Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]);
const BORROW = Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]);
const REPAY = Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]);
const conn = new Connection(RPC_URL, 'processed');
let rpcId = 0;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const clone = (ix) => new TransactionInstruction({
  programId: ix.programId,
  keys: ix.keys.map((key) => ({...key})),
  data: Buffer.from(ix.data),
});
const matching = (ix, program, disc) => ix.programId.equals(program) && Buffer.from(ix.data).subarray(0, 8).equals(disc);

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function decompile(signature) {
  const tx = await rpc('getTransaction', [signature, {encoding: 'base64', maxSupportedTransactionVersion: 1}]);
  if (!tx) throw new Error(`missing source transaction ${signature}`);
  const wire = VersionedTransaction.deserialize(Buffer.from(tx.transaction[0], 'base64'));
  const alts = await Promise.all((wire.message.addressTableLookups || []).map(async ({accountKey}) => {
    const result = await conn.getAddressLookupTable(accountKey);
    if (!result.value) throw new Error(`missing ALT ${accountKey}`);
    return result.value;
  }));
  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    payer: TransactionMessage.decompile(wire.message, {addressLookupTableAccounts: alts}).payerKey,
    message: TransactionMessage.decompile(wire.message, {addressLookupTableAccounts: alts}),
  };
}

function liquidityData(discriminator, amount, minOut = 0n, index = 1) {
  const data = Buffer.alloc(22);
  data[0] = discriminator;
  data[1] = 1;
  data.writeUInt32LE(index, 2);
  data.writeBigUInt64LE(amount, 6);
  data.writeBigUInt64LE(minOut, 14);
  return data;
}

function encodeV1(payer, blockhash, instructions, computeLimit = 1_400_000, dataLimit = 67_108_864) {
  // web3.js compiles account ordering/privileges. Solana v1 has no ALTs and
  // permits 64 inline addresses and a 4,096-byte packet.
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions}).compileToV0Message([]);
  const {header, staticAccountKeys: keys, compiledInstructions: items} = compiled;
  if (compiled.addressTableLookups.length) throw new Error('v1 packet unexpectedly contains an ALT');
  if (keys.length > 64 || items.length > 64) throw new Error(`v1 key/instruction limit ${keys.length}/${items.length}`);
  const configMask = Buffer.alloc(4);
  configMask.writeUInt32LE(0x0c);
  const config = Buffer.alloc(8);
  config.writeUInt32LE(computeLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const heads = [];
  const payloads = [];
  for (const ix of items) {
    if (ix.accountKeyIndexes.length > 255 || ix.data.length > 65535) throw new Error('v1 instruction encoding limit');
    const head = Buffer.alloc(4);
    head[0] = ix.programIdIndex;
    head[1] = ix.accountKeyIndexes.length;
    head.writeUInt16LE(ix.data.length, 2);
    heads.push(head);
    payloads.push(Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data));
  }
  const wire = Buffer.concat([
    Buffer.from([0x81, header.numRequiredSignatures, header.numReadonlySignedAccounts, header.numReadonlyUnsignedAccounts]),
    configMask,
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]),
    ...keys.map((key) => key.toBuffer()),
    config,
    ...heads,
    ...payloads,
    Buffer.alloc(64 * header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 wire is ${wire.length} bytes`);
  const unsignedStart = keys.length - header.numReadonlyUnsignedAccounts;
  const writableSignedEnd = header.numRequiredSignatures - header.numReadonlySignedAccounts;
  const accounts = keys.map((key, index) => ({
    index,
    address: key.toBase58(),
    signer: index < header.numRequiredSignatures,
    writable: index < header.numRequiredSignatures ? index < writableSignedEnd : index < unsignedStart,
  }));
  const message = {
    format: 'Solana transaction v1',
    packetLimitBytes: 4096,
    inlineAddressLimit: 64,
    versionPrefixHex: '81',
    configMaskHex: configMask.toString('hex'),
    computeUnitLimit: computeLimit,
    loadedAccountsDataSizeLimit: dataLimit,
    wireBytes: wire.length,
    wireSha256: sha256(wire),
    unsignedSimulationWireBase64: wire.toString('base64'),
    requiredSignatures: header.numRequiredSignatures,
    accountCount: keys.length,
    instructionCount: items.length,
    accounts,
    instructions: items.map((ix, index) => ({
      index,
      programIdIndex: ix.programIdIndex,
      programId: keys[ix.programIdIndex].toBase58(),
      accountKeyIndexes: [...ix.accountKeyIndexes],
      dataHex: Buffer.from(ix.data).toString('hex'),
    })),
  };
  return {wire, message};
}

function signedI128LE(data, offset) {
  const raw = data.readBigUInt64LE(offset) | (data.readBigUInt64LE(offset + 8) << 64n);
  return raw >= (1n << 127n) ? raw - (1n << 128n) : raw;
}

function fixedDecimal(raw) {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs >> 48n;
  const fraction = abs & ((1n << 48n) - 1n);
  const scaled = fraction * 1_000_000_000n / (1n << 48n);
  return `${negative ? '-' : ''}${whole}.${scaled.toString().padStart(9, '0')}`;
}

function decodeMarginfiAccount(data, bank) {
  if (!data || data.length < 8 + 64 + 1728) return null;
  const balanceStart = 8 + 64;
  const balances = [];
  for (let i = 0; i < 16; i++) {
    const offset = balanceStart + i * 104;
    if (data[offset] === 0) continue;
    const bankPk = new PublicKey(data.subarray(offset + 1, offset + 33)).toBase58();
    const asset = signedI128LE(data, offset + 40);
    const liability = signedI128LE(data, offset + 56);
    balances.push({index: i, bank: bankPk, assetSharesRawI80F48: asset.toString(), assetShares: fixedDecimal(asset), liabilitySharesRawI80F48: liability.toString(), liabilityShares: fixedDecimal(liability)});
  }
  const selected = balances.find((row) => row.bank === bank.toBase58()) || null;
  return {
    dataSha256: sha256(data),
    accountFlags: data.readBigUInt64LE(8 + 64 + 1728).toString(),
    selectedBankBalance: selected,
    activeBalances: balances,
  };
}

function decodeAccount(account, spec) {
  if (!account) return null;
  const data = account.data ? (Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64')) : null;
  if (spec.kind === 'system') return {lamports: String(account.lamports)};
  if (spec.kind === 'token') return data && data.length >= 72 ? {rawAmount: data.readBigUInt64LE(64).toString(), lamports: String(account.lamports)} : null;
  if (spec.kind === 'mint') return data && data.length >= 44 ? {rawSupply: data.readBigUInt64LE(36).toString(), lamports: String(account.lamports)} : null;
  if (spec.kind === 'pool') return data && data.length >= 240 ? {
    dataSha256: sha256(data),
    totalSolValueLamports: data.readBigUInt64LE(0).toString(),
    protocolFeeLamports: data.readBigUInt64LE(224).toString(),
    lastReleaseSlot: data.readBigUInt64LE(232).toString(),
  } : null;
  if (spec.kind === 'marginfi') return decodeMarginfiAccount(data, spec.bank);
  return data ? {dataSha256: sha256(data), lamports: String(account.lamports)} : null;
}

async function getBefore(specs) {
  const infos = await conn.getMultipleAccountsInfo(specs.map((spec) => spec.address), 'processed');
  return Object.fromEntries(specs.map((spec, index) => [spec.address.toBase58(), decodeAccount(infos[index], spec)]));
}

function numericDelta(before, after, field) {
  if (before?.[field] == null || after?.[field] == null) return null;
  return (BigInt(after[field]) - BigInt(before[field])).toString();
}

async function simulate(label, payer, instructions, specs = [], includeExactMessage = false) {
  const before = specs.length ? await getBefore(specs) : {};
  const {blockhash} = await conn.getLatestBlockhash('processed');
  const encoded = encodeV1(payer, blockhash, instructions);
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64',
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'processed',
    innerInstructions: true,
    ...(specs.length ? {accounts: {encoding: 'base64', addresses: specs.map((spec) => spec.address.toBase58())}} : {}),
  }]);
  const after = Object.fromEntries(specs.map((spec, index) => [spec.address.toBase58(), decodeAccount(result.value.accounts?.[index], spec)]));
  const accountState = Object.fromEntries(specs.map((spec) => {
    const address = spec.address.toBase58();
    return [address, {
      label: spec.label,
      kind: spec.kind,
      before: before[address],
      after: after[address],
      rawAmountDelta: numericDelta(before[address], after[address], 'rawAmount'),
      rawSupplyDelta: numericDelta(before[address], after[address], 'rawSupply'),
      lamportsDelta: numericDelta(before[address], after[address], 'lamports'),
    }];
  }));
  const message = includeExactMessage ? encoded.message : {
    format: encoded.message.format,
    packetLimitBytes: encoded.message.packetLimitBytes,
    inlineAddressLimit: encoded.message.inlineAddressLimit,
    computeUnitLimit: encoded.message.computeUnitLimit,
    loadedAccountsDataSizeLimit: encoded.message.loadedAccountsDataSizeLimit,
    wireBytes: encoded.message.wireBytes,
    wireSha256: encoded.message.wireSha256,
    requiredSignatures: encoded.message.requiredSignatures,
    accountCount: encoded.message.accountCount,
    instructionCount: encoded.message.instructionCount,
  };
  return {
    label,
    simulationContextSlot: result.context?.slot,
    err: result.value.err,
    unitsConsumed: result.value.unitsConsumed ?? null,
    loadedAccountsDataSize: result.value.loadedAccountsDataSize ?? null,
    message,
    accountState,
    relevantLogs: (result.value.logs || []).filter((line) => line.includes('Instruction:') || line.includes('Program return:') || line.includes('Error') || line.includes('failed') || line.includes('Setting account flag')).slice(-40),
  };
}

function setAmount(ix, amount) {
  const out = clone(ix);
  out.data.writeBigUInt64LE(amount, 8);
  return out;
}

function flashInstructions(parts, amount, middle = [], prefix = []) {
  const start = clone(parts.start);
  const end = clone(parts.end);
  const borrow = setAmount(parts.borrow, amount);
  const repay = setAmount(parts.repay, amount);
  const instructions = [...prefix.map(clone), start, borrow, ...middle.map(clone), repay, end];
  const startIndex = prefix.length;
  const endIndex = instructions.length - 1;
  instructions[startIndex].data.writeBigUInt64LE(BigInt(endIndex), 8);
  return instructions;
}

function rawToken(caseResult, address, side = 'after') {
  return caseResult.accountState[address.toBase58()]?.[side]?.rawAmount;
}

async function main() {
  const index = JSON.parse(fs.readFileSync(CONTROL_INDEX, 'utf8'));
  const direct = index.found.find((row) => row.discriminator === 23 && row.accounts[1] === WSOL.toBase58() && row.accounts[2] === INF_MINT.toBase58());
  const syncRow = index.found.find((row) => row.discriminator === 0 && row.accounts[0] === WSOL.toBase58() && row.dataHex === '0001000000');
  if (!direct || !syncRow) throw new Error('missing INF wSOL control or sync control');
  const [p0, infControl, syncControl] = await Promise.all([decompile(P0_SOURCE), decompile(direct.signature), decompile(syncRow.signature)]);
  const start = p0.message.instructions.find((ix) => matching(ix, MARGINFI, START));
  const end = p0.message.instructions.find((ix) => matching(ix, MARGINFI, END));
  const borrow = p0.message.instructions.find((ix) => matching(ix, MARGINFI, BORROW));
  const repay = p0.message.instructions.find((ix) => matching(ix, MARGINFI, REPAY));
  if (!start || !end || !borrow || !repay) throw new Error('Marginfi flash source incomplete');
  const actor = borrow.keys[2].pubkey;
  if (!actor.equals(p0.payer)) throw new Error('source payer is not flash authority');
  const sourceAta = getAssociatedTokenAddressSync(WSOL, actor);
  const infAta = getAssociatedTokenAddressSync(INF_MINT, actor);
  const parts = {start: clone(start), end: clone(end), borrow: clone(borrow), repay: clone(repay)};
  parts.borrow.keys[4].pubkey = sourceAta;
  parts.repay.keys[4].pubkey = sourceAta;
  const createSource = createAssociatedTokenAccountIdempotentInstruction(actor, sourceAta, actor, WSOL);
  const createInf = createAssociatedTokenAccountIdempotentInstruction(actor, infAta, actor, INF_MINT);

  const v2 = infControl.message.instructions.find((ix) => ix.programId.equals(INF) && ix.data[0] === 23);
  const sync = syncControl.message.instructions.find((ix) => ix.programId.equals(INF) && ix.data[0] === 0 && ix.data.readUInt32LE(1) === 1);
  if (!v2 || !sync) throw new Error('decompiled INF controls missing');
  const liqKeys = [
    {...v2.keys[0], pubkey: actor},
    {...v2.keys[1]},
    {...v2.keys[3], pubkey: sourceAta},
    {...v2.keys[4], pubkey: infAta},
    {...v2.keys[2]},
    {pubkey: POOL, isSigner: false, isWritable: true},
    {...v2.keys[5]},
    {...v2.keys[6]},
    {...v2.keys[7]},
    {...v2.keys[8]},
    {...v2.keys[9]},
    {...v2.keys[11]},
    {...v2.keys[13]},
    {...v2.keys[14]},
  ];
  const addIx = (amount) => new TransactionInstruction({programId: INF, keys: liqKeys.map((key) => ({...key})), data: liquidityData(3, amount)});
  const removeIx = (amount) => new TransactionInstruction({programId: INF, keys: liqKeys.map((key) => ({...key})), data: liquidityData(4, amount)});

  const marginfiAccount = parts.borrow.keys[1].pubkey;
  const bank = parts.borrow.keys[3].pubkey;
  const marginfiVault = parts.borrow.keys[6].pubkey;
  const infReserve = v2.keys[9].pubkey;
  const specs = [
    {address: actor, kind: 'system', label: 'flash authority wallet'},
    {address: sourceAta, kind: 'token', label: 'flash authority wSOL ATA'},
    {address: infAta, kind: 'token', label: 'flash authority INF ATA'},
    {address: marginfiVault, kind: 'token', label: 'Marginfi wSOL liquidity vault'},
    {address: marginfiAccount, kind: 'marginfi', label: 'Marginfi debt account', bank},
    {address: bank, kind: 'raw', label: 'Marginfi wSOL bank'},
    {address: infReserve, kind: 'token', label: 'INF wSOL reserve'},
    {address: INF_MINT, kind: 'mint', label: 'INF share mint'},
    {address: POOL, kind: 'pool', label: 'INF pool state'},
  ];
  const vaultInfo = await conn.getParsedAccountInfo(marginfiVault, 'processed');
  const vaultMint = vaultInfo.value?.data?.parsed?.info?.mint;
  const vaultAvailable = BigInt(vaultInfo.value?.data?.parsed?.info?.tokenAmount?.amount || 0);
  if (vaultMint !== WSOL.toBase58() || vaultAvailable <= 2n) throw new Error(`Marginfi source is not a live wSOL vault: ${vaultMint}/${vaultAvailable}`);

  const controls = [];
  const prefix = [createSource];
  const baseline = async (amount, exact = false) => simulate(`Marginfi v1 wSOL flash borrow+repay ${amount}`, actor, flashInstructions(parts, amount, [], prefix), specs, exact);
  controls.push(await baseline(1n));
  controls.push(await baseline(2n, true));

  // Find the current exact utilization ceiling by monotone binary search. A
  // successful amount always includes a complete repay and EndFlashloan.
  let low = 2n;
  let high = vaultAvailable;
  const thresholdTrace = [];
  while (low + 1n < high) {
    const mid = (low + high) / 2n;
    const result = await baseline(mid);
    thresholdTrace.push({amountRaw: mid.toString(), err: result.err, unitsConsumed: result.unitsConsumed, contextSlot: result.simulationContextSlot});
    if (result.err == null) low = mid;
    else high = mid;
  }
  const boundarySuccessRecheck = await baseline(low, true);
  const boundaryFailureRecheck = await baseline(high, true);
  // The bank accrues between processed slots, so an adjacent boundary found at
  // slot N may move before it is rechecked at N+1. Preserve both observations
  // and also run a comfortably near-capacity control that is stable across the
  // few slots occupied by this read-only search.
  const nearCapacityAmount = vaultAvailable * 99n / 100n;
  const nearCapacityControl = await baseline(nearCapacityAmount, true);
  controls.push(boundarySuccessRecheck, boundaryFailureRecheck, nearCapacityControl);

  async function quoteAdd(amount) {
    return simulate(`standalone funded INF add-liquidity quote ${amount}`, actor, [
      createSource,
      createInf,
      SystemProgram.transfer({fromPubkey: actor, toPubkey: sourceAta, lamports: amount}),
      createSyncNativeInstruction(sourceAta),
      addIx(amount),
    ], specs);
  }

  const quoteAmounts = [1n, 2n, 3n, 4n, 10n, 100n, 1_000n, 10_000n, 10_000_000n];
  const quoteCases = [];
  const quoteMinted = new Map();
  for (const amount of quoteAmounts) {
    const result = await quoteAdd(amount);
    quoteCases.push(result);
    const after = rawToken(result, infAta, 'after');
    const before = rawToken(result, infAta, 'before') || '0';
    if (result.err == null && after != null) quoteMinted.set(amount.toString(), BigInt(after) - BigInt(before));
  }

  const compositions = [];
  async function compose(label, amount, buffer, middleBuilder, exact = false) {
    const prefixIxs = [
      createSource,
      createInf,
      SystemProgram.transfer({fromPubkey: actor, toPubkey: sourceAta, lamports: buffer}),
      createSyncNativeInstruction(sourceAta),
    ];
    const middle = middleBuilder();
    return simulate(label, actor, flashInstructions(parts, amount, middle, prefixIxs), specs, exact);
  }

  let tenMillionControl = null;
  for (const [amount, buffer] of [[2n, 10n], [10_000_000n, 100_000n]]) {
    const minted = quoteMinted.get(amount.toString());
    if (minted == null || minted <= 0n) {
      compositions.push({label: `flash-INF round trip ${amount}`, localBlocker: 'funded add-liquidity did not produce a positive share quote'});
      continue;
    }
    const result = await compose(
      `v1 Marginfi wSOL flash -> INF add/remove -> full repay ${amount}`,
      amount,
      buffer,
      () => [addIx(amount), removeIx(minted)],
      true,
    );
    compositions.push(result);
    if (amount === 10_000_000n) tenMillionControl = result;
  }

  const repeatedAmount = 10_000_000n;
  const repeatedMinted = quoteMinted.get(repeatedAmount.toString());
  if (repeatedMinted && repeatedMinted > 0n) {
    const observedRemaining = tenMillionControl?.err == null ? BigInt(rawToken(tenMillionControl, sourceAta, 'after') || 0) : null;
    const exactSpread = observedRemaining == null ? null : 100_000n - observedRemaining;
    if (exactSpread != null && exactSpread > 0n) {
      compositions.push(await compose(
        `v1 flash exact INF spread buffer ${exactSpread}`,
        repeatedAmount,
        exactSpread,
        () => [addIx(repeatedAmount), removeIx(repeatedMinted)],
        true,
      ));
      compositions.push(await compose(
        `v1 flash one-lamport-short INF spread buffer ${exactSpread - 1n}`,
        repeatedAmount,
        exactSpread - 1n,
        () => [addIx(repeatedAmount), removeIx(repeatedMinted)],
      ));
    }
    compositions.push(await compose(
      'v1 flash with two repeated INF add/remove cycles',
      repeatedAmount,
      200_000n,
      () => [addIx(repeatedAmount), removeIx(repeatedMinted), addIx(repeatedAmount), removeIx(repeatedMinted)],
      true,
    ));
    compositions.push(await compose(
      'v1 flash with INF sync before/between/after add/remove',
      repeatedAmount,
      100_000n,
      () => [clone(sync), addIx(repeatedAmount), clone(sync), removeIx(repeatedMinted), clone(sync)],
      true,
    ));
    compositions.push(await compose(
      'v1 flash INF remove-before-add order mutation',
      repeatedAmount,
      100_000n,
      () => [removeIx(repeatedMinted), addIx(repeatedAmount)],
    ));
    compositions.push(await compose(
      'v1 flash INF account alias mutation',
      repeatedAmount,
      100_000n,
      () => {
        const badAdd = addIx(repeatedAmount);
        badAdd.keys[3].pubkey = sourceAta;
        return [badAdd, removeIx(repeatedMinted)];
      },
    ));
    compositions.push(await compose(
      'v1 flash INF add without remove before full repay',
      repeatedAmount,
      100_000n,
      () => [addIx(repeatedAmount)],
    ));
    // Near Marginfi's live capacity, the actor's entire practical SOL buffer is
    // far below INF's round-trip spread. This is the concrete blocker to a
    // successful near-capacity target composition, not a packet/account/CU
    // limit: the terminal repay must and does reject it atomically.
    const nearCapacityMinted = BigInt(nearCapacityAmount) * repeatedMinted / repeatedAmount;
    compositions.push(await compose(
      `near-capacity v1 INF round trip ${nearCapacityAmount} with 70000000 buffer`,
      nearCapacityAmount,
      70_000_000n,
      () => [addIx(nearCapacityAmount), removeIx(nearCapacityMinted)],
      true,
    ));
  }

  const output = {
    generatedAt: new Date().toISOString(),
    safety: 'read-only current-mainnet get* RPC and simulateTransaction only; unsigned packets; no send method',
    submittedTransactions: 0,
    sources: {
      marginfi: {signature: P0_SOURCE, slot: p0.slot, blockTime: p0.blockTime},
      infSwap: {signature: direct.signature, slot: infControl.slot, blockTime: infControl.blockTime},
      infSync: {signature: syncRow.signature, slot: syncControl.slot, blockTime: syncControl.blockTime},
    },
    accounts: {
      flashAuthority: actor.toBase58(),
      marginfiAccount: marginfiAccount.toBase58(),
      marginfiBank: bank.toBase58(),
      marginfiLiquidityVault: marginfiVault.toBase58(),
      marginfiLiquidityVaultMint: vaultMint,
      flashDestinationAndRepaySource: sourceAta.toBase58(),
      infShareAccount: infAta.toBase58(),
      infWsolReserve: infReserve.toBase58(),
      infMint: INF_MINT.toBase58(),
      infPool: POOL.toBase58(),
    },
    liveLiquidity: {
      observedMarginfiVaultRaw: vaultAvailable.toString(),
      highestObservedSuccessfulBorrowRaw: low.toString(),
      firstObservedFailingBorrowRaw: high.toString(),
      boundarySuccessObservedAtSlot: thresholdTrace.filter((row) => row.err == null).at(-1)?.contextSlot || null,
      boundaryFailureObservedAtSlot: thresholdTrace.filter((row) => row.err != null).at(-1)?.contextSlot || null,
      boundarySuccessRecheckErr: boundarySuccessRecheck.err,
      boundaryFailureRecheckErr: boundaryFailureRecheck.err,
      movingStateCaveat: 'processed-state interest/utilization accrues between slots; adjacent observations are exact per recorded slot but the ceiling can move before recheck',
      stableNearCapacityBorrowRaw: nearCapacityAmount.toString(),
      stableNearCapacityErr: nearCapacityControl.err,
      thresholdSearchIterations: thresholdTrace.length,
      thresholdTrace,
    },
    baselineControls: controls,
    infShareQuotes: quoteCases,
    compositions,
  };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({
    out: OUT,
    accounts: output.accounts,
    liveLiquidity: {observed: output.liveLiquidity.observedMarginfiVaultRaw, highestObservedSuccess: output.liveLiquidity.highestObservedSuccessfulBorrowRaw, firstObservedFailure: output.liveLiquidity.firstObservedFailingBorrowRaw, stableNearCapacity: output.liveLiquidity.stableNearCapacityBorrowRaw, stableNearCapacityErr: output.liveLiquidity.stableNearCapacityErr, iterations: thresholdTrace.length},
    controls: controls.map((row) => ({label: row.label, err: row.err, cu: row.unitsConsumed, bytes: row.message.wireBytes})),
    quotes: quoteCases.map((row) => ({label: row.label, err: row.err, infAfter: rawToken(row, infAta, 'after')})),
    compositions: compositions.map((row) => ({label: row.label, err: row.err, localBlocker: row.localBlocker, cu: row.unitsConsumed, bytes: row.message?.wireBytes, accounts: row.message?.accountCount})),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
