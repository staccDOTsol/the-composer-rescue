#!/usr/bin/env node
'use strict';
// Read-only current-binary Hadron vault and outflow provenance sample.
const fs = require('fs');
const path = require('path');
const {PublicKey} = require(path.join(__dirname,'onre-harness/node_modules/@solana/web3.js'));
const dir=__dirname;
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split(/\r?\n/).filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
const PROGRAM='HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8';
const vaults=[
  ['DGLD','6wDjoz5W9YvyPS3DNata4JbK9no8g9p9Xxxjr8z3UD5t','rQsUkcKpia3v3VykWVNZWALuYehNZSTTjDa7qJ3oxWs'],
  ['ANTHROPIC','CnHiVJRJUMAtoJvo64gcHsb3rFydzb14uGD6kmxTvrka','ECQbBHaizQtQU7AGtfttR2LbZ229KPibgUsyTG659yq'],
  ['FIGUREAI','6ewsbp4KkCqCfwgoDmraof9EpTxmfmoSf3GSJVsdMtwd','52YvJ7DW68pigefJtQKHg7cFWSphBBuAe8jYzyW9U6ye'],
  ['KALSHI','GvqTCjALf4X4hoScJu3SsBa9M84VyqTPZhB8qXuqiwUc','3jgFeyxjUsTWckf8EESMJ8CAWqDNZ2jAhDQtbHzqJFRY']
];
let requestId=0;
async function rpc(method,params=[]){
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++requestId,method,params}),signal:AbortSignal.timeout(25000)});
  const body=await response.json();
  if(body.error)throw Error(method+': '+JSON.stringify(body.error));
  return body.result;
}
async function inspectVault(symbol,vault,authority){
  const signatures=await rpc('getSignaturesForAddress',[vault,{limit:24,commitment:'confirmed'}]);
  const outgoing=[];
  for(let i=0;i<signatures.length;i+=6){
    const txs=await Promise.all(signatures.slice(i,i+6).map(s=>rpc('getTransaction',[s.signature,
      {encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]).catch(()=>null)));
    for(let k=0;k<txs.length;k++){
      const tx=txs[k],sig=signatures[i+k];if(!tx||tx.meta?.err)continue;
      for(const group of tx.meta?.innerInstructions||[]){
        const root=tx.transaction.message.instructions[group.index]?.programId||null;
        const stack=[root];
        for(const ix of group.instructions){
          const depth=ix.stackHeight||2,parent=stack[depth-2]||null;
          stack[depth-1]=ix.programId;stack.length=depth;
          const info=ix.parsed?.info;
          if(info?.source===vault&&/transfer/i.test(ix.parsed?.type||''))
            outgoing.push({signature:sig.signature,slot:sig.slot,root,parent,
              targetIsImmediateParent:parent===PROGRAM,authority:info.authority,
              amount:info.amount||info.tokenAmount?.amount||null,destination:info.destination});
        }
      }
    }
  }
  return {symbol,vault,authority,sampledSignatures:signatures.length,
    latestSignatureSlot:signatures[0]?.slot||null,outgoing};
}
(async()=>{
  const genesis=await rpc('getGenesisHash');
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('wrong cluster');
  const keys=[PROGRAM,...vaults.flatMap(v=>[v[1],v[2]])];
  const accounts=await rpc('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed'}]);
  const p=accounts.value[0];
  if(!p?.executable)throw Error('program is not executable');
  const pd=new PublicKey(Buffer.from(p.data[0],'base64').subarray(4,36)).toBase58();
  const pdInfo=await rpc('getAccountInfo',[pd,{encoding:'base64',commitment:'confirmed'}]);
  const pdData=Buffer.from(pdInfo.value.data[0],'base64');
  const deploySlot=Number(pdData.readBigUInt64LE(4));
  const mapping=[];
  for(let i=0;i<vaults.length;i++){
    const v=vaults[i],t=accounts.value[1+i*2],a=accounts.value[2+i*2];
    mapping.push({symbol:v[0],vault:v[1],authority:v[2],vaultExists:!!t,
      authorityOwner:a?.owner||null,authorityOwnedByProgram:a?.owner===PROGRAM,
      tokenProgram:t?.owner||null});
  }
  const traces=[];
  for(const v of vaults)traces.push(await inspectVault(...v));
  const output={observedAtUtc:new Date().toISOString(),genesis,contextSlot:accounts.context.slot,
    program:PROGRAM,programData:pd,currentDeploySlot:deploySlot,noTransaction:true,
    method:'Current program/vault/authority account reads plus latest 24 successful/failed signature headers per selected vault; successful transfers traced to immediate CPI parent',
    mapping,traces};
  fs.writeFileSync(path.join(dir,'hadron-current-gate.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({slot:output.contextSlot,deploySlot,
    rows:traces.map((t,i)=>({symbol:t.symbol,authorityOwnedByProgram:mapping[i].authorityOwnedByProgram,
      signatures:t.sampledSignatures,transfers:t.outgoing.length,
      currentParent:t.outgoing.filter(z=>z.targetIsImmediateParent&&z.slot>=deploySlot).length,
      latest:t.outgoing[0]?.slot||null}))}));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
