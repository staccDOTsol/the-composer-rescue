#!/usr/bin/env node
// Read-only current-state liquidity capacity crosswalk for all eleven active
// Vault -> Oracle -> DEX paths. No transaction submission.
const fs = require('fs');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection, PublicKey} = require(modules + '@solana/web3.js');
const {BorshAccountsCoder} = require(modules + '@coral-xyz/anchor');
const root = __dirname;
const idls = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl';
const e = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const conn = new Connection(e.HEAVY_RPC_URL || e.RPC_URL, 'confirmed');
const dexCoder = new BorshAccountsCoder(JSON.parse(fs.readFileSync(`${idls}/dex.json`, 'utf8')));
const liqCoder = new BorshAccountsCoder(JSON.parse(fs.readFileSync(`${idls}/liquidity.json`, 'utf8')));
const p = x => new PublicKey(x);
const str = x => x?.toString?.() ?? null;
function decodePosition(info) {
  if (!info) return null;
  for (const type of ['UserSupplyPosition', 'UserBorrowPosition']) {
    try { return {type, value: liqCoder.decode(type, info.data)}; } catch (_) {}
  }
  return {type: 'unknown', value: {}};
}
async function main() {
  const census = JSON.parse(fs.readFileSync(`${root}/jupiter-dex-peg-path-census.json`, 'utf8'));
  const lenders = JSON.parse(fs.readFileSync(`${root}/klend-zero-fee-census.json`, 'utf8')).activeZero;
  const rows = [];
  for (const path of census.paths) {
    const addrs = [path.dex, path.dexPositionToken0, path.dexPositionToken1,
      path.tokenReserve0, path.tokenReserve1];
    const fetched = await conn.getMultipleAccountsInfoAndContext(addrs.map(p), 'confirmed');
    const [d, s0, s1, r0, r1] = fetched.value;
    const dex = d && dexCoder.decode('Dex', d.data);
    const pos0 = decodePosition(s0);
    const pos1 = decodePosition(s1);
    const reserve0 = r0 && liqCoder.decode('TokenReserve', r0.data);
    const reserve1 = r1 && liqCoder.decode('TokenReserve', r1.data);
    const mints = dex ? [dex.token_0, dex.token_1].map(str) : [];
    rows.push({vaultId: path.vaultId, pegKind: path.pegKind, sourceType: path.sourceType,
      slot: fetched.context.slot, dex: path.dex, mints,
      collateralFactorBps: path.collateralFactorBps,
      positions: path.activity.positionCount,
      borrowingPositions: path.activity.borrowingPositions,
      totalPositionSupplyRaw: path.activity.totalPositionSupplyRaw,
      dexFeeBps4: str(dex?.fee), centerPriceX15: str(dex?.center_price),
      dexPosition0Type: pos0?.type, dexPosition1Type: pos1?.type,
      dexSupply0Raw: str(pos0?.value?.amount), dexSupply1Raw: str(pos1?.value?.amount),
      dexWithdrawal0LimitRaw: str(pos0?.value?.withdrawal_limit),
      dexWithdrawal1LimitRaw: str(pos1?.value?.withdrawal_limit),
      reserve0SupplyPriceX12: str(reserve0?.supply_exchange_price),
      reserve1SupplyPriceX12: str(reserve1?.supply_exchange_price),
      exactZeroFeeLenders: mints.map(mint => lenders.filter(x => x.mint === mint)
        .map(x => ({reserve: x.reserve, market: x.market,
          availableRawAtCensus: x.availableRaw}))) });
  }
  const out = {generatedAt: new Date().toISOString(), transport: 'read-only current-mainnet getMultipleAccounts',
    liveSubmission: false, pathCount: rows.length, rows};
  fs.writeFileSync(`${root}/jupiter-dex-path-liquidity.json`, JSON.stringify(out, null, 2));
  for (const x of rows) console.log(JSON.stringify({vaultId:x.vaultId,
    dexSupply0Raw:x.dexSupply0Raw,dexSupply1Raw:x.dexSupply1Raw,
    zeroLenders:x.exactZeroFeeLenders.map(y=>y.length),
    totalPositionSupplyRaw:x.totalPositionSupplyRaw}));
}
main().catch(e => {console.error(e.stack); process.exitCode = 1});
