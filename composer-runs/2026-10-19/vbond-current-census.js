#!/usr/bin/env node
// Read-only current mainnet census for Validator Bonds. No keys or RPC URL are recorded.
const fs = require('fs');
const path = require('path');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey} = require(modules + '@solana/web3.js');
const {BorshAccountsCoder} = require(modules + '@coral-xyz/anchor');
const bs58module = require(modules + 'bs58');
const bs58 = bs58module.default || bs58module;
const url = process.env.SOLANA_RPC;
if (!url) throw new Error('SOLANA_RPC is required');
const program = new PublicKey('vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4');
const idl = JSON.parse(fs.readFileSync(path.join(__dirname, 'vbond-composer-idl.json')));
const coder = new BorshAccountsCoder(idl);
let id = 0;
async function rpc(method, params) {
  const r = await fetch(url, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0', id:++id, method, params})});
  const j = await r.json();
  if (!r.ok || j.error) throw Error(`${method}: ${JSON.stringify(j.error || {status:r.status})}`);
  return j.result;
}
function disc(name) { return bs58.encode(Buffer.from(idl.accounts.find(a=>a.name===name).discriminator)); }
async function gpa(owner, filters, slice) {
  return rpc('getProgramAccounts', [owner.toBase58(), {commitment:'confirmed', encoding:'base64',
    withContext:true, filters, ...(slice?{dataSlice:slice}:{})}]);
}
function num(v) { return BigInt(v.toString()); }
function pk(v) { return v.toBase58(); }
function dec(name, row) { return coder.decode(name, Buffer.from(row.account.data[0], 'base64')); }
async function multiple(pubkeys) {
  const out = new Map();
  for (let i=0;i<pubkeys.length;i+=100) {
    const chunk=pubkeys.slice(i,i+100);
    const r=await rpc('getMultipleAccounts',[chunk,{commitment:'confirmed',encoding:'base64'}]);
    chunk.forEach((key,j)=>out.set(key,r.value[j]));
  }
  return out;
}
async function main() {
  const [epoch, configRows, settlementRows, requestRows] = await Promise.all([
    rpc('getEpochInfo',[{commitment:'confirmed'}]),
    gpa(program,[{memcmp:{offset:0,bytes:disc('Config')}}]),
    gpa(program,[{memcmp:{offset:0,bytes:disc('Settlement')}}]),
    gpa(program,[{memcmp:{offset:0,bytes:disc('WithdrawRequest')}}]),
  ]);
  const configs = new Map(configRows.value.map(row=>{
    const c=dec('Config',row);
    const [authority]=PublicKey.findProgramAddressSync([Buffer.from('bonds_authority'),new PublicKey(row.pubkey).toBuffer()],program);
    return [row.pubkey,{address:row.pubkey,bondsWithdrawerAuthority:pk(authority),
      paused:c.paused,operatorAuthority:pk(c.operator_authority),
      epochsToClaimSettlement:num(c.epochs_to_claim_settlement).toString(),
      withdrawLockupEpochs:num(c.withdraw_lockup_epochs).toString(),
      slotsToStartSettlementClaiming:num(c.slots_to_start_settlement_claiming).toString()}];
  }));
  const settlements=settlementRows.value.map(row=>{
    const s=dec('Settlement',row);
    const funded=num(s.lamports_funded), claimed=num(s.lamports_claimed);
    return {address:row.pubkey,bond:pk(s.bond),stakerAuthority:pk(s.staker_authority),
      fundedLamports:String(funded),claimedLamports:String(claimed),
      unclaimedFundedLamports:String(funded>claimed?funded-claimed:0n),
      epochCreatedFor:String(num(s.epoch_created_for)),slotCreatedAt:String(num(s.slot_created_at)),
      merkleRootHex:Buffer.from(s.merkle_root).toString('hex'),
      rentCollector:pk(s.rent_collector),splitRentCollector:s.split_rent_collector?pk(s.split_rent_collector):null,
      splitRentAmount:String(num(s.split_rent_amount)),accountLamports:String(row.account.lamports)};
  });
  const requests=requestRows.value.map(row=>{
    const w=dec('WithdrawRequest',row);
    const requested=num(w.requested_amount), withdrawn=num(w.withdrawn_amount);
    return {address:row.pubkey,bond:pk(w.bond),voteAccount:pk(w.vote_account),
      epoch:String(num(w.epoch)),requestedLamports:String(requested),withdrawnLamports:String(withdrawn),
      remainingLamports:String(requested>withdrawn?requested-withdrawn:0n)};
  });
  const bondKeys=[...new Set([...settlements.map(x=>x.bond),...requests.map(x=>x.bond)])];
  const bondAccts=await multiple(bondKeys);
  const bonds=new Map(bondKeys.map(key=>{
    const account=bondAccts.get(key);
    if(!account)return [key,null];
    const b=coder.decode('Bond',Buffer.from(account.data[0],'base64'));
    return [key,{config:pk(b.config),voteAccount:pk(b.vote_account),authority:pk(b.authority)}];
  }));
  for (const s of settlements) {
    const b=bonds.get(s.bond), c=b&&configs.get(b.config);
    s.config=b?.config||null;
    s.claimOpen=!!(c&&!c.paused&&BigInt(s.epochCreatedFor)+BigInt(c.epochsToClaimSettlement)>=BigInt(epoch.epoch)&&
      BigInt(s.slotCreatedAt)+BigInt(c.slotsToStartSettlementClaiming)<=BigInt(epoch.absoluteSlot));
  }
  for (const w of requests) {
    const b=bonds.get(w.bond), c=b&&configs.get(b.config);
    w.config=b?.config||null;
    w.bondAuthority=b?.authority||null;
    w.ready=!!(c&&!c.paused&&BigInt(w.epoch)+BigInt(c.withdrawLockupEpochs)<BigInt(epoch.epoch));
  }
  const stakeOwner=new PublicKey('Stake11111111111111111111111111111111111111');
  const custody=[];
  const availableStakeByConfigAndVote=new Map();
  for (const address of [...configs.keys()]) {
    const config=configs.get(address);
    if(!config)continue;
    const r=await gpa(stakeOwner,[{dataSize:200},{memcmp:{offset:44,bytes:config.bondsWithdrawerAuthority}}]);
    const lamports=r.value.reduce((s,row)=>s+BigInt(row.account.lamports),0n);
    custody.push({config:address,authority:config.bondsWithdrawerAuthority,slot:r.context.slot,
      count:r.value.length,lamports:String(lamports)});
    for(const row of r.value){
      const data=Buffer.from(row.account.data[0],'base64');
      if(data.readUInt32LE(0)!==2)continue;
      if(new PublicKey(data.subarray(12,44)).toBase58()!==config.bondsWithdrawerAuthority)continue;
      const vote=new PublicKey(data.subarray(124,156)).toBase58();
      const key=address+':'+vote;
      const prior=availableStakeByConfigAndVote.get(key);
      if(!prior||BigInt(row.account.lamports)>BigInt(prior.lamports))
        availableStakeByConfigAndVote.set(key,{address:row.pubkey,lamports:String(row.account.lamports)});
    }
  }
  const eligibleSettlements=settlements.filter(s=>s.claimOpen&&BigInt(s.unclaimedFundedLamports)>0n)
    .sort((a,b)=>BigInt(a.unclaimedFundedLamports)>BigInt(b.unclaimedFundedLamports)?-1:1);
  const eligibleRequests=requests.filter(w=>w.ready&&BigInt(w.remainingLamports)>0n)
    .sort((a,b)=>BigInt(a.remainingLamports)>BigInt(b.remainingLamports)?-1:1);
  const readyWithStake=eligibleRequests.map(w=>({...w,
    availableStake:availableStakeByConfigAndVote.get(w.config+':'+w.voteAccount)||null}))
    .filter(w=>w.availableStake).sort((a,b)=>BigInt(a.availableStake.lamports)>BigInt(b.availableStake.lamports)?-1:1);
  const out={generatedAt:new Date().toISOString(),program:pk(program),source:'confirmed mainnet-beta read-only RPC',
    slots:{epoch:epoch.absoluteSlot,configs:configRows.context.slot,settlements:settlementRows.context.slot,
      withdrawRequests:requestRows.context.slot},epoch:epoch.epoch,
    configCount:configs.size,configs:[...configs.values()],custody,
    totalCustodyLamports:String(custody.reduce((s,x)=>s+BigInt(x.lamports),0n)),
    settlementCount:settlements.length,claimOpenFundedCount:eligibleSettlements.length,
    claimOpenFundedLamports:String(eligibleSettlements.reduce((s,x)=>s+BigInt(x.unclaimedFundedLamports),0n)),
    topClaimOpenFunded:eligibleSettlements.slice(0,15),
    withdrawRequestCount:requests.length,readyUnfulfilledCount:eligibleRequests.length,
    topReadyUnfulfilled:eligibleRequests.slice(0,15),readyWithStakeCount:readyWithStake.length,
    topReadyWithStake:readyWithStake.slice(0,15)};
  fs.writeFileSync(path.join(__dirname,'vbond-current-census.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({slot:epoch.absoluteSlot,epoch:epoch.epoch,
    configCount:out.configCount,nonzeroCustody:custody.filter(c=>BigInt(c.lamports)>0n),
    totalCustodySol:Number(BigInt(out.totalCustodyLamports))/1e9,
    settlementCount:out.settlementCount,claimOpenFundedCount:out.claimOpenFundedCount,
    claimOpenFundedSol:Number(BigInt(out.claimOpenFundedLamports))/1e9,
    withdrawRequestCount:out.withdrawRequestCount,readyUnfulfilledCount:out.readyUnfulfilledCount,
    topSettlement:eligibleSettlements[0],topRequestWithStake:readyWithStake[0]},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
