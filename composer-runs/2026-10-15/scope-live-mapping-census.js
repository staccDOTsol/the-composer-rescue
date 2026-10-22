const fs = require('fs');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split('\n').filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
const scope = 'HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ';
const mappingSize = 29704;
const ammTypes = {13:'OrcaWhirlpoolAtoB',14:'OrcaWhirlpoolBtoA',15:'RaydiumClmmAtoB',16:'RaydiumClmmBtoA',18:'MeteoraDlmmAtoB',19:'MeteoraDlmmBtoA'};
async function rpc(method, params) {
  const response = await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const obj = await response.json();
  if (obj.error) throw Error(JSON.stringify(obj.error));
  return obj.result;
}
const key = b => new PublicKey(b).toBase58();
async function main() {
  const result = await rpc('getProgramAccounts',[scope,{encoding:'base64',withContext:true,filters:[{dataSize:mappingSize}],commitment:'confirmed'}]);
  const output = {observedAt:new Date().toISOString(),slot:result.context.slot,scopeProgram:scope,mappingSize,totalMappings:result.value.length,mappings:[]};
  for (const record of result.value) {
    const d=Buffer.from(record.account.data[0],'base64');
    const entries=[];
    for(let i=0;i<512;i++) {
      const type=d[8+16384+i]&127;
      if (type in ammTypes) entries.push({index:i,type:ammTypes[type],pool:key(d.subarray(8+i*32,8+(i+1)*32)),frozen:!!(d[8+16384+i]&128),refPriceIndex:d.readUInt16LE(8+16384+512+1024+512+i*2)});
    }
    output.mappings.push({address:record.pubkey,ammEntries:entries});
  }
  const heads=await rpc('getProgramAccounts',[scope,{encoding:'base64',withContext:true,dataSlice:{offset:0,length:72},commitment:'confirmed'}]);
  const byMapping=new Map(output.mappings.map(m=>[m.address,m]));
  output.scopeOwnedAccountCount=heads.value.length;
  for(const record of heads.value){
    const d=Buffer.from(record.account.data[0],'base64');
    if(d.length<72) continue;
    const at8=key(d.subarray(8,40));
    if(byMapping.has(at8)&&record.pubkey!==at8) byMapping.get(at8).oraclePrices=record.pubkey;
  }
  for(const record of heads.value){
    const d=Buffer.from(record.account.data[0],'base64');
    if(d.length<72) continue;
    const at8=key(d.subarray(8,40)),at40=key(d.subarray(40,72));
    const mapping=byMapping.get(at40);
    if(mapping && at8===mapping.oraclePrices) mapping.oracleTwaps=record.pubkey;
  }
  output.totalAmmEntries=output.mappings.reduce((n,m)=>n+m.ammEntries.length,0);
  const path='composer-runs/2026-10-15/scope-live-mapping-census.json';
  fs.writeFileSync(path,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({slot:output.slot,totalMappings:output.totalMappings,totalAmmEntries:output.totalAmmEntries,feeds:output.mappings.filter(m=>m.ammEntries.length)}));
}
main().catch(e=>{console.error(String(e));process.exitCode=1});
