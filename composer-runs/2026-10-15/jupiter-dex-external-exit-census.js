#!/usr/bin/env node
// Read-only route census. Excludes every Jupiter Lend AMM route; no tx send.
const fs=require('fs');
const root=__dirname;
const rows=JSON.parse(fs.readFileSync(`${root}/jupiter-dex-path-liquidity.json`)).rows;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function quote(mint,decimals,outMint,amount){
  const url=new URL('https://api.jup.ag/swap/v1/quote');
  for(const [k,v] of Object.entries({inputMint:mint,outputMint:outMint,
    amount:String(amount),slippageBps:'100',excludeDexes:'JupLend AMM'}))url.searchParams.set(k,v);
  for(let attempt=0;attempt<4;attempt++){
    const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
    const obj=await res.json().catch(()=>({}));
    if(res.status===429){await sleep(1000*(attempt+1));continue;}
    return {status:res.status,error:obj.error||obj.message||null,
      inRaw:String(amount),outRaw:obj.outAmount||null,
      routes:obj.routePlan?.map(x=>({label:x.swapInfo?.label,
        ammKey:x.swapInfo?.ammKey,inMint:x.swapInfo?.inputMint,
        outMint:x.swapInfo?.outputMint,feeRaw:x.swapInfo?.feeAmount}))||[]};
  }
  return {status:429,error:'rate limited',inRaw:String(amount),outRaw:null,routes:[]};
}
async function rpc(method,params){const r=await fetch('http://127.0.0.1:9097',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;}
async function main(){
  const usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const out=[];
  for(const p of rows){
    const mint=p.mints[0]===usdc?p.mints[1]:p.mints[0];
    const acct=(await rpc('getAccountInfo',[mint,{encoding:'base64'}])).value;
    const decimals=Buffer.from(acct.data[0],'base64')[44];
    const unit=10n**BigInt(decimals);
    const one=await quote(mint,decimals,usdc,unit);await sleep(750);
    const thousand=one.outRaw?await quote(mint,decimals,usdc,unit*1000n):null;
    out.push({vaultId:p.vaultId,mint,decimals,pegKind:p.pegKind,
      dexSupply0Raw:p.dexSupply0Raw,dexSupply1Raw:p.dexSupply1Raw,
      borrowingPositions:p.borrowingPositions,one,thousand});
    console.log(JSON.stringify({vaultId:p.vaultId,mint,oneStatus:one.status,
      oneOut:one.outRaw,oneRoute:one.routes.map(x=>x.label),
      thousandStatus:thousand?.status,thousandOut:thousand?.outRaw,
      thousandRoute:thousand?.routes.map(x=>x.label)}));await sleep(750);
  }
  fs.writeFileSync(`${root}/jupiter-dex-external-exit-census.json`,JSON.stringify({
    generatedAt:new Date().toISOString(),scope:'public Jupiter quote API current route lookup; no transaction submission',
    excludedDexes:'JupLend AMM',out},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
