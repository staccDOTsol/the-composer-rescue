#!/usr/bin/env node
// Read-only, slot-tied Hadron pool inspection. Loads the official SDK from npm.
const fs = require('fs');
const path = require('path');
const {Connection, PublicKey} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {Hadron} = require('./hadron-sdk/package/dist/index.js');
const program = 'HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8';
const poolIds = [
  ['DGLD','rQsUkcKpia3v3VykWVNZWALuYehNZSTTjDa7qJ3oxWs'],
  ['ANTHROPIC','ECQbBHaizQtQU7AGtfttR2LbZ229KPibgUsyTG659yq'],
  ['FIGUREAI','52YvJ7DW68pigefJtQKHg7cFWSphBBuAe8jYzyW9U6ye'],
  ['KALSHI','3jgFeyxjUsTWckf8EESMJ8CAWqDNZ2jAhDQtbHzqJFRY']
];
const envFile = '/Users/stacc/.config/stacc-ladder/rpc.env';
const row = fs.readFileSync(envFile,'utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if (!row) throw Error('SOLANA_RPC missing from local environment');
const rpcUrl = row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const connection = new Connection(rpcUrl,'confirmed');
const cast = x => JSON.parse(JSON.stringify(x, (_,v)=>typeof v==='bigint'?v.toString():v instanceof PublicKey?v.toBase58():v));
async function token(account) {
  const result = await connection.getParsedAccountInfo(account,'confirmed');
  const info = result.value?.data?.parsed?.info;
  return {slot:result.context.slot, exists:!!result.value, address:account.toBase58(),
    owner:result.value?.owner.toBase58()||null, mint:info?.mint||null,
    authority:info?.owner||null, raw:info?.tokenAmount?.amount||null,
    decimals:info?.tokenAmount?.decimals??null};
}
async function main() {
  const genesis=await connection.getGenesisHash();
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('wrong cluster');
  const pools=[];
  for(const [label,id] of poolIds){
    const h=await Hadron.load(connection,new PublicKey(id));
    const [x,y]=await Promise.all([token(h.addresses.vaultX),token(h.addresses.vaultY)]);
    const mintKeys=[h.config.mintX,h.config.mintY];
    const mintRes=await Promise.all(mintKeys.map(mint=>connection.getParsedAccountInfo(mint,'confirmed')));
    const mints=mintRes.map((result,i)=>{
      const value=result?.value;
      return {address:mintKeys[i].toBase58(),slot:result?.context.slot||null,
        owner:value?.owner.toBase58()||null,
        decimals:value?.data?.parsed?.info?.decimals??null,
        supply:value?.data?.parsed?.info?.supply||null};
    });
    let risk=null;
    try{risk=h.getInventoryRiskFactors(BigInt(x.raw||'0'),BigInt(y.raw||'0'))}catch(e){risk={error:e.message}}
    const record={label,poolAddress:id,poolState:h.config.state,
      configAuthority:h.config.authority.toBase58(),depositAuthority:h.config.depositAuthority.toBase58(),
      withdrawAuthority:h.config.withdrawAuthority.toBase58(),
      oracleMode:h.config.oracleMode,oracleAuthority:h.oracle.authority.toBase58(),
      lastOracleUpdateSlot:h.oracle.lastUpdateSlot.toString(),oracleSequence:h.oracle.sequence.toString(),
      midpriceRaw:h.getMidprice(),spreadBps:h.getSpreadBps(),fee:cast(h.resolveFee()),
      seed:h.config.seed.toString(),addresses:cast(h.addresses),vaults:[x,y],mints,
      risk:cast(risk),activeCurveSlots:h.getActiveCurveSlots()};
    pools.push(record);
  }
  const output={observedAtUtc:new Date().toISOString(),genesis,program,
    deploySlot:JSON.parse(fs.readFileSync(path.join(__dirname,'hadron-current-program.json'))).lastDeploySlot,
    sdk:{package:'@hadron-fi/sdk-v2',version:'0.1.9'},noTransactions:true,pools};
  fs.writeFileSync(path.join(__dirname,'hadron-live-pools.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({observedAtUtc:output.observedAtUtc,deploySlot:output.deploySlot,
    pools:pools.map(p=>({label:p.label,poolState:p.poolState,vaults:p.vaults.map(v=>({raw:v.raw,mint:v.mint,slot:v.slot})),midpriceRaw:p.midpriceRaw,spreadBps:p.spreadBps,fee:p.fee}))}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
