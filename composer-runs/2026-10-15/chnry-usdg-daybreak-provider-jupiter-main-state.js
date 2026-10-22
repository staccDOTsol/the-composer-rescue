#!/usr/bin/env node
// Read-only live Jupiter main/isolated USDG reserve, position, and flash-admin state.
const fs=require('fs');
const anchor=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58Module=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58=bs58Module.default||bs58Module;
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')&&x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
const liquidityIdl=JSON.parse(fs.readFileSync(`${__dirname}/jup6qf-onchain-idl.json`));
const flashIdl=JSON.parse(fs.readFileSync(`${__dirname}/jup6qf-onchain-flash-idl.json`));
const lc=new anchor.BorshAccountsCoder(liquidityIdl),fc=new anchor.BorshAccountsCoder(flashIdl);
let id=0;
async function rpc(method,params){let res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});let body=await res.json();if(body.error)throw Error(`${method}: ${body.error.code} ${body.error.message}`);return body.result}
function plain(v){if(typeof v==='bigint')return v.toString();if(v?.toBase58)return v.toBase58();if(v?.constructor?.name==='BN')return v.toString(10);if(Buffer.isBuffer(v))return v.toString('hex');if(Array.isArray(v))return v.map(plain);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)]));return v}
function decode(a,c,n){try{return a&&plain(c.decode(n,Buffer.from(a.data[0],'base64')))}catch(e){return {error:e.message}}}
async function main(){
 const groups=[
  {label:'Jupiter main',liquidity:'jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC',flash:'jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS',reserve:'G4KAenCBfybnZLtVe4LdNrmEtQoW3x93oTowFJUPSvx6',position:null,admin:'ALXWtv2P4GqH1B7Lq731joag52yRBRqmHV4naiXPTYWL'},
  {label:'Jupiter isolated Ethena',liquidity:'jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS',flash:'jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF',reserve:'EcKLyKWMJAUnsv3MMGGHrjVMDm9KtuCzdz8wNV3JpGsp',position:'956yZ1MQjnsG1H6oRQS218Ww8ne6o7VE2hYKAiv6dU7q',admin:'G1qKidJxv6dxBn7TDEx7KSbvovCJQkwzpXbAHQCZxhrn'},
 ];
 const out={observedAt:new Date().toISOString(),readOnly:true,rows:[]};
 for(const g of groups){
  if(!g.position){
   const m='2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH';
   const positions=await rpc('getProgramAccounts',[g.liquidity,{encoding:'base64',commitment:'confirmed',withContext:true,
    filters:[{memcmp:{offset:0,bytes:bs58.encode(Buffer.from([73,126,65,123,220,126,197,24]))}},{memcmp:{offset:40,bytes:m}}]}]);
   const decoded=positions.value.map(x=>({address:x.pubkey,state:decode(x.account,lc,'UserBorrowPosition')}));
   g.allPositions=decoded.map(x=>({address:x.address,protocol:x.state?.protocol,mint:x.state?.mint,amount:x.state?.amount,debt_ceiling:x.state?.debt_ceiling,max_debt_ceiling:x.state?.max_debt_ceiling,status:x.state?.status}));
   g.position=decoded.find(x=>x.state?.protocol===g.admin)?.address||null;
  }
  const first=await rpc('getMultipleAccounts',[[g.liquidity,g.flash,g.reserve,g.position||g.reserve,g.admin],{encoding:'base64',commitment:'confirmed'}]);
  const [lp,fp,r,p,a]=first.value;
  const reserve=decode(r,lc,'TokenReserve');
  const vaultAddr=reserve?.vault;
  const second=await rpc('getMultipleAccounts',[[vaultAddr],{encoding:'base64',commitment:'confirmed'}]);
  const vault=second.value[0];const vb=vault&&Buffer.from(vault.data[0],'base64');
  out.rows.push({...g,slot:first.context.slot,vaultSlot:second.context.slot,
   identities:{liquidityOwner:lp?.owner,liquidityExecutable:lp?.executable,flashOwner:fp?.owner,flashExecutable:fp?.executable,reserveOwner:r?.owner,positionOwner:p?.owner,adminOwner:a?.owner,vaultOwner:vault?.owner},
   reserve,position:g.position?decode(p,lc,'UserBorrowPosition'):null,adminState:decode(a,fc,'FlashloanAdmin'),
   vault:{address:vaultAddr,mint:vb?.length>=32?new anchor.web3.PublicKey(vb.subarray(0,32)).toBase58():null,authority:vb?.length>=64?new anchor.web3.PublicKey(vb.subarray(32,64)).toBase58():null,rawAmount:vb?.length>=72?vb.readBigUInt64LE(64).toString():null}});
 }
 const path=`${__dirname}/chnry-usdg-daybreak-provider-jupiter-main-state.json`;
 fs.writeFileSync(path,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({path,summary:out.rows.map(x=>({label:x.label,slot:x.slot,vault:x.vault,fee:x.adminState?.flashloan_fee,adminStatus:x.adminState?.status,positionMax:x.position?.max_debt_ceiling,positionStatus:x.position?.status}))},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
