#!/usr/bin/env node
// Current-state, read-only mainnet census. No wallet, signing, simulation, or send path.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const web3 = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const bs58Module = require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const root = __dirname;
const program = new web3.PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
const config = '3H7xnnaW7LwVVMcBqJSG8PTH2zjJnwyjRzKESvi51xuf';
const pool = '6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX';
const vault = '4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP';
const markets = ['96E5JtQRH3BEmQ9vx2Y2cWLe7bq3ZqjCSeJuNeziniAQ',
  'BXQQo2VTJV2upjdA6qFMGBY3uMyTMnRmaZjPCB5ZVmr7',
  'Ew8sRjpuBttpmhSUeaAn4dLAegWnz55AuafVcGuojCPS'];
const recentPosition = 'E1qZuFjEyp7nXK1dJjMmQRxH8v7mCCGqorkuK4qNNr42';
const oldPosition = '12FMjBis7y9rD4rdJS51pHYUHJCMKTcsSJ6Lga3BpTmf';
const addresses=[config,pool,vault,...markets,recentPosition,oldPosition];
async function rpc(method,params) {
  const r=await fetch('https://api.mainnet-beta.solana.com',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
  const j=await r.json(); if(!r.ok||j.error)throw new Error(`${method}: ${j.error?.message||r.status}`);return j.result;
}
const pubkey=(b,o)=>bs58.encode(b.subarray(o,o+32));
const derive=(seeds)=>web3.PublicKey.findProgramAddressSync(seeds,program)[0].toBase58();
const bytes=(a)=>Buffer.from(a.data[0],'base64');
async function main() {
  const accounts=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed'}]);
  const token=await rpc('getTokenAccountsByOwner',[pool,{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},
    {encoding:'jsonParsed',commitment:'confirmed'}]);
  const inventory=JSON.parse(fs.readFileSync(path.join(root,'yolov-auth-program-accounts-zero.json')));
  const configData=bytes(accounts.value[0]); const poolData=bytes(accounts.value[1]);
  const vaultParsed=(await rpc('getAccountInfo',[vault,{encoding:'jsonParsed',commitment:'confirmed'}])).value.data.parsed.info;
  const fieldAmounts=[8,16,24].map(offset=>({offset,raw:poolData.readBigUInt64LE(offset).toString()}));
  const fieldSum=fieldAmounts.reduce((n,x)=>n+BigInt(x.raw),0n);
  const marketRows=markets.map((address,i)=>{const b=bytes(accounts.value[i+3]);const mint=pubkey(b,8);
    return {address,assetMint:mint,oracle:pubkey(b,40),length:b.length,
      derivedFromMarketAndMint:derive([Buffer.from('market'),new web3.PublicKey(mint).toBuffer()])===address};});
  const positions=[recentPosition,oldPosition].map((address,i)=>{const b=bytes(accounts.value[i+6]);
    return {address,length:b.length,discriminator:b.subarray(0,8).toString('hex'),storedOwner:pubkey(b,8),storedMarket:pubkey(b,40)};});
  const bySpace=Object.values(Object.groupBy(inventory.result.value,r=>r.account.space)).map(rows=>({
    space:rows[0].account.space,count:rows.length,lamports:rows.reduce((n,r)=>n+BigInt(r.account.lamports),0n).toString()
  })).sort((a,b)=>a.space-b.space);
  const out={observedAt:new Date().toISOString(),network:'mainnet-beta',program:program.toBase58(),
    programBinarySha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'yolov-current.so'))).digest('hex'),
    accountBatchSlot:accounts.context.slot,tokenOwnerSlot:token.context.slot,
    accountCensusSlot:inventory.result.context.slot,
    config:{address:config,length:configData.length,derived:derive([Buffer.from('config')])===config,
      pubkeysAtOffsets:{8:pubkey(configData,8),40:pubkey(configData,40),72:pubkey(configData,72)}},
    pool:{address:pool,length:poolData.length,derived:derive([Buffer.from('pool')])===pool,
      fields:fieldAmounts,fieldSumRaw:fieldSum.toString()},
    vault:{address:vault,derived:derive([Buffer.from('vault')])===vault,owner:vaultParsed.owner,
      mint:vaultParsed.mint,raw:vaultParsed.tokenAmount.amount,decimals:vaultParsed.tokenAmount.decimals,
      tokenAccountsByPool:token.value.map(r=>({address:r.pubkey,mint:r.account.data.parsed.info.mint,
        raw:r.account.data.parsed.info.tokenAmount.amount})),
      poolFieldSumMatchesVault:fieldSum===BigInt(vaultParsed.tokenAmount.amount)},
    markets:marketRows,positionExamples:positions,
    programOwnedAccounts:{count:inventory.result.value.length,bySpace,
      totalLamports:inventory.result.value.reduce((n,r)=>n+BigInt(r.account.lamports),0n).toString()}};
  fs.writeFileSync(path.join(root,'yolov-auth-snapshot.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({slot:out.accountBatchSlot,programOwnedCount:out.programOwnedAccounts.count,
    vaultRaw:out.vault.raw,poolFieldSumRaw:out.pool.fieldSumRaw,poolFieldSumMatchesVault:out.vault.poolFieldSumMatchesVault,
    markets:out.markets.map(x=>({assetMint:x.assetMint,derived:x.derivedFromMarketAndMint}))}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
