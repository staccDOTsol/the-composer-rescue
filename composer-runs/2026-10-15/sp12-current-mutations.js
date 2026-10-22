#!/usr/bin/env node
/*
 * Current-mainnet read-only SP12 mutation harness.
 * It calls only read methods and simulateTransaction, and never submits a transaction.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  Connection, PublicKey, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction,
  StakeProgram, StakeAuthorizationLayout, SystemProgram, SYSVAR_CLOCK_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY, STAKE_CONFIG_ID,
} = require(`${modules}/@solana/web3.js`);
const {
  TOKEN_PROGRAM_ID, createApproveInstruction, createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} = require(`${modules}/@solana/spl-token`);
const {StakePoolLayout, ValidatorListLayout, StakePoolInstruction} = require(`${modules}/@solana/spl-stake-pool`);

const DIR = __dirname;
const PROGRAM = new PublicKey('SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY');
const POOL = new PublicKey('9mhGNSPArRMHpLDMSmxAvuoizBqtBGqYdT8WGuqgxNdn');
const DEPOSIT_STAKE = new PublicKey('FVgJSuJpvbc3tnyoR1HhnGTHPQhwMWPUV9YUWyow61n');
const DEPOSIT_OWNER = new PublicKey('ipL8ENgvgfYeKtP5rA2FPGYSAt18qgP8QnnAVyXzy7f');
const WITHDRAW_TOKEN_ACCOUNT = new PublicKey('92A756vvLcBahXm5muHTnsKdUiN1Raa2Jk5qrYm5Xqzk');
const WITHDRAW_OWNER = new PublicKey('E3NiM5n6s5CKKWrrhaeVjVSTKscRrysCtZeXnxn6yMgp');
const OTHER_POOL = new PublicKey('2iZHumJq19hyCYkD3xFoZ6dbiFbJ5nqbwALMdJBYQsJa');
const OTHER_VALIDATOR_LIST = new PublicKey('Gfj8Zfvwfb7Jw38GLBHHkCUpgonB477gPKK75KvRt4s4');
const OTHER_RESERVE = new PublicKey('FDjBN7LDysGEDvyy4hgh8sSP9ugVyGAS7spoYBkUnbTb');
const OTHER_VALIDATOR_STAKE = new PublicKey('94814yqHs4VFJoU9enUsHm8HfLXP1ZZRP7D88aYHTwU');
const envFile = ['/tmp/composer-helius-rpc.env', '/tmp/composer-helius-only.env']
  .find((candidate) => fs.existsSync(candidate));
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = (env.RPC_URL || env.HEAVY_RPC_URL).replace(/^['"]|['"]$/g, '');
const connection = new Connection(endpoint, 'confirmed');

const cloneIx = (ix) => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map((key) => ({...key})), data: Buffer.from(ix.data)});
const sp12 = (ix) => { ix.programId = PROGRAM; return ix; };
const setKey = (ix, index, publicKey, signer, writable) => {
  const out = cloneIx(ix); out.keys[index] = {pubkey: publicKey,
    isSigner: signer ?? out.keys[index].isSigner, isWritable: writable ?? out.keys[index].isWritable}; return out;
};
const putU64 = (buffer, offset, value) => buffer.writeBigUInt64LE(BigInt(value), offset);
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const unique = (keys) => [...new Map(keys.map((key) => [key.toBase58(), key])).values()];

function snapInfo(info) {
  if (!info) return null;
  const data = info.data;
  const out = {owner: info.owner.toBase58(), lamports: String(info.lamports), dataLength: data.length,
    dataSha256: sha256(data)};
  if (info.owner.equals(TOKEN_PROGRAM_ID) && data.length === 165) out.tokenAmountRaw = data.readBigUInt64LE(64).toString();
  if (info.owner.equals(TOKEN_PROGRAM_ID) && data.length === 82) out.mintSupplyRaw = data.readBigUInt64LE(36).toString();
  if (info.owner.equals(StakeProgram.programId) && data.length === StakeProgram.space) {
    out.stakeState = data.readUInt32LE(0);
    out.staker = new PublicKey(data.subarray(12, 44)).toBase58();
    out.withdrawer = new PublicKey(data.subarray(44, 76)).toBase58();
  }
  if (info.owner.equals(PROGRAM) && data[0] === 1) {
    const state = StakePoolLayout.decode(data);
    out.poolTotalLamports = state.totalLamports.toString(); out.poolTokenSupply = state.poolTokenSupply.toString();
  }
  return out;
}

function snapSim(info) {
  if (!info) return null;
  const data = Buffer.from(info.data[0], 'base64');
  return snapInfo({owner: new PublicKey(info.owner), lamports: info.lamports, data});
}

function compactLogs(logs) {
  return (logs || []).filter((line) => /Program log:|failed:|success|invoke \[|consumed/.test(line));
}

async function simulate(label, payer, instructions, watched) {
  const keys = unique(watched);
  const preInfos = await connection.getMultipleAccountsInfo(keys, 'confirmed');
  const pre = Object.fromEntries(keys.map((key, index) => [key.toBase58(), snapInfo(preInfos[index])]));
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  let tx;
  try {
    tx = new VersionedTransaction(new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
      instructions}).compileToV0Message());
  } catch (error) {
    return {label, constructionError: error.message, instructionCount: instructions.length};
  }
  const serialized = tx.serialize();
  let response;
  try {
    response = await connection.simulateTransaction(tx, {sigVerify: false, replaceRecentBlockhash: true,
      commitment: 'confirmed', accounts: {encoding: 'base64', addresses: keys.map((key) => key.toBase58())}});
  } catch (error) {
    return {label, transportError: error.message, messageBytes: serialized.length,
      staticAccountCount: tx.message.staticAccountKeys.length, instructionCount: instructions.length};
  }
  const post = response.value.accounts ? Object.fromEntries(keys.map((key, index) =>
    [key.toBase58(), snapSim(response.value.accounts[index])])) : null;
  const changes = Object.fromEntries(keys.map((key) => {
    const address = key.toBase58(); return [address, JSON.stringify(pre[address]) === JSON.stringify(post?.[address]) ? 'unchanged' : 'changed'];
  }));
  return {label, messageVersion: 0, messageBytes: serialized.length,
    staticAccountCount: tx.message.staticAccountKeys.length, requiredSignatureCount: tx.signatures.length,
    instructionCount: instructions.length, err: response.value.err, unitsConsumed: response.value.unitsConsumed,
    pre, post, changes, logs: compactLogs(response.value.logs)};
}

function authorizeStake(stake, currentAuthority, newAuthority) {
  return [
    ...StakeProgram.authorize({stakePubkey: stake, authorizedPubkey: currentAuthority,
      newAuthorizedPubkey: newAuthority, stakeAuthorizationType: StakeAuthorizationLayout.Staker}).instructions,
    ...StakeProgram.authorize({stakePubkey: stake, authorizedPubkey: currentAuthority,
      newAuthorizedPubkey: newAuthority, stakeAuthorizationType: StakeAuthorizationLayout.Withdrawer}).instructions,
  ];
}

function updateListIx(state, withdrawAuthority, validator, noMerge = false) {
  return sp12(StakePoolInstruction.updateValidatorListBalance({stakePool: POOL,
    withdrawAuthority, validatorList: state.validatorList, reserveStake: state.reserveStake,
    startIndex: 0, noMerge, validatorAndTransientStakePairs: [validator.validatorStake, validator.transientStake]}));
}

function updatePoolIx(state, withdrawAuthority) {
  return sp12(StakePoolInstruction.updateStakePoolBalance({stakePool: POOL,
    withdrawAuthority, validatorList: state.validatorList, reserveStake: state.reserveStake,
    managerFeeAccount: state.managerFeeAccount, poolMint: state.poolMint}));
}

async function main() {
  const poolInfo = await connection.getAccountInfo(POOL, 'confirmed');
  const state = StakePoolLayout.decode(poolInfo.data);
  const validatorListInfo = await connection.getAccountInfo(state.validatorList, 'confirmed');
  const validators = ValidatorListLayout.decode(validatorListInfo.data).validators;
  if (validators.length !== 1) throw new Error(`expected one validator in pinned pool, got ${validators.length}`);
  const validator = validators[0];
  const vote = validator.voteAccountAddress;
  const [withdrawAuthority] = PublicKey.findProgramAddressSync([POOL.toBuffer(), Buffer.from('withdraw')], PROGRAM);
  const validatorStake = PublicKey.findProgramAddressSync([vote.toBuffer(), POOL.toBuffer()], PROGRAM)[0];
  const transientSeed = validator.transientSeedSuffixStart;
  const transientSeedBytes = Buffer.alloc(8); transientSeedBytes.writeBigUInt64LE(BigInt(transientSeed.toString()));
  const transientStake = PublicKey.findProgramAddressSync([Buffer.from('transient'), vote.toBuffer(), POOL.toBuffer(), transientSeedBytes], PROGRAM)[0];
  const validatorView = {validatorStake, transientStake};
  const depositDestination = getAssociatedTokenAddressSync(state.poolMint, DEPOSIT_OWNER);
  const attackerDestination = WITHDRAW_TOKEN_ACCOUNT;
  const depositAta = createAssociatedTokenAccountIdempotentInstruction(DEPOSIT_OWNER, depositDestination,
    DEPOSIT_OWNER, state.poolMint, TOKEN_PROGRAM_ID);
  const auth = authorizeStake(DEPOSIT_STAKE, DEPOSIT_OWNER, state.stakeDepositAuthority);
  const depositBase = sp12(StakePoolInstruction.depositStake({stakePool: POOL,
    validatorList: state.validatorList, depositAuthority: state.stakeDepositAuthority, withdrawAuthority,
    depositStake: DEPOSIT_STAKE, validatorStake, reserveStake: state.reserveStake,
    destinationPoolAccount: depositDestination, managerFeeAccount: state.managerFeeAccount,
    referralPoolAccount: depositDestination, poolMint: state.poolMint}));
  const depositWatch = [POOL, state.validatorList, state.reserveStake, state.poolMint, state.managerFeeAccount,
    DEPOSIT_STAKE, validatorStake, depositDestination, attackerDestination];
  const results = {generatedAt: new Date().toISOString(), simulatedOnly: true, transactionNeverSubmitted: true,
    programId: PROGRAM.toBase58(), pool: POOL.toBase58(), currentSlot: await connection.getSlot('confirmed'),
    poolState: {validatorList: state.validatorList.toBase58(), reserveStake: state.reserveStake.toBase58(),
      poolMint: state.poolMint.toBase58(), managerFeeAccount: state.managerFeeAccount.toBase58(),
      stakeDepositAuthority: state.stakeDepositAuthority.toBase58(), withdrawAuthority: withdrawAuthority.toBase58(),
      totalLamports: state.totalLamports.toString(), poolTokenSupply: state.poolTokenSupply.toString(),
      lastUpdateEpoch: state.lastUpdateEpoch.toString(), validatorVote: vote.toBase58(),
      validatorStake: validatorStake.toBase58(), transientStake: transientStake.toBase58()},
    sourceAccounts: {depositStake: DEPOSIT_STAKE.toBase58(), depositOwner: DEPOSIT_OWNER.toBase58(),
      depositDestination: depositDestination.toBase58(), withdrawPoolTokenAccount: WITHDRAW_TOKEN_ACCOUNT.toBase58(),
      withdrawOwner: WITHDRAW_OWNER.toBase58()}, probes: {depositStake: [], withdrawStake: [], update: [], rebalance: []}};

  const depositPositive = await simulate('depositStake:positive_control', DEPOSIT_OWNER,
    [depositAta, ...auth, depositBase], depositWatch);
  results.probes.depositStake.push(depositPositive);
  const minted = BigInt(depositPositive.post?.[depositDestination.toBase58()]?.tokenAmountRaw || 0)
    - BigInt(depositPositive.pre?.[depositDestination.toBase58()]?.tokenAmountRaw || 0);
  const slippageExact = cloneIx(depositBase); slippageExact.data = Buffer.alloc(9); slippageExact.data[0] = 23; putU64(slippageExact.data, 1, minted);
  const slippagePlusOne = cloneIx(slippageExact); putU64(slippagePlusOne.data, 1, minted + 1n);
  const attackerAuth = authorizeStake(DEPOSIT_STAKE, WITHDRAW_OWNER, state.stakeDepositAuthority);
  const giftDeposit = setKey(setKey(depositBase, 7, attackerDestination), 9, attackerDestination);
  results.probes.depositStake.push(
    await simulate('depositStake:slippage_exact_minted', DEPOSIT_OWNER, [depositAta, ...auth, slippageExact], depositWatch),
    await simulate('depositStake:slippage_exact_plus_one', DEPOSIT_OWNER, [depositAta, ...auth, slippagePlusOne], depositWatch),
    await simulate('depositStake:unauthorized_signer_and_attacker_beneficiary', DEPOSIT_OWNER, [...attackerAuth, giftDeposit], depositWatch),
    await simulate('depositStake:authorized_beneficiary_redirect', DEPOSIT_OWNER, [...auth, giftDeposit], depositWatch),
    await simulate('depositStake:wrong_validator_list', DEPOSIT_OWNER, [depositAta, ...auth, setKey(depositBase, 1, OTHER_VALIDATOR_LIST)], depositWatch),
    await simulate('depositStake:wrong_validator_stake', DEPOSIT_OWNER, [depositAta, ...auth, setKey(depositBase, 5, OTHER_VALIDATOR_STAKE)], depositWatch),
    await simulate('depositStake:wrong_reserve', DEPOSIT_OWNER, [depositAta, ...auth, setKey(depositBase, 6, OTHER_RESERVE)], depositWatch),
    await simulate('depositStake:native_stake_cpi_substitution', DEPOSIT_OWNER, [depositAta, ...auth, setKey(depositBase, 14, SystemProgram.programId)], depositWatch),
    await simulate('depositStake:deposit_before_authorize', DEPOSIT_OWNER, [depositAta, depositBase, ...auth], depositWatch),
    await simulate('depositStake:duplicate_same_transaction', DEPOSIT_OWNER, [depositAta, ...auth, depositBase, cloneIx(depositBase)], depositWatch),
    await simulate('depositStake:update_before', DEPOSIT_OWNER, [updateListIx(state, withdrawAuthority, validatorView, true), updatePoolIx(state, withdrawAuthority), depositAta, ...auth, depositBase], depositWatch),
    await simulate('depositStake:update_between_authorize_and_deposit', DEPOSIT_OWNER, [depositAta, ...auth, updateListIx(state, withdrawAuthority, validatorView, true), updatePoolIx(state, withdrawAuthority), depositBase], depositWatch),
    await simulate('depositStake:positive_then_bad_reserve_atomicity', DEPOSIT_OWNER, [depositAta, ...auth, depositBase, setKey(depositBase, 6, OTHER_RESERVE)], depositWatch),
  );

  const withdrawRaw = 1_000_000_000n;
  const stakeRent = await connection.getMinimumBalanceForRentExemption(StakeProgram.space, 'confirmed');
  const makeWithdraw = (label, poolTokens = withdrawRaw, mutate) => {
    const delegate = Keypair.generate(); const destination = Keypair.generate();
    const approve = createApproveInstruction(WITHDRAW_TOKEN_ACCOUNT, delegate.publicKey, WITHDRAW_OWNER, poolTokens);
    const create = SystemProgram.createAccount({fromPubkey: WITHDRAW_OWNER, newAccountPubkey: destination.publicKey,
      lamports: stakeRent, space: StakeProgram.space, programId: StakeProgram.programId});
    let withdraw = sp12(StakePoolInstruction.withdrawStake({stakePool: POOL, validatorList: state.validatorList,
      withdrawAuthority, validatorStake, destinationStake: destination.publicKey,
      destinationStakeAuthority: WITHDRAW_OWNER, sourceTransferAuthority: delegate.publicKey,
      sourcePoolAccount: WITHDRAW_TOKEN_ACCOUNT, managerFeeAccount: state.managerFeeAccount,
      poolMint: state.poolMint, poolTokens: Number(poolTokens)}));
    putU64(withdraw.data, 1, poolTokens);
    if (mutate) withdraw = mutate(withdraw, delegate, destination);
    return {label, delegate, destination, approve, create, withdraw,
      watched: [POOL, state.validatorList, state.poolMint, state.managerFeeAccount, validatorStake,
        WITHDRAW_TOKEN_ACCOUNT, destination.publicKey]};
  };
  const wPositive = makeWithdraw('withdrawStake:positive_control');
  const wPositiveResult = await simulate(wPositive.label, WITHDRAW_OWNER,
    [wPositive.approve, wPositive.create, wPositive.withdraw], wPositive.watched);
  results.probes.withdrawStake.push(wPositiveResult);
  const withdrawLamports = BigInt(wPositiveResult.post?.[wPositive.destination.publicKey.toBase58()]?.lamports || 0) - BigInt(stakeRent);
  const runWithdraw = async (spec, order = 'normal') => simulate(spec.label, WITHDRAW_OWNER,
    order === 'withdraw_before_approve' ? [spec.create, spec.withdraw, spec.approve] : [spec.approve, spec.create, spec.withdraw], spec.watched);
  const exact = makeWithdraw('withdrawStake:slippage_exact', withdrawRaw, (ix) => { const out = cloneIx(ix); out.data = Buffer.alloc(17); out.data[0] = 24; putU64(out.data, 1, withdrawRaw); putU64(out.data, 9, withdrawLamports); return out; });
  const plusOne = makeWithdraw('withdrawStake:slippage_exact_plus_one', withdrawRaw, (ix) => { const out = cloneIx(ix); out.data = Buffer.alloc(17); out.data[0] = 24; putU64(out.data, 1, withdrawRaw); putU64(out.data, 9, withdrawLamports + 1n); return out; });
  const signerBad = makeWithdraw('withdrawStake:source_signer_substitution', withdrawRaw,
    (ix) => setKey(ix, 6, DEPOSIT_OWNER, true, false));
  const gift = makeWithdraw('withdrawStake:authorized_beneficiary_redirect', withdrawRaw,
    (ix) => setKey(ix, 5, DEPOSIT_OWNER, false, false));
  const listBad = makeWithdraw('withdrawStake:wrong_validator_list', withdrawRaw,
    (ix) => setKey(ix, 1, OTHER_VALIDATOR_LIST));
  const stakeBad = makeWithdraw('withdrawStake:wrong_validator_stake', withdrawRaw,
    (ix) => setKey(ix, 3, OTHER_VALIDATOR_STAKE));
  const reserveBad = makeWithdraw('withdrawStake:other_pool_reserve_as_source', withdrawRaw,
    (ix) => setKey(ix, 3, OTHER_RESERVE));
  const cpiBad = makeWithdraw('withdrawStake:native_stake_cpi_substitution', withdrawRaw,
    (ix) => setKey(ix, 12, SystemProgram.programId));
  const smallest = makeWithdraw('withdrawStake:smallest_nonzero_pool_token', 1n);
  const badOrder = makeWithdraw('withdrawStake:withdraw_before_approve', withdrawRaw);
  results.probes.withdrawStake.push(await runWithdraw(exact), await runWithdraw(plusOne),
    await runWithdraw(signerBad), await runWithdraw(gift), await runWithdraw(listBad),
    await runWithdraw(stakeBad), await runWithdraw(reserveBad), await runWithdraw(cpiBad),
    await runWithdraw(smallest), await runWithdraw(badOrder, 'withdraw_before_approve'));

  const atomic = makeWithdraw('withdrawStake:positive_then_wrong_source_atomicity', withdrawRaw * 2n);
  const firstHalf = cloneIx(atomic.withdraw); putU64(firstHalf.data, 1, withdrawRaw);
  const secondHalf = setKey(cloneIx(firstHalf), 3, OTHER_RESERVE);
  results.probes.withdrawStake.push(await simulate(atomic.label, WITHDRAW_OWNER,
    [atomic.approve, atomic.create, firstHalf, secondHalf], atomic.watched));

  const updateWatch = [POOL, state.validatorList, state.reserveStake, state.poolMint, state.managerFeeAccount,
    validatorStake, transientStake];
  results.probes.update.push(
    await simulate('update:validator_then_pool_control', DEPOSIT_OWNER,
      [updateListIx(state, withdrawAuthority, validatorView, true), updatePoolIx(state, withdrawAuthority)], updateWatch),
    await simulate('update:pool_then_validator_order', DEPOSIT_OWNER,
      [updatePoolIx(state, withdrawAuthority), updateListIx(state, withdrawAuthority, validatorView, true)], updateWatch),
    await simulate('update:wrong_validator_list', DEPOSIT_OWNER,
      [setKey(updateListIx(state, withdrawAuthority, validatorView, true), 2, OTHER_VALIDATOR_LIST)], updateWatch),
    await simulate('update:wrong_validator_stake_index_zero', DEPOSIT_OWNER,
      [setKey(updateListIx(state, withdrawAuthority, validatorView, true), 7, OTHER_VALIDATOR_STAKE)], updateWatch),
    await simulate('update:wrong_reserve', DEPOSIT_OWNER,
      [setKey(updateListIx(state, withdrawAuthority, validatorView, true), 3, OTHER_RESERVE)], updateWatch),
    await simulate('update:native_stake_cpi_substitution', DEPOSIT_OWNER,
      [setKey(updateListIx(state, withdrawAuthority, validatorView, true), 6, SystemProgram.programId)], updateWatch),
  );

  const reserveInfo = await connection.getAccountInfo(state.reserveStake, 'confirmed');
  const reserveRent = Number(reserveInfo.data.readBigUInt64LE(4));
  const maxIncrease = BigInt(reserveInfo.lamports) - 2n * BigInt(stakeRent);
  const makeIncrease = (label, amount, mutate) => {
    const ephemeralSeed = 9_876_543_210n;
    const ephemeralBytes = Buffer.alloc(8); ephemeralBytes.writeBigUInt64LE(ephemeralSeed);
    const ephemeral = PublicKey.findProgramAddressSync([Buffer.from('ephemeral'), POOL.toBuffer(), ephemeralBytes], PROGRAM)[0];
    let ix = sp12(StakePoolInstruction.increaseAdditionalValidatorStake({stakePool: POOL,
      staker: state.staker, withdrawAuthority, validatorList: state.validatorList, reserveStake: state.reserveStake,
      ephemeralStake: ephemeral, transientStake, validatorStake, validatorVote: vote,
      lamports: Number(amount), transientStakeSeed: Number(transientSeed.toString()), ephemeralStakeSeed: Number(ephemeralSeed)}));
    // JS SDK encodes numeric seeds through ns64; overwrite with exact values to avoid precision loss.
    putU64(ix.data, 1, amount); putU64(ix.data, 9, BigInt(transientSeed.toString())); putU64(ix.data, 17, ephemeralSeed);
    if (mutate) ix = mutate(ix);
    return {label, ix, ephemeral, watched: [POOL, state.validatorList, state.reserveStake, validatorStake, transientStake, ephemeral]};
  };
  const rebalanceCases = [
    makeIncrease('rebalance:minimum_delegation_exact', 1_000_000_000n),
    makeIncrease('rebalance:minimum_delegation_minus_one', 999_999_999n),
    makeIncrease('rebalance:near_available_exact', maxIncrease),
    makeIncrease('rebalance:near_available_plus_one', maxIncrease + 1n),
    makeIncrease('rebalance:staker_signer_substitution', 1_000_000_000n,
      (ix) => setKey(ix, 1, WITHDRAW_OWNER, true, false)),
    makeIncrease('rebalance:wrong_validator_list', 1_000_000_000n,
      (ix) => setKey(ix, 3, OTHER_VALIDATOR_LIST)),
    makeIncrease('rebalance:wrong_reserve', 1_000_000_000n,
      (ix) => setKey(ix, 4, OTHER_RESERVE)),
    makeIncrease('rebalance:native_stake_cpi_substitution', 1_000_000_000n,
      (ix) => setKey(ix, 13, SystemProgram.programId)),
  ];
  for (const spec of rebalanceCases) results.probes.rebalance.push(await simulate(spec.label, state.staker, [spec.ix], spec.watched));
  const composed = makeIncrease('rebalance:update_before_and_after', 1_000_000_000n);
  results.probes.rebalance.push(await simulate(composed.label, state.staker,
    [updateListIx(state, withdrawAuthority, validatorView, true), updatePoolIx(state, withdrawAuthority),
      composed.ix, updateListIx(state, withdrawAuthority, validatorView, true), updatePoolIx(state, withdrawAuthority)], composed.watched));
  results.derived = {depositMintedPoolTokensRaw: minted.toString(), withdrawPoolTokensRaw: withdrawRaw.toString(),
    withdrawLamportsOutRaw: withdrawLamports.toString(), stakeRentExemption: String(stakeRent),
    reserveLamports: String(reserveInfo.lamports), reserveStakeRentExemptReserve: String(reserveRent),
    rebalanceMaximumLamports: maxIncrease.toString()};
  fs.writeFileSync(path.join(DIR, 'sp12-current-mutations.json'), `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({derived: results.derived,
    probes: Object.fromEntries(Object.entries(results.probes).map(([name, rows]) => [name, rows.map((row) =>
      ({label: row.label, err: row.err ?? row.constructionError ?? row.transportError, unitsConsumed: row.unitsConsumed,
        messageBytes: row.messageBytes, changed: row.changes ? Object.values(row.changes).filter((x) => x === 'changed').length : null}))]))}, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
