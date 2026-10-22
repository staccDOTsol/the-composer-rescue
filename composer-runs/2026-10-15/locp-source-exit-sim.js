// Read-only simulations of deployed Locp program exit gates. No sendTransaction.
// Reproduce: node composer-runs/2026-10-15/locp-source-exit-sim.js
const fs = require('fs');
const path = require('path');
const MOD = path.join(__dirname, 'kliquidity-sdk-official/node_modules');
const { PublicKey, Transaction, TransactionInstruction } = require(`${MOD}/@solana/web3.js`);
const { getAssociatedTokenAddressSync } = require(`${MOD}/@solana/spl-token`);

const RPC = 'https://api.mainnet-beta.solana.com';
const PROGRAM = new PublicKey('LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn');
const EVENT = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PROGRAM)[0];
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const ATTACKER = new PublicKey('FTNTD1rkpBZxkBqVfG17VduezXfgtQ6R6VR8sr2CSgNR');
const ESCROW = 'BtZ8jPfdN8mVmok3x55He1CMwdS1xWpXBTMTigsjVH3Q'; // WET, mode 1
const SOURCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'locp-source-current-state.json')));
const record = SOURCE.rows.find(row => row.state.address === ESCROW);
if (!record || record.state.cancelMode !== 1 || record.state.creator === record.state.recipient) throw new Error('Unexpected selected escrow state');

