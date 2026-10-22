const fs = require('fs');
const crypto = require('crypto');
const {Connection, PublicKey, VersionedTransaction} =
  require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const history = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/kamino-obligation-history.json'));
const bot = new PublicKey('Dsg7ZFQzXuiKsBAmL78Y5V5VjN6ASkfKDxB7VUNpp6aM');
const connection = new Connection(rpcUrl, 'confirmed');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const summary = data => data.length === 165 ? String(data.readBigUInt64LE(64)) : hash(data);

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const json = await response.json();
  if (json.error) throw Error(JSON.stringify(json.error));
  return json.result;
}
async function findUnrelatedToken(mint, excludeOwner, excludeAddresses = []) {
  const custody = JSON.parse(fs.readFileSync(
    '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/outputs/current-lending-vaults.json'));
  const rows = custody.protocols.flatMap(protocol => protocol.rows).filter(row =>
    row.mint === mint && !excludeAddresses.includes(row.address));
  const accounts = await connection.getMultipleAccountsInfo(rows.map(row => new PublicKey(row.address)), 'confirmed');
  for (let i = 0; i < accounts.length; i++) {
    const data = accounts[i]?.data;
    if (!data || data.length !== 165) continue;
    const owner = new PublicKey(data.subarray(32, 64));
    if (owner.toBase58() !== excludeOwner) return {address: new PublicKey(rows[i].address), owner};
  }
  throw Error('No unrelated existing token account found');
}
function removeIndexes(tx, indexes) {
  tx.message.compiledInstructions = tx.message.compiledInstructions.filter((_ix, i) => !indexes.includes(i));
}
function duplicateAction(tx, index) {
  const action = tx.message.compiledInstructions[index];
  tx.message.compiledInstructions.splice(index + 1, 0,
    {programIdIndex: action.programIdIndex, accountKeyIndexes: Uint8Array.from(action.accountKeyIndexes),
      data: Uint8Array.from(action.data)});
}

async function execute(kind, hit, actionIndex, positions, cases) {
  const fetched = await rpc('getTransaction', [hit.signature,
    {encoding: 'base64', maxSupportedTransactionVersion: 0, commitment: 'confirmed'}]);
  const raw = Buffer.from(fetched.transaction[0], 'base64');
  const sample = hit.transaction;
  const keys = [...sample.transaction.message.accountKeys, ...(sample.meta.loadedAddresses?.writable || []),
    ...(sample.meta.loadedAddresses?.readonly || [])];
  const action = sample.transaction.message.instructions[actionIndex];
  const monitored = positions.map(pos => keys[action.accounts[pos]]);
  const unique = [...new Set(monitored)];
  const pre = await connection.getMultipleAccountsInfoAndContext(unique.map(key => new PublicKey(key)), 'confirmed');
  const before = Object.fromEntries(unique.map((key, i) => [key, pre.value[i] ? summary(pre.value[i].data) : null]));
  const results = [];
  for (const [label, mutate] of cases) {
    const tx = VersionedTransaction.deserialize(raw);
    try {
      mutate(tx);
      const ret = await rpc('simulateTransaction', [Buffer.from(tx.serialize()).toString('base64'),
        {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
          accounts: {encoding: 'base64', addresses: unique}}]);
      const value = ret.value;
      const after = Object.fromEntries(unique.map((key, i) => {
        const row = value.accounts?.[i];
        return [key, row ? summary(Buffer.from(row.data[0], 'base64')) : null];
      }));
      const deltas = Object.fromEntries(unique.map(key => [key,
        before[key] != null && after[key] != null && /^\d+$/.test(before[key]) && /^\d+$/.test(after[key]) ?
          String(BigInt(after[key]) - BigInt(before[key])) : null]));
      const item = {label, slot: ret.context.slot, err: value.err, unitsConsumed: value.unitsConsumed,
        before, after, deltas, logs: value.logs};
      results.push(item);
      console.log(JSON.stringify({kind, label, slot: item.slot, err: item.err, deltas,
        tail: item.logs?.filter(line => line.includes('Program log:') || line.includes('failed:')).slice(-8)}));
    } catch (e) {
      results.push({label, transportError: e.message});
      console.log(JSON.stringify({kind, label, transportError: e.message}));
    }
  }
  return {kind, sourceSignature: hit.signature, sourceSlot: hit.slot, preSlot: pre.context.slot,
    signerVerification: false, actionIndex, actionAccounts: action.accounts.map(j => keys[j]),
    monitored: unique, results};
}

