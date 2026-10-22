#!/usr/bin/env node
// Public GET spot order book snapshots, no account access or orders.
const fs=require('fs');const path=require('path');
const urls={
  kraken:'https://api.kraken.com/0/public/Depth?pair=SKRUSD&count=500',
  kucoin:'https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=SKR-USDT',
  gate:'https://api.gateio.ws/api/v4/spot/order_book?currency_pair=SKR_USDT&limit=1000&with_id=true',
  bybit:'https://api.bybit.com/v5/market/orderbook?category=spot&symbol=SKRUSDT&limit=200',
};
async function get(url){const res=await fetch(url);if(!res.ok)throw new Error(`HTTP ${res.status} ${new URL(url).host}`);return res.json()}
const sum=(rows)=>rows.reduce((a,r)=>({skr:a.skr+r.amount,usd:a.usd+r.amount*r.price}),{skr:0,usd:0});
function parseRows(rows){return rows.map((x)=>({price:Number(x[0]),amount:Number(x[1])}));}
(async()=>{
  const entries=await Promise.all(Object.entries(urls).map(async([venue,url])=>[venue,await get(url)]));
  const raw=Object.fromEntries(entries);
  if(raw.kraken.error?.length)throw new Error(`Kraken ${raw.kraken.error}`);
  if(raw.kucoin.code!=='200000')throw new Error(`KuCoin ${raw.kucoin.msg}`);
  if(raw.gate.label)throw new Error(`Gate ${raw.gate.message}`);
  if(raw.bybit.retCode!==0)throw new Error(`Bybit ${raw.bybit.retMsg}`);
  const books={
    kraken:{quote:'USD',bids:parseRows(raw.kraken.result.SKRUSD.bids),asks:parseRows(raw.kraken.result.SKRUSD.asks)},
    kucoin:{quote:'USDT',bids:parseRows(raw.kucoin.data.bids),asks:parseRows(raw.kucoin.data.asks)},
    gate:{quote:'USDT',bids:parseRows(raw.gate.bids),asks:parseRows(raw.gate.asks)},
    bybit:{quote:'USDT',bids:parseRows(raw.bybit.result.b),asks:parseRows(raw.bybit.result.a)},
  };
  const thresholds=[0.01,0.05,0.10];
  const summary=Object.fromEntries(Object.entries(books).map(([venue,book])=>{
    const bestBid=book.bids[0].price,bestAsk=book.asks[0].price;
    const depth=Object.fromEntries(thresholds.map((t)=>{
      const target=bestBid*(1-t);
      const within=book.bids.filter((r)=>r.price>=target);
      return [`within${Math.round(t*100)}pct`,{...sum(within),lastIncludedPrice:within.at(-1)?.price??null,
        lastVisiblePrice:book.bids.at(-1)?.price??null,
        truncatedWithinRange:book.bids.at(-1)?.price>=target}];
    }));
    return [venue,{quote:book.quote,bestBid,bestAsk,spreadPct:100*(bestAsk-bestBid)/((bestAsk+bestBid)/2),
      bidLevels:book.bids.length,askLevels:book.asks.length,depth}];
  }));
  const combined={};
  for(const key of ['within1pct','within5pct','within10pct']){
    combined[key]={skr:0,usdOrUsdt:0};
    for(const s of Object.values(summary)){
      combined[key].skr+=s.depth[key].skr;
      combined[key].usdOrUsdt+=s.depth[key].usd;
    }
  }
  const output={generatedAt:new Date().toISOString(),urls,summary,combined,raw,
    notes:['Only displayed bid levels at four public spot venues. Quotes are USD or USDT; combined numbers treat 1 USDT approximately as 1 USD.',
      'Books are cancellable, snapshots not synchronized, and none of this liquidity is atomically reachable from a Solana transaction.',
      'If truncatedWithinRange is true, returned order-book levels stop inside the threshold and reported depth is incomplete.']};
  fs.writeFileSync(path.join(__dirname,'cex-depth.json'),JSON.stringify(output,null,2)+'\n');
  process.stdout.write(JSON.stringify({at:output.generatedAt,summary,combined},null,2)+'\n');
})().catch((e)=>{process.stderr.write(`${e.stack||e.message}\n`);process.exitCode=1});
