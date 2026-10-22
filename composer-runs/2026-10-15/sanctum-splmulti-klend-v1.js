// Read-only current-mainnet exercise of the Sanctum SPL Multi stake-pool binary.
// Builds genuine custom Solana v1 wire transactions and simulates them only.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const anchor = require(`${MOD}/@coral-xyz/anchor`);
const BN = require(`${MOD}/bn.js`);
const bs58 = require(`${MOD}/bs58`);
const {
  Connection, PublicKey, Keypair, SystemProgram, StakeProgram, TransactionInstruction,
  TransactionMessage,
} = require(`${MOD}/@solana/web3.js`);
const {
  TOKEN_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction,
  createSyncNativeInstruction,
} = require(`${MOD}/@solana/spl-token`);
const {
  StakePoolInstruction, StakePoolLayout, ValidatorListLayout,
} = require(`${MOD}/@solana/spl-stake-pool`);
const {encodeV1} = require('./klend-v1-composition.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const conn = new Connection(rpcUrl, 'confirmed');
const P = value => new PublicKey(value);

const SPM = P('SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const ASSOCIATED = P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const INSTRUCTIONS = P('Sysvar1nstructions1111111111111111111111111');
const MEMO = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const OWNER = P('2cSw92ybJWCZN93RLD2ZCxg3DMXS1v5u3H4BYRExBjbK');
const HOLDER = P('9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo');
const OUTSIDER = Keypair.fromSeed(crypto.createHash('sha256')
  .update('spm-current-audit-outsider').digest().subarray(0, 32)).publicKey;

const POOL = P('8VpRhuxa7sUUepdY3kQiTmX9rS5vx4WgaXiAnXq4KCtr');
const WITHDRAW = P('EMjuABxELpYWYEwjkKmQKBNCwdaFAy4QYAs6W9bDQDNw');
const VALIDATOR_LIST = P('AXL4v4bbzRkqwHmLc9A1YzHQmRhmG9Q93i1e6CPG2bEK');
const RESERVE = P('FMAWbzuxsgbgndArunedwxXPA6sweaVUGGgadCpSxau2');
const MINT = P('jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v');
const MANAGER_FEE = P('GbvFCpMqKX65gQ8KNeob9JUAL7vHCHFSg8YN5bnpPT8g');
const OWNER_WSOL = getAssociatedTokenAddressSync(NATIVE_MINT, OWNER);
const OWNER_POOL = getAssociatedTokenAddressSync(MINT, OWNER);
const HOLDER_POOL = P('FbbgvvnwfN25cyX52Zqut2ZTbtvCWZbhKS177gfdUd6K');
const VALIDATOR_STAKE = P('EmutJdbKJ55hUyth15bar8ZxDCchR44udAXWYg9eLLDL');
const DEST_STAKE = Keypair.fromSeed(crypto.createHash('sha256')
  .update('spm-current-audit-destination-stake').digest().subarray(0, 32)).publicKey;

// Exact current zero-fee WSOL KLend reserve, decoded below before use.
const KLEND_RESERVE = P('4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM');
const idl = JSON.parse(fs.readFileSync(
  'composer-runs/2026-10-15/marginfi-source/idls-complete/kamino_lending.json'));
const coder = new anchor.BorshAccountsCoder(idl);
const flashHistory = JSON.parse(fs.readFileSync(
  'composer-runs/2026-10-15/kamino-flash-history.json'));
const sample = flashHistory.hits[0].transaction;
const msg = sample.transaction.message;
const staticKeys = msg.accountKeys;
const allKeys = [...staticKeys, ...(sample.meta.loadedAddresses?.writable || []),
  ...(sample.meta.loadedAddresses?.readonly || [])];
const head = msg.header;
const writable = index => index < staticKeys.length
  ? (index < head.numRequiredSignatures
    ? index < head.numRequiredSignatures - head.numReadonlySignedAccounts
    : index < staticKeys.length - head.numReadonlyUnsignedAccounts)
  : index < staticKeys.length + (sample.meta.loadedAddresses?.writable?.length || 0);
const sampleIx = index => {
  const src = msg.instructions[index];
  return new TransactionInstruction({
    programId: P(allKeys[src.programIdIndex]),
    keys: src.accounts.map(i => ({pubkey:P(allKeys[i]), isSigner:i < head.numRequiredSignatures,
      isWritable:writable(i)})),
    data: Buffer.from(bs58.decode(src.data)),
  });
};
const borrowTemplate = sampleIx(3);
const repayTemplate = sampleIx(13);
if (!borrowTemplate.programId.equals(KLEND) || !repayTemplate.programId.equals(KLEND))
  throw new Error('Historical KLend flash template indexes changed');

const normalize = value => {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof PublicKey) return value.toBase58();
  if (value.constructor?.name === 'BN') return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
};
const cloneIx = ix => new TransactionInstruction({programId:ix.programId,
  keys:ix.keys.map(key => ({...key})),data:Buffer.from(ix.data)});
const asSpm = ix => { ix.programId = SPM; return ix; };
const flashIx = (template, market, marketAuthority, supply, feeVault, amount, repayIndex) => {
  const keys = template.keys.map(key => ({...key}));
  keys[0].pubkey = OWNER;
  keys[1].pubkey = marketAuthority;
  keys[2].pubkey = market;
  keys[3].pubkey = KLEND_RESERVE;
  keys[4].pubkey = NATIVE_MINT;
  keys[5].pubkey = supply;
  keys[6].pubkey = OWNER_WSOL;
  keys[7].pubkey = feeVault;
  keys[8].pubkey = KLEND;
  keys[9].pubkey = KLEND;
  keys[10].pubkey = INSTRUCTIONS;
  keys[11].pubkey = TOKEN_PROGRAM_ID;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(BigInt(amount), 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId:KLEND,keys,data});
};
const createAta = (payer, ata, owner, mint) =>
  createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint,
    TOKEN_PROGRAM_ID, ASSOCIATED);
