const fs = require('fs');
const {
  Connection, PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const connection = new Connection(rpcUrl, 'confirmed');
const program = new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const outPath = `${__dirname}/custody-evidence.json`;

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function prices(mints) {
  const out = {};
  for (const batch of chunks([...new Set(mints)], 80)) {
    const ids = batch.map(mint => `solana:${mint}`).join(',');
    const response = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
    if (!response.ok) throw new Error(`price fetch ${response.status}`);
    const body = await response.json();
    for (const [key, value] of Object.entries(body.coins || {})) out[key.slice(7)] = value;
  }
  return out;
}

(async () => {
  const slot = await connection.getSlot('confirmed');
  const blockTime = await connection.getBlockTime(slot);
  const reserveAccounts = await connection.getProgramAccounts(program, {commitment: 'confirmed',
    filters: [{dataSize: 619}]});
  const reserves = reserveAccounts.map(({pubkey, account}) => {
    const data = account.data;
    return {reserve: pubkey.toBase58(), owner: account.owner.toBase58(),
      market: new PublicKey(data.subarray(10, 42)).toBase58(),
      mint: new PublicKey(data.subarray(42, 74)).toBase58(), decimals: data[74],
      vault: new PublicKey(data.subarray(75, 107)).toBase58(),
      feeReceiver: new PublicKey(data.subarray(339, 371)).toBase58()};
  });
  const vaultInfos = [];
  for (const batch of chunks(reserves.map(row => new PublicKey(row.vault)), 100)) {
    vaultInfos.push(...await connection.getMultipleAccountsInfo(batch, 'confirmed'));
  }
  const rows = [];
  for (let i = 0; i < reserves.length; i++) {
    const reserve = reserves[i];
    const info = vaultInfos[i];
    if (!info || info.data.length < 72) continue;
    const mint = new PublicKey(info.data.subarray(0, 32)).toBase58();
    const authority = new PublicKey(info.data.subarray(32, 64)).toBase58();
    const amount = info.data.readBigUInt64LE(64);
    const [expectedAuthority] = PublicKey.findProgramAddressSync(
      [new PublicKey(reserve.market).toBuffer()], program);
    rows.push({...reserve, tokenOwner: info.owner.toBase58(), vaultMint: mint, authority,
      rawAmount: amount.toString(), expectedAuthority: expectedAuthority.toBase58(),
      verified: reserve.owner === program.toBase58() && info.owner.toBase58() === tokenProgram &&
        reserve.mint === mint && expectedAuthority.toBase58() === authority});
  }
  const nonzero = rows.filter(row => row.verified && row.rawAmount !== '0');
  const px = await prices(nonzero.map(row => row.mint));
  for (const row of nonzero) {
    const price = px[row.mint];
    row.valuation = price ? {priced: true, symbol: price.symbol, usdPrice: price.price,
      priceTimestamp: price.timestamp, confidence: price.confidence,
      amount: Number(row.rawAmount) / 10 ** price.decimals,
      usdValue: Number(row.rawAmount) / 10 ** price.decimals * price.price} : {priced: false};
  }
  const priced = nonzero.filter(row => row.valuation.priced);
  const summary = {reserveAccounts: reserves.length, parsedVaults: rows.length,
    verifiedNonzeroVaults: nonzero.length, pricedVerifiedVaults: priced.length,
    unpricedVerifiedVaults: nonzero.length - priced.length,
    pricedGrossUsd: priced.reduce((sum, row) => sum + row.valuation.usdValue, 0),
    topPricedVaults: priced.sort((a, b) => b.valuation.usdValue - a.valuation.usdValue).slice(0, 10)
      .map(({reserve, market, vault, mint, authority, expectedAuthority, rawAmount, valuation}) =>
        ({reserve, market, vault, mint, authority, expectedAuthority, rawAmount, valuation}))};
  fs.writeFileSync(outPath, JSON.stringify({program: program.toBase58(), observedSlot: slot,
    observedBlockTime: blockTime, observedAt: new Date().toISOString(), reserveLayoutSize: 619,
    reserveOwner: program.toBase58(), tokenProgram, priceSource: 'https://coins.llama.fi/prices/current',
    summary}, null, 2));
  console.log(JSON.stringify({observedSlot: slot, observedBlockTime: blockTime, summary}, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
