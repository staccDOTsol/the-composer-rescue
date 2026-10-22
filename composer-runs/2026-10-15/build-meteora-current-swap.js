#!/usr/bin/env node
'use strict';
const fs = require('fs');
const {Connection, PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {BN} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const DLMM = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@meteora-ag/dlmm');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const connection = new Connection(env.HEAVY_RPC_URL||env.RPC_URL,'confirmed');
const pair = new PublicKey(process.env.TARGET_PAIR || '9d9mb8kooFfaD3SctgZtkxQypkshx6ezhbKio89ixyy2');
const usdc = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const user = new PublicKey('Dsg7ZFQzXuiKsBAmL78Y5V5VjN6ASkfKDxB7VUNpp6aM');
const outPath = process.env.OUT || '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-current-swap-built.json';
(async()=>{
 const pool=await DLMM.create(connection,pair);
 const tokenX=pool.lbPair.tokenXMint, tokenY=pool.lbPair.tokenYMint;
 if (!tokenX.equals(usdc) && !tokenY.equals(usdc)) throw new Error('target pair does not contain USDC');
 const other=tokenX.equals(usdc)?tokenY:tokenX;
 const forwardSwapForY=tokenX.equals(usdc);
 const arrays=await pool.getBinArrayForSwap(forwardSwapForY,4);
 const quote=pool.swapQuote(new BN(1000),forwardSwapForY,new BN(100),arrays,true,3);
 const tx=await pool.swap({inToken:usdc,outToken:other,inAmount:new BN(1000),minOutAmount:new BN(0),lbPair:pair,user,binArraysPubkey:quote.binArraysPubkey});
 const reverseArrays=await pool.getBinArrayForSwap(!forwardSwapForY,4);
 let reverseQuote=null, reverseTx=null, reverseConstructionError=null;
 try {
   reverseQuote=pool.swapQuote(quote.outAmount,!forwardSwapForY,new BN(100),reverseArrays,true,3);
   reverseTx=await pool.swap({inToken:other,outToken:usdc,inAmount:quote.outAmount,minOutAmount:new BN(0),lbPair:pair,user,binArraysPubkey:reverseQuote.binArraysPubkey});
 } catch(error) { reverseConstructionError=String(error?.message||error); }
 const boundaryQuotes=[];
 const amounts=(process.env.AMOUNTS?process.env.AMOUNTS.split(',').map(Number):[1,2,3,4,5,10,100,1000,10000,100000,1000000,10000000,100000000,300000000,400000000,1000000000,10000000000,100000000000,772167161008]);
 for(const amount of amounts){
   try { const q=pool.swapQuote(new BN(amount),forwardSwapForY,new BN(100),arrays,true,3); let rq=null, reverseError=null; try { if(!q.outAmount.isZero()) rq=pool.swapQuote(q.outAmount,!forwardSwapForY,new BN(100),reverseArrays,true,3); } catch(error) { reverseError=String(error?.message||error); } boundaryQuotes.push({inAmount:String(amount),consumedInAmount:q.consumedInAmount.toString(),outAmount:q.outAmount.toString(),fee:q.fee.toString(),protocolFee:q.protocolFee.toString(),reverseOutAmount:rq?.outAmount.toString()||"0",reverseFee:rq?.fee.toString()||"0",reverseProtocolFee:rq?.protocolFee.toString()||"0",reverseError,endPrice:q.endPrice?.toString()||null,priceImpact:q.priceImpact?.toString()||null}); }
   catch(error){ boundaryQuotes.push({inAmount:String(amount),error:String(error?.message||error)}); }
 }
 const encode=ix=>({programId:ix.programId.toBase58(),dataHex:Buffer.from(ix.data).toString('hex'),keys:ix.keys.map(k=>({address:k.pubkey.toBase58(),signer:k.isSigner,writable:k.isWritable}))});
 const result={pair:pair.toBase58(),user:user.toBase58(),inToken:usdc.toBase58(),outToken:other.toBase58(),tokenX:tokenX.toBase58(),tokenY:tokenY.toBase58(),forwardSwapForY,quote:{consumedInAmount:quote.consumedInAmount.toString(),outAmount:quote.outAmount.toString(),fee:quote.fee.toString(),protocolFee:quote.protocolFee.toString(),binArraysPubkey:quote.binArraysPubkey.map(String)},reverseQuote:reverseQuote?{consumedInAmount:reverseQuote.consumedInAmount.toString(),outAmount:reverseQuote.outAmount.toString(),fee:reverseQuote.fee.toString(),protocolFee:reverseQuote.protocolFee.toString(),binArraysPubkey:reverseQuote.binArraysPubkey.map(String)}:null,reverseConstructionError,boundaryQuotes,instructions:tx.instructions.map(encode),reverseInstructions:reverseTx?reverseTx.instructions.map(encode):[]};
 fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({out:outPath,quote:result.quote,reverseQuote:result.reverseQuote,instructions:result.instructions.length,reverseInstructions:result.reverseInstructions.length},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
