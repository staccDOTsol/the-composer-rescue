#!/usr/bin/env node
// Read-only Solana RPC trace of the observed GRASS exit; RPC URL is read from local env.
const fs = require('fs');
const path = require('path');
const bs58 = require(path.join(__dirname, 'kliquidity-sdk-official/node_modules/bs58'));
const crypto = require('crypto');

const DIR = __dirname;
const PROGRAM = 'EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const SIG = 'vYM2KYraryaF9navrBZdHFnnoyU8axeuQFnm4YVMLwkGL4qTeyLVHUmuxQmcam3NcXtrt2inJpdu1gq19n4HT7v';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
async function rpc(method, params) {
  const res = await fetch(env.RPC_URL, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0', id:1, method, params})});
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`${res.status}: ${JSON.stringify(body.error)}`);
  return body.result;
}
function disc(name) {return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0,8).toString('hex');}
function keysOf(tx) {
  const msg=tx.transaction.message;
  return [...msg.accountKeys, ...(tx.meta.loadedAddresses?.writable||[]), ...(tx.meta.loadedAddresses?.readonly||[])];
}
function summary(tx) {
  const msg=tx.transaction.message, keys=keysOf(tx);
  return {signature:SIG, slot:tx.slot, blockTime:tx.blockTime,
    transactionError:tx.meta.err, preBalances:tx.meta.preTokenBalances,
    postBalances:tx.meta.postTokenBalances,
    topLevel:msg.instructions.map((ix,index)=>({index, program:keys[ix.programIdIndex],
      accounts:ix.accounts.map((i,j)=>({position:j,index:i,key:keys[i]})),
      dataBase58:ix.data,dataHex:Buffer.from(bs58.decode(ix.data)).toString('hex')})),
    inner:(tx.meta.innerInstructions||[]).map(group=>({index:group.index,
      instructions:group.instructions.map((ix,j)=>({position:j,program:keys[ix.programIdIndex],
        accounts:ix.accounts?.map((i,k)=>({position:k,index:i,key:keys[i]})),
        dataHex:ix.data?Buffer.from(bs58.decode(ix.data)).toString('hex'):null,
        stackHeight:ix.stackHeight}))})),
    anchorDiscriminators:Object.fromEntries(['initialize_reward_pool','initialize_global_config',
      'initialize_staking_pool','staking_pool_change_router','adjust_global_config',
      'fund_reward_pool','stake_tokens','unstake_tokens','claim_rewards','withdraw',
      'lock_reward_pool','lock_staking_pool','drain_reward_pool','drain_staking_pool'].map(n=>[n,disc(n)]))};
}
async function main(){
  const tx=await rpc('getTransaction',[SIG,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
  if(!tx)throw new Error('transaction unavailable');
  fs.writeFileSync(path.join(DIR,'paths-grass-exit-transaction.raw.json'),JSON.stringify(tx,null,2)+'\n');
  const s=summary(tx);
  fs.writeFileSync(path.join(DIR,'paths-grass-exit-transaction.summary.json'),JSON.stringify(s,null,2)+'\n');
  process.stdout.write(JSON.stringify({slot:s.slot,topLevel:s.topLevel.filter(x=>x.program===PROGRAM),
    matchingDiscriminators:s.topLevel.filter(x=>x.program===PROGRAM).map(x=>Object.entries(s.anchorDiscriminators).filter(([_,v])=>x.dataHex.startsWith(v))),
    inner:s.inner.filter(x=>s.topLevel[x.index].program===PROGRAM)},null,2)+'\n');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
