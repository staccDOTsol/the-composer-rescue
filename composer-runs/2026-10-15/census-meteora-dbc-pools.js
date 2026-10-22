// Read-only, program-owned census. It maps every current PoolConfig to its
// quote mint, scans every current DBC pool, ranks priced quote-side book value,
// then verifies the leading pools against their live quote token accounts and
// canonical PDAs. No transaction is created or submitted.
const fs = require('fs');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey} = require(`${MOD}/@solana/web3.js`);

const RPC = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!RPC) throw new Error('RPC_URL required');
const PROGRAM = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
const POOL_AUTHORITY = new PublicKey('FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM');
const CONFIG_DISC = '5RKzUGPpkkA';
const POOL_TYPES = [
  {name:'VirtualPool',disc:'cmrfVvtHrjd',hex:'d5e005d16245775c'},
  {name:'TransferHookPool',disc:'gnXMCshfb9U',hex:'eddbb8172abda923'},
];

async function rpc(method, params) {
  for (let attempt=0; attempt<10; attempt++) {
    const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const text=await response.text(); let body;
    try {body=JSON.parse(text)} catch (_) {body={error:{code:response.status,message:text.slice(0,200)}}}
    if (!body.error) return body.result;
    if (attempt===9) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
    await new Promise(r=>setTimeout(r,500*(attempt+1)));
  }
}
async function getMany(addresses) {
  const out=[];
  for(let i=0;i<addresses.length;i+=100){
    const x=await rpc('getMultipleAccounts',[addresses.slice(i,i+100),{encoding:'base64',commitment:'confirmed'}]);
    out.push(...x.value);
  }
  return out;
}
async function paged(program, options, onPage) {
  let paginationKey, pages=0, count=0;
  do {
    const opt={...options,limit:10000}; if(paginationKey)opt.paginationKey=paginationKey;
    const result=await rpc('getProgramAccountsV2',[program,opt]);
    pages++; count+=result.accounts.length;
    await onPage(result.accounts,pages);
    paginationKey=result.paginationKey;
    if(pages%10===0)console.error(JSON.stringify({phase:options.phase,pages,count}));
  } while(paginationKey);
  return {pages,count};
}
function sortMints(a,b){return Buffer.compare(a.toBuffer(),b.toBuffer())>=0?[a,b]:[b,a]}
function keepTop(list,row,limit=250){
  list.push(row);
  if(list.length>=limit*2){list.sort((a,b)=>b.bookQuoteUsd-a.bookQuoteUsd);list.length=limit}
}
async function getPrices(mints){
  const prices={};
  for(let i=0;i<mints.length;i+=60){
    const ids=mints.slice(i,i+60).map(m=>`solana:${m}`).join(',');
    for(let attempt=0;attempt<5;attempt++){
      const r=await fetch(`https://coins.llama.fi/prices/current/${ids}`);
      if(r.ok){Object.assign(prices,(await r.json()).coins||{});break}
      if(attempt===4)throw new Error(`price HTTP ${r.status}`);
      await new Promise(x=>setTimeout(x,500*(attempt+1)));
    }
  }
  return prices;
}

