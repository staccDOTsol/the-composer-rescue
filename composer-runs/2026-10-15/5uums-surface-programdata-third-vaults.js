#!/usr/bin/env node
'use strict';
// Read-only Token and Token-2022 account census for the second live bridge state PDA.
const fs=require('fs'),path=require('path');
const OWNER='4kNkeveV4WoKYmncSe4KoUW9umwQHSA8prH7acM1uxwB';
const TOKENS={spl:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',token2022:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'};
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();if(!r.ok||j.error)throw Error(`${method}: ${j.error?.message||r.status}`);return j.result;}
async function main(){
 const sets={};
 for(const [kind,programId] of Object.entries(TOKENS)){
   const r=await rpc('getTokenAccountsByOwner',[OWNER,{programId},{encoding:'jsonParsed',commitment:'finalized'}]);
   sets[kind]={tokenProgram:programId,slot:r.context.slot,accounts:r.value.map(({pubkey,account})=>({address:pubkey,lamports:account.lamports,space:account.space,programOwner:account.owner,info:account.data.parsed.info}))};
 }
 const all=Object.values(sets).flatMap(s=>s.accounts);
 const byMint={};for(const a of all){const mint=a.info.mint;const b=byMint[mint]||(byMint[mint]={count:0,rawAmount:'0',decimals:a.info.tokenAmount.decimals,uiAmountString:a.info.tokenAmount.uiAmountString,accounts:[]});b.count++;b.rawAmount=(BigInt(b.rawAmount)+BigInt(a.info.tokenAmount.amount)).toString();b.accounts.push(a.address)}
 const out={owner:OWNER,method:'getTokenAccountsByOwner for legacy SPL Token and Token-2022 programs; finalized commitment',sets,totalAccountCount:all.length,uniqueMintCount:Object.keys(byMint).length,byMint};
 fs.writeFileSync(path.join(__dirname,'5uums-surface-programdata-third-vaults.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
