// Read-only mainnet simulation of the current Magna Airlock V2 executable.
// This script never signs or sends a transaction. It emits Solana v1 wire
// messages only to simulateTransaction with sigVerify:false.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, TransactionInstruction, TransactionMessage,
  SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const {encodeV1} = require('./klend-v1-composition.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const connection = new Connection(rpcUrl, 'confirmed');
const P = value => new PublicKey(value);
const u64 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const anchorDisc = name => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const ids = {
  magna: P('magnaSHyv8zzKJJmr8NSz5JXmtdGDTTFPEADmvNAwbj'),
  state: P('2RH6rUTPBJ9rUDPpuV9b8z1YL56k1tYU6Uk5ZoaEFFSK'),
  vault: P('HkykUVWTctptXZmRTWearMsH4SaQNmE4Ku3tMJe5v2mH'),
  mint: P('6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'),
  token: P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  associatedToken: P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  beneficiaryToken: P('PBNRanKsUPjUqUxNRM7YnNqZ7jdW3NYSCwBMtDugap6'),
  beneficiary: P('2JEPvvG1kACwDJgacgEABnY3uiL7RLRncPW3APjNPNme'),
  distributionState: P('6rCSCQF9rGM9Ygq4khW6Ta6zphCa4zMK2bJXXFaCKmaf'),
  relayer: P('4yxsPGeoxbwoAwNUd1deGycGy7p3k4mVH4WSDLf9isvD'),
  admin: P('5e2qRc1DNEXmyxP8qwPwJhRWjef7usLyi7v5xjqLr5G7'),
  adminToken: P('T8ewYnoJbDygARjFZk13PGsjxQ7eqNcUWUPeiQQGHBQ'),
  attacker: P('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'),
  attackerToken: P('7DaumTmUaK3xcpd8XJXAjUzDrCqPuj3S1Sc2cbootBUN'),
  otherState: P('3wV5vZSzp8zmgwU8qEEQisKGoCGRxt2XJcXFwkryXQe6'),
  klend: P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'),
  klendMarket: P('ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5'),
  klendReserve: P('GA6bM6mampbrYcsnjkUHUjEMJ2kKQJW3LowZWBKY6gf3'),
  klendSupply: P('D9NFkCuNsj8VbnSPMpiYxnmkSjBC8sz8gFmkv3jf6n2'),
  klendFee: P('8J8QhEKXYbCK7t4tfYH38AfG6Y9mjsUE6cncPHt9GMLE'),
};
ids.klendAuthority = PublicKey.findProgramAddressSync(
  [Buffer.from('lma'), ids.klendMarket.toBuffer()], ids.klend)[0];

const successfulClaimSignature =
  '4PsZspiPdUWY5Lf2Himv6PWJMDCmahghaviXHWMYfmwCnLd5fLyU6vQ1h5SjXBmbfpnp9MWXqoWHMJe6JQ9TtDoH';
const watch = [
  ids.state, ids.vault, ids.beneficiaryToken, ids.attackerToken,
  ids.distributionState, ids.adminToken, ids.klendReserve, ids.klendSupply, ids.klendFee,
];

const cloneIx = (ix, keys = ix.keys, data = ix.data) => new TransactionInstruction({
  programId: ix.programId,
  keys: keys.map(key => ({...key})),
  data: Buffer.from(data),
});
const mutateKey = (ix, index, pubkey) => {
  const keys = ix.keys.map(key => ({...key}));
  keys[index].pubkey = pubkey;
  return cloneIx(ix, keys);
};
const mutateData = (ix, offset, bytes) => {
  const data = Buffer.from(ix.data);
  Buffer.from(bytes).copy(data, offset);
  return cloneIx(ix, ix.keys, data);
};
const flipData = (ix, offset) => {
  const data = Buffer.from(ix.data);
  data[offset] ^= 1;
  return cloneIx(ix, ix.keys, data);
};

function flashIx(kind, amount, authority, tokenAccount, borrowInstructionIndex = 0) {
  const isRepay = kind === 'repay';
  const data = Buffer.concat([
    Buffer.from(isRepay ? [185,117,0,203,96,245,180,186] : [135,231,52,167,7,52,212,193]),
    u64(amount),
    ...(isRepay ? [Buffer.from([borrowInstructionIndex])] : []),
  ]);
  const sentinel = ids.klend;
  return new TransactionInstruction({programId: ids.klend, keys: [
    {pubkey: authority, isSigner: true, isWritable: false},
    {pubkey: ids.klendAuthority, isSigner: false, isWritable: false},
    {pubkey: ids.klendMarket, isSigner: false, isWritable: false},
    {pubkey: ids.klendReserve, isSigner: false, isWritable: true},
    {pubkey: ids.mint, isSigner: false, isWritable: false},
    {pubkey: ids.klendSupply, isSigner: false, isWritable: true},
    {pubkey: tokenAccount, isSigner: false, isWritable: true},
    {pubkey: ids.klendFee, isSigner: false, isWritable: true},
    {pubkey: sentinel, isSigner: false, isWritable: true},
    {pubkey: sentinel, isSigner: false, isWritable: true},
    {pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false},
    {pubkey: ids.token, isSigner: false, isWritable: false},
  ], data});
}

function addRootIx(sender) {
  return new TransactionInstruction({programId: ids.magna, keys: [
    {pubkey: ids.state, isSigner: false, isWritable: true},
    {pubkey: sender, isSigner: true, isWritable: false},
  ], data: Buffer.concat([anchorDisc('add_root'), crypto.createHash('sha256')
    .update('magna-current-read-only-probe').digest()])});
}

function defundIx(sender, destination, amount) {
  return new TransactionInstruction({programId: ids.magna, keys: [
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    {pubkey: ids.token, isSigner: false, isWritable: false},
    {pubkey: ids.state, isSigner: false, isWritable: true},
    {pubkey: sender, isSigner: true, isWritable: false},
    {pubkey: destination, isSigner: false, isWritable: true},
    {pubkey: ids.vault, isSigner: false, isWritable: true},
  ], data: Buffer.concat([anchorDisc('defund'), u64(amount)])});
}

function accountImage(info) {
  if (!info) return {exists: false};
  const data = Buffer.isBuffer(info.data) ? info.data : Buffer.from(info.data[0], 'base64');
  const owner = typeof info.owner === 'string' ? info.owner : info.owner.toBase58();
  const out = {exists: true, owner, executable: !!info.executable,
    lamports: info.lamports, dataLength: data.length, sha256: sha256(data)};
  if (data.length <= 256) out.dataHex = data.toString('hex');
  if (owner === ids.token.toBase58() && data.length >= 72) {
    out.kind = 'spl-token';
    out.mint = new PublicKey(data.subarray(0, 32)).toBase58();
    out.tokenAuthority = new PublicKey(data.subarray(32, 64)).toBase58();
    out.rawAmount = data.readBigUInt64LE(64).toString();
  }
  return out;
}
const images = (keys, infos) => Object.fromEntries(keys.map((key, index) =>
  [key.toBase58(), accountImage(infos?.[index])]));

async function currentImages() {
  const result = await connection.getMultipleAccountsInfoAndContext(watch, 'confirmed');
  return {slot: result.context.slot, accounts: images(watch, result.value)};
}

function tokenDeltas(pre, post) {
  const out = {};
  for (const key of watch.map(x => x.toBase58())) {
    if (pre?.[key]?.rawAmount !== undefined && post?.[key]?.rawAmount !== undefined)
      out[key] = (BigInt(post[key].rawAmount) - BigInt(pre[key].rawAmount)).toString();
  }
  return out;
}

async function simulate(label, instructions, payer, blockhash) {
  const pre = await currentImages();
  const encoded = encodeV1(instructions, payer, blockhash, 1400000, 67108864);
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const transactionKeys = new Set(compiled.staticAccountKeys.map(key => key.toBase58()));
  const traced = watch.filter(key => transactionKeys.has(key.toBase58()));
  const request = {jsonrpc: '2.0', id: label, method: 'simulateTransaction', params: [
    encoded.wire.toString('base64'), {encoding: 'base64', sigVerify: false,
      replaceRecentBlockhash: true, commitment: 'confirmed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: traced.map(x => x.toBase58())}},
  ]};
  const response = await fetch(rpcUrl, {method: 'POST',
    headers: {'content-type': 'application/json'}, body: JSON.stringify(request)});
  const json = await response.json();
  const value = json.result?.value;
  const post = images(traced, value?.accounts);
  return {label, simulationSlot: json.result?.context?.slot, preSlot: pre.slot,
    transportError: json.error || null, err: value?.err || null,
    unitsConsumed: value?.unitsConsumed, loadedAccountsDataSize: value?.loadedAccountsDataSize,
    returnData: value?.returnData || null, innerInstructions: value?.innerInstructions || null,
    logs: value?.logs || null, message: {format: 'solana-v1', bytes: encoded.sizeBytes,
      sha256: sha256(encoded.wire), base64: encoded.wire.toString('base64'),
      v0EquivalentBytes: encoded.v0Bytes, addressCount: encoded.addressCount,
      instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      computeLimit: encoded.config.computeLimit, loadedAccountDataLimit: encoded.config.dataLimit},
    tracedAddresses: traced.map(x => x.toBase58()), pre: pre.accounts, post,
    tokenDeltas: tokenDeltas(pre.accounts, post)};
}

async function historicalClaimIx() {
  const transaction = await connection.getTransaction(successfulClaimSignature,
    {commitment: 'confirmed', maxSupportedTransactionVersion: 0});
  if (!transaction) throw new Error('Historical positive-control transaction unavailable');
  if (transaction.transaction.message.addressTableLookups.length)
    throw new Error('Historical positive control unexpectedly uses address tables');
  const message = transaction.transaction.message;
  const compiled = message.compiledInstructions.find(ix =>
    message.staticAccountKeys[ix.programIdIndex].equals(ids.magna));
  if (!compiled) throw new Error('Magna instruction absent from positive control');
  return {slot: transaction.slot, err: transaction.meta.err,
    instruction: new TransactionInstruction({programId: ids.magna,
      keys: [...compiled.accountKeyIndexes].map(index => ({
        pubkey: message.staticAccountKeys[index],
        isSigner: index < message.header.numRequiredSignatures,
        isWritable: message.isAccountWritable(index),
      })), data: Buffer.from(compiled.data)})};
}

async function main() {
  const historical = await historicalClaimIx();
  const claim = historical.instruction;
  if (claim.data.length !== 346 || !claim.programId.equals(ids.magna))
    throw new Error('Positive-control instruction identity changed');
  const decodedRequestAmount = claim.data.readBigUInt64LE(177);
  const liveReserve = await currentImages();
  const programAccount = await connection.getAccountInfoAndContext(ids.magna, 'confirmed');
  if (!programAccount.value || programAccount.value.data.readUInt32LE(0) !== 2)
    throw new Error('Magna is not a current upgradeable-loader Program account');
  const programDataAddress = new PublicKey(programAccount.value.data.subarray(4, 36));
  const programDataAccount = await connection.getAccountInfoAndContext(programDataAddress, 'confirmed');
  if (!programDataAccount.value || programDataAccount.value.data.readUInt32LE(0) !== 3)
    throw new Error('Magna ProgramData unavailable');
  const programData = programDataAccount.value.data;
  const upgradeAuthorityPresent = programData[12] === 1;
  const executableOffset = upgradeAuthorityPresent ? 45 : 13;
  const stateAccount = await connection.getAccountInfoAndContext(ids.state, 'confirmed');
  if (!stateAccount.value) throw new Error('Target state unavailable');
  const stateData = stateAccount.value.data;
  const stateIdLength = stateData.readUInt32LE(8);
  const stateId = stateData.subarray(12, 12 + stateIdLength).toString('utf8');
  const derivedVault = PublicKey.findProgramAddressSync([
    ids.state.toBuffer(), ids.token.toBuffer(), ids.mint.toBuffer()], ids.associatedToken)[0];
  const reserveInfo = await connection.getAccountInfoAndContext(ids.klendReserve, 'confirmed');
  if (!reserveInfo.value) throw new Error('KLend TRUMP reserve missing');
  const available = reserveInfo.value.data.readBigUInt64LE(224);
  const flashFeeSf = reserveInfo.value.data.readBigUInt64LE(4904);
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  const invalidProof = flipData(claim, 49);
  const invalidAllocationId = flipData(claim, 12);
  const zeroAmount = mutateData(claim, 177, u64(0n));
  const maxAmount = mutateData(claim, 177, u64(2n ** 64n - 1n));
  const alternateDestination = mutateKey(claim, 4, ids.attackerToken);
  const alternateDistributionState = mutateKey(claim, 6, ids.attackerToken);
  const alternateState = mutateKey(claim, 3, ids.otherState);
  const aliasedDestinationVault = mutateKey(claim, 4, ids.vault);

  const pair = (amount, authority = ids.beneficiary, tokenAccount = ids.beneficiaryToken,
    middle = [], borrowIndex = 0) => [flashIx('borrow', amount, authority, tokenAccount),
      ...middle, flashIx('repay', amount, authority, tokenAccount, borrowIndex)];
  const cases = [
    ['claim_positive_control', [claim], ids.relayer],
    ['claim_invalid_proof', [invalidProof], ids.relayer],
    ['claim_invalid_allocation_id', [invalidAllocationId], ids.relayer],
    ['claim_zero_amount', [zeroAmount], ids.relayer],
    ['claim_max_u64_amount', [maxAmount], ids.relayer],
    ['claim_alternate_destination', [alternateDestination], ids.relayer],
    ['claim_alternate_distribution_state', [alternateDistributionState], ids.relayer],
    ['claim_alternate_state', [alternateState], ids.relayer],
    ['claim_destination_aliases_vault', [aliasedDestinationVault], ids.relayer],
    ['claim_duplicate_same_message', [claim, claim], ids.relayer],
    ['claim_max_u64_then_small', [maxAmount, claim], ids.relayer],
    ['claim_10_repetitions_v1_limit', Array.from({length: 10}, () => claim), ids.relayer],
    ['claim_11_repetitions_over_v1_limit', Array.from({length: 11}, () => claim), ids.relayer],
    ['add_root_admin_control', [addRootIx(ids.admin)], ids.relayer],
    ['add_root_outsider', [addRootIx(ids.attacker)], ids.relayer],
    ['defund_admin_control_1_raw', [defundIx(ids.admin, ids.adminToken, 1n)], ids.relayer],
    ['defund_outsider_1_raw', [defundIx(ids.attacker, ids.attackerToken, 1n)], ids.relayer],
    ['defund_admin_alternate_destination', [defundIx(ids.admin, ids.attackerToken, 1n)], ids.relayer],
    ['klend_same_mint_1_raw_pair', pair(1n), ids.relayer],
    ['klend_same_mint_available_minus_1_pair', pair(available - 1n), ids.relayer],
    ['klend_same_mint_exact_available_pair', pair(available), ids.relayer],
    ['klend_same_mint_available_plus_1_pair', pair(available + 1n), ids.relayer],
    ['klend_same_mint_claim_between_1_raw', pair(1n, ids.beneficiary,
      ids.beneficiaryToken, [claim]), ids.relayer],
    ['claim_before_klend_same_mint_1_raw', [claim, ...pair(1n, ids.beneficiary,
      ids.beneficiaryToken, [], 1)], ids.relayer],
    ['claim_after_klend_same_mint_1_raw', [...pair(1n), claim], ids.relayer],
    ['klend_same_mint_mutated_destination_attack', pair(1n, ids.attacker,
      ids.attackerToken, [alternateDestination]), ids.relayer],
    ['klend_same_mint_duplicate_claim', pair(1n, ids.beneficiary,
      ids.beneficiaryToken, [claim, claim]), ids.relayer],
    ['klend_same_mint_repeated_pairs', [...pair(1n), ...pair(1n, ids.beneficiary,
      ids.beneficiaryToken, [], 2)], ids.relayer],
    ['klend_same_mint_wrong_repay_index', pair(1n, ids.beneficiary,
      ids.beneficiaryToken, [], 1), ids.relayer],
  ];

  const results = [];
  for (const [label, instructions, payer] of cases) {
    try {
      const result = await simulate(label, instructions, payer, blockhash);
      results.push(result);
      console.log(JSON.stringify({label, err: result.err,
        transportError: result.transportError, bytes: result.message.bytes,
        addresses: result.message.addressCount, instructions: result.message.instructionCount,
        units: result.unitsConsumed, deltas: result.tokenDeltas,
        lastLogs: result.logs?.slice(-5)}));
    } catch (error) {
      results.push({label, localError: error.stack});
      console.log(JSON.stringify({label, localError: error.message}));
    }
  }

  const [derivedState, derivedBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('merkle_instance'), ids.mint.toBuffer(),
      Buffer.from('accdf9def2bf4e8683f5123bceb2c6f1')], ids.magna);
  const output = {observedAt: new Date().toISOString(), readOnly: true,
    liveSubmission: false, signatureVerification: false,
    rpcMethod: 'simulateTransaction', commitment: 'confirmed',
    target: {program: ids.magna.toBase58(), state: ids.state.toBase58(),
      vault: ids.vault.toBase58(), mint: ids.mint.toBase58(),
      historicalPositiveControl: {signature: successfulClaimSignature,
        slot: historical.slot, historicalErr: historical.err,
        instructionDataLength: claim.data.length,
        instructionDataSha256: sha256(claim.data),
        requestedAmountRaw: decodedRequestAmount.toString()},
      derivedState: derivedState.toBase58(), derivedBump,
      derivationMatches: derivedState.equals(ids.state),
      adminOnCurve: PublicKey.isOnCurve(ids.admin.toBytes()),
      attackerOnCurve: PublicKey.isOnCurve(ids.attacker.toBytes()),
      executableIdentity: {programObservedSlot: programAccount.context.slot,
        programOwner: programAccount.value.owner.toBase58(),
        programExecutable: programAccount.value.executable,
        programAccountSha256: sha256(programAccount.value.data),
        programDataAddress: programDataAddress.toBase58(),
        programDataObservedSlot: programDataAccount.context.slot,
        lastDeploySlot: programData.readBigUInt64LE(4).toString(),
        upgradeAuthority: upgradeAuthorityPresent ?
          new PublicKey(programData.subarray(13, 45)).toBase58() : null,
        programDataLength: programData.length,
        executableDataOffset: executableOffset,
        executableLength: programData.length - executableOffset,
        executableSha256: sha256(programData.subarray(executableOffset))},
      stateIdentity: {observedSlot: stateAccount.context.slot,
        owner: stateAccount.value.owner.toBase58(), dataLength: stateData.length,
        dataSha256: sha256(stateData), id: stateId,
        storedVault: new PublicKey(stateData.subarray(44, 76)).toBase58(),
        bump: stateData[76], storedMint: new PublicKey(stateData.subarray(77, 109)).toBase58(),
        rootCount: stateData.readUInt32LE(109),
        adminCount: stateData.readUInt32LE(146),
        firstAdmin: new PublicKey(stateData.subarray(150, 182)).toBase58(),
        derivedVault: derivedVault.toBase58(), vaultMatches: derivedVault.equals(ids.vault)}},
    klendSameMint: {program: ids.klend.toBase58(), market: ids.klendMarket.toBase58(),
      authority: ids.klendAuthority.toBase58(), reserve: ids.klendReserve.toBase58(),
      supplyVault: ids.klendSupply.toBase58(), feeVault: ids.klendFee.toBase58(),
      availableRaw: available.toString(), flashFeeSf: flashFeeSf.toString(),
      feeClass: flashFeeSf === 0n ? 'exact-zero-rate' : 'positive-rate',
      reserveObservedSlot: reserveInfo.context.slot},
    watchedAddresses: watch.map(x => x.toBase58()),
    initialSnapshot: liveReserve, results};
  fs.writeFileSync('composer-runs/2026-10-15/magna-current-probe.json',
    JSON.stringify(output, null, 2) + '\n');
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
