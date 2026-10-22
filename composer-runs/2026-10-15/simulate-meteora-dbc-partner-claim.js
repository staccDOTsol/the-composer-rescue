// No transaction is submitted. This script uses simulateTransaction with
// signature verification disabled to compare an authorized partner-fee claim
// against a one-field signer mutation and negative vault-alias control.
const fs = require('fs');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  PublicKey, Transaction, TransactionInstruction,
} = require(`${MOD}/@solana/web3.js`);
const {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
} = require(`${MOD}/@solana/spl-token`);

const RPC = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!RPC) throw new Error('RPC_URL required');
const PROGRAM = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
const POOL_AUTHORITY = new PublicKey('FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM');
const CLAIM_DISC = Buffer.from([8,236,89,49,152,125,177,81]);
const EVENT_AUTHORITY = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PROGRAM)[0];

async function rpc(method, params) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await fetch(RPC, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { body = {error:{message:text.slice(0,200)}}; }
    if (!body.error) return body.result;
    if (attempt === 7) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
    await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
  }
}

function u64(value) { const b=Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; }
function tokenAmount(value) {
  if (!value) return null;
  const data = Buffer.from(value.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}
function poolFees(value) {
  if (!value) return null;
  const data = Buffer.from(value.data[0], 'base64');
  return data.length === 424 ? {
    partnerBaseFee:data.readBigUInt64LE(264).toString(),
    partnerQuoteFee:data.readBigUInt64LE(272).toString(),
  } : null;
}

function claimIx(x, signer, quoteVault=x.quoteVault) {
  const data = Buffer.concat([CLAIM_DISC, u64(BigInt('18446744073709551615')), u64(BigInt('18446744073709551615'))]);
  return new TransactionInstruction({
    programId:PROGRAM,
    keys:[
      {pubkey:POOL_AUTHORITY,isSigner:false,isWritable:false},
      {pubkey:x.config,isSigner:false,isWritable:false},
      {pubkey:x.pool,isSigner:false,isWritable:true},
      {pubkey:x.baseReceiver,isSigner:false,isWritable:true},
      {pubkey:x.quoteReceiver,isSigner:false,isWritable:true},
      {pubkey:x.baseVault,isSigner:false,isWritable:true},
      {pubkey:quoteVault,isSigner:false,isWritable:true},
      {pubkey:x.baseMint,isSigner:false,isWritable:false},
      {pubkey:x.quoteMint,isSigner:false,isWritable:false},
      {pubkey:signer,isSigner:true,isWritable:false},
      {pubkey:x.tokenBaseProgram,isSigner:false,isWritable:false},
      {pubkey:x.tokenQuoteProgram,isSigner:false,isWritable:false},
      {pubkey:EVENT_AUTHORITY,isSigner:false,isWritable:false},
      {pubkey:PROGRAM,isSigner:false,isWritable:false},
    ], data,
  });
}

async function simulate(label, x, signer, options={}) {
  const blockhash = (await rpc('getLatestBlockhash', [{commitment:'confirmed'}])).value.blockhash;
  const tx = new Transaction({feePayer:x.attacker,recentBlockhash:blockhash});
  if (!x.quoteReceiverExists) {
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
      x.attacker, x.quoteReceiver, x.attacker, x.quoteMint,
      x.tokenQuoteProgram, ASSOCIATED_TOKEN_PROGRAM_ID,
    ));
  }
  const quoteVault = options.aliasQuoteVault ? x.wrongQuoteVault : x.quoteVault;
  tx.add(claimIx(x, signer, quoteVault));
  if (options.repeatClaim) tx.add(claimIx(x, signer, quoteVault));
  const raw = tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
  const addresses = [x.pool,x.baseVault,x.quoteVault,x.baseReceiver,x.quoteReceiver].map(k=>k.toBase58());
  const result = await rpc('simulateTransaction', [raw, {
    encoding:'base64',commitment:'confirmed',sigVerify:false,replaceRecentBlockhash:true,
    accounts:{encoding:'base64',addresses},
  }]);
  const values = result.value.accounts || [];
  return {
    label, err:result.value.err, unitsConsumed:result.value.unitsConsumed,
    logs:result.value.logs,
    post:{
      poolFees:poolFees(values[0]),
      baseVault:tokenAmount(values[1]), quoteVault:tokenAmount(values[2]),
      baseReceiver:tokenAmount(values[3]), quoteReceiver:tokenAmount(values[4]),
    },
  };
}

