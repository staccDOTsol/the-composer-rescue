// Read-only current-mainnet v1 flash composition across KLend and Sanctum Unstake.
// Builds real v1 wire transactions, but never signs or submits them.
const fs = require('fs');
const crypto = require('crypto');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const {
  Connection, PublicKey, Keypair, SystemProgram, TransactionInstruction,
  TransactionMessage,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {encodeV1} = require('./klend-v1-composition.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const conn = new Connection(rpcUrl, 'confirmed');
const P = value => new PublicKey(value);

const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const SANCTUM = P('unpXTU2Ndrc7WWNyEhQWe4udTzSibLPi25SXv2xbCHQ');
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const NATIVE_MINT = P('So11111111111111111111111111111111111111112');
const INSTRUCTIONS = P('Sysvar1nstructions1111111111111111111111111');
const RENT = P('SysvarRent111111111111111111111111111111111');
const MEMO = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Existing real Sanctum LP holder used as simulated signer and fee payer.
const OWNER = P('Hx8vjCsqxWxnu95Yhx98TX4MQo9ig1QVnVuubrcgPpv3');
const OWNER_WSOL = P('GTgGLm6yhqk2jHpFLeYiUq269YjtpwkbYADm46qpzuN9');
const OWNER_LP = P('k5hQmYM3ALoB7NSQjx4E9R2zFZEXjnPB6f1mvAbEjzP');

const POOL = P('FypPtwbY3FUfzJUtXHSyVRokVKG2jKtH29FmK4ebxRSd');
const SANCTUM_RESERVE = P('3rBnnH9TTgd3xwu48rnzGsaQkSr1hR64nY71DrDt6VrQ');
const LP_MINT = P('uns3MbshJq1TmTyTF2iitMduevPktNKbePD73Wx4jQK');
const SANCTUM_FLASH = P('BvCe729YxGXqgyVBW4r4R8S7ypkYm7KUyzVbTMai8kUc');

// Largest active zero-fee WSOL KLend reserve found in the current reserve census.
const KLEND_RESERVE = P('4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM');
const idl = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/marginfi-source/idls-complete/kamino_lending.json'));
const coder = new anchor.BorshAccountsCoder(idl);
const source = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/kamino-flash-history.json'));
const sample = source.hits[0].transaction;
const msg = sample.transaction.message;
const staticKeys = msg.accountKeys;
const allKeys = [...staticKeys, ...(sample.meta.loadedAddresses?.writable || []),
  ...(sample.meta.loadedAddresses?.readonly || [])];
const head = msg.header;
const writable = idx => idx < staticKeys.length ?
  (idx < head.numRequiredSignatures ? idx < head.numRequiredSignatures - head.numReadonlySignedAccounts :
    idx < staticKeys.length - head.numReadonlyUnsignedAccounts) :
  idx < staticKeys.length + (sample.meta.loadedAddresses?.writable?.length || 0);
const sampleIx = idx => {
  const src = msg.instructions[idx];
  return new TransactionInstruction({programId: P(allKeys[src.programIdIndex]),
    keys: src.accounts.map(i => ({pubkey: P(allKeys[i]), isSigner: i < head.numRequiredSignatures,
      isWritable: writable(i)})), data: Buffer.from(bs58.decode(src.data))});
};
const borrowTemplate = sampleIx(3);
const repayTemplate = sampleIx(13);
if (!borrowTemplate.programId.equals(KLEND) || !repayTemplate.programId.equals(KLEND))
  throw new Error('Historical KLend flash instruction indexes changed');

const tempSeed = crypto.createHash('sha256').update('sanctum-klend-flash-v1-temp').digest().subarray(0, 32);
const TEMP_WSOL = Keypair.fromSeed(tempSeed).publicKey;
const u64 = value => {const data = Buffer.alloc(8); data.writeBigUInt64LE(BigInt(value)); return data;};
const disc = name => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

function normalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof PublicKey) return value.toBase58();
  if (value.constructor?.name === 'BN') return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
}

function tokenTransfer(source, destination, authority, amount) {
  return new TransactionInstruction({programId:TOKEN, keys:[
    {pubkey:source,isSigner:false,isWritable:true},
    {pubkey:destination,isSigner:false,isWritable:true},
    {pubkey:authority,isSigner:true,isWritable:false},
  ], data:Buffer.concat([Buffer.from([3]),u64(amount)])});
}

