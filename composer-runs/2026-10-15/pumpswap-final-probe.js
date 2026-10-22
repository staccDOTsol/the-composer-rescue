/*
 * PumpSwap current-mainnet read-only simulation harness.
 * No sendTransaction/sendRawTransaction call exists in this file.
 */
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} = require(modules + '/@solana/web3.js');
const {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
} = require(modules + '/@solana/spl-token');
const bs58Module = require(modules + '/bs58');
const bs58 = bs58Module.default || bs58Module;

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split('\n').filter((x) => x.includes('=')).map((x) => x.split(/=(.*)/s).slice(0, 2)));
const connection = new Connection(env.RPC_URL.replace(/^['"]|['"]$/g, ''), 'confirmed');
const program = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const systemProgram = new PublicKey('11111111111111111111111111111111');
const globalConfig = PublicKey.findProgramAddressSync([Buffer.from('global_config')], program)[0];
const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], program)[0];
const idlPath = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/repos/pump-public-docs/idl/pump_amm.json';
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
const ixDefs = new Map(idl.instructions.map((ix) => [ix.name, ix]));
const byDisc = new Map(idl.instructions.map((ix) => [Buffer.from(ix.discriminator).toString('hex'), ix.name]));
const poolsPath = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/amm-canvass/pumpswap-verified-10p.json';
const pools = JSON.parse(fs.readFileSync(poolsPath, 'utf8')).pools;

const u64 = (data, offset) => data.readBigUInt64LE(offset);
const putU64 = (data, offset, value) => data.writeBigUInt64LE(BigInt(value), offset);
const tokenAmount = (info) => info && info.data.length >= 72 ? u64(info.data, 64) : null;
const cloneIx = (ix) => new TransactionInstruction({ programId: ix.programId, data: Buffer.from(ix.data), keys: ix.keys.map((k) => ({ ...k })) });
const ixIndexes = (name) => Object.fromEntries(ixDefs.get(name).accounts.map((a, i) => [a.name, i]));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function snapInfo(info) {
  if (!info) return null;
  const amount = tokenAmount(info);
  return { owner: info.owner.toBase58(), lamports: info.lamports, dataLength: info.data.length, tokenAmountRaw: amount === null ? null : amount.toString(), dataSha256: sha256(info.data) };
}

function snapSim(account) {
  if (!account) return null;
  const data = Buffer.from(Array.isArray(account.data) ? account.data[0] : account.data, 'base64');
  return { owner: account.owner, lamports: account.lamports, dataLength: data.length, tokenAmountRaw: data.length >= 72 ? u64(data, 64).toString() : null, dataSha256: sha256(data) };
}

function compactLogs(logs) {
  return (logs || []).filter((line) => /Instruction:|AnchorError|Error|failed:|Transfer|Burn|MintTo/.test(line));
}

async function simulate(label, payer, instructions, addresses) {
  const keys = [...new Set(addresses.map((x) => x.toBase58()))];
  const infos = await connection.getMultipleAccountsInfo(keys.map((x) => new PublicKey(x)), 'confirmed');
  const pre = Object.fromEntries(keys.map((key, i) => [key, snapInfo(infos[i])]));
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const value = (await connection.simulateTransaction(new VersionedTransaction(message), {
    sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses: keys },
  })).value;
  const post = value.accounts ? Object.fromEntries(keys.map((key, i) => [key, snapSim(value.accounts[i])])) : null;
  return { label, error: value.err, unitsConsumed: value.unitsConsumed, pre, post, logs: compactLogs(value.logs) };
}

function parsedIx(tx, rawIx, name, signature) {
  const metas = new Map(tx.transaction.message.accountKeys.map((x) => [x.pubkey.toBase58(), x]));
  return {
    name, signature, slot: tx.slot, blockTime: tx.blockTime,
    payer: tx.transaction.message.accountKeys[0].pubkey,
    ix: new TransactionInstruction({
      programId: program,
      data: Buffer.from(bs58.decode(rawIx.data)),
      keys: rawIx.accounts.map((pubkey) => ({ pubkey, isSigner: Boolean(metas.get(pubkey.toBase58())?.signer), isWritable: Boolean(metas.get(pubkey.toBase58())?.writable) })),
    }),
  };
}

