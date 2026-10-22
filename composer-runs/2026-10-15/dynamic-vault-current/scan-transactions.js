const { Connection, PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const crypto = require('crypto');
const fs = require('fs');
const {IDL}=require('./package/dist/cjs/src/vault/idl.js');
const conn=new Connection(process.env.RPC_URL,'confirmed');
const pid='24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi';
const target=process.argv[2]||'FERjPVNEa7Udq8CEv68h6tPL46Tq7ieE49HrE2wea3XT';
const names=new Map(IDL.instructions.map(x=>[crypto.createHash('sha256').update('global:'+x.name.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())).digest().subarray(0,8).toString('hex'),x.name]));
(async()=>{
  const sigs=await conn.getSignaturesForAddress(new PublicKey(target),{limit:Number(process.argv[3]||100)});
  const results=[];
  for(let k=0;k<sigs.length;k+=20){
    const batch=sigs.slice(k,k+20);
    const txs=await conn.getParsedTransactions(batch.map(x=>x.signature),{maxSupportedTransactionVersion:1,commitment:'confirmed'});
    for(let j=0;j<txs.length;j++){
      const tx=txs[j],s=batch[j];if(!tx)continue;
      const ixs=[...tx.transaction.message.instructions];
      const outerCount=ixs.length;
      for(const group of tx.meta?.innerInstructions||[]) ixs.push(...group.instructions);
      const our=[];
      for(const [ixIndex,ix] of ixs.entries()){
        if(ix.programId.toBase58()!==pid)continue;
        const raw=bs58.decode(ix.data);
        our.push({ixIndex,source:ixIndex<outerCount?'outer':'inner',name:names.get(Buffer.from(raw).subarray(0,8).toString('hex'))||'unknown',data:ix.data,accounts:ix.accounts.map(x=>x.toBase58())});
      }
      if(our.length)results.push({signature:s.signature,slot:s.slot,blockTime:s.blockTime,err:s.err,our,logTail:tx.meta?.logMessages?.filter(x=>x.includes(pid)||x.includes('Instruction:')).slice(-10)});
    }
  }
  fs.writeFileSync(__dirname+'/transactions-'+target.slice(0,8)+'.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify({searched:sigs.length,withOurInstructions:results.length,instructionCounts:results.flatMap(x=>x.our).reduce((m,i)=>(m[i.source+':'+i.name]=(m[i.source+':'+i.name]||0)+1,m),{}),directControls:results.filter(x=>x.our.some(i=>i.source==='outer'&&!x.err)).slice(0,15).map(x=>({signature:x.signature,slot:x.slot,names:x.our.map(i=>i.source+':'+i.name)}))},null,2));
})().catch(e=>{console.error(String(e));process.exitCode=1});
