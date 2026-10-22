#!/usr/bin/env node
// Current-mainnet, read-only v1 simulations. This script never signs or submits.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, TransactionInstruction, SystemProgram,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const spl = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const {BorshCoder} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const {encodeV1} = require('./klend-v1-composition.js');

const root = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/';
const outputPath = root + 'damm-v1-alpha-vault-flash-resume.json';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(x => x && !x.startsWith('#'))
  .map(x => x.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const conn = new Connection(rpcUrl, 'confirmed');
const P = x => new PublicKey(x);
const k = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});
const u64 = x => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(x)); return b; };

const DAMM = P('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');
const ALPHA = P('vaU6kP7iNEGkbmPkLmZfGwiGxd4Mob24QQCie5R9kd2');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const DYNAMIC_VAULT = P('24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const SYSVAR_INSTRUCTIONS = P('Sysvar1nstructions1111111111111111111111111');
const ALPHA_TREASURY = P('BJQbRiRWhJCyTYZcAuAL3ngDCx3AyFQGKDq8zhiZAKUw');
const OUTSIDER = P('6ReqWLevsGt2NgYo6aSETeiz7c3WYmmXYrC2BQG1SjQ1');
// Current DAMM-v1 Alpha Vault with live two-sided pool liquidity and nominal unfilled quote.
const ALPHA_VAULT = P('5GU8uu1ttkRjMUM3qiVpvK73kpXibak5PwQuoC9HiVH');
const EXPECTED_POOL = P('5gJrxLJPcKrmzzaiRjuLNAMdSsSAmqtxr74iuqy2hbHr');
const ACTUAL_UNFILLED_ALPHA_VAULT = P('DBqFrhEqJm89UF8SXRkkL67yP7DmkuMmLECzQyAEeYsJ');
const ACTUAL_UNFILLED_POOL = P('CyzfGNA11yAZEE8s4RdRXfdWpgW5wwDXzGatJzGafeC6');
const WSOL = spl.NATIVE_MINT;
const flashAmount = 10_000_000n;
const prefundAmount = 100_000_000n;

const alphaIdl = JSON.parse(fs.readFileSync('/tmp/damm-v1-alpha-15W3I8/alpha-vault-sdk/idls/alpha_vault.json'));
const dammIdl = JSON.parse(fs.readFileSync(root + 'damm-v1-sdk-2.0.0-resume.idl.json'));
const alphaCoder = new BorshCoder(alphaIdl);
const dammCoder = new BorshCoder(dammIdl);
const errors = new Map((alphaIdl.errors || []).map(x => [x.code, x]));
const census = JSON.parse(fs.readFileSync(root + 'klend-zero-fee-census.json'));
const reserve = census.activeZero.filter(x => x.mint === WSOL.toBase58() && x.flashFeeSf === '0')
  .sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1)[0];
if (!reserve) throw new Error('No exact-zero-rate WSOL KLend reserve');
const [marketAuthority] = PublicKey.findProgramAddressSync([Buffer.from('lma'), P(reserve.market).toBuffer()], KLEND);
const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], ALPHA);

function flash(amount, borrowIndex, destination) {
  const borrow = borrowIndex === undefined;
  const data = Buffer.concat([
    borrow ? Buffer.from([135, 231, 52, 167, 7, 52, 212, 193]) :
      Buffer.from([185, 117, 0, 203, 96, 245, 180, 186]),
    u64(amount), borrow ? Buffer.alloc(0) : Buffer.from([borrowIndex]),
  ]);
  return new TransactionInstruction({programId: KLEND, data, keys: [
    k(OUTSIDER, true), k(marketAuthority), k(P(reserve.market)),
    k(P(reserve.reserve), false, true), k(WSOL), k(P(reserve.supplyVault), false, true),
    k(destination, false, true), k(P(reserve.feeVault), false, true),
    k(KLEND), k(KLEND), k(SYSVAR_INSTRUCTIONS), k(TOKEN),
  ]});
}

