#!/usr/bin/env node
// Project 0 fee-free flashloan -> Raydium CPMM stress tests on a Surfpool mainnet fork.
// The only transaction RPC used here is simulateTransaction; nothing is submitted to mainnet.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bsModule = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bsModule.default || bsModule;
const {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');

const LIVE_RPC = process.env.SOLANA_RPC || process.env.HEAVY_RPC_URL;
const LOCAL_RPC = process.env.RPC_URL || 'http://127.0.0.1:8897';
if (!LIVE_RPC) throw new Error('SOLANA_RPC or HEAVY_RPC_URL is required for source transaction lookup');
const DIR = __dirname;
const OUTPUT = `${DIR}/raydium-cpmm-project0-flash-v1.json`;
const P0_SOURCE = '2WxD766a1LAyiHiMYK8REpBsNpDhA8GQAkNb3occqXXooFF5xyUKz6Xim4m9tVQMiyFrhCYbKKcb6o4FibMBBdwG';
const P0 = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const CPMM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const START = Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]);
const END = Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]);
const BORROW = Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]);
const REPAY = Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]);
const TOP_HISTORY = JSON.parse(fs.readFileSync(`${DIR}/raydium-cpmm-top-pool-history.json`));
const MARGINFI_IDL = JSON.parse(fs.readFileSync(`${DIR}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`));
const accountCoder = new anchor.BorshAccountsCoder(MARGINFI_IDL);
const live = new Connection(LIVE_RPC, 'processed');
const local = new Connection(LOCAL_RPC, 'processed');
let rpcId = 0;

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function clone(ix) {
  return new TransactionInstruction({
    programId: ix.programId,
    keys: ix.keys.map(key => ({...key})),
    data: Buffer.from(ix.data),
  });
}

function matching(ix, program, discriminator) {
  return ix.programId.equals(program) && Buffer.from(ix.data).subarray(0, 8).equals(discriminator);
}

async function decompile(signature) {
  const result = await rpc(LIVE_RPC, 'getTransaction', [signature, {encoding: 'base64', maxSupportedTransactionVersion: 1}]);
  if (!result) throw new Error(`missing source ${signature}`);
  const transaction = VersionedTransaction.deserialize(Buffer.from(result.transaction[0], 'base64'));
  const lookupTables = await Promise.all((transaction.message.addressTableLookups || []).map(async lookup => {
    const table = await live.getAddressLookupTable(lookup.accountKey);
    if (!table.value) throw new Error(`missing source ALT ${lookup.accountKey}`);
    return table.value;
  }));
  return {
    slot: result.slot,
    message: TransactionMessage.decompile(transaction.message, {addressLookupTableAccounts: lookupTables}),
  };
}

