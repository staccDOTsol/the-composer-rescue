const fs = require('fs');
const crypto = require('crypto');
const {Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction} =
  require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const source = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/kamino-flash-history.json'));
const hit = source.hits[0];
const sample = hit.transaction;
const message = sample.transaction.message;
const staticKeys = message.accountKeys;
const allKeys = [...staticKeys, ...(sample.meta.loadedAddresses?.writable || []),
  ...(sample.meta.loadedAddresses?.readonly || [])];
const header = message.header;
const payer = new PublicKey(staticKeys[0]);
const programId = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const tokenId = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const amount = 100000n;
const outgoingAmount = 1000000n;

function isSigner(index) { return index < header.numRequiredSignatures; }
function isWritable(index) {
  if (index < staticKeys.length) {
    if (isSigner(index)) return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
    return index < staticKeys.length - header.numReadonlyUnsignedAccounts;
  }
  return index < staticKeys.length + (sample.meta.loadedAddresses?.writable?.length || 0);
}
function fromSample(index) {
  const ix = message.instructions[index];
  return new TransactionInstruction({programId: new PublicKey(allKeys[ix.programIdIndex]),
    data: Buffer.from(bs58.decode(ix.data)), keys: ix.accounts.map(j =>
      ({pubkey: new PublicKey(allKeys[j]), isSigner: isSigner(j), isWritable: isWritable(j)}))});
}
function copy(ix, mutate) {
  const keys = ix.keys.map(m => ({...m}));
  const data = Buffer.from(ix.data);
  mutate(keys, data);
  return new TransactionInstruction({programId: ix.programId, keys, data});
}
function withAmount(ix, n) { return copy(ix, (_keys, data) => data.writeBigUInt64LE(n, 8)); }
function withRepayIndex(ix, n) { return copy(ix, (_keys, data) => { data[16] = n; }); }
function keyAt(ix, index, publicKey) { return copy(ix, keys => { keys[index].pubkey = publicKey; }); }
const originalBorrow = fromSample(3);
const originalRepay = fromSample(13);
const borrow = withAmount(originalBorrow, amount);
const repay = withRepayIndex(withAmount(originalRepay, amount), 0);
const reserve = borrow.keys[3].pubkey;
const supply = borrow.keys[5].pubkey;
const userToken = borrow.keys[6].pubkey;
const feeVault = borrow.keys[7].pubkey;
const otherToken = new PublicKey('2FT1zp7qKxtRC2gMWE3S5y5MG345dM4Y2u5wKTZYvm4i');
const monitor = [supply, userToken, feeVault, reserve, otherToken];
const connection = new Connection(rpcUrl, 'confirmed');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const summary = (data, i) => i === 3 ? hash(data) : data.length >= 72 ? String(data.readBigUInt64LE(64)) : hash(data);

async function simulate(label, instructions, before, blockhash) {
  const tx = new VersionedTransaction(new TransactionMessage({payerKey: payer,
    recentBlockhash: blockhash, instructions}).compileToV0Message());
  const req = {jsonrpc: '2.0', id: 1, method: 'simulateTransaction',
    params: [Buffer.from(tx.serialize()).toString('base64'),
      {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
        commitment: 'confirmed', accounts: {encoding: 'base64', addresses: monitor.map(x => x.toBase58())}}]};
  const raw = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(req)});
  const json = await raw.json();
  if (json.error) throw Error(JSON.stringify(json.error));
  const value = json.result.value;
  const after = Object.fromEntries(monitor.map((key, i) => {
    const row = value.accounts?.[i];
    return [key.toBase58(), row ? summary(Buffer.from(row.data[0], 'base64'), i) : null];
  }));
  const deltas = Object.fromEntries(monitor.filter((_, i) => i !== 3).map(key => {
    const address = key.toBase58();
    return [address, before[address] != null && after[address] != null ?
      String(BigInt(after[address]) - BigInt(before[address])) : null];
  }));
  const reserveAfter = after[reserve.toBase58()];
  const result = {label, slot: json.result.context.slot, err: value.err, unitsConsumed: value.unitsConsumed,
    logs: value.logs, after, deltas, reserveStateChanged: reserveAfter == null ? null :
      before[reserve.toBase58()] !== reserveAfter};
  console.log(JSON.stringify({label, slot: result.slot, err: result.err, deltas, reserveStateChanged: result.reserveStateChanged,
    tail: result.logs?.filter(line => line.includes('Program log:') || line.includes('failed:')).slice(-7)}));
  return result;
}

(async () => {
  const pre = await connection.getMultipleAccountsInfoAndContext(monitor, 'confirmed');
  const before = Object.fromEntries(monitor.map((key, i) =>
    [key.toBase58(), pre.value[i] ? summary(pre.value[i].data, i) : null]));
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const transferData = Buffer.alloc(9);
  transferData[0] = 3;
  transferData.writeBigUInt64LE(outgoingAmount, 1);
  const transfer = new TransactionInstruction({programId: tokenId, data: transferData,
    keys: [{pubkey: userToken, isWritable: true, isSigner: false},
      {pubkey: otherToken, isWritable: true, isSigner: false},
      {pubkey: payer, isWritable: false, isSigner: true}]});
  const largeBorrow = withAmount(borrow, outgoingAmount);
  const largeRepay = withAmount(repay, outgoingAmount);
  const cases = [
    ['positive_direct_pair', [borrow, repay]],
    ['borrow_without_repay', [borrow]],
    ['repay_before_borrow', [withRepayIndex(repay, 1), borrow]],
    ['repay_wrong_borrow_index', [borrow, withRepayIndex(repay, 1)]],
    ['repay_amount_minus_one', [borrow, withAmount(repay, amount - 1n)]],
    ['duplicate_borrow', [borrow, borrow, withRepayIndex(repay, 0)]],
    ['duplicate_repay', [borrow, repay, repay]],
    ['repay_other_destination', [borrow, keyAt(repay, 6, otherToken)]],
    ['repay_other_fee_vault', [borrow, keyAt(repay, 7, otherToken)]],
    ['borrow_destination_aliases_supply', [keyAt(borrow, 6, supply), keyAt(repay, 6, supply)]],
    ['borrow_transfer_away_then_unfunded_repay', [largeBorrow, transfer, largeRepay]],
  ];
  const results = [];
  for (const [label, instructions] of cases) {
    try { results.push(await simulate(label, instructions, before, blockhash)); }
    catch (e) { results.push({label, transportError: e.message}); console.log(JSON.stringify({label, transportError: e.message})); }
  }
  const output = {timestamp: new Date().toISOString(), sourceSignature: hit.signature, sourceSlot: hit.slot,
    sampledProgram: programId.toBase58(), preSlot: pre.context.slot, signerVerification: false,
    requestedAmountRaw: String(amount), largeAmountRaw: String(outgoingAmount),
    accounts: {payer: payer.toBase58(), reserve: reserve.toBase58(), supply: supply.toBase58(),
      userToken: userToken.toBase58(), feeVault: feeVault.toBase58(), otherToken: otherToken.toBase58()},
    before, results};
  fs.writeFileSync('composer-runs/2026-10-15/kamino-flash-mutation.json', JSON.stringify(output, null, 2));
})().catch(e => {console.error(e.stack); process.exitCode = 1});
