// Read-only Solana v1 composition replay. Never sends a transaction.
// v1 wire format: https://solana.com/docs/core/transactions/versioned-transactions
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, TransactionInstruction, TransactionMessage,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');

const env = Object.fromEntries((fs.existsSync('/tmp/composer-helius-only.env') ?
  fs.readFileSync('/tmp/composer-helius-only.env', 'utf8') : '')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = process.env.HEAVY_RPC_URL || process.env.RPC_URL || env.HEAVY_RPC_URL ||
  env.RPC_URL || 'https://api.mainnet-beta.solana.com';
if (!rpcUrl) throw new Error('No read-only RPC configured');
const conn = new Connection(rpcUrl, 'confirmed');
const P = value => new PublicKey(value);
const klend = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const vaultProgram = P('24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi');
const tokenProgram = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const owner = P('B36gY52xxE5jTm77CcPiemtpqEnif6Lcw3Qh2TcjdZY1');
const outsider = P('6mgztPM3Br7Sn8Jqe49jT2RRMmZbMRK6iH2xRZ6XVLL3');
const vault = P('3ESUFCnRNgZ7Mn2mPPUMmXYaKU8jpnV9VtA17M7t2mHQ');
const vaultToken = P('C2QoQ111jGHEy5918XkNXQro7gGwC9PKLXd1LqBiYNwA');
const lpMint = P('3RpEekjLE5cdcG15YcXJUpxSepemvq2FpmMcgo342BwC');
const ownerToken = P('3rYyUVvjsgXAVqTQc2QVudZZx4tCtz7eXyaQavQarCnf');
const ownerLp = P('EB2N1HtcsFhx1MLs9VgiExoU2AsrMxPbZvCGD7s2yihQ');
const flashAmount = 100000n;
const lpExitAmount = 100000n;
const source = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/kamino-flash-history.json'));
const sample = source.hits[0].transaction;
const msg = sample.transaction.message;
const staticKeys = msg.accountKeys;
const allKeys = [...staticKeys, ...(sample.meta.loadedAddresses?.writable || []),
  ...(sample.meta.loadedAddresses?.readonly || [])];
const head = msg.header;
const flashSupply = P(allKeys[msg.instructions[3].accounts[5]]);
const flashFeeVault = P(allKeys[msg.instructions[3].accounts[7]]);
const flashReserve = P(allKeys[msg.instructions[3].accounts[3]]);
const traceAddresses = [ownerToken, ownerLp, vaultToken, lpMint,
  flashSupply, flashFeeVault, flashReserve, vault];
const writable = idx => idx < staticKeys.length ?
  (idx < head.numRequiredSignatures ? idx < head.numRequiredSignatures - head.numReadonlySignedAccounts :
    idx < staticKeys.length - head.numReadonlyUnsignedAccounts) :
  idx < staticKeys.length + (sample.meta.loadedAddresses?.writable?.length || 0);
const sampleIx = idx => {
  const src = msg.instructions[idx];
  return new TransactionInstruction({programId: P(allKeys[src.programIdIndex]),
    keys: src.accounts.map(i => ({pubkey: P(allKeys[i]), isSigner: i < head.numRequiredSignatures,
      isWritable: writable(i)})), data: Buffer.from(bs58.decode(src.data))});
};
const copyIx = (ix, keys, data) => new TransactionInstruction({programId: ix.programId,
  keys: keys || ix.keys.map(x => ({...x})), data: data || Buffer.from(ix.data)});
const setFlash = (ix, amount, repayIndex, destination) => {
  const keys = ix.keys.map(x => ({...x}));
  keys[0].pubkey = owner; // The SPL transfer authority must own the new destination.
  keys[6].pubkey = destination;
  const data = Buffer.from(ix.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return copyIx(ix, keys, data);
};
const u64 = x => { const b = Buffer.alloc(8); b.writeBigUInt64LE(x); return b; };
const disc = x => crypto.createHash('sha256').update('global:' + x).digest().subarray(0, 8);
const vaultIx = (name, amount, user = owner, destination = ownerToken) =>
  new TransactionInstruction({programId: vaultProgram, keys: [
    {pubkey: vault, isSigner: false, isWritable: true},
    {pubkey: vaultToken, isSigner: false, isWritable: true},
    {pubkey: lpMint, isSigner: false, isWritable: true},
    {pubkey: destination, isSigner: false, isWritable: true},
    {pubkey: ownerLp, isSigner: false, isWritable: true},
    {pubkey: user, isSigner: true, isWritable: false},
    {pubkey: tokenProgram, isSigner: false, isWritable: false},
  ], data: Buffer.concat([disc(name), u64(amount), u64(0n)])});

// web3.js 1.99 compiles account ordering and privileges but does not emit v1.
// Translate its no-ALT v0 message to the documented v1 wire format.
function encodeV1(instructions, payer, blockhash, computeLimit = 1400000, dataLimit = 67108864) {
  const v0 = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  // Size the equivalent v0 wire without serializing it: web3.js 1.x preallocates
  // the old 1,232-byte packet and throws on larger messages.
  const sv = n => n < 128 ? 1 : n < 16384 ? 2 : 3;
  const v0Bytes = sv(v0.header.numRequiredSignatures) +
    64 * v0.header.numRequiredSignatures + 1 + 3 + sv(v0.staticAccountKeys.length) +
    32 * v0.staticAccountKeys.length + 32 + sv(v0.compiledInstructions.length) +
    v0.compiledInstructions.reduce((sum, ix) => sum + 1 +
      sv(ix.accountKeyIndexes.length) + ix.accountKeyIndexes.length +
      sv(ix.data.length) + ix.data.length, 0) + sv(0);
  if (v0.addressTableLookups.length) throw new Error('v1 has no ALTs');
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64) throw new Error('Current v1 address/instruction limit');
  const cfg = Buffer.alloc(8);
  cfg.writeUInt32LE(computeLimit, 0);
  cfg.writeUInt32LE(dataLimit, 4);
  const ixHeads = items.map(ix => {
    const out = Buffer.alloc(4);
    out[0] = ix.programIdIndex;
    out[1] = ix.accountKeyIndexes.length;
    out.writeUInt16LE(ix.data.length, 2);
    return out;
  });
  const ixPayloads = items.map(ix => Buffer.concat([
    Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data),
  ]));
  const wire = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures,
      v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]), // config bits 2+3: CU and loaded-account bytes
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]),
    ...keys.map(x => x.toBuffer()), cfg, ...ixHeads, ...ixPayloads,
    Buffer.alloc(64 * v0.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error('v1 size limit: ' + wire.length);
  return {wire, sizeBytes: wire.length, v0Bytes, addressCount: keys.length,
    writableCount: keys.length - v0.header.numReadonlySignedAccounts -
      v0.header.numReadonlyUnsignedAccounts,
    instructionCount: items.length, requiredSignatures: v0.header.numRequiredSignatures,
    config: {computeLimit, dataLimit}};
}
const amount = (a, i) => {
  if (!a?.data) return null;
  const data = Buffer.from(a.data[0], 'base64');
  if (i === 6 || i === 7) return crypto.createHash('sha256').update(data).digest('hex');
  if (a.owner !== tokenProgram.toBase58()) return null;
  if (i === 3) return data.readBigUInt64LE(36).toString(); // SPL Mint supply
  return data.readBigUInt64LE(64).toString(); // SPL Token account amount
};
const image = accounts => Object.fromEntries(traceAddresses.map((a, i) =>
  [a.toBase58(), amount(accounts?.[i], i)]));
