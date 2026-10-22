#!/usr/bin/env node
'use strict';
// Raw full-owner-program memcmp census of mint, freeze, delegate, and close authorities for 3fov bridge state PDA.
const fs=require('fs'),path=require('path');
const {PublicKey}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const AUTH='4kNkeveV4WoKYmncSe4KoUW9umwQHSA8prH7acM1uxwB';
const TOKENS={spl:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',token2022:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'};
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();if(!r.ok||j.error)throw Error(`${method}: ${j.error?.message||r.status}`);return j.result;}
const tests=[
 {kind:'mintAuthority',offset:4,type:'mint',slice:82},
 {kind:'freezeAuthority',offset:50,type:'mint',slice:82},
 {kind:'delegate',offset:76,type:'account',slice:165},
 {kind:'closeAuthority',offset:133,type:'account',slice:165},
];
const pk=b=>new PublicKey(b).toBase58();
function validate(kind,b){
 if(kind==='mintAuthority')return b.length>=82&&b.readUInt32LE(0)===1&&pk(b.subarray(4,36))===AUTH;
 if(kind==='freezeAuthority')return b.length>=82&&b.readUInt32LE(46)===1&&pk(b.subarray(50,82))===AUTH;
 if(kind==='delegate')return b.length>=165&&b.readUInt32LE(72)===1&&pk(b.subarray(76,108))===AUTH;
 if(kind==='closeAuthority')return b.length>=165&&b.readUInt32LE(129)===1&&pk(b.subarray(133,165))===AUTH;
}
async function main(){const results={};
 for(const [tokenKind,program] of Object.entries(TOKENS))for(const t of tests){
  const accounts=[],pageSlots=[];let paginationKey=null,pages=0;
  do{
   const filters=[{memcmp:{offset:t.offset,bytes:AUTH}}];if(tokenKind==='spl')filters.unshift({dataSize:t.type==='mint'?82:165});
   const r=await rpc('getProgramAccountsV2',[program,{encoding:'base64',commitment:'finalized',withContext:true,dataSlice:{offset:0,length:t.slice},filters,limit:1000,...(paginationKey?{paginationKey}:{})}]);
   pageSlots.push(r.context?.slot??null);pages++;
   for(const {pubkey,account} of r.value.accounts){const b=Buffer.from(account.data[0],'base64');if(!validate(t.kind,b))throw Error(`false positive ${t.kind} ${pubkey}`);accounts.push({address:pubkey,space:account.space,lamports:account.lamports,mint:t.type==='mint'?pubkey:pk(b.subarray(0,32)),tokenOwner:t.type==='account'?pk(b.subarray(32,64)):undefined,amountRaw:t.type==='account'?b.readBigUInt64LE(64).toString():undefined,supplyRaw:t.type==='mint'?b.readBigUInt64LE(36).toString():undefined,decimals:t.type==='mint'?b[44]:undefined});}
   paginationKey=r.value.paginationKey;
   if(pages>10000)throw Error(`excessive pagination ${tokenKind}.${t.kind}`);
  }while(paginationKey);
  results[`${tokenKind}.${t.kind}`]={pageSlots,pages,count:accounts.length,accounts};
 }
 const out={authority:AUTH,method:'getProgramAccountsV2 paginated memcmp on canonical Token/Token-2022 base layout; validation of COption tag=1 and pubkey field; finalized',results};
 fs.writeFileSync(path.join(__dirname,'5uums-surface-programdata-third-authorities.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
