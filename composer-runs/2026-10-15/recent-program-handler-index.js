#!/usr/bin/env node
// Bounded read-only index of successful recent top-level program instructions.
const fs=require('fs');
const program=process.env.PROGRAM_ID;
if(!program)throw Error('PROGRAM_ID is required');
const limit=Math.min(1000,Math.max(1,Number(process.env.SAMPLE_LIMIT||100)));
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
 .split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const url=env.HEAVY_RPC_URL||env.RPC_URL;
let id=0;
async function rpc(method,params){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
 const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result;
}
async function main(){
 const sigs=await rpc('getSignaturesForAddress',[program,{limit,commitment:'confirmed'}]);
 const rows=[];
 for(let i=0;i<sigs.length;i+=10){
  const batch=await Promise.all(sigs.slice(i,i+10).map(async s=>{
   try{
    const tx=await rpc('getTransaction',[s.signature,
     {encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
    if(!tx)return {signature:s.signature,slot:s.slot,missing:true};
    const top=tx.transaction.message.instructions.filter(x=>x.programId===program);
    const names=tx.meta.logMessages?.filter(x=>x.startsWith('Program log: Instruction: '))
     .map(x=>x.slice('Program log: Instruction: '.length))||[];
    const signerKeys=tx.transaction.message.accountKeys.filter(x=>x.signer).map(x=>x.pubkey);
    const inner=(tx.meta.innerInstructions||[]).flatMap(x=>x.instructions)
     .filter(x=>x.programId==='Stake11111111111111111111111111111111111111' && x.parsed)
     .map(x=>({type:x.parsed.type,info:x.parsed.info}));
    return {signature:s.signature,slot:s.slot,err:s.err,signerKeys,
     top:top.map(x=>({data:x.data,accounts:x.accounts})),names,stakeInner:inner};
   }catch(e){return {signature:s.signature,slot:s.slot,error:String(e)};}
  }));
  rows.push(...batch);
 }
 const counts={};for(const r of rows)for(const n of r.names||[])counts[n]=(counts[n]||0)+1;
 const out={generatedAt:new Date().toISOString(),program,limit,returned:sigs.length,
  note:'Recent signatures of program, including CPI references; top-level instruction list is explicit. Not a whole-history or whole-program audit.',rows};
 const file=__dirname+'/recent-handler-index-'+program.slice(0,8)+'.json';
 fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({program,returned:sigs.length,topLevel:rows.filter(r=>r.top?.length).length,
  errors:rows.filter(r=>r.error).length,counts,file}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