async function simulate(label, instructions, payer, blockhash) {
  const e = encodeV1(instructions, payer, blockhash);
  const req = {jsonrpc: '2.0', id: label, method: 'simulateTransaction', params: [
    e.wire.toString('base64'), {encoding: 'base64', sigVerify: false,
      replaceRecentBlockhash: true, commitment: 'confirmed',
      accounts: {encoding: 'base64', addresses: traceAddresses.map(x => x.toBase58())}},
  ]};
  const response = await fetch(rpcUrl, {method: 'POST',
    headers: {'content-type': 'application/json'}, body: JSON.stringify(req)});
  const json = await response.json();
  const v = json.result?.value;
  return {label, sourceSignature: source.hits[0].signature, slot: json.result?.context?.slot,
    transportError: json.error || null, err: v?.err || null, sizeBytes: e.sizeBytes,
    v0Bytes: e.v0Bytes,
    addressCount: e.addressCount, writableCount: e.writableCount,
    instructionCount: e.instructionCount, requiredSignatures: e.requiredSignatures,
    config: e.config, unitsConsumed: v?.unitsConsumed, loadedAccountsDataSize: v?.loadedAccountsDataSize,
    post: image(v?.accounts), logs: v?.logs?.filter(s =>
      s.includes('Instruction:') || s.includes('failed') || s.includes('success') ||
      s.includes('Program log:')).slice(-35)};
}

