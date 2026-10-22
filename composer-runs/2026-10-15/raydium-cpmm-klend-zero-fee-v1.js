#!/usr/bin/env node
// Current-mainnet, read-only Solana v1 simulations: verified zero-fee KLend USDC
// flashloan -> Raydium CPMM swaps / LP round trips -> complete flash repayment.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {Connection, PublicKey, TransactionInstruction} = require(`${MOD}/@solana/web3.js`);
const {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require(`${MOD}/@solana/spl-token`);
const bsModule = require(`${MOD}/bs58`);
const bs58 = bsModule.default || bsModule;
const {encodeV1} = require('./klend-v1-composition.js');
const envFile = fs.existsSync('/tmp/composer-helius-only.env') ? '/tmp/composer-helius-only.env' : '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n').filter(line => line.includes('=')).map(line => line.split(/=(.*)/s).slice(0, 2)));
const RPC = (process.env.RPC_URL || env.HEAVY_RPC_URL || env.RPC_URL).replace(/^['"]|['"]$/g, '');
const connection = new Connection(RPC, 'confirmed');
const P = value => new PublicKey(value);
const CPMM = P('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = P('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const MEMO = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AUTHORITY = P('GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL');
const DEPOSIT = Buffer.from('f223c68952e1f2b6', 'hex');
const WITHDRAW = Buffer.from('b712469c946da122', 'hex');
const owner = P('FVWZsWaso2tzJHpxDbgmDUvrTAKmEti8JxcQ3wpgwnmR');
const ownerUsdc = P('CLLqMsCoA95HmY6ZtwR5TRCBaXh9MjguNRDWmx8vqbrY');
const history = require('./raydium-cpmm-usdc-pool-history.json');
const sample = history.samples.find(row => row.instruction.name === 'swap_base_input' && row.instruction.accounts[10].address === USDC);
if (!sample) throw new Error('No current USDC-input sample for verified CPMM pool');
const sampleAccounts = sample.instruction.accounts;
const sampleAddresses = sampleAccounts.map(account => account.address);
const pool = P(sampleAddresses[3]);
const sampleTx = require('./kamino-flash-history.json').hits[0].transaction;
const message = sampleTx.transaction.message;
const allKeys = [...message.accountKeys, ...sampleTx.meta.loadedAddresses.writable, ...sampleTx.meta.loadedAddresses.readonly];
const header = message.header;
const writable = index => index < message.accountKeys.length
  ? (index < header.numRequiredSignatures
    ? index < header.numRequiredSignatures - header.numReadonlySignedAccounts
    : index < message.accountKeys.length - header.numReadonlyUnsignedAccounts)
  : index < message.accountKeys.length + sampleTx.meta.loadedAddresses.writable.length;
const sampleIx = index => {
  const ix = message.instructions[index];
  return new TransactionInstruction({
    programId: P(allKeys[ix.programIdIndex]),
    keys: ix.accounts.map(keyIndex => ({
      pubkey: P(allKeys[keyIndex]),
      isSigner: keyIndex < header.numRequiredSignatures,
      isWritable: writable(keyIndex),
    })),
    data: Buffer.from(bs58.decode(ix.data)),
  });
};
const borrowTemplate = sampleIx(3);
const repayTemplate = sampleIx(13);
if (!borrowTemplate.programId.equals(KLEND) || !repayTemplate.programId.equals(KLEND)) throw new Error('KLend source indexes changed');
const flashSupply = borrowTemplate.keys[5].pubkey;
const flashFeeVault = borrowTemplate.keys[7].pubkey;
const flashReserve = borrowTemplate.keys[3].pubkey;

const u64 = value => {const data = Buffer.alloc(8); data.writeBigUInt64LE(BigInt(value)); return data;};
const clone = ix => new TransactionInstruction({programId: ix.programId, keys: ix.keys.map(key => ({...key})), data: Buffer.from(ix.data)});
function flashIx(template, amount, borrowIndex) {
  const keys = template.keys.map(key => ({...key}));
  keys[0].pubkey = owner;
  keys[6].pubkey = ownerUsdc;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(BigInt(amount), 8);
  if (borrowIndex !== undefined) data[16] = borrowIndex;
  return new TransactionInstruction({programId: KLEND, keys, data});
}

function swapIx(input, output, amount, reverse = false, mutation = null) {
  const updates = reverse ? {
    0: owner, 4: input, 5: output,
    6: sampleAddresses[7], 7: sampleAddresses[6],
    8: sampleAddresses[9], 9: sampleAddresses[8],
    10: sampleAddresses[11], 11: sampleAddresses[10],
  } : {0: owner, 4: input, 5: output};
  Object.assign(updates, mutation || {});
  const keys = sampleAccounts.map((account, index) => ({
    pubkey: P(String(updates[index] || account.address)),
    isSigner: index === 0,
    isWritable: account.writable,
  }));
  return new TransactionInstruction({
    programId: CPMM,
    keys,
    data: Buffer.concat([Buffer.from(sample.instruction.dataHex.slice(0, 16), 'hex'), u64(amount), u64(0)]),
  });
}

function poolState(info) {
  if (!info?.data) return null;
  const data = Buffer.from(info.data[0], 'base64');
  const read = offset => data.readBigUInt64LE(offset).toString();
  return {
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
    lpSupplyRaw: read(333),
    protocolFeesToken0Raw: read(341), protocolFeesToken1Raw: read(349),
    fundFeesToken0Raw: read(357), fundFeesToken1Raw: read(365),
    creatorFeesToken0Raw: read(397), creatorFeesToken1Raw: read(405),
  };
}

function tokenAmount(info) {
  if (!info?.data) return null;
  const data = Buffer.from(info.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function mintSupply(info) {
  if (!info?.data) return null;
  const data = Buffer.from(info.data[0], 'base64');
  return data.length >= 45 ? {supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44]} : null;
}

async function main() {
  const poolInfo = await connection.getAccountInfo(pool, 'confirmed');
  const rawPool = poolInfo.data;
  const lpMint = new PublicKey(rawPool.subarray(136, 168));
  const token0Mint = new PublicKey(rawPool.subarray(168, 200));
  const token1Mint = new PublicKey(rawPool.subarray(200, 232));
  const token0Program = new PublicKey(rawPool.subarray(232, 264));
  const token1Program = new PublicKey(rawPool.subarray(264, 296));
  const vault0 = new PublicKey(rawPool.subarray(72, 104));
  const vault1 = new PublicKey(rawPool.subarray(104, 136));
  if (String(token1Mint) !== USDC) throw new Error(`verified pool token1 is not USDC: ${token1Mint}`);
  const outputMint = token0Mint;
  const outputAta = getAssociatedTokenAddressSync(outputMint, owner, false, token0Program, ASSOCIATED_TOKEN_PROGRAM_ID);
  const ownerLp = getAssociatedTokenAddressSync(lpMint, owner, false, TOKEN, ASSOCIATED_TOKEN_PROGRAM_ID);
  const createOutput = createAssociatedTokenAccountIdempotentInstruction(owner, outputAta, owner, outputMint, token0Program, ASSOCIATED_TOKEN_PROGRAM_ID);
  const createLp = createAssociatedTokenAccountIdempotentInstruction(owner, ownerLp, owner, lpMint, TOKEN, ASSOCIATED_TOKEN_PROGRAM_ID);
  const accountInfos = await connection.getMultipleAccountsInfoAndContext([flashReserve, flashSupply, flashFeeVault, ownerUsdc, outputAta, ownerLp, vault0, vault1, lpMint], 'confirmed');
  const reserveData = accountInfos.value[0].data;
  const available = reserveData.readBigUInt64LE(224);
  const flashLoanFeeSf = reserveData.readBigUInt64LE(4904);
  if (flashLoanFeeSf !== 0n) throw new Error(`KLend reserve is not exact zero fee: ${flashLoanFeeSf}`);
  const poolVault0 = BigInt(accountInfos.value[6].data.readBigUInt64LE(64));
  const poolVault1 = BigInt(accountInfos.value[7].data.readBigUInt64LE(64));

  const watched = [ownerUsdc, outputAta, ownerLp, flashSupply, flashFeeVault, flashReserve, pool, vault0, vault1, lpMint];
  const roles = ['ownerUsdc', 'ownerOutput', 'ownerLp', 'klendSupply', 'klendFeeVault', 'klendReserve', 'cpmmPool', 'cpmmVault0', 'cpmmVault1', 'lpMint'];
  const pre = await connection.getMultipleAccountsInfoAndContext(watched, 'confirmed');
  const image = accounts => Object.fromEntries(roles.map((role, index) => {
    const account = accounts?.[index];
    if (!account) return [role, null];
    const row = {address: String(watched[index])};
    if (['ownerUsdc', 'ownerOutput', 'ownerLp', 'klendSupply', 'klendFeeVault', 'cpmmVault0', 'cpmmVault1'].includes(role)) row.rawAmount = tokenAmount(account);
    if (role === 'cpmmPool') row.state = poolState(account);
    if (role === 'lpMint') row.mint = mintSupply(account);
    if (role === 'klendReserve') row.dataSha256 = crypto.createHash('sha256').update(Buffer.from(account.data[0], 'base64')).digest('hex');
    return [role, row];
  }));
  const baseline = image(pre.value.map(account => account && ({owner: String(account.owner), data: [account.data.toString('base64'), 'base64']})));
  const results = [];
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  async function simulate(name, borrowAmount, setup, body, metadata = {}) {
    const borrow = flashIx(borrowTemplate, borrowAmount);
    const instructions = [borrow, ...setup.map(clone), ...body.map(clone)];
    const repayIndex = 0;
    instructions.push(flashIx(repayTemplate, borrowAmount, repayIndex));
    try {
      const encoded = encodeV1(instructions, owner, blockhash);
      const request = {jsonrpc: '2.0', id: name, method: 'simulateTransaction', params: [encoded.wire.toString('base64'), {
        encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', innerInstructions: true,
        accounts: {encoding: 'base64', addresses: watched.map(String)},
      }]};
      const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(request)});
      const json = await response.json();
      const value = json.result?.value;
      const post = image(value?.accounts);
      const completeLoanRepayment = value?.err === null && post.klendSupply?.rawAmount === baseline.klendSupply.rawAmount && post.klendFeeVault?.rawAmount === baseline.klendFeeVault.rawAmount;
      const row = {
        name, borrowRaw: String(borrowAmount), metadata,
        exactConfiguredFlashFeeSf: String(flashLoanFeeSf), feeInterpretation: 'exact on-chain zero, not a small positive fee rounded to zero',
        slot: json.result?.context?.slot, err: value?.err || null, rpcError: json.error || null,
        messageBytes: encoded.sizeBytes, v0EquivalentBytes: encoded.v0Bytes,
        inlineAccounts: encoded.addressCount, writableAccounts: encoded.writableCount,
        instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
        computeLimit: encoded.config.computeLimit, loadedDataLimit: encoded.config.dataLimit,
        unitsConsumed: value?.unitsConsumed, loadedAccountsDataSize: value?.loadedAccountsDataSize,
        completeLoanRepayment, post,
        logs: value?.logs || null,
      };
      results.push(row);
      console.log(JSON.stringify({name, err: row.err, bytes: row.messageBytes, accounts: row.inlineAccounts, units: row.unitsConsumed, completeLoanRepayment}));
      return row;
    } catch (error) {
      const row = {name, borrowRaw: String(borrowAmount), localError: error.stack};
      results.push(row);
      console.log(JSON.stringify({name, localError: error.message}));
      return row;
    }
  }

  const forward = amount => swapIx(ownerUsdc, outputAta, amount, false);
  const reverse = amount => swapIx(outputAta, ownerUsdc, amount, true);
  await simulate('klend_zero_fee_flash_1_control', 1n, [], [], {purpose: 'dust principal and exact zero-fee control'});
  await simulate('klend_zero_fee_flash_2_control', 2n, [], [], {purpose: 'adjacent dust principal'});
  await simulate('klend_zero_fee_near_available_control', available - 1n, [], [], {purpose: 'near-available-liquidity borrow/repay'});

  for (const amount of [1n, 2n, 3n, 4n, 10n]) {
    await simulate(`klend_cpmm_dust_${amount}`, 1000000n, [createOutput], [forward(amount)], {cpmmInputRaw: String(amount), purpose: 'CPMM integer output threshold under real zero-fee flash funding'});
  }
  await simulate('klend_cpmm_two_leg_roundtrip', 1000000n, [createOutput], [forward(100000n), reverse(15000000n)], {forwardUsdcRaw: '100000', reverseOutputRaw: '15000000'});
  await simulate('klend_cpmm_repeated_roundtrip', 1000000n, [createOutput], [forward(100000n), reverse(15000000n), forward(100000n), reverse(15000000n)], {cycles: 2});
  await simulate('klend_near_available_with_cpmm_roundtrip', available - 1n, [createOutput], [forward(100000n), reverse(15000000n)], {purpose: 'near-available KLend principal with CPMM between borrow and repay'});

  const nearPoolInput = poolVault1 - 1n;
  const amountAfterFee = nearPoolInput * 995n / 1000n;
  const estimatedOutput = poolVault0 * amountAfterFee / (poolVault1 + amountAfterFee);
  const reverseAmount = estimatedOutput * 99n / 100n;
  const nearPoolBorrow = nearPoolInput + nearPoolInput / 5n;
  await simulate('klend_near_cpmm_input_reserve_roundtrip', nearPoolBorrow, [createOutput], [forward(nearPoolInput), reverse(reverseAmount)], {
    cpmmInputRaw: String(nearPoolInput),
    startingCpmmInputVaultRaw: String(poolVault1),
    conservativeEstimatedForwardOutputRaw: String(estimatedOutput),
    reverseInputRaw: String(reverseAmount),
    purpose: 'input approximately equal to the live CPMM USDC vault, with 20% flash cushion',
  });

  const alias = swapIx(ownerUsdc, ownerUsdc, 100000n, false);
  await simulate('klend_cpmm_alias_input_output', 1000000n, [], [alias], {mutation: 'same account for distinct-mint input/output'});
  const wrongVault = swapIx(ownerUsdc, outputAta, 100000n, false, {6: sampleAddresses[7], 7: sampleAddresses[6]});
  await simulate('klend_cpmm_swapped_vault_order', 1000000n, [createOutput], [wrongVault], {mutation: 'vault order reversed'});

  function liquidityIx(discriminator, lpAmount, amount0, amount1, withdraw) {
    const accounts = [owner, AUTHORITY, pool, ownerLp, outputAta, ownerUsdc, vault0, vault1, TOKEN, TOKEN_2022, token0Mint, token1Mint, lpMint];
    if (withdraw) accounts.push(MEMO);
    return new TransactionInstruction({
      programId: CPMM,
      keys: accounts.map((pubkey, index) => ({
        pubkey,
        isSigner: index === 0,
        isWritable: [2, 3, 4, 5, 6, 7, 12].includes(index),
      })),
      data: Buffer.concat([discriminator, u64(lpAmount), u64(amount0), u64(amount1)]),
    });
  }
  for (const lp of [1n, 2n, 10n, 11n, 12n, 13n, 14n, 15n, 16n, 17n, 18n, 19n, 20n, 40n, 60n, 80n, 100n, 1000n]) {
    const deposit = liquidityIx(DEPOSIT, lp, 1000000n, 200000000n, false);
    const withdraw = liquidityIx(WITHDRAW, lp, 0n, 0n, true);
    await simulate(`klend_cpmm_lp_mint_burn_${lp}`, 1000000n, [createOutput, createLp], [forward(100000n), deposit, withdraw], {
      lpRaw: String(lp), purpose: 'LP mint/burn rounding and supply reconciliation',
    });
  }

  const output = {
    generatedAt: new Date().toISOString(), liveSubmission: false, sigVerify: false,
    transport: RPC.includes('127.0.0.1') ? 'Surfpool current-mainnet fork simulateTransaction using a real custom v1 wire; no mainnet sendTransaction' : 'current-mainnet simulateTransaction using a real custom v1 wire; no sendTransaction',
    programs: {cpmm: String(CPMM), klend: String(KLEND)},
    source: {klendHistory: 'kamino-flash-history.json first successful control', cpmmSignature: sample.signature, cpmmSlot: sample.slot},
    pool: {address: String(pool), token0Mint: String(token0Mint), token1Mint: String(token1Mint), vault0: String(vault0), vault1: String(vault1), lpMint: String(lpMint), outputAta: String(outputAta), ownerLp: String(ownerLp)},
    flash: {owner: String(owner), ownerUsdc: String(ownerUsdc), reserve: String(flashReserve), supply: String(flashSupply), feeVault: String(flashFeeVault), availableRaw: String(available), flashLoanFeeSf: String(flashLoanFeeSf), feeRateInterpretation: 'exact configured zero'},
    preSlot: pre.context.slot, pre: baseline, results,
  };
  fs.writeFileSync('composer-runs/2026-10-15/raydium-cpmm-klend-zero-fee-v1.json', JSON.stringify(output, null, 2));
}

main().catch(error => {console.error(error.stack); process.exitCode = 1;});
