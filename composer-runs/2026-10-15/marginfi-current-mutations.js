#!/usr/bin/env node

// Read-only adversarial harness. It uses get* RPC methods and
// simulateTransaction only. It never signs or submits a transaction.
const fs = require('fs');
const {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('@solana/web3.js');

const PROGRAM_ID = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const SYSTEM_PROGRAM = SystemProgram.programId;
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const baseDir = __dirname;
const rpcUrl = process.env.RPC_URL;
if (!rpcUrl) throw new Error('RPC_URL is required');

const replayPath = fs.existsSync(`${baseDir}/marginfi-replay-refresh.json`)
  ? `${baseDir}/marginfi-replay-refresh.json`
  : `${baseDir}/marginfi-replay-controls.json`;
const replay = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
const vaultCensus = JSON.parse(fs.readFileSync(`${baseDir}/marginfi-vaults-current.json`, 'utf8'));
const outputPath = process.env.OUTPUT_PATH || `${baseDir}/marginfi-current-simulations.json`;
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

async function fetchTransaction(signature) {
  const tx = await rpc('getTransaction', [signature, {encoding: 'base64', maxSupportedTransactionVersion: 0}]);
  if (!tx) throw new Error(`missing transaction ${signature}`);
  return VersionedTransaction.deserialize(Buffer.from(tx.transaction[0], 'base64'));
}

async function decompileControl(connection, signature) {
  const transaction = await fetchTransaction(signature);
  const lookupAccounts = await Promise.all(transaction.message.addressTableLookups.map(async ({accountKey}) => {
    const result = await connection.getAddressLookupTable(accountKey);
    if (!result.value) throw new Error(`missing ALT ${accountKey}`);
    return result.value;
  }));
  return {
    transaction,
    lookupAccounts,
    message: TransactionMessage.decompile(transaction.message, {addressLookupTableAccounts: lookupAccounts}),
  };
}

function cloneInstruction(ix) {
  return new TransactionInstruction({
    programId: ix.programId,
    keys: ix.keys.map((key) => ({...key})),
    data: Buffer.from(ix.data),
  });
}

function cloneInstructions(instructions) {
  return instructions.map(cloneInstruction);
}

function tokenAmount(data) {
  if (!data || data.length < 72) return null;
  return data.readBigUInt64LE(64).toString();
}

function returnedAccountData(account) {
  if (!account?.data?.[0]) return null;
  return Buffer.from(account.data[0], 'base64');
}

function relevantLogs(logs) {
  return (logs || []).filter((line) =>
    line.includes('Instruction:') ||
    line.includes('AnchorError') ||
    line.includes('Error') ||
    line.includes('failed') ||
    line.includes('invalid') ||
    line.includes('Invalid'),
  ).slice(-18);
}

async function simulateWire(wire, addresses = [], replaceRecentBlockhash = false) {
  const result = await rpc('simulateTransaction', [Buffer.from(wire).toString('base64'), {
    encoding: 'base64',
    sigVerify: false,
    replaceRecentBlockhash,
    commitment: 'processed',
    innerInstructions: true,
    ...(addresses.length ? {accounts: {encoding: 'base64', addresses: addresses.map(String)}} : {}),
  }]);
  return result;
}

async function compileAndSimulate(connection, template, instructions, addresses = []) {
  const {blockhash} = await connection.getLatestBlockhash('processed');
  const message = new TransactionMessage({
    payerKey: template.message.payerKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(template.lookupAccounts);
  const transaction = new VersionedTransaction(message);
  const result = await simulateWire(transaction.serialize(), addresses, false);
  return {result, wireBytes: transaction.serialize().length};
}

function summarize(label, simulation, addresses, preData, extra = {}) {
  const value = simulation.result.value;
  const accountAmounts = {};
  addresses.forEach((address, index) => {
    const postData = returnedAccountData(value.accounts?.[index]);
    const before = tokenAmount(preData[index]?.data);
    const after = tokenAmount(postData);
    accountAmounts[address.toString()] = {
      before,
      after,
      delta: before !== null && after !== null ? (BigInt(after) - BigInt(before)).toString() : null,
    };
  });
  return {
    label,
    err: value.err,
    unitsConsumed: value.unitsConsumed ?? null,
    wireBytes: simulation.wireBytes ?? null,
    accountAmounts,
    relevantLogs: relevantLogs(value.logs),
    ...extra,
  };
}

async function accountSnapshots(connection, addresses) {
  return connection.getMultipleAccountsInfo(addresses, 'processed');
}

async function alternateDestination(connection, originalDestination, sourceVault) {
  const parsed = await connection.getParsedAccountInfo(originalDestination, 'processed');
  const mint = parsed.value?.data?.parsed?.info?.mint;
  if (!mint) throw new Error(`cannot determine mint for ${originalDestination}`);
  const candidateRow = vaultCensus.rows
    .filter((row) => row.mint === mint && row.address !== originalDestination.toString() && row.address !== sourceVault.toString())
    .sort((left, right) => {
      const a = BigInt(left.rawAmount);
      const b = BigInt(right.rawAmount);
      return a === b ? 0 : a > b ? -1 : 1;
    })[0];
  const candidate = candidateRow ? {address: new PublicKey(candidateRow.address)} : null;
  if (!candidate) throw new Error(`no alternate token account for mint ${mint}`);
  return {mint, address: candidate.address};
}

async function main() {
  const connection = new Connection(rpcUrl, 'processed');
  const results = {
    generatedAt: new Date().toISOString(),
    program: PROGRAM_ID.toString(),
    safety: 'simulateTransaction only; no transaction submitted',
    controls: {},
    mutations: [],
  };

  const borrowSignature = replay.successfulReplays.LendingAccountBorrow.signature;
  const borrow = await decompileControl(connection, borrowSignature);
  const borrowIndex = borrow.message.instructions.findIndex((ix) =>
    ix.programId.equals(PROGRAM_ID) && Buffer.from(ix.data).subarray(0, 8).equals(Buffer.from([4, 126, 116, 53, 48, 5, 212, 31])),
  );
  if (borrowIndex < 0) throw new Error('borrow instruction not found');
  const borrowIx = borrow.message.instructions[borrowIndex];
  const bank = borrowIx.keys[3].pubkey;
  const originalDestination = borrowIx.keys[4].pubkey;
  const sourceVault = borrowIx.keys[6].pubkey;
  const {mint, address: alternateTokenAccount} = await alternateDestination(connection, originalDestination, sourceVault);
  const tracked = [sourceVault, originalDestination, alternateTokenAccount];
  const trackedPre = await accountSnapshots(connection, tracked);

  const borrowPositive = await compileAndSimulate(connection, borrow, cloneInstructions(borrow.message.instructions), tracked);
  results.controls.borrow = summarize('current-state borrow replay', borrowPositive, tracked, trackedPre, {
    sourceSignature: borrowSignature,
    targetInstructionIndex: borrowIndex,
    amountRaw: Buffer.from(borrowIx.data).readBigUInt64LE(8).toString(),
    mint,
    bank: bank.toString(),
    sourceVault: sourceVault.toString(),
    originalDestination: originalDestination.toString(),
  });

  const compactBorrow = [
    ComputeBudgetProgram.setComputeUnitLimit({units: 1_400_000}),
    cloneInstruction(borrowIx),
  ];
  const compactBorrowPositive = await compileAndSimulate(connection, borrow, compactBorrow, tracked);
  results.controls.borrowCompact = summarize('isolated current-state borrow control', compactBorrowPositive, tracked, trackedPre, {
    sourceSignature: borrowSignature,
    amountRaw: Buffer.from(borrowIx.data).readBigUInt64LE(8).toString(),
  });

  const unauthorized = cloneInstructions(borrow.message.instructions);
  unauthorized[borrowIndex].keys[2].pubkey = SYSTEM_PROGRAM;
  const unauthorizedSim = await compileAndSimulate(connection, borrow, unauthorized, tracked);
  results.mutations.push(summarize('borrow: substitute unauthorized signer', unauthorizedSim, tracked, trackedPre, {
    expected: 'reject before value transfer',
    changedAccount: 'authority',
    replacement: SYSTEM_PROGRAM.toString(),
  }));

  const redirect = cloneInstructions(compactBorrow);
  redirect[1].keys[4].pubkey = alternateTokenAccount;
  const redirectSim = await compileAndSimulate(connection, borrow, redirect, tracked);
  results.mutations.push(summarize('borrow: redirect authorized destination', redirectSim, tracked, trackedPre, {
    expected: 'authorized destination is caller-selectable; authority gate must remain effective',
    changedAccount: 'destination_token_account',
    replacement: alternateTokenAccount.toString(),
  }));

  const wrongVault = cloneInstructions(borrow.message.instructions);
  wrongVault[borrowIndex].keys[6].pubkey = alternateTokenAccount;
  const wrongVaultSim = await compileAndSimulate(connection, borrow, wrongVault, tracked);
  results.mutations.push(summarize('borrow: substitute liquidity vault', wrongVaultSim, tracked, trackedPre, {
    expected: 'reject bank-vault binding mismatch',
    changedAccount: 'liquidity_vault',
    replacement: alternateTokenAccount.toString(),
  }));

  const otherBankRow = vaultCensus.rows.find((row) =>
    row.kind === 'liquidity' && row.group === borrowIx.keys[0].pubkey.toString() && row.bank !== bank.toString(),
  );
  if (!otherBankRow) throw new Error('no alternate bank in same group');
  const wrongBank = cloneInstructions(borrow.message.instructions);
  wrongBank[borrowIndex].keys[3].pubkey = new PublicKey(otherBankRow.bank);
  const wrongBankSim = await compileAndSimulate(connection, borrow, wrongBank, tracked);
  results.mutations.push(summarize('borrow: substitute same-group bank', wrongBankSim, tracked, trackedPre, {
    expected: 'reject bank/vault/oracle account mismatch',
    changedAccount: 'bank',
    replacement: otherBankRow.bank,
  }));

  const wrongProgram = cloneInstructions(borrow.message.instructions);
  wrongProgram[borrowIndex].keys[7].pubkey = SYSTEM_PROGRAM;
  const wrongProgramSim = await compileAndSimulate(connection, borrow, wrongProgram, tracked);
  results.mutations.push(summarize('borrow: substitute CPI token program', wrongProgramSim, tracked, trackedPre, {
    expected: 'reject token-program interface mismatch',
    changedAccount: 'token_program',
    replacement: SYSTEM_PROGRAM.toString(),
  }));

  const duplicatedBorrow = cloneInstructions(compactBorrow);
  duplicatedBorrow.push(cloneInstruction(duplicatedBorrow[1]));
  try {
    const duplicatedBorrowSim = await compileAndSimulate(connection, borrow, duplicatedBorrow, tracked);
    results.mutations.push(summarize('borrow: duplicate authorized borrow', duplicatedBorrowSim, tracked, trackedPre, {
      expected: 'each borrow independently enforces authorization and health',
      changedAccount: 'instruction duplication',
    }));
  } catch (error) {
    results.mutations.push({
      label: 'borrow: duplicate authorized borrow',
      harnessError: error.message,
      expected: 'each borrow independently enforces authorization and health',
      changedAccount: 'instruction duplication',
    });
  }

  const atomicRollback = cloneInstructions(compactBorrow);
  atomicRollback.push(new TransactionInstruction({programId: SYSTEM_PROGRAM, keys: [], data: Buffer.from([255])}));
  const atomicRollbackSim = await compileAndSimulate(connection, borrow, atomicRollback, tracked);
  results.mutations.push(summarize('borrow then forced failure: atomic rollback', atomicRollbackSim, tracked, trackedPre, {
    expected: 'later failure rolls back the earlier token transfer',
    changedAccount: 'same-transaction terminal failure',
  }));

  const repaySignature = replay.successfulReplays.LendingAccountRepay.signature;
  const repay = await decompileControl(connection, repaySignature);
  const repayTracked = [];
  const repayPre = [];
  const repayPositive = await simulateWire(repay.transaction.serialize(), [], true);
  results.controls.repayFlashloan = {
    label: 'current-state borrow/swap/repay/end-flashloan replay',
    sourceSignature: repaySignature,
    err: repayPositive.value.err,
    unitsConsumed: repayPositive.value.unitsConsumed ?? null,
    relevantLogs: relevantLogs(repayPositive.value.logs),
  };

  const startIndex = repay.message.instructions.findIndex((ix) =>
    ix.programId.equals(PROGRAM_ID) && Buffer.from(ix.data).subarray(0, 8).equals(Buffer.from([14, 131, 33, 220, 81, 186, 180, 107])),
  );
  const repayIndex = repay.message.instructions.findIndex((ix) =>
    ix.programId.equals(PROGRAM_ID) && Buffer.from(ix.data).subarray(0, 8).equals(Buffer.from([79, 209, 172, 177, 222, 51, 173, 151])),
  );
  const endIndex = repay.message.instructions.findIndex((ix) =>
    ix.programId.equals(PROGRAM_ID) && Buffer.from(ix.data).subarray(0, 8).equals(Buffer.from([105, 124, 201, 106, 153, 2, 8, 156])),
  );
  if (startIndex < 0 || repayIndex < 0 || endIndex < 0) throw new Error('flashloan instruction set incomplete');

  const badDeclaredEnd = cloneInstructions(repay.message.instructions);
  Buffer.from(badDeclaredEnd[startIndex].data).writeBigUInt64LE(BigInt(repayIndex), 8);
  badDeclaredEnd[startIndex].data.writeBigUInt64LE(BigInt(repayIndex), 8);
  const badDeclaredEndSim = await compileAndSimulate(connection, repay, badDeclaredEnd, repayTracked);
  results.mutations.push(summarize('flashloan: declared end points to repay', badDeclaredEndSim, repayTracked, repayPre, {
    expected: 'reject incorrect end instruction/index',
    changedAccount: 'flashloan end_index',
    declaredEndIndex: repayIndex,
  }));

  const reordered = cloneInstructions(repay.message.instructions);
  [reordered[repayIndex], reordered[endIndex]] = [reordered[endIndex], reordered[repayIndex]];
  const reorderedSim = await compileAndSimulate(connection, repay, reordered, repayTracked);
  results.mutations.push(summarize('flashloan: end before repay', reorderedSim, repayTracked, repayPre, {
    expected: 'reject instruction reordering / fail final health before repayment',
    changedAccount: 'instruction order',
  }));

  // Compact no-borrow start/end control isolates duplication from swap state.
  const compact = [cloneInstruction(repay.message.instructions[0]), cloneInstruction(repay.message.instructions[startIndex]), cloneInstruction(repay.message.instructions[endIndex])];
  compact[1].data.writeBigUInt64LE(2n, 8);
  const compactPositive = await compileAndSimulate(connection, repay, compact, []);
  results.controls.flashloanOrdering = {
    label: 'compact start/end ordering control',
    err: compactPositive.result.value.err,
    unitsConsumed: compactPositive.result.value.unitsConsumed ?? null,
    wireBytes: compactPositive.wireBytes,
    relevantLogs: relevantLogs(compactPositive.result.value.logs),
  };

  const duplicateStart = [cloneInstruction(compact[0]), cloneInstruction(compact[1]), cloneInstruction(compact[1]), cloneInstruction(compact[2])];
  duplicateStart[1].data.writeBigUInt64LE(3n, 8);
  duplicateStart[2].data.writeBigUInt64LE(3n, 8);
  const duplicateStartSim = await compileAndSimulate(connection, repay, duplicateStart, []);
  results.mutations.push(summarize('flashloan: duplicate start', duplicateStartSim, [], [], {
    expected: 'reject duplicate flashloan start',
    changedAccount: 'instruction duplication',
  }));

  fs.writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    controls: Object.fromEntries(Object.entries(results.controls).map(([name, value]) => [name, value.err])),
    mutations: results.mutations.map((value) => ({label: value.label, err: value.err, harnessError: value.harnessError})),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
