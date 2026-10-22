#!/usr/bin/env node
'use strict';
// Read-only current-deployment signer provenance for selected fresh custody leads.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(dir, 'mainnet-token-authority-census.raw.json')));
const universe = new Map(fs.readFileSync(path.join(dir, 'mainnet-program-universe.csv'),'utf8')
  .trim().split(/\r?\n/).slice(1).map(line=>{const x=line.split(',');return [x[0],{programId:x[0],programData:x[3]||null}]}));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split(/\r?\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
if(!endpoint)throw Error('RPC unavailable');
const targets = [
  'C64AAGzJxsFwzQZaS1t8Yis5UCVTTAchTwG2QZj1kSRi',
  'DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4',
];
let seq=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(method,params){let e;for(let i=0;i<5;i++){
  try {const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});
    if(r.status===429||r.status>=500)throw Error('retryable HTTP '+r.status);
    const v=await r.json();if(v.error)throw Error(method+' '+JSON.stringify(v.error));return v.result;
  }catch(x){e=x;await wait(200*2**i)}
}throw e;}
async function mapLimit(a,n,fn){let j=0;const out=Array(a.length);await Promise.all(Array.from({length:Math.min(n,a.length)},async()=>{
  while(j<a.length){const i=j++;try{out[i]=await fn(a[i],i)}catch(e){out[i]={error:String(e)}}}
}));return out;}
function ixPid(ix){return typeof ix?.programId==='string'?ix.programId:ix?.programId?.toString?.()||null}
function transfers(tx,vault,auth){if(!tx||tx.meta?.err)return [];
  let out=[];const top=tx.transaction?.message?.instructions||[];
  for(const group of tx.meta?.innerInstructions||[]){const root=ixPid(top[group.index]);let stack=new Map([[1,root]]);
    for(const ix of group.instructions||[]){const depth=Number(ix.stackHeight||2);const parent=stack.get(depth-1)||root;
      const p=ix.parsed;if((p?.type==='transfer'||p?.type==='transferChecked')&&p.info?.source===vault&&p.info?.authority===auth){
        out.push({slot:tx.slot,rootProgramId:root,parentProgramId:parent,tokenProgramId:ixPid(ix),
          instructionType:p.type,rawAmount:p.info.amount||p.info.tokenAmount?.amount||null,
          destination:p.info.destination||null,stackHeight:depth,outerInstructionIndex:group.index});
      }stack.set(depth,ixPid(ix));for(const k of [...stack.keys()])if(k>depth)stack.delete(k);
    }
  }
  return out;
}
async function main(){
  const genesis=await rpc('getGenesisHash',[]);if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('not mainnet-beta');
  const byAuth=new Map(raw.authorities.map(x=>[x.authority,x]));
  const result={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',genesis,noTransaction:true,
    method:'Bounded latest 20 signatures per selected vault; JSON-parsed successful SPL transfer CPI, immediate parent and current deploy-slot compare. This is not a full history or outsider-authorization proof.',programs:[]};
  for(const id of targets){const p=raw.programsByDirectStateAuthority.find(x=>x.programId===id);if(!p)continue;
    const pd=universe.get(id)?.programData;const base=[id,...p.authorities,...(pd?[pd]:[])];
    const accounts=await rpc('getMultipleAccounts',[base,{encoding:'base64',commitment:'confirmed'}]);
    let deploySlot=null;if(pd){const b=Buffer.from(accounts.value[base.length-1]?.data?.[0]||'','base64');
      if(b.length>=12&&b.readUInt32LE(0)===3)deploySlot=Number(b.readBigUInt64LE(4));}
    const row={programId:id,programExecutable:accounts.value[0]?.executable||false,deploySlot,
      pricedGrossUsd:p.pricedGrossUsd,authorities:[]};
    const rankedAuthorities=p.authorities.map((auth,ai)=>({auth,ai,usd:(byAuth.get(auth)?.tokenAccounts||[])
      .reduce((n,v)=>n+(v.usdValue||0),0)})).sort((a,b)=>b.usd-a.usd)
      .slice(0,id.startsWith('DNL')?3:1);
    for(const {auth,ai} of rankedAuthorities){const aa=byAuth.get(auth);
      const vaults=[...(aa?.tokenAccounts||[])].sort((a,b)=>(b.usdValue||0)-(a.usdValue||0)).slice(0,id.startsWith('DNL')?3:2);
      const ar={authority:auth,authorityCurrentOwner:accounts.value[ai+1]?.owner||null,
        selectedVaults:[]};
      for(const v of vaults){const sigs=await rpc('getSignaturesForAddress',[v.address,{limit:12,commitment:'confirmed'}]);
        const ok=sigs.filter(x=>!x.err);const txs=await mapLimit(ok.slice(0,8),4,x=>rpc('getTransaction',[x.signature,
          {encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]));
        const ev=txs.flatMap((tx,i)=>tx?.error?[]:transfers(tx,v.address,auth).map(e=>({...e,signature:ok[i].signature})));
        const current=ev.filter(e=>e.parentProgramId===id&&(deploySlot===null||e.slot>=deploySlot));
        ar.selectedVaults.push({address:v.address,mint:v.mint,symbol:v.symbol,rawAmountSnapshot:v.rawAmount,
          pricedUsdSnapshot:v.usdValue,signaturesScanned:sigs.length,successfulTransactionsRead:txs.filter(x=>!x?.error).length,
          outgoingTransfers:ev,currentProgramParentOutflows:current.length});
      }row.authorities.push(ar);
    }result.programs.push(row);
  }
  const file=path.join(dir,'unreviewed-controller-spend-gate.json');fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({file,programs:result.programs.map(p=>({id:p.programId,deploySlot:p.deploySlot,
    vaults:p.authorities.flatMap(a=>a.selectedVaults).length,currentParentOutflows:p.authorities.flatMap(a=>a.selectedVaults).reduce((n,v)=>n+v.currentProgramParentOutflows,0),
    otherParentOutflows:p.authorities.flatMap(a=>a.selectedVaults).reduce((n,v)=>n+v.outgoingTransfers.length-v.currentProgramParentOutflows,0)}))}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
