#!/usr/bin/env node
'use strict';
const fs=require('fs');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey}=require(modules+'@solana/web3.js');
const {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID}=require(modules+'@solana/spl-token');
const rpcUrl=process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com';
const mint=new PublicKey('JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD');
const source=JSON.parse(fs.readFileSync(`${__dirname}/jupusd-prediction-current-orders-tickets-census.json`));
const orders=source.pendingOrders;
let id=0;
async function rpc(method,params){const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;}
async function main(){const rows=orders.map(o=>({...o,orderAta:getAssociatedTokenAddressSync(mint,new PublicKey(o.pubkey),true,TOKEN_PROGRAM_ID).toBase58()}));const result=await rpc('getMultipleAccounts',[rows.map(r=>r.orderAta),{encoding:'base64',commitment:'finalized'}]);let total=0n,nonzero=0;const balances=rows.map((row,i)=>{const a=result.value[i];let amount=0n;if(a){const b=Buffer.from(a.data[0],'base64');amount=b.readBigUInt64LE(64);}if(amount>0n)nonzero++;total+=amount;return{order:row.pubkey,orderAta:row.orderAta,isBuy:row.isBuy,status:row.status,contracts:row.contracts,escrowRaw:amount.toString()};});const out={generatedAt:new Date().toISOString(),slot:result.context.slot,mint:mint.toBase58(),orderCount:rows.length,nonzeroEscrowCount:nonzero,totalEscrowRaw:total.toString(),balances};fs.writeFileSync(`${__dirname}/jupusd-prediction-current-order-escrow-census.json`,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({...out,balances:balances.filter(x=>BigInt(x.escrowRaw)>0n).slice(0,10)},null,2));}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
