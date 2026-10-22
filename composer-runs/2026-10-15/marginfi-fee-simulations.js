#!/usr/bin/env node

// Read-only permissionless fee-collection control and account-substitution tests.
// Uses simulateTransaction only; never sends a transaction.
const fs = require('fs');
const anchor = require('@coral-xyz/anchor');
const {getAssociatedTokenAddressSync} = require('@solana/spl-token');
const {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('@solana/web3.js');

const baseDir = __dirname;
const rpcUrl = process.env.RPC_URL;
if (!rpcUrl) throw new Error('RPC_URL is required');
const outputPath = process.env.OUTPUT_PATH || `${baseDir}/marginfi-fee-simulations.json`;
const idl = JSON.parse(fs.readFileSync(`${baseDir}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`, 'utf8'));
const census = JSON.parse(fs.readFileSync(`${baseDir}/marginfi-vaults-current.json`, 'utf8'));
const replay = JSON.parse(fs.readFileSync(`${baseDir}/marginfi-replay-refresh.json`, 'utf8'));
const programId = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const systemProgram = SystemProgram.programId;
const discriminator = Buffer.from([201, 5, 215, 116, 230, 92, 75, 150]);
let rpcId = 0;

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function fixedRaw(wrapped) {
  const bytes = Buffer.from(wrapped.value);
  let value = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if ((bytes[15] & 0x80) !== 0) value -= 1n << 128n;
  return value;
}

function tokenAmount(data) {
  return data && data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function relevantLogs(logs) {
  return (logs || []).filter((line) =>
    line.includes('Instruction:') || line.includes('AnchorError') || line.includes('failed'),
  ).slice(-16);
}

function cloneInstruction(ix) {
  return new TransactionInstruction({
    programId: ix.programId,
    keys: ix.keys.map((key) => ({...key})),
    data: Buffer.from(ix.data),
  });
}

async function simulate(connection, payerKey, instruction, tracked) {
  const pre = await connection.getMultipleAccountsInfo(tracked, 'processed');
  const {blockhash} = await connection.getLatestBlockhash('processed');
  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({units: 500_000}), instruction],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const result = await rpc('simulateTransaction', [Buffer.from(tx.serialize()).toString('base64'), {
    encoding: 'base64',
    sigVerify: false,
    commitment: 'processed',
    accounts: {encoding: 'base64', addresses: tracked.map(String)},
  }]);
  const amounts = {};
  tracked.forEach((address, index) => {
    const postData = result.value.accounts?.[index]?.data?.[0]
      ? Buffer.from(result.value.accounts[index].data[0], 'base64')
      : null;
    const before = tokenAmount(pre[index]?.data);
    const after = tokenAmount(postData);
    amounts[address.toString()] = {
      before,
      after,
      delta: before !== null && after !== null ? (BigInt(after) - BigInt(before)).toString() : null,
    };
  });
  return {
    err: result.value.err,
    unitsConsumed: result.value.unitsConsumed ?? null,
    amounts,
    relevantLogs: relevantLogs(result.value.logs),
  };
}

async function findCandidate(connection, coder, feeState) {
  const bankKeys = [...new Set(census.rows.map((row) => row.bank))].map((key) => new PublicKey(key));
  const decoded = [];
  for (let offset = 0; offset < bankKeys.length; offset += 100) {
    const keys = bankKeys.slice(offset, offset + 100);
    const infos = await connection.getMultipleAccountsInfo(keys, 'processed');
    for (let index = 0; index < keys.length; index += 1) {
      if (!infos[index]) continue;
      const bank = coder.decode('Bank', infos[index].data);
      const totalRaw = fixedRaw(bank.collected_insurance_fees_outstanding)
        + fixedRaw(bank.collected_group_fees_outstanding)
        + fixedRaw(bank.collected_program_fees_outstanding);
      if ((totalRaw >> 48n) <= 0n) continue;
      const rows = census.rows.filter((row) => row.bank === keys[index].toString());
      const liquidity = rows.find((row) => row.kind === 'liquidity');
      const insurance = rows.find((row) => row.kind === 'insurance');
      const fee = rows.find((row) => row.kind === 'fee');
      if (
        !liquidity || !insurance || !fee ||
        liquidity.tokenProgram !== tokenProgram.toString() ||
        liquidity.bankDataLength !== 3912 ||
        BigInt(liquidity.rawAmount) === 0n
      ) continue;
      const feeAta = getAssociatedTokenAddressSync(
        bank.mint,
        feeState.global_fee_wallet,
        true,
        tokenProgram,
      );
      decoded.push({key: keys[index], bank, liquidity, insurance, fee, feeAta, totalRaw});
    }
  }
  decoded.sort((left, right) => left.totalRaw === right.totalRaw ? 0 : left.totalRaw > right.totalRaw ? -1 : 1);
  for (const candidate of decoded) {
    if (await connection.getAccountInfo(candidate.feeAta, 'processed')) return candidate;
  }
  throw new Error('no classic-token bank with collectable fees and initialized canonical fee ATA');
}

async function main() {
  const connection = new Connection(rpcUrl, 'processed');
  const coder = new anchor.BorshAccountsCoder(idl);
  const [feeStateKey] = PublicKey.findProgramAddressSync([Buffer.from('feestate')], programId);
  const feeStateInfo = await connection.getAccountInfo(feeStateKey, 'processed');
  const feeState = coder.decode('FeeState', feeStateInfo.data);
  const candidate = await findCandidate(connection, coder, feeState);
  const borrowTxResult = await rpc('getTransaction', [replay.successfulReplays.LendingAccountBorrow.signature, {
    encoding: 'base64', maxSupportedTransactionVersion: 0,
  }]);
  const payerKey = VersionedTransaction.deserialize(Buffer.from(borrowTxResult.transaction[0], 'base64')).message.staticAccountKeys[0];

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      {pubkey: candidate.bank.group, isSigner: false, isWritable: false},
      {pubkey: candidate.key, isSigner: false, isWritable: true},
      {pubkey: new PublicKey(candidate.liquidity.authority), isSigner: false, isWritable: false},
      {pubkey: new PublicKey(candidate.liquidity.address), isSigner: false, isWritable: true},
      {pubkey: new PublicKey(candidate.insurance.address), isSigner: false, isWritable: true},
      {pubkey: new PublicKey(candidate.fee.address), isSigner: false, isWritable: true},
      {pubkey: feeStateKey, isSigner: false, isWritable: false},
      {pubkey: candidate.feeAta, isSigner: false, isWritable: true},
      {pubkey: tokenProgram, isSigner: false, isWritable: false},
    ],
    data: discriminator,
  });
  const tracked = [
    new PublicKey(candidate.liquidity.address),
    new PublicKey(candidate.insurance.address),
    new PublicKey(candidate.fee.address),
    candidate.feeAta,
  ];
  const result = {
    generatedAt: new Date().toISOString(),
    program: programId.toString(),
    safety: 'simulateTransaction only; no transaction submitted',
    candidate: {
      bank: candidate.key.toString(),
      group: candidate.bank.group.toString(),
      mint: candidate.bank.mint.toString(),
      liquidityVault: candidate.liquidity.address,
      insuranceVault: candidate.insurance.address,
      feeVault: candidate.fee.address,
      feeState: feeStateKey.toString(),
      canonicalFeeAta: candidate.feeAta.toString(),
      integerOutstandingLowerBound: (candidate.totalRaw >> 48n).toString(),
    },
    control: await simulate(connection, payerKey, instruction, tracked),
    mutations: [],
  };

  const alternate = census.rows.find((row) =>
    row.mint === candidate.bank.mint.toString() && !tracked.some((address) => address.equals(new PublicKey(row.address))),
  );
  if (!alternate) throw new Error('no alternate same-mint token account');

  const wrongDestination = cloneInstruction(instruction);
  wrongDestination.keys[7].pubkey = new PublicKey(alternate.address);
  result.mutations.push({
    label: 'collect fees: redirect global fee destination',
    changedAccount: 'fee_ata',
    replacement: alternate.address,
    expected: 'reject non-canonical destination',
    ...(await simulate(connection, payerKey, wrongDestination, tracked)),
  });

  const wrongLiquidityVault = cloneInstruction(instruction);
  wrongLiquidityVault.keys[3].pubkey = new PublicKey(alternate.address);
  result.mutations.push({
    label: 'collect fees: substitute liquidity vault',
    changedAccount: 'liquidity_vault',
    replacement: alternate.address,
    expected: 'reject PDA/bank binding mismatch',
    ...(await simulate(connection, payerKey, wrongLiquidityVault, tracked)),
  });

  const wrongProgram = cloneInstruction(instruction);
  wrongProgram.keys[8].pubkey = systemProgram;
  result.mutations.push({
    label: 'collect fees: substitute CPI token program',
    changedAccount: 'token_program',
    replacement: systemProgram.toString(),
    expected: 'reject token-program interface mismatch',
    ...(await simulate(connection, payerKey, wrongProgram, tracked)),
  });

  const otherBank = census.rows.find((row) =>
    row.kind === 'liquidity' && row.group === candidate.bank.group.toString() && row.bank !== candidate.key.toString(),
  );
  if (otherBank) {
    const wrongBank = cloneInstruction(instruction);
    wrongBank.keys[1].pubkey = new PublicKey(otherBank.bank);
    result.mutations.push({
      label: 'collect fees: substitute same-group bank',
      changedAccount: 'bank',
      replacement: otherBank.bank,
      expected: 'reject bank/vault binding mismatch',
      ...(await simulate(connection, payerKey, wrongBank, tracked)),
    });
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    candidate: result.candidate,
    control: result.control.err,
    mutations: result.mutations.map((row) => ({label: row.label, err: row.err})),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
