#!/usr/bin/env node

// Current-mainnet read-only v1 simulations. Never signs or submits a transaction.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, SystemProgram, TransactionInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const {encodeV1} = require('./klend-v1-composition.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(x => x && !x.startsWith('#')).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('read-only RPC unavailable');
const conn = new Connection(rpcUrl, 'confirmed');
const P = value => new PublicKey(value);

const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const ORCA = P('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const MEMO = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const SYSVAR_INSTRUCTIONS = P('Sysvar1nstructions1111111111111111111111111');
const POOL = P('2TAgfogn8JRwwTnsGKUa6WUT5Xdv1iMEzfEDMor68X9C');
const POSITION = P('44pSCDrY8Ka6j5qyA7HJdx9cgCEkepjj9N6atrXSv79e');
const POSITION_TOKEN = P('AvTCVwfFPRqmdFHCipN3mwS6pXzaGb9ac21ycjyQmn5y');
const OWNER = P('4i4rYMBihHVv4VwuGQmu2eu9FEPf5tqvHQFrbFpCwQP1');
const OWNER_B = P('CrXdPjcgZgxzuiGoKNQAid4udzwUioJwGeXKTFWBubcq');
const MINT_A = P('So11111111111111111111111111111111111111112');
const MINT_B = P('A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS');
const VAULT_A = P('26NPUT2NWS8vbgdZuD4iMKXbypYb6SpZKvmi76ezaG35');
const VAULT_B = P('AbPTQH3jPZUfZYfyPmMhEPvD2tMuWjcFsgVjMbMvdTZ6');
const OLD_LOWER = P('FiQBpg47ZcHjqCj6m47GMpzhCsATihFZCjMXqmYAkN4X');
const UPPER_ARRAY = P('dBqmnuE7DJ7Dn5vemuLhdCHptc1rZAeRDGG31N8PdZe');
const OWNER_A = getAssociatedTokenAddressSync(MINT_A, OWNER, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

// Freshly decoded current-config zero-fee WSOL reserve with the largest available
// balance in the retained zero-fee census.
const ZERO_CENSUS = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/klend-zero-fee-census.json', 'utf8'));
const reserveRow = ZERO_CENSUS.activeZero.filter(x => x.mint === MINT_A.toBase58())
  .sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1)[0];
if (!reserveRow || reserveRow.flashFeeSf !== '0') throw new Error('no exact-zero-rate WSOL reserve');
const RESERVE = P(reserveRow.reserve), MARKET = P(reserveRow.market), SUPPLY = P(reserveRow.supplyVault), FEE = P(reserveRow.feeVault);
const [MARKET_AUTHORITY] = PublicKey.findProgramAddressSync([Buffer.from('lma'), MARKET.toBuffer()], KLEND);

const DISC = {
  flashBorrow: Buffer.from([135, 231, 52, 167, 7, 52, 212, 193]),
  flashRepay: Buffer.from([185, 117, 0, 203, 96, 245, 180, 186]),
  reposition: Buffer.from([191, 169, 224, 11, 131, 19, 158, 253]),
  increase: Buffer.from([133, 29, 89, 223, 69, 238, 176, 10]),
  decrease: Buffer.from([160, 38, 208, 111, 104, 91, 44, 1]),
  update: Buffer.from([154, 230, 250, 13, 236, 209, 75, 223]),
};
const k = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});
const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const u128 = value => { const n = BigInt(value), b = Buffer.alloc(16); b.writeBigUInt64LE(n & ((1n << 64n) - 1n)); b.writeBigUInt64LE(n >> 64n, 8); return b; };
const i32 = value => { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; };
const orcaIx = (data, keys) => new TransactionInstruction({programId: ORCA, data, keys});

