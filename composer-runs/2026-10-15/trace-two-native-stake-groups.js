#!/usr/bin/env node
// Read-only transaction provenance for the two live residual native Stake authorities.
const fs=require('fs');
const path=require('path');
const URL=process.env.HEAVY_RPC_URL||process.env.RPC_URL;
if(!URL) throw Error('Set HEAVY_RPC_URL or RPC_URL');
const live=JSON.parse(fs.readFileSync(path.join(__dirname,'two-native-stake-groups-live-recheck.json')));
const out=path.join(__dirname,'two-native-stake-groups-provenance.json');
const STAKE='Stake11111111111111111111111111111111111111';
const V4='SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const V3='SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu';
async function rpc(method,params){
  let err;
  for(let n=0;n<4;n++) try {
    const response=await fetch(URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const body=await response.json();
    if(!response.ok||body.error)throw Error(JSON.stringify(body.error||{status:response.status}));
    return body.result;
  } catch(e){err=e;await new Promise(r=>setTimeout(r,500*2**n));}
  throw err;
}
const info=ix=>ix?.parsed?.info||{};
function summarize(tx,signature,source,authority){
  const outer=tx.transaction.message.instructions||[];
  const keys=tx.transaction.message.accountKeys||[];
  const programs=[...new Set([...outer.map(x=>x.programId),...(tx.meta.innerInstructions||[]).flatMap(g=>g.instructions.map(x=>x.programId))])];
  const stake=[];
  for(let i=0;i<outer.length;i++)if(outer[i].programId===STAKE)stake.push({via:'direct',outerProgramId:STAKE,type:outer[i].parsed?.type||null,info:info(outer[i])});
  for(const g of tx.meta.innerInstructions||[])for(const ix of g.instructions)if(ix.programId===STAKE)stake.push({via:'cpi',outerProgramId:outer[g.index]?.programId||null,type:ix.parsed?.type||null,info:info(ix)});
  return {signature,slot:tx.slot,blockTime:tx.blockTime,source,success:!tx.meta.err,feePayer:keys[0]?.pubkey||null,
    authoritySigner:keys.find(x=>x.pubkey===authority)?.signer||false,
    programs,stake,
    outer:outer.map(x=>({programId:x.programId,type:x.parsed?.type||null,info:x.parsed?.info||null,accounts:x.accounts||null,data:x.data||null})),
    logs:(tx.meta.logMessages||[]).filter(x=>/Instruction:|Program log:|Program data:/.test(x)).slice(0,30)};
}
(async()=>{
 const groups=[];
 for(const group of live.groups){
  const addresses=[group.authority,...group.accounts.slice(0,3).map(x=>x.address)];
  const signatures=new Map();
  for(const address of addresses){
    const sigs=await rpc('getSignaturesForAddress',[address,{limit:address===group.authority?100:25,commitment:'finalized'}]);
    for(const x of sigs){const row=signatures.get(x.signature)||{...x,sources:[]};row.sources.push(address);signatures.set(x.signature,row);}
  }
  const chosen=[...signatures.values()].sort((a,b)=>b.slot-a.slot).slice(0,120);
  const transactions=[];
  for(let offset=0;offset<chosen.length;offset+=10){
    const batch=chosen.slice(offset,offset+10);
    const rows=await Promise.all(batch.map(x=>rpc('getTransaction',[x.signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:1}]).catch(e=>({error:e.message}))));
    for(let i=0;i<rows.length;i++)if(rows[i]&&!rows[i].error)transactions.push(summarize(rows[i],batch[i].signature,batch[i].sources,group.authority));
  }
  const candidate=new Map();for(const tx of transactions)for(const pid of tx.programs)candidate.set(pid,(candidate.get(pid)||0)+1);
  groups.push({authority:group.authority,addressesSampled:addresses,signatureCount:chosen.length,transactionsFetched:transactions.length,
    topPrograms:[...candidate].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([programId,count])=>({programId,count})),
    stakeInstructionSummary:transactions.flatMap(tx=>tx.stake.map(x=>({signature:tx.signature,slot:tx.slot,blockTime:tx.blockTime,feePayer:tx.feePayer,...x}))).slice(0,80),
    directStakeCpisByAuthority:transactions.flatMap(tx=>tx.stake.filter(x=>x.via==='cpi'&&JSON.stringify(x.info).includes(group.authority)).map(x=>({signature:tx.signature,slot:tx.slot,...x}))),
    squadsProgramTransactions:transactions.filter(tx=>tx.programs.includes(V4)||tx.programs.includes(V3)).map(tx=>({signature:tx.signature,slot:tx.slot,programs:tx.programs})),
    authoritySignerTransactions:transactions.filter(x=>x.authoritySigner).map(x=>({signature:x.signature,slot:x.slot,programs:x.programs})),
    transactions,
  });
  fs.writeFileSync(out,JSON.stringify({generatedAt:new Date().toISOString(),method:'read-only getSignaturesForAddress/getTransaction',groups},null,2)+'\n');
  console.log(JSON.stringify({authority:group.authority,signatureCount:chosen.length,transactionsFetched:transactions.length,stakeInstructions:groups.at(-1).stakeInstructionSummary.length,directStakeCpis:groups.at(-1).directStakeCpisByAuthority.length,squadsTransactions:groups.at(-1).squadsProgramTransactions.length,authoritySignerTransactions:groups.at(-1).authoritySignerTransactions.length,topPrograms:groups.at(-1).topPrograms.slice(0,6)}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
