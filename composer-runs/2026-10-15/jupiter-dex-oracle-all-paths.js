#!/usr/bin/env node
// Read-only current-binary oracle controls for all 11 DEX-peg vault paths.
const fs=require('fs');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection,PublicKey,TransactionInstruction}=require(modules+'@solana/web3.js');
const {encodeV1}=require('./klend-v1-composition.js');
const e=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
 .split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const url=e.HEAVY_RPC_URL||e.RPC_URL;
const conn=new Connection(url,'confirmed'),P=x=>new PublicKey(x);
const root=__dirname;
const oracle=P('jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc');
const payer=P('8v9jRkjCZBM37ZQwqE6wtPzUiCmp9UXHgFy4ZfdKA4Bc');
const disc=Buffer.from([92,88,161,46,230,193,46,237]);
let id=0;
async function rpc(method,params){const x=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});return x.json()}
function rate(logs){const line=(logs||[]).find(x=>x.startsWith('Program return: '+oracle.toBase58()+' '));
 if(!line)return null;const d=Buffer.from(line.split(' ').at(-1),'base64');let a=0n,b=0n;
 for(let i=15;i>=0;i--)a=(a<<8n)+BigInt(d[i]);for(let i=31;i>=16;i--)b=(b<<8n)+BigInt(d[i]);
 return {supplyX15:a.toString(),borrowX15:b.toString()}}
async function main(){const c=JSON.parse(fs.readFileSync(`${root}/jupiter-dex-peg-path-census.json`));
 const blockhash=(await conn.getLatestBlockhash('confirmed')).blockhash,results=[];
 for(const p of c.paths){const n=Buffer.alloc(2);n.writeUInt16LE(p.oracleNonce);
  const debtComposite=[91,96].includes(p.vaultId)?[
   'iFgP2EbzHUZzMjqbjaagJQ8zmn6as3Hw95aVUKm67od',
   '59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw']:[];
  const addrs=[p.oracle,...debtComposite,p.oracleSource,p.dex,p.dexPositionToken0,p.dexPositionToken1,
   p.tokenReserve0,p.tokenReserve1,p.conversionSource]
   .filter(x=>x!=='11111111111111111111111111111111');
  const ix=new TransactionInstruction({programId:oracle,keys:addrs.map(x=>({pubkey:P(x),
   isSigner:false,isWritable:false})),data:Buffer.concat([disc,n])});
  const wire=encodeV1([ix],payer,blockhash);
  const j=await rpc('simulateTransaction',[wire.wire.toString('base64'),{encoding:'base64',
   sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed'}]);
  const r={vaultId:p.vaultId,oracle:p.oracle,nonce:p.oracleNonce,slot:j.result?.context?.slot,
   err:j.result?.value?.err||null,rpcError:j.error||null,rate:rate(j.result?.value?.logs),
   logs:j.result?.value?.logs?.slice(-8)};results.push(r);
  console.log(JSON.stringify({vaultId:p.vaultId,err:r.err,rate:r.rate}));}
 fs.writeFileSync(`${root}/jupiter-dex-oracle-all-paths.json`,JSON.stringify({generatedAt:new Date().toISOString(),
  transport:'current mainnet simulateTransaction only; sigVerify:false read-only oracle control',results},null,2));}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
