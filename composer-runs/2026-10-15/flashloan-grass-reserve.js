// Read-only GRASS Kamino reserve decode and token balances.
const fs = require('fs');
const {Connection, PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
const connection = new Connection(url, 'confirmed');
const reserveKey = new PublicKey('edvzA1zGyCWqsgM2EBEPhLgn9dfiqrYwJM4VwLg4wBx');
const idl = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/marginfi-source/idls-complete/kamino_lending.json'));
const coder = new anchor.BorshAccountsCoder(idl);
function normalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof PublicKey) return value.toBase58();
  if (typeof value.toString === 'function' && value.constructor?.name === 'BN') return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = normalize(child);
  return out;
}
(async () => {
  const account = await connection.getAccountInfoAndContext(reserveKey, 'confirmed');
  if (!account.value) throw new Error('GRASS reserve not found');
  const decoded = normalize(coder.decode('Reserve', account.value.data));
  const keys = [decoded.liquidity.supply_vault, decoded.liquidity.fee_vault,
    '5V9zacMMoMgMfWEWnVUUPRwBpdJtmEaKL5DqT5oDpC1o',
    '9cgnBLaq9uzH63UyPbpXT3H6TEBqjTj2CiK1xebSgCAL'];
  const infos = await connection.getMultipleAccountsInfoAndContext(keys.map(x => new PublicKey(x)), 'confirmed');
  const tokenAccounts = keys.map((key, i) => ({key, owner: infos.value[i]?.owner?.toBase58(),
    rawAmount: infos.value[i]?.data?.length >= 72 ? infos.value[i].data.readBigUInt64LE(64).toString() : null,
    mint: infos.value[i]?.data?.length >= 32 ? new PublicKey(infos.value[i].data.subarray(0,32)).toBase58() : null,
    tokenAuthority: infos.value[i]?.data?.length >= 64 ? new PublicKey(infos.value[i].data.subarray(32,64)).toBase58() : null}));
  const output = {timestamp: new Date().toISOString(), reserve: reserveKey.toBase58(),
    slot: account.context.slot, dataLength: account.value.data.length,
    decoded: {version: decoded.version, last_update: decoded.last_update,
      lending_market: decoded.lending_market, liquidity: decoded.liquidity,
      collateral: decoded.collateral, config: decoded.config},
    tokenAccounts};
  fs.writeFileSync('composer-runs/2026-10-15/flashloan-grass-reserve.json', JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({slot: output.slot, reserve: output.reserve,
    lendingMarket: decoded.lending_market, liquidity: {
      mint: decoded.liquidity.mint_pubkey, supply: decoded.liquidity.supply_vault,
      fee: decoded.liquidity.fee_vault, available: decoded.liquidity.total_available_amount,
      borrowed: decoded.liquidity.borrowed_amount_sf, fees: decoded.config.fees},
    tokenAccounts}, null, 2));
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