function tokenClose(account, destination, authority) {
  return new TransactionInstruction({programId:TOKEN, keys:[
    {pubkey:account,isSigner:false,isWritable:true},
    {pubkey:destination,isSigner:false,isWritable:true},
    {pubkey:authority,isSigner:true,isWritable:false},
  ], data:Buffer.from([9])});
}

function tokenInitNativeAccount3(account, owner) {
  return new TransactionInstruction({programId:TOKEN, keys:[
    {pubkey:account,isSigner:false,isWritable:true},
    {pubkey:NATIVE_MINT,isSigner:false,isWritable:false},
  ], data:Buffer.concat([Buffer.from([18]),owner.toBuffer()])});
}

function syncNative(account) {
  return new TransactionInstruction({programId:TOKEN,
    keys:[{pubkey:account,isSigner:false,isWritable:true}],data:Buffer.from([17])});
}

function addLiquidity(amount) {
  return new TransactionInstruction({programId:SANCTUM,keys:[
    {pubkey:OWNER,isSigner:true,isWritable:true},
    {pubkey:POOL,isSigner:false,isWritable:true},
    {pubkey:SANCTUM_RESERVE,isSigner:false,isWritable:true},
    {pubkey:LP_MINT,isSigner:false,isWritable:true},
    {pubkey:OWNER_LP,isSigner:false,isWritable:true},
    {pubkey:SANCTUM_FLASH,isSigner:false,isWritable:true},
    {pubkey:TOKEN,isSigner:false,isWritable:false},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
  ],data:Buffer.concat([disc('add_liquidity'),u64(amount)])});
}

function removeLiquidity(amount, reserve = SANCTUM_RESERVE) {
  return new TransactionInstruction({programId:SANCTUM,keys:[
    {pubkey:OWNER,isSigner:true,isWritable:false},
    {pubkey:OWNER,isSigner:false,isWritable:true},
    {pubkey:POOL,isSigner:false,isWritable:true},
    {pubkey:reserve,isSigner:false,isWritable:true},
    {pubkey:LP_MINT,isSigner:false,isWritable:true},
    {pubkey:OWNER_LP,isSigner:false,isWritable:true},
    {pubkey:SANCTUM_FLASH,isSigner:false,isWritable:true},
    {pubkey:TOKEN,isSigner:false,isWritable:false},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
  ],data:Buffer.concat([disc('remove_liquidity'),u64(amount)])});
}

function flashIx(template, market, marketAuthority, supply, feeVault, amount, repayIndex) {
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
  keys[11].pubkey = TOKEN;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(BigInt(amount), 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId:KLEND,keys,data});
}

function accountImage(key, value) {
  if (!value) return null;
  const data = Buffer.from(value.data[0], 'base64');
  const common = {lamports:String(value.lamports),owner:value.owner,dataLen:data.length,
    dataSha256:crypto.createHash('sha256').update(data).digest('hex')};
  if (value.owner === TOKEN.toBase58() && data.length === 165)
    return {...common,type:'token',mint:new PublicKey(data.subarray(0,32)).toBase58(),
      authority:new PublicKey(data.subarray(32,64)).toBase58(),amount:data.readBigUInt64LE(64).toString()};
  if (key.equals(LP_MINT) && data.length === 82)
    return {...common,type:'mint',supply:data.readBigUInt64LE(36).toString(),decimals:data[44]};
  if (key.equals(POOL) && data.length >= 88)
    return {...common,type:'sanctum_pool',incomingStake:data.readBigUInt64LE(72).toString(),
      recordRentCounter:data.readBigUInt64LE(80).toString()};
  if (key.equals(KLEND_RESERVE)) {
    try {
      const decoded = normalize(coder.decode('Reserve', data));
      return {...common,type:'klend_reserve',totalAvailable:decoded.liquidity.total_available_amount,
        flashLoanFeeSf:decoded.config.fees.flash_loan_fee_sf,status:decoded.config.status};
    } catch (_) {}
  }
  return {...common,type:data.length ? 'opaque' : 'system'};
}

function delta(before, after, field) {
  if (before?.[field] === undefined || after?.[field] === undefined) return null;
  return (BigInt(after[field]) - BigInt(before[field])).toString();
}

