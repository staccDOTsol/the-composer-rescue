#!/usr/bin/env node
// Read-only current program, vault, and recent vault-outflow gate.
const fs = require('fs');
const crypto = require('crypto');
const {PublicKey} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const endpointRow = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8')
  .split(/\r?\n/).find(x => /^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if (!endpointRow) throw Error('SOLANA_RPC unavailable');
const endpoint = endpointRow.slice(endpointRow.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const program = 'STANDjrnkxme4tKsZSnW3WUQ9iKxbhJQj33dbW2F9sZ';
const vault = '3GzZn1Qyzc6xzCgDn83teJysBW2bMCsK6DcRNhksMNo4';
const authority = '64TDz8bnvNb6RwKmJxZ24sQLTwJGLdw3T6Bmqs2F8JpK';
const mint = 'DUSDt4AeLZHWYmcXnVGYdgAzjtzU5mXUVnTMdnSzAttM';
let id=0;
async function rpc(method,params) {
  for (let n=0;n<4;n++) {
    const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
    const body=await res.json();
    if(res.ok && !body.error) return body.result;
    if(n===3) throw Error(`${method}: ${body.error?.message || res.status}`);
    await new Promise(r=>setTimeout(r,400*(n+1)));
  }
}
function decodedAccount(a){return a&&{owner:a.owner,executable:a.executable,lamports:a.lamports,dataLength:Buffer.from(a.data[0],'base64').length};}
function balanceAt(tx,index){
  const before=tx.meta?.preTokenBalances?.find(x=>x.accountIndex===index);
  const after=tx.meta?.postTokenBalances?.find(x=>x.accountIndex===index);
  if(!before && !after)return null;
  const a=BigInt(after?.uiTokenAmount?.amount||'0'),b=BigInt(before?.uiTokenAmount?.amount||'0');
  return {before:b.toString(),after:a.toString(),delta:(a-b).toString(),mint:(after||before).mint};
}
async function main(){
  const snapshot=await rpc('getMultipleAccounts',[[program,vault,authority,mint],{encoding:'base64',commitment:'confirmed'}]);
  const [p,v,a,m]=snapshot.value;
  const pdat=Buffer.from(p.data[0],'base64');
  const programDataAddress=new PublicKey(pdat.subarray(4,36)).toBase58();
  const programData=(await rpc('getAccountInfo',[programDataAddress,{encoding:'base64',commitment:'confirmed'}])).value;
  const pd=Buffer.from(programData.data[0],'base64');
  const deploySlot=Number(pd.readBigUInt64LE(4));
  const upgradeAuthorityOption=pd.readUInt8(12);
  const upgradeAuthority=upgradeAuthorityOption===1?new PublicKey(pd.subarray(13,45)).toBase58():null;
  const elfOffset=pd.indexOf(Buffer.from([0x7f,0x45,0x4c,0x46]));
  if(elfOffset<16 || elfOffset>128)throw Error('expected deployed ELF header absent');
  const executable=pd.subarray(elfOffset);
  fs.writeFileSync(__dirname+'/stand-dusd-current.so',executable);
  const vaultData=Buffer.from(v.data[0],'base64');
  const vaultMint=new PublicKey(vaultData.subarray(0,32)).toBase58();
  const vaultAuthority=new PublicKey(vaultData.subarray(32,64)).toBase58();
  const vaultRaw=vaultData.readBigUInt64LE(64).toString();
  const rows=await rpc('getSignaturesForAddress',[vault,{limit:60,commitment:'confirmed'}]);
  const spends=[];let inspected=0;
  for(const row of rows){
    if(row.err)continue;
    const tx=await rpc('getTransaction',[row.signature,{encoding:'json',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
    if(!tx)continue; inspected++;
    const message=tx.transaction.message;
    const keys=[...message.accountKeys,...(tx.meta?.loadedAddresses?.writable||[]),...(tx.meta?.loadedAddresses?.readonly||[])];
    const ix=keys.indexOf(vault);
    if(ix<0)continue;
    const delta=balanceAt(tx,ix);
    if(!delta || BigInt(delta.delta)>=0n)continue;
    const logs=tx.meta?.logMessages||[];
    const signerCpi=logs.some(x=>x.includes(`Program ${program} invoke`));
    const tokenTransfer=(tx.meta?.innerInstructions||[]).flatMap(x=>x.instructions||[]).filter(i=>{
      const pid=keys[i.programIdIndex];return pid==='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'||pid==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    }).some(i=>i.accounts?.some(k=>keys[k]===vault));
    spends.push({signature:row.signature,slot:tx.slot,blockTime:tx.blockTime,delta,programInvoked:signerCpi,vaultTokenCpi:tokenTransfer});
    if(spends.length>=5)break;
  }
  const out={observedAt:new Date().toISOString(),network:'mainnet-beta',commitment:'confirmed',slot:snapshot.context.slot,program,programAccount:decodedAccount(p),programDataAddress,deploySlot,upgradeAuthority,programDataHeaderHex:pd.subarray(0,elfOffset).toString('hex'),elfOffset,binaryBytes:executable.length,binarySha256:crypto.createHash('sha256').update(executable).digest('hex'),vault,vaultAccount:decodedAccount(v),vaultMint,vaultAuthority,vaultRaw,vaultUi:Number(vaultRaw)/1e6,authority,authorityAccount:decodedAccount(a),mint,mintAccount:decodedAccount(m),signaturesListed:rows.length,receiptsInspected:inspected,recentSpends:spends};
  fs.writeFileSync(__dirname+'/stand-dusd-current-gate.json',JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({slot:out.slot,deploySlot,binarySha256:out.binarySha256,vaultRaw,vaultUi:out.vaultUi,vaultMint,vaultAuthority,authorityOwner:a.owner,signaturesListed:rows.length,receiptsInspected:inspected,recentSpends:spends}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