async function findLiveControls() {
  const signatures = await connection.getSignaturesForAddress(program, { limit: 1000 }, 'confirmed');
  const candidates = [];
  for (let start = 0; start < signatures.length; start += 40) {
    const batch = signatures.slice(start, start + 40);
    const txs = await connection.getParsedTransactions(batch.map((x) => x.signature), { commitment: 'confirmed', maxSupportedTransactionVersion: 1 });
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (!tx || tx.meta?.err) continue;
      for (const rawIx of tx.transaction.message.instructions) {
        if (!rawIx.programId?.equals(program) || !rawIx.data || !rawIx.accounts) continue;
        const name = byDisc.get(Buffer.from(bs58.decode(rawIx.data)).subarray(0, 8).toString('hex'));
        if (['sell', 'buy_exact_quote_in', 'sell_v2', 'buy_exact_quote_in_v2', 'boost_buy_and_burn', 'claim_cashback', 'multi_hop_swap'].includes(name)) {
          candidates.push(parsedIx(tx, rawIx, name, batch[i].signature));
        }
      }
    }
  }
  const selected = {};
  for (const candidate of candidates) {
    if (selected[candidate.name]) continue;
    const idx = ixIndexes(candidate.name);
    let required = [];
    let source;
    if (candidate.name === 'boost_buy_and_burn') { required = [idx.pool_base_token_account, idx.pool_quote_token_account, idx.boost_vault]; source = idx.boost_vault; }
    else if (candidate.name === 'claim_cashback') { required = [idx.user_volume_accumulator, idx.user_volume_accumulator_wsol_token_account, idx.user_wsol_token_account]; source = idx.user_volume_accumulator_wsol_token_account; }
    else if (candidate.name === 'multi_hop_swap') { required = [idx.user_in_token_account, idx.user_out_token_account, idx.user_volume_accumulator]; source = idx.user_in_token_account; }
    else { required = [idx.user_base_token_account, idx.user_quote_token_account, idx.pool_base_token_account, idx.pool_quote_token_account]; source = candidate.name.startsWith('buy') ? idx.user_quote_token_account : idx.user_base_token_account; }
    const infos = await connection.getMultipleAccountsInfo(required.map((i) => candidate.ix.keys[i].pubkey), 'confirmed');
    if (!infos.every(Boolean)) continue;
    const sourceInfo = await connection.getAccountInfo(candidate.ix.keys[source].pubkey, 'confirmed');
    if ((tokenAmount(sourceInfo) || 0n) < 1000n) continue;
    selected[candidate.name] = candidate;
  }
  return { signaturesScanned: signatures.length, candidatesSeen: candidates.length, selected };
}

function mutate(ix, index, pubkey, signer, writable) {
  const out = cloneIx(ix);
  out.keys[index] = { pubkey, isSigner: signer ?? out.keys[index].isSigner, isWritable: writable ?? out.keys[index].isWritable };
  return out;
}

async function tune(name, ix) {
  const out = cloneIx(ix);
  const idx = ixIndexes(name);
  let sourceIndex;
  if (name === 'boost_buy_and_burn') sourceIndex = idx.boost_vault;
  else if (name === 'multi_hop_swap') sourceIndex = idx.user_in_token_account;
  else sourceIndex = name.startsWith('buy') ? idx.user_quote_token_account : idx.user_base_token_account;
  const available = tokenAmount(await connection.getAccountInfo(out.keys[sourceIndex].pubkey, 'confirmed')) || 0n;
  const original = u64(out.data, 8);
  let amount = original > available / 20n ? available / 20n : original;
  if (!name.startsWith('buy') && amount > 100000000n) amount = 100000000n;
  if (amount < 1000n && available >= 1000n) amount = 1000n;
  putU64(out.data, 8, amount);
  if (out.data.length >= 24) putU64(out.data, 16, 0n);
  return { ix: out, available: available.toString(), amount: amount.toString() };
}

