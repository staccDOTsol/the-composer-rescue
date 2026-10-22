#!/usr/bin/env node
// Read-only current mainnet and independent USDC-exit screen. No wallet loaded.
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split('\n').filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const outPath = __dirname + '/numeraire-usds-quote-gate.json';
const mint = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDS: 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',
  sUSD: 'susdabGDNbhrnCa6ncrYo81u4s9GM8ecK2UwMyZiq4X',
};
let id = 0;
async function rpc(method, params) {
  const response = await fetch(rpcUrl, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}) });
  const result = await response.json();
  if (result.error) throw Error(method + ': ' + JSON.stringify(result.error));
  return result.result;
}
async function quote(input, output, amount) {
  const url = new URL('https://lite-api.jup.ag/swap/v1/quote');
  url.searchParams.set('inputMint', mint[input]);
  url.searchParams.set('outputMint', mint[output]);
  url.searchParams.set('amount', String(amount));
  url.searchParams.set('slippageBps', '50');
  const response = await fetch(url);
  const body = await response.json();
  return {input,output,amount:String(amount),status:response.status,outAmount:body.outAmount||null,
    contextSlot:body.contextSlot||null,error:body.error||null,errorCode:body.errorCode||null,
    route:(body.routePlan||[]).map(r=>({label:r.swapInfo.label,ammKey:r.swapInfo.ammKey,inAmount:r.swapInfo.inAmount,outAmount:r.swapInfo.outAmount}))};
}
async function main() {
  const sig = 'sxtvd6ZUFAZL2Yzy7fwwFUq2dg8jCjAoDXJaHT4TxMa1dza9tPfXimGL3ZqWzSd2nMibGf1XBTd8BrkBR78bvYM';
  const [slot,tx,vault,authority] = await Promise.all([
    rpc('getSlot',[{commitment:'confirmed'}]),
    rpc('getTransaction',[sig,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]),
    rpc('getTokenAccountBalance',['3DFmntWjh9PrzsiFnPQeMW773A9m62uVPE6j9YK32QCa',{commitment:'confirmed'}]),
    rpc('getAccountInfo',['3PHVBLYZnJE4SXEAJ6seQLhxNprpECgTfCot5XgVNUZ5',{encoding:'base64',commitment:'confirmed'}]),
  ]);
  const keys = tx.transaction.message.accountKeys.map(k=>typeof k==='string'?k:k.pubkey);
  const top = tx.transaction.message.instructions.map(ix=>({programId:ix.programId||keys[ix.programIdIndex],
    accounts:ix.accounts||[], data:ix.data||null,parsedType:ix.parsed?.type||null}));
  const inner = (tx.meta.innerInstructions||[]).flatMap(row=>row.instructions).filter(ix=>ix.programId==='NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P')
    .map(ix=>({programId:ix.programId,accounts:ix.accounts||[],data:ix.data||null}));
  const quotes=[];
  for(const [input,output,amount] of [
    ['USDC','USDS',100_000_000],['USDC','USDS',1_000_000_000],
    ['USDS','USDC',100_000_000],['USDS','sUSD',100_000_000],
    ['sUSD','USDC',100_000_000],['sUSD','USDC',1_000_000_000],
  ]) quotes.push(await quote(input,output,amount));
  const out={generatedAt:new Date().toISOString(),readOnly:true,slot,
    vault:{address:'3DFmntWjh9PrzsiFnPQeMW773A9m62uVPE6j9YK32QCa',amount:vault.value.amount,decimals:vault.value.decimals,
      authority:'3PHVBLYZnJE4SXEAJ6seQLhxNprpECgTfCot5XgVNUZ5',authorityOwner:authority.value?.owner||null},
    historical:{signature:sig,slot:tx.slot,err:tx.meta.err,signerKeys:tx.transaction.message.accountKeys.filter(k=>k.signer).map(k=>k.pubkey),top,inner},quotes};
  fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({slot,vault:out.vault,historical:{slot:tx.slot,top,inner},quotes},null,2));
}
main().catch(err=>{console.error(err.message);process.exitCode=1});
