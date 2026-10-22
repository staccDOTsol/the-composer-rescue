#!/usr/bin/env node
'use strict';

// Submit a signed v1 transaction to the local Surfpool mainnet fork only.
// There is intentionally no configurable remote submission endpoint.

const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {SystemProgram, TransactionInstruction} =
  require(`${MODULES}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction} =
  require(`${MODULES}/@solana/spl-token`);
const {buildFlashEnvelope, simulateFlashEnvelope, rpc} = require('./real-flash-envelope.js');
const {
  FORK, POOL, POSITION, WSOL_VAULT, USDC_MINT, USDC_VAULT,
  actor, margin, ataA, ataB, swap, update, tokenAmount, positionImage,
} = require('./real-flash-swap-roundtrip.js');

if (FORK !== 'http://127.0.0.1:48899') throw new Error('Send is limited to local fork :48899');
const watch = [POOL, POSITION, WSOL_VAULT, USDC_VAULT, ataA, ataB];
const key = (pubkey, isWritable) => ({pubkey, isSigner: false, isWritable});

async function images(addresses) {
  const response = await rpc(FORK, 'getMultipleAccounts', [addresses,
    {encoding: 'base64', commitment: 'processed'}]);
  return Object.fromEntries(addresses.map((address, index) => [address, {
    exists: !!response.value[index],
    tokenAmount: tokenAmount(response.value[index]),
    position: address === POSITION.toBase58()
      ? positionImage(response.value[index]) : undefined,
  }]));
}

async function main() {
  if (await rpc(FORK, 'getGenesisHash') !==
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('Not Solana mainnet-backed fork');
  await rpc(FORK, 'surfnet_setAccount', [actor.publicKey.toBase58(), {
    data: '', executable: false, lamports: 1_000_000_000,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
  const beforeBorrow = [
    createAssociatedTokenAccountIdempotentInstruction(
      actor.publicKey, ataB, actor.publicKey, USDC_MINT),
    SystemProgram.transfer({fromPubkey: actor.publicKey,
      toPubkey: ataA, lamports: 30_000}),
    new TransactionInstruction({programId: TOKEN_PROGRAM_ID,
      keys: [key(ataA, true)], data: Buffer.from([17])}),
  ];
  const payloadInstructions = [
    swap({amount: 1_000_000n, exactInput: true, aToB: true}), update(),
    swap({amount: 980_000n, exactInput: false, aToB: false}), update(),
  ];
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const envelope = buildFlashEnvelope({actor, marginAccount: margin,
    providers: ['save', 'klend', 'project0'], beforeBorrow,
    payloadInstructions, blockhash});
  // Surfpool's send path tries an upstream fetch for each uncached, absent
  // account even though its simulation path handles absence. A zero-lamport
  // System account is semantically absent to create-account and ATA programs,
  // but marks that key as locally known to Surfpool's send path.
  const programKeys = new Set(envelope.instructions.map(ix => ix.programId.toBase58()));
  const seededAbsentAccounts = [];
  const instructionKeys = [...new Set(envelope.instructions.flatMap(ix =>
    ix.keys.map(key => key.pubkey.toBase58())))];
  for (const address of instructionKeys) {
    if (programKeys.has(address)) continue;
    const info = await rpc(FORK, 'getAccountInfo', [address,
      {encoding: 'base64', commitment: 'processed'}]);
    if (info.value) continue;
    await rpc(FORK, 'surfnet_setAccount', [address, {
      data: '', executable: false, lamports: 0,
      owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
    }]);
    seededAbsentAccounts.push(address);
  }
  const control = await simulateFlashEnvelope(FORK, envelope, watch);
  console.log(JSON.stringify({seededAbsentAccounts}));
  if (control.err || !control.completeRepayment ||
      control.logs.filter(line => line.includes('Program log: Instruction: Swap')).length !== 2)
    throw new Error(`Signed local simulation failed: ${JSON.stringify(control.err)}`);
  const addresses = [...new Set([
    ...Object.values(envelope.lenderAccounts), ...watch.map(value => value.toBase58()),
  ])];
  const before = await images(addresses);
  const signature = await rpc(FORK, 'sendTransaction', [envelope.wire.toString('base64'),
    {encoding: 'base64', skipPreflight: true, preflightCommitment: 'processed'}]);
  let transaction = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    transaction = await rpc(FORK, 'getTransaction', [signature,
      {encoding: 'json', commitment: 'processed', maxSupportedTransactionVersion: 1}]);
    if (transaction) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const status = await rpc(FORK, 'getSignatureStatuses', [[signature],
    {searchTransactionHistory: true}]);
  const after = await images(addresses);
  const deltas = Object.fromEntries(addresses.map(address => {
    const first = before[address].tokenAmount;
    const last = after[address].tokenAmount;
    return [address, first !== null && last !== null
      ? String(BigInt(last) - BigInt(first)) : null];
  }));
  const logs = transaction?.meta?.logMessages || [];
  const receipt = {schema: 'orca-pr1396-real-flash-local-ledger-execution/v1',
    execution: 'local Surfpool mainnet-backed fork only', mainnetSubmission: false,
    signature, status: status.value[0], transactionVersion: transaction?.version ?? null,
    transactionSlot: transaction?.slot ?? null,
    transactionError: transaction?.meta?.err ?? null,
    transactionUnitsConsumed: transaction?.meta?.computeUnitsConsumed ?? null,
    signedWireBase64: envelope.wire.toString('base64'),
    wire: envelope.stats, indexes: envelope.index, seededAbsentAccounts,
    before, after, tokenDeltas: deltas, logs,
    priorSimulation: {err: control.err, completeRepayment: control.completeRepayment,
      unitsConsumed: control.unitsConsumed},
  };
  fs.writeFileSync(path.join(__dirname, 'real-flash-send.json'),
    `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({signature, status: receipt.status,
    transactionVersion: receipt.transactionVersion,
    transactionError: receipt.transactionError,
    transactionUnitsConsumed: receipt.transactionUnitsConsumed,
    logCount: logs.length, logLast: logs.at(-1), wire: envelope.stats,
    seededAbsentAccounts,
    lenderDeltas: {
      save: deltas[envelope.lenderAccounts.saveSupply],
      klend: deltas[envelope.lenderAccounts.klendSupply],
      project0: deltas[envelope.lenderAccounts.p0Vault],
      saveFee: deltas[envelope.lenderAccounts.saveFee],
    }}));
  if (!transaction || transaction.meta.err ||
      !['0', '400'].includes(deltas[envelope.lenderAccounts.saveFee]) ||
      [envelope.lenderAccounts.saveSupply,
        envelope.lenderAccounts.klendSupply,
        envelope.lenderAccounts.p0Vault].some(address => deltas[address] !== '0'))
    throw new Error('Local ledger execution did not meet lender invariants');
}

main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
