#!/usr/bin/env node
// Read-only history index for the current liquid-unstaker executable.
const fs = require('fs');
const crypto = require('crypto');
const program = '2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const base58 = bs58.default || bs58;
const names = ['deposit_sol','flash_borrow','flash_repay','liquid_unstake_lst',
  'liquid_unstake_lst_with_seed','liquid_unstake_lst_with_wrapped',
  'liquid_unstake_lst_with_wrapped_seed','liquid_unstake_stake_account',
  'update','update_pool','withdraw_sol','withdraw_stake_account'];
const ixByDisc = Object.fromEntries(names.map(name => [crypto.createHash('sha256')
  .update('global:' + name).digest().subarray(0, 8).toString('hex'), name]));
let id=0;
async function rpc(method, params) {
  const res = await fetch(url, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0', id:++id, method, params})});
  const json = await res.json();
  if (json.error) throw Error(method + ' ' + JSON.stringify(json.error));
  return json.result;
}
async function main() {
  const sigs = await rpc('getSignaturesForAddress', [program, {limit:100, commitment:'confirmed'}]);
  const rows=[];
  for (let start=0; start<sigs.length; start+=10) {
    const batch=await Promise.all(sigs.slice(start,start+10).map(async s => {
      try {
        const tx=await rpc('getTransaction',[s.signature,
          {encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
        if (!tx) return null;
        const ixs=tx.transaction.message.instructions.filter(x => x.programId===program)
          .map(x => ({name:ixByDisc[Buffer.from(base58.decode(x.data)).subarray(0,8).toString('hex')]||null,
            data:x.data, accounts:x.accounts}));
        return {signature:s.signature,slot:s.slot,err:s.err,ixs};
      } catch (e) { return {signature:s.signature,slot:s.slot,error:String(e)}; }
    }));
    rows.push(...batch.filter(Boolean));
  }
  const out={generatedAt:new Date().toISOString(),program,sampled:sigs.length,rows};
  fs.writeFileSync(__dirname+'/2ru1-recent-instructions.json',JSON.stringify(out,null,2)+'\n');
  const count={};for(const row of rows)for(const ix of row.ixs||[])count[ix.name]=(count[ix.name]||0)+1;
  console.log(JSON.stringify({sampled:rows.length,count,errors:rows.filter(r=>r.error).length,
    success:rows.filter(r=>!r.err&&!r.error).length}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
