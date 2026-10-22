#!/usr/bin/env node
// Offline PDA seed search over real open-position receipts, using read-only RPC.
const fs=require('fs');
const {PublicKey}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const bs58module=require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58=bs58module.default||bs58module;
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/)
  .find(x=>/^\s*export SOLANA_RPC=/.test(x));
const endpoint=row?.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const program=new PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
  const b=await r.json();if(!r.ok||b.error)throw Error(`${method}: ${b.error?.message||r.status}`);return b.result;}
async function sample(signature){const tx=await rpc('getTransaction',[signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
  const ix=tx.transaction.message.instructions.find(x=>x.programId===program.toBase58() &&
    Buffer.from(bs58.decode(x.data)).subarray(0,8).toString('hex')==='87802f4d0f98f031');
  const data=Buffer.from(bs58.decode(ix.data));
  return {signature,slot:tx.slot,owner:ix.accounts[0],market:ix.accounts[3],pool:ix.accounts[4],
    position:ix.accounts[5],destination:ix.accounts[8],args:data.subarray(8).toString('hex'),data};}
const label=(x)=>({name:x.name,seed:x.seed});
function sources(s){
  const constants=['position','Position','positions','pos','trade','open_position','position_state','user_position','yolo_position','account','market_position',''].map(x=>({name:JSON.stringify(x),seed:Buffer.from(x)}));
  const keys=['owner','market','pool','destination'].map(k=>({name:k,seed:new PublicKey(s[k]).toBuffer()}));
  const args=[];for(const size of [1,2,4,8,16,24,27,32])for(let off=0;off+size<=s.data.length-8;off++){
    args.push({name:`args[${off}:${off+size}]`,seed:s.data.subarray(8+off,8+off+size)});}
  return {constants,keys,args};
}
function permutations(input,k,prefix=[],output=[]){if(prefix.length===k){output.push(prefix);return output;}
  for(let i=0;i<input.length;i++)if(!prefix.includes(input[i]))permutations(input,k,[...prefix,input[i]],output);
  return output;}
function test(s){const wanted=s.position;const {constants,keys,args}=sources(s);const matches=[];let tried=0;
  const base=[...constants,...keys];
  function probe(arr){if(arr.some(x=>x.seed.length>32))return;tried++;
    try{if(PublicKey.findProgramAddressSync(arr.map(x=>x.seed),program)[0].toBase58()===wanted)matches.push(arr.map(label));}catch{}}
  for(const k of [1,2,3])for(const p of permutations(base,k))probe(p);
  for(const arg of args){
    probe([arg]);
    for(const one of base){probe([one,arg]);probe([arg,one]);}
    for(const two of permutations(base,2)){
      probe([arg,...two]);probe([two[0],arg,two[1]]);probe([...two,arg]);
    }
  }
  return {signature:s.signature,slot:s.slot,owner:s.owner,market:s.market,position:s.position,
    args:s.args,tried,matches};
}
async function main(){const genesis=await rpc('getGenesisHash',[]);if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('wrong chain');
  const signatures=['2NX47m8N8qyiUBhkVXfEwo9Ws8yiQmqo84ehcMGowcStt6wYGybn5ux9EWTyXMbJ6L7NPjnPWCPJp7LrDPB51sv2',
    'Tc3katsq1SjtyFH3SM5TRETWbHT7eT7ERKLUkiwKSxsSSjnGtvsBNJ1A8KdzzBtNNAr5DaqgVURBc5Xjzu4ZMrv'];
  const out={observedAt:new Date().toISOString(),network:'mainnet-beta',program:program.toBase58(),rows:[]};
  for(const sig of signatures)out.rows.push(test(await sample(sig)));
  fs.writeFileSync(`${__dirname}/yolov-position-seeds.json`,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify(out.rows.map(x=>({signature:x.signature,position:x.position,tried:x.tried,matches:x.matches}))));}
main().catch(e=>{console.error(e.message);process.exitCode=1});
