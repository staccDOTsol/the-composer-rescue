// Read-only current-mainnet Solana v1 composition: zero-fee KLend USDC flash
// borrow -> Meteora DBC USDC/base round-trip(s) -> flash repay. Never submits.
const fs=require('fs'),crypto=require('crypto');
const MOD='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {Connection,PublicKey,TransactionInstruction}=require(`${MOD}/@solana/web3.js`);
const {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,ASSOCIATED_TOKEN_PROGRAM_ID}=require(`${MOD}/@solana/spl-token`);
const bs58=require(`${MOD}/bs58`);const {encodeV1}=require('./klend-v1-composition.js');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const conn=new Connection(env.HEAVY_RPC_URL||env.RPC_URL,'confirmed'),P=x=>new PublicKey(x);
const DBC=P('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'),KLEND=P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const TOKEN=P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),POOL_AUTH=P('FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM');
const SYSVAR_IX=P('Sysvar1nstructions1111111111111111111111111'),EVENT=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],DBC)[0];
const owner=P('FVWZsWaso2tzJHpxDbgmDUvrTAKmEti8JxcQ3wpgwnmR'),ownerUsdc=P('CLLqMsCoA95HmY6ZtwR5TRCBaXh9MjguNRDWmx8vqbrY');
const pool=P('ESuZK6cBK33eWC1cp9uwxRoxmfm5rHJ6Mzi6uyukeQup'),config=P('FbKf76ucsQssF7XZBuzScdJfugtsSKwZFYztKsMEhWZM');
const baseMint=P('CkFm8Gk8zAzMUW9NAMobHuQvfzSNT7W8HgM3PsJ8moon'),quoteMint=P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const baseVault=P('EHeZSurvebxvpST3Y3BxP3BdjUYHRNy2P69x67acNZF3'),quoteVault=P('9dN6iNyqBaLiFDUMgfgNuS4gqkgtQmPs3fqEZJ3AzKVK');
const SWAP2=Buffer.from([65,75,63,76,235,91,91,136]);
const CLAIM_CREATOR=Buffer.from([82,220,250,189,3,85,107,45]);
const sample=require('./kamino-flash-history.json').hits[0].transaction,msg=sample.transaction.message;
const all=[...msg.accountKeys,...sample.meta.loadedAddresses.writable,...sample.meta.loadedAddresses.readonly],head=msg.header;
const writable=i=>i<msg.accountKeys.length?(i<head.numRequiredSignatures?i<head.numRequiredSignatures-head.numReadonlySignedAccounts:i<msg.accountKeys.length-head.numReadonlyUnsignedAccounts):i<msg.accountKeys.length+sample.meta.loadedAddresses.writable.length;
const sampleIx=n=>{const x=msg.instructions[n];return new TransactionInstruction({programId:P(all[x.programIdIndex]),keys:x.accounts.map(i=>({pubkey:P(all[i]),isSigner:i<head.numRequiredSignatures,isWritable:writable(i)})),data:Buffer.from(bs58.decode(x.data))})};
const borrowTemplate=sampleIx(3),repayTemplate=sampleIx(13);
const flashSupply=borrowTemplate.keys[5].pubkey,flashFee=borrowTemplate.keys[7].pubkey,flashReserve=borrowTemplate.keys[3].pubkey;
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b};
const flashIx=(template,amount,repayIndex)=>{const keys=template.keys.map(x=>({...x}));keys[0].pubkey=owner;keys[6].pubkey=ownerUsdc;const data=Buffer.from(template.data);data.writeBigUInt64LE(BigInt(amount),8);if(repayIndex!==undefined)data[16]=repayIndex;return new TransactionInstruction({programId:KLEND,keys,data})};
function swapIx(baseAta,input,output,a0,a1,mode,mutation){let keys=[
  {pubkey:POOL_AUTH,isSigner:false,isWritable:false},{pubkey:config,isSigner:false,isWritable:false},{pubkey:pool,isSigner:false,isWritable:true},
  {pubkey:input,isSigner:false,isWritable:true},{pubkey:output,isSigner:false,isWritable:true},{pubkey:baseVault,isSigner:false,isWritable:true},{pubkey:quoteVault,isSigner:false,isWritable:true},
  {pubkey:baseMint,isSigner:false,isWritable:false},{pubkey:quoteMint,isSigner:false,isWritable:false},{pubkey:owner,isSigner:true,isWritable:false},
  {pubkey:TOKEN,isSigner:false,isWritable:false},{pubkey:TOKEN,isSigner:false,isWritable:false},{pubkey:DBC,isSigner:false,isWritable:false},
  {pubkey:EVENT,isSigner:false,isWritable:false},{pubkey:DBC,isSigner:false,isWritable:false},
];
  if(mutation==='swap_vault_order'){[keys[5],keys[6]]=[keys[6],keys[5]]}
  if(mutation==='alias_input_to_quote_vault')keys[3]={pubkey:quoteVault,isSigner:false,isWritable:true};
  return new TransactionInstruction({programId:DBC,keys,data:Buffer.concat([SWAP2,u64(a0),u64(a1),Buffer.from([mode])])});
}
function claimCreatorIx(baseAta,creator){return new TransactionInstruction({programId:DBC,keys:[
  {pubkey:POOL_AUTH,isSigner:false,isWritable:false},{pubkey:pool,isSigner:false,isWritable:true},
  {pubkey:baseAta,isSigner:false,isWritable:true},{pubkey:ownerUsdc,isSigner:false,isWritable:true},
  {pubkey:baseVault,isSigner:false,isWritable:true},{pubkey:quoteVault,isSigner:false,isWritable:true},
  {pubkey:baseMint,isSigner:false,isWritable:false},{pubkey:quoteMint,isSigner:false,isWritable:false},
  {pubkey:creator,isSigner:true,isWritable:false},{pubkey:TOKEN,isSigner:false,isWritable:false},
  {pubkey:TOKEN,isSigner:false,isWritable:false},{pubkey:EVENT,isSigner:false,isWritable:false},
  {pubkey:DBC,isSigner:false,isWritable:false},
],data:Buffer.concat([CLAIM_CREATOR,u64((1n<<64n)-1n),u64((1n<<64n)-1n)])})}
function tokenAmount(a){if(!a?.data)return null;const d=Buffer.from(a.data[0],'base64');return d.length>=72?d.readBigUInt64LE(64).toString():null}
function poolState(a){if(!a?.data)return null;const d=Buffer.from(a.data[0],'base64');return d.length===424?{baseReserve:d.readBigUInt64LE(232).toString(),quoteReserve:d.readBigUInt64LE(240).toString(),partnerBaseFee:d.readBigUInt64LE(264).toString(),partnerQuoteFee:d.readBigUInt64LE(272).toString(),creatorBaseFee:d.readBigUInt64LE(352).toString(),creatorQuoteFee:d.readBigUInt64LE(360).toString(),isMigrated:d[305]}:null}
async function main(){
  const infos=await conn.getMultipleAccountsInfoAndContext([baseMint,pool,config,baseVault,quoteVault,flashSupply,flashFee,flashReserve,ownerUsdc],'confirmed');
  const baseProgram=infos.value[0].owner;if(!baseProgram.equals(TOKEN))throw Error(`Selected base mint is not classic SPL: ${baseProgram}`);
  const creator=new PublicKey(infos.value[1].data.subarray(104,136));
  const baseAta=getAssociatedTokenAddressSync(baseMint,owner,false,baseProgram,ASSOCIATED_TOKEN_PROGRAM_ID);
  const baseAtaInfo=await conn.getAccountInfo(baseAta,'confirmed');
  const reserve=infos.value[7].data,available=reserve.readBigUInt64LE(224),flashLoanFeeSf=reserve.readBigUInt64LE(4904);
  if(flashLoanFeeSf!==0n)throw Error(`Selected KLend reserve is not zero fee: ${flashLoanFeeSf}`);
  const watched=[ownerUsdc,baseAta,flashSupply,flashFee,flashReserve,pool,baseVault,quoteVault];
  const before=await conn.getMultipleAccountsInfoAndContext(watched,'confirmed');
  const image=as=>({ownerUsdc:tokenAmount(as?.[0]),ownerBase:tokenAmount(as?.[1]),flashSupply:tokenAmount(as?.[2]),flashFee:tokenAmount(as?.[3]),flashReserveHash:as?.[4]?.data?crypto.createHash('sha256').update(Buffer.from(as[4].data[0],'base64')).digest('hex'):null,pool:poolState(as?.[5]),baseVault:tokenAmount(as?.[6]),quoteVault:tokenAmount(as?.[7])});
  const pre=image(before.value.map(a=>a&&({owner:a.owner.toBase58(),data:[a.data.toString('base64'),'base64']})));
  const createBase=createAssociatedTokenAccountIdempotentInstruction(owner,baseAta,owner,baseMint,baseProgram,ASSOCIATED_TOKEN_PROGRAM_ID);
  const cycle=n=>[swapIx(baseAta,ownerUsdc,baseAta,n,(1n<<64n)-1n,2),swapIx(baseAta,baseAta,ownerUsdc,n,0n,0)];
  const specs=[];
  const add=(name,borrow,body)=>specs.push([name,borrow,[flashIx(borrowTemplate,borrow),createBase,...body,flashIx(repayTemplate,borrow,0)]]);
  add('dust_base_1_flash_1',1n,cycle(1n));add('dust_base_2_flash_2',2n,cycle(2n));add('dust_base_10_flash_10',10n,cycle(10n));
  for(const n of [100n,1000n,10000n,100000n,500000n,999999n])add(`rounding_base_${n}`,1000000n,cycle(n));
  add('one_usdc_flash_base_1m',1000000n,cycle(1000000n));
  add('ninety_nine_percent_flash_small_dbc_roundtrip',available*99n/100n,cycle(1000000n));
  add('near_available_flash_small_dbc_roundtrip',available-1n,cycle(1000000n));
  add('exact_available_flash_small_dbc_roundtrip',available,cycle(1000000n));
  add('over_available_flash_small_dbc_roundtrip',available+1n,cycle(1000000n));
  add('two_dbc_roundtrips',1000000n,[...cycle(1000000n),...cycle(1000000n)]);
  add('three_dbc_roundtrips',1000000n,[...cycle(1000000n),...cycle(1000000n),...cycle(1000000n)]);
  add('near_base_reserve_roundtrip',available-1n,cycle(BigInt(pre.pool.baseReserve)-1n));
  add('half_base_reserve_roundtrip',available-1n,cycle(BigInt(pre.pool.baseReserve)/2n));
  add('unauthorized_creator_claim_after_roundtrip',1000000n,[...cycle(1000000n),claimCreatorIx(baseAta,owner)]);
  add('authorized_creator_claim_after_roundtrip',1000000n,[...cycle(1000000n),claimCreatorIx(baseAta,creator)]);
  add('authorized_double_creator_claim_after_roundtrip',1000000n,[...cycle(1000000n),claimCreatorIx(baseAta,creator),claimCreatorIx(baseAta,creator)]);
  add('wrong_vault_order_control',1000000n,[swapIx(baseAta,ownerUsdc,baseAta,1000000n,(1n<<64n)-1n,2,'swap_vault_order')]);
  add('input_alias_quote_vault_control',1000000n,[swapIx(baseAta,ownerUsdc,baseAta,1000000n,(1n<<64n)-1n,2,'alias_input_to_quote_vault')]);
  specs.push(['dbc_positive_without_flash',0n,[createBase,...cycle(1000000n)]]);
  const blockhash=(await conn.getLatestBlockhash('confirmed')).blockhash,outputs=[];
  for(const [name,borrow,instructions] of specs){
    try{const e=encodeV1(instructions,owner,blockhash);const req={jsonrpc:'2.0',id:name,method:'simulateTransaction',params:[e.wire.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:watched.map(x=>x.toBase58())}}]};const r=await fetch(env.HEAVY_RPC_URL||env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});const j=await r.json(),v=j.result?.value;const row={name,borrowRaw:borrow.toString(),baseRoundtripRaw:name.includes('base_1m')||name.includes('small_dbc')||name.includes('roundtrips')||name==='dbc_positive_without_flash'?'1000000':name.match(/base_(\d+)/)?.[1]||null,slot:j.result?.context?.slot,err:v?.err||null,rpcError:j.error||null,messageBytes:e.sizeBytes,v0EquivalentBytes:e.v0Bytes,inlineAccounts:e.addressCount,writableAccounts:e.writableCount,instructions:e.instructionCount,requiredSignatures:e.requiredSignatures,computeLimit:e.config.computeLimit,loadedDataLimit:e.config.dataLimit,unitsConsumed:v?.unitsConsumed,loadedAccountsDataSize:v?.loadedAccountsDataSize,post:image(v?.accounts),logs:v?.logs?.filter(x=>x.includes('Instruction:')||x.includes('AnchorError')||x.includes('failed')||x.includes('Program log:')).slice(-40)};outputs.push(row);console.log(JSON.stringify({name,err:row.err,bytes:row.messageBytes,accounts:row.inlineAccounts,units:row.unitsConsumed,post:row.post,logs:row.logs?.slice(-5)}));}catch(e){outputs.push({name,localError:e.stack});console.log(JSON.stringify({name,localError:e.message}))}
  }
  const out={timestamp:new Date().toISOString(),liveSubmission:false,sigVerify:false,programs:{dbc:DBC.toBase58(),klend:KLEND.toBase58()},pool:{pool:pool.toBase58(),config:config.toBase58(),creator:creator.toBase58(),baseMint:baseMint.toBase58(),baseVault:baseVault.toBase58(),quoteMint:quoteMint.toBase58(),quoteVault:quoteVault.toBase58(),baseTokenProgram:baseProgram.toBase58(),baseAta:baseAta.toBase58(),baseAtaExistedBefore:!!baseAtaInfo},flash:{reserve:flashReserve.toBase58(),supply:flashSupply.toBase58(),feeVault:flashFee.toBase58(),totalAvailableAmountRaw:available.toString(),flashLoanFeeSf:flashLoanFeeSf.toString(),feeRateInterpretation:'exact on-chain zero, not fee rounding'},preSlot:before.context.slot,pre,watched:watched.map(x=>x.toBase58()),outputs};fs.writeFileSync('composer-runs/2026-10-15/meteora-dbc-klend-v1-extremes.json',JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