async function main() {
  const reserveInfo = await conn.getAccountInfo(KLEND_RESERVE, 'confirmed');
  if (!reserveInfo) throw new Error('Selected KLend WSOL reserve is unavailable');
  const decoded = normalize(coder.decode('Reserve', reserveInfo.data));
  if (decoded.liquidity.mint_pubkey !== NATIVE_MINT.toBase58())
    throw new Error('Selected reserve is not WSOL');
  if (decoded.config.fees.flash_loan_fee_sf !== '0')
    throw new Error('Selected reserve is not exactly zero fee');
  if (decoded.config.status !== 0) throw new Error('Selected reserve is not active');
  const market = P(decoded.lending_market);
  const marketAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from('lma'),market.toBuffer()],KLEND)[0];
  const supply = P(decoded.liquidity.supply_vault);
  const feeVault = P(decoded.liquidity.fee_vault);
  const [supplyInfo, ownerWsolInfo, tempInfo, poolInfo, sanctumReserveInfo, lpMintInfo] =
    await conn.getMultipleAccountsInfo([supply,OWNER_WSOL,TEMP_WSOL,POOL,SANCTUM_RESERVE,LP_MINT],'confirmed');
  if (!supplyInfo || supplyInfo.data.length !== 165) throw new Error('WSOL supply vault unavailable');
  if (!ownerWsolInfo || ownerWsolInfo.data.length !== 165) throw new Error('Owner WSOL control unavailable');
  if (tempInfo) throw new Error('Deterministic temporary WSOL account already exists');
  const supplyAmount = supplyInfo.data.readBigUInt64LE(64);
  const reserveAvailable = BigInt(decoded.liquidity.total_available_amount);
  const available = supplyAmount < reserveAvailable ? supplyAmount : reserveAvailable;
  if (available < 1_000_000_000n) throw new Error('Selected WSOL reserve has insufficient live liquidity');
  const tokenRent = BigInt(await conn.getMinimumBalanceForRentExemption(165, 'confirmed'));
  const poolOwned = BigInt(sanctumReserveInfo.lamports) + poolInfo.data.readBigUInt64LE(72) +
    poolInfo.data.readBigUInt64LE(80);
  const lpSupply = lpMintInfo.data.readBigUInt64LE(36);
  const mintedFor = amount => BigInt(amount) * lpSupply / poolOwned;
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const watched = [OWNER,OWNER_WSOL,TEMP_WSOL,supply,feeVault,KLEND_RESERVE,
    SANCTUM_RESERVE,POOL,LP_MINT,OWNER_LP];
  const preContext = await conn.getMultipleAccountsInfoAndContext(watched,'confirmed');
  const pre = Object.fromEntries(watched.map((key,index) =>
    [key.toBase58(),accountImage(key,preContext.value[index] ? {
      lamports:preContext.value[index].lamports,owner:preContext.value[index].owner.toBase58(),
      data:[preContext.value[index].data.toString('base64'),'base64']} : null)]));

  const createTemp = () => [
    SystemProgram.createAccount({fromPubkey:OWNER,newAccountPubkey:TEMP_WSOL,
      lamports:Number(tokenRent),space:165,programId:TOKEN}),
    tokenInitNativeAccount3(TEMP_WSOL,OWNER),
  ];
  const wrapForRepay = amount => [
    SystemProgram.transfer({fromPubkey:OWNER,toPubkey:OWNER_WSOL,lamports:Number(amount)}),
    syncNative(OWNER_WSOL),
  ];
  const flashPair = (amount, borrowIndex = 0, wrongRepayIndex) => [
    flashIx(borrowTemplate,market,marketAuthority,supply,feeVault,amount),
    flashIx(repayTemplate,market,marketAuthority,supply,feeVault,amount,
      wrongRepayIndex === undefined ? borrowIndex : wrongRepayIndex),
  ];
  const compose = (amount, cycles = 1, options = {}) => {
    const instructions = [...createTemp()];
    const borrowIndex = instructions.length;
    instructions.push(flashIx(borrowTemplate,market,marketAuthority,supply,feeVault,amount));
    instructions.push(tokenTransfer(OWNER_WSOL,TEMP_WSOL,OWNER,amount));
    instructions.push(tokenClose(TEMP_WSOL,OWNER,OWNER));
    if (options.repayBeforeTarget) {
      instructions.push(flashIx(repayTemplate,market,marketAuthority,supply,feeVault,amount,borrowIndex));
      return instructions;
    }
    const minted = mintedFor(amount);
    for (let i = 0; i < cycles; i++) {
      instructions.push(addLiquidity(amount));
      instructions.push(removeLiquidity(minted, options.wrongReserve && i === 0 ? OWNER : SANCTUM_RESERVE));
    }
    instructions.push(...wrapForRepay(amount));
    instructions.push(flashIx(repayTemplate,market,marketAuthority,supply,feeVault,amount,
      options.wrongRepayIndex === undefined ? borrowIndex : options.wrongRepayIndex));
    return instructions;
  };
  const repeatedFlashPairs = (count, amount) => {
    const instructions = [];
    for (let i = 0; i < count; i++) {
      const borrowIndex = instructions.length;
      instructions.push(flashIx(borrowTemplate,market,marketAuthority,supply,feeVault,amount));
      instructions.push(flashIx(repayTemplate,market,marketAuthority,supply,feeVault,amount,borrowIndex));
    }
    return instructions;
  };
  const directWrappedBlocker = amount => {
    const borrow = flashIx(borrowTemplate,market,marketAuthority,supply,feeVault,amount);
    const repay = flashIx(repayTemplate,market,marketAuthority,supply,feeVault,amount,0);
    return [borrow,addLiquidity(amount),removeLiquidity(mintedFor(amount)),repay];
  };
  const padInlineAccounts = (sourceInstructions, targetCount) => {
    const instructions = sourceInstructions.map(ix => new TransactionInstruction({
      programId:ix.programId,keys:ix.keys.map(key => ({...key})),data:Buffer.from(ix.data),
    }));
    const targetIx = instructions.find(ix => ix.programId.equals(SANCTUM));
    if (!targetIx) throw new Error('No Sanctum instruction available for account padding');
    let nonce = 0;
    while (new TransactionMessage({payerKey:OWNER,recentBlockhash:blockhash,
      instructions}).compileToV0Message().staticAccountKeys.length < targetCount) {
      const seed = crypto.createHash('sha256').update(`v1-inline-account-${nonce++}`).digest().subarray(0,32);
      const pubkey = Keypair.fromSeed(seed).publicKey;
      targetIx.keys.push({pubkey,isSigner:false,isWritable:false});
    }
    return instructions;
  };
  const padWireBytes = (sourceInstructions, targetBytes) => {
    const instructions = sourceInstructions.map(ix => new TransactionInstruction({
      programId:ix.programId,keys:ix.keys.map(key => ({...key})),data:Buffer.from(ix.data),
    }));
    const memoIx = instructions.find(ix => ix.programId.equals(MEMO));
    if (!memoIx) throw new Error('No memo instruction available for wire padding');
    const initial = encodeV1(instructions,OWNER,blockhash).sizeBytes;
    if (initial > targetBytes) throw new Error(`Initial wire ${initial} exceeds target ${targetBytes}`);
    memoIx.data = Buffer.alloc(targetBytes - initial,0x61);
    if (encodeV1(instructions,OWNER,blockhash).sizeBytes !== targetBytes)
      throw new Error(`Could not construct exact ${targetBytes}-byte wire`);
    return instructions;
  };
  const maxInlineComposition = padWireBytes(padInlineAccounts([
    ...compose(1_000_000_000n),
    new TransactionInstruction({programId:MEMO,keys:[],data:Buffer.alloc(0)}),
  ],64),4096);
  const overWireComposition = maxInlineComposition.map(ix => new TransactionInstruction({
    programId:ix.programId,keys:ix.keys.map(key => ({...key})),data:Buffer.from(ix.data),
  }));
  const overWireMemo = overWireComposition.find(ix => ix.programId.equals(MEMO));
  overWireMemo.data = Buffer.concat([overWireMemo.data,Buffer.from([0x61])]);
  const overInlineComposition = padInlineAccounts(compose(1_000_000_000n),65);
  const cases = [
    ['control_sync_native_only',[syncNative(OWNER_WSOL)]],
    ['positive_flash_pair_1_raw',flashPair(1n)],
    ['positive_flash_pair_available_minus_1',flashPair(available - 1n)],
    ['boundary_flash_pair_available',flashPair(available)],
    ['boundary_flash_pair_available_plus_1',flashPair(available + 1n)],
    ['direct_wrapped_sol_to_sanctum_blocker_1_sol',directWrappedBlocker(1_000_000_000n)],
    ['target_threshold_minus_1_raw',compose(1n)],
    ['target_threshold_2_raw',compose(2n)],
    ['target_round_trip_1_sol',compose(1_000_000_000n)],
    ['target_near_available_round_trip',compose(available - 1n)],
    ['target_available_round_trip',compose(available)],
    ['target_max_v1_4096_bytes_64_accounts',maxInlineComposition],
    ['target_4097_wire_bytes_rejected',overWireComposition],
    ['target_65_inline_accounts_rejected',overInlineComposition],
    ['target_two_round_trips',compose(1_000_000_000n,2)],
    ['target_four_round_trips',compose(1_000_000_000n,4)],
    ['target_six_round_trips',compose(1_000_000_000n,6)],
    ['target_eight_round_trips',compose(1_000_000_000n,8)],
    ['target_nine_round_trips',compose(1_000_000_000n,9)],
    ['target_ten_round_trips',compose(1_000_000_000n,10)],
    ['target_wrong_reserve_alias',compose(1_000_000_000n,1,{wrongReserve:true})],
    ['target_repay_before_rewrap',compose(1_000_000_000n,1,{repayBeforeTarget:true})],
    ['target_wrong_repay_index',compose(1_000_000_000n,1,{wrongRepayIndex:0})],
    ['two_flash_pairs',repeatedFlashPairs(2,1_000_000n)],
    ['four_flash_pairs',repeatedFlashPairs(4,1_000_000n)],
    ['eight_flash_pairs',repeatedFlashPairs(8,1_000_000n)],
  ];
  const outputs = [];
  for (const [name,instructions] of cases) {
    try {
      const encoded = encodeV1(instructions,OWNER,blockhash);
      const v0 = new TransactionMessage({payerKey:OWNER,recentBlockhash:blockhash,
        instructions}).compileToV0Message();
      const messageKeySet = new Set(v0.staticAccountKeys.map(key => key.toBase58()));
      const requestedKeys = watched.filter(key => messageKeySet.has(key.toBase58()));
      const response = await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:name,method:'simulateTransaction',params:[
          encoded.wire.toString('base64'),{encoding:'base64',sigVerify:false,
            replaceRecentBlockhash:true,commitment:'confirmed',innerInstructions:true,
            accounts:{encoding:'base64',addresses:requestedKeys.map(key=>key.toBase58())}},
        ]})});
      const json = await response.json();
      const value = json.result?.value;
      const returnedByKey = new Map(requestedKeys.map((key,index) =>
        [key.toBase58(),value?.accounts?.[index]]));
      const post = Object.fromEntries(watched.map(key =>
        [key.toBase58(),accountImage(key,returnedByKey.get(key.toBase58()))]));
      const ownerKey=OWNER.toBase58(), wsolKey=OWNER_WSOL.toBase58(), supplyKey=supply.toBase58();
      const feeKey=feeVault.toBase58(), sReserveKey=SANCTUM_RESERVE.toBase58();
      const mintKey=LP_MINT.toBase58(), lpKey=OWNER_LP.toBase58(), kReserveKey=KLEND_RESERVE.toBase58();
      const deltas={
        ownerLamports:delta(pre[ownerKey],post[ownerKey],'lamports'),
        ownerWsolRaw:delta(pre[wsolKey],post[wsolKey],'amount'),
        klendSupplyRaw:delta(pre[supplyKey],post[supplyKey],'amount'),
        klendFeeRaw:delta(pre[feeKey],post[feeKey],'amount'),
        klendAvailableRaw:delta(pre[kReserveKey],post[kReserveKey],'totalAvailable'),
        sanctumReserveLamports:delta(pre[sReserveKey],post[sReserveKey],'lamports'),
        lpMintSupplyRaw:delta(pre[mintKey],post[mintKey],'supply'),
        ownerLpRaw:delta(pre[lpKey],post[lpKey],'amount'),
      };
      const hasFlashBorrow = instructions.some(ix => ix.programId.equals(KLEND) &&
        ix.data.subarray(0,8).equals(borrowTemplate.data.subarray(0,8)));
      const hasSyncNative = instructions.some(ix => ix.programId.equals(TOKEN) &&
        ix.data.length === 1 && ix.data[0] === 17);
      const preWsol = pre[wsolKey];
      const preexistingWsolSyncDelta = BigInt(preWsol.lamports) - tokenRent - BigInt(preWsol.amount);
      const klendRepaid = hasFlashBorrow ? value?.err === null &&
        deltas.klendSupplyRaw === '0' && deltas.klendFeeRaw === '0' &&
        deltas.klendAvailableRaw === '0' : null;
      const ownerNetRaw = deltas.ownerLamports === null || deltas.ownerWsolRaw === null ? null :
        (BigInt(deltas.ownerLamports) + BigInt(deltas.ownerWsolRaw)).toString();
      const ownerNetExcludingPreexistingSyncRaw = ownerNetRaw === null ? null :
        (BigInt(ownerNetRaw) - (hasSyncNative ? preexistingWsolSyncDelta : 0n)).toString();
      const flashInstruction = instructions.find(ix=>ix.programId.equals(KLEND));
      const output={name,amountRaw:flashInstruction ? String(flashInstruction.data.readBigUInt64LE(8)) : null,
        slot:json.result?.context?.slot,err:value?.err||null,rpcError:json.error||null,
        v1:{sizeBytes:encoded.sizeBytes,wireSha256:crypto.createHash('sha256').update(encoded.wire).digest('hex'),
          wireBase64:encoded.wire.toString('base64'),v0EquivalentBytes:encoded.v0Bytes,
          accountCount:encoded.addressCount,writableCount:encoded.writableCount,
          instructionCount:encoded.instructionCount,requiredSignatures:encoded.requiredSignatures,
          accountKeys:v0.staticAccountKeys.map(key=>key.toBase58()),header:v0.header,
          computeLimit:encoded.config.computeLimit,loadedAccountsDataSizeLimit:encoded.config.dataLimit},
        computeUnitsConsumed:value?.unitsConsumed??null,loadedAccountsDataSize:value?.loadedAccountsDataSize??null,
        loanRepaid:klendRepaid,klendRepaid,
        debt:'not_applicable_stateless_flash_no_obligation',hasSyncNative,
        preexistingWsolSyncDeltaRaw:hasSyncNative ? preexistingWsolSyncDelta.toString() : '0',
        ownerNetRaw,ownerNetExcludingPreexistingSyncRaw,deltas,post,
        logs:value?.logs||null,innerInstructions:value?.innerInstructions||null};
      outputs.push(output);
      console.log(JSON.stringify({name,err:output.err,rpcError:output.rpcError,
        bytes:output.v1.sizeBytes,accounts:output.v1.accountCount,instructions:output.v1.instructionCount,
        units:output.computeUnitsConsumed,klendRepaid,
        ownerNetExcludingPreexistingSyncRaw,deltas,
        lastLogs:(output.logs||[]).filter(line=>/Instruction:|Error|failed:|insufficient|consumed/.test(line)).slice(-8)}));
    } catch (error) {
      outputs.push({name,localError:error.stack});
      console.log(JSON.stringify({name,localError:error.message}));
    }
  }
  const summary={timestamp:new Date().toISOString(),liveSubmission:false,sigVerify:false,
    currentConfig:{slot:preContext.context.slot,program:KLEND.toBase58(),reserve:KLEND_RESERVE.toBase58(),
      market:market.toBase58(),marketAuthority:marketAuthority.toBase58(),mint:NATIVE_MINT.toBase58(),
      supply:supply.toBase58(),feeVault:feeVault.toBase58(),reserveAvailableRaw:String(reserveAvailable),
      supplyAmountRaw:String(supplyAmount),effectiveAvailableRaw:String(available),
      flashLoanFeeSf:decoded.config.fees.flash_loan_fee_sf,
      feeInterpretation:'exactly_zero_configured_rate_not_rounding'},
    sanctum:{program:SANCTUM.toBase58(),pool:POOL.toBase58(),reserve:SANCTUM_RESERVE.toBase58(),
      lpMint:LP_MINT.toBase58(),poolOwnedLamports:String(poolOwned),lpSupplyRaw:String(lpSupply),
      smallestAmountMintingOneRawLp:String((poolOwned+lpSupply-1n)/lpSupply),
      refreshCrankUpdate:'not_applicable_no_such_permissionless_state_refresh_surface'},
    sourceTemplate:{signature:source.hits[0].signature,slot:source.hits[0].slot},
    v1Limits:{maxWireBytes:4096,maxInlineAddresses:64,noAddressLookupTables:true,
      configuredComputeUnits:1400000,configuredLoadedAccountDataBytes:67108864},
    ownerWsolPreSync:{lamports:pre[OWNER_WSOL.toBase58()].lamports,
      tokenAmountRaw:pre[OWNER_WSOL.toBase58()].amount,currentRentExemptReserveRaw:String(tokenRent),
      latentSyncDeltaRaw:(BigInt(pre[OWNER_WSOL.toBase58()].lamports) - tokenRent -
        BigInt(pre[OWNER_WSOL.toBase58()].amount)).toString()},
    watched:watched.map(key=>key.toBase58()),pre,preSlot:preContext.context.slot,outputs};
  fs.writeFileSync('composer-runs/2026-10-15/sanctum-klend-flash-extremes-v1.json',
    JSON.stringify(summary,null,2)+'\n');
}

main().catch(error=>{console.error(error.stack);process.exitCode=1;});
