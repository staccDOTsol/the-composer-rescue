#!/usr/bin/env node
'use strict';
// Bounded, read-only current-mainnet gate for distinct major-pair route owners.
// Never imports wallet keys, signs, simulates, or sends a transaction.
const fs = require('fs');
const path = require('path');
const bs58 = require('../2026-10-15/jup6qf-sdk/node_modules/bs58');
const env = Object.fromEntries(fs.readFileSync('/private/tmp/codex-mainnet-rpc-2026-10-19.env','utf8')
  .split(/\r?\n/).filter(x=>x && !x.startsWith('#')).map(x=>x.replace(/^export\s+/, '')
    .split(/=(.*)/s).slice(0,2).map((v,i)=>i===1?v.replace(/^['\"]|['\"]$/g,''):v)));
const endpoint = env.SOLANA_RPC_URL || env.RPC || env.FLUX_RPC_A;
if (!endpoint) throw Error('RPC endpoint unavailable');
const GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const TOKEN_PROGRAMS=['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const targets=[
  {venue:'PancakeSwap',program:'HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq',
    pools:['22HUWiJaTNph96KQTKZVy2wg8KzfCems5nyW7E5H5J6w']},
  {venue:'Perena Numéraire',program:'NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P',
    pools:['2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ',
      '5M7McNWX7yBBGrZGB6XhmHYhFwWwwB2ckrA1HEpkf3SA']},
  {venue:'JupLend AMM',program:'jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd',
    pools:['FfEJYz4hLLFe4KyNyKYCjvfhMfbtpLH3CXpcPe8nhmfy',
      'AH9SPk4p2BJJA4WdgJsagpd1D4sAnwL2Tj2gUSM5rYqy']},
];
let rpcId=0;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function rpc(method,params=[]){
  for(let retry=0;retry<4;retry++){
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
    const body=await response.json();
    if(!response.ok || body.error){
      const e=body.error||{code:response.status,message:response.statusText};
      if(retry<3 && [429,-32005,-32429].includes(e.code)) {await wait(700*(retry+1));continue;}
      throw Error(`${method}: ${JSON.stringify(e)}`);
    }
    return body.result;
  }
}
function accountMetadata(key,v,slot){return {key,slot,exists:!!v,owner:v?.owner||null,
  executable:v?.executable||false,lamports:v?.lamports??null,
  dataLength:v?.data?.[0]?Buffer.from(v.data[0],'base64').length:null};}
function programId(ix){return typeof ix?.programId==='string'?ix.programId:null;}
function immediateParent(group,index){
  const stack={1:group.outerProgram};
  for(const call of group.calls){
    const h=call.stackHeight;
    if(h){stack[h]=call.program;for(const key of Object.keys(stack))if(Number(key)>h)delete stack[key];}
    if(call.index===index)return h?stack[h-1]||null:null;
  }
  return null;
}
async function programProof(key){
  const reply=await rpc('getAccountInfo',[key,{encoding:'base64',commitment:'confirmed'}]);
  const p=reply.value;const bytes=Buffer.from(p?.data?.[0]||'','base64');
  const proof={...accountMetadata(key,p,reply.context.slot),stateTag:bytes.length>=4?bytes.readUInt32LE(0):null};
  if(bytes.length!==36 || proof.stateTag!==2 || !proof.executable)return proof;
  const dataKey=bs58.encode(bytes.subarray(4,36));
  const dataReply=await rpc('getAccountInfo',[dataKey,{encoding:'base64',commitment:'confirmed',
    dataSlice:{offset:0,length:12}}]);
  const d=dataReply.value;const head=Buffer.from(d?.data?.[0]||'','base64');
  proof.programData={...accountMetadata(dataKey,d,dataReply.context.slot),
    stateTag:head.length>=4?head.readUInt32LE(0):null,
    lastDeploySlot:head.length>=12?Number(head.readBigUInt64LE(4)):null};
  return proof;
}
async function poolProof(key,expectedOwner,lastDeploySlot){
  const reply=await rpc('getAccountInfo',[key,{encoding:'base64',commitment:'confirmed'}]);
  const pool=accountMetadata(key,reply.value,reply.context.slot);
  pool.ownerMatches=pool.owner===expectedOwner;
  const vaults=[];
  for(const tokenProgram of TOKEN_PROGRAMS){
    const owned=await rpc('getTokenAccountsByOwner',[key,{programId:tokenProgram},
      {encoding:'jsonParsed',commitment:'confirmed'}]);
    vaults.push(...owned.value.map(x=>({key:x.pubkey,slot:owned.context.slot,tokenProgram,
      mint:x.account.data.parsed?.info?.mint||null,
      authority:x.account.data.parsed?.info?.owner||null,
      amount:x.account.data.parsed?.info?.tokenAmount?.amount||null,
      decimals:x.account.data.parsed?.info?.tokenAmount?.decimals??null,
      uiAmount:x.account.data.parsed?.info?.tokenAmount?.uiAmountString||null})));
  }
  const signatures=await rpc('getSignaturesForAddress',[key,{limit:12,commitment:'confirmed'}]);
  const transactions=[];
  for(const signature of signatures){
    if(signature.err)continue;
    const tx=await rpc('getTransaction',[signature.signature,
      {encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
    if(!tx)continue;
    const groups=(tx.meta?.innerInstructions||[]).map(g=>({
      outerIndex:g.index,outerProgram:programId(tx.transaction.message.instructions[g.index]),
      calls:(g.instructions||[]).map((ix,index)=>({index,program:programId(ix),
        stackHeight:ix.stackHeight??null,type:ix.parsed?.type||null,
        source:ix.parsed?.info?.source||null,destination:ix.parsed?.info?.destination||null,
        authority:ix.parsed?.info?.authority||null,mint:ix.parsed?.info?.mint||null,
        amount:ix.parsed?.info?.amount||ix.parsed?.info?.tokenAmount?.amount||null}))}));
    const transfers=groups.flatMap(g=>g.calls.filter(ix=>ix.type==='transfer'||ix.type==='transferChecked')
      .map(ix=>({outerIndex:g.outerIndex,outerProgram:g.outerProgram,...ix,
        immediateParent:immediateParent(g,ix.index),
        sourceIsCurrentPoolVault:vaults.some(v=>v.key===ix.source),
        poolAuthority:ix.authority===key})));
    transactions.push({signature:signature.signature,slot:tx.slot,
      postDeploy:tx.slot>lastDeploySlot,error:tx.meta?.err||null,
      poolOuterSigner:tx.transaction.message.accountKeys.some(x=>x.pubkey===key&&x.signer),
      outerPrograms:tx.transaction.message.instructions.map(programId),transfers,
      // Preserve group stack order for immediate-parent validation.
      groups});
    if(transactions.length>=5)break;
  }
  return {pool,vaults,signatures:signatures.map(s=>({signature:s.signature,slot:s.slot,err:s.err})),
    transactions};
}
async function main(){
  const genesis=await rpc('getGenesisHash');if(genesis!==GENESIS)throw Error('not mainnet-beta');
  const results=[];
  for(const target of targets){
    const program=await programProof(target.program);
    const pools=[];
    for(const key of target.pools)pools.push(await poolProof(key,target.program,
      program.programData?.lastDeploySlot??Number.MAX_SAFE_INTEGER));
    const result={venue:target.venue,program,pools};results.push(result);
    console.log(JSON.stringify({venue:target.venue,program:target.program,
      executable:program.executable,lastDeploySlot:program.programData?.lastDeploySlot??null,
      pools:pools.map(x=>({key:x.pool.key,ownerMatches:x.pool.ownerMatches,
        vaults:x.vaults.map(v=>({mint:v.mint,uiAmount:v.uiAmount,key:v.key})),
        recentSignatures:x.signatures.length,postDeployTransactions:x.transactions.filter(t=>t.postDeploy).length,
        knownVaultOutflows:x.transactions.flatMap(t=>t.transfers.filter(y=>y.sourceIsCurrentPoolVault))}))}));
    await wait(100);
  }
  const out={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',genesis,
    method:'Current program state, pool ownership, pool-owned token accounts, 12 newest pool-key signatures and up to 5 successful parsed transactions per pool',
    limitations:['Pool-owned token accounts can omit vaults controlled by distinct PDAs',
      'Signature index covers only the queried pool address and bounded recent history',
      'A token transfer requires stack-parent and PDA authority validation before claiming a program-signed outflow'],
    results,noMainnetTransaction:true};
  const file=path.join(__dirname,'volume-route-gates.json');
  fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({output:file,targetPrograms:targets.length,pools:targets.reduce((n,x)=>n+x.pools.length,0)}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