function flashBorrow(amount) {
  return new TransactionInstruction({programId: KLEND, data: Buffer.concat([DISC.flashBorrow, u64(amount)]), keys: [
    k(OWNER, true), k(MARKET_AUTHORITY), k(MARKET), k(RESERVE, false, true), k(MINT_A), k(SUPPLY, false, true),
    k(OWNER_A, false, true), k(FEE, false, true), k(KLEND), k(KLEND), k(SYSVAR_INSTRUCTIONS), k(TOKEN_PROGRAM_ID),
  ]});
}
function flashRepay(amount, borrowIndex) {
  return new TransactionInstruction({programId: KLEND, data: Buffer.concat([DISC.flashRepay, u64(amount), Buffer.from([borrowIndex])]), keys: [
    k(OWNER, true), k(MARKET_AUTHORITY), k(MARKET), k(RESERVE, false, true), k(MINT_A), k(SUPPLY, false, true),
    k(OWNER_A, false, true), k(FEE, false, true), k(KLEND), k(KLEND), k(SYSVAR_INSTRUCTIONS), k(TOKEN_PROGRAM_ID),
  ]});
}
function reposition(liquidity, lower = -46464, upper = -46144) {
  const max = (1n << 64n) - 1n;
  return orcaIx(Buffer.concat([DISC.reposition, i32(lower), i32(upper), Buffer.from([0]), u128(liquidity),
    u64(0), u64(0), u64(max), u64(max), Buffer.from([0])]), [
    k(POOL, false, true), k(TOKEN_PROGRAM_ID), k(TOKEN_PROGRAM_ID), k(MEMO), k(OWNER, true), k(OWNER, true, true),
    k(POSITION, false, true), k(POSITION_TOKEN), k(MINT_A), k(MINT_B), k(OWNER_A, false, true), k(OWNER_B, false, true),
    k(VAULT_A, false, true), k(VAULT_B, false, true), k(OLD_LOWER, false, true), k(UPPER_ARRAY, false, true),
    k(UPPER_ARRAY, false, true), k(UPPER_ARRAY, false, true), k(SystemProgram.programId),
  ]);
}
function increase(liquidity) {
  const max = (1n << 64n) - 1n;
  return orcaIx(Buffer.concat([DISC.increase, u128(liquidity), u64(max), u64(max), Buffer.from([0])]), [
    k(POOL, false, true), k(TOKEN_PROGRAM_ID), k(TOKEN_PROGRAM_ID), k(MEMO), k(OWNER, true),
    k(POSITION, false, true), k(POSITION_TOKEN), k(MINT_A), k(MINT_B), k(OWNER_A, false, true), k(OWNER_B, false, true),
    k(VAULT_A, false, true), k(VAULT_B, false, true), k(UPPER_ARRAY, false, true), k(UPPER_ARRAY, false, true),
  ]);
}
function decrease(liquidity, lower = UPPER_ARRAY, upper = UPPER_ARRAY) {
  return orcaIx(Buffer.concat([DISC.decrease, u128(liquidity), u64(0), u64(0)]), [
    k(POOL, false, true), k(TOKEN_PROGRAM_ID), k(OWNER, true), k(POSITION, false, true), k(POSITION_TOKEN),
    k(OWNER_A, false, true), k(OWNER_B, false, true), k(VAULT_A, false, true), k(VAULT_B, false, true),
    k(lower, false, true), k(upper, false, true),
  ]);
}
function update(lower = UPPER_ARRAY, upper = UPPER_ARRAY) {
  return orcaIx(DISC.update, [k(POOL, false, true), k(POSITION, false, true), k(lower), k(upper)]);
}

