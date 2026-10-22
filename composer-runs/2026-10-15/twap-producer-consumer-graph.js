#!/usr/bin/env node
// Read-only current Scope mapping dependency graph, joined to KLend consumers.
// No transaction submission. RPC endpoint is loaded from a local environment file
// and is never printed or persisted.
const fs = require('fs');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const root = __dirname;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split('\n').filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
const mappingCensus = require('./scope-live-mapping-census.json');
const klend = require('./scope-klend-consumer-crosswalk.json');
const AMM_TYPES = new Set([13, 14, 15, 16, 18, 19]);
const TWAP_TYPES = new Set([12, 40, 41, 42]);
const PUBKEY_OFFSET = 8;
const TYPE_OFFSET = PUBKEY_OFFSET + 512 * 32;
const TOLERANCE_OFFSET = TYPE_OFFSET + 512;
const MASK_OFFSET = TOLERANCE_OFFSET + 512 * 2;
const REF_OFFSET = MASK_OFFSET + 512;
const GENERIC_OFFSET = REF_OFFSET + 512 * 2;

async function rpc(method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(endpoint, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id:1,method,params}) });
    const body = await response.json();
    if (!body.error) return body.result;
    if (body.error.code === 429) { await new Promise(r => setTimeout(r, 700 * (attempt + 1))); continue; }
    throw new Error(JSON.stringify(body.error));
  }
  throw new Error('RPC throttled');
}
const u16 = (b, o) => b.readUInt16LE(o);
const indices = (b, o, count) => Array.from({length:count}, (_, i) => u16(b, o + i*2)).filter(i => i < 512);

function decodeEntry(b, index) {
  const type = b[TYPE_OFFSET + index] & 127;
  const frozen = !!(b[TYPE_OFFSET + index] & 128);
  const addr = new PublicKey(b.subarray(PUBKEY_OFFSET + index*32, PUBKEY_OFFSET + (index+1)*32)).toBase58();
  const generic = b.subarray(GENERIC_OFFSET + index*20, GENERIC_OFFSET + (index+1)*20);
  const ref = u16(b, REF_OFFSET + index*2);
  const tolOrTwapSource = u16(b, TOLERANCE_OFFSET + index*2);
  let sources = [];
  if (TWAP_TYPES.has(type)) sources = tolOrTwapSource < 512 ? [tolOrTwapSource] : [];
  else if (type === 28 || type === 39) sources = indices(generic, 0, 4);
  else if (type === 43) sources = indices(generic, 0, 6);
  else if (type === 33) {
    // Borsh u16 plus two Option<u16> fields.
    let offset = 0;
    sources.push(u16(generic, offset)); offset += 2;
    for (let n=0; n<2; n++) {
      const tag = generic[offset++];
      if (tag === 1) { sources.push(u16(generic, offset)); offset += 2; }
    }
    sources = sources.filter(i => i < 512);
  } else if (type === 47) sources = indices(generic, 3, 3);
  if (type === 39) { const cap = u16(generic, 18); if (cap < 512) sources.push(cap); }
  return {index, type, frozen, account:addr, refPriceIndex:ref < 512 ? ref : null,
    twapEnabledMask:b[MASK_OFFSET+index], sources, isAmm:AMM_TYPES.has(type), isTwap:TWAP_TYPES.has(type)};
}

function dependencies(entries, rootIndex, depth = 0, visited = new Set()) {
  if (rootIndex >= 512 || depth > 8 || visited.has(rootIndex)) return [];
  visited.add(rootIndex);
  const e = entries[rootIndex]; if (!e) return [];
  return [e, ...e.sources.flatMap(source => dependencies(entries, source, depth+1, visited))];
}

async function main() {
  const addresses = mappingCensus.mappings.map(m => m.address);
  const result = await rpc('getMultipleAccounts', [addresses, {encoding:'base64',commitment:'confirmed'}]);
  const mappingGraphs = result.value.map((account, i) => {
    if (!account || account.data[0] == null) throw new Error('Missing mapping '+addresses[i]);
    const b = Buffer.from(account.data[0], 'base64');
    if (b.length !== 29704) throw new Error('Unexpected mapping length '+b.length);
    const entries = Array.from({length:512}, (_, index) => decodeEntry(b, index));
    return {address:addresses[i], oraclePrices:mappingCensus.mappings[i].oraclePrices,
      oracleTwaps:mappingCensus.mappings[i].oracleTwaps, entries};
  });
  const byFeed = new Map(mappingGraphs.map(m => [m.oraclePrices, m]));
  const reserveEdges = klend.rows.map(r => {
    const m = byFeed.get(r.feed);
    const branch = r.priceChain.filter(i => i < 512).map(i => ({index:i, dependencies:dependencies(m.entries, i, 0, new Set()).map(e => e.index)}));
    const twapBranch = r.twapChain.filter(i => i < 512).map(i => ({index:i, dependencies:dependencies(m.entries, i, 0, new Set()).map(e => e.index)}));
    const all = new Set([...branch, ...twapBranch].flatMap(x => x.dependencies));
    const amms = [...all].filter(i => m.entries[i].isAmm).map(i => ({index:i, pool:m.entries[i].account, type:m.entries[i].type}));
    const twaps = [...all].filter(i => m.entries[i].isTwap).map(i => ({index:i, source:m.entries[i].sources[0], type:m.entries[i].type}));
    return {reserve:r.reserve,mint:r.mint,name:r.name,availableRaw:r.availableRaw,feed:r.feed,
      priceChain:r.priceChain,twapChain:r.twapChain,branch,twapBranch,amms,twaps};
  });
  const output = {observedAt:new Date().toISOString(),slot:result.context.slot,source:'confirmed mainnet read-only getMultipleAccounts + prior current KLend reserve crosswalk',
    noLiveSubmission:true, mappingCount:mappingGraphs.length, scopeAmmEntries:mappingGraphs.flatMap(m=>m.entries).filter(e=>e.isAmm&&!e.frozen).length,
    klendReserves:reserveEdges.length,klendAmmAffected:reserveEdges.filter(r=>r.amms.length),
    klendTwapAffected:reserveEdges.filter(r=>r.twaps.length),mappings:mappingGraphs.map(m=>({address:m.address,oraclePrices:m.oraclePrices,
      oracleTwaps:m.oracleTwaps,activeEntries:m.entries.filter(e=>e.type!==0&&!e.frozen)})),reserveEdges};
  fs.writeFileSync(`${root}/twap-producer-consumer-graph.json`,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({slot:output.slot,mappingCount:output.mappingCount,scopeAmmEntries:output.scopeAmmEntries,
    klendReserves:output.klendReserves,klendAmmAffectedCount:output.klendAmmAffected.length,
    klendTwapAffectedCount:output.klendTwapAffected.length}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
