// Read-only Solana v1 simulation of the current GRASS Kamino flash reserve and GRASS controller.
// No signatures are made and no transaction is submitted.
const fs = require('fs');
const crypto = require('crypto');
const {Connection, PublicKey, TransactionInstruction, TransactionMessage,
  VersionedTransaction} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const {encodeV1} = require('./klend-v1-composition.js');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
const connection = new Connection(url, 'confirmed');
const P = x => new PublicKey(x);
const klend = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const controller = P('EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc');
const tokenProgram = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ixSysvar = P('Sysvar1nstructions1111111111111111111111111');
const memoProgram = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const sourceSignature = '2p1huVXX3pS2Dq5ShaZP25M5J7dcAhg5HPMEPu4gFvEXUJJANM2piZZ6vF8RmmJtkj4xyoNwar3RXAnrzBHAS1xa';
const stakeSource = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/flashloan-grass-stake-source.json'));
const unstakeSource = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/flashloan-grass-user-unstake-source.json'));
const claimSource = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/flashloan-grass-claim-source.json'));
const owner = P('GYWTJ88vpxGh8WZRygxUByH39ufi34RNuB3nRKPVQjUD');
const destination = P('4YxvN7qeK9Mk32TzjjKNF72yPBAM4zx5kvV3dQeyMyvF');
const vault = P('GBSdbtzKg6A1a9HM99AvCUWpzXbDq4hbgAX5Q48N7VRK');
const reserve = P('edvzA1zGyCWqsgM2EBEPhLgn9dfiqrYwJM4VwLg4wBx');
const market = P('ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5');
const [marketAuthority] = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], klend);
const grassMint = P('Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs');
const supply = P('C4gWwFQjaW6c1pP5p2gWJAL4GCB7k9yrdot8g3WuURvm');
const feeVault = P('EVTRSdajwqWfCRGam9MaK268UT9bVKdrrhDKBJh2pKDT');
const rewardPool = P('2cBniUjRr8M9wbNp91SETKtJEdhuXb5fDi89sZYiN1DQ');
const claimantState = P('3q5npT5PAsivpj1KPCK6sfazGiUgEKLQdcYgMaQAuuK7');
const schedule = P('EMTwxePUi5Qp9NE6hFC3Rb6pRFRNyCToY2bhw81QVRFB');
const collateralMint = P('Cr2HKH2fC38XXWGRXZToVJRL9eMi36n9gpx4kgbzevNF');
const rewardVault = P('7FZRSVR4Wf8p26cuNX86zy3FJA86xni1pXokbueuww5J');
const routerDestination = P('cCLjaRdDtbVjx2rSzEbmjQ68mAboHq5ywRbmL3bnAi8');
const rewardPoolState = P('8jX6h76wzVMwdnbZ4fhXt7zEAriynbdLMExPipvHAWYW');
const watched = [supply, feeVault, destination, vault, reserve, rewardPool, claimantState,
  schedule, collateralMint, rewardVault, routerDestination, rewardPoolState];
