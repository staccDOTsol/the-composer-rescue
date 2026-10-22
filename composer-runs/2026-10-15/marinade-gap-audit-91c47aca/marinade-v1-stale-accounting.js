// Read-only Solana v1 simulations against the current Marinade mainnet deployment.
// This script never signs or submits a transaction.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, TransactionInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {encodeV1} = require('../klend-v1-composition.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const conn = new Connection(rpcUrl, 'confirmed');
const P = x => new PublicKey(x);
const program = P('MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD');
const state = P('8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC');
const mint = P('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');
const solLeg = P('UefNb6z6yvArqe4cJHTXCqStRsKmWhGxnZzuHbikP5Q');
const msolLeg = P('7GgPYjS5Dza89wV6FpZ23kUJRG5vbQ1GM25ezspYFSoE');
const treasury = P('B1aLzaNMeFVAyQ6f3XbbUyKcH2YPHu2fqiEagmiF23VR');
// Current mainnet whale pair selected only as an unsigned simulation source.
const userToken = P('HBX3MgNtEwCxM3RXzqDxdM98m94DiHcqcYwB16HkbNhF');
const user = P('6LY1JzAFVZsP2a2xKrtU6znQMQ5h4i7tocWdgrkZzkzF');
const reserve = P('Du3Ysj1wKbxPKkuPPnvzQLQh8oMSVifs3jGZjJWXFmHN');
const stakeList = P('Anv3XE7e5saNdm16MU6bniYS59Mpv7DzQXHAhxJUmAKW');
const validatorList = P('DwFYJNnhLmw19FBTrVaLWZ8SZJpxdPoSYVSJaio9tjbY');
// Canonical stake/index pair confirmed by a successful current merge at slot 457342153.
const stakeAccount = P('3tGbZed4ZfxR56CjxQW5kAghcz5gr7fzcXisWFkhdjeG');
const withdrawAuthority = P('9eG63CdHjsfhHmobHgLtESGC8GabbmRcaSpHAZrtmhco');
const system = P('11111111111111111111111111111111');
const token = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const stakeProgram = P('Stake11111111111111111111111111111111111111');
const clock = P('SysvarC1ock11111111111111111111111111111111');
const stakeHistory = P('SysvarStakeHistory1111111111111111111111111');
const [msolLegAuthority] = PublicKey.findProgramAddressSync(
  [state.toBuffer(), Buffer.from('liq_st_sol_authority')], program);
const [mintAuthority] = PublicKey.findProgramAddressSync(
  [state.toBuffer(), Buffer.from('st_mint')], program);
const disc = name => crypto.createHash('sha256').update('global:' + name).digest().subarray(0, 8);
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const meta = (pubkey, writable = false, signer = false) => ({pubkey, isWritable: writable, isSigner: signer});

function deposit(amount) {
  return new TransactionInstruction({programId: program, data: Buffer.concat([disc('deposit'), u64(amount)]), keys: [
    meta(state, true), meta(mint, true), meta(solLeg, true), meta(msolLeg, true),
    meta(msolLegAuthority), meta(reserve, true), meta(user, true, true), meta(userToken, true),
    meta(mintAuthority), meta(system), meta(token),
  ]});
}
function liquid(amount, recipient = user) {
  return new TransactionInstruction({programId: program,
    data: Buffer.concat([disc('liquid_unstake'), u64(amount)]), keys: [
      meta(state, true), meta(mint, true), meta(solLeg, true), meta(msolLeg, true),
      meta(treasury, true), meta(userToken, true), meta(user, false, true), meta(recipient, true),
      meta(system), meta(token),
    ]});
}
function update(stakeIndex = 0, validatorIndex = 544, stake = stakeAccount) {
  return new TransactionInstruction({programId: program,
    data: Buffer.concat([disc('update_active'), u32(stakeIndex), u32(validatorIndex)]), keys: [
      meta(state, true), meta(stakeList, true), meta(stake, true), meta(withdrawAuthority),
      meta(reserve, true), meta(mint, true), meta(mintAuthority), meta(treasury, true),
      meta(clock), meta(stakeHistory), meta(stakeProgram), meta(token), meta(validatorList, true),
    ]});
}

