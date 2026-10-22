/*
 * Read-only current-mainnet Solana v1 composition stress test:
 * KLend zero-fee USDC flash borrow -> Jupiter Perps add/remove liquidity -> KLend repay.
 * Transactions are encoded as v1 and simulated with sigVerify:false. Nothing is signed or sent.
 */
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {Connection, PublicKey, TransactionInstruction} = require(modules + '/@solana/web3.js');
const {BorshInstructionCoder} = require(modules + '/@project-serum/anchor');
const BN = require(modules + '/bn.js');
const bs58 = require(modules + '/bs58');
const {encodeV1} = require('./klend-v1-composition.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const conn = new Connection(rpcUrl, 'confirmed');
const P = value => new PublicKey(value);
const tokenProgram = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const klend = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const perps = P('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const idl = require('/Users/stacc/Documents/Codex/2026-10-15/jupiter-perps-current-audit/community-idl-2026-03.json');
const coder = new BorshInstructionCoder(idl);
const definitions = Object.fromEntries(idl.instructions.map(ix => [ix.name, ix]));

// An on-curve JLP holder with live USDC and JLP balances. sigVerify:false is still a
// simulation caveat; on-curve status only establishes that this is not a PDA-only path.
const owner = P('HnSDB6BB2m72Mdg79khmoUAXUMTFSZZWyH9wiZ6aYRN7');
const ownerUsdc = P('52ve2co1xFcb4TuqQ9ZumoM7hWbMH4BsLeN32dG6xJv6');
const ownerJlp = P('3V2HqMjR1jRtZtRVFfx4wcF5PuwDiiJebyMxBJ9AE35p');
const otherJlp = P('EJ6CLvJPJErjkUnPQicVahzw4Q4NHLfpDV9knoP7iqfK');
const transferAuthority = P('AVzP2GeRmqGphJsMxWoqjpUifPpCret7LqWhD8NWQK49');
const perpetuals = P('H4ND9aYttUVLFmNypZqLjZ52FYiGvdEB45GmwNoKEjTj');
const pool = P('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');
const custody = P('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa');
const custodyVault = P('WzWUoCmtVv7eqAbU3BfKPU3fhLP6CXR8NCJH78UK9VS');
const lpMint = P('27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4');
const oracle = P('6Jp2xZUTWdDD2ZyUPRzeMdc6AFQ5K3pFgZxk2EijfjnM');
const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], perps)[0];
const aumTail = [
  '7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz',
  'AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn',
  '5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm',
  'G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa',
  '4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk',
  'DdwY1ELc9rRK7xNL3hTXabSFBmVrTPpfsUZSv2Y3LL1U',
  'FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh',
  'AFZnHPzy4mvVCffrVwhewHbFc93uTHvDSFrVH7GtfXF1',
  'hUqAT1KQ7eW1i6Csp9CXYtpPfSAvi835V7wKi5fRfmC',
  '6Jp2xZUTWdDD2ZyUPRzeMdc6AFQ5K3pFgZxk2EijfjnM',
  'Fgc93D641F8N2d1xLjQ4jmShuD3GE3BsCXA56KBQbF5u',
  '9DRrwc4hSMQouw3ptpHXtQXVNHoqwyqLaK6NWztWTDin',
].map(P);

const history = JSON.parse(fs.readFileSync(__dirname + '/kamino-flash-history.json'));
const flashSource = history.hits[0];
const sample = flashSource.transaction;
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
if (!borrowTemplate.programId.equals(klend) || !repayTemplate.programId.equals(klend))
  throw new Error('Historical KLend flash instruction indexes changed');
const flashSupply = borrowTemplate.keys[5].pubkey;
const flashFeeVault = borrowTemplate.keys[7].pubkey;
const flashReserve = borrowTemplate.keys[3].pubkey;

const flashIx = (template, amount, destination, repayIndex) => {
  const keys = template.keys.map(k => ({...k}));
  keys[0].pubkey = owner;
  keys[6].pubkey = destination;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: klend, keys, data});
};
const borrow = (amount, destination = ownerUsdc) => flashIx(borrowTemplate, amount, destination);
const repay = (amount, source = ownerUsdc, borrowIndex = 0) =>
  flashIx(repayTemplate, amount, source, borrowIndex);