const metadata = {
  reserve, market, marketAuthority, grassMint, supply, feeVault, owner,
  destination, vault, rewardPool, claimantState, schedule, collateralMint,
  rewardVault, routerDestination, rewardPoolState,
};
const idl = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/marginfi-source/idls-complete/kamino_lending.json'));
const reserveCoder = new anchor.BorshAccountsCoder(idl);
const disc = name => Buffer.from(idl.instructions.find(x => x.name === name).discriminator);
function flash(kind, amount, borrowIndex = 0, source = destination, target = destination) {
  const borrow = kind === 'borrow';
  const keys = [owner, marketAuthority, market, reserve, grassMint,
    supply, borrow ? target : source, feeVault, klend, klend,
    ixSysvar, tokenProgram].map((pubkey, index) => ({pubkey,
    isSigner: index === 0,
    isWritable: [3,5,6,7].includes(index)}));
  const amountBytes = Buffer.alloc(8); amountBytes.writeBigUInt64LE(amount);
  const data = Buffer.concat([disc(borrow ? 'flash_borrow_reserve_liquidity' :
    'flash_repay_reserve_liquidity'), amountBytes, ...(borrow ? [] : [Buffer.from([borrowIndex])])]);
  return new TransactionInstruction({programId: klend, keys, data});
}
function clone(ix) {return new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map(x => ({...x})), data: Buffer.from(ix.data)});}
function sourceInstruction(source, discriminatorHex) {
  const item = source.instructions.find(x => x.program === controller.toBase58() &&
    x.dataHex.startsWith(discriminatorHex));
  if (!item) throw new Error('Historical target instruction missing: ' + discriminatorHex);
  return new TransactionInstruction({programId: controller,
    keys: item.keys.map(x => ({pubkey:P(x.address),isSigner:x.signer,isWritable:x.writable})),
    data: Buffer.from(item.dataHex,'hex')});
}
function stakeTokens(amount) {
  const ix = sourceInstruction(stakeSource,'887e5ba228830d7f');
  ix.keys[0].pubkey = claimantState;
  ix.keys[5].pubkey = destination;
  ix.keys[7].pubkey = owner;
  ix.data.writeBigUInt64LE(amount,8);
  return ix;
}
function unstakeTokens(amount) {
  const ix = sourceInstruction(unstakeSource,'3a77d78fcbdf2056');
  ix.data.writeBigUInt64LE(amount,8);
  return ix;
}
function claimRewards() {
  const ix = sourceInstruction(claimSource,'0490844774179750');
  ix.keys[2].pubkey = claimantState;
  ix.keys[6].pubkey = destination;
  ix.keys[8].pubkey = owner;
  return ix;
}
function transferChecked(from, to, amount) {
  const data = Buffer.alloc(10); data[0] = 12; data.writeBigUInt64LE(amount,1); data[9] = 9;
  return new TransactionInstruction({programId: tokenProgram, keys: [
    {pubkey: from,isSigner:false,isWritable:true},
    {pubkey: grassMint,isSigner:false,isWritable:false},
    {pubkey: to,isSigner:false,isWritable:true},
    {pubkey: owner,isSigner:true,isWritable:false},
  ],data});
}
function decodeAccount(account, index) {
  if (!account?.data?.[0]) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const base = {owner: account.owner, dataLength: data.length,
    hash: crypto.createHash('sha256').update(data).digest('hex')};
  if (index < 4 || index === 9 || index === 10) return {...base,
    mint: new PublicKey(data.subarray(0,32)).toBase58(),
    tokenAuthority: new PublicKey(data.subarray(32,64)).toBase58(),
    rawAmount: data.readBigUInt64LE(64).toString()};
  if (index === 4) {
    const state = reserveCoder.decode('Reserve',data);
    const liquidity = state.liquidity;
    return {...base, rawBase64: data.toString('base64'), lastUpdate: {
      slot: state.last_update.slot.toString(), stale: state.last_update.stale,
      priceStatus: state.last_update.price_status, timestamp: state.last_update.timestamp,
    },
    totalAvailableRaw: liquidity.total_available_amount.toString(),
    borrowedAmountSf: liquidity.borrowed_amount_sf.toString(),
    accumulatedProtocolFeesSf: liquidity.accumulated_protocol_fees_sf.toString(),
    accumulatedReferrerFeesSf: liquidity.accumulated_referrer_fees_sf.toString(),
    pendingReferrerFeesSf: liquidity.pending_referrer_fees_sf.toString(),
    cumulativeBorrowRateBsf: liquidity.cumulative_borrow_rate_bsf.value.map(x=>x.toString()),
    collateralMintTotalSupplyRaw: state.collateral.mint_total_supply.toString()};
  }
  if (index === 8) return {...base, mintSupplyRaw: data.readBigUInt64LE(36).toString()};
  return {...base, rawBase64: data.toString('base64')};
}
async function rpc(method, params) {
  let lastError;
  for (let attempt=0;attempt<6;attempt++) {
    try {
      const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
      if (!response.ok) throw new Error(`HTTP ${response.status} ${method}`);
      const json = await response.json();
      if (json.error) return {error: json.error};
      return json.result;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve,400*2**attempt));
    }
  }
  throw lastError;
}
async function livePre() {
  const r = await rpc('getMultipleAccounts', [watched.map(x => x.toBase58()),
    {encoding: 'base64', commitment: 'confirmed'}]);
  if (r.error) return {rpcError: r.error};
  return {slot: r.context.slot, accounts: watched.map((key, index) => ({key: key.toBase58(),
    state: decodeAccount(r.value[index], index)}))};
}
async function decompileSource() {
  const raw = await rpc('getTransaction', [sourceSignature,
    {encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
  if (raw.error || !raw) throw new Error('Source transaction unavailable: ' + JSON.stringify(raw.error));
  const tx = VersionedTransaction.deserialize(Buffer.from(raw.transaction[0], 'base64'));
  const alts = await Promise.all((tx.message.addressTableLookups || []).map(async x => {
    const lookup = await connection.getAddressLookupTable(x.accountKey);
    if (!lookup.value) throw new Error('ALT unavailable: ' + x.accountKey);
    return lookup.value;
  }));
  const msg = TransactionMessage.decompile(tx.message, {addressLookupTableAccounts: alts});
  const ix = msg.instructions.find(x => x.programId.equals(controller));
  if (!ix) throw new Error('No controller instruction');
  const withdraw = clone(ix);
  withdraw.keys[3].pubkey = claimantState;
  withdraw.keys[5].pubkey = destination;
  withdraw.keys[6].pubkey = owner;
  return {payer: msg.payerKey, withdraw, sourceSlot: raw.slot};
}
async function simulate(label, instructions, payer, blockhash) {
  const encoded = encodeV1(instructions, payer, blockhash, 1400000, 67108864);
  const pre = await livePre();
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'),
    {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
      commitment: 'confirmed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map(x => x.toBase58())}}]);
  if (result.error) return {label, transportError: result.error, v1Bytes: encoded.sizeBytes,
    v0Bytes: encoded.v0Bytes, pre};
  const v = result.value;
  return {label, v1Bytes: encoded.sizeBytes, v0Bytes: encoded.v0Bytes,
    instructionCount: encoded.instructionCount, addressCount: encoded.addressCount,
    requiredSignatures: encoded.requiredSignatures,
    pre, simulationSlot: result.context.slot, err: v.err,
    unitsConsumed: v.unitsConsumed, loadedAccountsDataSize: v.loadedAccountsDataSize,
    post: watched.map((key,index) => ({key: key.toBase58(), state: decodeAccount(v.accounts?.[index], index)})),
    logs: v.logs};
}
async function main() {
  const source = await decompileSource();
  const {blockhash} = await connection.getLatestBlockhash('confirmed');
  const supplyPre = await connection.getAccountInfo(supply, 'confirmed');
  const available = supplyPre.data.readBigUInt64LE(64);
  const specs = [
    ['withdraw_control', [clone(source.withdraw)]],
    ['flash_1_borrow_repay', [flash('borrow',1n),flash('repay',1n,0)]],
    ['flash_1_borrow_withdraw_repay', [flash('borrow',1n),clone(source.withdraw),flash('repay',1n,0)]],
    ['flash_1_withdraw_borrow_repay', [clone(source.withdraw),flash('borrow',1n),flash('repay',1n,1)]],
    ['flash_2_borrow_repay', [flash('borrow',2n),flash('repay',2n,0)]],
    ['flash_1000_borrow_repay', [flash('borrow',1000n),flash('repay',1000n,0)]],
    ['flash_near_available_borrow_repay', [flash('borrow',available-1n),flash('repay',available-1n,0)]],
    ['flash_near_available_borrow_withdraw_repay', [flash('borrow',available-1n),clone(source.withdraw),flash('repay',available-1n,0)]],
    ['flash_exact_available_borrow_repay', [flash('borrow',available),flash('repay',available,0)]],
    ['flash_zero_borrow_repay', [flash('borrow',0n),flash('repay',0n,0)]],
    ['flash_over_available_borrow_repay', [flash('borrow',available+1n),flash('repay',available+1n,0)]],
    ['flash_1_borrow_repay_withdraw', [flash('borrow',1n),flash('repay',1n,0),clone(source.withdraw)]],
    ['flash_1_borrow_double_withdraw_repay', [flash('borrow',1n),clone(source.withdraw),clone(source.withdraw),flash('repay',1n,0)]],
    ['flash_1_borrow_self_transfer_repay', [flash('borrow',1n),transferChecked(destination,destination,1n),flash('repay',1n,0)]],
    ['flash_1_borrow_deposit_vault_withdraw_repay', [flash('borrow',1n),transferChecked(destination,vault,1n),clone(source.withdraw),flash('repay',1n,0)]],
    ['flash_1_borrow_to_controller_vault_repay_from_vault',
      [flash('borrow',1n,0,destination,vault),flash('repay',1n,0,vault)]],
    ['flash_1_borrow_to_reserve_supply_repay_from_supply',
      [flash('borrow',1n,0,destination,supply),flash('repay',1n,0,supply)]],
    ['flash_1_borrow_no_repay', [flash('borrow',1n)]],
    ['flash_1_borrow_wrong_repay_index', [flash('borrow',1n),flash('repay',1n,1)]],
    ['flash_1_borrow_underpay', [flash('borrow',1n),flash('repay',0n,0)]],
    ['flash_1_double_borrow_repay', [flash('borrow',1n),flash('borrow',1n),flash('repay',1n,0)]],
    ['flash_1_borrow_repay_repay', [flash('borrow',1n),flash('repay',1n,0),flash('repay',1n,0)]],
  ];
  const freshWithdraw = clone(source.withdraw);
  freshWithdraw.data[8] = 1;
  specs.push(['stake_1_without_flash', [stakeTokens(1n)]]);
  specs.push(['stake_minimum_without_flash', [stakeTokens(1000000n)]]);
  specs.push(['claim_rewards_without_flash', [claimRewards()]]);
  for (const amount of [1n,1000000n,available-1n]) {
    const sizeName = amount === 1n ? '1' : amount === 1000000n ? 'stake_minimum' : 'near_available';
    specs.push([`flash_${sizeName}_stake_unstake_fresh_withdraw_repay`,
      [flash('borrow',amount),stakeTokens(amount),unstakeTokens(amount),clone(freshWithdraw),flash('repay',amount,0)]]);
    specs.push([`flash_${sizeName}_stake_unstake_old_withdraw_repay`,
      [flash('borrow',amount),stakeTokens(amount),unstakeTokens(amount),clone(source.withdraw),flash('repay',amount,0)]]);
    specs.push([`flash_${sizeName}_stake_claim_unstake_repay`,
      [flash('borrow',amount),stakeTokens(amount),claimRewards(),unstakeTokens(amount),flash('repay',amount,0)]]);
    specs.push([`flash_${sizeName}_stake_claim_unstake_old_withdraw_repay`,
      [flash('borrow',amount),stakeTokens(amount),claimRewards(),unstakeTokens(amount),
        clone(source.withdraw),flash('repay',amount,0)]]);
  }
  for (let n of [2,5,10]) {
    const instructions = [];
    for (let i=0;i<n;i++)instructions.push(flash('borrow',1n),flash('repay',1n,i*2));
    specs.push([`flash_1_${n}_pairs`,instructions]);
  }
  for (let n of [20,60]) {
    const legs = Array.from({length:n}, () => transferChecked(destination,destination,1n));
    specs.push([`flash_1_${n}_self_transfer_legs`,[flash('borrow',1n),...legs,flash('repay',1n,0)]]);
  }
  // One valid memo pads the actual v1 wire to the 4,096-byte protocol ceiling.
  const pad = new TransactionInstruction({programId:memoProgram,keys:[],data:Buffer.alloc(3252,71)});
  specs.push(['flash_1_memo_withdraw_repay_v1_4096_bytes',
    [flash('borrow',1n),pad,clone(source.withdraw),flash('repay',1n,0)]]);
  const cases = [];
  for (const [label, instructions] of specs.filter(([label]) => !process.env.FLASH_CASE ||
    label === process.env.FLASH_CASE)) {
    const result = await simulate(label, instructions, source.payer, blockhash);
    cases.push(result);
    console.log(JSON.stringify({label, err: result.err, transportError: result.transportError,
      v1Bytes: result.v1Bytes, simulationSlot: result.simulationSlot,
      unitsConsumed: result.unitsConsumed,
      postAmounts: result.post?.slice(0,5).map(x => x.state?.rawAmount ?? x.state?.totalAvailableRaw),
      logTail: result.logs?.filter(x => x.includes('Instruction:') || x.includes('Error') ||
        x.includes('failed')).slice(-4)}));
  }
  const output = {timestamp: new Date().toISOString(), transport: 'read-only mainnet simulateTransaction',
    sigVerify: false, liveSubmission: false, sourceSignature, sourceSlot: source.sourceSlot,
    programIds: {klend: klend.toBase58(), controller: controller.toBase58()},
    accounts: Object.fromEntries(Object.entries(metadata).map(([key,value]) => [key,value.toBase58()])),
    initialAvailableRaw: available.toString(), cases};
  fs.writeFileSync(process.env.FLASH_OUTPUT || 'composer-runs/2026-10-15/flashloan-grass-v1.json',
    JSON.stringify(output,null,2)+'\n');
}
main().catch(error => {console.error(error.stack); process.exitCode = 1;});
