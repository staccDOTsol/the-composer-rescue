#!/usr/bin/env node
// Locate a historical v103 DEX swap account tuple without changing chain state.
const fs=require('fs');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection,PublicKey}=require(modules+'@solana/web3.js');
const bs58m=require(modules+'bs58'),bs58=bs58m.default||bs58m;
const e=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean)
 .map(x=>x.split(/=(.*)/s).slice(0,2)));
const conn=new Connection(e.HEAVY_RPC_URL||e.RPC_URL,'confirmed');
const dex=new PublicKey('G41Dqz9A1v39TT2MryR5BkZU2a7UzfUkiRHyJGuRfeyF');
const program=new PublicKey('jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd');
async function main(){
 const sigs=await conn.getSignaturesForAddress(dex,{limit:250},'confirmed');
 let checked=0,found=null;
 for(let i=0;i<sigs.length&&!found;i+=15){
  const batch=sigs.slice(i,i+15).filter(s=>!s.err);
  const txs=await conn.getParsedTransactions(batch.map(s=>s.signature),
   {commitment:'confirmed',maxSupportedTransactionVersion:1});
  for(let j=0;j<txs.length;j++){
   const tx=txs[j];checked++;
   if(!tx||tx.meta?.err)continue;
   const instructions=[...tx.transaction.message.instructions,
    ...(tx.meta.innerInstructions||[]).flatMap(g=>g.instructions||[])];
   const ix=instructions.find(x=>x.programId?.equals?.(program)&&x.data&&x.accounts?.length===24&&
    x.accounts.some(a=>a.equals(dex))&&[
     '8dac0ad04509389a','ce24950ea3849401'].includes(Buffer.from(bs58.decode(x.data)).subarray(0,8).toString('hex')));
   if(ix){found={signature:batch[j].signature,slot:tx.slot,
    dataHex:Buffer.from(bs58.decode(ix.data)).toString('hex'),
    accounts:ix.accounts.map(String)};break;}
  }
  console.log(JSON.stringify({checked,found:!!found}));
 }
 fs.writeFileSync(__dirname+'/jupiter-dex-v103-fixture-deep.json',JSON.stringify({
  generatedAt:new Date().toISOString(),sigsObserved:sigs.length,checked,found},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