async function probeStandard(control, attacker) {
  const name = control.name;
  const idx = ixIndexes(name);
  const tuned = await tune(name, control.ix);
  const base = tuned.ix;
  let tracked;
  if (name === 'boost_buy_and_burn') tracked = [base.keys[idx.pool].pubkey, base.keys[idx.pool_base_token_account].pubkey, base.keys[idx.pool_quote_token_account].pubkey, base.keys[idx.boost_vault].pubkey];
  else if (name === 'multi_hop_swap') tracked = [base.keys[idx.user_in_token_account].pubkey, base.keys[idx.user_out_token_account].pubkey, base.keys[idx.user_volume_accumulator].pubkey];
  else tracked = [base.keys[idx.pool].pubkey, base.keys[idx.user_base_token_account].pubkey, base.keys[idx.user_quote_token_account].pubkey, base.keys[idx.pool_base_token_account].pubkey, base.keys[idx.pool_quote_token_account].pubkey];
  const authorityIndex = name === 'boost_buy_and_burn' ? idx.authority : idx.user;
  const authMutant = mutate(base, authorityIndex, attacker, true, undefined);
  let destinationIndex;
  let wrongDestination;
  if (name === 'boost_buy_and_burn') { destinationIndex = idx.pool_quote_token_account; wrongDestination = base.keys[idx.boost_vault].pubkey; }
  else if (name === 'multi_hop_swap') { destinationIndex = idx.user_out_token_account; wrongDestination = base.keys[idx.user_in_token_account].pubkey; }
  else if (name.startsWith('buy')) { destinationIndex = idx.user_base_token_account; wrongDestination = base.keys[idx.pool_base_token_account].pubkey; }
  else { destinationIndex = idx.user_quote_token_account; wrongDestination = base.keys[idx.pool_quote_token_account].pubkey; }
  const destinationMutant = mutate(base, destinationIndex, wrongDestination, false, true);
  let vaultMutant;
  if (name === 'boost_buy_and_burn') vaultMutant = mutate(base, idx.boost_vault, base.keys[idx.pool_quote_token_account].pubkey, false, true);
  else if (idx.pool_base_token_account !== undefined) vaultMutant = mutate(base, idx.pool_base_token_account, base.keys[idx.user_base_token_account].pubkey, false, true);
  let cpiIndex;
  if (name === 'boost_buy_and_burn') cpiIndex = idx.quote_token_program;
  else cpiIndex = idx.base_token_program ?? idx.token_program;
  const cpiMutant = mutate(base, cpiIndex, systemProgram, false, false);
  const variants = [];
  variants.push(await simulate(`${name}:positive_control`, control.payer, [base], tracked));
  variants.push(await simulate(`${name}:authority_substitution`, control.payer, [authMutant], tracked));
  variants.push(await simulate(`${name}:destination_alias`, control.payer, [destinationMutant], [...tracked, wrongDestination]));
  if (vaultMutant) variants.push(await simulate(`${name}:vault_binding_alias`, control.payer, [vaultMutant], tracked));
  variants.push(await simulate(`${name}:cpi_program_substitution`, control.payer, [cpiMutant], tracked));
  variants.push(await simulate(`${name}:duplicate_same_transaction`, control.payer, [base, cloneIx(base)], tracked));
  variants.push(await simulate(`${name}:positive_then_failing_authority_atomicity`, control.payer, [base, authMutant], tracked));
  variants.push(await simulate(`${name}:failing_authority_then_positive_order`, control.payer, [authMutant, base], tracked));
  return { sourceSignature: control.signature, sourceSlot: control.slot, payer: control.payer.toBase58(), inputAvailableRaw: tuned.available, tunedAmountRaw: tuned.amount, variants };
}

