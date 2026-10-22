#!/usr/bin/env node
// Read-only current-binary claim commission boundaries. Signatures are not verified.
const fs=require('fs');
const path=require('path');
const {PublicKey,Transaction,TransactionInstruction}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const PROGRAM='SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';
const CONFIG='4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw';
const VAULT='8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8';
const MINT='SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const GUARDIAN='DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr';
const AUTH='Hgbea5UFVXD3dQoL2mJbXLVnnFFRqyJJis9vfm69w5oQ';
const PAYER='5vwuHxvdfmiNWNXY38aLiroE9RBaXiVAft55vKMsUVaP';
const DEST='3Czrym7atZ31uWbNpXvQppzuVLu15Lztr7hmcbVDTSjo';
const EVENT='8rUTGg1XoyuvK9G64S7d37m3HtLZH24oPeMmXkpJH8ir';
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const PK=x=>new PublicKey(x);
const idl=JSON.parse(fs.readFileSync(path.join(__dirname,'official-sample-idl.json')));
const claim=idl.instructions.find(x=>x.name==='claim_guardian_commission');
async function rpc(method,params){
  const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const j=await r.json(); if(!r.ok||j.error)throw Error(`${method}: ${JSON.stringify(j.error||r.status)}`);return j.result;
}
function ix(overrides={},noAuthSigner=false){
  const values={guardian_pool:GUARDIAN,stake_config:CONFIG,authority:AUTH,stake_vault:VAULT,destination:DEST,
    mint:MINT,token_program:TOKEN,event_authority:EVENT,program:PROGRAM,...overrides};
  return new TransactionInstruction({programId:PK(PROGRAM),
    keys:claim.accounts.map(a=>({pubkey:PK(values[a.name]),isWritable:!!a.writable,
      isSigner:!!a.signer&&!(noAuthSigner&&a.name==='authority')})),data:Buffer.from(claim.discriminator)});
}
function tokenAmount(a){return a&&a.data[0]?Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null;}
function guardianAccrual(a){return a&&a.data[0]?(()=>{const b=Buffer.from(a.data[0],'base64');return (b.readBigUInt64LE(152)+(b.readBigUInt64LE(160)<<64n)).toString()})():null;}
async function one(name,instructions){
  const tx=new Transaction({feePayer:PK(PAYER),recentBlockhash:'11111111111111111111111111111111'});
  instructions.forEach(x=>tx.add(x));
  const b64=tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
  const r=await rpc('simulateTransaction',[b64,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,
    commitment:'confirmed',innerInstructions:true,accounts:{encoding:'base64',addresses:[VAULT,DEST,GUARDIAN]}}]);
  return {name,simulationSlot:r.context.slot,err:r.value.err,unitsConsumed:r.value.unitsConsumed,logs:r.value.logs,
    innerInstructions:r.value.innerInstructions,
    after:r.value.accounts?{vault:tokenAmount(r.value.accounts[0]),destination:tokenAmount(r.value.accounts[1]),
      guardianAccrued:guardianAccrual(r.value.accounts[2])}:null};
}
async function main(){
  const start=await rpc('getMultipleAccounts',[[VAULT,DEST,GUARDIAN],{encoding:'base64',commitment:'confirmed'}]);
  const cases=[];
  cases.push(await one('hypothetical_stored_authority_signer_zero_accrual',[ix()]));
  cases.push(await one('stored_authority_not_marked_signer',[ix({},true)]));
  cases.push(await one('wrong_signer_fee_payer',[ix({authority:PAYER})]));
  cases.push(await one('alias_destination_vault',[ix({destination:VAULT})]));
  cases.push(await one('repeat_claim_same_transaction',[ix(),ix()]));
  const out={generatedAt:new Date().toISOString(),noTransactionsSubmitted:true,caseSignatureVerification:false,
    accountingCaveat:'The baseline read and each simulation use different confirmed slots; compare the inner SPL transfer trace, not cross-slot token-balance differences.',
    currentSlot:start.context.slot,authorityIsOffCurve:true,sourceIdlCommit:'d7ae7b13a8fc280985d69244ea2c4eade30542a6',
    before:{vault:tokenAmount(start.value[0]),destination:tokenAmount(start.value[1]),
      guardianAccrued:guardianAccrual(start.value[2])},cases};
  fs.writeFileSync(path.join(__dirname,'commission-simulations.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({currentSlot:out.currentSlot,before:out.before,cases:cases.map(c=>({name:c.name,err:c.err,
    logs:c.logs.filter(l=>/Instruction:|Error Code:|Error Message:|failed:/.test(l)),after:c.after}))},null,2));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