(async () => {
  const borrowHit = history.hits.BorrowObligationLiquidityV2.find(h =>
    h.signature === '4YGu6QkK3XBm2E5dNc8E6Xx3j56uvErJVuTaYKPuF72mxLZvqfs1DXYDGPwJmo8Tk1FTVRBzc7yGVSjUrjm42iLe');
  const withdrawHit = history.hits.WithdrawObligationCollateralAndRedeemReserveCollateralV2.find(h =>
    h.signature === '5L5HMERwc3f9iT3BxkAK2KvErJ7cED45ENtb2bQ3D6w9x9vjBNyayZjgiweyNdV2yiqnnVkmphbW4ejMNvtesAmA');
  const owner = borrowHit.transaction.transaction.message.accountKeys[0];
  const withdrawMessage = withdrawHit.transaction.transaction.message;
  const withdrawAllKeys = [...withdrawMessage.accountKeys,
    ...(withdrawHit.transaction.meta.loadedAddresses?.writable || []),
    ...(withdrawHit.transaction.meta.loadedAddresses?.readonly || [])];
  const unrelatedUsdt = await findUnrelatedToken('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', owner);
  const unrelatedWsol = await findUnrelatedToken('So11111111111111111111111111111111111111112',
    owner, withdrawAllKeys);
  const borrowCases = [
    ['positive_landed_replay', () => {}],
    ['other_funded_signer', tx => {removeIndexes(tx, [1]); tx.message.staticAccountKeys[0] = bot;}],
    ['redirect_to_unrelated_usdt_account', tx => {
      removeIndexes(tx, [1]); tx.message.staticAccountKeys[4] = unrelatedUsdt.address;
    }],
    ['destination_aliases_reserve_supply', tx => {
      tx.message.compiledInstructions[5].accountKeyIndexes[8] = tx.message.compiledInstructions[5].accountKeyIndexes[6];
    }],
    ['duplicate_borrow_without_refresh', tx => duplicateAction(tx, 5)],
  ];
  const withdrawCases = [
    ['positive_landed_replay', () => {}],
    ['other_funded_signer', tx => {
      removeIndexes(tx, [1, 2, 3, 8]); tx.message.staticAccountKeys[0] = bot;
      tx.message.staticAccountKeys[2] = unrelatedWsol.address;
    }],
    ['redirect_to_unrelated_wsol_account', tx => {
      removeIndexes(tx, [1, 2, 3, 8]); tx.message.staticAccountKeys[2] = unrelatedWsol.address;
    }],
    ['destination_aliases_reserve_supply', tx => {
      tx.message.compiledInstructions[7].accountKeyIndexes[9] = tx.message.compiledInstructions[7].accountKeyIndexes[8];
    }],
    ['duplicate_withdraw_without_refresh', tx => duplicateAction(tx, 7)],
  ];
  const output = {timestamp: new Date().toISOString(), unrelatedTokenAccounts: {
    usdt: {address: unrelatedUsdt.address.toBase58(), owner: unrelatedUsdt.owner.toBase58()},
    wsol: {address: unrelatedWsol.address.toBase58(), owner: unrelatedWsol.owner.toBase58()}},
    scenarios: [
      await execute('borrow_v2', borrowHit, 5, [1, 4, 6, 8], borrowCases),
      await execute('withdraw_redeem_v2', withdrawHit, 7, [1, 4, 6, 8, 9], withdrawCases),
    ]};
  fs.writeFileSync('composer-runs/2026-10-15/kamino-obligation-mutation.json', JSON.stringify(output, null, 2));
})().catch(e => {console.error(e.stack); process.exitCode = 1});
