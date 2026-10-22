#!/usr/bin/env node
// Read-only recent historical swap discovery for each DEX-peg pool.
const fs = require('fs');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection, PublicKey} = require(modules + '@solana/web3.js');
const bs58m = require(modules + 'bs58');
const bs58 = bs58m.default || bs58m;
const root = __dirname;
const e = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const conn = new Connection(e.HEAVY_RPC_URL || e.RPC_URL,'confirmed');
const dexProgram = new PublicKey('jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd');
const swapIn = Buffer.from([141,172,10,208,69,9,56,154]);
const swapOut = Buffer.from([206,36,149,14,163,132,148,1]);
async function main() {
 const census=JSON.parse(fs.readFileSync(`${root}/jupiter-dex-peg-path-census.json`));
 const rows=[];
 for(const p of census.paths) {
   const sigs=await conn.getSignaturesForAddress(new PublicKey(p.dex),{limit:20},'confirmed');
   let found=null, checked=0;
   for(const s of sigs) {
     if(s.err)continue;
     checked++;
     const tx=await conn.getParsedTransaction(s.signature,{commitment:'confirmed',maxSupportedTransactionVersion:1});
     if(!tx || tx.meta?.err)continue;
     const instructions=[...(tx.transaction.message.instructions||[]),
       ...(tx.meta.innerInstructions||[]).flatMap(group=>group.instructions||[])];
     const ix=instructions.find(x=>x.programId?.equals?.(dexProgram)&&x.data&&
       [swapIn,swapOut].some(d=>Buffer.from(bs58.decode(x.data)).subarray(0,8).equals(d))&&
       x.accounts?.length===24&&x.accounts.some(a=>a.equals(new PublicKey(p.dex))));
     if(!ix)continue;
     const data=Buffer.from(bs58.decode(ix.data));
     found={signature:s.signature,slot:tx.slot,name:data.subarray(0,8).equals(swapIn)?'swap_in':'swap_out',
       dataHex:data.toString('hex'),accounts:ix.accounts.map(String)};
     break;
   }
   const row={vaultId:p.vaultId,dex:p.dex,checked,signaturesObserved:sigs.length,fixture:found};
   rows.push(row);
   console.log(JSON.stringify({vaultId:p.vaultId,checked,found:!!found,name:found?.name}));
 }
 fs.writeFileSync(`${root}/jupiter-dex-recent-swap-fixtures.json`,JSON.stringify({generatedAt:new Date().toISOString(),
   scope:'read-only current-mainnet getSignaturesForAddress/getParsedTransaction',rows},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