const perpsIx = (name, amount, options = {}) => {
  const definition = definitions[name];
  const lp = options.lp || ownerJlp;
  const tokenAccount = options.tokenAccount || ownerUsdc;
  const accounts = name === 'addLiquidity2' ? {
    owner, fundingAccount: tokenAccount, lpTokenAccount: lp, transferAuthority,
    perpetuals, pool, custody, custodyDovesPriceAccount: oracle,
    custodyPythnetPriceAccount: oracle, custodyTokenAccount: custodyVault,
    lpTokenMint: lpMint, tokenProgram, eventAuthority, program: perps,
  } : {
    owner, receivingAccount: tokenAccount, lpTokenAccount: lp, transferAuthority,
    perpetuals, pool, custody, custodyDovesPriceAccount: oracle,
    custodyPythnetPriceAccount: oracle, custodyTokenAccount: custodyVault,
    lpTokenMint: lpMint, tokenProgram, eventAuthority, program: perps,
  };
  const keys = definition.accounts.map(meta => ({pubkey: accounts[meta.name],
    isSigner: meta.isSigner, isWritable: meta.isMut}));
  keys.push(...aumTail.map(pubkey => ({pubkey, isSigner: false, isWritable: false})));
  const params = name === 'addLiquidity2' ? {tokenAmountIn: new BN(amount.toString()),
    minLpAmountOut: new BN(0), tokenAmountPreSwap: null} :
    {lpAmountIn: new BN(amount.toString()), minAmountOut: new BN(0)};
  return new TransactionInstruction({programId: perps, keys,
    data: coder.encode(name, {params})});
};
const add = (amount, options) => perpsIx('addLiquidity2', amount, options);
const remove = (amount, options) => perpsIx('removeLiquidity2', amount, options);

const tracked = [ownerUsdc, ownerJlp, custodyVault, lpMint, flashSupply,
  flashFeeVault, flashReserve, pool, custody];
const trackedLabels = ['ownerUsdc', 'ownerJlp', 'perpsUsdcVault', 'jlpMint',
  'klendFlashSupply', 'klendFlashFeeVault', 'klendReserve', 'perpsPool', 'perpsUsdcCustody'];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const decode = (account, index) => {
  if (!account?.data) return null;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const accountOwner = typeof account.owner === 'string' ? account.owner : account.owner.toBase58();
  if (accountOwner === tokenProgram.toBase58() && data.length === 165)
    return {kind: 'splToken', amountRaw: data.readBigUInt64LE(64).toString()};
  if (accountOwner === tokenProgram.toBase58() && data.length === 82)
    return {kind: 'splMint', supplyRaw: data.readBigUInt64LE(36).toString()};
  const result = {kind: 'programState', sha256: hash(data)};
  if (index === 6 && data.length >= 4912) {
    result.availableLiquidityRaw = data.readBigUInt64LE(224).toString();
    result.flashLoanFeeSf = data.readBigUInt64LE(4904).toString();
  }
  return result;
};

async function simulate(name, instructions, blockhash) {
  try {
    const encoded = encodeV1(instructions, owner, blockhash);
    const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: name, method: 'simulateTransaction', params: [
        encoded.wire.toString('base64'), {encoding: 'base64', sigVerify: false,
          replaceRecentBlockhash: true, commitment: 'confirmed', accounts:
            {encoding: 'base64', addresses: tracked.map(x => x.toBase58())}},
      ]})});
    const json = await response.json();
    const value = json.result?.value;
    return {name, slot: json.result?.context?.slot, rpcError: json.error || null,
      err: value?.err || null, sizeBytes: encoded.sizeBytes, v0Bytes: encoded.v0Bytes,
      addressCount: encoded.addressCount, writableCount: encoded.writableCount,
      instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      config: encoded.config, unitsConsumed: value?.unitsConsumed,
      loadedAccountsDataSize: value?.loadedAccountsDataSize,
      post: Object.fromEntries(trackedLabels.map((label, i) => [label, decode(value?.accounts?.[i], i)])),
      logs: value?.logs?.filter(line => line.includes('Instruction:') ||
        line.includes('Program log:') || line.includes('failed:')).slice(-80)};
  } catch (error) {
    return {name, localError: error.stack || error.message};
  }
}

