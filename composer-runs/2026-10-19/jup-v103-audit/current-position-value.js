#!/usr/bin/env node
// Read-only live account and signed oracle simulation for Jupiter DEX vault 103.
// The wallet secret is read into memory solely to sign simulateTransaction and is never output.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection, PublicKey, Keypair, TransactionInstruction} = require(modules + '@solana/web3.js');
const {BorshAccountsCoder} = require(modules + '@coral-xyz/anchor');
const bs58m = require(modules + 'bs58'), bs58 = bs58m.default || bs58m;
const {encodeV1} = require('../../2026-10-15/klend-v1-composition.js');
const idlRoot = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl';
if (!process.env.SOLANA_RPC) throw Error('SOLANA_RPC is required');
const conn = new Connection(process.env.SOLANA_RPC, 'confirmed');
const P = x => new PublicKey(x);
const vaults = P('jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi');
const oracleProgram = P('jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc');
const V = {
  oracle: P('Hf9Yw2a1EA9aTUbHS8N7AoyqXvWrRvsZqGJuC4YVeaXN'),
  source: P('H8i4Bz4inXLyWQFgGjXc8sYNCvQgAaAAS45ZZ4UqCCcV'),
  dex: P('G41Dqz9A1v39TT2MryR5BkZU2a7UzfUkiRHyJGuRfeyF'),
  supply0: P('EdRupWtgK6FRjTHCo2TgbjDUGe91oNQno1tG6Vj35fvW'),
  supply1: P('8qXBLcG7hm1NKeAxGbX7kxEy9HhevX4SN6yAmDduQNYk'),
  reserve0: P('2zhomdC3giLb5vf91fCZiKWiFXAD9NwMcV8EQo8NmA3i'),
  reserve1: P('94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu'),
  conversion: P('DXSLbLNfjYrjp4KKoDnLXT5j5Wdcr9hZCGCwpeeyDxZV'),
};
const idl = JSON.parse(fs.readFileSync(path.join(idlRoot, 'vaults.json'), 'utf8'));
const coder = new BorshAccountsCoder(idl);
const positionDisc = Buffer.from(idl.accounts.find(x => x.name === 'Position').discriminator);
const vId = Buffer.from([103, 0]);
const FACTORS = [18446744073709551616n, 18419115400608638658n, 18391528108445969703n,
  18336477419114433396n, 18226869890870665593n, 18009616477100071088n,
  17582847377087825313n, 16759408633341240198n, 15226414841393184936n,
  12568272644527235157n, 8563108841104354677n, 3975055583337633975n,
  856577552520149366n, 39775317560084773n, 85764505686420n, 398745188n];
