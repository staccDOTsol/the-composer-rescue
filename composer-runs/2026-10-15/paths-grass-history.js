#!/usr/bin/env node
// Bounded, read-only instruction surface sampling for the live GRASS program.
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const bs58=require(path.join(__dirname,'kliquidity-sdk-official/node_modules/bs58'));
const DIR=__dirname, PROGRAM='EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const names=['initialize_reward_pool','initialize_global_config','initialize_staking_pool',
  'staking_pool_change_router','adjust_global_config','fund_reward_pool','stake_tokens',
  'unstake_tokens','claim_rewards','withdraw','lock_reward_pool','lock_staking_pool',
  'drain_reward_pool','drain_staking_pool'];
const byDisc=Object.fromEntries(names.map(n=>[crypto.createHash('sha256').update('global:'+n).digest('hex').slice(0,16),n]));
let seq=0;
async function rpc(method,params){let last;for(let i=0;i<5;i++){try{
  const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});
  if(r.status===429||r.status>=500)throw new Error(`HTTP ${r.status}`);
  const b=await r.json();if(b.error)throw new Error(JSON.stringify(b.error));return b.result;
}catch(e){last=e;if(i<4)await new Promise(ok=>setTimeout(ok,300*2**i));}}throw last;}
async function main(){
  const sigs=await rpc('getSignaturesForAddress',[PROGRAM,{limit:200,commitment:'confirmed'}]);
  const result={program:PROGRAM,observationTime:new Date().toISOString(),sampleLimit:200,
    returned:sigs.length, signaturesInspected:0, byInstruction:{}, samples:[], errors:[]};
  for(let offset=0;offset<sigs.length;offset+=8){
    const batch=sigs.slice(offset,offset+8);
    const txs=await Promise.allSettled(batch.map(s=>rpc('getTransaction',[s.signature,
      {encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}])));
    for(let k=0;k<batch.length;k++){
      const s=batch[k], rr=txs[k];if(rr.status==='rejected'){result.errors.push({signature:s.signature,error:String(rr.reason)});continue;}
      const tx=rr.value;if(!tx)continue;result.signaturesInspected++;
      const keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable||[]),
        ...(tx.meta.loadedAddresses?.readonly||[])];
      for(const [index,ix] of tx.transaction.message.instructions.entries()){
        if(keys[ix.programIdIndex]!==PROGRAM)continue;
        const hex=Buffer.from(bs58.decode(ix.data)).toString('hex');
        const name=byDisc[hex.slice(0,16)]||'UNKNOWN_'+hex.slice(0,16);
        result.byInstruction[name]=(result.byInstruction[name]||0)+1;
        if(result.samples.filter(x=>x.name===name).length>=5)continue;
        result.samples.push({name,signature:s.signature,slot:tx.slot,error:tx.meta.err,
          instructionIndex:index,dataHex:hex,accounts:ix.accounts.map((n,j)=>({position:j,key:keys[n],
            signer:n<tx.transaction.message.header.numRequiredSignatures,
            writable:n<tx.transaction.message.header.numRequiredSignatures-tx.transaction.message.header.numReadonlySignedAccounts||
              n>=tx.transaction.message.header.numRequiredSignatures&&
              n<tx.transaction.message.accountKeys.length-tx.transaction.message.header.numReadonlyUnsignedAccounts||
              n>=tx.transaction.message.accountKeys.length&&
              n<tx.transaction.message.accountKeys.length+(tx.meta.loadedAddresses?.writable||[]).length})),
          logs:tx.meta.logMessages?.filter(x=>x.includes('Instruction:')||x.includes('Error')),
          inner:(tx.meta.innerInstructions||[]).find(x=>x.index===index)?.instructions.map(x=>({
            program:keys[x.programIdIndex],dataHex:x.data?Buffer.from(bs58.decode(x.data)).toString('hex'):null,
            accounts:x.accounts?.map(n=>keys[n]),stackHeight:x.stackHeight}))});
      }
    }
  }
  fs.writeFileSync(path.join(DIR,'paths-grass-history.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify({inspected:result.signaturesInspected,byInstruction:result.byInstruction,
    errors:result.errors.length,samples:result.samples.map(x=>({name:x.name,signature:x.signature,slot:x.slot,
      error:x.error,dataHex:x.dataHex}))},null,2)+'\n');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
