#!/usr/bin/env node
'use strict';
// Read-only state-owner census and known PDA checks for third program controlled by 5ok.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const DIR = __dirname;
const PROGRAM = '3fovWrsrARaWdqJYnHRMntkSHUUmYsjYv6MFxEfoD4H8';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/).filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0,2)));
async function rpc(method, params) { const r = await fetch(env.RPC_URL, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}); const j = await r.json(); if (!r.ok || j.error) throw Error(`${method}: ${j.error?.message || r.status}`); return j.result; }
const stateNames = ['BridgeInfo','DeadlockBridgeInfo','Bridge','State'];
const seeds = ['bridge','bridge_signer','to_signer','bridgeto_signer','bridge_info','deadlock_bridge'];
async function main() {
  const result = await rpc('getProgramAccounts',[PROGRAM,{encoding:'base64',commitment:'finalized',withContext:true}]);
  const items = (result.value || result).map(({pubkey,account}) => {
    const bytes = Buffer.from(account.data[0],'base64');
    return {address:pubkey,owner:account.owner,lamports:account.lamports,executable:account.executable,space:account.space,discriminator:bytes.subarray(0,8).toString('hex'),dataHex:bytes.toString('hex'),dataSha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  });
  const pdas = Object.fromEntries(seeds.map(seed => {const [p,bump] = PublicKey.findProgramAddressSync([Buffer.from(seed)],new PublicKey(PROGRAM));return [seed,{address:p.toBase58(),bump}]}));
  const discriminators = Object.fromEntries(stateNames.map(name => [name,crypto.createHash('sha256').update('account:'+name).digest('hex').slice(0,16)]));
  const out = {program:PROGRAM,slot:result.context?.slot,programOwnedAccountCount:items.length,programOwnedAccounts:items,pdas,discriminators};
  fs.writeFileSync(path.join(DIR,'5uums-surface-programdata-third-state.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify(out,null,2));
}
main().catch(e => {console.error(e.stack);process.exitCode=1});
