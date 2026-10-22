#!/usr/bin/env node
// Read-only Token-2022 mint-extension inventory for the exact 21 selected Locp proofs.
'use strict';
const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..', '2026-10-15');
const MOD = path.join(BASE, 'kliquidity-sdk-official', 'node_modules');
const {PublicKey} = require(`${MOD}/@solana/web3.js`);
const spl = require(`${MOD}/@solana/spl-token`);
const RPC_ENV = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
const EXPECTED_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
function parseEnv(file) { const out={}; for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v[0]==='"'&&v.at(-1)==='"')||(v[0]==="'"&&v.at(-1)==="'"))v=v.slice(1,-1);out[m[1]]=v;}return out; }
const env=parseEnv(RPC_ENV), endpoint=env.RPC||env.SOLANA_RPC_URL||env.FLUX_RPC_A;
let id=0; async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(45000)});const b=await r.json();if(b.error)throw Error(`${method}: ${b.error.message}`);return b.result;}
function publicKey(value){return value ? String(value) : null;}
async function main(){
  const genesisHash=await rpc('getGenesisHash',[]);if(genesisHash!==EXPECTED_GENESIS)throw Error(`wrong genesis ${genesisHash}`);
  const current=JSON.parse(fs.readFileSync(path.join(__dirname,'locp-current-refresh.json')));
  const rows=current.exact21Proofs.rows.filter(row=>row.tokenProgram===spl.TOKEN_2022_PROGRAM_ID.toBase58());
  const mints=[...new Set(rows.map(row=>row.mint))];
  const result=await rpc('getMultipleAccounts',[mints,{encoding:'base64',commitment:'confirmed'}]);
  const inventory=mints.map((address,index)=>{
    const value=result.value[index],data=Buffer.from(value.data[0],'base64');
    const info={data,executable:value.executable,lamports:value.lamports,owner:new PublicKey(value.owner),rentEpoch:value.rentEpoch};
    const mint=spl.unpackMint(new PublicKey(address),info,spl.TOKEN_2022_PROGRAM_ID);
    const types=spl.getExtensionTypes(mint.tlvData);
    const permanent=spl.getPermanentDelegate(mint),hook=spl.getTransferHook(mint),fee=spl.getTransferFeeConfig(mint),close=spl.getMintCloseAuthority(mint),defaults=spl.getDefaultAccountState(mint);
    return{mint:address,symbols:[...new Set(rows.filter(row=>row.mint===address).map(row=>row.symbol))],escrowCount:rows.filter(row=>row.mint===address).length,
      decimals:mint.decimals,supply:mint.supply.toString(),mintAuthority:publicKey(mint.mintAuthority),freezeAuthority:publicKey(mint.freezeAuthority),
      extensionTypes:types.map(type=>spl.ExtensionType[type]??String(type)),
      permanentDelegate:publicKey(permanent?.delegate),transferHookProgramId:publicKey(hook?.programId),transferHookAuthority:publicKey(hook?.authority),
      mintCloseAuthority:publicKey(close?.closeAuthority),defaultAccountState:defaults?.state??null,
      transferFeeConfig:fee?{authority:publicKey(fee.transferFeeConfigAuthority),withdrawWithheldAuthority:publicKey(fee.withdrawWithheldAuthority),
        withheldAmount:String(fee.withheldAmount),older:{epoch:String(fee.olderTransferFee.epoch),maximumFee:String(fee.olderTransferFee.maximumFee),basisPoints:fee.olderTransferFee.transferFeeBasisPoints},
        newer:{epoch:String(fee.newerTransferFee.epoch),maximumFee:String(fee.newerTransferFee.maximumFee),basisPoints:fee.newerTransferFee.transferFeeBasisPoints}}:null};
  });
  const output={generatedAtUtc:new Date().toISOString(),network:'mainnet-beta',genesisHash,observationSlot:result.context.slot,
    scope:'Token-2022 mints used by the exact 21 selected Locp escrow proofs',readOnly:true,submittedTransactions:0,inventory};
  const out=path.join(__dirname,'locp-token2022-extensions.json');fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({out,observationSlot:output.observationSlot,inventory},null,2));
}
main().catch(error=>{console.error(error.stack||error);process.exit(1)});