async function findLpControl(payer) {
  for (const pool of pools.slice(0, 120)) {
    try {
      const poolKey = new PublicKey(pool.address);
      const lpMint = new PublicKey(pool.lpMint);
      const largest = await connection.getTokenLargestAccounts(lpMint, 'confirmed');
      for (const holderRow of largest.value.slice(0, 8)) {
        if (BigInt(holderRow.amount) < 10000n) continue;
        const holderInfo = await connection.getAccountInfo(holderRow.address, 'confirmed');
        if (!holderInfo || holderInfo.data.length < 72) continue;
        const user = new PublicKey(holderInfo.data.subarray(32, 64));
        if (!PublicKey.isOnCurve(user.toBytes())) continue;
        const baseMint = new PublicKey(pool.baseMint);
        const quoteMint = new PublicKey(pool.quoteMint);
        const [baseMintInfo, quoteMintInfo] = await connection.getMultipleAccountsInfo([baseMint, quoteMint], 'confirmed');
        if (!baseMintInfo || !quoteMintInfo) continue;
        const baseProgram = baseMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        const quoteProgram = quoteMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        const userBase = getAssociatedTokenAddressSync(baseMint, user, true, baseProgram);
        const userQuote = getAssociatedTokenAddressSync(quoteMint, user, true, quoteProgram);
        const [userBaseInfo, userQuoteInfo] = await connection.getMultipleAccountsInfo([userBase, userQuote], 'confirmed');
        const prefix = [];
        if (!userBaseInfo) prefix.push(createAssociatedTokenAccountIdempotentInstruction(payer, userBase, user, baseMint, baseProgram));
        if (!userQuoteInfo) prefix.push(createAssociatedTokenAccountIdempotentInstruction(payer, userQuote, user, quoteMint, quoteProgram));
        const amount = BigInt(holderRow.amount) / 100n;
        const data = Buffer.alloc(32);
        Buffer.from(ixDefs.get('withdraw').discriminator).copy(data, 0);
        putU64(data, 8, amount || 1n); putU64(data, 16, 0n); putU64(data, 24, 0n);
        const withdraw = new TransactionInstruction({ programId: program, data, keys: [
          { pubkey: poolKey, isSigner: false, isWritable: true }, { pubkey: globalConfig, isSigner: false, isWritable: false },
          { pubkey: user, isSigner: true, isWritable: false }, { pubkey: baseMint, isSigner: false, isWritable: false },
          { pubkey: quoteMint, isSigner: false, isWritable: false }, { pubkey: lpMint, isSigner: false, isWritable: true },
          { pubkey: userBase, isSigner: false, isWritable: true }, { pubkey: userQuote, isSigner: false, isWritable: true },
          { pubkey: holderRow.address, isSigner: false, isWritable: true }, { pubkey: new PublicKey(pool.baseVault), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(pool.quoteVault), isSigner: false, isWritable: true }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, { pubkey: eventAuthority, isSigner: false, isWritable: false },
          { pubkey: program, isSigner: false, isWritable: false },
        ]});
        const tracked = [poolKey, holderRow.address, userBase, userQuote, new PublicKey(pool.baseVault), new PublicKey(pool.quoteVault)];
        const positive = await simulate('withdraw:positive_control', payer, [...prefix, withdraw], tracked);
        if (!positive.error) return { pool, payer, user, userBase, userQuote, holder: holderRow.address, amount: (amount || 1n).toString(), prefix, withdraw, tracked, positive };
      }
    } catch (_) { /* Try the next sampled pool. */ }
  }
  return null;
}

async function probeLp(control, attacker) {
  if (!control) return { blocker: 'No replayable on-curve LP holder found in first 120 sampled pools.' };
  const authorityMutant = mutate(control.withdraw, 2, attacker, true, false);
  const vaultMutant = mutate(control.withdraw, 9, control.userBase, false, true);
  const cpiMutant = mutate(control.withdraw, 11, systemProgram, false, false);
  const destinationAlias = mutate(control.withdraw, 6, new PublicKey(control.pool.baseVault), false, true);
  const variants = [control.positive];
  variants.push(await simulate('withdraw:authority_substitution', control.payer, [...control.prefix, authorityMutant], control.tracked));
  variants.push(await simulate('withdraw:destination_alias_pool_base_vault', control.payer, [...control.prefix, destinationAlias], control.tracked));
  variants.push(await simulate('withdraw:vault_binding_alias_user_base', control.payer, [...control.prefix, vaultMutant], control.tracked));
  variants.push(await simulate('withdraw:cpi_program_substitution', control.payer, [...control.prefix, cpiMutant], control.tracked));
  variants.push(await simulate('withdraw:duplicate_same_transaction', control.payer, [...control.prefix, control.withdraw, cloneIx(control.withdraw)], control.tracked));
  variants.push(await simulate('withdraw:positive_then_failing_authority_atomicity', control.payer, [...control.prefix, control.withdraw, authorityMutant], control.tracked));
  return { pool: control.pool.address, lpMint: control.pool.lpMint, user: control.user.toBase58(), userPoolTokenAccount: control.holder.toBase58(), amountRaw: control.amount, variants };
}