async function main() {
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const originalBorrow = sampleIx(3);
  const originalRepay = sampleIx(13);
  if (!originalBorrow.programId.equals(klend) || !originalRepay.programId.equals(klend))
    throw new Error('Historical flash instruction indexes changed');
  const borrow = setFlash(originalBorrow, flashAmount, undefined, ownerToken);
  const deposit = vaultIx('deposit', flashAmount);
  const withdraw = vaultIx('withdraw', lpExitAmount);
  const outsiderWithdraw = vaultIx('withdraw', lpExitAmount, outsider);
  const specs = [
    ['flash_pair_v1', [borrow, setFlash(originalRepay, flashAmount, 0, ownerToken)], owner],
    ['vault_withdraw_control_v1', [withdraw], owner],
    ['vault_deposit_without_flash_v1', [deposit], owner],
    ['flash_deposit_withdraw_repay_v1', [borrow, deposit, withdraw,
      setFlash(originalRepay, flashAmount, 0, ownerToken)], owner],
    ['flash_deposit_no_withdraw_repay_v1', [borrow, deposit,
      setFlash(originalRepay, flashAmount, 0, ownerToken)], owner],
    ['flash_withdraw_deposit_repay_v1', [borrow, withdraw, deposit,
      setFlash(originalRepay, flashAmount, 0, ownerToken)], owner],
    ['withdraw_flash_deposit_repay_v1', [withdraw, borrow, deposit,
      setFlash(originalRepay, flashAmount, 1, ownerToken)], owner],
    ['flash_deposit_outsider_withdraw_repay_v1', [borrow, deposit, outsiderWithdraw,
      setFlash(originalRepay, flashAmount, 0, ownerToken)], outsider],
  ];
  const cycles = n => [borrow, ...Array.from({length: n}, () => [deposit, withdraw]).flat(),
    setFlash(originalRepay, flashAmount, 0, ownerToken)];
  for (const n of [7, 8, 9, 10, 11])
    specs.push([`flash_${n}_vault_cycles_v1`, cycles(n), owner]);
  specs.push(['flash_12_vault_cycles_v1', cycles(12), owner]);
  specs.push(['flash_20_vault_cycles_v1', cycles(20), owner]);
  specs.push(['flash_31_vault_cycles_v1', cycles(31), owner]);
  specs.push(['flash_8_vault_cycles_outsider_exit_v1',
    [...cycles(8).slice(0, -1), outsiderWithdraw,
      setFlash(originalRepay, flashAmount, 0, ownerToken)], outsider]);
  specs.push(['flash_8_vault_cycles_wrong_repay_index_v1',
    [...cycles(8).slice(0, -1),
      setFlash(originalRepay, flashAmount, 1, ownerToken)], owner]);
  const results = [];
  for (const [label, instructions, payer] of specs) {
    try {
      const result = await simulate(label, instructions, payer, blockhash);
      results.push(result);
      console.log(JSON.stringify({label, err: result.err, transportError: result.transportError,
        sizeBytes: result.sizeBytes, v0Bytes: result.v0Bytes,
        addressCount: result.addressCount,
        unitsConsumed: result.unitsConsumed, post: result.post, logs: result.logs?.slice(-5)}));
    } catch (e) {
      results.push({label, localError: e.stack});
      console.log(JSON.stringify({label, localError: e.message}));
    }
  }
  fs.writeFileSync('composer-runs/2026-10-15/klend-v1-composition.json',
    JSON.stringify({timestamp: new Date().toISOString(), programIds:
      {klend: klend.toBase58(), vault: vaultProgram.toBase58()}, sourceSlot: source.hits[0].slot,
      signerVerification: false, liveSubmission: false, flashAmount: String(flashAmount),
      lpExitAmount: String(lpExitAmount), traceAddresses: traceAddresses.map(x => x.toBase58()),
      results}, null, 2));
}
if (require.main === module)
  main().catch(e => {console.error(e.stack); process.exitCode = 1;});
module.exports = {encodeV1};