const watched = [user, userToken, state, mint, reserve, solLeg, msolLeg, treasury,
  stakeAccount, stakeList, validatorList];
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
function project(account, i) {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (i === 0 || [4, 5, 8].includes(i)) return {lamports: account.lamports, hash: digest(data)};
  if ([1, 6, 7].includes(i)) return {lamports: account.lamports,
    amount: data.length >= 72 ? data.readBigUInt64LE(64).toString() : null, hash: digest(data)};
  if (i === 3) return {lamports: account.lamports,
    supply: data.length >= 44 ? data.readBigUInt64LE(36).toString() : null, hash: digest(data)};
  return {lamports: account.lamports, hash: digest(data)};
}
async function raw(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: method, method, params})});
  return response.json();
}
async function simulate(name, instructions, blockhash) {
  const encoded = encodeV1(instructions, user, blockhash);
  const json = await raw('simulateTransaction', [encoded.wire.toString('base64'),
    {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
      accounts: {encoding: 'base64', addresses: watched.map(x => x.toBase58())}}]);
  const value = json.result?.value;
  return {name, err: value?.err || null, rpcError: json.error || null, slot: json.result?.context?.slot,
    sizeBytes: encoded.sizeBytes, v0Bytes: encoded.v0Bytes, addressCount: encoded.addressCount,
    instructionCount: encoded.instructionCount, unitsConsumed: value?.unitsConsumed,
    loadedAccountsDataSize: value?.loadedAccountsDataSize,
    post: value?.accounts?.map(project), logs: value?.logs || []};
}
const tokenAmount = result => BigInt(result.post?.[1]?.amount || 0);
const logFacts = result => result.logs.filter(x => /Instruction:|Staking rewards:|Extra lamports|protocol_rewards_fee|user_m_sol_buy_order|msol_to_mint|Fee|failed|Error/.test(x));

async function main() {
  const preInfo = await conn.getMultipleAccountsInfoAndContext(watched, 'confirmed');
  const pre = preInfo.value.map((a, i) => a ? project({data: [a.data.toString('base64')], lamports: a.lamports}, i) : null);
  const preToken = BigInt(pre[1].amount);
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const results = [];
  const principal = 1000000000000n;
  for (const amount of [1n, 1000n, 1000000n, 1000000000n, principal])
    results.push(await simulate(`deposit_${amount}`, [deposit(amount)], blockhash));
  const depositControl = results.find(x => x.name === `deposit_${principal}`);
  if (!depositControl || depositControl.err || depositControl.rpcError) {
    for (const r of results) console.log(JSON.stringify({name: r.name, err: r.err,
      rpcError: r.rpcError, facts: logFacts(r), logs: r.logs?.slice(-12)}));
    throw new Error('One-SOL deposit control failed');
  }
  const mintedBeforeUpdate = tokenAmount(depositControl) - preToken;
  const updateControl = await simulate('update_only', [update()], blockhash);
  results.push(updateControl);
  const updateThenDeposit = await simulate('update_then_deposit', [update(), deposit(principal)], blockhash);
  results.push(updateThenDeposit);
  if (!updateThenDeposit.err && !updateThenDeposit.rpcError) {
    const mintedAfterUpdate = tokenAmount(updateThenDeposit) - preToken;
    results.push(await simulate('deposit_update_liquid_exact',
      [deposit(principal), update(), liquid(mintedBeforeUpdate)], blockhash));
    results.push(await simulate('update_deposit_liquid_exact',
      [update(), deposit(principal), liquid(mintedAfterUpdate)], blockhash));
    results.push(await simulate('deposit_liquid_exact_no_update',
      [deposit(principal), liquid(mintedBeforeUpdate)], blockhash));
  }
  for (const amount of [1n, 10n, 1000n, 1000000n, 1000000000n])
    results.push(await simulate(`liquid_${amount}`, [liquid(amount)], blockhash));
  results.push(await simulate('update_alias_stake_to_reserve', [update(0, 544, reserve)], blockhash));
  results.push(await simulate('update_wrong_stake_index', [update(1, 544)], blockhash));
  results.push(await simulate('update_wrong_validator_index', [update(0, 545)], blockhash));
  for (const r of results) r.facts = logFacts(r);
  const output = {timestamp: new Date().toISOString(), rpcHost: new URL(rpcUrl).host,
    program: program.toBase58(), sourceCorrespondence: 'mainnet branch 47a002ee / v2.1.0 source-identical',
    liveSubmission: false, signatureVerification: false, transactionVersion: 1,
    preSlot: preInfo.context.slot, watched: watched.map(x => x.toBase58()), pre,
    stakeIndex: 0, validatorIndex: 544, principalLamports: principal.toString(),
    mintedBeforeUpdate: mintedBeforeUpdate.toString(), results};
  fs.writeFileSync('composer-runs/2026-10-15/marinade-gap-audit-91c47aca/marinade-v1-stale-accounting.json',
    JSON.stringify(output, null, 2));
  for (const r of results) console.log(JSON.stringify({name: r.name, err: r.err, rpcError: r.rpcError,
    bytes: r.sizeBytes, accounts: r.addressCount, units: r.unitsConsumed, post: r.post?.slice(0, 8), facts: r.facts}));
}
main().catch(e => {console.error(e.stack); process.exitCode = 1;});