async function findCashbackControl(payer) {
  const discriminator = Buffer.from(idl.accounts.find((a) => a.name === 'UserVolumeAccumulator').discriminator);
  try {
    let paginationKey;
    let accountsEnumerated = 0;
    for (let page = 0; page < 20; page++) {
      const response = await fetch(env.RPC_URL.replace(/^['"]|['"]$/g, ''), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getProgramAccountsV2', params: [program.toBase58(), {
          encoding: 'base64', commitment: 'confirmed', limit: 1000,
          filters: [{ dataSize: 90 }, { memcmp: { offset: 0, bytes: bs58.encode(discriminator) } }, { memcmp: { offset: 40, bytes: bs58.encode(Buffer.from([1])) } }],
          ...(paginationKey ? { paginationKey } : {}),
        }] }),
      });
      const body = await response.json();
      if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
      const rows = body.result?.accounts || [];
      accountsEnumerated += rows.length;
      for (const row of rows) {
        const data = Buffer.from(row.account.data[0], 'base64');
      const cashbackEarned = u64(data, 74);
      if (cashbackEarned === 0n) continue;
      const user = new PublicKey(data.subarray(8, 40));
      const accumulator = new PublicKey(row.pubkey);
      const quoteMint = new PublicKey('So11111111111111111111111111111111111111112');
      const source = getAssociatedTokenAddressSync(quoteMint, accumulator, true, TOKEN_PROGRAM_ID);
      const destination = getAssociatedTokenAddressSync(quoteMint, user, true, TOKEN_PROGRAM_ID);
      const [sourceInfo, destinationInfo] = await connection.getMultipleAccountsInfo([source, destination], 'confirmed');
      if ((tokenAmount(sourceInfo) || 0n) === 0n) continue;
      const prefix = destinationInfo ? [] : [createAssociatedTokenAccountIdempotentInstruction(payer, destination, user, quoteMint, TOKEN_PROGRAM_ID)];
      const dataIx = Buffer.from(ixDefs.get('claim_cashback').discriminator);
      const claim = new TransactionInstruction({ programId: program, data: dataIx, keys: [
        { pubkey: user, isSigner: false, isWritable: true }, { pubkey: accumulator, isSigner: false, isWritable: true },
        { pubkey: quoteMint, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: source, isSigner: false, isWritable: true }, { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: systemProgram, isSigner: false, isWritable: false }, { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: program, isSigner: false, isWritable: false },
      ]});
      const tracked = [accumulator, source, destination];
      const positive = await simulate('claim_cashback:positive_control', payer, [...prefix, claim], tracked);
      if (!positive.error) return { accountsEnumerated, pagesEnumerated: page + 1, payer, user, accumulator, source, destination, cashbackEarned: cashbackEarned.toString(), prefix, claim, tracked, positive };
      }
      paginationKey = body.result?.paginationKey;
      if (!paginationKey) return { blocker: 'No funded, claimable cashback accumulator found in filtered current account set.', accountsEnumerated, pagesEnumerated: page + 1 };
    }
    return { blocker: 'Cashback enumeration stopped at the explicit 20,000-account bound without a funded claimable accumulator.', accountsEnumerated, pagesEnumerated: 20 };
  } catch (error) {
    return { blocker: `Filtered cashback account enumeration failed: ${error.message}` };
  }
}

async function probeCashback(control, attacker) {
  if (control.blocker) return control;
  const authorityMutant = mutate(control.claim, 0, attacker, false, true);
  const destinationMutant = mutate(control.claim, 5, control.source, false, true);
  const sourceMutant = mutate(control.claim, 4, control.destination, false, true);
  const cpiMutant = mutate(control.claim, 3, systemProgram, false, false);
  const variants = [control.positive];
  variants.push(await simulate('claim_cashback:user_accumulator_substitution', control.payer, [...control.prefix, authorityMutant], control.tracked));
  variants.push(await simulate('claim_cashback:destination_alias_source_vault', control.payer, [...control.prefix, destinationMutant], control.tracked));
  variants.push(await simulate('claim_cashback:source_vault_alias_destination', control.payer, [...control.prefix, sourceMutant], control.tracked));
  variants.push(await simulate('claim_cashback:cpi_program_substitution', control.payer, [...control.prefix, cpiMutant], control.tracked));
  variants.push(await simulate('claim_cashback:duplicate_same_transaction', control.payer, [...control.prefix, control.claim, cloneIx(control.claim)], control.tracked));
  variants.push(await simulate('claim_cashback:positive_then_failing_user_atomicity', control.payer, [...control.prefix, control.claim, authorityMutant], control.tracked));
  return { accountsEnumerated: control.accountsEnumerated, user: control.user.toBase58(), accumulator: control.accumulator.toBase58(), source: control.source.toBase58(), destination: control.destination.toBase58(), cashbackEarnedRaw: control.cashbackEarned, variants };
}