async function main(){
  const startSlot=await rpc('getSlot',[{commitment:'confirmed'}]);
  const configToQuote=new Map(),quoteConfigCounts=new Map();
  const configScan=await paged(PROGRAM.toBase58(),{
    phase:'configs',encoding:'base64',dataSlice:{offset:8,length:32},
    filters:[{dataSize:1048},{memcmp:{offset:0,bytes:CONFIG_DISC}}],
  },accounts=>{
    for(const x of accounts){const d=Buffer.from(x.account.data[0],'base64');const mint=new PublicKey(d).toBase58();configToQuote.set(x.pubkey,mint);quoteConfigCounts.set(mint,(quoteConfigCounts.get(mint)||0)+1)}
  });
  const quoteMints=[...quoteConfigCounts.keys()];
  const mintInfos=await getMany(quoteMints);
  const mintMeta=new Map();
  for(let i=0;i<quoteMints.length;i++)if(mintInfos[i]){const d=Buffer.from(mintInfos[i].data[0],'base64');mintMeta.set(quoteMints[i],{decimals:d[44],tokenProgram:mintInfos[i].owner})}
  const prices=await getPrices(quoteMints);
  for(const mint of quoteMints){const m=mintMeta.get(mint);const p=prices[`solana:${mint}`];if(m&&p)Object.assign(m,{symbol:p.symbol,price:p.price,priceTimestamp:p.timestamp})}

  const top=[],topActive=[],poolCounts={},pricedBookRawByMint=new Map(); let unknownConfigPools=0,pricedPools=0,unpricedPools=0;
  for(const type of POOL_TYPES){
    const scan=await paged(PROGRAM.toBase58(),{
      phase:type.name,encoding:'base64',dataSlice:{offset:72,length:240},
      filters:[{dataSize:424},{memcmp:{offset:0,bytes:type.disc}}],
    },accounts=>{
      for(const x of accounts){
        const d=Buffer.from(x.account.data[0],'base64');
        const config=new PublicKey(d.subarray(0,32)).toBase58(),quoteMint=configToQuote.get(config);
        if(!quoteMint){unknownConfigPools++;continue}
        const meta=mintMeta.get(quoteMint);
        const quoteReserve=d.readBigUInt64LE(168),protocolQuoteFee=d.readBigUInt64LE(184),partnerQuoteFee=d.readBigUInt64LE(200);
        const bookRaw=quoteReserve+protocolQuoteFee+partnerQuoteFee;
        if(meta?.price!=null){
          pricedPools++;pricedBookRawByMint.set(quoteMint,(pricedBookRawByMint.get(quoteMint)||0n)+bookRaw);
          const usd=Number(bookRaw)/10**meta.decimals*meta.price;
          const row={pool:x.pubkey,poolType:type.name,config,creator:new PublicKey(d.subarray(32,64)).toBase58(),baseMint:new PublicKey(d.subarray(64,96)).toBase58(),baseVault:new PublicKey(d.subarray(96,128)).toBase58(),quoteVault:new PublicKey(d.subarray(128,160)).toBase58(),quoteMint,quoteReserve:quoteReserve.toString(),protocolQuoteFee:protocolQuoteFee.toString(),partnerQuoteFee:partnerQuoteFee.toString(),bookQuoteRawExcludingCreatorFee:bookRaw.toString(),bookQuoteUsd:usd,isMigrated:d[233]};
          keepTop(top,row);if(row.isMigrated===0)keepTop(topActive,{...row});
        } else unpricedPools++;
      }
    });
    poolCounts[type.name]=scan;
  }
  top.sort((a,b)=>b.bookQuoteUsd-a.bookQuoteUsd);top.length=Math.min(top.length,250);
  topActive.sort((a,b)=>b.bookQuoteUsd-a.bookQuoteUsd);topActive.length=Math.min(topActive.length,250);
  const merged=[...new Map([...top,...topActive].map(x=>[x.pool,x])).values()];top.length=0;top.push(...merged);
  const poolInfos=await getMany(top.map(x=>x.pool));
  const vaultInfos=await getMany(top.map(x=>x.quoteVault));
  for(let i=0;i<top.length;i++){
    const row=top[i],pd=poolInfos[i]&&Buffer.from(poolInfos[i].data[0],'base64'),vd=vaultInfos[i]&&Buffer.from(vaultInfos[i].data[0],'base64');
    const meta=mintMeta.get(row.quoteMint); if(!pd||pd.length!==424||!vd||vd.length<72){row.controlVerified=false;continue}
    const [maxMint,minMint]=sortMints(new PublicKey(row.baseMint),new PublicKey(row.quoteMint));
    const [poolPda]=PublicKey.findProgramAddressSync([Buffer.from('pool'),new PublicKey(row.config).toBuffer(),maxMint.toBuffer(),minMint.toBuffer()],PROGRAM);
    const [quotePda]=PublicKey.findProgramAddressSync([Buffer.from('token_vault'),new PublicKey(row.quoteMint).toBuffer(),new PublicKey(row.pool).toBuffer()],PROGRAM);
    row.creatorQuoteFee=pd.readBigUInt64LE(360).toString();
    row.liveQuoteVaultRaw=vd.readBigUInt64LE(64).toString();
    row.liveQuoteVaultUsd=Number(row.liveQuoteVaultRaw)/10**meta.decimals*meta.price;
    row.symbol=meta.symbol;row.decimals=meta.decimals;row.usdPrice=meta.price;row.priceTimestamp=meta.priceTimestamp;
    row.poolPdaMatches=poolPda.toBase58()===row.pool;row.quoteVaultPdaMatches=quotePda.toBase58()===row.quoteVault;
    row.quoteVaultMint=new PublicKey(vd.subarray(0,32)).toBase58();row.quoteVaultAuthority=new PublicKey(vd.subarray(32,64)).toBase58();
    row.controlVerified=poolInfos[i].owner===PROGRAM.toBase58()&&POOL_TYPES.some(t=>pd.subarray(0,8).toString('hex')===t.hex)&&row.poolPdaMatches&&row.quoteVaultPdaMatches&&row.quoteVaultMint===row.quoteMint&&row.quoteVaultAuthority===POOL_AUTHORITY.toBase58();
  }
  top.sort((a,b)=>(b.liveQuoteVaultUsd??-1)-(a.liveQuoteVaultUsd??-1));
  const aggregate=[...quoteConfigCounts.entries()].map(([mint,configCount])=>{const meta=mintMeta.get(mint),raw=pricedBookRawByMint.get(mint)||0n;return{mint,configCount,decimals:meta?.decimals??null,symbol:meta?.symbol??null,usdPrice:meta?.price??null,pricedBookQuoteRawExcludingCreatorFee:raw.toString(),pricedBookQuoteUsd:meta?.price!=null?Number(raw)/10**meta.decimals*meta.price:null}}).sort((a,b)=>(b.pricedBookQuoteUsd??-1)-(a.pricedBookQuoteUsd??-1));
  const endSlot=await rpc('getSlot',[{commitment:'confirmed'}]);
  const out={timestamp:new Date().toISOString(),program:PROGRAM.toBase58(),poolAuthority:POOL_AUTHORITY.toBase58(),observationSlots:{start:startSlot,end:endSlot},configScan,poolCounts,totalPools:Object.values(poolCounts).reduce((n,x)=>n+x.count,0),distinctQuoteMints:quoteMints.length,unknownConfigPools,pricedPools,unpricedPools,topQuoteMintsByConfigCount:[...quoteConfigCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([mint,count])=>({mint,count,...mintMeta.get(mint)})),aggregatePricedBookQuoteByMint:aggregate.slice(0,100),topLiveQuoteVaults:top.slice(0,100),limitations:['Quote-side ranking only: base-token vault value is excluded because most newly created base mints lack reliable prices.','USD ranking includes only quote mints priced by the referenced current price feed; unpriced pools remain counted but not USD-ranked.','Candidate set is the union of the 250 largest priced virtual-book pools and the 250 largest priced unmigrated pools; every returned actual vault is live-fetched and PDA/control verified, but this is not an all-1.79M-vault balance sort.','Pool-wide book aggregates exclude creator_quote_fee because it is stored outside the compact census slice; each leading live vault fetch includes the full actual token balance and the full pool creator fee field.','Accounts changed across the stated slot interval; this is a live census, not an atomic ledger snapshot.']};
  const path='/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dbc-custody.json';fs.writeFileSync(path,JSON.stringify(out,null,2));
  console.log(JSON.stringify({path,observationSlots:out.observationSlots,configAccounts:configScan.count,totalPools:out.totalPools,distinctQuoteMints:out.distinctQuoteMints,pricedPools,unpricedPools,top:out.topLiveQuoteVaults.slice(0,10).map(x=>({pool:x.pool,symbol:x.symbol,liveQuoteVaultUsd:x.liveQuoteVaultUsd,controlVerified:x.controlVerified}))}));
}
main().catch(e=>{console.error(e);process.exit(1)});
