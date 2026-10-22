// Read-only current-state DAMM v1 balanced LP exit/account-alias/composition simulations.
const fs=require('fs');
const {Connection,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const spl=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const root='/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/';
const outputPath=root+'damm-v1-balanced-exit-simulation-resume.json';
const damm=new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');
const vaultProgram=new PublicKey('24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi');
const tokenProgram=spl.TOKEN_PROGRAM_ID;
const payer=new PublicKey('EKKhYjLqhefy16bQrpGbysxqRexZP8nXVcTTmHTzc4fz');
const disc=Buffer.from([133,109,44,179,56,238,114,33]);
const amount=info=>info&&info.owner.equals(tokenProgram)&&info.data.length>=72?info.data.readBigUInt64LE(64):null;
function makeData(q){const b=Buffer.alloc(32);disc.copy(b);b.writeBigUInt64LE(q,8);return b;}
function makeIx(a,data){return new TransactionInstruction({programId:damm,data,keys:a.map((pubkey,i)=>({pubkey,isWritable:i<=12,isSigner:i===13}))});}
async function simulate(rpcUrl,instructions,monitor,blockhash){const msg=new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions}).compileToV0Message();const tx=new VersionedTransaction(msg);const body={jsonrpc:'2.0',id:1,method:'simulateTransaction',params:[Buffer.from(tx.serialize()).toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',innerInstructions:true,accounts:{encoding:'base64',addresses:monitor.map(x=>x.toBase58())}}]};const j=await (await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();if(j.error)return{transportError:j.error};const post={};monitor.forEach((k,i)=>{const e=j.result.value.accounts?.[i];post[k.toBase58()]=e?.data?amount({owner:new PublicKey(e.owner),data:Buffer.from(e.data[0],'base64')})?.toString()??null:null});return{slot:j.result.context.slot,err:j.result.value.err,unitsConsumed:j.result.value.unitsConsumed,logs:j.result.value.logs,innerInstructions:j.result.value.innerInstructions,post};}
async function main(){
 const connection=new Connection(process.env.RPC_URL,'confirmed');const census=JSON.parse(fs.readFileSync(root+'damm-v1-integration-census-resume.json'));
 let seed;
 for(const p of census.pools.slice(0,30)){
  const largest=await connection.getTokenLargestAccounts(new PublicKey(p.lpMint),'confirmed');
  for(const row of largest.value){if(BigInt(row.amount)<1000n)continue;const info=await connection.getAccountInfo(row.address,'confirmed');if(!info)continue;const acc=spl.unpackAccount(row.address,info);if(!PublicKey.isOnCurve(acc.owner))continue;seed={p,lpAccount:row.address,owner:acc.owner,lpAmount:acc.amount};break;}if(seed)break;
 }
 if(!seed)throw new Error('No on-curve LP holder found in first 30 sampled pools');
 const p=seed.p, a=p.legs[0], b=p.legs[1];const userA=spl.getAssociatedTokenAddressSync(new PublicKey(a.mint),seed.owner);const userB=spl.getAssociatedTokenAddressSync(new PublicKey(b.mint),seed.owner);
 const accounts=[new PublicKey(p.pool),new PublicKey(p.lpMint),seed.lpAccount,new PublicKey(a.vaultLp),new PublicKey(b.vaultLp),new PublicKey(a.vault),new PublicKey(b.vault),new PublicKey(a.vaultState.lpMint),new PublicKey(b.vaultState.lpMint),new PublicKey(a.vaultState.tokenVault),new PublicKey(b.vaultState.tokenVault),userA,userB,seed.owner,vaultProgram,tokenProgram];
 const q=seed.lpAmount/10000n>0n?seed.lpAmount/10000n:1n,data=makeData(q);
 const create=[spl.createAssociatedTokenAccountIdempotentInstruction(payer,userA,seed.owner,new PublicKey(a.mint)),spl.createAssociatedTokenAccountIdempotentInstruction(payer,userB,seed.owner,new PublicKey(b.mint))];
 const pre=await connection.getMultipleAccountsInfoAndContext(accounts,'confirmed');const before=Object.fromEntries(accounts.map((k,i)=>[k.toBase58(),amount(pre.value[i])?.toString()??null]));const monitor=[...new Map(accounts.slice(2,13).map(x=>[x.toBase58(),x])).values()];const blockhash=(await connection.getLatestBlockhash('confirmed')).blockhash;
 const cases=[
  {name:'baseline_balanced_exit',count:1,mutate:a=>a},
  {name:'same_transaction_double_balanced_exit',count:2,mutate:a=>a},
  {name:'wrong_lp_mint',count:1,mutate:a=>{a[1]=a[7];return a;}},
  {name:'user_lp_is_pool_vault_lp',count:1,mutate:a=>{a[2]=a[3];return a;}},
  {name:'wrong_a_vault',count:1,mutate:a=>{a[5]=a[6];return a;}},
  {name:'a_token_vault_is_b_token_vault',count:1,mutate:a=>{a[9]=a[10];return a;}},
  {name:'a_vault_lp_is_b_vault_lp',count:1,mutate:a=>{a[3]=a[4];return a;}},
  {name:'user_a_is_user_b',count:1,mutate:a=>{a[11]=a[12];return a;}},
  {name:'vault_program_is_damm',count:1,mutate:a=>{a[14]=damm;return a;}},
  {name:'user_is_payer_not_lp_owner',count:1,mutate:a=>{a[13]=payer;return a;}},
 ];
 const outcomes=[];for(const c of cases){const ac=c.mutate([...accounts]);const ix=makeIx(ac,data);const r=await simulate(process.env.RPC_URL,[...create,...Array(c.count).fill(ix)],monitor,blockhash);const deltas={};for(const k of monitor){const s=k.toBase58();deltas[s]=before[s]!==null&&r.post?.[s]!==null?(BigInt(r.post[s])-BigInt(before[s])).toString():null;}outcomes.push({name:c.name,accounts:ac.map(x=>x.toBase58()),result:{...r,deltas}});}
 const output={timestamp:new Date().toISOString(),program:damm.toBase58(),seed:{pool:p.pool,lpMint:p.lpMint,userPoolLp:seed.lpAccount.toBase58(),owner:seed.owner.toBase58(),holderLpRaw:seed.lpAmount.toString(),exitLpRaw:q.toString(),userA:userA.toBase58(),userB:userB.toBase58()},preSlot:pre.context.slot,before,outcomes};fs.writeFileSync(outputPath,JSON.stringify(output,null,2));console.log(JSON.stringify({outputPath,seed:output.seed,outcomes:outcomes.map(x=>({name:x.name,err:x.result.err||x.result.transportError,units:x.result.unitsConsumed,deltas:x.result.deltas,tail:x.result.logs?.slice(-6)}))},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
