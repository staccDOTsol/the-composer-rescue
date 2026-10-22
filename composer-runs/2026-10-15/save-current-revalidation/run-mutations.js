const fs = require('fs');
const {
  Connection, PublicKey, VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const connection = new Connection(rpcUrl, 'confirmed');
const program = 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo';
const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const samples = JSON.parse(fs.readFileSync(`${__dirname}/control-samples.json`));
const outPath = `${__dirname}/simulation-evidence.json`;

async function rpc(method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      if (json.error) throw Error(JSON.stringify(json.error));
      return json.result;
    } catch (error) {
      if (attempt === 3) throw new Error(`${method}: ${text.slice(0, 200)}`);
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
}

function allKeys(hit) {
  const message = hit.transaction.transaction.message;
  return [...message.accountKeys, ...(hit.transaction.meta.loadedAddresses?.writable || []),
    ...(hit.transaction.meta.loadedAddresses?.readonly || [])];
}

function tokenAmount(data) {
  return data?.length >= 72 ? data.readBigUInt64LE(64) : null;
}

async function rawTransaction(signature) {
  const result = await rpc('getTransaction', [signature,
    {encoding: 'base64', maxSupportedTransactionVersion: 0, commitment: 'confirmed'}]);
  return Buffer.from(result.transaction[0], 'base64');
}

async function monitorFor(hit) {
  const keys = allKeys(hit).map(value => new PublicKey(value));
  const result = await connection.getMultipleAccountsInfoAndContext(keys, 'confirmed');
  const tokenKeys = [];
  const before = {};
  for (let i = 0; i < keys.length; i++) {
    const info = result.value[i];
    if (!info || info.owner.toBase58() !== tokenProgram || info.data.length < 72) continue;
    const address = keys[i].toBase58();
    tokenKeys.push(address);
    before[address] = tokenAmount(info.data).toString();
  }
  return {slot: result.context.slot, tokenKeys: tokenKeys.slice(0, 20), before};
}

function clone(raw) {
  return VersionedTransaction.deserialize(Buffer.from(raw));
}

function compactLogs(logs) {
  return (logs || []).filter(line => /Instruction:|failed:|Error|Flash loans|repay|borrow/i.test(line));
}

async function simulate(label, hit, raw, mutate) {
  const tx = clone(raw);
  const compiled = tx.message.compiledInstructions;
  mutate?.(compiled);
  const monitor = await monitorFor(hit);
  const result = await rpc('simulateTransaction', [Buffer.from(tx.serialize()).toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: monitor.tokenKeys},
  }]);
  const value = result.value;
  const after = {};
  const deltas = {};
  for (let i = 0; i < monitor.tokenKeys.length; i++) {
    const address = monitor.tokenKeys[i];
    const account = value.accounts?.[i];
    if (!account) continue;
    const amount = tokenAmount(Buffer.from(account.data[0], 'base64'));
    if (amount == null) continue;
    after[address] = amount.toString();
    const delta = amount - BigInt(monitor.before[address]);
    if (delta !== 0n) deltas[address] = delta.toString();
  }
  const row = {label, sourceSignature: hit.signature, sourceSlot: hit.slot,
    simulationSlot: result.context.slot, err: value.err, unitsConsumed: value.unitsConsumed,
    nonzeroTokenDeltas: deltas, logs: compactLogs(value.logs)};
  console.log(JSON.stringify({label, slot: row.simulationSlot, err: row.err,
    deltas: row.nonzeroTokenDeltas, tail: row.logs.slice(-4)}));
  return row;
}

function ixByDiscriminator(compiled, discriminator) {
  const hit = compiled.find(ix => ix.data?.[0] === discriminator);
  if (!hit) throw new Error(`missing discriminator ${discriminator}`);
  return hit;
}