async function rpc(method, params) {
  for (let i=0; i<7; i++) {
    const res = await fetch(RPC, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const body = await res.json();
    if (!body.error) return body.result;
    if (i===6) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    await new Promise(resolve => setTimeout(resolve, 600 * (i+1)));
  }
}

function meta(address, writable=false, signer=false) {
  return {pubkey:address instanceof PublicKey ? address : new PublicKey(address), isWritable:writable, isSigner:signer};
}
function ix(discriminator, accounts, suffix=Buffer.alloc(0)) {
  return new TransactionInstruction({programId:PROGRAM, keys:accounts, data:Buffer.concat([Buffer.from(discriminator),suffix])});
}
function cancelIx(signer, creatorToken, recipientToken) {
  return ix([217,233,13,3,143,101,53,201],[
    meta(record.state.address,true),meta(record.state.mint,true),meta(record.vault.address,true),
    meta(creatorToken,true),meta(recipientToken,true),meta(record.state.creator,true),
    meta(signer,true,true),meta(MEMO),meta(record.vault.program),meta(EVENT),meta(PROGRAM),
  ],Buffer.from([0])); // Option<RemainingAccountsInfo>::None
}
function closeIx(signer, creatorToken, metadata) {
  return ix([221,185,95,135,136,67,252,87],[
    meta(record.state.address,true),meta(metadata,true),meta(record.state.mint,true),
    meta(record.vault.address,true),meta(creatorToken,true),meta(signer,true,true),
    meta(record.vault.program),meta(MEMO),meta(EVENT),meta(PROGRAM),
  ],Buffer.from([0]));
}
function updateIx(signer, metadata, newRecipient) {
  return ix([26,242,127,255,237,109,47,206],[
    meta(record.state.address,true),meta(metadata,true),meta(signer,true,true),
    meta(SYSTEM),meta(EVENT),meta(PROGRAM),
  ],Buffer.concat([new PublicKey(newRecipient).toBuffer(),Buffer.from([0])]));
}
function tokenAmount(value) {
  if (!value) return null;
  const data=Buffer.from(value.data[0],'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}
function escrowFields(value) {
  if (!value) return null;
  const data=Buffer.from(value.data[0],'base64');
  return data.length===296 ? {
    recipient:new PublicKey(data.subarray(8,40)).toBase58(),
    totalClaimed:data.readBigUInt64LE(184).toString(),
    cancelledAt:data.readBigUInt64LE(200).toString(),
  } : {length:data.length};
}
async function simulate(label, signer, instruction, addresses) {
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const tx=new Transaction({feePayer:signer,recentBlockhash:blockhash}).add(instruction);
  const raw=tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
  const result=await rpc('simulateTransaction',[raw,{
    encoding:'base64',commitment:'confirmed',replaceRecentBlockhash:true,sigVerify:false,
    accounts:{encoding:'base64',addresses},
  }]);
  return {label,signer:signer.toBase58(),serializedBytes:Buffer.from(raw,'base64').length,
    err:result.value.err,unitsConsumed:result.value.unitsConsumed,
    logs:result.value.logs,
    post:Object.fromEntries(addresses.map((address,i)=>[address,address===ESCROW?escrowFields(result.value.accounts[i]):tokenAmount(result.value.accounts[i])]))};
}
async function main() {
  const s=record.state, mint=new PublicKey(s.mint), tokenProgram=new PublicKey(record.vault.program);
  const creatorToken=getAssociatedTokenAddressSync(mint,new PublicKey(s.creator),true,tokenProgram);
  const recipientToken=getAssociatedTokenAddressSync(mint,new PublicKey(s.recipient),true,tokenProgram);
  const metadata=PublicKey.findProgramAddressSync([Buffer.from('escrow_metadata'),new PublicKey(ESCROW).toBuffer()],PROGRAM)[0];
  const addresses=[ESCROW,record.vault.address,creatorToken.toBase58(),recipientToken.toBase58()];
  const pre=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed'}]);
  if (!pre.value.every(Boolean)) throw new Error('Selected escrow/vault/payout account absent');
  if (s.creator===ATTACKER.toBase58() || s.recipient===ATTACKER.toBase58()) throw new Error('Attacker control not independent');
  const tests=[];
  tests.push(await simulate('cancel_creator_counterfactual_positive',new PublicKey(s.creator),cancelIx(s.creator,creatorToken,recipientToken),addresses));
  tests.push(await simulate('cancel_outsider',ATTACKER,cancelIx(ATTACKER,creatorToken,recipientToken),addresses));
  tests.push(await simulate('cancel_creator_wrong_payout_owner',new PublicKey(s.creator),cancelIx(s.creator,recipientToken,recipientToken),addresses));
  tests.push(await simulate('close_creator_before_full_claim',new PublicKey(s.creator),closeIx(s.creator,creatorToken,metadata),addresses));
  tests.push(await simulate('close_outsider',ATTACKER,closeIx(ATTACKER,creatorToken,metadata),addresses));
  // Optional metadata represented by program ID with no email update.
  tests.push(await simulate('update_recipient_creator_counterfactual_positive',new PublicKey(s.creator),updateIx(s.creator,PROGRAM,ATTACKER),addresses));
  tests.push(await simulate('update_recipient_outsider',ATTACKER,updateIx(ATTACKER,PROGRAM,ATTACKER),addresses));
  const out={method:'simulateTransaction(sigVerify=false, replaceRecentBlockhash=true)',submittedTransactions:0,
    caveat:'Positive controls use unsigned counterfactual creator signatures; they prove program behavior only, not key access.',
    deployedProgram:PROGRAM.toBase58(),escrow:ESCROW,mint:s.mint,cancelMode:s.cancelMode,updateRecipientMode:s.updateRecipientMode,
    creator:s.creator,recipient:s.recipient,outsider:ATTACKER.toBase58(),eventAuthority:EVENT.toBase58(),
    creatorToken:creatorToken.toBase58(),recipientToken:recipientToken.toBase58(),metadata:metadata.toBase58(),
    preObservationSlot:pre.context.slot,
    pre:Object.fromEntries(addresses.map((address,i)=>[address,address===ESCROW?escrowFields(pre.value[i]):tokenAmount(pre.value[i])])),tests};
  const outPath=path.join(__dirname,'locp-source-exit-simulations.json');
  fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({path:outPath,escrow:ESCROW,pre:out.pre,tests:tests.map(t=>({label:t.label,err:t.err,unitsConsumed:t.unitsConsumed,post:t.post,logTail:t.logs?.slice(-8)}))},null,2));
}
main().catch(error=>{console.error(error);process.exit(1)});