const depositSol = (amount, options = {}) => asSpm(StakePoolInstruction.depositSol({
  stakePool:POOL, withdrawAuthority:options.withdraw || WITHDRAW,
  reserveStake:options.reserve || RESERVE, fundingAccount:options.funding || OWNER,
  destinationPoolAccount:options.poolAccount || OWNER_POOL,
  managerFeeAccount:options.managerFee || MANAGER_FEE,
  referralPoolAccount:options.referral || OWNER_POOL, poolMint:MINT, lamports:new BN(amount.toString()),
}));
const withdrawSol = (poolTokens, options = {}) => {
  const ix = asSpm(StakePoolInstruction.withdrawSol({
    stakePool:POOL, withdrawAuthority:options.withdraw || WITHDRAW,
    sourceTransferAuthority:options.authority || OWNER,
    sourcePoolAccount:options.poolAccount || OWNER_POOL,
    reserveStake:options.reserve || RESERVE,
    destinationSystemAccount:options.destination || OWNER,
    managerFeeAccount:options.managerFee || MANAGER_FEE, poolMint:MINT,
    poolTokens:new BN(poolTokens.toString()),
  }));
  if (options.stakeProgram) ix.keys[10].pubkey = options.stakeProgram;
  return ix;
};
const updatePool = (options = {}) => asSpm(StakePoolInstruction.updateStakePoolBalance({
  stakePool:POOL, withdrawAuthority:options.withdraw || WITHDRAW,
  validatorList:options.validatorList || VALIDATOR_LIST,
  reserveStake:options.reserve || RESERVE,
  managerFeeAccount:options.managerFee || MANAGER_FEE, poolMint:MINT,
}));
const withdrawStake = (poolTokens, options = {}) => {
  const ix = asSpm(StakePoolInstruction.withdrawStake({
    stakePool:POOL, validatorList:options.validatorList || VALIDATOR_LIST,
    withdrawAuthority:options.withdraw || WITHDRAW,
    validatorStake:options.validatorStake || VALIDATOR_STAKE,
    destinationStake:DEST_STAKE, destinationStakeAuthority:options.destinationAuthority || HOLDER,
    sourceTransferAuthority:options.authority || HOLDER,
    sourcePoolAccount:options.poolAccount || HOLDER_POOL,
    managerFeeAccount:options.managerFee || MANAGER_FEE, poolMint:MINT,
    poolTokens:new BN(poolTokens.toString()),
  }));
  if (options.stakeProgram) ix.keys[12].pubkey = options.stakeProgram;
  return ix;
};
const stakeDestinationCreate = rent => SystemProgram.createAccount({
  fromPubkey:HOLDER,newAccountPubkey:DEST_STAKE,lamports:Number(rent),space:200,
  programId:StakeProgram.programId,
});

