#!/usr/bin/env node
// Recheck all nine bounded-census GRASS authorities and vaults on one RPC read.
const fs=require('fs'),path=require('path');
const bs58=require(path.join(__dirname,'kliquidity-sdk-official/node_modules/bs58'));
const DIR=__dirname,PROGRAM='EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();
  if(!r.ok||j.error)throw new Error(`${method}: ${JSON.stringify(j.error)}`);return j.result;}
async function main(){
  const source=JSON.parse(fs.readFileSync(path.join(DIR,'mainnet-token-authority-census.raw.json')));
  const groups=source.authorities.filter(x=>x.directExecutableOwner===PROGRAM);
  const pairs=groups.flatMap(x=>x.tokenAccounts.map(t=>({authority:x.authority,vault:t.address,
    censusUsdValue:t.usdValue,censusRawAmount:t.rawAmount,symbol:t.symbol})));
  const keys=pairs.flatMap(x=>[x.authority,x.vault]);
  const res=await rpc('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed'}]);
  const disc={'cb13d6dcdc9a1866':'StakingPool','8679c5d3859a5220':'RewardPool'};
  const rows=pairs.map((x,i)=>{const aa=res.value[2*i],va=res.value[2*i+1];
    const a=aa?Buffer.from(aa.data[0],'base64'):null,v=va?Buffer.from(va.data[0],'base64'):null;
    return {...x,authorityAccountOwner:aa?.owner,accountType:a?disc[a.subarray(0,8).toString('hex')]||'Unknown':null,
      authorityDataLength:a?.length,vaultAccountOwner:va?.owner,
      vaultMint:v?bs58.encode(v.subarray(0,32)):null,
      vaultTokenAuthority:v?bs58.encode(v.subarray(32,64)):null,
      liveRawAmount:v?v.readBigUInt64LE(64).toString():null,
      authorityMatches:v?bs58.encode(v.subarray(32,64))===x.authority:false};});
  const result={program:PROGRAM,slot:res.context.slot,observationTime:new Date().toISOString(),rows,
    counts:Object.fromEntries([...new Set(rows.map(x=>x.accountType))].map(t=>[t,rows.filter(x=>x.accountType===t).length])),
    grossCensusUsdValue:rows.reduce((s,x)=>s+x.censusUsdValue,0),
    grossCensusUsdByType:Object.fromEntries([...new Set(rows.map(x=>x.accountType))]
      .map(t=>[t,rows.filter(x=>x.accountType===t).reduce((s,x)=>s+x.censusUsdValue,0)]))};
  fs.writeFileSync(path.join(DIR,'paths-grass-custody-types.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify({slot:result.slot,counts:result.counts,grossCensusUsdByType:result.grossCensusUsdByType,
    rows:rows.map(({authority,vault,accountType,liveRawAmount,authorityMatches})=>({authority,vault,accountType,liveRawAmount,authorityMatches}))},null,2)+'\n');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
