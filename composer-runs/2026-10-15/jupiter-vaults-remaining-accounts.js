// Read-only current-binary tests for Vaults remaining-account/oracle binding.
const {Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction} = require("/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js");
const connection = new Connection(process.env.SOLANA_RPC, "finalized");
const program = new PublicKey("jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi");
const sourceSignature = "N7RNYhPJiXyu9KW1kfnP7HZPmzEpL6Wz13Euwoct4XxkLYjxLMJp1tXb8QJyQbmESxWNyiGzUw7Cyis7YtWUiRj";
const alternateSignature = "39hkwarq54CSXaSrqnuQNAT4xc8Q5gt4BSRaHt37wxSHbMdZq3BGcW2Lr2KYsmV7cZkApRCBhQrMAjVYf5j2xnbS";
const discriminator = Buffer.from([217,106,208,99,116,151,42,135]);
async function extract(signature) {
  const tx=await connection.getTransaction(signature,{commitment:"finalized",maxSupportedTransactionVersion:1});
  const lookups=tx.transaction.message.addressTableLookups||[]; const lookupAccounts=[];
  for(const item of lookups){const found=await connection.getAddressLookupTable(item.accountKey,{commitment:"finalized"}); if(!found.value)throw new Error(`missing LUT ${item.accountKey}`); lookupAccounts.push(found.value);}
  const keys=tx.transaction.message.getAccountKeys({accountKeysFromLookups:tx.meta.loadedAddresses});
  const all=keys.staticAccountKeys.concat(keys.accountKeysFromLookups?.writable||[],keys.accountKeysFromLookups?.readonly||[]);
  const compiled=tx.transaction.message.compiledInstructions.find(ix=>all[ix.programIdIndex].equals(program)&&Buffer.from(ix.data).subarray(0,8).equals(discriminator));
  if(!compiled)throw new Error(`operate missing in ${signature}`);
  return {tx,lookupAccounts,keys:compiled.accountKeyIndexes.map(index=>({pubkey:all[index],isSigner:tx.transaction.message.isAccountSigner(index),isWritable:tx.transaction.message.isAccountWritable(index)})),data:Buffer.from(compiled.data),payer:keys.staticAccountKeys[0]};
}
function dataFor(source, counts) {
  const data=Buffer.from(source); data.fill(0,8,40); data.writeBigInt64LE(1000n,24);
  if(counts){data[46]=counts[0];data[47]=counts[1];data[48]=counts[2];}
  return data;
}
async function simulate(name,base,data,mutate){
  const keys=base.keys.map(k=>({...k})); if(mutate)mutate(keys);
  const instruction=new TransactionInstruction({programId:program,keys,data});
  const message=new TransactionMessage({payerKey:base.payer,recentBlockhash:"11111111111111111111111111111111",instructions:[instruction]}).compileToV0Message(base.lookupAccounts);
  const encoded=Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
  const response=await connection._rpcRequest("simulateTransaction",[encoded,{encoding:"base64",sigVerify:false,replaceRecentBlockhash:true,innerInstructions:true}]);
  const value=response?.result?.value; return {case:name,err:value?.err,unitsConsumed:value?.unitsConsumed,logs:value?.logs,rpcError:response?.error};
}
(async()=>{
 const base=await extract(sourceSignature), foreign=await extract(alternateSignature);
 // Rebase the landed position to its current tick, as in the independently passing prior control.
 base.keys[13].pubkey=new PublicKey("HEVtoTQK7wPt7swXEeBDXX293N6gEYKqjHVek9juYUY6"); base.keys[14].pubkey=base.keys[13].pubkey;
 base.keys[15].pubkey=new PublicKey("GgzmHfGzacUsi4B7djXnkvUv3fc9Ws2ZWLqTYpwkjjzf"); base.keys[16].pubkey=base.keys[15].pubkey;
 const normal=dataFor(base.data,[1,1,2]); const results=[];
 results.push(await simulate("control",base,normal));
 results.push(await simulate("counts_too_large_2_1_2",base,dataFor(base.data,[2,1,2])));
 results.push(await simulate("counts_reclassify_1_2_1",base,dataFor(base.data,[1,2,1])));
 results.push(await simulate("counts_missing_oracle_0_1_2",base,dataFor(base.data,[0,1,2])));
 results.push(await simulate("counts_leave_extra_1_1_1",base,dataFor(base.data,[1,1,1])));
 results.push(await simulate("counts_extreme_255_0_0",base,dataFor(base.data,[255,0,0])));
 results.push(await simulate("oracle_source_as_branch",base,normal,k=>{k[35].pubkey=k[36].pubkey;}));
 results.push(await simulate("branch_as_oracle_source",base,normal,k=>{k[36].pubkey=k[35].pubkey;}));
 results.push(await simulate("tick_debt_as_oracle_source",base,normal,k=>{k[37].pubkey=k[35].pubkey;}));
 results.push(await simulate("duplicate_tick_debt",base,normal,k=>{k[38].pubkey=k[37].pubkey;}));
 results.push(await simulate("swap_tick_debt_order",base,normal,k=>{const a=k[37].pubkey;k[37].pubkey=k[38].pubkey;k[38].pubkey=a;}));
 results.push(await simulate("foreign_oracle_only",base,normal,k=>{k[10].pubkey=foreign.keys[10].pubkey;}));
 results.push(await simulate("foreign_oracle_with_valid_sources",base,dataFor(base.data,[2,1,2]),k=>{
   k[10].pubkey=foreign.keys[10].pubkey;
   k.splice(35,1,{...foreign.keys[35]},{...foreign.keys[36]});
 }));
 const compared={source:{vaultConfig:base.keys[6].pubkey.toBase58(),supplyMint:base.keys[8].pubkey.toBase58(),borrowMint:base.keys[9].pubkey.toBase58(),oracle:base.keys[10].pubkey.toBase58(),remaining:base.keys.slice(35).map(k=>k.pubkey.toBase58())},alternate:{vaultConfig:foreign.keys[6].pubkey.toBase58(),supplyMint:foreign.keys[8].pubkey.toBase58(),borrowMint:foreign.keys[9].pubkey.toBase58(),oracle:foreign.keys[10].pubkey.toBase58(),remaining:foreign.keys.slice(35).map(k=>k.pubkey.toBase58())}};
 process.stdout.write(JSON.stringify({program:program.toBase58(),sourceSignature,sourceSlot:base.tx.slot,alternateSignature,alternateSlot:foreign.tx.slot,accountCount:base.keys.length,remainingCounts:[1,1,2],compared,transport:"mainnet simulateTransaction only; no sendTransaction",results},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