function accountImage(key, value) {
  if (!value) return null;
  const data = Buffer.from(value.data[0], 'base64');
  const common = {lamports:String(value.lamports),owner:value.owner,dataLen:data.length,
    dataSha256:crypto.createHash('sha256').update(data).digest('hex')};
  if (value.owner === TOKEN_PROGRAM_ID.toBase58() && data.length === 165)
    return {...common,type:'token',mint:P(data.subarray(0,32)).toBase58(),
      authority:P(data.subarray(32,64)).toBase58(),amount:data.readBigUInt64LE(64).toString()};
  if (key.equals(MINT) && data.length === 82)
    return {...common,type:'mint',supply:data.readBigUInt64LE(36).toString(),decimals:data[44]};
  if (key.equals(POOL)) {
    try { const decoded=normalize(StakePoolLayout.decode(data)); return {...common,type:'stake_pool',
      totalLamports:decoded.totalLamports,poolTokenSupply:decoded.poolTokenSupply,
      lastUpdateEpoch:decoded.lastUpdateEpoch}; } catch (_) {}
  }
  if (key.equals(KLEND_RESERVE)) {
    try { const decoded=normalize(coder.decode('Reserve',data)); return {...common,type:'klend_reserve',
      totalAvailable:decoded.liquidity.total_available_amount,
      flashLoanFeeSf:decoded.config.fees.flash_loan_fee_sf,status:decoded.config.status}; } catch (_) {}
  }
  return {...common,type:data.length ? 'opaque' : 'system'};
}
const delta = (before, after, field) => before?.[field] === undefined || after?.[field] === undefined
  ? null : (BigInt(after[field])-BigInt(before[field])).toString();

