#!/usr/bin/env node
'use strict';
// Read-only census of native SOL and stake authorities directly tied to the
// current 3LWzk wrapper and 5UuMS bridge signer PDAs. Never sends a transaction.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PublicKey, StakeProgram } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const WRAPPER = '3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu';
const BRIDGE = '5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9';
const BRIDGE_SECOND = '3fovWrsrARaWdqJYnHRMntkSHUUmYsjYv6MFxEfoD4H8';
const PDA_MULTISIG = '5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi';
const PDA_BRIDGE = 'Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK';
const PDA_BRIDGE_SECOND = '4kNkeveV4WoKYmncSe4KoUW9umwQHSA8prH7acM1uxwB';
const SYSTEM = '11111111111111111111111111111111';
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const VOTE = 'Vote111111111111111111111111111111111111111';
const POSITIVE_STAKE_SAMPLE = 'FwqnvVsMQ9Txv9FWy23imxN2Rd6jL6WJcsGNDBgQvucR';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/).filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0,2)));
if (!env.RPC_URL) throw new Error('RPC_URL absent from local env file');
let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(env.RPC_URL, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id:++requestId,method,params}) });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}
function u64(data, offset) { return data.length >= offset+8 ? data.readBigUInt64LE(offset).toString() : null; }
function key(data, offset) { return data.length >= offset+32 ? new PublicKey(data.subarray(offset,offset+32)).toBase58() : null; }
function account(x) {
  if (!x) return null;
  const data = Buffer.from(x.data[0],'base64');
  return {owner:x.owner,lamports:x.lamports,executable:x.executable,dataLength:data.length,dataSha256:crypto.createHash('sha256').update(data).digest('hex'),dataHex:data.length <= 100 ? data.toString('hex') : undefined};
}
function parseStakeEntry(entry) {
  const x = entry.account, data=Buffer.from(x.data[0],'base64'), variant=data.length>=4?data.readUInt32LE(0):null;
  return {address:entry.pubkey,owner:x.owner,lamports:x.lamports,dataLength:data.length,variant,
    rentExemptReserveLamports:variant===1||variant===2?u64(data,4):null,
    staker:variant===1||variant===2?key(data,12):null,
    withdrawer:variant===1||variant===2?key(data,44):null,
    lockupCustodian:variant===1||variant===2?key(data,92):null,
    delegatedVoteAccount:variant===2?key(data,124):null,
    delegationStakeLamports:variant===2?u64(data,156):null};
}
async function scanStake(role, address, offset) {
  try {
    const result=await rpc('getProgramAccounts',[StakeProgram.programId.toBase58(),{commitment:'confirmed',encoding:'base64',withContext:true,dataSlice:{offset:0,length:200},filters:[{memcmp:{offset,bytes:address}}]}]);
    const entries=Array.isArray(result)?result:result.value;
    const slot=Array.isArray(result)?null:result.context?.slot;
    return {role,address,offset,slot,count:entries.length,accounts:entries.map(parseStakeEntry),rpcError:null};
  } catch (e) { return {role,address,offset,slot:null,count:null,accounts:null,rpcError:String(e.message)}; }
}
async function scanAuthorityClass(className, owner, authority, offset, extraFilters, dataLength, decoder) {
  const config={commitment:'confirmed',encoding:'base64',withContext:true,dataSlice:{offset:0,length:dataLength},filters:[...extraFilters,{memcmp:{offset,bytes:authority}}]};
  try {
    const result=await rpc('getProgramAccounts',[owner,config]);
    const entries=Array.isArray(result)?result:result.value;
    const slot=Array.isArray(result)?null:result.context?.slot;
    return {className,owner,authority,offset,method:'getProgramAccounts',slot,pages:1,count:entries.length,accounts:entries.map(row=>decoder(row)),rpcError:null};
  } catch(e) {
    if(!String(e.message).includes('Too many accounts requested')) return {className,owner,authority,offset,method:'getProgramAccounts',slot:null,count:null,accounts:null,rpcError:String(e.message)};
    try {
      const rows=[],slots=[],seen=new Set();let paginationKey=null,pages=0;
      do {
        const result=await rpc('getProgramAccountsV2',[owner,{...config,limit:1000,...(paginationKey?{paginationKey}:{})}]);
        const page=result.value||result;
        if(!Array.isArray(page.accounts)) throw new Error('V2 response lacks accounts array');
        slots.push(result.context?.slot??null);
        for(const row of page.accounts){if(seen.has(row.pubkey)) throw new Error(`duplicate account across pages ${row.pubkey}`);seen.add(row.pubkey);rows.push(row);}
        paginationKey=page.paginationKey||null;
        pages++;
        if(owner===SYSTEM && paginationKey && pages>=2){
          return {className,owner,authority,offset,method:'getProgramAccountsV2',slot:slots[0]??null,slots,pages,count:null,sampledMatchingCount:rows.length,accounts:rows.map(row=>decoder(row)),complete:false,rpcError:'System-owned nonce census incomplete: getProgramAccounts rejects the filtered query; V2 returned a paginationKey after two pages with zero or partial matching rows, so its cursor traverses a larger underlying program account set.',initialGetProgramAccountsError:String(e.message)};
        }
        if(pages>10000) throw new Error('V2 pagination guard exceeded');
      }while(paginationKey);
      return {className,owner,authority,offset,method:'getProgramAccountsV2',slot:slots[0]??null,slots,pages,count:rows.length,accounts:rows.map(row=>decoder(row)),complete:true,rpcError:null,initialGetProgramAccountsError:String(e.message)};
    }catch(v2e){return {className,owner,authority,offset,method:'getProgramAccountsV2',slot:null,count:null,accounts:null,rpcError:String(v2e.message),initialGetProgramAccountsError:String(e.message)};}
  }
}
function parseNonceEntry(row) {
  const x=row.account, data=Buffer.from(x.data[0],'base64');
  return {address:row.pubkey,lamports:x.lamports,owner:x.owner,version:data.length>=4?data.readUInt32LE(0):null,state:data.length>=8?data.readUInt32LE(4):null,authority:key(data,8)};
}
function parseVoteEntry(row) {
  const x=row.account, data=Buffer.from(x.data[0],'base64');
  return {address:row.pubkey,lamports:x.lamports,owner:x.owner,version:data.length>=4?data.readUInt32LE(0):null,nodePubkey:key(data,4),authorizedWithdrawer:key(data,36)};
}
function parseBufferEntry(row) {
  const x=row.account, data=Buffer.from(x.data[0],'base64');
  return {address:row.pubkey,lamports:x.lamports,owner:x.owner,loaderStateVariant:data.length>=4?data.readUInt32LE(0):null,authorityOptionTag:data.length>=5?data[4]:null,authority:key(data,5)};
}
async function main() {
  const derivations={
    multisig: (()=>{const [p,b]=PublicKey.findProgramAddressSync([Buffer.from('multisig')],new PublicKey(WRAPPER));return {address:p.toBase58(),bump:b,verified:p.toBase58()===PDA_MULTISIG};})(),
    bridge: (()=>{const [p,b]=PublicKey.findProgramAddressSync([Buffer.from('bridge')],new PublicKey(BRIDGE));return {address:p.toBase58(),bump:b,verified:p.toBase58()===PDA_BRIDGE};})(),
    bridgeSecond: (()=>{const [p,b]=PublicKey.findProgramAddressSync([Buffer.from('bridge')],new PublicKey(BRIDGE_SECOND));return {address:p.toBase58(),bump:b,verified:p.toBase58()===PDA_BRIDGE_SECOND};})()
  };
  const directAddresses=[PDA_MULTISIG,PDA_BRIDGE,PDA_BRIDGE_SECOND,WRAPPER,BRIDGE,BRIDGE_SECOND];
  const mainAccounts=await rpc('getMultipleAccounts',[directAddresses,{encoding:'base64',commitment:'confirmed'}]);
  const directAccounts=Object.fromEntries(directAddresses.map((address,i)=>[address,account(mainAccounts.value[i])]));
  const stakeScans=await Promise.all([
    scanStake('staker',PDA_MULTISIG,12),scanStake('withdrawer',PDA_MULTISIG,44),
    scanStake('staker',PDA_BRIDGE,12),scanStake('withdrawer',PDA_BRIDGE,44),
    scanStake('staker',PDA_BRIDGE_SECOND,12),scanStake('withdrawer',PDA_BRIDGE_SECOND,44)
  ]);
  const uniqueStake=new Map();
  for(const scan of stakeScans) for(const a of scan.accounts||[]) uniqueStake.set(a.address,a);
  const filteredFalsePositives=stakeScans.filter(s=>s.accounts).flatMap(s=>s.accounts.filter(a=>a[s.role]!==s.address).map(a=>({scanRole:s.role,scanAddress:s.address,account:a.address,decodedAuthority:a[s.role]})));
  const sampleRaw=await rpc('getAccountInfo',[POSITIVE_STAKE_SAMPLE,{encoding:'base64',commitment:'confirmed'}]);
  const sampleStake=sampleRaw.value?parseStakeEntry({pubkey:POSITIVE_STAKE_SAMPLE,account:sampleRaw.value}):null;
  const controlScan=sampleStake?.withdrawer?await scanStake('withdrawer',sampleStake.withdrawer,44):null;
  const stakeFilterControl={sampleSlot:sampleRaw.context.slot,sampleStake,controlScanSlot:controlScan?.slot??null,controlScanCount:controlScan?.count??null,controlScanError:controlScan?.rpcError??null,knownSampleReturned:controlScan?.accounts?.some(x=>x.address===POSITIVE_STAKE_SAMPLE)??false};
  const authorities=[PDA_MULTISIG,PDA_BRIDGE,PDA_BRIDGE_SECOND];
  const nativeAuthorityScans=await Promise.all(authorities.flatMap(authority=>[
    scanAuthorityClass('durableNonce',SYSTEM,authority,8,[{dataSize:80}],80,parseNonceEntry),
    scanAuthorityClass('voteWithdrawer',VOTE,authority,36,[],68,parseVoteEntry),
    scanAuthorityClass('upgradeableLoaderBuffer',LOADER,authority,5,[],37,parseBufferEntry)
  ]));
  const nativeAuthorityFalsePositives=nativeAuthorityScans.flatMap(s=>(s.accounts||[]).filter(a=>{
    if(s.className==='durableNonce') return a.authority!==s.authority || a.state!==1;
    if(s.className==='voteWithdrawer') return a.authorizedWithdrawer!==s.authority;
    return a.loaderStateVariant!==1 || a.authorityOptionTag!==1 || a.authority!==s.authority;
  }).map(a=>({className:s.className,authority:s.authority,address:a.address,decoded:a})));
  const voteList=await rpc('getVoteAccounts',[{commitment:'confirmed'}]);
  const sampleVoteAddress=voteList.current?.[0]?.votePubkey??voteList.delinquent?.[0]?.votePubkey??null;
  const voteRaw=sampleVoteAddress?await rpc('getAccountInfo',[sampleVoteAddress,{encoding:'base64',commitment:'confirmed'}]):null;
  const sampleVote=voteRaw?.value?parseVoteEntry({pubkey:sampleVoteAddress,account:voteRaw.value}):null;
  const voteControlScan=sampleVote?.authorizedWithdrawer?await scanAuthorityClass('voteWithdrawer',VOTE,sampleVote.authorizedWithdrawer,36,[],68,parseVoteEntry):null;
  const voteFilterControl={sampleVoteAddress,sampleSlot:voteRaw?.context?.slot??null,sampleVote,controlScanSlot:voteControlScan?.slot??null,controlScanCount:voteControlScan?.count??null,controlScanError:voteControlScan?.rpcError??null,knownSampleReturned:voteControlScan?.accounts?.some(x=>x.address===sampleVoteAddress)??false};
  const out={at:new Date().toISOString(),commitment:'confirmed',programs:{wrapper:WRAPPER,bridge:BRIDGE,bridgeSecond:BRIDGE_SECOND,stake:StakeProgram.programId.toBase58(),vote:VOTE,system:SYSTEM,loader:LOADER},derivations,
    directAccountSlot:mainAccounts.context.slot,directAccounts,stakeScans,
    uniqueStakeCount:uniqueStake.size,uniqueStakeAccounts:[...uniqueStake.values()].sort((a,b)=>a.address.localeCompare(b.address)),filteredFalsePositives,stakeFilterControl,nativeAuthorityScans,nativeAuthorityFalsePositives,voteFilterControl,
    inferenceNote:'getProgramAccounts filters all live Stake-program-owned accounts by exact 32-byte authority field. Complete only if each matching scan returned successfully at its observed slot. The generic wrapper signs only the multisig PDA in the tested path; the two bridge PDAs are program state/token authorities, not wrapper CPI signers.'};
  fs.writeFileSync(path.join(DIR,'5uums-surface-native.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({at:out.at,directAccountSlot:out.directAccountSlot,derivations,directAccounts,stakeScans:stakeScans.map(({role,address,offset,slot,count,rpcError})=>({role,address,offset,slot,count,rpcError})),uniqueStakeCount:out.uniqueStakeCount,uniqueStakeAccounts:out.uniqueStakeAccounts,filteredFalsePositives,stakeFilterControl:{...stakeFilterControl,sampleStake:sampleStake?{address:sampleStake.address,withdrawer:sampleStake.withdrawer,variant:sampleStake.variant}:null},nativeAuthorityScans:nativeAuthorityScans.map(({className,authority,slot,count,rpcError})=>({className,authority,slot,count,rpcError})),nativeAuthorityFalsePositives,voteFilterControl:{...voteFilterControl,sampleVote:sampleVote?{address:sampleVote.address,authorizedWithdrawer:sampleVote.authorizedWithdrawer,version:sampleVote.version}:null}},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
