#!/usr/bin/env node
// Read-only DGLD mint/account concentration and independent-route evidence.
const fs = require('fs');
const path = require('path');
const {Connection, PublicKey} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');

const DGLD = new PublicKey('dg1dmo6NZNagkwB6EAfUeaco6CFXFLRhb1KCrsqXTVz');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const HADRON_VAULT = '6wDjoz5W9YvyPS3DNata4JbK9no8g9p9Xxxjr8z3UD5t';
const envFile = '/Users/stacc/.config/stacc-ladder/rpc.env';
const row = fs.readFileSync(envFile,'utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if (!row) throw Error('SOLANA_RPC missing');
const rpcUrl = row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const connection = new Connection(rpcUrl,'confirmed');

async function main() {
  const genesis = await connection.getGenesisHash();
  const mint = await connection.getParsedAccountInfo(DGLD,'confirmed');
  const accounts = await connection.getParsedProgramAccounts(TOKEN_2022, {
    commitment:'confirmed',
    filters:[{memcmp:{offset:0,bytes:DGLD.toBase58()}}],
  });
  const rows = accounts.map(a => {
    const info = a.account.data.parsed?.info || {};
    return {
      address:a.pubkey.toBase58(),
      owner:info.owner || null,
      amount:info.tokenAmount?.amount || null,
      state:info.state || null,
      extensions:info.extensions || [],
      lamports:a.account.lamports,
      dataLength:a.account.data.space || null,
    };
  }).sort((a,b)=>Number(BigInt(b.amount||0)-BigInt(a.amount||0)));
  const supply = BigInt(mint.value?.data?.parsed?.info?.supply || 0);
  const vault = rows.find(r=>r.address===HADRON_VAULT);
  const output = {
    observedAtUtc:new Date().toISOString(),
    genesis,
    slot:mint.context.slot,
    noTransactions:true,
    mint:{
      address:DGLD.toBase58(),
      owner:mint.value?.owner.toBase58() || null,
      parsed:mint.value?.data?.parsed || null,
    },
    supply:supply.toString(),
    tokenAccountCount:rows.length,
    hadronVault:vault || null,
    hadronVaultSupplyPct:vault && supply ? Number(BigInt(vault.amount)*1000000n/supply)/10000 : null,
    topAccounts:rows.slice(0,40),
  };
  fs.writeFileSync(path.join(__dirname,'hadron-dgld-exit-census.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({slot:output.slot,supply:output.supply,tokenAccountCount:rows.length,hadronVaultSupplyPct:output.hadronVaultSupplyPct,top:rows.slice(0,10)},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
