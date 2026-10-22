#!/usr/bin/env node
'use strict';
// Read-only liquidity triage of a bounded, earlier top-holder census.
// A quote is neither an authorized withdrawal nor proof that the entire
// account balance can be sold at this price.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const census = JSON.parse(fs.readFileSync(path.join(dir, 'mainnet-token-authority-census.raw.json')));
const excluded = new Set([
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
]);
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const authorityToPrograms = new Map();
for (const p of census.programsByDirectStateAuthority) {
  if (excluded.has(p.programId)) continue;
  for (const authority of p.authorities) {
    const ids = authorityToPrograms.get(authority) || [];
    ids.push(p.programId);
    authorityToPrograms.set(authority, ids);
  }
}
const holdings = new Map();
for (const t of census.tokenAccounts) {
  for (const programId of authorityToPrograms.get(t.authority) || []) {
    const id = `${programId}:${t.mint}`;
    const h = holdings.get(id) || {
      programId, mint: t.mint, symbol: t.symbol || null, decimals: t.decimals,
      usdMark: 0, rawAmount: 0n, accounts: 0
    };
    h.usdMark += t.usdValue || 0;
    h.rawAmount += BigInt(t.rawAmount || '0');
    h.accounts++;
    holdings.set(id, h);
  }
}
// Quote each mint once, using the largest sampled controller position for
// that mint. This keeps the API cost bounded without miscounting programs.
const byMint = new Map();
for (const h of holdings.values()) {
  if (h.usdMark < 50000 || h.rawAmount <= 0n || h.decimals == null) continue;
  const prev = byMint.get(h.mint);
  if (!prev || h.usdMark > prev.usdMark) byMint.set(h.mint, h);
}
const selected = [...byMint.values()].sort((a,b)=>b.usdMark-a.usdMark).slice(0,120);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function quote(h, numerator, denominator) {
  if (h.mint === USDC) return {status: 'same_asset', outAmount: ((h.rawAmount*numerator)/denominator).toString()};
  const amount = (h.rawAmount*numerator)/denominator;
  if (!amount) return {status:'dust'};
  const params = new URLSearchParams({inputMint:h.mint,outputMint:USDC,
    amount:amount.toString(),slippageBps:'100'});
  for (let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetch('https://lite-api.jup.ag/swap/v1/quote?'+params,
        {signal:AbortSignal.timeout(18000)});
      const body=await response.json();
      if (response.status===429 && attempt<2) { await wait(650*(attempt+1)); continue; }
      return {status:response.status, inputAmount:amount.toString(),
        outAmount:body.outAmount||null, error:body.error||null,
        contextSlot:body.contextSlot||null,
        routeLabels:(body.routePlan||[]).map(x=>x.swapInfo?.label||null)};
    } catch(e) {
      if(attempt===2) return {status:'fetch_error',error:String(e.message)};
      await wait(500*(attempt+1));
    }
  }
}
(async()=>{
  const rows=[];
  for(let i=0;i<selected.length;i++){
    const h=selected[i];
    const tenPercent=await quote(h,1n,10n);
    await wait(80);
    const full=await quote(h,1n,1n);
    rows.push({...h,rawAmount:h.rawAmount.toString(),tenPercent,full});
    if ((i+1)%20===0) console.log(`screened ${i+1}/${selected.length}`);
    await wait(80);
  }
  const out={observedAtUtc:new Date().toISOString(), network:'mainnet-beta',
    source:'mainnet-token-authority-census.raw.json',
    sourceMethod:'Top 20 token accounts per each of 3,987 Jupiter-verified mints; historical snapshot, not live balance refresh',
    selectedProgramMintCount:[...holdings.values()].filter(x=>x.usdMark>=50000).length,
    selectedDistinctMintCount:selected.length,
    quoteMethod:'Read-only Jupiter ExactIn best route from 10% and 100% of the largest sampled controller position of each mint to USDC; no transaction built or submitted',
    limitations:['Amounts and registry marks derive from an earlier bounded top-holder snapshot',
      'Pool quote may be stale, unexecutable, or change before execution',
      'Quote liquidity does not establish program signer authority or outsider access',
      'Program-controlled custody does not equal extractable value'],
    noTransaction:true,rows};
  const output=path.join(dir,'large-custody-exit-screen.json');
  fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({output,rows:rows.length,withTenPercentQuote:rows.filter(r=>r.tenPercent.outAmount).length,
    withFullQuote:rows.filter(r=>r.full.outAmount).length}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
