// Read-only current-mainnet v1 flash composition across KLend and Jupiter Earn.
// No transaction is ever signed or submitted.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, TransactionInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const {encodeV1} = require('./klend-v1-composition.js');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const conn = new Connection(rpcUrl, 'confirmed');
const P = value => new PublicKey(value);
const klend = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const jupiter = P('jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9');
const token = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const sourceSig = 'znj3zX8BnVXSgwUCQdQxWqxUpb4sgWbhdGnhKcamymzbPzzN41oNQUVqtHApoTiAZsTMovX3MxCpZVUMBEe1qLH';
const idl = JSON.parse(fs.readFileSync('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl/lending.json'));
const specs = Object.fromEntries(idl.instructions.map(ix => [ix.name, ix]));
const flashSource = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/kamino-flash-history.json')).hits[0];
const sample = flashSource.transaction;
const msg = sample.transaction.message;
const staticKeys = msg.accountKeys;
const allKeys = [...staticKeys, ...(sample.meta.loadedAddresses?.writable || []),
  ...(sample.meta.loadedAddresses?.readonly || [])];
const head = msg.header;
const writable = idx => idx < staticKeys.length ?
  (idx < head.numRequiredSignatures ? idx < head.numRequiredSignatures - head.numReadonlySignedAccounts :
    idx < staticKeys.length - head.numReadonlyUnsignedAccounts) :
  idx < staticKeys.length + (sample.meta.loadedAddresses?.writable?.length || 0);
const sampleFlash = idx => {
  const src = msg.instructions[idx];
  return new TransactionInstruction({programId: P(allKeys[src.programIdIndex]),
    keys: src.accounts.map(i => ({pubkey: P(allKeys[i]), isSigner: i < head.numRequiredSignatures,
      isWritable: writable(i)})), data: Buffer.from(bs58.decode(src.data))});
};
const flashBorrowTemplate = sampleFlash(3), flashRepayTemplate = sampleFlash(13);
if (!flashBorrowTemplate.programId.equals(klend) || !flashRepayTemplate.programId.equals(klend))
  throw new Error('Flash sample instructions changed');
const flashSupply = flashBorrowTemplate.keys[5].pubkey;
const flashFee = flashBorrowTemplate.keys[7].pubkey;
const flashReserve = flashBorrowTemplate.keys[3].pubkey;
const flashIx = (template, signer, tokenAccount, amount, repayIndex) => {
  const keys = template.keys.map(k => ({...k}));
  keys[0].pubkey = signer;
  keys[6].pubkey = tokenAccount;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: klend, keys, data});
};
const u64 = n => {const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b;};
const splAmount = account => account?.owner.equals(token) && account?.data.length === 165 ?
  account.data.readBigUInt64LE(64) : null;
const resultAmount = (account, i) => {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (i >= 6) return crypto.createHash('sha256').update(data).digest('hex');
  if (i === 5) return data.readBigUInt64LE(36).toString();
  return account.owner === token.toBase58() && data.length === 165 ?
    data.readBigUInt64LE(64).toString() : null;
};
const decodedAccount = (account, i) => {
  if (!account?.data) return null;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const ownerKey = typeof account.owner === 'string' ? account.owner : account.owner.toBase58();
  if (ownerKey === token.toBase58() && data.length === 165)
    return {kind: 'splToken', amountRaw: data.readBigUInt64LE(64).toString()};
  if (i === 5 && ownerKey === token.toBase58())
    return {kind: 'splMint', supplyRaw: data.readBigUInt64LE(36).toString()};
  const decoded = {kind: 'programState', sha256: crypto.createHash('sha256').update(data).digest('hex')};
  if (i === 7 && data.length >= 4912) {
    decoded.availableLiquidityRaw = data.readBigUInt64LE(224).toString();
    decoded.flashLoanFeeSf = data.readBigUInt64LE(4904).toString();
  }
  return decoded;
};