async function main() {
  const preContext = await conn.getMultipleAccountsInfoAndContext(tracked, 'confirmed');
  const pre = Object.fromEntries(trackedLabels.map((label, i) => [label,
    decode(preContext.value[i], i)]));
  const available = BigInt(pre.klendReserve.availableLiquidityRaw);
  const supply = BigInt(pre.klendFlashSupply.amountRaw);
  const feeRate = BigInt(pre.klendReserve.flashLoanFeeSf);
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const results = [];
  const run = async (name, instructions) => {
    const result = await simulate(name, instructions, blockhash);
    results.push(result);
    console.log(JSON.stringify({name, err: result.err, rpcError: result.rpcError,
      localError: result.localError?.split('\n')[0], bytes: result.sizeBytes,
      accounts: result.addressCount, instructions: result.instructionCount,
      units: result.unitsConsumed, post: result.post, logs: result.logs?.slice(-8)}));
    return result;
  };
  const pair = amount => [borrow(amount), repay(amount)];
  for (const amount of [1n, 2n, 1000n, 100000n])
    await run(`flash_pair_${amount}`, pair(amount));
  for (const amount of [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 100n, 1000n, 100000n])
    await run(`flash_add_${amount}_repay`, [borrow(amount), add(amount), repay(amount)]);

  const roundAmount = 100000000n; // 100 USDC.
  const pilot = await run('flash_add_100_usdc_pilot',
    [borrow(roundAmount), add(roundAmount), repay(roundAmount)]);
  const preJlp = BigInt(pre.ownerJlp.amountRaw);
  const pilotJlp = pilot.post?.ownerJlp?.amountRaw;
  const minted = !pilot.err && pilotJlp ? BigInt(pilotJlp) - preJlp : 0n;
  if (minted > 0n) {
    await run('flash_add_remove_100_usdc_roundtrip',
      [borrow(roundAmount), add(roundAmount), remove(minted), repay(roundAmount)]);
    const cycleAmount = 1000000n; // One USDC per repeated leg.
    const cyclePilot = await run('flash_add_1_usdc_cycle_pilot',
      [borrow(cycleAmount), add(cycleAmount), repay(cycleAmount)]);
    const cycleMintedRaw = cyclePilot.post?.ownerJlp?.amountRaw;
    const cycleMinted = !cyclePilot.err && cycleMintedRaw ? BigInt(cycleMintedRaw) - preJlp : 0n;
    if (cycleMinted > 0n) {
      for (const count of [2, 4, 8, 16, 31]) {
        const legs = Array.from({length: count}, () => [add(cycleAmount), remove(cycleMinted)]).flat();
        await run(`flash_${count}_perps_add_remove_cycles`,
          [borrow(cycleAmount), ...legs, repay(cycleAmount)]);
      }
    }
  }

  const large = available > 1n ? available - 1n : available;
  await run('flash_accounted_available_minus_one_pair', pair(large));
  await run('flash_accounted_available_pair', pair(available));
  await run('flash_accounted_available_plus_one_pair', pair(available + 1n));
  await run('flash_near_available_add_400k_usdc_to_perps_repay',
    [borrow(large), add(400000000000n), repay(large)]);

  await run('alias_flash_destination_and_repay_source_to_perps_vault',
    [borrow(1000000n, custodyVault), repay(1000000n, custodyVault)]);
  await run('alias_perps_add_funding_to_custody_vault',
    [borrow(1000000n), add(1000000n, {tokenAccount: custodyVault}), repay(1000000n)]);
  await run('alias_perps_add_jlp_destination_to_other_owner',
    [borrow(1000000n), add(1000000n, {lp: otherJlp}), repay(1000000n)]);

  const output = {
    timestamp: new Date().toISOString(), transport: 'read-only mainnet simulateTransaction',
    liveSubmission: false, signed: false, sigVerify: false,
    sigVerifyCaveat: 'All successful paths require the on-curve owner signature in a real transaction; sigVerify:false proves runtime account/state behavior, not possession of that key.',
    v1Limits: {maxWireBytes: 4096, maxInlineAddresses: 64, maxInstructions: 64, addressLookupTables: false},
    programs: {klend: klend.toBase58(), perps: perps.toBase58()},
    sourceFlash: {signature: flashSource.signature, slot: flashSource.slot},
    owner: {address: owner.toBase58(), onCurve: PublicKey.isOnCurve(owner.toBytes()),
      usdc: ownerUsdc.toBase58(), jlp: ownerJlp.toBase58()},
    flash: {reserve: flashReserve.toBase58(), supply: flashSupply.toBase58(),
      feeVault: flashFeeVault.toBase58(), supplyRaw: supply.toString(),
      accountedAvailableRaw: available.toString(), flashLoanFeeSf: feeRate.toString(),
      configuredZeroFee: feeRate === 0n,
      zeroFeeEvidence: feeRate === 0n ? 'Reserve config field is exactly zero; successful one-raw and near-available loans are not fee-rounding evidence.' : 'Non-zero reserve fee configuration.'},
    tracked: Object.fromEntries(trackedLabels.map((label, i) => [label, tracked[i].toBase58()])),
    preSlot: preContext.context.slot, pre, derived: {roundTripPilotAmountRaw: roundAmount.toString(),
      roundTripPilotMintedJlpRaw: minted.toString()},
    repaymentAccounting: 'KLend flash loans use the indexed repay instruction rather than a persistent obligation account. A successful simulation plus restored flash supply and unchanged fee vault establishes full same-transaction repayment for this zero-fee reserve.',
    results,
  };
  fs.writeFileSync(__dirname + '/klend-perps-v1-stress.json', JSON.stringify(output, null, 2));
}

main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
