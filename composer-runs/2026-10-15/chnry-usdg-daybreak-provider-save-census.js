#!/usr/bin/env node
// Read-only exact-mint Save/Solend reserve census on current Solana mainnet.
// No transaction construction, signing, simulation, or submission.
const fs = require('fs');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw Error('Missing configured RPC URL');
const save = 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo';
const token = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const token2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const mints = {
  USDG: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH',
  USDv: 'USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk',
};
const outPath = `${__dirname}/chnry-usdg-daybreak-provider-save-census.json`;
let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0', id:++requestId, method, params})});
  if (!response.ok) throw Error(`${method} HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result;
}
const pk = b => new PublicKey(b).toBase58();
const dataOf = a => Buffer.from(a.data[0], 'base64');
function account(a) {
  if (!a) return {exists:false};
  return {exists:true, owner:a.owner, executable:a.executable, dataBytes:dataOf(a).length};
}
function mintAccount(a) {
  const summary = account(a);
  if (!a || dataOf(a).length < 82) return summary;
  const d = dataOf(a);
  return {...summary, supplyRaw:d.readBigUInt64LE(36).toString(), decimals:d[44],
    initialized:d[45] === 1, token2022:a.owner === token2022};
}
function reserve(address, a) {
  const d = dataOf(a);
  if (d.length !== 619) throw Error(`Unexpected Save reserve bytes ${d.length}`);
  return {address, accountOwner:a.owner, version:d[0], lastUpdateSlot:d.readBigUInt64LE(1).toString(),
    stale:d[9] !== 0, market:pk(d.subarray(10,42)), mint:pk(d.subarray(42,74)),
    mintDecimals:d[74], supplyVault:pk(d.subarray(75,107)),
    pythOracle:pk(d.subarray(107,139)), switchboardOracle:pk(d.subarray(139,171)),
    availableRaw:d.readBigUInt64LE(171).toString(),
    flashLoanFeeWad:d.readBigUInt64LE(314).toString(),
    borrowLimitRaw:d.readBigUInt64LE(331).toString(),
    feeReceiver:pk(d.subarray(339,371))};
}
function vaultAccount(a) {
  const summary = account(a);
  if (!a || dataOf(a).length < 165) return summary;
  const d = dataOf(a);
  return {...summary, mint:pk(d.subarray(0,32)), authority:pk(d.subarray(32,64)),
    rawAmount:d.readBigUInt64LE(64).toString(), state:d[108]};
}
(async () => {
  const observedSlot = await rpc('getSlot', [{commitment:'confirmed'}]);
  const observedBlockTime = await rpc('getBlockTime', [observedSlot]);
  const addresses = [save, ...Object.values(mints)];
  const basics = await rpc('getMultipleAccounts', [addresses, {encoding:'base64', commitment:'confirmed'}]);
  const mintResults = Object.fromEntries(Object.keys(mints).map((label,i) =>
    [label, {...mintAccount(basics.value[i+1]), address:addresses[i+1]}]));
  const found = {};
  for (const [label, mint] of Object.entries(mints)) {
    const result = await rpc('getProgramAccounts', [save, {encoding:'base64', commitment:'confirmed',
      withContext:true, filters:[{dataSize:619},{memcmp:{offset:42,bytes:mint}}]}]);
    const rows = result.value.map(row => reserve(row.pubkey,row.account));
    const vaults = rows.length ? await rpc('getMultipleAccounts', [rows.map(row=>row.supplyVault),
      {encoding:'base64',commitment:'confirmed'}]) : {value:[]};
    found[label] = {mint, contextSlot:result.context.slot, reserveCount:rows.length,
      reserves:rows.map((row,i) => {
        const vault = vaultAccount(vaults.value[i]);
        const [authority] = PublicKey.findProgramAddressSync([new PublicKey(row.market).toBuffer()],
          new PublicKey(save));
        return {...row, vault, expectedVaultAuthority:authority.toBase58(),
          vaultVerified:vault.exists && vault.owner === token && vault.mint === mint &&
            vault.authority === authority.toBase58(),
          lendMarketTokenProgram:null};
      })};
    const anyLayout = await rpc('getProgramAccounts', [save, {encoding:'base64',
      commitment:'confirmed', withContext:true, dataSlice:{offset:0,length:0},
      filters:[{memcmp:{offset:42,bytes:mint}}]}]);
    found[label].sameMintAtReserveOffsetAnySize = {
      contextSlot:anyLayout.context.slot, count:anyLayout.value.length,
      accounts:anyLayout.value.map(row=>row.pubkey)};
  }
  const fullCensus = await rpc('getProgramAccounts', [save, {encoding:'base64',
    commitment:'confirmed', withContext:true, dataSlice:{offset:0,length:75},
    filters:[{dataSize:619}]}]);
  const censusRows = fullCensus.value.map(row => {
    const d = dataOf(row.account);
    return {address:row.pubkey, market:pk(d.subarray(10,42)), mint:pk(d.subarray(42,74))};
  });
  const markets = [...new Set(censusRows.map(r=>r.market))];
  const marketValues = [];
  for (let i=0; i<markets.length; i+=100) {
    const batch = await rpc('getMultipleAccounts', [markets.slice(i,i+100),
      {encoding:'base64',commitment:'confirmed'}]);
    marketValues.push(...batch.value);
  }
  const marketTokens = Object.fromEntries(markets.map((address,i) => {
    const a = marketValues[i];
    const d = a ? dataOf(a) : null;
    // LendingMarket: version:u8, bump:u8, owner:Pubkey,
    // quote_currency:[u8;32], token_program_id:Pubkey.
    return [address, {owner:a?.owner || null, dataBytes:d?.length || null,
      tokenProgram:d && d.length>=98 ? pk(d.subarray(66,98)) : null}];
  }));
  for (const entry of Object.values(found)) for (const row of entry.reserves)
    row.lendMarketTokenProgram=marketTokens[row.market]?.tokenProgram || null;
  const marketTokenCounts = {};
  for (const market of Object.values(marketTokens)) {
    const id = market.tokenProgram || '<missing-or-unparsed>';
    marketTokenCounts[id] = (marketTokenCounts[id] || 0) + 1;
  }
  const output = {observedAt:new Date().toISOString(), observedSlot, observedBlockTime,
    program:{address:save,...account(basics.value[0])}, mints:mintResults,
    reserveLayout:{bytes:619,mintOffset:42,availableOffset:171,flashFeeWadOffset:314,
      feeReceiverOffset:339},
    fullReserveCensus:{contextSlot:fullCensus.context.slot,reserveCount:censusRows.length,
      exactMintCounts:Object.fromEntries(Object.entries(mints).map(([label,mint])=>
        [label,censusRows.filter(row=>row.mint===mint).length])),
      marketCount:markets.length,marketTokenCounts},
    markets:marketTokens, found};
  fs.writeFileSync(outPath, JSON.stringify(output,null,2));
  console.log(JSON.stringify(output,null,2));
})().catch(error => {console.error(error.message); process.exitCode=1;});