function v1Wire(payer, blockhash, instructions, cuLimit = 1_400_000, dataLimit = 67_108_864) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions}).compileToV0Message([]);
  const {header, staticAccountKeys: keys, compiledInstructions: ixs} = compiled;
  if (keys.length > 64 || ixs.length > 64) throw new Error(`v1 key/instruction limit: ${keys.length}/${ixs.length}`);
  const configMask = Buffer.alloc(4);
  configMask.writeUInt32LE(0x0c);
  const config = Buffer.alloc(8);
  config.writeUInt32LE(cuLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const prefix = Buffer.from([0x81, header.numRequiredSignatures, header.numReadonlySignedAccounts, header.numReadonlyUnsignedAccounts]);
  const instructionHeaders = [];
  const payloads = [];
  for (const ix of ixs) {
    if (ix.accountKeyIndexes.length > 255 || ix.data.length > 65535) throw new Error('v1 instruction field limit');
    const instructionHeader = Buffer.alloc(4);
    instructionHeader[0] = ix.programIdIndex;
    instructionHeader[1] = ix.accountKeyIndexes.length;
    instructionHeader.writeUInt16LE(ix.data.length, 2);
    instructionHeaders.push(instructionHeader);
    payloads.push(Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data));
  }
  const wire = Buffer.concat([
    prefix,
    configMask,
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([ixs.length, keys.length]),
    ...keys.map(key => key.toBuffer()),
    config,
    ...instructionHeaders,
    ...payloads,
    Buffer.alloc(64 * header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 wire is ${wire.length} bytes`);
  return {
    wire,
    accountKeys: keys.map(String),
    addresses: keys.length,
    instructionCount: ixs.length,
    signatures: header.numRequiredSignatures,
    cuLimit,
    dataLimit,
  };
}

function setAmount(ix, amount) {
  const result = clone(ix);
  result.data.writeBigUInt64LE(BigInt(amount), 8);
  return result;
}

function makeSequence(start, borrow, repay, end, parts) {
  const instructions = parts.map(part => {
    if (part === 'start') return clone(start);
    if (part === 'borrow') return clone(borrow);
    if (part === 'repay') return clone(repay);
    if (part === 'end') return clone(end);
    return clone(part);
  });
  const startIndex = instructions.findIndex(ix => matching(ix, P0, START));
  const endIndex = instructions.findIndex(ix => matching(ix, P0, END));
  if (startIndex < 0 || endIndex <= startIndex) throw new Error('invalid Project 0 flashloan sequence');
  instructions[startIndex].data.writeBigUInt64LE(BigInt(endIndex), 8);
  return instructions;
}

function swapInstruction(sample, payer, inputAccount, outputAccount, amount, reverse = false, mutation = null) {
  const source = sample.instruction;
  const addresses = source.accounts.map(account => account.address);
  const updates = reverse ? {
    0: payer,
    4: inputAccount,
    5: outputAccount,
    6: addresses[7],
    7: addresses[6],
    8: addresses[9],
    9: addresses[8],
    10: addresses[11],
    11: addresses[10],
  } : {
    0: payer,
    4: inputAccount,
    5: outputAccount,
  };
  Object.assign(updates, mutation || {});
  const keys = source.accounts.map((account, index) => ({
    pubkey: new PublicKey(String(updates[index] || account.address)),
    isSigner: index === 0 ? true : account.signer,
    isWritable: account.writable,
  }));
  const data = Buffer.alloc(24);
  Buffer.from(source.dataHex.slice(0, 16), 'hex').copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 8);
  data.writeBigUInt64LE(0n, 16);
  return new TransactionInstruction({programId: CPMM, keys, data});
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function tokenAmount(data) {
  return data && data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function fixedHex(value) {
  if (!value) return null;
  const raw = value.value === undefined ? value : value.value;
  if (Buffer.isBuffer(raw)) return raw.toString('hex');
  if (Array.isArray(raw)) return Buffer.from(raw).toString('hex');
  if (typeof raw === 'string') return raw;
  return JSON.stringify(raw);
}

function decodeMargin(data, bankKey) {
  const decoded = accountCoder.decode('MarginfiAccount', data);
  const balances = decoded.lending_account.balances;
  const matchingBalance = balances.find(balance => String(balance.bank_pk) === String(bankKey));
  return {
    accountFlags: String(decoded.account_flags),
    bankBalanceActive: matchingBalance ? Number(matchingBalance.active) : 0,
    assetSharesRawHex: matchingBalance ? fixedHex(matchingBalance.asset_shares) : '00000000000000000000000000000000',
    liabilitySharesRawHex: matchingBalance ? fixedHex(matchingBalance.liability_shares) : '00000000000000000000000000000000',
  };
}

function decodeBank(data) {
  const decoded = accountCoder.decode('Bank', data);
  return {
    totalAssetSharesRawHex: fixedHex(decoded.total_asset_shares),
    totalLiabilitySharesRawHex: fixedHex(decoded.total_liability_shares),
    assetShareValueRawHex: fixedHex(decoded.asset_share_value),
    liabilityShareValueRawHex: fixedHex(decoded.liability_share_value),
    lastUpdate: String(decoded.last_update),
  };
}

function decodeCpmmPool(data) {
  const u64 = offset => data.readBigUInt64LE(offset).toString();
  return {
    layoutBasis: 'advisory current official source b3187ae; deployed binary hash is not source-verified',
    lpSupplyRaw: u64(333),
    protocolFeesToken0Raw: u64(341),
    protocolFeesToken1Raw: u64(349),
    fundFeesToken0Raw: u64(357),
    fundFeesToken1Raw: u64(365),
    creatorFeesToken0Raw: u64(397),
    creatorFeesToken1Raw: u64(405),
  };
}

function decodeWatched(addresses, rows, roles, bankAddress, marginAddress, poolAddress) {
  return addresses.map((address, index) => {
    const row = rows && rows[index];
    if (!row) return {role: roles[index], address: String(address), returned: false};
    const data = Buffer.from(row.data[0], 'base64');
    const result = {
      role: roles[index],
      address: String(address),
      owner: row.owner,
      lamports: row.lamports,
      dataLength: data.length,
      dataSha256: sha256(data),
    };
    if (row.owner === String(TOKEN)) result.rawTokenAmount = tokenAmount(data);
    if (String(address) === String(bankAddress)) result.bank = decodeBank(data);
    if (String(address) === String(marginAddress)) result.marginfiAccount = decodeMargin(data, bankAddress);
    if (String(address) === String(poolAddress)) result.cpmmPool = decodeCpmmPool(data);
    return result;
  });
}

async function getRows(addresses) {
  const result = await rpc(LOCAL_RPC, 'getMultipleAccounts', [addresses.map(String), {encoding: 'base64', commitment: 'processed'}]);
  return {slot: result.context.slot, rows: result.value};
}

async function setTokenFixture(address, template, amount, baseLamports) {
  const data = Buffer.from(template.data[0], 'base64');
  data.writeBigUInt64LE(BigInt(amount), 64);
  const lamports = Number(BigInt(baseLamports) + BigInt(amount));
  await rpc(LOCAL_RPC, 'surfnet_setAccount', [String(address), {
    data: data.toString('hex'),
    executable: false,
    lamports,
    owner: template.owner,
    // JSON numbers cannot exactly represent the RPC sentinel u64::MAX rent epoch.
    rentEpoch: 0,
  }]);
}

async function main() {
  const source = await decompile(P0_SOURCE);
  const start0 = source.message.instructions.find(ix => matching(ix, P0, START));
  const end0 = source.message.instructions.find(ix => matching(ix, P0, END));
  const borrow0 = source.message.instructions.find(ix => matching(ix, P0, BORROW));
  const repay0 = source.message.instructions.find(ix => matching(ix, P0, REPAY));
  if (!start0 || !end0 || !borrow0 || !repay0) throw new Error('Project 0 source instruction set is incomplete');
  const payer = source.message.payerKey;
  const authority = borrow0.keys[2].pubkey;
  const bank = borrow0.keys[3].pubkey;
  const borrowerToken = borrow0.keys[4].pubkey;
  const lendingVault = borrow0.keys[6].pubkey;
  const marginfiAccount = start0.keys[0].pubkey;
  const sample = TOP_HISTORY.samples.find(row => row.instruction.name === 'swap_base_input');
  if (!sample) throw new Error('top-pool CPMM sample missing');
  const sampleAddresses = sample.instruction.accounts.map(account => account.address);
  const pool = new PublicKey(sampleAddresses[3]);
  if (sampleAddresses[10] !== 'So11111111111111111111111111111111111111112') {
    throw new Error('selected CPMM sample does not accept the Project 0 wSOL loan asset');
  }
  const poolInputVault = new PublicKey(sampleAddresses[6]);
  const poolOutputVault = new PublicKey(sampleAddresses[7]);
  const observation = new PublicKey(sampleAddresses[12]);
  const outputMint = new PublicKey(sampleAddresses[11]);
  const outputAta = getAssociatedTokenAddressSync(outputMint, authority, false, TOKEN);
  const createOutputAta = createAssociatedTokenAccountIdempotentInstruction(payer, outputAta, authority, outputMint, TOKEN);
  const fixtureResult = await rpc(LOCAL_RPC, 'getAccountInfo', [String(borrowerToken), {encoding: 'base64', commitment: 'processed'}]);
  const fixture = fixtureResult.value;
  if (!fixture) throw new Error('borrow destination fixture missing');
  // The sampled wrapped-SOL account's rent reserve before any fork seeding.
  const fixtureBaseLamports = 2039280n;
  const vaultState = await getRows([lendingVault]);
  const vaultAvailable = BigInt(tokenAmount(Buffer.from(vaultState.rows[0].data[0], 'base64')));
  const watched = [borrowerToken, outputAta, lendingVault, poolInputVault, poolOutputVault, bank, marginfiAccount, pool, observation];
  const roles = ['borrowerWsol', 'borrowerOutputAta', 'p0LiquidityVault', 'cpmmWsolVault', 'cpmmOutputVault', 'p0Bank', 'p0MarginfiAccount', 'cpmmPool', 'cpmmObservation'];
  const cases = [];

  async function simulate(name, borrowAmount, seedAmount, parts, metadata = {}) {
    await setTokenFixture(borrowerToken, fixture, seedAmount, fixtureBaseLamports);
    const before = await getRows(watched);
    const borrow = setAmount(borrow0, borrowAmount);
    const repay = setAmount(repay0, borrowAmount);
    const instructions = makeSequence(start0, borrow, repay, end0, parts.map(part => {
      if (part === 'borrow') return borrow;
      if (part === 'repay') return repay;
      return part;
    }));
    const {blockhash} = await local.getLatestBlockhash('processed');
    const tx = v1Wire(payer, blockhash, instructions);
    const result = await rpc(LOCAL_RPC, 'simulateTransaction', [tx.wire.toString('base64'), {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'processed',
      innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map(String)},
    }]);
    const value = result.value;
    const decodedBefore = decodeWatched(watched, before.rows, roles, bank, marginfiAccount, pool);
    const decodedAfter = decodeWatched(watched, value.accounts, roles, bank, marginfiAccount, pool);
    const beforeByRole = Object.fromEntries(decodedBefore.map(row => [row.role, row]));
    const afterByRole = Object.fromEntries(decodedAfter.map(row => [row.role, row]));
    const completeLoanRepayment = value.err === null &&
      afterByRole.p0LiquidityVault.rawTokenAmount === beforeByRole.p0LiquidityVault.rawTokenAmount &&
      afterByRole.p0MarginfiAccount.marginfiAccount.liabilitySharesRawHex === beforeByRole.p0MarginfiAccount.marginfiAccount.liabilitySharesRawHex;
    const record = {
      name,
      borrowAmountRaw: String(borrowAmount),
      forkSeededBorrowerBufferRaw: String(seedAmount),
      seedDisclosure: BigInt(seedAmount) === 0n ? null : 'Surfpool-only authenticated starting balance; not present on mainnet and included in net-delta accounting',
      metadata,
      message: {
        version: 1,
        serializedBytes: tx.wire.length,
        serializedSha256: sha256(tx.wire),
        accountCount: tx.addresses,
        accountKeys: tx.accountKeys,
        instructionCount: tx.instructionCount,
        requiredSignatures: tx.signatures,
        byteLimit: 4096,
        inlineAccountLimit: 64,
      },
      limits: {computeUnitLimit: tx.cuLimit, loadedAccountsDataSizeLimit: tx.dataLimit},
      slot: result.context && result.context.slot,
      err: value.err,
      unitsConsumed: value.unitsConsumed,
      loadedAccountsDataSize: value.loadedAccountsDataSize,
      innerInstructionGroups: (value.innerInstructions || []).length,
      logLines: (value.logs || []).length,
      logCharacters: (value.logs || []).reduce((sum, line) => sum + line.length, 0),
      completeLoanRepayment,
      pre: decodedBefore,
      post: decodedAfter,
      logs: value.logs,
    };
    cases.push(record);
    return record;
  }

  const direct = amount => ['start', 'borrow', 'repay', 'end'];
  await simulate('flashloan_smallest_nonzero_1', 1n, 0n, direct(1n), {purpose: 'smallest nonzero borrow/repay rounding control'});
  await simulate('flashloan_original_amount_control', 159119819n, 0n, direct(159119819n), {purpose: 'positive funded source-sized control'});

  let minimumFailure = 1n;
  let minimumSuccess = 159119819n;
  while (minimumSuccess - minimumFailure > 1n) {
    const probe = (minimumFailure + minimumSuccess) / 2n;
    const result = await simulate(`flashloan_minimum_probe_${probe}`, probe, 0n, direct(probe), {thresholdSearch: 'minimum successful raw borrow'});
    if (result.err === null) minimumSuccess = probe;
    else minimumFailure = probe;
  }

  await simulate('flashloan_vault_minus_1', vaultAvailable - 1n, 0n, direct(vaultAvailable - 1n), {threshold: 'available liquidity minus one raw unit'});
  await simulate('flashloan_exact_vault_balance', vaultAvailable, 0n, direct(vaultAvailable), {threshold: 'exact available liquidity'});
  await simulate('flashloan_vault_plus_1', vaultAvailable + 1n, 0n, direct(vaultAvailable + 1n), {threshold: 'one raw unit above available liquidity'});

  let maximumSuccess = 159119819n;
  let maximumFailure = vaultAvailable - 1n;
  while (maximumFailure - maximumSuccess > 1n) {
    const probe = (maximumSuccess + maximumFailure) / 2n;
    const result = await simulate(`flashloan_maximum_probe_${probe}`, probe, 0n, direct(probe), {thresholdSearch: 'maximum successful raw borrow below utilization guard'});
    if (result.err === null) maximumSuccess = probe;
    else maximumFailure = probe;
  }

  for (const amount of [1n, 2n, 3n, 4n, 10n]) {
    const swap = swapInstruction(sample, authority, borrowerToken, outputAta, amount, false);
    await simulate(`cpmm_rounding_input_${amount}`, 159119819n, amount, ['start', 'borrow', createOutputAta, swap, 'repay', 'end'], {
      cpmmInputRaw: String(amount),
      purpose: 'small-input output-rounding boundary inside a fully repaid flashloan',
    });
  }

  const orderedSwap = swapInstruction(sample, authority, borrowerToken, outputAta, 100000n, false);
  const orderCases = [
    ['cpmm_before_flashloan', [createOutputAta, orderedSwap, 'start', 'borrow', 'repay', 'end']],
    ['cpmm_between_borrow_and_repay', ['start', 'borrow', createOutputAta, orderedSwap, 'repay', 'end']],
    ['cpmm_after_repay_before_end', ['start', 'borrow', 'repay', createOutputAta, orderedSwap, 'end']],
    ['cpmm_after_flashloan_end', ['start', 'borrow', 'repay', 'end', createOutputAta, orderedSwap]],
  ];
  for (const [name, parts] of orderCases) {
    await simulate(name, 100000n, 100000n, parts, {cpmmInputRaw: '100000', purpose: 'same-asset cross-program ordering'});
  }

  const duplicateSwap = swapInstruction(sample, authority, borrowerToken, outputAta, 100000n, false);
  await simulate('duplicate_cpmm_swap_inside_flashloan', 200000n, 200000n, ['start', 'borrow', createOutputAta, duplicateSwap, duplicateSwap, 'repay', 'end'], {
    cpmmInputPerLegRaw: '100000',
    cpmmLegs: 2,
  });

  const forward = swapInstruction(sample, authority, borrowerToken, outputAta, 100000n, false);
  const reverse = swapInstruction(sample, authority, outputAta, borrowerToken, 50000n, true);
  await simulate('two_leg_roundtrip_inside_flashloan', 1000000n, 100000n, ['start', 'borrow', createOutputAta, forward, reverse, 'repay', 'end'], {
    forwardWsolRaw: '100000',
    reverseOutputTokenRaw: '50000',
  });
  await simulate('repeated_two_leg_roundtrip_inside_flashloan', 1000000n, 200000n, ['start', 'borrow', createOutputAta, forward, reverse, forward, reverse, 'repay', 'end'], {
    forwardWsolRawPerCycle: '100000',
    reverseOutputTokenRawPerCycle: '50000',
    cycles: 2,
  });

  const aliasSwap = swapInstruction(sample, authority, borrowerToken, borrowerToken, 100000n, false);
  await simulate('alias_input_as_output_inside_flashloan', 100000n, 100000n, ['start', 'borrow', aliasSwap, 'repay', 'end'], {
    mutation: 'same token account supplied for CPMM input and output despite different pool mints',
  });
  const swappedVaults = swapInstruction(sample, authority, borrowerToken, outputAta, 100000n, false, {6: sampleAddresses[7], 7: sampleAddresses[6]});
  await simulate('swapped_cpmm_vault_order_inside_flashloan', 100000n, 100000n, ['start', 'borrow', createOutputAta, swappedVaults, 'repay', 'end'], {
    mutation: 'input/output vault order reversed',
  });

  const nearAmount = maximumSuccess * 999n / 1000n;
  const nearSwap = swapInstruction(sample, authority, borrowerToken, outputAta, nearAmount, false);
  await simulate('near_liquidity_flashloan_into_cpmm', nearAmount, nearAmount, ['start', 'borrow', createOutputAta, nearSwap, 'repay', 'end'], {
    cpmmInputRaw: String(nearAmount),
    purpose: 'near-available Project 0 liquidity routed through CPMM; fork buffer makes full repayment explicit',
  });

  const output = {
    generatedAt: new Date().toISOString(),
    transport: 'Surfpool current-mainnet fork; simulateTransaction only; custom v1 wire; no mainnet sendTransaction',
    forkStateMutation: 'Only the authenticated borrower wSOL starting balance was changed with surfnet_setAccount, case by case; every such amount is disclosed.',
    program: String(CPMM),
    project0Program: String(P0),
    sourceSignature: P0_SOURCE,
    sourceSlot: source.slot,
    highValuePool: String(pool),
    p0: {
      payer: String(payer),
      authority: String(authority),
      marginfiAccount: String(marginfiAccount),
      bank: String(bank),
      borrowerToken: String(borrowerToken),
      liquidityVault: String(lendingVault),
      availableLiquidityRaw: String(vaultAvailable),
      minimumSuccessfulBorrowRaw: String(minimumSuccess),
      adjacentMinimumFailureRaw: String(minimumFailure),
      maximumSuccessfulBorrowRaw: String(maximumSuccess),
      adjacentMaximumFailureRaw: String(maximumFailure),
      mint: 'So11111111111111111111111111111111111111112',
    },
    cpmm: {
      outputMint: String(outputMint),
      outputAta: String(outputAta),
      inputVault: String(poolInputVault),
      outputVault: String(poolOutputVault),
      observation: String(observation),
      standaloneRefreshCrank: 'not applicable: CPMM has no permissionless refresh/crank leg; swap updates pool and observation inline',
    },
    cases,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    output: OUTPUT,
    p0: output.p0,
    cpmm: output.cpmm,
    cases: cases.map(test => ({
      name: test.name,
      bytes: test.message.serializedBytes,
      accounts: test.message.accountCount,
      instructions: test.message.instructionCount,
      err: test.err,
      unitsConsumed: test.unitsConsumed,
      completeLoanRepayment: test.completeLoanRepayment,
    })),
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
