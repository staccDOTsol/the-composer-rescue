const {Connection,PublicKey}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const fs=require('fs');
const conn=new Connection(process.env.RPC_URL,'confirmed');
const mints=[['USDC','3RpEekjLE5cdcG15YcXJUpxSepemvq2FpmMcgo342BwC'],['USDT','EZun6G5514FeqYtUv26cBHWLqXjAEdjGuoX6ThBpBtKj'],['WSOL','FZN7QZ8ZUUAxMPfxYEYkH3cXUASzH8EqA6B4tyCL8f1j'],['WSOL-idle','EcF9SszTQ6wRfvRufYaGde6QVnyTbZRE7ckBV7WkoX7r']];
(async()=>{
 const rows=[];
 for(const [sym,mint] of mints){
  const top=await conn.getTokenLargestAccounts(new PublicKey(mint));
  const infos=await conn.getMultipleAccountsInfo(top.value.map(x=>x.address));
  rows.push({sym,mint,holders:top.value.map((x,i)=>({account:x.address.toBase58(),amount:x.amount,owner:infos[i]?new PublicKey(infos[i].data.subarray(32,64)).toBase58():null}))});
 }
 fs.writeFileSync(__dirname+'/lp-holders.json',JSON.stringify(rows,null,2));
 console.log(JSON.stringify(rows,null,2));
})().catch(e=>{console.error(String(e));process.exitCode=1});
