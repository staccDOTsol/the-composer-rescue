const fs = require('fs');
const crypto = require('crypto');
const {Connection, PublicKey, VersionedTransaction} =
  require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const historyEnv = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const historyUrl = historyEnv.RPC_URL;
const source = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/kamino-obligation-history.json'))
  .hits.WithdrawObligationCollateralAndRedeemReserveCollateralV2[0];
const connection = new Connection(rpcUrl, 'confirmed');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
async function rpc(method, params) {
  const reply = await fetch(method === 'getTransaction' ? historyUrl : rpcUrl,
    {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})}).then(response => response.json());
  if (reply.error) throw Error(JSON.stringify(reply.error));
  return reply.result;
}
function copy(ix) {return {programIdIndex: ix.programIdIndex,
  accountKeyIndexes: Uint8Array.from(ix.accountKeyIndexes), data: Uint8Array.from(ix.data)};}
function reserveFields(data) {return {lastUpdateSlot: String(data.readBigUInt64LE(16)), stale: data[24],
  totalAvailable: String(data.readBigUInt64LE(224)),
  borrowedAmountSfHex: data.subarray(232, 248).toString('hex')};}
function compileMutation(raw, insertions) {
  const tx = VersionedTransaction.deserialize(raw);
  tx.message.compiledInstructions[9].data = Uint8Array.from([2, 0x40, 0x42, 0x0f, 0]);
  const originals = tx.message.compiledInstructions.map(copy);
  // Retain the transient WSOL account so a successful simulation exposes its balance.
  tx.message.compiledInstructions.splice(8, 1, ...insertions.map(index => copy(originals[index])));
  return tx;
}
(async () => {
  const fetched = await rpc('getTransaction', [source.signature,
    {encoding: 'base64', maxSupportedTransactionVersion: 0, commitment: 'confirmed'}]);
  const raw = Buffer.from(fetched.transaction[0], 'base64');
  const msg = source.transaction.transaction.message;
  const allKeys = [...msg.accountKeys, ...(source.transaction.meta.loadedAddresses?.writable || []),
    ...(source.transaction.meta.loadedAddresses?.readonly || [])];
  const action = msg.instructions[7];
  const addresses = [1, 4, 6, 8, 9].map(position => allKeys[action.accounts[position]]);
  const pre = await connection.getMultipleAccountsInfoAndContext(addresses.map(x => new PublicKey(x)), 'confirmed');
  const before = {obligationHash: hash(pre.value[0].data), reserve: reserveFields(pre.value[1].data),
    cToken: String(pre.value[2].data.readBigUInt64LE(64)),
    supply: String(pre.value[3].data.readBigUInt64LE(64)),
    destination: pre.value[4] ? String(pre.value[4].data.readBigUInt64LE(64)) : null};
  const cases = [
    ['single_withdraw', []],
    ['double_withdraw_no_refresh', [7]],
    ['double_withdraw_reserve_refresh_only', [5, 7]],
    ['double_withdraw_obligation_refresh_only', [6, 7]],
    ['double_withdraw_both_refresh', [5, 6, 7]],
  ];
  const results = [];
  for (const [label, insertions] of cases) {
    try {
      const tx = compileMutation(raw, insertions);
      const ret = await rpc('simulateTransaction', [Buffer.from(tx.serialize()).toString('base64'),
        {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
          accounts: {encoding: 'base64', addresses}}]);
      const value = ret.value;
      const accounts = value.accounts?.map(a => a ? Buffer.from(a.data[0], 'base64') : null) || [];
      const after = accounts.length === 5 && accounts.every(Boolean) ?
        {obligationHash: hash(accounts[0]), reserve: reserveFields(accounts[1]),
          cToken: String(accounts[2].readBigUInt64LE(64)),
          supply: String(accounts[3].readBigUInt64LE(64)),
          destination: String(accounts[4].readBigUInt64LE(64))} : null;
      const result = {label, insertions, slot: ret.context.slot, err: value.err,
        unitsConsumed: value.unitsConsumed, after, logs: value.logs};
      results.push(result);
      console.log(JSON.stringify({label, slot: result.slot, err: result.err,
        after: after ? {cToken: after.cToken, supply: after.supply, destination: after.destination,
          reserveAvailable: after.reserve.totalAvailable, obligationChanged: after.obligationHash !== before.obligationHash} : null,
        tail: value.logs?.filter(line => line.includes('Program log:') || line.includes('failed:')).slice(-7)}));
    } catch (error) {
      results.push({label, insertions, transportError: error.message});
      console.log(JSON.stringify({label, transportError: error.message}));
    }
  }
  fs.writeFileSync('composer-runs/2026-10-15/kamino-withdraw-refresh-composition.json',
    JSON.stringify({timestamp: new Date().toISOString(), sourceSignature: source.signature,
      sourceSlot: source.slot, preSlot: pre.context.slot, signerVerification: false,
      addresses: {obligation: addresses[0], reserve: addresses[1], cToken: addresses[2],
        supply: addresses[3], destination: addresses[4]}, before, results}, null, 2));
})().catch(error => {console.error(error.stack); process.exitCode = 1});