async function main() {
  const tx = await conn.getParsedTransaction(sourceSig,
    {maxSupportedTransactionVersion: 1, commitment: 'confirmed'});
  if (!tx || tx.meta?.err) throw new Error('Jupiter source transaction unavailable');
  const historical = tx.transaction.message.instructions.find(x =>
    x.programId.equals(jupiter) && x.accounts?.length === 17 &&
    Buffer.from(bs58.decode(x.data)).subarray(0, 8).equals(
      Buffer.from(specs.deposit.discriminator)));
  if (!historical) throw new Error('Jupiter deposit instruction unavailable');
  const addresses = historical.accounts.map(x => x.toBase58());
  const owner = historical.accounts[0], ownerToken = historical.accounts[1], ownerShare = historical.accounts[2];
  const withdrawAddresses = [addresses[0], addresses[2], addresses[1], addresses[4],
    addresses[5], addresses[3], addresses[6], addresses[7], addresses[8], addresses[9],
    addresses[10], jupiter.toBase58(), addresses[11], addresses[12], addresses[13],
    addresses[14], addresses[15], addresses[16]];
  const rateAddresses = [addresses[5], addresses[3], addresses[6], addresses[7], addresses[13]];
  const jupIx = (name, addrs, amount, newOwner) => {
    const spec = specs[name];
    const keys = addrs.map((value, i) => ({pubkey: P(value),
      isSigner: !!spec.accounts[i].signer, isWritable: !!spec.accounts[i].writable}));
    if (newOwner) keys[0].pubkey = newOwner;
    return new TransactionInstruction({programId: jupiter, keys,
      data: Buffer.concat([Buffer.from(spec.discriminator),
        amount === undefined ? Buffer.alloc(0) : u64(amount)])});
  };
  const deposit = amount => jupIx('deposit', addresses, amount);
  const withdraw = (amount, signer) => jupIx('withdraw', withdrawAddresses, amount, signer);
  const rate = jupIx('update_rate', rateAddresses);
  const outsider = P('6mgztPM3Br7Sn8Jqe49jT2RRMmZbMRK6iH2xRZ6XVLL3');
  const watched = [ownerToken, ownerShare, P(addresses[10]), flashSupply, flashFee,
    P(addresses[6]), P(addresses[5]), flashReserve, P(addresses[8]), P(addresses[11])];
  const pre = await conn.getMultipleAccountsInfoAndContext(watched, 'confirmed');
  const preAmounts = watched.map((_, i) => {
    const account = pre.value[i];
    if (i === 5) return account?.data.readBigUInt64LE(36).toString();
    if (i >= 6) return account?.data ?
      crypto.createHash('sha256').update(account.data).digest('hex') : null;
    return splAmount(account)?.toString() || null;
  });
  const preDecoded = watched.map((_, i) => decodedAccount(pre.value[i], i));
  const supply = splAmount(pre.value[3]);
  if (!supply || supply < 1000000n) throw new Error('Flash reserve supply unavailable');
  const available = pre.value[7]?.data.readBigUInt64LE(224);
  const flashFeeRateSf = pre.value[7]?.data.readBigUInt64LE(4904);
  if (!available || flashFeeRateSf === undefined)
    throw new Error('Flash reserve accounting data unavailable');
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const pair = n => [flashIx(flashBorrowTemplate, owner, ownerToken, n),
    flashIx(flashRepayTemplate, owner, ownerToken, n, 0)];
  const cycle = n => [pair(n)[0], deposit(n), withdraw(n), pair(n)[1]];
  const repeated = (n, amount) => [pair(amount)[0],
    ...Array.from({length: n}, () => [deposit(amount), withdraw(amount)]).flat(),
    pair(amount)[1]];
  const cases = [
    ['smallest_raw_flash_pair', pair(1n)],
    ['smallest_raw_cycle', cycle(1n)],
    ['two_raw_cycle', cycle(2n)],
    ['three_raw_cycle', cycle(3n)],
    ['four_raw_cycle', cycle(4n)],
    ['five_raw_cycle', cycle(5n)],
    ['six_raw_cycle', cycle(6n)],
    ['seven_raw_cycle', cycle(7n)],
    ['eight_raw_cycle', cycle(8n)],
    ['nine_raw_cycle', cycle(9n)],
    ['ten_raw_cycle', cycle(10n)],
    ['hundred_raw_cycle', cycle(100n)],
    ['one_millidollar_cycle', cycle(1000n)],
    ['one_dollar_cycle', cycle(1000000n)],
    ['thousand_dollar_cycle', cycle(1000000000n)],
    ['million_dollar_cycle', cycle(1000000000000n)],
    ['ninety_percent_reserve_flash_pair', pair(supply * 90n / 100n)],
    ['ninety_percent_reserve_cycle', cycle(supply * 90n / 100n)],
    ['ninety_nine_percent_reserve_flash_pair', pair(supply * 99n / 100n)],
    ['ninety_nine_percent_reserve_cycle', cycle(supply * 99n / 100n)],
    ['ninety_nine_point_nine_percent_reserve_cycle', cycle(supply * 999n / 1000n)],
    ['ninety_nine_point_nine_nine_percent_reserve_cycle', cycle(supply * 9999n / 10000n)],
    ['ninety_nine_point_nine_nine_nine_percent_reserve_flash_pair',
      pair(supply * 99999n / 100000n)],
    ['ninety_nine_point_nine_nine_nine_percent_reserve_cycle', cycle(supply * 99999n / 100000n)],
    ['accounted_available_minus_one_flash_pair', pair(available - 1n)],
    ['accounted_available_flash_pair', pair(available)],
    ['accounted_available_cycle', cycle(available)],
    ['accounted_available_plus_one_flash_pair', pair(available + 1n)],
    ['full_reserve_flash_pair', pair(supply)],
    ['one_more_than_reserve_flash_pair', pair(supply + 1n)],
    ['max_u64_flash_pair', pair((1n << 64n) - 1n)],
    ['rate_before_borrow', [rate, ...cycle(1000000n).map((ix, i) => i === 3 ?
      flashIx(flashRepayTemplate, owner, ownerToken, 1000000n, 1) : ix)]],
    ['rate_between_deposit_withdraw', [cycle(1000000n)[0], deposit(1000000n),
      rate, withdraw(1000000n), cycle(1000000n)[3]]],
    ['rate_after_withdraw', [cycle(1000000n)[0], deposit(1000000n),
      withdraw(1000000n), rate, cycle(1000000n)[3]]],
    ['two_round_trips', [cycle(1000000n)[0], deposit(1000000n), withdraw(1000000n),
      deposit(1000000n), withdraw(1000000n), cycle(1000000n)[3]]],
    ['three_round_trips', repeated(3, 1000000n)],
    ['four_round_trips', repeated(4, 1000000n)],
    ['five_round_trips', repeated(5, 1000000n)],
    ['six_round_trips', repeated(6, 1000000n)],
    ['seven_round_trips', repeated(7, 1000000n)],
    ['eight_round_trips', repeated(8, 1000000n)],
    ['nine_round_trips', repeated(9, 1000000n)],
    ['ten_round_trips', repeated(10, 1000000n)],
    ['eleven_round_trips', repeated(11, 1000000n)],
    ['twelve_round_trips', repeated(12, 1000000n)],
    ['withdraw_before_deposit', [cycle(1000000n)[0], withdraw(1000000n),
      deposit(1000000n), cycle(1000000n)[3]]],
    ['outsider_withdraw_owner_shares', [cycle(1000000n)[0], deposit(1000000n),
      withdraw(1000000n, outsider), cycle(1000000n)[3]]],
    ['alias_deposit_source_to_jupiter_vault', [cycle(1000000n)[0],
      jupIx('deposit', addresses.map((x, i) => i === 1 ? addresses[10] : x), 1000000n),
      withdraw(1000000n), cycle(1000000n)[3]]],
  ];
  const outputs = [];
  for (const [name, instructions] of cases) {
    try {
      const encoded = encodeV1(instructions, owner, blockhash);
      const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: name, method: 'simulateTransaction', params: [
          encoded.wire.toString('base64'), {encoding: 'base64', sigVerify: false,
            replaceRecentBlockhash: true, commitment: 'confirmed', accounts:
              {encoding: 'base64', addresses: watched.map(x => x.toBase58())}},
        ]})});
      const json = await response.json();
      const value = json.result?.value;
      const post = watched.map((_, i) => resultAmount(value?.accounts?.[i], i));
      const postDecoded = watched.map((_, i) => decodedAccount(value?.accounts?.[i], i));
      const output = {name, amountRaw: String(instructions.find(ix => ix.programId.equals(klend))?.data.readBigUInt64LE(8)),
        slot: json.result?.context?.slot, err: value?.err || null,
        rpcError: json.error || null, sizeBytes: encoded.sizeBytes, v0Bytes: encoded.v0Bytes,
        accounts: encoded.addressCount, writable: encoded.writableCount,
        instructions: encoded.instructionCount, signers: encoded.requiredSignatures,
        units: value?.unitsConsumed, loadedAccountsDataSize: value?.loadedAccountsDataSize,
        post, postDecoded, logs: value?.logs?.filter(x => x.includes('Instruction:') ||
          x.includes('Error') || x.includes('failed:')).slice(-18)};
      outputs.push(output);
      console.log(JSON.stringify({name, err: output.err, rpcError: output.rpcError,
        bytes: output.sizeBytes, accounts: output.accounts, units: output.units,
        post: output.post?.slice(0, 6), logs: output.logs?.slice(-4)}));
    } catch (e) {
      outputs.push({name, localError: e.stack});
      console.log(JSON.stringify({name, localError: e.message}));
    }
  }
  fs.writeFileSync('composer-runs/2026-10-15/klend-jupiter-v1-extremes.json',
    JSON.stringify({timestamp: new Date().toISOString(), sourceSig, sourceSlot: tx.slot,
      sourceFlashSig: flashSource.signature, sourceFlashSlot: flashSource.slot,
      liveSubmission: false, sigVerify: false, flashSupplyRaw: String(supply),
      flashAvailableRaw: String(available), flashFeeRateSf: String(flashFeeRateSf),
      preSlot: pre.context.slot, owner: owner.toBase58(), watched: watched.map(x => x.toBase58()),
      watchedLabels: ['walletUsdc', 'walletFToken', 'jupiterUnderlyingVault',
        'klendFlashSupply', 'klendFlashFeeVault', 'jupiterFTokenMint',
        'jupiterLendingState', 'klendReserve', 'jupiterLiquidityPosition',
        'jupiterLiquidityState'],
      debtAccounting: 'KLend flash loans do not create an obligation/debt account; complete repayment is represented by the successful indexed repay and restored reserve/supply balances.',
      pre: preAmounts, preDecoded, outputs}, null, 2));
}
main().catch(e => {console.error(e.stack); process.exitCode = 1;});