const SWAP_DISC = Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]);
const FILL_DISC = Buffer.from([224, 226, 223, 80, 36, 50, 70, 231]);
function swap(poolKey, pool, av, bv, source, destination, protocolFee, input) {
  const pubs = [poolKey, source, destination, pool.a_vault, pool.b_vault,
    av.token_vault, bv.token_vault, av.lp_mint, bv.lp_mint, pool.a_vault_lp,
    pool.b_vault_lp, protocolFee, OUTSIDER, DYNAMIC_VAULT, TOKEN];
  return new TransactionInstruction({programId: DAMM,
    keys: pubs.map((pubkey, i) => k(pubkey, i === 12, i <= 11)),
    data: Buffer.concat([SWAP_DISC, u64(input), u64(0)]),
  });
}
function fill(alphaVaultKey, poolKey, alpha, pool, av, bv) {
  const adminFee = alpha.quote_mint.equals(pool.token_b_mint) ?
    pool.protocol_token_b_fee : pool.protocol_token_a_fee;
  const pubs = [alphaVaultKey, alpha.token_vault, alpha.token_out_vault, DAMM,
    poolKey, pool.a_vault, pool.b_vault, av.token_vault, bv.token_vault,
    av.lp_mint, bv.lp_mint, pool.a_vault_lp, pool.b_vault_lp, adminFee,
    DYNAMIC_VAULT, TOKEN, ALPHA, ALPHA_TREASURY, OUTSIDER,
    SystemProgram.programId, eventAuthority, ALPHA];
  return new TransactionInstruction({programId: ALPHA,
    keys: pubs.map((pubkey, i) => k(pubkey, i === 18, [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18].includes(i))),
    data: Buffer.concat([FILL_DISC, u64(alpha.total_deposit.toString())]),
  });
}

const SWAP_EVENT_DISC = Buffer.from('516ce3becdd00ac4', 'hex');
function swapEvents(logs) {
  const out = [];
  for (const s of logs || []) {
    if (!s.startsWith('Program data: ')) continue;
    try {
      const b = Buffer.from(s.slice(14), 'base64');
      if (b.length === 48 && b.subarray(0, 8).equals(SWAP_EVENT_DISC)) out.push({
        actualIn: b.readBigUInt64LE(8).toString(), out: b.readBigUInt64LE(16).toString(),
        lpFee: b.readBigUInt64LE(24).toString(), protocolFee: b.readBigUInt64LE(32).toString(),
        partnerFee: b.readBigUInt64LE(40).toString(),
      });
    } catch {}
  }
  return out;
}
function guardError(logs) {
  const line = [...(logs || [])].reverse().find(x => /AnchorError thrown.*Error Code:/i.test(x));
  const m = line && line.match(/AnchorError thrown in ([^:]+):\d+\. Error Code: ([^.]+)\. Error Number: (\d+)\. Error Message: (.*)\.$/i);
  if (m) return {source: m[1], name: m[2], code: Number(m[3]), message: m[4]};
  const rawLine = [...(logs || [])].reverse().find(x => /custom program error: 0x[0-9a-f]+/i.test(x));
  const rawMatch = rawLine && rawLine.match(/custom program error: 0x([0-9a-f]+)/i);
  if (!rawMatch) return null;
  const code = parseInt(rawMatch[1], 16), e = errors.get(code);
  return {source: null, code, hex: '0x' + rawMatch[1], name: e?.name || null, message: e?.msg || null};
}
function accountImage(addresses, accounts) {
  return Object.fromEntries(addresses.map((address, i) => {
    const a = accounts?.[i];
    if (!a?.data) return [address.toBase58(), null];
    const d = Buffer.from(a.data[0], 'base64');
    const owner = a.owner;
    return [address.toBase58(), {lamports: String(a.lamports), owner,
      tokenAmount: owner === TOKEN.toBase58() && d.length >= 72 ? d.readBigUInt64LE(64).toString() : null,
      hash: crypto.createHash('sha256').update(d).digest('hex')}];
  }));
}
function nativeAggregate(image, addresses, allowMissingAsZero = false) {
  if (!allowMissingAsZero && addresses.some(x => image[x.toBase58()] === null || image[x.toBase58()] === undefined)) return null;
  return addresses.reduce((sum, x) => sum + BigInt(image[x.toBase58()]?.lamports || 0), 0n);
}
async function simulate(label, instructions, blockhash, trace, before) {
  const enc = encodeV1(instructions, OUTSIDER, blockhash);
  const req = {jsonrpc: '2.0', id: label, method: 'simulateTransaction', params: [
    enc.wire.toString('base64'), {encoding: 'base64', sigVerify: false,
      replaceRecentBlockhash: true, commitment: 'confirmed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: trace.map(x => x.toBase58())}},
  ]};
  const j = await (await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify(req)})).json();
  const v = j.result?.value, post = accountImage(trace, v?.accounts);
  const nativeKeys = trace.slice(0, 3);
  const preNative = nativeAggregate(before, nativeKeys, true), postNative = nativeAggregate(post, nativeKeys);
  const tokenDeltas = v?.err ? null : Object.fromEntries(trace.map(address => {
    const key = address.toBase58(), pre = before[key]?.tokenAmount, after = post[key]?.tokenAmount;
    return [key, pre !== null && pre !== undefined && after !== null && after !== undefined ?
      (BigInt(after) - BigInt(pre)).toString() : null];
  }).filter(([, value]) => value !== null));
  return {label, slot: j.result?.context?.slot, transportError: j.error || null, err: v?.err || null,
    atomicStateOutcome: v?.err ? 'reverted-no-committed-state' : 'success',
    sizeBytes: enc.sizeBytes, v0Bytes: enc.v0Bytes, addressCount: enc.addressCount,
    writableCount: enc.writableCount, instructionCount: enc.instructionCount,
    requiredSignatures: enc.requiredSignatures, config: enc.config,
    wireSha256: crypto.createHash('sha256').update(enc.wire).digest('hex'),
    unitsConsumed: v?.unitsConsumed, loadedAccountsDataSize: v?.loadedAccountsDataSize,
    swapEvents: swapEvents(v?.logs), guardError: guardError(v?.logs),
    outsiderNativeAggregateLamportsBefore: preNative?.toString() || null,
    outsiderNativeAggregateLamportsAfter: postNative?.toString() || null,
    outsiderNativeAggregateDeltaLamports: preNative !== null && postNative !== null ?
      (postNative - preNative).toString() : null,
    tokenDeltas, post, logs: v?.logs,
  };
}
async function programIdentity(program) {
  const p = await conn.getAccountInfo(program, 'confirmed');
  const programData = P(p.data.subarray(4, 36));
  const d = await conn.getAccountInfo(programData, 'confirmed');
  const slot = Number(d.data.readBigUInt64LE(4));
  // UpgradeableLoader ProgramData header is 45 bytes when an authority is present.
  const binaryOffset = d.data[12] === 1 ? 45 : 13;
  return {program: program.toBase58(), programData: programData.toBase58(), deploymentSlot: slot,
    executableDataBytes: d.data.length - binaryOffset,
    executableSha256: crypto.createHash('sha256').update(d.data.subarray(binaryOffset)).digest('hex')};
}

