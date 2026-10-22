// Read-only current-binary ClaimV2 destination and repeat checks; never submits.
// Reproduce: node composer-runs/2026-10-15/locp-source-claim-destination-sim.js
const fs=require('fs'), path=require('path');
const MOD=path.join(__dirname,'kliquidity-sdk-official/node_modules');
const {PublicKey,Transaction,TransactionInstruction}=require(`${MOD}/@solana/web3.js`);
const RPC='https://api.mainnet-beta.solana.com';
const PROGRAM=new PublicKey('LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn');
const EVENT=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],PROGRAM)[0];
const MEMO=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const ESCROW='AHYBvim1ebpaTrKdhVg5svFTpuSrMCSF1D88K5F1r7pd';
const source=JSON.parse(fs.readFileSync(path.join(__dirname,'locp-source-current-state.json')));
const record=source.rows.find(r=>r.state.address===ESCROW);
const s=record.state;
const RECIPIENT=new PublicKey(s.recipient), OUTSIDER=new PublicKey(s.creator);
const DESTINATION=new PublicKey('3BRayUFLQ61BoHQENu2LyamLFJboBS67WLvVQmPNSMZs'); // creator-owned YZY ATA
const VAULT=new PublicKey(record.vault.address);
if(s.recipient===s.creator||record.vault.program!=='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')throw new Error('Wrong control state');
async function rpc(method,params){
  for(let i=0;i<7;i++){
    const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const body=await response.json();if(!body.error)return body.result;
    if(i===6)throw Error(`${method}: ${JSON.stringify(body.error)}`);
    await new Promise(resolve=>setTimeout(resolve,500*(i+1)));
  }
}
function meta(key,writable=false,signer=false){return{pubkey:key instanceof PublicKey?key:new PublicKey(key),isWritable:writable,isSigner:signer};}
function claimIx(signer,destination,max=1000000n){
  const amount=Buffer.alloc(8);amount.writeBigUInt64LE(max);
  return new TransactionInstruction({programId:PROGRAM,keys:[
    meta(ESCROW,true),meta(s.mint),meta(VAULT,true),meta(signer,true,true),meta(destination,true),
    meta(MEMO),meta(record.vault.program),meta(EVENT),meta(PROGRAM),
  ],data:Buffer.concat([Buffer.from([229,87,46,162,21,157,231,114]),amount,Buffer.from([0])])});
}
function values(accounts,addresses){
  return Object.fromEntries(addresses.map((address,i)=>{
    const value=accounts[i];if(!value)return[address,null];
    const data=Buffer.from(value.data[0],'base64');
    return[address,address===ESCROW?{totalClaimed:data.readBigUInt64LE(184).toString(),recipient:new PublicKey(data.subarray(8,40)).toBase58()}:data.readBigUInt64LE(64).toString()];
  }));
}
async function simulate(label,signer,instructions,addresses){
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const transaction=new Transaction({feePayer:signer,recentBlockhash:blockhash}).add(...instructions);
  const raw=transaction.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
  const result=await rpc('simulateTransaction',[raw,{encoding:'base64',commitment:'confirmed',sigVerify:false,replaceRecentBlockhash:true,accounts:{encoding:'base64',addresses}}]);
  return{label,signer:signer.toBase58(),serializedBytes:Buffer.from(raw,'base64').length,err:result.value.err,
    unitsConsumed:result.value.unitsConsumed,logs:result.value.logs,
    post:result.value.err===null?values(result.value.accounts,addresses):null};
}
async function main(){
  const addresses=[ESCROW,VAULT.toBase58(),DESTINATION.toBase58()];
  const pre=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed'}]);
  if(!pre.value.every(Boolean))throw Error('Selected accounts absent');
  const destinationData=Buffer.from(pre.value[2].data[0],'base64');
  const destinationOwner=new PublicKey(destinationData.subarray(32,64)).toBase58();
  const destinationMint=new PublicKey(destinationData.subarray(0,32)).toBase58();
  if(destinationOwner!==s.creator||destinationMint!==s.mint)throw Error('Creator destination owner/mint mismatch');
  const tests=[];
  tests.push(await simulate('recipient_signed_creator_owned_destination_counterfactual',RECIPIENT,[claimIx(RECIPIENT,DESTINATION)],addresses));
  tests.push(await simulate('outsider_signed_creator_owned_destination',OUTSIDER,[claimIx(OUTSIDER,DESTINATION)],addresses));
  tests.push(await simulate('recipient_signed_source_destination_alias',RECIPIENT,[claimIx(RECIPIENT,VAULT)],addresses));
  tests.push(await simulate('recipient_signed_repeated_claims',RECIPIENT,[claimIx(RECIPIENT,DESTINATION),claimIx(RECIPIENT,DESTINATION)],addresses));
  const output={method:'simulateTransaction(sigVerify=false, replaceRecentBlockhash=true)',submittedTransactions:0,
    caveat:'Authorized recipient signatures are unsigned counterfactual controls; no private keys used.',
    program:PROGRAM.toBase58(),binarySha256:source.deployedBinarySha256,escrow:ESCROW,
    recipient:s.recipient,creator:s.creator,destination:DESTINATION.toBase58(),destinationOwner,destinationMint,
    preObservationSlot:pre.context.slot,pre:values(pre.value,addresses),tests};
  const out=path.join(__dirname,'locp-source-claim-destination-simulations.json');fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({out,pre:output.pre,tests:tests.map(t=>({label:t.label,err:t.err,post:t.post,logTail:t.logs?.slice(-5)}))},null,2));
}
main().catch(e=>{console.error(e);process.exit(1)});
