#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const {PublicKey}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const URL=process.env.HEAVY_RPC_URL||process.env.RPC_URL;
if(!URL)throw Error('Set HEAVY_RPC_URL or RPC_URL');
const DIR=__dirname;
const live=JSON.parse(fs.readFileSync(path.join(DIR,'two-native-stake-groups-live-recheck.json')));
const history=JSON.parse(fs.readFileSync(path.join(DIR,'two-native-stake-groups-provenance.json')));
const PID='SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const links=[
  {authority:'FE1zyw2MBBKumtnuBxuAeXGn4Zeh5CdHqWkzPCUN29Nm',multisig:'8M6Sgtn8QksPoBaNuoCmH3guhrYTaRRhVxvtZbgNmUKW',index:1},
  {authority:'9j7f4Y6MqauTRm9RRJwzQeMkqZ8GS3FsXF7hs4nD6ugA',multisig:'7QCouqAACjz2LEynoSph8GzZ6yy5jYEnvvJGSDLGyLYw',index:0},
];
async function rpc(method,params){const response=await fetch(URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const body=await response.json();if(!response.ok||body.error)throw Error(JSON.stringify(body.error||{status:response.status}));return body.result;}
(async()=>{
 const accounts=await rpc('getMultipleAccounts',[links.map(x=>x.multisig).concat(PID),{commitment:'finalized',encoding:'base64'}]);
 const proof=[];
 for(let i=0;i<links.length;i++){
  const link=links[i], [pda,bump]=PublicKey.findProgramAddressSync([Buffer.from('multisig'),new PublicKey(link.multisig).toBuffer(),Buffer.from('vault'),Buffer.from([link.index])],new PublicKey(PID));
  const g=live.groups.find(x=>x.authority===link.authority),h=history.groups.find(x=>x.authority===link.authority);
  const matchingCpis=h.transactions.flatMap(tx=>tx.stake.filter(x=>x.via==='cpi'&&x.outerProgramId===PID&&JSON.stringify(x.info).includes(link.authority)).map(x=>({signature:tx.signature,slot:tx.slot,blockTime:tx.blockTime,type:x.type,stakeAccount:x.info.stakeAccount||null})));
  const m=accounts.value[i];
  proof.push({authority:link.authority,multisig:link.multisig,vaultIndex:link.index,pdaBump:bump,pdaDerived:pda.toBase58(),derivationMatches:pda.toBase58()===link.authority,multisigAccount:{owner:m?.owner||null,executable:m?.executable||false,dataBytes:m?.data?Buffer.from(m.data[0],'base64').length:null},
   liveStakeCount:g.accounts.length,liveLamports:g.private.lamports,liveStakers:g.private.stakers,
   historicalSquadsStakeCpis:matchingCpis});
 }
 const p=accounts.value[links.length];
 const output={generatedAt:new Date().toISOString(),squadsProgram:PID,squadsProgramAccount:{owner:p?.owner||null,executable:p?.executable||false},proof};
 fs.writeFileSync(path.join(DIR,'two-native-stake-groups-squads-proof.json'),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify(output));
})().catch(e=>{console.error(e.message);process.exitCode=1});