const createOwnerA = createAssociatedTokenAccountIdempotentInstruction(OWNER, OWNER_A, OWNER, MINT_A, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const watched = [OWNER_A, OWNER_B, VAULT_A, VAULT_B, POSITION, POOL, OLD_LOWER, UPPER_ARRAY, SUPPLY, FEE, RESERVE];
const labels = ['walletWsol','walletTokenB','orcaVaultA','orcaVaultB','position','pool','oldLowerTickArray','upperTickArray','klendSupply','klendFee','klendReserve'];
function sha(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function decode(address, account) {
  if (!account?.data) return null;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const owner = typeof account.owner === 'string' ? account.owner : account.owner.toBase58();
  if (owner === TOKEN_PROGRAM_ID.toBase58() && data.length >= 165)
    return {kind: 'splToken', mint: new PublicKey(data.subarray(0, 32)).toBase58(), tokenOwner: new PublicKey(data.subarray(32, 64)).toBase58(), amountRaw: data.readBigUInt64LE(64).toString()};
  if (address.equals(POSITION)) return {kind: 'orcaPosition', liquidity: (data.readBigUInt64LE(72) + (data.readBigUInt64LE(80) << 64n)).toString(), tickLower: data.readInt32LE(88), tickUpper: data.readInt32LE(92), sha256: sha(data)};
  if (address.equals(POOL)) return {kind: 'orcaPool', liquidity: (data.readBigUInt64LE(49) + (data.readBigUInt64LE(57) << 64n)).toString(), tickCurrent: data.readInt32LE(81), protocolFeeOwedA: data.readBigUInt64LE(85).toString(), protocolFeeOwedB: data.readBigUInt64LE(93).toString(), sha256: sha(data)};
  if (address.equals(RESERVE)) return {kind: 'klendReserve', availableRaw: data.readBigUInt64LE(224).toString(), flashFeeSf: data.readBigUInt64LE(4904).toString(), sha256: sha(data)};
  return {kind: 'state', sha256: sha(data), dataLength: data.length};
}
function delta(before, after) {
  if (before?.kind === 'splToken' && after?.kind === 'splToken') return (BigInt(after.amountRaw) - BigInt(before.amountRaw)).toString();
  if (!before && after?.kind === 'splToken') return after.amountRaw;
  if (before?.kind === 'orcaPosition' && after?.kind === 'orcaPosition') return (BigInt(after.liquidity) - BigInt(before.liquidity)).toString();
  if (before?.kind === 'klendReserve' && after?.kind === 'klendReserve') return (BigInt(after.availableRaw) - BigInt(before.availableRaw)).toString();
  return before?.sha256 && after?.sha256 ? String(before.sha256 === after.sha256) : null;
}

async function simulate(name, instructions, blockhash, preDecoded, meta = {}) {
  let encoded;
  try { encoded = encodeV1(instructions, OWNER, blockhash); }
  catch (error) { return {name, localError: error.message, ...meta}; }
  const request = {jsonrpc: '2.0', id: name, method: 'simulateTransaction', params: [encoded.wire.toString('base64'),
    {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map(String)}}]};
  let json;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(request)});
    const text = await response.text();
    try { json = JSON.parse(text); }
    catch (error) {
      if (attempt === 5) throw new Error(`RPC non-JSON response after retries: ${text.slice(0, 120)}`);
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }
    if (!json.error || json.error.code !== 429) break;
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  const value = json.result?.value;
  const postDecoded = watched.map((address, i) => decode(address, value?.accounts?.[i]));
  return {name, ...meta, slot: json.result?.context?.slot || null, transportError: json.error || null, err: value?.err || null,
    sizeBytes: encoded.sizeBytes, equivalentV0Bytes: encoded.v0Bytes, addressCount: encoded.addressCount,
    writableCount: encoded.writableCount, instructionCount: encoded.instructionCount, signerCount: encoded.requiredSignatures,
    config: encoded.config, unitsConsumed: value?.unitsConsumed || null, loadedAccountsDataSize: value?.loadedAccountsDataSize || null,
    messageBase64: encoded.wire.toString('base64'), postDecoded,
    deltas: Object.fromEntries(watched.map((address, i) => [labels[i], delta(preDecoded[i], postDecoded[i])])),
    logs: value?.logs?.filter(x => /Instruction:|insufficient|failed:|Error|Program data:/.test(x)).slice(-50) || null,
    innerInstructions: value?.innerInstructions || null};
}

