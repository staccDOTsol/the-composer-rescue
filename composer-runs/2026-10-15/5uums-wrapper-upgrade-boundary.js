#!/usr/bin/env node
'use strict';
// Read-only current-state simulation of upgradeable-loader SetAuthority CPI.
// This never submits a transaction; it saves only compact post-state metadata.
const fs=require('fs'),path=require('path');
const {PublicKey,Transaction,TransactionInstruction}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const DIR=__dirname,WRAPPER='3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu',LOADER='BPFLoaderUpgradeab1e11111111111111111111111',PDA='5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi',A='FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N',B='5XXejrbDVQifMfE4xbcFmBxSVndS1FYhmvoGFc78TMJp',C='12eeLK7yJXpm7x7PUQVgReEeECm4Y4fNhzQhwbBMTXKn';
const TARGETS=[{name:'bridge_program',program:'5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9',programData:'58cPagxAqtJzSnxi1yCWr9UVugj4jo25UX8eA5ctc1xY'},{name:'wrapper_program',program:WRAPPER,programData:'CyXQ9V7xyAaXZSQXuqHHYgaRML6peJWtne5F2Cyav8D1'}];
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
let n=0;async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++n,method,params})});if(!r.ok)throw Error(`${method} HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error(`${method} ${JSON.stringify(j.error)}`);return j.result;}
const pubkey=b=>new PublicKey(b).toBase58();
function parseProgramData(info){if(!info)return null;const b=Buffer.from(info.data[0],'base64');return{owner:info.owner,length:b.length,tag:b.readUInt32LE(0),upgradeSlot:Number(b.readBigUInt64LE(4)),upgradeAuthority:b[12]===1?pubkey(b.subarray(13,45)):null};}
async function currentState(){const r=await rpc('getMultipleAccounts',[TARGETS.map(x=>x.programData),{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:45}}]);return{slot:r.context.slot,targets:TARGETS.map((x,i)=>({...x,...parseProgramData(r.value[i])}))};}
async function main(){
  const [blockhash,before]=await Promise.all([rpc('getLatestBlockhash',[{commitment:'confirmed'}]),currentState()]);
  const setAuthority=Buffer.from([4,0,0,0]); // bincode UpgradeableLoaderInstruction::SetAuthority
  const data=Buffer.concat([new PublicKey(LOADER).toBuffer(),Buffer.from([4,0,0,0]),setAuthority]);
  const variants=[
    {label:'reference_A_B',signerSlots:[A,B,C],signers:new Set([A,B])},
    {label:'only_A_distinct_slots',signerSlots:[A,B,C],signers:new Set([A])},
    {label:'one_A_aliased_twice',signerSlots:[A,A,C],signers:new Set([A])},
    {label:'one_B_aliased_twice',signerSlots:[B,B,C],signers:new Set([B]),payer:B},
  ];
  const results=[];
  for(const target of TARGETS){
    for(const v of variants){
      const keys=v.signerSlots.map(x=>({pubkey:new PublicKey(x),isSigner:v.signers.has(x),isWritable:false}));
      keys.push({pubkey:new PublicKey(LOADER),isSigner:false,isWritable:false});
      keys.push({pubkey:new PublicKey(target.programData),isSigner:false,isWritable:true});
      keys.push({pubkey:new PublicKey(PDA),isSigner:false,isWritable:false});
      keys.push({pubkey:new PublicKey(A),isSigner:v.signers.has(A),isWritable:false});
      const tx=new Transaction({feePayer:new PublicKey(v.payer||A),recentBlockhash:blockhash.value.blockhash}).add(new TransactionInstruction({programId:new PublicKey(WRAPPER),keys,data}));
      const msg=tx.compileMessage();
      const b64=tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
      const sim=await rpc('simulateTransaction',[b64,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',innerInstructions:true,accounts:{encoding:'base64',addresses:[target.programData]}}]);
      results.push({target:target.name,label:v.label,signerSlots:v.signerSlots,requiredSigners:msg.accountKeys.slice(0,msg.header.numRequiredSignatures).map(x=>x.toBase58()),compiledAccountIndices:msg.instructions[0].accounts,err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,logs:sim.value.logs,innerInstructions:sim.value.innerInstructions,simulatedPostProgramData:parseProgramData(sim.value.accounts?.[0])});
    }
  }
  const after=await currentState();
  const out={at:new Date().toISOString(),wrapperProgram:WRAPPER,loaderProgram:LOADER,loaderInstruction:'SetAuthority (bincode variant 4)',loaderInstructionHex:setAuthority.toString('hex'),wrapperDataHex:data.toString('hex'),before,after,noChainUpgradeAuthorityChange:before.targets.every((x,i)=>x.upgradeAuthority===after.targets[i].upgradeAuthority),results};
  fs.writeFileSync(path.join(DIR,'5uums-wrapper-upgrade-boundary.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({...out,results:results.map(x=>({target:x.target,label:x.label,requiredSigners:x.requiredSigners,compiledAccountIndices:x.compiledAccountIndices,err:x.err,unitsConsumed:x.unitsConsumed,postAuthority:x.simulatedPostProgramData?.upgradeAuthority,logs:x.logs?.filter(y=>y.includes('invoke')||y.includes('failed')||y.includes('error'))}))},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
