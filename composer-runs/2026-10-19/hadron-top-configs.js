#!/usr/bin/env node
// Read-only SDK inspection of live high-USDC pools.
const fs=require('fs');const path=require('path');
const {Connection,PublicKey}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {Hadron}=require('./hadron-sdk/package/dist/index.js');
const c=require('./hadron-current-census.json');
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
const rpc=row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const conn=new Connection(rpc,'confirmed');
const pools=c.pools.filter(p=>p.state===1&&BigInt(p.usdcRaw)>1000000000n).sort((a,b)=>BigInt(a.usdcRaw)>BigInt(b.usdcRaw)?-1:1);
async function main(){
  if(await conn.getGenesisHash()!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('wrong cluster');
  const rows=[];
  for(const p of pools){
    try{
      const h=await Hadron.load(conn,new PublicKey(p.id));
      const risk=h.getInventoryRiskFactors(BigInt(p.balances.x.raw),BigInt(p.balances.y.raw));
      rows.push({pool:p.id,mintX:p.mintX,mintY:p.mintY,usdcRaw:p.usdcRaw,state:h.config.state,
        configAuthority:h.config.authority.toBase58(),depositAuthority:h.config.depositAuthority.toBase58(),
        withdrawAuthority:h.config.withdrawAuthority.toBase58(),oracleMode:h.config.oracleMode,
        oracleAuthority:h.oracle.authority.toBase58(),lastOracleUpdateSlot:h.oracle.lastUpdateSlot.toString(),
        midpriceRaw:h.getMidprice(),spreadBps:h.getSpreadBps(),fee:h.resolveFee(),risk,
        activeCurveSlots:h.getActiveCurveSlots()});
      console.log(JSON.stringify({pool:p.id,usdc:Number(p.usdcRaw)/1e6,midpriceRaw:h.getMidprice(),spreadBps:h.getSpreadBps(),oracleSlot:h.oracle.lastUpdateSlot.toString()}));
    }catch(e){rows.push({pool:p.id,error:e.message});console.log(JSON.stringify({pool:p.id,error:e.message}));}
  }
  fs.writeFileSync(path.join(__dirname,'hadron-top-configs.json'),JSON.stringify({observedAtUtc:new Date().toISOString(),network:'mainnet-beta',noTransactions:true,rows},(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