async function main() {
  const pre = await conn.getMultipleAccountsInfoAndContext(watched, 'confirmed');
  const preDecoded = watched.map((address, i) => decode(address, pre.value[i]));
  const available = BigInt(preDecoded[10].availableRaw), feeRate = BigInt(preDecoded[10].flashFeeSf);
  if (feeRate !== 0n) throw new Error('selected reserve is not currently zero-fee');
  const positionLiquidity = BigInt(preDecoded[4].liquidity);
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const direct = amount => [createOwnerA, flashBorrow(amount), flashRepay(amount, 1)];
  // First reposition withdraws the existing range into the legitimate owner's
  // accounts and moves to an above-price A-only range; the 1-unit decrease makes
  // the position empty. Subsequent A-only add/remove pairs isolate flash-funded
  // Whirlpool liquidity accounting while preserving complete KLend repayment.
  const cycle = (amount, rounds = 1, updatePlacement = 'none') => {
    const scaled = positionLiquidity * amount / 9_000_000_000n + 1n;
    const out = [createOwnerA];
    if (updatePlacement === 'before') out.push(update(OLD_LOWER, UPPER_ARRAY));
    out.push(flashBorrow(amount), reposition(1n), decrease(1n));
    for (let i = 0; i < rounds; i++) {
      out.push(increase(scaled));
      if (updatePlacement === 'between' && i === 0) out.push(update());
      out.push(decrease(scaled));
    }
    if (updatePlacement === 'after') out.push(update());
    out.push(flashRepay(amount, updatePlacement === 'before' ? 2 : 1));
    return {instructions: out, liquidityPerRound: scaled};
  };
  const specs = [];
  for (const amount of [1n, 2n, 10n, 1000n, 1_000_000n, 1_000_000_000n, available - 1n, available, available + 1n])
    specs.push([`direct_flash_${amount}`, direct(amount), {amountRaw: amount.toString(), kind: 'flash-pair'}]);
  for (const amount of [1n, 2n, 10n, 1000n, 1_000_000n, 1_000_000_000n, available / 100n, available * 9n / 10n, available]) {
    const x = cycle(amount);
    specs.push([`orca_one_sided_roundtrip_${amount}`, x.instructions,
      {amountRaw: amount.toString(), liquidityPerRound: x.liquidityPerRound.toString(), rounds: 1, kind: 'KLend→Orca→KLend'}]);
  }
  for (const rounds of [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 24, 26, 27]) {
    const x = cycle(1_000_000_000n, rounds);
    specs.push([`orca_repeated_${rounds}_rounds`, x.instructions,
      {amountRaw: '1000000000', liquidityPerRound: x.liquidityPerRound.toString(), rounds, kind: 'repeated KLend→Orca→KLend'}]);
  }
  for (const placement of ['before','between','after']) {
    const x = cycle(1_000_000_000n, 1, placement);
    specs.push([`orca_update_${placement}`, x.instructions,
      {amountRaw: '1000000000', liquidityPerRound: x.liquidityPerRound.toString(), rounds: 1, updatePlacement: placement, kind: 'ordering'}]);
  }
  const wrongIndex = direct(1_000_000_000n); wrongIndex[2] = flashRepay(1_000_000_000n, 0);
  specs.push(['negative_wrong_flash_borrow_index', wrongIndex, {amountRaw: '1000000000', kind: 'order mutation'}]);
  const alias = cycle(1_000_000_000n); alias.instructions[4].keys[9].pubkey = VAULT_A;
  specs.push(['negative_orca_source_alias_to_vault', alias.instructions,
    {amountRaw: '1000000000', liquidityPerRound: alias.liquidityPerRound.toString(), kind: 'alias mutation'}]);

  const results = [];
  for (const [name, instructions, meta] of specs) {
    const result = await simulate(name, instructions, blockhash, preDecoded, meta);
    results.push(result);
    process.stdout.write(JSON.stringify({name, err: result.err, transportError: result.transportError,
      localError: result.localError, bytes: result.sizeBytes, accounts: result.addressCount, instructions: result.instructionCount,
      units: result.unitsConsumed, deltas: result.deltas, logs: result.logs?.slice(-5)}) + '\n');
    await new Promise(resolve => setTimeout(resolve, 220));
  }
  const output = {generatedAt: new Date().toISOString(), safety: {readOnly: true, simulateTransactionOnly: true,
    submitted: false, sigVerify: false}, transactionFormat: {version: 1, maxBytes: 4096, maxInlineAddresses: 64,
    encoder: 'local v1 encoder preserved in klend-v1-composition.js'},
    programs: {klend: KLEND.toBase58(), orca: ORCA.toBase58()},
    flashReserve: {...reserveRow, reserveAccountReadSlot: pre.context.slot, currentDecodedAvailableRaw: available.toString(),
      currentDecodedFlashFeeSf: feeRate.toString(), marketAuthority: MARKET_AUTHORITY.toBase58(), feeClassification: 'exact-zero-rate, not rounded'},
    target: {pool: POOL.toBase58(), position: POSITION.toBase58(), positionAuthority: OWNER.toBase58(),
      positionMintSeed: 'GtFaQh7LgqMbKKfDikhyJgMpaBhPWqm2NEd7yJgXe4V', originalTickRange: [-49936,-46144],
      oneSidedTickRange: [-46464,-46144], oneSidedAsset: MINT_A.toBase58()},
    watched: watched.map(String), watchedLabels: labels, preDecoded,
    debtAccounting: 'KLend flash loans create no obligation/debt account; success requires the indexed repay in the same transaction and is reconciled by restored reserve available amount, supply vault, fee vault, and wallet WSOL.',
    residualPricing: 'No unauthorized residual was identified. Token-B residual in successful range-reset cases is the original signer’s withdrawn position equity, so no net-gain claim or external price conversion is made.',
    results};
  const outputPath = 'composer-runs/2026-10-15/orca-klend-v1-extremes.json';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  fs.mkdirSync('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/orca-current-revalidation', {recursive: true});
  fs.writeFileSync('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/orca-current-revalidation/orca-klend-v1-extremes.json', JSON.stringify(output, null, 2) + '\n');
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
