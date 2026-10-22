#!/usr/bin/env node
'use strict';
// Read-only mainnet-beta census recheck, deployed-signer outflow sample, and executable exit quotes.
const fs=require('fs'),path=require('path');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split(/\r?\n/).filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const rpcUrl=env.HEAVY_RPC_URL||env.RPC_URL;
if(!rpcUrl)throw Error('RPC endpoint unavailable');
const program='GKU1LXhi2eZEp9UXe7y5Po5uYJ1wWpp4GNqygd3yhWr9';
const mint='onoyC1ZjHNtT2tShqvVSg5WEcQDbu5zht6sdU9Nwjrc';
const usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const vaults=['Ajft677dkFAwBzbGZoNoeZJ19eASF4JUVVoTBAteLAUU',
  '7CRLfty5mSysnpiBwdSkfTovEqW5V1hWsPq5qnKjfMni',
  'DN3CPQ8WbgRRRxnhh7TezXGzMcJqSxXg5savqo2EMmZh',
  'Atnsg72sU9KEuotzL6iCfinCY9h1hYMyMuuz8sskPziU'];
const abc='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(b){let n=BigInt('0x'+b.toString('hex')),s='';while(n){s=abc[Number(n%58n)]+s;n/=58n;}for(const x of b){if(x!==0)break;s='1'+s;}return s;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(method,params=[]){const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const x=await r.json();if(x.error)throw Error(`${method}: ${JSON.stringify(x.error)}`);return x.result;}
async function quote(amount){const qs=new URLSearchParams({inputMint:mint,outputMint:usdc,amount:String(amount),slippageBps:'100'});
  for(let i=0;i<3;i++){const r=await fetch('https://lite-api.jup.ag/swap/v1/quote?'+qs);const t=await r.text();
    if(r.status===429||t.startsWith('Rate limit')){await sleep(2000*(i+1));continue;}
    let q;try{q=JSON.parse(t)}catch{return {httpStatus:r.status,error:'non-JSON'}}
    return {httpStatus:r.status,inputRaw:String(amount),outUsdcRaw:q.outAmount||null,error:q.error||null,
      contextSlot:q.contextSlot||null,route:(q.routePlan||[]).map(z=>({label:z.swapInfo?.label||null,
        ammKey:z.swapInfo?.ammKey||null,percent:z.percent||null}))};}
  return {inputRaw:String(amount),error:'rate-limited'};}
function accKeys(tx){return tx.transaction.message.accountKeys.map(x=>typeof x==='string'?x:x.pubkey);}
async function main(){const genesis=await rpc('getGenesisHash');if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('not mainnet-beta');
  const state=await rpc('getMultipleAccounts',[[program,...vaults],{encoding:'base64',commitment:'confirmed'}]);
  const programBytes=Buffer.from(state.value[0].data[0],'base64');const programData=b58(programBytes.subarray(4,36));
  const pd=await rpc('getAccountInfo',[programData,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:16}}]);
  const pdBytes=Buffer.from(pd.value.data[0],'base64');const deploySlot=Number(pdBytes.readBigUInt64LE(4));
  const vaultRows=vaults.map((v,i)=>{const a=state.value[i+1],b=Buffer.from(a.data[0],'base64');return {address:v,
    tokenProgram:a.owner,authority:b58(b.subarray(32,64)),mint:b58(b.subarray(0,32)),rawAmount:b.readBigUInt64LE(64).toString(),space:b.length};});
  const sigSets=await Promise.all(vaults.map(v=>rpc('getSignaturesForAddress',[v,{limit:20,commitment:'confirmed'}])));
  const candidates=[...new Map(sigSets.flat().filter(x=>!x.err&&x.slot>deploySlot).map(x=>[x.signature,x])).values()].sort((a,b)=>b.slot-a.slot).slice(0,45);
  const transfers=[];
  for(let i=0;i<candidates.length;i+=5){const batch=candidates.slice(i,i+5);const txs=await Promise.all(batch.map(x=>rpc('getTransaction',[x.signature,
    {encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]).catch(()=>null)));
    txs.forEach((tx,j)=>{if(!tx?.meta?.innerInstructions)return;const keys=accKeys(tx);
      for(const group of tx.meta.innerInstructions){const root=tx.transaction.message.instructions[group.index]?.programId||null;
        if(root!==program)continue;
        for(const inner of group.instructions){const info=inner.parsed?.info||{};
          if(vaults.includes(info.source)||vaults.includes(info.account)||vaults.includes(info.destination))
            transfers.push({signature:batch[j].signature,slot:batch[j].slot,root,
              source:info.source||null,destination:info.destination||null,authority:info.authority||null,
              amount:info.amount||info.tokenAmount?.amount||null,type:inner.parsed?.type||null,
              tokenProgram:inner.programId||null,
              signers:tx.transaction.message.accountKeys.filter(x=>x.signer).map(x=>x.pubkey),accountCount:keys.length});}
      }
    });
    if(transfers.some(x=>vaults.includes(x.source)))break;}
  const quotes=[];for(const n of [1000,100000,1000000,10000000]){quotes.push({onoInput:n,...await quote(BigInt(n)*1000000000n)});await sleep(350);}
  const out={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',genesis,stateSlot:state.context.slot,
    program,programData,deploySlot,mint,tokenProgram:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    vaultRows,txSample:{sampledVaultAddresses:vaults.length,signaturesConsidered:candidates.length,
      matchingProgramParentTokenInstructions:transfers},quotes,noTransaction:true,
    limitations:['This is a bounded top-vault and recent-signature sample, not full program coverage',
      'Jupiter best-exact-in quotes are read-only liquidity indicators, not executable atomic proof',
      'Program-owned authority states and gross vault marks do not imply outsider withdrawal rights']};
  const file=path.join(__dirname,'gku-ono-current-gate.json');fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({slot:out.stateSlot,deploySlot,programData,vaultRows,signatures:candidates.length,
    transferCount:transfers.length,outflows:transfers.filter(x=>vaults.includes(x.source)).slice(0,5),
    quotes:quotes.map(x=>({input:x.onoInput,out:x.outUsdcRaw||null,error:x.error||null,route:x.route?.map(y=>y.label)||null})),file}));}
main().catch(e=>{console.error(e.message);process.exitCode=1});
