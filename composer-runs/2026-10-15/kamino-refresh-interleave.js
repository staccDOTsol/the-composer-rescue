const fs = require('fs');
const crypto = require('crypto');
const {Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction} =
  require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const flash = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/kamino-flash-history.json')).hits[0];
const refresh = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/kamino-direct-refresh-samples.json')).hits[0];
const disc = '02da8aeb4fc91966';
const program = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const payer = new PublicKey(flash.transaction.transaction.message.accountKeys[0]);
const connection = new Connection(rpcUrl, 'confirmed');
function fromSample(sample, index) {
  const tx = sample.transaction;
  const msg = tx.transaction.message;
  const staticKeys = msg.accountKeys;
  const writableLoaded = tx.meta.loadedAddresses?.writable || [];
  const allKeys = [...staticKeys, ...writableLoaded, ...(tx.meta.loadedAddresses?.readonly || [])];
  const header = msg.header;
  const ix = msg.instructions[index];
  const signer = j => j < header.numRequiredSignatures;
  const writable = j => j < staticKeys.length ? (signer(j) ?
    j < header.numRequiredSignatures - header.numReadonlySignedAccounts :
    j < staticKeys.length - header.numReadonlyUnsignedAccounts) :
    j < staticKeys.length + writableLoaded.length;
  return new TransactionInstruction({programId: new PublicKey(allKeys[ix.programIdIndex]),
    data: Buffer.from(bs58.decode(ix.data)),
    keys: ix.accounts.map(j => ({pubkey: new PublicKey(allKeys[j]), isSigner: signer(j), isWritable: writable(j)}))});
}
function withAmount(ix, amount, repayIndex) {
  const data = Buffer.from(ix.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: ix.programId, keys: ix.keys, data});
}
const sourceBorrow = fromSample(flash, 3);
const sourceRepay = fromSample(flash, 13);
const amount = 100000n;
const borrow = withAmount(sourceBorrow, amount);
const reserve = sourceBorrow.keys[3].pubkey;
const supply = sourceBorrow.keys[5].pubkey;
const userToken = sourceBorrow.keys[6].pubkey;
const feeVault = sourceBorrow.keys[7].pubkey;
const msg = refresh.transaction.transaction.message;
const keys = [...msg.accountKeys, ...(refresh.transaction.meta.loadedAddresses?.writable || []),
  ...(refresh.transaction.meta.loadedAddresses?.readonly || [])];
const refreshIndex = msg.instructions.findIndex(ix =>
  keys[ix.programIdIndex] === program &&
  Buffer.from(bs58.decode(ix.data)).toString('hex').startsWith(disc) &&
  keys[ix.accounts[0]] === reserve.toBase58());
if (refreshIndex < 0) throw Error('No direct refresh of flash-loan reserve');
const refreshIx = fromSample(refresh, refreshIndex);
const monitor = [supply, userToken, feeVault, reserve];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function summary(data, index) { return index === 3 ? hash(data) : String(data.readBigUInt64LE(64)); }
function reserveFields(data) {
  return {lastUpdateSlot: String(data.readBigUInt64LE(16)), stale: data[24],
    totalAvailable: String(data.readBigUInt64LE(224)),
    borrowedAmountSfHex: data.subarray(232, 248).toString('hex'),
    marketPriceSfHex: data.subarray(248, 264).toString('hex')};
}
async function simulate(label, instructions, before, blockhash) {
  const tx = new VersionedTransaction(new TransactionMessage({payerKey: payer,
    recentBlockhash: blockhash, instructions}).compileToV0Message());
  const request = {jsonrpc: '2.0', id: 1, method: 'simulateTransaction',
    params: [Buffer.from(tx.serialize()).toString('base64'),
      {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
        commitment: 'confirmed', accounts: {encoding: 'base64', addresses: monitor.map(x => x.toBase58())}}]};
  const reply = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify(request)}).then(response => response.json());
  if (reply.error) throw Error(JSON.stringify(reply.error));
  const value = reply.result.value;
  const after = Object.fromEntries(monitor.map((key, i) => [key.toBase58(), value.accounts?.[i] ?
    summary(Buffer.from(value.accounts[i].data[0], 'base64'), i) : null]));
  const deltas = Object.fromEntries(monitor.slice(0, 3).map(key => [key.toBase58(),
    after[key.toBase58()] == null ? null : String(BigInt(after[key.toBase58()]) - BigInt(before[key.toBase58()]))]));
  const reserveData = value.accounts?.[3] ? Buffer.from(value.accounts[3].data[0], 'base64') : null;
  return {label, slot: reply.result.context.slot, err: value.err, unitsConsumed: value.unitsConsumed,
    deltas, reserveStateChanged: after[reserve.toBase58()] == null ? null :
      after[reserve.toBase58()] !== before[reserve.toBase58()],
    reserveFields: reserveData ? reserveFields(reserveData) : null, logs: value.logs};
}
(async () => {
  const pre = await connection.getMultipleAccountsInfoAndContext(monitor, 'confirmed');
  const before = Object.fromEntries(monitor.map((key, i) => [key.toBase58(), summary(pre.value[i].data, i)]));
  const reserveBeforeFields = reserveFields(pre.value[3].data);
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const cases = [
    ['baseline_pair', [borrow, withAmount(sourceRepay, amount, 0)]],
    ['refresh_before_borrow', [refreshIx, borrow, withAmount(sourceRepay, amount, 1)]],
    ['refresh_between_pair', [borrow, refreshIx, withAmount(sourceRepay, amount, 0)]],
    ['refresh_twice_between_pair', [borrow, refreshIx, refreshIx, withAmount(sourceRepay, amount, 0)]],
    ['refresh_after_pair', [borrow, withAmount(sourceRepay, amount, 0), refreshIx]],
  ];
  const results = [];
  for (const [label, instructions] of cases) {
    try {
      const result = await simulate(label, instructions, before, blockhash);
      results.push(result);
      console.log(JSON.stringify({label, slot: result.slot, err: result.err, deltas: result.deltas,
        reserveStateChanged: result.reserveStateChanged, reserveFields: result.reserveFields,
        tail: result.logs?.filter(line => line.includes('Program log:') || line.includes('failed:')).slice(-7)}));
    } catch (error) {
      results.push({label, transportError: error.message});
      console.log(JSON.stringify({label, transportError: error.message}));
    }
  }
  fs.writeFileSync('composer-runs/2026-10-15/kamino-refresh-interleave.json', JSON.stringify({
    timestamp: new Date().toISOString(), program, sourceFlashSignature: flash.signature,
    sourceRefreshSignature: refresh.signature, preSlot: pre.context.slot, signerVerification: false,
    accounts: {payer: payer.toBase58(), reserve: reserve.toBase58(), supply: supply.toBase58(),
      userToken: userToken.toBase58(), feeVault: feeVault.toBase58()}, before, reserveBeforeFields,
    results}, null, 2));
})().catch(error => {console.error(error.stack); process.exitCode = 1});