function directFlashPair(compiled, amount = 1000000n) {
  const borrowIndex = compiled.findIndex(ix => ix.data?.[0] === 19);
  const borrow = ixByDiscriminator(compiled, 19);
  const repay = ixByDiscriminator(compiled, 20);
  const refreshReserve = compiled.find(ix => ix.programIdIndex === borrow.programIdIndex && ix.data?.[0] === 3);
  if (!refreshReserve) throw new Error('missing Save refresh-reserve instruction');
  borrow.data = Uint8Array.from(borrow.data);
  repay.data = Uint8Array.from(repay.data);
  Buffer.from(borrow.data.buffer, borrow.data.byteOffset, borrow.data.byteLength).writeBigUInt64LE(amount, 1);
  Buffer.from(repay.data.buffer, repay.data.byteOffset, repay.data.byteLength).writeBigUInt64LE(amount, 1);
  repay.data[9] = borrowIndex;
  const destinationIndex = borrow.accountKeyIndexes[1];
  const tokenProgramIndex = borrow.accountKeyIndexes[6];
  const systemProgramIndex = refreshReserve.accountKeyIndexes[3];
  const transferData = Buffer.alloc(12);
  transferData.writeUInt32LE(2, 0);
  transferData.writeBigUInt64LE(1000000n, 4);
  const fundFee = {programIdIndex: systemProgramIndex,
    accountKeyIndexes: [0, destinationIndex], data: Uint8Array.from(transferData)};
  const syncNative = {programIdIndex: tokenProgramIndex,
    accountKeyIndexes: [destinationIndex], data: Uint8Array.from([17])};
  compiled.splice(borrowIndex, compiled.length - borrowIndex, borrow, fundFee, syncNative, repay);
}