function ratioAtTick(tick) {
  const abs = Math.abs(tick);
  let factor = FACTORS[0];
  for (let bit = 0; bit < 15; bit++) if (abs & (1 << bit))
    factor = bit === 0 ? FACTORS[1] : (factor * FACTORS[bit + 1]) >> 64n;
  let precision = 0n;
  if (tick > 0) {
    factor = ((1n << 128n) - 1n) / factor;
    if (factor & 65535n) precision = 1n;
  }
  return (factor >> 16n) + precision;
}
function tickPda(tick) {
  const shifted = Buffer.alloc(4); shifted.writeUInt32LE(tick + 16383);
  return PublicKey.findProgramAddressSync([Buffer.from('tick'), vId, shifted], vaults)[0];
}
function readU128(b, offset) {
  let n = 0n; for (let i = 15; i >= 0; i--) n = (n << 8n) + BigInt(b[offset + i]); return n;
}
function clean(v) {
  if (v instanceof PublicKey) return v.toBase58();
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object' && 'toString' in v && v.constructor?.name === 'BN') return v.toString();
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
  return typeof v === 'bigint' ? v.toString() : v;
}
async function signedOracleRead() {
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8')));
  const wallet = Keypair.fromSecretKey(secret);
  const ix = new TransactionInstruction({programId: oracleProgram,
    keys: [V.oracle, V.source, V.dex, V.supply0, V.supply1, V.reserve0, V.reserve1, V.conversion]
      .map(pubkey => ({pubkey, isSigner: false, isWritable: false})),
    data: Buffer.from([92, 88, 161, 46, 230, 193, 46, 237, 100, 0])});
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const encoded = encodeV1([ix], wallet.publicKey, blockhash);
  const wire = Buffer.from(encoded.wire);
  const msg = wire.subarray(0, wire.length - 64);
  const key = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(secret.subarray(0, 32))]),
    format: 'der', type: 'pkcs8'});
  crypto.sign(null, msg, key).copy(wire, wire.length - 64);
  const response = await fetch(process.env.SOLANA_RPC, {method: 'POST',
    headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1,
      method: 'simulateTransaction', params: [wire.toString('base64'),
        {encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
          commitment: 'confirmed'}]})});
  const json = await response.json();
  const result = json.result?.value;
  const prefix = `Program return: ${oracleProgram.toBase58()} `;
  const returns = (result?.logs || []).filter(line => line.startsWith(prefix)).map(line => {
    const b = Buffer.from(line.slice(prefix.length), 'base64');
    return b.length >= 32 ? {supplyRateX15: readU128(b, 0).toString(),
      borrowRateX15: readU128(b, 16).toString()} : null;
  }).filter(Boolean);
  return {slot: json.result?.context?.slot || null, err: result?.err || null,
    transportError: json.error || null, sigVerify: true, wireVersion: 1,
    wireBytes: encoded.sizeBytes, addressCount: encoded.addressCount,
    instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
    wireSha256: crypto.createHash('sha256').update(wire).digest('hex'),
    unitsConsumed: result?.unitsConsumed || null, returns};
}
async function main() {
  const [rawPositions, oracle] = await Promise.all([
    conn.getProgramAccounts(vaults, {commitment: 'confirmed', filters: [
      {dataSize: 71}, {memcmp: {offset: 0, bytes: bs58.encode(positionDisc)}},
      {memcmp: {offset: 8, bytes: bs58.encode(vId)}}]}), signedOracleRead()]);
  const positions = rawPositions.map(a => ({address: a.pubkey.toBase58(),
    decoded: coder.decode('Position', a.account.data)}));
  const distinctTicks = [...new Set(positions.filter(p => !p.decoded.is_supply_only_position)
    .map(p => p.decoded.tick))];
  const tickKeys = distinctTicks.map(tickPda);
  const tickAccounts = await conn.getMultipleAccountsInfoAndContext(tickKeys, 'confirmed');
  const ticks = Object.fromEntries(distinctTicks.map((tick, i) => [tick,
    tickAccounts.value[i] ? clean(coder.decode('Tick', tickAccounts.value[i].data)) : null]));
  const supplyRate = oracle.returns[0] ? BigInt(oracle.returns[0].supplyRateX15) : null;
  const rows = positions.map(({address, decoded: p}) => {
    const colRaw = BigInt(p.supply_amount.toString());
    const dustDebtRaw = BigInt(p.dust_debt_amount.toString());
    const tick = ticks[p.tick];
    const liquidated = !p.is_supply_only_position && (!tick || Number(tick.is_liquidated) !== 0 ||
      Number(tick.total_ids) > Number(p.tick_id));
    const debtRaw = p.is_supply_only_position ? 0n : liquidated ? null :
      ((ratioAtTick(p.tick) * (colRaw + 1n)) >> 48n) + 1n;
    const netDebtRaw = debtRaw === null ? null : debtRaw > dustDebtRaw ? debtRaw - dustDebtRaw : 0n;
    const liquidationRateX15 = p.is_supply_only_position || netDebtRaw === null || colRaw === 0n ? null :
      (netDebtRaw * 1000n * 1000000000000000n + 900n * colRaw - 1n) / (900n * colRaw);
    return {address, nftId: p.nft_id, positionMint: p.position_mint.toBase58(),
      tick: p.tick, tickId: p.tick_id, supplyOnly: Boolean(p.is_supply_only_position),
      liquidatedOrUnresolved: liquidated, collateralSharesRaw9: colRaw.toString(),
      dustDebtInternalRaw9: dustDebtRaw.toString(), debtInternalRaw9: debtRaw?.toString() || null,
      netDebtInternalRaw9: netDebtRaw?.toString() || null,
      liquidationOracleRateX15Ceil: liquidationRateX15?.toString() || null,
      liquidationHeadroomBpsFloor: supplyRate === null || liquidationRateX15 === null ? null :
        ((supplyRate - liquidationRateX15) * 10000n / supplyRate).toString(),
      collateralOracleUsdcRaw6Floor: supplyRate === null ? null :
        (colRaw * supplyRate / 1000000000000000000n).toString(),
      debtUsdcRaw6Ceil: netDebtRaw === null ? null : ((netDebtRaw + 999n) / 1000n).toString(),
      oracleEquityUsdcRaw6Floor: supplyRate === null || netDebtRaw === null ? null :
        (colRaw * supplyRate / 1000000000000000000n - (netDebtRaw + 999n) / 1000n).toString()};
  }).sort((a, b) => BigInt(a.collateralSharesRaw9) > BigInt(b.collateralSharesRaw9) ? -1 : 1);
  const borrowerRows = rows.filter(p => !p.supplyOnly);
  const sum = (field, group = rows) => group.reduce((a, p) => a + BigInt(p[field] || 0), 0n).toString();
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'current-finalized-state.json')));
  const result = {generatedAt: new Date().toISOString(), commitment: 'confirmed',
    readOnly: true, mainnetSubmission: false, positionCount: rows.length,
    borrowerCount: borrowerRows.length, tickContextSlot: tickAccounts.context.slot,
    oracle, oracleSourceCount: state.decoded.oracle.sources.length,
    oracleSourceType: Object.keys(state.decoded.oracle.sources[0].source_type)[0],
    vault: {totalSupplyInternalRaw9: cleanBn(state.decoded.vaultState.total_supply),
      totalBorrowInternalRaw9: cleanBn(state.decoded.vaultState.total_borrow),
      totalDexSharesRaw9: cleanBn(state.decoded.dex.total_supply_shares),
      poolSUSDaiSupplyRaw6: cleanBn(state.decoded.supply0.amount),
      poolUSDCSupplyRaw6: cleanBn(state.decoded.supply1.amount),
      borrowFeeConfigRaw: state.decoded.config.borrow_fee,
      collateralFactorPermille: state.decoded.config.collateral_factor,
      liquidationThresholdPermille: state.decoded.config.liquidation_threshold},
    totals: {borrowerCollateralSharesRaw9: sum('collateralSharesRaw9', borrowerRows),
      borrowerNetDebtInternalRaw9: sum('netDebtInternalRaw9', borrowerRows),
      borrowerOracleCollateralUsdcRaw6Floor: sum('collateralOracleUsdcRaw6Floor', borrowerRows),
      borrowerDebtUsdcRaw6Ceil: sum('debtUsdcRaw6Ceil', borrowerRows),
      borrowerOracleEquityUsdcRaw6Floor: sum('oracleEquityUsdcRaw6Floor', borrowerRows)},
    ticks, positions: rows};
  fs.writeFileSync(path.join(__dirname, 'current-position-value.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({positionCount: result.positionCount, borrowerCount: result.borrowerCount,
    oracle: result.oracle, totals: result.totals,
    unresolvedPositionCount: rows.filter(p => p.liquidatedOrUnresolved).length,
    poolSUSDaiSupplyRaw6: result.vault.poolSUSDaiSupplyRaw6,
    poolUSDCSupplyRaw6: result.vault.poolUSDCSupplyRaw6}, null, 2));
}
function cleanBn(v) { return v.words.reduceRight((n, w) => n * 67108864n + BigInt(w), 0n).toString(); }
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