async function probeSweepSell(sellControl) {
  if (!sellControl) return { blocker: 'No live sell control available for sweep sequencing.' };
  const tuned = await tune('sell', sellControl.ix);
  const sell = tuned.ix;
  const idx = ixIndexes('sell');
  const poolKey = sell.keys[idx.pool].pubkey;
  const poolInfo = await connection.getAccountInfo(poolKey, 'confirmed');
  if (!poolInfo || poolInfo.data.length < 243) return { blocker: 'Selected sell pool state unavailable.' };
  const coinCreator = new PublicKey(poolInfo.data.subarray(211, 243));
  const [recipient] = PublicKey.findProgramAddressSync([Buffer.from('creator_vault'), coinCreator.toBuffer()], program);
  const quoteMint = sell.keys[idx.quote_mint].pubkey;
  const quoteProgram = sell.keys[idx.quote_token_program].pubkey;
  const recipientToken = getAssociatedTokenAddressSync(quoteMint, recipient, true, quoteProgram);
  const sweep = new TransactionInstruction({ programId: program, data: Buffer.from(ixDefs.get('sweep_creator_fee').discriminator), keys: [
    { pubkey: sellControl.payer, isSigner: true, isWritable: true }, { pubkey: globalConfig, isSigner: false, isWritable: false },
    { pubkey: poolKey, isSigner: false, isWritable: true }, { pubkey: quoteMint, isSigner: false, isWritable: false },
    { pubkey: quoteProgram, isSigner: false, isWritable: false }, { pubkey: sell.keys[idx.pool_quote_token_account].pubkey, isSigner: false, isWritable: true },
    { pubkey: recipient, isSigner: false, isWritable: false }, { pubkey: recipientToken, isSigner: false, isWritable: true },
    { pubkey: systemProgram, isSigner: false, isWritable: false }, { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false }, { pubkey: program, isSigner: false, isWritable: false },
  ]});
  const tracked = [poolKey, sell.keys[idx.pool_quote_token_account].pubkey, recipientToken, sell.keys[idx.user_base_token_account].pubkey, sell.keys[idx.user_quote_token_account].pubkey];
  const badSell = mutate(sell, idx.user, new PublicKey('CBfV4E8tbEvVKhLF5DEMVv1Mx2AJD2cTykdRWEntkSBc'), true, undefined);
  return { pool: poolKey.toBase58(), recipient: recipient.toBase58(), recipientToken: recipientToken.toBase58(), variants: [
    await simulate('interaction:sweep_then_sell', sellControl.payer, [sweep, sell], tracked),
    await simulate('interaction:sell_then_sweep', sellControl.payer, [sell, sweep], tracked),
    await simulate('interaction:sweep_then_failing_sell_atomicity', sellControl.payer, [sweep, badSell], tracked),
  ] };
}

async function main() {
  const found = await findLiveControls();
  const controls = found.selected;
  const allPayers = Object.values(controls).map((x) => x.payer);
  const fallbackPayer = allPayers[0];
  if (!fallbackPayer) throw new Error('No live PumpSwap control was found in the sampled signature window.');
  const output = {
    simulatedOnly: true, transactionNeverSubmitted: true, program: program.toBase58(), generatedAt: new Date().toISOString(),
    discovery: { signaturesScanned: found.signaturesScanned, candidatesSeen: found.candidatesSeen, selected: Object.fromEntries(Object.entries(controls).map(([name, c]) => [name, { signature: c.signature, slot: c.slot }])) },
    probes: {},
  };
  for (const name of ['sell', 'buy_exact_quote_in', 'sell_v2', 'buy_exact_quote_in_v2', 'boost_buy_and_burn', 'multi_hop_swap']) {
    const control = controls[name];
    if (!control) { output.probes[name] = { blocker: `No current replayable ${name} candidate in ${found.signaturesScanned} recent program signatures.` }; continue; }
    const authority = control.ix.keys[ixIndexes(name)[name === 'boost_buy_and_burn' ? 'authority' : 'user']].pubkey;
    const attacker = allPayers.find((x) => !x.equals(authority)) || systemProgram;
    try { output.probes[name] = await probeStandard(control, attacker); }
    catch (error) { output.probes[name] = { sourceSignature: control.signature, blocker: error.stack || error.message }; }
  }
  const attacker = allPayers.find((x) => !x.equals(fallbackPayer)) || systemProgram;
  output.probes.withdraw = await probeLp(await findLpControl(fallbackPayer), attacker);
  output.probes.claim_cashback = await probeCashback(await findCashbackControl(fallbackPayer), attacker);
  output.probes.creator_sweep_sell_interaction = await probeSweepSell(controls.sell);
  fs.writeFileSync(__dirname + '/pumpswap-final-probe-results.json', JSON.stringify(output, null, 2));
  for (const [name, probe] of Object.entries(output.probes)) {
    process.stdout.write(JSON.stringify({ name, blocker: probe.blocker, variants: probe.variants?.map((v) => ({ label: v.label, error: v.error })) }) + '\n');
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