(async () => {
  const unique = ['withdrawAndRedeem', 'redeemFees', 'borrowObligationLiquidity', 'flashBorrow'];
  const raw = {};
  for (const name of unique) raw[name] = await rawTransaction(samples.hits[name].signature);
  const results = [];
  for (const name of unique) results.push(await simulate(`control_${name}`, samples.hits[name], raw[name]));

  const flashHit = samples.hits.flashBorrow;
  const flashRaw = raw.flashBorrow;
  results.push(await simulate('control_direct_flash_pair', flashHit, flashRaw, compiled => {
    directFlashPair(compiled);
  }));
  results.push(await simulate('direct_flash_missing_repay_atomicity', flashHit, flashRaw, compiled => {
    directFlashPair(compiled);
    compiled.splice(compiled.findIndex(ix => ix.data?.[0] === 20), 1);
  }));
  results.push(await simulate('direct_flash_repay_before_borrow', flashHit, flashRaw, compiled => {
    directFlashPair(compiled);
    const borrow = compiled.findIndex(ix => ix.data?.[0] === 19);
    const repay = compiled.findIndex(ix => ix.data?.[0] === 20);
    [compiled[borrow], compiled[repay]] = [compiled[repay], compiled[borrow]];
  }));
  results.push(await simulate('direct_flash_wrong_borrow_index', flashHit, flashRaw, compiled => {
    directFlashPair(compiled);
    const repay = ixByDiscriminator(compiled, 20);
    repay.data[9] += 1;
  }));
  results.push(await simulate('direct_flash_destination_alias_supply', flashHit, flashRaw, compiled => {
    directFlashPair(compiled);
    const borrow = ixByDiscriminator(compiled, 19);
    borrow.accountKeyIndexes = Uint8Array.from(borrow.accountKeyIndexes);
    borrow.accountKeyIndexes[1] = borrow.accountKeyIndexes[0];
  }));
  results.push(await simulate('direct_flash_wrong_supply', flashHit, flashRaw, compiled => {
    directFlashPair(compiled);
    const borrow = ixByDiscriminator(compiled, 19);
    borrow.accountKeyIndexes = Uint8Array.from(borrow.accountKeyIndexes);
    borrow.accountKeyIndexes[0] = borrow.accountKeyIndexes[1];
  }));
  results.push(await simulate('direct_flash_cpi_program_substitution', flashHit, flashRaw, compiled => {
    directFlashPair(compiled);
    const borrow = ixByDiscriminator(compiled, 19);
    borrow.accountKeyIndexes = Uint8Array.from(borrow.accountKeyIndexes);
    borrow.accountKeyIndexes[6] = borrow.programIdIndex;
  }));
  results.push(await simulate('liquidation_rebased_to_current_obligation_shape', flashHit, flashRaw, compiled => {
    const saveProgramIndex = ixByDiscriminator(compiled, 19).programIdIndex;
    const refreshObligation = compiled.find(ix => ix.programIdIndex === saveProgramIndex && ix.data?.[0] === 7);
    refreshObligation.accountKeyIndexes = refreshObligation.accountKeyIndexes.slice(0, 2);
    // Remove the source transaction's assertion instructions for its now-stale pre-liquidation obligation bytes.
    compiled.splice(9, 2);
  }));
  results.push(await simulate('flash_missing_repay_atomicity', flashHit, flashRaw, compiled => {
    const index = compiled.findIndex(ix => ix.data?.[0] === 20);
    compiled.splice(index, 1);
  }));
  results.push(await simulate('flash_repay_before_borrow', flashHit, flashRaw, compiled => {
    const borrow = compiled.findIndex(ix => ix.data?.[0] === 19);
    const repay = compiled.findIndex(ix => ix.data?.[0] === 20);
    [compiled[borrow], compiled[repay]] = [compiled[repay], compiled[borrow]];
  }));
  results.push(await simulate('flash_wrong_borrow_index', flashHit, flashRaw, compiled => {
    const repay = ixByDiscriminator(compiled, 20);
    repay.data = Uint8Array.from(repay.data);
    repay.data[9] = 11;
  }));
  results.push(await simulate('liquidation_unsigned_authority', flashHit, flashRaw, compiled => {
    const liquidation = ixByDiscriminator(compiled, 17);
    liquidation.accountKeyIndexes = Uint8Array.from(liquidation.accountKeyIndexes);
    liquidation.accountKeyIndexes[13] = liquidation.accountKeyIndexes[0];
  }));
  results.push(await simulate('liquidation_destination_alias_source', flashHit, flashRaw, compiled => {
    const liquidation = ixByDiscriminator(compiled, 17);
    liquidation.accountKeyIndexes = Uint8Array.from(liquidation.accountKeyIndexes);
    liquidation.accountKeyIndexes[1] = liquidation.accountKeyIndexes[0];
  }));
  results.push(await simulate('liquidation_wrong_repay_vault', flashHit, flashRaw, compiled => {
    const liquidation = ixByDiscriminator(compiled, 17);
    liquidation.accountKeyIndexes = Uint8Array.from(liquidation.accountKeyIndexes);
    liquidation.accountKeyIndexes[4] = liquidation.accountKeyIndexes[1];
  }));
  results.push(await simulate('liquidation_cpi_program_substitution', flashHit, flashRaw, compiled => {
    const liquidation = ixByDiscriminator(compiled, 17);
    liquidation.accountKeyIndexes = Uint8Array.from(liquidation.accountKeyIndexes);
    liquidation.accountKeyIndexes[14] = liquidation.programIdIndex;
  }));

  const feeHit = samples.hits.redeemFees;
  results.push(await simulate('redeem_fees_destination_alias_supply', feeHit, raw.redeemFees, compiled => {
    const fees = ixByDiscriminator(compiled, 18);
    fees.accountKeyIndexes = Uint8Array.from(fees.accountKeyIndexes);
    fees.accountKeyIndexes[2] = fees.accountKeyIndexes[1];
  }));
  results.push(await simulate('redeem_fees_wrong_supply', feeHit, raw.redeemFees, compiled => {
    const fees = ixByDiscriminator(compiled, 18);
    fees.accountKeyIndexes = Uint8Array.from(fees.accountKeyIndexes);
    fees.accountKeyIndexes[1] = fees.accountKeyIndexes[2];
  }));
  results.push(await simulate('redeem_fees_cpi_program_substitution', feeHit, raw.redeemFees, compiled => {
    const fees = ixByDiscriminator(compiled, 18);
    fees.accountKeyIndexes = Uint8Array.from(fees.accountKeyIndexes);
    fees.accountKeyIndexes[5] = fees.programIdIndex;
  }));

  const slot = await connection.getSlot('confirmed');
  const blockTime = await connection.getBlockTime(slot);
  fs.writeFileSync(outPath, JSON.stringify({program, observedSlot: slot, observedBlockTime: blockTime,
    observedAt: new Date().toISOString(), sigVerify: false, replaceRecentBlockhash: true, results}, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
