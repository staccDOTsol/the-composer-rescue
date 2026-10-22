#!/usr/bin/env node
// Read-only screening of independent on-chain pools. Liquidity is third-party
// indicative data and must be checked against current pool state before use.
const fs=require('fs');
const path=require('path');
const directory=__dirname;
const strategies=require(path.join(directory,'kliquidity-top5-fixtures.json')).rows;
const usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const sol='So11111111111111111111111111111111111111112';
async function main(){
  const rows=[];
  for(const s of strategies){
    const tokenA=s.pool.mintA, tokenB=s.pool.mintB;
    const res=await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${tokenA}`);
    if(!res.ok)throw Error(`DexScreener ${res.status} for ${tokenA}`);
    const pairs=await res.json();
    const relevant=pairs.filter(p=>p.chainId==='solana'&&(
      [tokenA,tokenB].includes(p.baseToken?.address)&&
      [tokenA,tokenB].includes(p.quoteToken?.address)||
      [tokenA,tokenB,usdc,sol].includes(p.baseToken?.address)&&
      [tokenA,tokenB,usdc,sol].includes(p.quoteToken?.address)))
      .map(p=>({pool:p.pairAddress,venue:p.dexId,labels:p.labels||[],
        base:p.baseToken?.address,baseSymbol:p.baseToken?.symbol,
        quote:p.quoteToken?.address,quoteSymbol:p.quoteToken?.symbol,
        liquidityUsd:p.liquidity?.usd??null,baseLiquidity:p.liquidity?.base??null,
        quoteLiquidity:p.liquidity?.quote??null,volume24hUsd:p.volume?.h24??null,
        priceUsd:p.priceUsd??null,url:p.url,independent:p.pairAddress!==s.strategyPool,
        direct:[tokenA,tokenB].includes(p.baseToken?.address)&&[tokenA,tokenB].includes(p.quoteToken?.address)}))
      .sort((a,b)=>(b.liquidityUsd||0)-(a.liquidityUsd||0));
    rows.push({strategy:s.strategy,manipulatedPool:s.strategyPool,
      tokenA,tokenB,apiStatus:res.status,pairCount:pairs.length,pairs:relevant});
    await new Promise(r=>setTimeout(r,220));
  }
  const out={observedAtUtc:new Date().toISOString(),api:'https://api.dexscreener.com/token-pairs/v1/solana/{mint}',kind:'screening only: third-party liquidity/volume, not executable quote',rows};
  fs.writeFileSync(path.join(directory,'kliquidity-independent-venues.json'),JSON.stringify(out,null,2)+'\n');
  for(const r of rows){
    console.log(`\n${r.strategy} manipulated=${r.manipulatedPool} pairs=${r.pairCount}`);
    for(const p of r.pairs.slice(0,12))console.log([p.independent?'B':'A',p.venue,p.pool,p.baseSymbol+'/'+p.quoteSymbol,`$${Math.round(p.liquidityUsd||0)}`,`vol=$${Math.round(p.volume24hUsd||0)}`,p.direct?'direct':'multihop'].join(' '));
  }
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
