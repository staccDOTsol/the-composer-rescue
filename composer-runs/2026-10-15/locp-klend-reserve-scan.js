#!/usr/bin/env node
// Read-only KLend reserve discovery for the principal Lockup mints.
const fs=require('fs'),path=require('path');
const {Connection,PublicKey}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const idl=JSON.parse(fs.readFileSync(path.join(__dirname,'marginfi-source/idls-complete/kamino_lending.json')));
const coder=new anchor.BorshAccountsCoder(idl);
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(Boolean).map(s=>s.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
const program='KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const mints={YZY:'DrZ26cKJDksVRWib3DVVsjo9eeXccc7hKhDJviiYEEZY',
 DBR:'DBRiDgJAMsM95moTzJs7M9LnkGErpbv9v6CUR1DXnUu5',
 JUP:'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
 WET:'WETZjtprkDMCcUxPi9PfWnowMRZkiGGHDb9rABuRZ2U',
 CMNS:'AMUgSjmdFsS8Y3JeL32u7A45Fpt8YF9xKaiwW5uGHdXk',
 USDC:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'};
let rpcId=0;
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});const j=await r.json();
 if(j.error)throw Error(`${method}: ${j.error.code} ${j.error.message}`);return j.result;}
function norm(v){if(v==null||typeof v!=='object')return v;if(v instanceof PublicKey)return v.toBase58();
 if(v.constructor?.name==='BN')return v.toString();if(Array.isArray(v))return v.map(norm);
 return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,norm(x)]));}
async function main(){
 const rows=[];
 for(const [symbol,mint] of Object.entries(mints)){
  try{
   const result=await rpc('getProgramAccounts',[program,{encoding:'base64',commitment:'confirmed',
     withContext:true,filters:[{dataSize:8624},{memcmp:{offset:128,bytes:mint}}]}]);
   const matched=[];
   for(const row of result.value){const data=Buffer.from(row.account.data[0],'base64');
    const d=norm(coder.decode('Reserve',data));
    const vault=await rpc('getAccountInfo',[d.liquidity.supply_vault,{encoding:'base64',commitment:'confirmed'}]);
    const supply=vault.value?Buffer.from(vault.value.data[0],'base64').readBigUInt64LE(64).toString():null;
    matched.push({reserve:row.pubkey,lendingMarket:d.lending_market,liveMint:d.liquidity.mint_pubkey,
      mintMatches:d.liquidity.mint_pubkey===mint,flashLoanFeeSf:d.config.fees.flash_loan_fee_sf,
      availableRaw:d.liquidity.total_available_amount,supplyVault:d.liquidity.supply_vault,
      supplyRaw:supply,feeVault:d.liquidity.fee_vault,lastUpdate:d.last_update});}
   rows.push({symbol,mint,slot:result.context.slot,count:matched.length,reserves:matched});
   console.log(JSON.stringify({symbol,count:matched.length,reserves:matched.map(x=>
     ({reserve:x.reserve,fee:x.flashLoanFeeSf,available:x.availableRaw,supply:x.supplyRaw}))}));
  }catch(e){rows.push({symbol,mint,error:e.message});console.log(JSON.stringify({symbol,error:e.message}));}
 }
 const out={generatedAt:new Date().toISOString(),programId:program,mintFieldOffset:128,
  reserveDataSize:8624,noTransactionsSubmitted:true,rows};
 fs.writeFileSync(path.join(__dirname,'locp-klend-reserve-candidates.json'),JSON.stringify(out,null,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
