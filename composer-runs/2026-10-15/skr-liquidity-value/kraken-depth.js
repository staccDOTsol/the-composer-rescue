#!/usr/bin/env node
// Public, read-only Kraken SKR/USD spot order-book snapshot.
const fs=require('fs');const path=require('path');
async function get(url){const res=await fetch(url);if(!res.ok)throw new Error(`HTTP ${res.status}`);return res.json()}
(async()=>{
  const [pair,ticker,depth]=await Promise.all([
    get('https://api.kraken.com/0/public/AssetPairs?pair=SKRUSD'),
    get('https://api.kraken.com/0/public/Ticker?pair=SKRUSD'),
    get('https://api.kraken.com/0/public/Depth?pair=SKRUSD&count=500')]);
  for(const [label,value] of [['pair',pair],['ticker',ticker],['depth',depth]])
    if(value.error?.length)throw new Error(`${label}: ${value.error.join('; ')}`);
  const bids=depth.result.SKRUSD.bids.map(([price,amount,timestamp])=>({price:Number(price),amount:Number(amount),timestamp}));
  const asks=depth.result.SKRUSD.asks.map(([price,amount,timestamp])=>({price:Number(price),amount:Number(amount),timestamp}));
  const bestBid=bids[0].price,bestAsk=asks[0].price;
  const thresholds=[0.01,0.05,0.10,0.25,0.50];
  const bidDepth=thresholds.map((drop)=>{
    const levels=bids.filter((x)=>x.price>=bestBid*(1-drop));
    return {dropPct:100*drop,lowestBid:levels.at(-1)?.price??null,
      skr:levels.reduce((a,x)=>a+x.amount,0),usd:levels.reduce((a,x)=>a+x.amount*x.price,0)};
  });
  const allBidSkr=bids.reduce((a,x)=>a+x.amount,0);
  const allBidUsd=bids.reduce((a,x)=>a+x.amount*x.price,0);
  const output={generatedAt:new Date().toISOString(),pair:pair.result.SKRUSD,
    ticker:ticker.result.SKRUSD,bestBid,bestAsk,spreadPct:100*(bestAsk-bestBid)/((bestAsk+bestBid)/2),
    bidDepth,visibleBidLevels:bids.length,allVisibleBids:{skr:allBidSkr,usd:allBidUsd},
    visibleAskLevels:asks.length,bids,asks,
    notes:['A single centralized-exchange order book snapshot is cancellable and does not imply this liquidity is atomically accessible from Solana.',
      'SKR deposited to the exchange would face account, transfer, confirmation, and venue constraints.']};
  fs.writeFileSync(path.join(__dirname,'kraken-depth.json'),JSON.stringify(output,null,2)+'\n');
  process.stdout.write(JSON.stringify({at:output.generatedAt,bestBid,bestAsk,spreadPct:output.spreadPct,
    bidDepth,visibleBidLevels:bids.length,allVisibleBids:output.allVisibleBids,
    ticker24hVolumeSkr:ticker.result.SKRUSD.v?.[1]},null,2)+'\n');
})().catch((e)=>{process.stderr.write(`${e.stack||e.message}\n`);process.exitCode=1});
