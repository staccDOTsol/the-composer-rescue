#!/usr/bin/env node
// Find mature, still-pending withdrawal requests by bounded historical RPC reads.
const fs=require('fs'),path=require('path');
const bs58=require(path.join(__dirname,'kliquidity-sdk-official/node_modules/bs58'));
const DIR=__dirname,PROGRAM='EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
let seq=0;
async function rpc(method,params){let last;for(let i=0;i<5;i++){try{
  const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});
  if(r.status===429||r.status>=500)throw new Error(`HTTP ${r.status}`);
  const j=await r.json();if(j.error)throw new Error(JSON.stringify(j.error));return j.result;
}catch(e){last=e;if(i<4)await new Promise(ok=>setTimeout(ok,400*2**i));}}throw last;}
async function batchTx(sigs){
  const calls=sigs.map(s=>({jsonrpc:'2.0',id:++seq,method:'getTransaction',params:[s.signature,
    {encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]}));
  let last;for(let attempt=0;attempt<5;attempt++){try{
    const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(calls)});
    if(r.status===429||r.status>=500)throw new Error(`HTTP ${r.status}`);
    const arr=await r.json();if(!Array.isArray(arr))throw new Error(`Batch response: ${JSON.stringify(arr).slice(0,200)}`);
    const m=new Map(arr.map(x=>[x.id,x]));return calls.map(c=>{const x=m.get(c.id);return x?.result||null;});
  }catch(e){last=e;if(attempt<4)await new Promise(ok=>setTimeout(ok,500*2**attempt));}}
  throw last;
}
async function main(){
  let before, sigs=[];const maxDays=14;
  for(let page=0;page<8;page++){
    const opts={limit:1000,commitment:'confirmed'};if(before)opts.before=before;
    const chunk=await rpc('getSignaturesForAddress',[PROGRAM,opts]);
    if(!chunk.length)break;sigs.push(...chunk);before=chunk.at(-1).signature;
    const latest=sigs[0].blockTime,oldest=sigs.at(-1).blockTime;
    process.stdout.write(`signature page ${page+1}: ${sigs.length}, age ${((latest-oldest)/86400).toFixed(1)} days\n`);
    if(oldest<latest-maxDays*86400)break;
  }
  fs.writeFileSync(path.join(DIR,'paths-grass-signature-index.json'),JSON.stringify(sigs)+'\n');
  const latest=sigs[0].blockTime;
  const targets=sigs.filter(s=>!s.err&&s.blockTime<latest-604800&&s.blockTime>latest-maxDays*86400);
  const unstake=[];let inspected=0, txErrors=0;
  for(let i=0;i<targets.length;i+=40){
    const chunk=targets.slice(i,i+40), txs=await batchTx(chunk);
    for(let k=0;k<txs.length;k++){
      const tx=txs[k],s=chunk[k];if(!tx){txErrors++;continue;}inspected++;
      const msg=tx.transaction.message;
      const keys=[...msg.accountKeys,...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])];
      for(const [index,ix] of msg.instructions.entries()){
        if(keys[ix.programIdIndex]!==PROGRAM)continue;
        const data=Buffer.from(bs58.decode(ix.data));
        if(data.subarray(0,8).toString('hex')!=='3a77d78fcbdf2056')continue;
        unstake.push({signature:s.signature,slot:tx.slot,blockTime:s.blockTime,
          amountRaw:data.subarray(8).readBigUInt64LE(0).toString(),
          pool:keys[ix.accounts[0]],userStakeInfo:keys[ix.accounts[4]],signer:keys[ix.accounts[6]],
          accounts:ix.accounts.map(n=>keys[n])});
      }
    }
    if(i%400===0)process.stdout.write(`tx inspected ${inspected}/${targets.length}; unstakes ${unstake.length}\n`);
  }
  const keys=[...new Set(unstake.map(x=>x.userStakeInfo))],state=new Map();
  for(let i=0;i<keys.length;i+=100){const group=keys.slice(i,i+100),res=await rpc('getMultipleAccounts',
    [group,{encoding:'base64',commitment:'confirmed'}]);for(let j=0;j<group.length;j++){
      const a=res.value[j];state.set(group[j],a?{slot:res.context.slot,owner:a.owner,data:Buffer.from(a.data[0],'base64')}:null);
    }}
  const candidates=[];
  for(const u of unstake){const st=state.get(u.userStakeInfo);if(!st||st.owner!==PROGRAM||st.data.length!==2584)continue;
    const b=st.data;for(let i=0;i<20;i++){const o=8+i*64,pool=bs58.encode(b.subarray(o,o+32)),amount=b.readBigUInt64LE(o+32),
      timestamp=b.readBigUInt64LE(o+40),unlock=b.readBigUInt64LE(o+48);
      if(pool===u.pool&&amount>0n&&unlock<=BigInt(latest)){
        candidates.push({sourceSignature:u.signature,sourceSlot:u.slot,sourceBlockTime:u.blockTime,
          pool:u.pool,userStakeInfo:u.userStakeInfo,signer:u.signer,withdrawIndex:i,
          amountRaw:amount.toString(),requestTimestamp:timestamp.toString(),unlockTimestamp:unlock.toString(),
          stateReadSlot:st.slot});break;
      }
    }
  }
  const result={program:PROGRAM,latestReferenceTime:latest,totalSignatures:sigs.length,
    targetSignatures:targets.length,txInspected:inspected,txErrors,unstakeCount:unstake.length,
    uniqueUserStates:keys.length,candidates};
  fs.writeFileSync(path.join(DIR,'paths-grass-pending.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