async function main() {
  const recent = require('./meteora-dbc-recent-fee-pools.json');
  const c = recent.candidates.find(x => x.hasPartnerFee && x.controlsMatch && x.poolDiscriminator !== 'eddbb8172abda923') || recent.candidates.find(x => x.hasPartnerFee && x.controlsMatch);
  if (!c) throw new Error('No partner-fee-bearing recent pool');
  const keys = Object.fromEntries(Object.entries({
    pool:c.pool, config:c.config, baseVault:c.baseVault, quoteVault:c.quoteVault,
    baseMint:c.baseMint, quoteMint:c.quoteMint, baseReceiver:c.outputTokenAccount,
    attacker:c.payer, tokenBaseProgram:c.tokenBaseProgram, tokenQuoteProgram:c.tokenQuoteProgram,
  }).map(([k,v])=>[k,new PublicKey(v)]));
  const baseReceiverInfo = await rpc('getAccountInfo',[keys.baseReceiver.toBase58(),{encoding:'base64',commitment:'confirmed'}]);
  if (!baseReceiverInfo?.value) throw new Error('Selected attacker base receiver no longer exists');
  const baseReceiverData = Buffer.from(baseReceiverInfo.value.data[0],'base64');
  if (new PublicKey(baseReceiverData.subarray(0,32)).toBase58() !== keys.baseMint.toBase58() || new PublicKey(baseReceiverData.subarray(32,64)).toBase58() !== keys.attacker.toBase58()) throw new Error('Base receiver is not attacker-owned/mint matched');
  keys.quoteReceiver = getAssociatedTokenAddressSync(keys.quoteMint,keys.attacker,false,keys.tokenQuoteProgram,ASSOCIATED_TOKEN_PROGRAM_ID);
  const alternate = recent.candidates.find(x => x.pool !== c.pool && x.quoteMint === c.quoteMint && x.quoteVault !== c.quoteVault);
  if (!alternate) throw new Error('No distinct same-mint quote vault available for alias control');
  keys.wrongQuoteVault = new PublicKey(alternate.quoteVault);
  const qInfo = await rpc('getAccountInfo',[keys.quoteReceiver.toBase58(),{encoding:'base64',commitment:'confirmed'}]);
  keys.quoteReceiverExists = !!qInfo?.value;
  const configInfo = await rpc('getAccountInfo',[keys.config.toBase58(),{encoding:'base64',commitment:'confirmed'}]);
  const configData = Buffer.from(configInfo.value.data[0],'base64');
  const authorized = new PublicKey(configData.subarray(40,72));
  if (authorized.equals(keys.attacker)) throw new Error('Selected attacker equals authorized fee claimer');
  const preResult = await rpc('getMultipleAccounts', [[keys.pool,keys.baseVault,keys.quoteVault,keys.baseReceiver,keys.quoteReceiver].map(k=>k.toBase58()),{encoding:'base64',commitment:'confirmed'}]);
  const pre = {
    poolFees:poolFees(preResult.value[0]),baseVault:tokenAmount(preResult.value[1]),quoteVault:tokenAmount(preResult.value[2]),
    baseReceiver:tokenAmount(preResult.value[3]),quoteReceiver:tokenAmount(preResult.value[4]),
  };
  const tests = [];
  tests.push(await simulate('authorized_positive_control',keys,authorized));
  tests.push(await simulate('unauthorized_signer_mutation',keys,keys.attacker));
  tests.push(await simulate('authorized_wrong_quote_vault_control',keys,authorized,{aliasQuoteVault:true}));
  tests.push(await simulate('authorized_repeated_claim_atomicity',keys,authorized,{repeatClaim:true}));
  const out = {
    timestamp:new Date().toISOString(),rpcMethod:'simulateTransaction',submittedTransactions:0,
    program:PROGRAM.toBase58(),eventAuthority:EVENT_AUTHORITY.toBase58(),
    observedSwapSignature:c.signature,observedSwapSlot:c.slot,
    pool:keys.pool.toBase58(),poolDiscriminator:c.poolDiscriminator || null,config:keys.config.toBase58(),
    authorizedFeeClaimer:authorized.toBase58(),attacker:keys.attacker.toBase58(),
    attackerBaseReceiver:keys.baseReceiver.toBase58(),attackerQuoteReceiver:keys.quoteReceiver.toBase58(),
    quoteReceiverExistedBeforeSimulation:keys.quoteReceiverExists,
    baseMint:keys.baseMint.toBase58(),quoteMint:keys.quoteMint.toBase58(),
    baseVault:keys.baseVault.toBase58(),quoteVault:keys.quoteVault.toBase58(),pre,tests,
    wrongQuoteVaultControl:keys.wrongQuoteVault.toBase58(),
  };
  const path='/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dbc-partner-claim-simulations.json';
  fs.writeFileSync(path,JSON.stringify(out,null,2));
  console.log(JSON.stringify({path,pool:out.pool,authorizedFeeClaimer:out.authorizedFeeClaimer,attacker:out.attacker,pre,tests:tests.map(t=>({label:t.label,err:t.err,post:t.post,unitsConsumed:t.unitsConsumed}))}));
}

main().catch(e=>{console.error(e);process.exit(1)});
