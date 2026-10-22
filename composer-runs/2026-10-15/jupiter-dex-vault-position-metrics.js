#!/usr/bin/env node
// Current-state activity/health proxy for DEX-peg vault positions. Read-only.
const fs=require('fs');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection,PublicKey}=require(modules+'@solana/web3.js');
const {BorshAccountsCoder}=require(modules+'@coral-xyz/anchor');
const bs58m=require(modules+'bs58'),bs58=bs58m.default||bs58m;
const e=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const conn=new Connection(e.HEAVY_RPC_URL||e.RPC_URL,'confirmed');
const root=__dirname,idls='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl';
const vaults=new PublicKey('jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi');
const idl=JSON.parse(fs.readFileSync(`${idls}/vaults.json`,'utf8'));
const coder=new BorshAccountsCoder(idl);
const discriminator=Buffer.from(idl.accounts.find(x=>x.name==='Position').discriminator);
async function main(){
 const census=JSON.parse(fs.readFileSync(`${root}/jupiter-dex-peg-path-census.json`));
 const rows=[];
 for(const p of census.paths){
  const id=Buffer.alloc(2);id.writeUInt16LE(p.vaultId);
  const accounts=await conn.getProgramAccounts(vaults,{commitment:'confirmed',filters:[
   {dataSize:71},{memcmp:{offset:0,bytes:bs58.encode(discriminator)}},
   {memcmp:{offset:8,bytes:bs58.encode(id)}}]});
  const positions=accounts.map(a=>{
   const d=coder.decode('Position',a.account.data);
   return {address:a.pubkey.toBase58(),nftId:d.nft_id,tick:d.tick,
    tickId:d.tick_id,supplyRaw:d.supply_amount.toString(),
    dustDebtRaw:d.dust_debt_amount.toString(),supplyOnly:d.is_supply_only_position};
  }).sort((a,b)=>BigInt(a.supplyRaw)>BigInt(b.supplyRaw)?-1:1);
  rows.push({vaultId:p.vaultId,positions});
  console.log(JSON.stringify({vaultId:p.vaultId,count:positions.length,
   top:positions.slice(0,5).map(x=>({supplyRaw:x.supplyRaw,tick:x.tick,
    supplyOnly:x.supplyOnly}))}));
 }
 fs.writeFileSync(`${root}/jupiter-dex-vault-position-metrics.json`,
  JSON.stringify({generatedAt:new Date().toISOString(),scope:'read-only current mainnet getProgramAccounts',
   rows},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