async function main() {
  const [klendInfo,poolInfo,listInfo,supplyOwnerInfo,destInfo] = await conn.getMultipleAccountsInfo(
    [KLEND_RESERVE,POOL,VALIDATOR_LIST,OWNER,DEST_STAKE],'confirmed');
  if (!klendInfo || !poolInfo || !listInfo) throw new Error('Required current state unavailable');
  if (destInfo) throw new Error('Deterministic destination stake already exists');
  const klend = normalize(coder.decode('Reserve',klendInfo.data));
  if (klend.liquidity.mint_pubkey !== NATIVE_MINT.toBase58()) throw new Error('KLend reserve not WSOL');
  if (klend.config.fees.flash_loan_fee_sf !== '0') throw new Error('KLend flash fee is not exactly zero');
  if (klend.config.status !== 0) throw new Error('KLend reserve not active');
  const market=P(klend.lending_market), supply=P(klend.liquidity.supply_vault),
    feeVault=P(klend.liquidity.fee_vault);
  const marketAuthority=PublicKey.findProgramAddressSync([Buffer.from('lma'),market.toBuffer()],KLEND)[0];
  const supplyInfo=await conn.getAccountInfo(supply,'confirmed');
  const supplyRaw=supplyInfo.data.readBigUInt64LE(64);
  const reserveAvailable=BigInt(klend.liquidity.total_available_amount);
  const available=supplyRaw < reserveAvailable ? supplyRaw : reserveAvailable;
  const state=StakePoolLayout.decode(poolInfo.data);
  const total=BigInt(state.totalLamports.toString()), poolSupply=BigInt(state.poolTokenSupply.toString());
  const mintFor=amount => BigInt(amount)*poolSupply/total;
  const smallestMintingOne=(total+poolSupply-1n)/poolSupply;
  const smallestRoundTrip=(2n*total+poolSupply-1n)/poolSupply;
  const returnedFor = amount => {
    const minted=mintFor(amount), fee=(minted+999n)/1000n;
    return (minted-fee)*(total+amount)/(poolSupply+minted);
  };
  const stakeRent=BigInt(await conn.getMinimumBalanceForRentExemption(200,'confirmed'));
  const tokenRent=BigInt(await conn.getMinimumBalanceForRentExemption(165,'confirmed'));
  const blockhash=(await conn.getLatestBlockhash('confirmed')).blockhash;
  const list=ValidatorListLayout.decode(listInfo.data);
  const validatorPairs=[];
  for (const validator of list.validators.slice(0,5)) {
    const vote=validator.voteAccountAddress;
    const validatorPda=PublicKey.findProgramAddressSync([vote.toBuffer(),POOL.toBuffer()],SPM)[0];
    const seed=new BN(validator.transientSeedSuffixStart).toArrayLike(Buffer,'le',8);
    const transient=PublicKey.findProgramAddressSync(
      [Buffer.from('transient'),vote.toBuffer(),POOL.toBuffer(),seed],SPM)[0];
    validatorPairs.push(validatorPda,transient);
  }
  const updateList = startIndex => asSpm(StakePoolInstruction.updateValidatorListBalance({
    stakePool:POOL,withdrawAuthority:WITHDRAW,validatorList:VALIDATOR_LIST,reserveStake:RESERVE,
    startIndex,noMerge:true,validatorAndTransientStakePairs:validatorPairs,
  }));

  const baseWatched=[OWNER,OWNER_WSOL,OWNER_POOL,HOLDER,HOLDER_POOL,OUTSIDER,DEST_STAKE,
    POOL,VALIDATOR_LIST,RESERVE,MINT,MANAGER_FEE,supply,feeVault,KLEND_RESERVE,VALIDATOR_STAKE];
  const preContext=await conn.getMultipleAccountsInfoAndContext(baseWatched,'confirmed');
  const pre=Object.fromEntries(baseWatched.map((key,index)=>[key.toBase58(),
    accountImage(key,preContext.value[index] ? {lamports:preContext.value[index].lamports,
      owner:preContext.value[index].owner.toBase58(),
      data:[preContext.value[index].data.toString('base64'),'base64']} : null)]));

  const compose = (amount, options={}) => {
    const minted=mintFor(amount);
    const ixs=[createAta(OWNER,OWNER_WSOL,OWNER,NATIVE_MINT)];
    const borrowIndex=ixs.length;
    ixs.push(flashIx(borrowTemplate,market,marketAuthority,supply,feeVault,amount));
    if (options.directWrapped) {
      ixs.push(depositSol(amount,{funding:OWNER_WSOL}));
      ixs.push(flashIx(repayTemplate,market,marketAuthority,supply,feeVault,amount,borrowIndex));
      return ixs;
    }
    ixs.push(createCloseAccountInstruction(OWNER_WSOL,OWNER,OWNER));
    ixs.push(createAta(OWNER,OWNER_POOL,OWNER,MINT));
    if (options.refresh === 'before') ixs.push(updatePool());
    const cycles=options.cycles || 1;
    for (let i=0;i<cycles;i++) {
      ixs.push(depositSol(amount, options.deposit || {}));
      if (options.refresh === 'middle' && i === 0) ixs.push(updatePool());
      const wopts={...(options.withdraw || {})};
      if (options.beneficiaryWsol) {
        ixs.push(createAta(OWNER,OWNER_WSOL,OWNER,NATIVE_MINT));
        wopts.destination=OWNER_WSOL;
      }
      ixs.push(withdrawSol(minted,wopts));
      if (options.beneficiaryWsol) {
        if (!options.beneficiaryWsolNoTopup) {
          const shortfall=amount-returnedFor(amount);
          ixs.push(SystemProgram.transfer({fromPubkey:OWNER,toPubkey:OWNER_WSOL,
            lamports:Number(shortfall)}));
        }
        ixs.push(createSyncNativeInstruction(OWNER_WSOL));
      }
      if (options.refresh === 'after' && i === 0) ixs.push(updatePool());
    }
    if (!options.beneficiaryWsol) {
      ixs.push(createAta(OWNER,OWNER_WSOL,OWNER,NATIVE_MINT));
      ixs.push(SystemProgram.transfer({fromPubkey:OWNER,toPubkey:OWNER_WSOL,lamports:Number(amount)}));
      ixs.push(createSyncNativeInstruction(OWNER_WSOL));
    }
    if (options.repayBeforeTarget) {
      const target=ixs.splice(3);
      ixs.push(flashIx(repayTemplate,market,marketAuthority,supply,feeVault,amount,borrowIndex),...target);
    } else {
      ixs.push(flashIx(repayTemplate,market,marketAuthority,supply,feeVault,amount,
        options.wrongRepayIndex === undefined ? borrowIndex : options.wrongRepayIndex));
    }
    return ixs;
  };
  const flashPair = amount => { const a=createAta(OWNER,OWNER_WSOL,OWNER,NATIVE_MINT); return [a,
    flashIx(borrowTemplate,market,marketAuthority,supply,feeVault,amount),
    flashIx(repayTemplate,market,marketAuthority,supply,feeVault,amount,1)]; };
  const stakeFlow = options => {
    const create=stakeDestinationCreate(stakeRent);
    const withdraw=withdrawStake(1_000_000_000n,options || {});
    if (options?.swapStakeAccounts) [withdraw.keys[3],withdraw.keys[4]]=[withdraw.keys[4],withdraw.keys[3]];
    return options?.withdrawBeforeCreate ? [withdraw,create] : [create,withdraw];
  };
  const fit64 = instructions => {
    const out=instructions.map(cloneIx);
    const target=out.find(ix=>ix.programId.equals(SPM));
    let nonce=0;
    while (new TransactionMessage({payerKey:OWNER,recentBlockhash:blockhash,
      instructions:out}).compileToV0Message().staticAccountKeys.length < 64) {
      const key=Keypair.fromSeed(crypto.createHash('sha256')
        .update(`spm-pad-${nonce++}`).digest().subarray(0,32)).publicKey;
      target.keys.push({pubkey:key,isSigner:false,isWritable:false});
    }
    return out;
  };
  const fit4096 = instructions => {
    for (let length=0;length<=4096;length++) {
      const memo=new TransactionInstruction({programId:MEMO,keys:[],data:Buffer.alloc(length,0x61)});
      const out=[...instructions.slice(0,-1),memo,instructions[instructions.length-1]];
      try { if (encodeV1(out,OWNER,blockhash).sizeBytes === 4096) return out; }
      catch (error) { if (!/size limit/.test(error.message)) throw error; }
    }
    throw new Error('Unable to construct exact 4096-byte composition');
  };

  const exact4096=fit4096(compose(1_000_000_000n));
  const max64=fit64(compose(1_000_000_000n));
  const missingFundingSignature=compose(1_000_000_000n,{deposit:{funding:OUTSIDER}});
  const missingFundingDeposit=missingFundingSignature.find(ix=>ix.programId.equals(SPM) && ix.data[0]===14);
  missingFundingDeposit.keys[3].isSigner=false;
  const cases=[
    {name:'klend_positive_1_raw',payer:OWNER,ixs:flashPair(1n)},
    {name:'klend_positive_available_minus_1',payer:OWNER,ixs:flashPair(available-1n)},
    {name:'klend_boundary_available',payer:OWNER,ixs:flashPair(available)},
    {name:'klend_boundary_available_plus_1',payer:OWNER,ixs:flashPair(available+1n)},
    {name:'direct_wsol_deposit_blocker',payer:OWNER,ixs:compose(1_000_000_000n,{directWrapped:true})},
    {name:'roundtrip_threshold_minus_1',payer:OWNER,ixs:compose(smallestMintingOne-1n)},
    {name:'roundtrip_threshold_exact',payer:OWNER,ixs:compose(smallestMintingOne)},
    {name:'roundtrip_smallest_success',payer:OWNER,ixs:compose(smallestRoundTrip)},
    {name:'roundtrip_1_sol',payer:OWNER,ixs:compose(1_000_000_000n)},
    {name:'roundtrip_near_available',payer:OWNER,ixs:compose(available-1n)},
    {name:'roundtrip_two_cycles',payer:OWNER,ixs:compose(1_000_000_000n,{cycles:2})},
    {name:'roundtrip_four_cycles',payer:OWNER,ixs:compose(1_000_000_000n,{cycles:4})},
    {name:'refresh_before',payer:OWNER,ixs:compose(1_000_000_000n,{refresh:'before'})},
    {name:'refresh_middle',payer:OWNER,ixs:compose(1_000_000_000n,{refresh:'middle'})},
    {name:'refresh_after',payer:OWNER,ixs:compose(1_000_000_000n,{refresh:'after'})},
    {name:'beneficiary_wsol_without_fee_topup',payer:OWNER,ixs:compose(1_000_000_000n,
      {beneficiaryWsol:true,beneficiaryWsolNoTopup:true})},
    {name:'beneficiary_wsol_same_asset_with_exact_topup',payer:OWNER,
      ixs:compose(1_000_000_000n,{beneficiaryWsol:true})},
    {name:'beneficiary_outsider_authorized_redirect',payer:OWNER,ixs:compose(1_000_000_000n,
      {withdraw:{destination:OUTSIDER}})},
    {name:'wrong_funding_signer',payer:OWNER,ixs:compose(1_000_000_000n,
      {deposit:{funding:OUTSIDER}})},
    {name:'missing_funding_signature',payer:OWNER,ixs:missingFundingSignature},
    {name:'wrong_transfer_authority',payer:OWNER,ixs:compose(1_000_000_000n,
      {withdraw:{authority:OUTSIDER}})},
    {name:'wrong_withdraw_pda',payer:OWNER,ixs:compose(1_000_000_000n,
      {withdraw:{withdraw:OUTSIDER}})},
    {name:'wrong_reserve_alias',payer:OWNER,ixs:compose(1_000_000_000n,
      {withdraw:{reserve:OWNER}})},
    {name:'wrong_stake_cpi_program',payer:OWNER,ixs:compose(1_000_000_000n,
      {withdraw:{stakeProgram:SystemProgram.programId}})},
    {name:'repay_before_target_order',payer:OWNER,ixs:compose(1_000_000_000n,{repayBeforeTarget:true})},
    {name:'wrong_flash_repay_index',payer:OWNER,ixs:compose(1_000_000_000n,{wrongRepayIndex:0})},
    {name:'v1_exact_4096_bytes',payer:OWNER,ixs:exact4096},
    {name:'v1_exact_64_inline_accounts',payer:OWNER,ixs:max64},
    {name:'update_pool_balance_positive',payer:OWNER,ixs:[updatePool()]},
    {name:'update_validator_list_index_0_positive',payer:OWNER,ixs:[updateList(0)]},
    {name:'update_validator_list_wrong_index_1',payer:OWNER,ixs:[updateList(1)]},
    {name:'withdraw_stake_positive',payer:HOLDER,ixs:stakeFlow()},
    {name:'withdraw_stake_wrong_list',payer:HOLDER,ixs:stakeFlow({validatorList:POOL})},
    {name:'withdraw_stake_wrong_withdraw_pda',payer:HOLDER,ixs:stakeFlow({withdraw:OUTSIDER})},
    {name:'withdraw_stake_wrong_stake_cpi',payer:HOLDER,ixs:stakeFlow({stakeProgram:SystemProgram.programId})},
    {name:'withdraw_stake_swapped_source_destination',payer:HOLDER,ixs:stakeFlow({swapStakeAccounts:true})},
    {name:'withdraw_stake_before_destination_create',payer:HOLDER,ixs:stakeFlow({withdrawBeforeCreate:true})},
  ];
  // Local-only limit controls: do not issue RPC for encodings the v1 envelope forbids.
  const localLimits=[];
  try { fit64(compose(1_000_000_000n)).find(ix=>ix.programId.equals(SPM)).keys.push(
    {pubkey:OUTSIDER,isSigner:false,isWritable:false}); } catch (_) {}
  const over64=max64.map(cloneIx);
  over64.find(ix=>ix.programId.equals(SPM)).keys.push({pubkey:Keypair.fromSeed(
    crypto.createHash('sha256').update('spm-65th').digest().subarray(0,32)).publicKey,
    isSigner:false,isWritable:false});
  try { encodeV1(over64,OWNER,blockhash); localLimits.push({name:'v1_65_inline_accounts',unexpected:'encoded'}); }
  catch (error) { localLimits.push({name:'v1_65_inline_accounts',rejected:error.message}); }
  const over4096=exact4096.map(cloneIx);
  const memoIndex=over4096.findIndex(ix=>ix.programId.equals(MEMO));
  over4096[memoIndex].data=Buffer.concat([over4096[memoIndex].data,Buffer.from('x')]);
  try { encodeV1(over4096,OWNER,blockhash); localLimits.push({name:'v1_4097_plus_bytes',unexpected:'encoded'}); }
  catch (error) { localLimits.push({name:'v1_4097_plus_bytes',rejected:error.message}); }

  const outputs=[];
  for (const test of cases) {
    try {
      const encoded=encodeV1(test.ixs,test.payer,blockhash);
      const v0=new TransactionMessage({payerKey:test.payer,recentBlockhash:blockhash,
        instructions:test.ixs}).compileToV0Message();
      const keySet=new Set(v0.staticAccountKeys.map(key=>key.toBase58()));
      const requested=baseWatched.filter(key=>keySet.has(key.toBase58()));
      const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:test.name,method:'simulateTransaction',params:[
          encoded.wire.toString('base64'),{encoding:'base64',sigVerify:false,
            replaceRecentBlockhash:true,commitment:'confirmed',innerInstructions:true,
            accounts:{encoding:'base64',addresses:requested.map(key=>key.toBase58())}},
        ]})});
      const json=await response.json(), value=json.result?.value;
      const returned=new Map(requested.map((key,index)=>[key.toBase58(),value?.accounts?.[index]]));
      const post=Object.fromEntries(baseWatched.map(key=>[key.toBase58(),
        accountImage(key,returned.get(key.toBase58()))]));
      const d={ownerLamports:delta(pre[OWNER.toBase58()],post[OWNER.toBase58()],'lamports'),
        ownerWsolRaw:delta(pre[OWNER_WSOL.toBase58()],post[OWNER_WSOL.toBase58()],'amount'),
        ownerPoolRaw:delta(pre[OWNER_POOL.toBase58()],post[OWNER_POOL.toBase58()],'amount'),
        holderLamports:delta(pre[HOLDER.toBase58()],post[HOLDER.toBase58()],'lamports'),
        holderPoolRaw:delta(pre[HOLDER_POOL.toBase58()],post[HOLDER_POOL.toBase58()],'amount'),
        outsiderLamports:delta(pre[OUTSIDER.toBase58()],post[OUTSIDER.toBase58()],'lamports'),
        destinationStakeLamports:delta(pre[DEST_STAKE.toBase58()],post[DEST_STAKE.toBase58()],'lamports'),
        poolTotalLamports:delta(pre[POOL.toBase58()],post[POOL.toBase58()],'totalLamports'),
        poolTokenSupplyRaw:delta(pre[POOL.toBase58()],post[POOL.toBase58()],'poolTokenSupply'),
        reserveLamports:delta(pre[RESERVE.toBase58()],post[RESERVE.toBase58()],'lamports'),
        mintSupplyRaw:delta(pre[MINT.toBase58()],post[MINT.toBase58()],'supply'),
        managerFeeRaw:delta(pre[MANAGER_FEE.toBase58()],post[MANAGER_FEE.toBase58()],'amount'),
        klendSupplyRaw:delta(pre[supply.toBase58()],post[supply.toBase58()],'amount'),
        klendFeeRaw:delta(pre[feeVault.toBase58()],post[feeVault.toBase58()],'amount'),
        klendAvailableRaw:delta(pre[KLEND_RESERVE.toBase58()],post[KLEND_RESERVE.toBase58()],'totalAvailable')};
      const hasBorrow=test.ixs.some(ix=>ix.programId.equals(KLEND) &&
        ix.data.subarray(0,8).equals(borrowTemplate.data.subarray(0,8)));
      const repaid=hasBorrow ? value?.err===null && d.klendSupplyRaw==='0' &&
        d.klendFeeRaw==='0' && d.klendAvailableRaw==='0' : null;
      const out={name:test.name,payer:test.payer.toBase58(),slot:json.result?.context?.slot,
        err:value?.err||null,rpcError:json.error||null,
        v1:{sizeBytes:encoded.sizeBytes,wireSha256:crypto.createHash('sha256')
          .update(encoded.wire).digest('hex'),wireBase64:encoded.wire.toString('base64'),
          v0EquivalentBytes:encoded.v0Bytes,accountCount:encoded.addressCount,
          writableCount:encoded.writableCount,instructionCount:encoded.instructionCount,
          requiredSignatures:encoded.requiredSignatures,accountKeys:v0.staticAccountKeys.map(x=>x.toBase58()),
          header:v0.header,computeLimit:encoded.config.computeLimit,
          loadedAccountsDataSizeLimit:encoded.config.dataLimit},
        computeUnitsConsumed:value?.unitsConsumed??null,
        loadedAccountsDataSize:value?.loadedAccountsDataSize??null,
        klendRepaid:repaid,debt:hasBorrow?'stateless_flash_full_repay_required':'not_applicable',
        deltas:d,post,logs:value?.logs||null,innerInstructions:value?.innerInstructions||null};
      outputs.push(out);
      console.log(JSON.stringify({name:out.name,err:out.err,rpcError:out.rpcError,
        bytes:out.v1.sizeBytes,accounts:out.v1.accountCount,instructions:out.v1.instructionCount,
        cu:out.computeUnitsConsumed,repaid,deltas:d,lastLogs:(out.logs||[]).filter(line=>
          /Instruction:|Error|failed:|consumed/.test(line)).slice(-8)}));
    } catch (error) {
      outputs.push({name:test.name,localError:error.stack});
      console.log(JSON.stringify({name:test.name,localError:error.message}));
    }
  }
  const result={generatedAt:new Date().toISOString(),liveSubmission:false,sigVerify:false,
    transport:'read-only simulateTransaction; replaceRecentBlockhash=true',
    program:{id:SPM.toBase58(),pool:POOL.toBase58(),withdrawAuthority:WITHDRAW.toBase58(),
      validatorList:VALIDATOR_LIST.toBase58(),reserve:RESERVE.toBase58(),mint:MINT.toBase58(),
      managerFee:MANAGER_FEE.toBase58(),stateTotalLamports:total.toString(),
      statePoolTokenSupply:poolSupply.toString(),
      smallestDepositMintingOnePoolToken:smallestMintingOne.toString(),
      smallestRoundTripDepositRaw:smallestRoundTrip.toString(),
      oneSolExpectedWithdrawalFeeAndRoundingShortfallRaw:
        (1_000_000_000n-returnedFor(1_000_000_000n)).toString()},
    klendCurrentConfig:{slot:preContext.context.slot,program:KLEND.toBase58(),
      reserve:KLEND_RESERVE.toBase58(),market:market.toBase58(),marketAuthority:marketAuthority.toBase58(),
      mint:NATIVE_MINT.toBase58(),supply:supply.toBase58(),feeVault:feeVault.toBase58(),
      reserveAvailableRaw:reserveAvailable.toString(),supplyAmountRaw:supplyRaw.toString(),
      effectiveAvailableRaw:available.toString(),flashLoanFeeSf:klend.config.fees.flash_loan_fee_sf,
      feeInterpretation:'exactly_zero_configured_rate_not_rounding',status:klend.config.status},
    actors:{flashOwner:OWNER.toBase58(),ownerWsol:OWNER_WSOL.toBase58(),
      ownerPool:OWNER_POOL.toBase58(),stakeHolder:HOLDER.toBase58(),holderPool:HOLDER_POOL.toBase58(),
      outsider:OUTSIDER.toBase58(),destinationStake:DEST_STAKE.toBase58()},
    sourceTemplate:{signature:flashHistory.hits[0].signature,slot:flashHistory.hits[0].slot},
    limits:{maxWireBytes:4096,maxInlineAddresses:64,noAddressLookupTables:true,
      configuredComputeUnits:1400000,configuredLoadedAccountDataBytes:67108864,localLimits},
    rents:{tokenAccount:tokenRent.toString(),stakeAccount200:stakeRent.toString()},
    preSlot:preContext.context.slot,pre,outputs};
  fs.writeFileSync('composer-runs/2026-10-15/sanctum-splmulti-klend-v1.json',
    JSON.stringify(result,null,2)+'\n');
}

main().catch(error=>{console.error(error.stack);process.exitCode=1;});