async function main() {
  const [alphaAi, poolAi] = await conn.getMultipleAccountsInfo([ALPHA_VAULT, EXPECTED_POOL], 'confirmed');
  const alpha = alphaCoder.accounts.decode('Vault', alphaAi.data);
  const pool = dammCoder.accounts.decode('Pool', poolAi.data);
  if (!alpha.pool.equals(EXPECTED_POOL)) throw new Error('Alpha Vault pool changed');
  if (!alpha.quote_mint.equals(WSOL)) throw new Error('Candidate is no longer WSOL quoted');
  const [avAi, bvAi] = await conn.getMultipleAccountsInfo([pool.a_vault, pool.b_vault], 'confirmed');
  const av = dammCoder.accounts.decode('Vault', avAi.data), bv = dammCoder.accounts.decode('Vault', bvAi.data);
  const userBase = spl.getAssociatedTokenAddressSync(alpha.base_mint, OUTSIDER);
  const userQuote = spl.getAssociatedTokenAddressSync(alpha.quote_mint, OUTSIDER);
  const setup = [
    spl.createAssociatedTokenAccountIdempotentInstruction(OUTSIDER, userBase, OUTSIDER, alpha.base_mint),
    spl.createAssociatedTokenAccountIdempotentInstruction(OUTSIDER, userQuote, OUTSIDER, alpha.quote_mint),
    SystemProgram.transfer({fromPubkey: OUTSIDER, toPubkey: userQuote, lamports: Number(prefundAmount)}),
    spl.createSyncNativeInstruction(userQuote),
  ];
  const trace = [OUTSIDER, userQuote, userBase, P(reserve.supplyVault), P(reserve.feeVault),
    P(reserve.reserve), ALPHA_VAULT, alpha.token_vault, alpha.token_out_vault,
    EXPECTED_POOL, av.token_vault, bv.token_vault, pool.protocol_token_a_fee,
    pool.protocol_token_b_fee];
  const preRaw = await conn.getMultipleAccountsInfoAndContext(trace, 'confirmed');
  const preAi = preRaw.value;
  if (preAi[5].data.readBigUInt64LE(4904) !== 0n)
    throw new Error('Selected WSOL reserve is no longer exact-zero fee');
  const before = accountImage(trace, preAi.map(a => a && ({data: [a.data.toString('base64'), 'base64'],
    owner: a.owner.toBase58(), lamports: a.lamports})));
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const forward = swap(EXPECTED_POOL, pool, av, bv, userQuote, userBase, pool.protocol_token_b_fee, flashAmount);
  const fillIx = fill(ALPHA_VAULT, EXPECTED_POOL, alpha, pool, av, bv);
  const results = [];
  const run = async (label, ixs) => {
    try {
      const r = await simulate(label, ixs, blockhash, trace, before);
      results.push(r);
      console.log(JSON.stringify({label, err: r.err || r.transportError, guardError: r.guardError,
        bytes: r.sizeBytes, addresses: r.addressCount, instructions: r.instructionCount,
        units: r.unitsConsumed, events: r.swapEvents, outsiderNativeDelta: r.outsiderNativeAggregateDeltaLamports,
        tail: r.logs?.slice(-8)}));
      return r;
    } catch (e) {
      const r = {label, localError: e.stack}; results.push(r);
      console.log(JSON.stringify({label, localError: e.message})); return r;
    }
  };
  await run('alpha_fill_current_outsider_no_flash', [fillIx]);
  await run('matched_no_spot_move_flash_alpha_fill_repay', [
    ...setup, flash(flashAmount, undefined, userQuote), fillIx, flash(flashAmount, 4, userQuote),
  ]);
  const probe = await run('forward_swap_probe_no_flash', [...setup, forward]);
  if (!probe.swapEvents?.length) throw new Error('Forward DAMM swap did not produce an event');
  const forwardOut = BigInt(probe.swapEvents[0].out);
  const reverse = swap(EXPECTED_POOL, pool, av, bv, userBase, userQuote, pool.protocol_token_a_fee, forwardOut);
  await run('positive_zero_fee_flash_damm_roundtrip_repay', [
    ...setup, flash(flashAmount, undefined, userQuote), forward, reverse,
    flash(flashAmount, 4, userQuote),
  ]);
  await run('full_flash_spot_move_alpha_fill_reverse_repay_attempt', [
    ...setup, flash(flashAmount, undefined, userQuote), forward, fillIx, reverse,
    flash(flashAmount, 4, userQuote),
  ]);
  // The only DAMM-v1 Alpha Vault with both real remaining capacity and a WSOL quote.
  // Its pool is currently disabled; encode the complete requested path anyway to
  // establish both the exact first guard and the v1 transport envelope.
  const [actualAlphaAi, actualPoolAi] = await conn.getMultipleAccountsInfo([
    ACTUAL_UNFILLED_ALPHA_VAULT, ACTUAL_UNFILLED_POOL], 'confirmed');
  const actualAlpha = alphaCoder.accounts.decode('Vault', actualAlphaAi.data);
  const actualPool = dammCoder.accounts.decode('Pool', actualPoolAi.data);
  if (!actualAlpha.pool.equals(ACTUAL_UNFILLED_POOL) || !actualAlpha.quote_mint.equals(WSOL))
    throw new Error('Actual-unfilled WSOL candidate changed');
  const [actualAvAi, actualBvAi] = await conn.getMultipleAccountsInfo([
    actualPool.a_vault, actualPool.b_vault], 'confirmed');
  const actualAv = dammCoder.accounts.decode('Vault', actualAvAi.data);
  const actualBv = dammCoder.accounts.decode('Vault', actualBvAi.data);
  const actualUserBase = spl.getAssociatedTokenAddressSync(actualAlpha.base_mint, OUTSIDER);
  const actualUserQuote = spl.getAssociatedTokenAddressSync(actualAlpha.quote_mint, OUTSIDER);
  const actualSetup = [
    spl.createAssociatedTokenAccountIdempotentInstruction(OUTSIDER, actualUserBase, OUTSIDER, actualAlpha.base_mint),
    spl.createAssociatedTokenAccountIdempotentInstruction(OUTSIDER, actualUserQuote, OUTSIDER, actualAlpha.quote_mint),
    SystemProgram.transfer({fromPubkey: OUTSIDER, toPubkey: actualUserQuote, lamports: Number(prefundAmount)}),
    spl.createSyncNativeInstruction(actualUserQuote),
  ];
  const actualTrace = [OUTSIDER, actualUserQuote, actualUserBase, P(reserve.supplyVault), P(reserve.feeVault),
    P(reserve.reserve), ACTUAL_UNFILLED_ALPHA_VAULT, actualAlpha.token_vault, actualAlpha.token_out_vault,
    ACTUAL_UNFILLED_POOL, actualAv.token_vault, actualBv.token_vault,
    actualPool.protocol_token_a_fee, actualPool.protocol_token_b_fee];
  const actualPreAi = await conn.getMultipleAccountsInfo(actualTrace, 'confirmed');
  const actualBefore = accountImage(actualTrace, actualPreAi.map(a => a && ({
    data: [a.data.toString('base64'), 'base64'], owner: a.owner.toBase58(), lamports: a.lamports})));
  const actualFill = fill(ACTUAL_UNFILLED_ALPHA_VAULT, ACTUAL_UNFILLED_POOL,
    actualAlpha, actualPool, actualAv, actualBv);
  const actualForward = swap(ACTUAL_UNFILLED_POOL, actualPool, actualAv, actualBv,
    actualUserQuote, actualUserBase, actualPool.protocol_token_b_fee, flashAmount);
  const actualReversePlaceholder = swap(ACTUAL_UNFILLED_POOL, actualPool, actualAv, actualBv,
    actualUserBase, actualUserQuote, actualPool.protocol_token_a_fee, 1n);
  const runActual = async (label, ixs) => {
    try {
      const r = await simulate(label, ixs, blockhash, actualTrace, actualBefore);
      results.push(r);
      console.log(JSON.stringify({label, err: r.err || r.transportError, guardError: r.guardError,
        bytes: r.sizeBytes, addresses: r.addressCount, instructions: r.instructionCount,
        units: r.unitsConsumed, events: r.swapEvents, tail: r.logs?.slice(-8)}));
      return r;
    } catch (e) {
      const r = {label, localError: e.stack}; results.push(r);
      console.log(JSON.stringify({label, localError: e.message})); return r;
    }
  };
  await runActual('actual_unfilled_wsol_alpha_fill_no_flash', [actualFill]);
  await runActual('actual_unfilled_wsol_matched_no_spot_flash_fill_repay', [
    ...actualSetup, flash(flashAmount, undefined, actualUserQuote), actualFill,
    flash(flashAmount, 4, actualUserQuote),
  ]);
  await runActual('actual_unfilled_wsol_full_flash_spot_fill_reverse_repay_attempt', [
    ...actualSetup, flash(flashAmount, undefined, actualUserQuote), actualForward,
    actualFill, actualReversePlaceholder, flash(flashAmount, 4, actualUserQuote),
  ]);
  for (const r of results) {
    const quotePost = r.post?.[userQuote.toBase58()]?.tokenAmount;
    const basePost = r.post?.[userBase.toBase58()]?.tokenAmount;
    r.outsiderAssetDeltas = r.atomicStateOutcome === 'success' ? {
      quoteWsolRawVersusPrefund: quotePost === null || quotePost === undefined ? null :
        (BigInt(quotePost) - prefundAmount).toString(),
      baseRawVersusPreexistingZero: basePost === null || basePost === undefined ? null : basePost,
    } : {committed: false, quoteWsolRaw: '0', baseRaw: '0'};
  }
  const [clockSlot, clockTime, alphaIdentity, dammIdentity, klendIdentity] = await Promise.all([
    conn.getSlot('confirmed'), conn.getBlockTime(await conn.getSlot('confirmed')),
    programIdentity(ALPHA), programIdentity(DAMM), programIdentity(KLEND),
  ]);
  const tokenVaultAi = await conn.getAccountInfo(alpha.token_vault, 'confirmed');
  const output = {generatedAt: new Date().toISOString(), transport: 'mainnet simulateTransaction only; no sendTransaction',
    signerVerification: false, transactionVersion: 1, currentState: {slot: clockSlot, unixTimestamp: clockTime},
    programs: {alpha: alphaIdentity, damm: dammIdentity, klend: klendIdentity,
      dynamicVault: DYNAMIC_VAULT.toBase58()}, outsider: OUTSIDER.toBase58(),
    candidate: {role: 'enabled-pool control; pro-rata cap already exhausted',
      alphaVault: ALPHA_VAULT.toBase58(), pool: EXPECTED_POOL.toBase58(),
      poolEnabled: pool.enabled, quoteMint: alpha.quote_mint.toBase58(), baseMint: alpha.base_mint.toBase58(),
      activationType: alpha.activation_type, activationPoint: pool.bootstrapping.activation_point.toString(),
      vaultMode: alpha.vault_mode, maxBuyingCapRaw: alpha.max_buying_cap.toString(),
      totalDepositRaw: alpha.total_deposit.toString(), swappedAmountRaw: alpha.swapped_amount.toString(),
      nominalUnfilledRaw: (BigInt(alpha.total_deposit.toString()) - BigInt(alpha.swapped_amount.toString())).toString(),
      actualUnfilledByVaultModeAndCapRaw: '0',
      quoteTokenVault: alpha.token_vault.toBase58(), quoteTokenVaultBalanceRaw: tokenVaultAi.data.readBigUInt64LE(64).toString(),
      poolAVaultTotalRaw: av.total_amount.toString(), poolBVaultTotalRaw: bv.total_amount.toString(),
      fillMaxAmountArgumentRaw: alpha.total_deposit.toString()},
    actualUnfilledWsolCandidate: {role: 'only DAMM-v1 WSOL Alpha Vault with actual remaining capacity',
      alphaVault: ACTUAL_UNFILLED_ALPHA_VAULT.toBase58(), pool: ACTUAL_UNFILLED_POOL.toBase58(),
      poolEnabled: actualPool.enabled, quoteMint: actualAlpha.quote_mint.toBase58(),
      baseMint: actualAlpha.base_mint.toBase58(), activationType: actualAlpha.activation_type,
      activationPoint: actualPool.bootstrapping.activation_point.toString(), vaultMode: actualAlpha.vault_mode,
      maxBuyingCapRaw: actualAlpha.max_buying_cap.toString(), totalDepositRaw: actualAlpha.total_deposit.toString(),
      swappedAmountRaw: actualAlpha.swapped_amount.toString(),
      actualUnfilledByVaultModeAndCapRaw: (BigInt(actualAlpha.total_deposit.toString()) -
        BigInt(actualAlpha.swapped_amount.toString())).toString(), quoteTokenVault: actualAlpha.token_vault.toBase58(),
      quoteTokenVaultBalanceRaw: (await conn.getAccountInfo(actualAlpha.token_vault, 'confirmed')).data.readBigUInt64LE(64).toString(),
      poolAVaultTotalRaw: actualAv.total_amount.toString(), poolBVaultTotalRaw: actualBv.total_amount.toString(),
      fillMaxAmountArgumentRaw: actualAlpha.total_deposit.toString()},
    flash: {...reserve, stateSlot: preRaw.context.slot,
      currentAvailableRaw: preAi[5].data.readBigUInt64LE(224).toString(),
      currentFlashFeeSf: preAi[5].data.readBigUInt64LE(4904).toString(),
      currentStatus: preAi[5].data[4856], currentEmergencyMode: preAi[5].data[4864],
      currentSupplyVaultBalanceRaw: preAi[3].data.readBigUInt64LE(64).toString(),
      currentFeeVaultBalanceRaw: preAi[4].data.readBigUInt64LE(64).toString(),
      selectedAmountRaw: flashAmount.toString()}, prefundAmountRaw: prefundAmount.toString(),
    forwardSwapOutputRaw: forwardOut.toString(), before, results};
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({outputPath, resultCount: results.length, candidate: output.candidate,
    forwardSwapOutputRaw: forwardOut.toString()}));
}
main().catch(e => {console.error(e.stack); process.exitCode = 1;});
