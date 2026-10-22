#!/usr/bin/env node
'use strict';

// Local Surfpool fork only. Builds and signs custom Solana v1 packets with a
// fresh attacker key. No mainnet send method exists in this script.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const HERE = __dirname;
const modules = path.join(HERE, '../onre-harness/node_modules');
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram} = require(path.join(modules, '@solana/web3.js'));
const bs58 = require(path.join(modules, 'bs58'));
const RPC = 'http://127.0.0.1:8997';
const PROGRAM = new PublicKey('GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const snapshot = JSON.parse(fs.readFileSync(path.join(HERE, 'current-snapshot.json'), 'utf8'));
const graph = JSON.parse(fs.readFileSync(path.join(HERE, 'governance-graph-decoded.json'), 'utf8'));
const upgradeGraph = JSON.parse(fs.readFileSync(path.join(HERE, 'upgrade-control-graph-decoded.json'), 'utf8'));
const upgradeRaw = JSON.parse(fs.readFileSync(path.join(HERE, 'upgrade-control-graph-raw.json'), 'utf8'));
const lender = JSON.parse(fs.readFileSync(path.join(HERE, 'lender-relevance.json'), 'utf8'));
const fixtureBinary = path.join(HERE, 'decoder/target/release/make_fixture');
const P = (value) => new PublicKey(value);
const targets = [
  {
    authority: P('6Va7K51FRbnPcYZTUwkoFfoYtnfh8qyJaZqT4W1GGxVi'),
    vault: P('C2KKuAq4UaUFYtm3zcxZMSDUuSEfPSk4yLcq5XaBr4wM'),
    amount: 450000000000000000n,
    completedProposal: P('G5zTYYmtjMuossZZ2QUUKX11sMXXBJYLoJpYsDGKYvo7'),
    completedTransaction: P('2yh3srnymhEnfJt2aQ8FCuSBgpPzpq3BgnwEX3ZKSGdG'),
    zeroTransactionSucceededProposal: P('7yLYffXcbCKeUegP16G8e6dZfisE8gioigSZTEusMGbm'),
  },
  {
    authority: P('2jfAMh48b37bBTKkoNwmvNZAqVQc1G7gh5vYv5FoWTUR'),
    vault: P('8vXYj8B567R8Di7BUvquiGC7usyPMtL756xx6KERfW9K'),
    amount: 359127679505000000n,
    completedProposal: P('AsFXq3TDNn174eMfcQg8nmisMJeogmgWzFwJ1kY9x9zt'),
    completedTransaction: P('GGudseLF1TaepTx8PvTQybbowXb7QiE5Lzm6f6BiYVHh'),
    zeroTransactionSucceededProposal: P('bkCvYKC4TCbXoob2dpYMgRWPRbnQ8a3yuxJA5Cd7cd5'),
  },
];

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// Encode the no-ALT v1 packet used by the active Solana runtime. Keeping the
// encoder here avoids importing an unrelated harness or any RPC configuration.
function encodeV1(instructions, payer, blockhash, computeLimit = 1400000, dataLimit = 67108864) {
  const v0 = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions}).compileToV0Message();
  if (v0.addressTableLookups.length) throw new Error('v1 packet cannot contain ALTs');
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64) throw new Error('v1 address/instruction limit exceeded');
  const config = Buffer.alloc(8);
  config.writeUInt32LE(computeLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const instructionHeaders = items.map((instruction) => {
    const header = Buffer.alloc(4);
    header[0] = instruction.programIdIndex;
    header[1] = instruction.accountKeyIndexes.length;
    header.writeUInt16LE(instruction.data.length, 2);
    return header;
  });
  const instructionPayloads = items.map((instruction) => Buffer.concat([
    Buffer.from(instruction.accountKeyIndexes), Buffer.from(instruction.data),
  ]));
  const wire = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures,
      v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]),
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]),
    ...keys.map((key) => key.toBuffer()), config, ...instructionHeaders, ...instructionPayloads,
    Buffer.alloc(64 * v0.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 size limit exceeded: ${wire.length}`);
  return {
    wire,
    sizeBytes: wire.length,
    addressCount: keys.length,
    instructionCount: items.length,
    requiredSignatures: v0.header.numRequiredSignatures,
  };
}
function tokenImage(row) {
  if (!row?.data) return null;
  const data = Buffer.from(row.data[0], 'base64');
  if (row.owner !== TOKEN.toBase58() || data.length !== 165) return {owner: row.owner, lamports: row.lamports, dataLength: data.length, dataSha256: sha256(data)};
  return {ownerProgram: row.owner, mint: P(data.subarray(0, 32)).toBase58(), authority: P(data.subarray(32, 64)).toBase58(),
    amountRaw: data.readBigUInt64LE(64).toString(), delegateTag: data.readUInt32LE(72), closeAuthorityTag: data.readUInt32LE(129), dataSha256: sha256(data)};
}
async function setAccount(address, row, data) {
  await rpc('surfnet_setAccount', [address.toBase58(), {
    data: data.toString('hex'), executable: row.executable, lamports: row.lamports,
    owner: row.owner, rentEpoch: 0,
  }]);
}
function signV1(encoded, instructions, payer, blockhash, signers) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions}).compileToV0Message();
  const signed = Buffer.from(encoded.wire);
  const count = encoded.requiredSignatures;
  const message = signed.subarray(0, signed.length - 64 * count);
  const order = compiled.staticAccountKeys.slice(0, count).map(String);
  for (let index = 0; index < count; index += 1) {
    const keypair = signers.get(order[index]);
    if (!keypair) throw new Error(`packet asks for uncontrolled signer ${order[index]}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey).copy(signed, signed.length - 64 * count + 64 * index);
  }
  return {signed, signerOrder: order};
}
async function simulate(label, instructions, attacker, watched) {
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
  const {signed, signerOrder} = signV1(encoded, instructions, attacker.publicKey, blockhash,
    new Map([[attacker.publicKey.toBase58(), attacker]]));
  const before = await rpc('getMultipleAccounts', [watched.map(String), {encoding: 'base64', commitment: 'processed'}]);
  const result = await rpc('simulateTransaction', [signed.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  const afterChain = await rpc('getMultipleAccounts', [watched.map(String), {encoding: 'base64', commitment: 'processed'}]);
  const pre = before.value.map(tokenImage);
  const post = (result.value.accounts || []).map(tokenImage);
  const chainAfter = afterChain.value.map(tokenImage);
  const delta = post.map((row, index) => row?.amountRaw !== undefined && pre[index]?.amountRaw !== undefined ?
    (BigInt(row.amountRaw) - BigInt(pre[index].amountRaw)).toString() : null);
  return {
    label,
    forkBaselineSlot: before.context.slot,
    simulationSlot: result.context.slot,
    transactionError: result.value.err,
    message: {version: 1, serializedBytes: signed.length, sha256: sha256(signed), accountCount: encoded.addressCount,
      instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      signerOrder, byteLimit: 4096, accountLimit: 64, withinLimits: signed.length <= 4096 && encoded.addressCount <= 64},
    signaturesVerified: true,
    watched: watched.map(String), pre, simulatedPost: post, simulatedDeltaRaw: delta,
    localForkStateAfterSimulation: chainAfter,
    localForkSimulationRolledBack: JSON.stringify(pre) === JSON.stringify(chainAfter),
    unitsConsumed: result.value.unitsConsumed,
    loadedAccountsDataSize: result.value.loadedAccountsDataSize,
    logs: result.value.logs,
    innerInstructions: result.value.innerInstructions,
  };
}
function directTransfer(target, destination) {
  const data = Buffer.alloc(9); data[0] = 3; data.writeBigUInt64LE(target.amount, 1);
  return new TransactionInstruction({programId: TOKEN, keys: [
    {pubkey: target.vault, isSigner: false, isWritable: true},
    {pubkey: destination, isSigner: false, isWritable: true},
    // Deliberately not a transaction signer: an outsider cannot sign for this PDA.
    {pubkey: target.authority, isSigner: false, isWritable: false},
  ], data});
}
function decodedTransaction(address) {
  const row = graph.proposalChildren.find((item) => item.details.address === address.toBase58());
  if (!row) throw new Error(`decoded proposal transaction missing ${address}`);
  return row.details;
}
function executeInstruction(target, proposal, stored) {
  const instruction = stored.instructions[0];
  const programId = P(instruction.programId);
  return new TransactionInstruction({programId: PROGRAM, keys: [
    {pubkey: target.authority, isSigner: false, isWritable: false},
    {pubkey: proposal, isSigner: false, isWritable: true},
    {pubkey: target.completedTransaction, isSigner: false, isWritable: true},
    {pubkey: programId, isSigner: false, isWritable: false},
    ...instruction.accounts.map((meta) => ({pubkey: P(meta.pubkey), isSigner: false, isWritable: meta.isWritable})),
  ], data: Buffer.from([16])});
}
function patchedExecuteInstruction(target, destination) {
  return new TransactionInstruction({programId: PROGRAM, keys: [
    {pubkey: target.authority, isSigner: false, isWritable: false},
    {pubkey: target.completedProposal, isSigner: false, isWritable: true},
    {pubkey: target.completedTransaction, isSigner: false, isWritable: true},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: target.vault, isSigner: false, isWritable: true},
    {pubkey: destination, isSigner: false, isWritable: true},
    {pubkey: target.authority, isSigner: false, isWritable: false},
  ], data: Buffer.from([16])});
}
function fixture(destination, target) {
  const output = cp.execFileSync(fixtureBinary, [destination.toBase58(), target.amount.toString(), target.completedProposal.toBase58(),
    target.completedTransaction.toBase58(), target.authority.toBase58(), target.vault.toBase58()], {encoding: 'utf8'});
  return JSON.parse(output);
}

async function main() {
  if (!fs.existsSync(fixtureBinary)) throw new Error('build make_fixture first');
  const attacker = Keypair.generate();
  await rpc('surfnet_setAccount', [attacker.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10000000000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);

  const binaryRows = await rpc('getMultipleAccounts', [[snapshot.program.address, snapshot.programdata.address], {encoding: 'base64', commitment: 'processed'}]);
  const forkProgramdata = Buffer.from(binaryRows.value[1].data[0], 'base64');
  const forkElf = forkProgramdata.subarray(forkProgramdata[12] === 1 ? 45 : 13);
  const binaryIdentity = {
    forkSlot: binaryRows.context.slot,
    programOwner: binaryRows.value[0].owner,
    programExecutable: binaryRows.value[0].executable,
    programdataFullSha256: sha256(forkProgramdata),
    expectedProgramdataFullSha256: snapshot.programdata.fullDataSha256,
    elfSha256: sha256(forkElf),
    expectedElfSha256: snapshot.programdata.elfSha256,
    exactCurrentBinaryMatch: sha256(forkProgramdata) === snapshot.programdata.fullDataSha256 && sha256(forkElf) === snapshot.programdata.elfSha256,
  };
  if (!binaryIdentity.exactCurrentBinaryMatch) throw new Error('fork did not load the snapshotted current binary');

  const cases = [];
  const destinations = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const destination = Keypair.generate().publicKey;
    destinations.push(destination);
    const vaultRow = (await rpc('getAccountInfo', [target.vault.toBase58(), {encoding: 'base64', commitment: 'processed'}])).value;
    const destinationData = Buffer.from(vaultRow.data[0], 'base64');
    attacker.publicKey.toBuffer().copy(destinationData, 32);
    destinationData.writeBigUInt64LE(0n, 64);
    destinationData.writeUInt32LE(0, 72);
    destinationData.writeBigUInt64LE(0n, 121);
    destinationData.writeUInt32LE(0, 129);
    await rpc('surfnet_setAccount', [destination.toBase58(), {data: destinationData.toString('hex'), executable: false,
      lamports: vaultRow.lamports, owner: TOKEN.toBase58(), rentEpoch: 0}]);

    cases.push(await simulate(`target_${index + 1}_direct_full_balance_transfer_without_pda_signature`,
      [directTransfer(target, destination)], attacker, [target.vault, destination]));
    const stored = decodedTransaction(target.completedTransaction);
    cases.push(await simulate(`target_${index + 1}_permissionless_execute_completed_transaction`,
      [executeInstruction(target, target.completedProposal, stored)], attacker, [target.vault, destination]));
    cases.push(await simulate(`target_${index + 1}_succeeded_zero_tx_proposal_with_foreign_transaction`,
      [executeInstruction(target, target.zeroTransactionSucceededProposal, stored)], attacker, [target.vault, destination]));

    const proposalRow = (await rpc('getAccountInfo', [target.completedProposal.toBase58(), {encoding: 'base64', commitment: 'processed'}])).value;
    const transactionRow = (await rpc('getAccountInfo', [target.completedTransaction.toBase58(), {encoding: 'base64', commitment: 'processed'}])).value;
    const positiveFixture = fixture(destination, target);
    await setAccount(target.completedProposal, proposalRow, Buffer.from(positiveFixture.proposal.dataBase64, 'base64'));
    await setAccount(target.completedTransaction, transactionRow, Buffer.from(positiveFixture.proposalTransaction.dataBase64, 'base64'));
    const positive = await simulate(`target_${index + 1}_synthetic_authorized_state_positive_control_full_live_balance`,
      [patchedExecuteInstruction(target, destination)], attacker, [target.vault, destination, target.completedProposal, target.completedTransaction]);
    positive.syntheticFixture = positiveFixture;
    cases.push(positive);
    await setAccount(target.completedProposal, proposalRow, Buffer.from(proposalRow.data[0], 'base64'));
    await setAccount(target.completedTransaction, transactionRow, Buffer.from(transactionRow.data[0], 'base64'));
  }

  const combined = await simulate('both_vaults_direct_full_balance_transfers_one_atomic_v1',
    targets.map((target, index) => directTransfer(target, destinations[index])), attacker,
    [targets[0].vault, destinations[0], targets[1].vault, destinations[1]]);
  cases.push(combined);

  const controller = P(upgradeRaw.controller.program.address);
  const controllerGovernance = P(upgradeRaw.controller.governance);
  const retryProposal = P('6cxVviQHwZd9119zbraPkohtJxNmsCrsGLA3qwohXzeW');
  const retryTransaction = P('4XT3sX2DC6LFYrE4iiK7DbXhMLciAfifxU3YUyMZccWP');
  const retryStored = upgradeGraph.proposalChildren.find((item) => item.details.address === retryTransaction.toBase58()).details;
  const retryInner = retryStored.instructions[0];
  const retry = new TransactionInstruction({programId: controller, keys: [
    {pubkey: controllerGovernance, isSigner: false, isWritable: false},
    {pubkey: retryProposal, isSigner: false, isWritable: true},
    {pubkey: retryTransaction, isSigner: false, isWritable: true},
    {pubkey: P(retryInner.programId), isSigner: false, isWritable: false},
    ...retryInner.accounts.map((meta) => ({pubkey: P(meta.pubkey), isSigner: false, isWritable: meta.isWritable})),
  ], data: Buffer.from([16])});
  const retryCase = await simulate('upgrade_controller_retryable_error_record_outsider_without_fixed_external_signer',
    [retry], attacker, [P(snapshot.programdata.address), controllerGovernance, retryProposal, retryTransaction]);
  retryCase.fixedStoredSigners = retryInner.accounts.filter((meta) => meta.isSigner).map((meta) => meta.pubkey);
  retryCase.scopeAssessment = 'Stored instruction adds a fixed council member; it neither references a selected PHY vault nor permits caller-selected accounts.';
  cases.push(retryCase);

  const lenderRows = lender.rows.map((row) => ({role: row.role, mint: row.mint,
    klendMatchingReserves: row.klend.matchingReserveCount, project0MatchingBanks: row.project0.matchingBankCount}));
  const output = {
    generatedAt: new Date().toISOString(),
    safety: {transport: 'Surfpool current-mainnet fork only', rpcEndpoint: RPC,
      transactionMethod: 'simulateTransaction only', mainnetTransactionsSubmitted: 0,
      attackerKey: 'fresh local ephemeral keypair; only public key retained', syntheticStateMutation: true},
    sourceSnapshotSlot: snapshot.observedSlot,
    binaryIdentity,
    attackerPublicKey: attacker.publicKey.toBase58(),
    targets: targets.map((target) => ({authority: target.authority.toBase58(), vault: target.vault.toBase58(), amountRaw: target.amount.toString()})),
    atomicFlashApplicability: {
      lenderRows,
      capitalSensitivity: {
        directTokenSpend: 'not capital-sensitive; requires the existing token-account authority signature',
        executeStoredTransaction: 'not capital-sensitive; requires a program-owned proposal/transaction pair in an executable state',
        createAndApproveNewProposal: 'capital-sensitive only to the exact governing membership mint, not PHY or generic quote capital',
        upgradeControllerRetry: 'not capital-sensitive; stored instruction requires a fixed external signer and has fixed accounts',
      },
      governingSupplyBlockers: lender.rows.filter((row) => row.role.includes('community') || row.role.includes('council')).map((row) => ({
        role: row.role, mint: row.mint, supplyRaw: row.mintState.supplyRaw,
        entirePositiveSupplyAccountedFor: row.positiveSupplyInventory.entirePositiveSupplyAccountedFor,
        positiveAccounts: row.largestAccounts.filter((item) => item.amountRaw !== '0').map((item) => ({address: item.address, amountRaw: item.amountRaw, owner: item.tokenState?.owner})),
      })),
      conclusion: 'No live KLend reserve or Project0/marginfi bank exists for any of the five relevant mints. Both community mints have zero supply. All 8 target-realm council units and all 7 upgrade-controller council units are already in their respective realm holdings, accounting for 100% of each positive membership supply; therefore no AMM or additional flash provider can hold positive exact-mint inventory for a swap or loan. PHY is not a governing token. Unrelated flash capital cannot create a PDA, council, or fixed external signature.',
      fullRepaymentTested: false,
      reverseSwapTested: false,
      exactAvailableAndBoundaryTests: 'not constructible: there is no reserve, bank, pool inventory, or other positive external token balance for either governing mint, so no provider account exists at which to test available-1/exact/available+1',
      triOrMaximumSourceCombination: 'not constructible and cannot affect these authorization-gated actions; provider count for the required governing asset is zero',
      reasonNotTested: 'No relevant same-mint lender route or governing-token route exists; fabricating a provider or wrapping the action with unrelated USDC/wSOL would not test an immediate live outsider path.',
    },
    guardsTested: ['SPL Token owner signature', 'proposal final-state execution guard', 'proposal/transaction binding', 'governance-PDA invoke_signed positive control'],
    cases,
  };
  const outputPath = path.join(HERE, 'local-fork-current-binary.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({outputPath, binaryIdentity, cases: cases.map((row) => ({
    label: row.label, error: row.transactionError, bytes: row.message.serializedBytes,
    accounts: row.message.accountCount, signers: row.message.signerOrder,
    deltas: row.simulatedDeltaRaw, rolledBack: row.localForkSimulationRolledBack,
    logTail: row.logs?.slice(-7),
  }))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
