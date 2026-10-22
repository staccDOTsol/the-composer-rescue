#!/usr/bin/env node
'use strict';

// Defensive harness: all writes and all transaction execution are confined to a
// disposable Surfpool fork. The upstream is read through Surfpool's public
// mainnet datasource. This script has no sendTransaction path.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const modules = path.resolve(__dirname, '..', 'kliquidity-sdk-official', 'node_modules');
const {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require(path.join(modules, '@solana', 'web3.js'));
const spl = require(path.join(modules, '@solana', 'spl-token'));

const LOCAL_RPC = process.env.USDU_LOCAL_RPC || 'http://127.0.0.1:9017';
const IDL = JSON.parse(fs.readFileSync(path.join(__dirname, 'unitas-idl-source', 'vault', 'vault.json'), 'utf8'));

const P = (value) => new PublicKey(value);
const IDS = {
  vaultProgram: P('VALT7AM76ZWfRhjVeYQRrLvNRLvqBzNs8dTsAcLW3jj'),
  guardianProgram: P('GRAD6oot2mhagh3UmoqCmLkiW3G2cFS5bh9x6VbYEZxW'),
  susduProgram: P('SUSD2TSk8DJodCkPviKb2okzbeQ597kCBjLVjq3G7pp'),
  vaultConfig: P('ENcCimzGPU6dNih1qnsSShTYBu9rRERnF4Wwx7BVVt7h'),
  vaultState: P('Fx6AsfJ5GGzUyYgNAaGehG1PSQTG1e7qNwSCJ8vXJ9SX'),
  vaultSusdu: P('7ngbTXfv6ey9N6AprMSjJ4X8ifZepWo7fXsrpsUhK3NS'),
  stakePool: P('CFgrWjb9DYKVqf7QyQfmwjboDDkXpFHQ6292rnYxrjsa'),
  silo: P('xyLZUzaaFdn9tuoBAM7qLNEh5HFkTyjXFoSqoC4WBwb'),
  accessRegistry: P('8maav1g7bK1vRamXzADLUu3DQ7VmXxjVTJt9PbBuWcpd'),
  susduMinter: P('6ZY9KMGD9UjTX4tWGcw4Y4UHh14nzNmiEr92wTieYub5'),
  susduRedeemer: P('7G68qMXkCh2uMq1NrTT6uX1fzphQoBPYpPBeLbN2B9SP'),
  usduMint: P('9ckR7pPPvyPadACDTzLwK2ZAEeUJ3qGSnzPs8bVaHrSy'),
  susduMint: P('9iq5Q33RSiz1WcupHAQKbHBZkpn92UxBG2HfPWAZhMCa'),
  susduConfig: P('DyiptL8AUJjxqphpkWAcVbFrA53EawpyaJ1VzDi8YoLc'),
  token2022: spl.TOKEN_2022_PROGRAM_ID,
  associatedToken: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
  system: SystemProgram.programId,
  victimSusduAta: P('2myre5bewT7fAFp7NBRRBcaEeKV6fGFhGcx61Aknyu1s'),
  victimActiveCooldown: P('FgeJ4vL828wDVa2StPsUer6twkhxYR8f7JxSFAR3Z4y1'),
  usduTemplate: P('Fa61JjHoZ23HCn372EgmvFPR9BL3BM6Cynw65wmDnxnk'),
  susduTemplate: P('2myre5bewT7fAFp7NBRRBcaEeKV6fGFhGcx61Aknyu1s'),
  kliquidityUsduVault: P('CKtY6cHsEriZTBrhwQ3fyoAm9kcQrMCV4mAGTqypo3mi'),
  kliquidityUsdcVault: P('Hi36hUaiq1rtrHoa26rJusCmR6PG6pzoJYRc4buKuRJW'),
};

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(LOCAL_RPC, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${method}: ${JSON.stringify(body.error || {status: response.status})}`);
  return body.result;
}

const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function pda(program, ...seeds) {
  return PublicKey.findProgramAddressSync(seeds.map((seed) => Buffer.isBuffer(seed) ? seed : seed.toBuffer()), program)[0];
}

function vaultInstruction(name, accounts, args = []) {
  const definition = IDL.instructions.find((entry) => entry.name === name);
  if (!definition) throw new Error(`Missing IDL instruction ${name}`);
  const keys = definition.accounts.map((account) => {
    const pubkey = accounts[account.name];
    if (!pubkey) throw new Error(`${name}: missing account ${account.name}`);
    return {pubkey, isSigner: !!account.signer, isWritable: !!account.writable};
  });
  return new TransactionInstruction({
    programId: IDS.vaultProgram,
    keys,
    data: Buffer.concat([Buffer.from(definition.discriminator), ...args]),
  });
}

function stakeAccounts(attacker, usduAta, susduAta) {
  return {
    caller: attacker,
    receiver: attacker,
    receiver_susdu_token_account: susduAta,
    caller_usdu_token_account: usduAta,
    access_registry: IDS.accessRegistry,
    vault_stake_pool_usdu_token_account: IDS.stakePool,
    susdu_minter: IDS.susduMinter,
    usdu_token: IDS.usduMint,
    susdu_token: IDS.susduMint,
    vault_state: IDS.vaultState,
    vault_config: IDS.vaultConfig,
    susdu_config: IDS.susduConfig,
    susdu_program: IDS.susduProgram,
    usdu_token_program: IDS.token2022,
    susdu_token_program: IDS.token2022,
    associated_token_program: IDS.associatedToken,
    system_program: IDS.system,
  };
}

function unstakeAccounts(attacker, susduAta, cooldown) {
  return {
    caller: attacker,
    caller_susdu_token_account: susduAta,
    susdu_config: IDS.susduConfig,
    vault_config: IDS.vaultConfig,
    vault_state: IDS.vaultState,
    vault_susdu_token_account: IDS.vaultSusdu,
    cooldown,
    access_registry: IDS.accessRegistry,
    susdu_redeemer: IDS.susduRedeemer,
    susdu_token: IDS.susduMint,
    usdu_token: IDS.usduMint,
    vault_stake_pool_usdu_token_account: IDS.stakePool,
    vault_silo_usdu_token_account: IDS.silo,
    susdu_program: IDS.susduProgram,
    usdu_token_program: IDS.token2022,
    susdu_token_program: IDS.token2022,
    associated_token_program: IDS.associatedToken,
    system_program: IDS.system,
  };
}

function withdrawAccounts(attacker, receiver, receiverUsduAta, cooldown) {
  return {
    caller: attacker,
    receiver,
    vault_config: IDS.vaultConfig,
    vault_state: IDS.vaultState,
    receiver_usdu_token_account: receiverUsduAta,
    vault_silo_usdu_token_account: IDS.silo,
    cooldown,
    usdu_token: IDS.usduMint,
    usdu_token_program: IDS.token2022,
    associated_token_program: IDS.associatedToken,
    system_program: IDS.system,
  };
}

function roleSeed(name) {
  const bytes = Buffer.alloc(32);
  bytes.write(name);
  return bytes;
}

function accountBytes(row) {
  return row?.data?.[0] ? Buffer.from(row.data[0], 'base64') : null;
}

function decodeCooldown(row) {
  const bytes = accountBytes(row);
  if (!bytes || bytes.length < 58 || !bytes.subarray(0, 8).equals(Buffer.from([50, 166, 94, 192, 234, 64, 152, 208]))) return null;
  return {
    cooldownEnd: bytes.readBigUInt64LE(8).toString(),
    underlyingTokenAmount: bytes.readBigUInt64LE(16).toString(),
    owner: new PublicKey(bytes.subarray(24, 56)).toBase58(),
    bump: bytes[56],
    isInitialized: !!bytes[57],
  };
}

function summarizeAccount(row) {
  if (!row) return null;
  const bytes = accountBytes(row);
  const token = [IDS.token2022.toBase58(), spl.TOKEN_PROGRAM_ID.toBase58()].includes(row.owner)
    && [165, 170].includes(bytes?.length);
  return {
    owner: row.owner,
    lamports: row.lamports,
    dataLength: bytes?.length || 0,
    dataSha256: bytes ? hash(bytes) : null,
    tokenMint: token ? new PublicKey(bytes.subarray(0, 32)).toBase58() : null,
    tokenAuthority: token ? new PublicKey(bytes.subarray(32, 64)).toBase58() : null,
    rawTokenAmount: token ? bytes.readBigUInt64LE(64).toString() : null,
    cooldown: decodeCooldown(row),
  };
}

function tokenAccountImage(template, authority, amount) {
  const bytes = accountBytes(template);
  if (!bytes || bytes.length < 165) throw new Error('Invalid token account template');
  const data = Buffer.from(bytes);
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data.writeUInt32LE(0, 72);
  data.fill(0, 76, 108);
  data[108] = 1;
  data.writeUInt32LE(0, 109);
  data.fill(0, 113, 129);
  data.writeUInt32LE(0, 129);
  data.fill(0, 133, 165);
  return {
    data: data.toString('hex'),
    executable: false,
    lamports: template.lamports,
    owner: template.owner,
    rentEpoch: 0,
  };
}

async function getAccounts(addresses) {
  return rpc('getMultipleAccounts', [addresses.map(String), {encoding: 'base64', commitment: 'processed'}]);
}

async function setAccount(address, image) {
  return rpc('surfnet_setAccount', [address.toBase58(), image]);
}

function logsOfInterest(logs) {
  return (logs || []).filter((line) => /Instruction:|AnchorError|Error Code|Error Message|failed|success/.test(line));
}

async function simulateCase(label, payer, signer, instructions, watched) {
  const before = await getAccounts(watched);
  const latest = await rpc('getLatestBlockhash', [{commitment: 'processed'}]);
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: latest.value.blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({units: 1_000_000}), ...instructions],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([signer]);
  const wire = Buffer.from(transaction.serialize());
  const response = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64',
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: 'processed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  return {
    label,
    execution: 'local Surfpool simulateTransaction only',
    forkSlot: response.context.slot,
    messageVersion: 0,
    wireBytes: wire.length,
    wireSha256: hash(wire),
    accountCount: message.staticAccountKeys.length,
    requiredSignatures: message.header.numRequiredSignatures,
    instructionCount: instructions.length + 1,
    signerOrder: message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map(String),
    err: response.value.err,
    unitsConsumed: response.value.unitsConsumed,
    watched: watched.map(String),
    before: before.value.map(summarizeAccount),
    after: (response.value.accounts || []).map(summarizeAccount),
    logs: response.value.logs || [],
    logsOfInterest: logsOfInterest(response.value.logs),
    innerInstructions: response.value.innerInstructions || [],
  };
}

function shortVecLength(value) {
  return value < 128 ? 1 : value < 16384 ? 2 : 3;
}

// Emit the current Solana v1 wire shape used by the audit harness: 64-account,
// 64-instruction, 4096-byte hard limits; no address lookup tables.
function encodeV1(instructions, payer, blockhash, computeLimit = 1_000_000, dataLimit = 67_108_864) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions}).compileToV0Message();
  if (compiled.addressTableLookups.length) throw new Error('v1 composition must not contain ALTs');
  const keys = compiled.staticAccountKeys;
  const items = compiled.compiledInstructions;
  if (keys.length > 64 || items.length > 64) throw new Error('v1 account/instruction limit');
  const v0EquivalentBytes = shortVecLength(compiled.header.numRequiredSignatures)
    + 64 * compiled.header.numRequiredSignatures
    + 1 + 3 + shortVecLength(keys.length) + 32 * keys.length + 32
    + shortVecLength(items.length)
    + items.reduce((sum, instruction) => sum + 1
      + shortVecLength(instruction.accountKeyIndexes.length) + instruction.accountKeyIndexes.length
      + shortVecLength(instruction.data.length) + instruction.data.length, 0)
    + shortVecLength(0);
  const config = Buffer.alloc(8);
  config.writeUInt32LE(computeLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const instructionHeads = items.map((instruction) => {
    const bytes = Buffer.alloc(4);
    bytes[0] = instruction.programIdIndex;
    bytes[1] = instruction.accountKeyIndexes.length;
    bytes.writeUInt16LE(instruction.data.length, 2);
    return bytes;
  });
  const instructionPayloads = items.map((instruction) => Buffer.concat([
    Buffer.from(instruction.accountKeyIndexes),
    Buffer.from(instruction.data),
  ]));
  const bs58 = require(path.join(modules, 'bs58'));
  const decode58 = bs58.default?.decode || bs58.decode;
  const unsigned = Buffer.concat([
    Buffer.from([0x81, compiled.header.numRequiredSignatures,
      compiled.header.numReadonlySignedAccounts, compiled.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]),
    Buffer.from(decode58(blockhash)),
    Buffer.from([items.length, keys.length]),
    ...keys.map((key) => key.toBuffer()),
    config,
    ...instructionHeads,
    ...instructionPayloads,
  ]);
  const wire = Buffer.concat([unsigned, Buffer.alloc(64 * compiled.header.numRequiredSignatures)]);
  if (wire.length > 4096) throw new Error(`v1 size limit: ${wire.length}`);
  return {
    compiled,
    wire,
    unsignedBytes: unsigned.length,
    v0EquivalentBytes,
    addressCount: keys.length,
    instructionCount: items.length,
    requiredSignatures: compiled.header.numRequiredSignatures,
    config: {computeLimit, dataLimit},
  };
}

function signV1(encoded, signers) {
  const signerOrder = encoded.compiled.staticAccountKeys
    .slice(0, encoded.requiredSignatures).map(String);
  const signerMap = new Map(signers.map((signer) => [signer.publicKey.toBase58(), signer]));
  const signed = Buffer.from(encoded.wire);
  for (let index = 0; index < signerOrder.length; index += 1) {
    const signer = signerMap.get(signerOrder[index]);
    if (!signer) throw new Error(`Uncontrolled v1 signer ${signerOrder[index]}`);
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        Buffer.from(signer.secretKey.subarray(0, 32)),
      ]),
      format: 'der',
      type: 'pkcs8',
    });
    crypto.sign(null, signed.subarray(0, encoded.unsignedBytes), privateKey)
      .copy(signed, encoded.unsignedBytes + index * 64);
  }
  return {signed, signerOrder};
}

async function simulateV1Case(label, payer, signers, instructions, watched) {
  const before = await getAccounts(watched);
  const latest = await rpc('getLatestBlockhash', [{commitment: 'processed'}]);
  const encoded = encodeV1(instructions, payer, latest.value.blockhash);
  const signed = signV1(encoded, signers);
  const response = await rpc('simulateTransaction', [signed.signed.toString('base64'), {
    encoding: 'base64',
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: 'processed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  return {
    label,
    execution: 'locally signed Solana v1 wire via Surfpool simulateTransaction only',
    forkSlot: response.context.slot,
    messageVersion: 1,
    wireBytes: signed.signed.length,
    v0EquivalentBytes: encoded.v0EquivalentBytes,
    wireSha256: hash(signed.signed),
    accountCount: encoded.addressCount,
    requiredSignatures: encoded.requiredSignatures,
    instructionCount: encoded.instructionCount,
    signerOrder: signed.signerOrder,
    computeConfig: encoded.config,
    err: response.value.err,
    unitsConsumed: response.value.unitsConsumed,
    watched: watched.map(String),
    before: before.value.map(summarizeAccount),
    after: (response.value.accounts || []).map(summarizeAccount),
    logs: response.value.logs || [],
    logsOfInterest: logsOfInterest(response.value.logs),
    innerInstructions: response.value.innerInstructions || [],
  };
}

async function censusExactMint() {
  const mint = IDS.usduMint.toBase58();
  const klend = await rpc('getProgramAccounts', ['KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', {
    encoding: 'base64',
    commitment: 'processed',
    withContext: true,
    filters: [{dataSize: 8624}, {memcmp: {offset: 128, bytes: mint}}],
  }]);
  const marginfi = await rpc('getProgramAccounts', ['MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', {
    encoding: 'base64',
    commitment: 'processed',
    withContext: true,
    filters: [
      {memcmp: {offset: 0, bytes: 'UhGBUFy9nKq'}},
      {memcmp: {offset: 8, bytes: mint}},
    ],
  }]);
  return {
    mint,
    klend: {slot: klend.context?.slot || null, matchingReserves: (klend.value || klend).map((row) => row.pubkey)},
    project0Marginfi: {slot: marginfi.context?.slot || null, matchingBanks: (marginfi.value || marginfi).map((row) => row.pubkey)},
  };
}

async function main() {
  const attacker = Keypair.generate();
  const attackerUsdu = spl.getAssociatedTokenAddressSync(IDS.usduMint, attacker.publicKey, false, IDS.token2022);
  const attackerSusdu = spl.getAssociatedTokenAddressSync(IDS.susduMint, attacker.publicKey, false, IDS.token2022);
  const attackerCooldown = pda(IDS.vaultProgram, Buffer.from('vault-cooldown'), IDS.usduMint, attacker.publicKey);
  const attackerVaultAdmin = pda(
    IDS.guardianProgram,
    Buffer.from('access-role'),
    IDS.accessRegistry,
    attacker.publicKey,
    roleSeed('vault_admin'),
  );

  // Prime the victim cooldown individually. Surfpool's lazy importer can return
  // a null entry for an unprimed address in a batched request.
  await rpc('getAccountInfo', [IDS.victimActiveCooldown.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
  const templateRows = await getAccounts([IDS.usduTemplate, IDS.susduTemplate]);
  if (!templateRows.value[0] || !templateRows.value[1]) throw new Error('Token templates unavailable from fork datasource');
  await setAccount(attacker.publicKey, {
    data: '', executable: false, lamports: 20_000_000_000, owner: IDS.system.toBase58(), rentEpoch: 0,
  });
  const syntheticInput = 1_000_000_000n;
  await setAccount(attackerUsdu, tokenAccountImage(templateRows.value[0], attacker.publicKey, syntheticInput));
  await setAccount(attackerSusdu, tokenAccountImage(templateRows.value[1], attacker.publicKey, 0n));

  const watched = [
    attackerUsdu,
    attackerSusdu,
    IDS.stakePool,
    IDS.silo,
    attackerCooldown,
    IDS.vaultConfig,
    IDS.susduConfig,
    IDS.susduMint,
  ];
  const stake = vaultInstruction('stake_usdu_mint_susdu', stakeAccounts(attacker.publicKey, attackerUsdu, attackerSusdu), [u64(syntheticInput)]);
  const stakeOnly = await simulateCase('legitimate_stake_positive_control', attacker.publicKey, attacker, [stake], watched);
  if (stakeOnly.err) throw new Error(`Stake positive control failed: ${JSON.stringify(stakeOnly.err)}`);
  const preSusdu = BigInt(stakeOnly.before[1].rawTokenAmount);
  const postSusdu = BigInt(stakeOnly.after[1].rawTokenAmount);
  const mintedShares = postSusdu - preSusdu;
  if (mintedShares <= 1_000_000n) throw new Error(`Unexpectedly small minted share amount: ${mintedShares}`);
  const unstakeShares = mintedShares - 1_000_000n;
  const unstake = vaultInstruction('unstake_susdu', unstakeAccounts(attacker.publicKey, attackerSusdu, attackerCooldown), [u64(unstakeShares)]);
  const withdraw = vaultInstruction('withdraw_usdu', withdrawAccounts(attacker.publicKey, attacker.publicKey, attackerUsdu, attackerCooldown));

  const stakeUnstake = await simulateCase(
    'stake_then_unstake_creates_seven_day_cooldown',
    attacker.publicKey,
    attacker,
    [stake, unstake],
    watched,
  );
  const atomicExit = await simulateCase(
    'one_atomic_stake_unstake_withdraw',
    attacker.publicKey,
    attacker,
    [stake, unstake, withdraw],
    watched,
  );
  const atomicExitV1 = await simulateV1Case(
    'one_atomic_v1_stake_unstake_withdraw',
    attacker.publicKey,
    [attacker],
    [stake, unstake, withdraw],
    watched,
  );

  const emergency = vaultInstruction('emergency_withdraw_vault_stake_pool_usdu', {
    authority: attacker.publicKey,
    receiver: attacker.publicKey,
    vault_config: IDS.vaultConfig,
    vault_state: IDS.vaultState,
    vault_stake_pool_usdu_token_account: IDS.stakePool,
    receiver_usdu_token_account: attackerUsdu,
    access_registry: IDS.accessRegistry,
    vault_admin: attackerVaultAdmin,
    usdu_token: IDS.usduMint,
    usdu_token_program: IDS.token2022,
    associated_token_program: IDS.associatedToken,
    system_program: IDS.system,
  }, [u64(1n)]);
  const outsiderEmergency = await simulateCase(
    'outsider_emergency_stake_pool_withdraw',
    attacker.publicKey,
    attacker,
    [emergency],
    [attackerUsdu, IDS.stakePool, IDS.vaultConfig, attackerVaultAdmin],
  );

  const victimShareTheft = vaultInstruction('unstake_susdu', unstakeAccounts(
    attacker.publicKey,
    IDS.victimSusduAta,
    attackerCooldown,
  ), [u64(1n)]);
  const outsiderVictimUnstake = await simulateCase(
    'outsider_tries_to_unstake_victim_susdu',
    attacker.publicKey,
    attacker,
    [victimShareTheft],
    [IDS.victimSusduAta, IDS.stakePool, IDS.silo, attackerCooldown],
  );

  const victimCooldownTheft = vaultInstruction('withdraw_usdu', withdrawAccounts(
    attacker.publicKey,
    attacker.publicKey,
    attackerUsdu,
    IDS.victimActiveCooldown,
  ));
  const outsiderVictimWithdraw = await simulateCase(
    'outsider_tries_to_withdraw_victim_cooldown',
    attacker.publicKey,
    attacker,
    [victimCooldownTheft],
    [attackerUsdu, IDS.silo, IDS.victimActiveCooldown],
  );

  const directTokenTheft = spl.createTransferCheckedInstruction(
    IDS.stakePool,
    IDS.usduMint,
    attackerUsdu,
    attacker.publicKey,
    1n,
    6,
    [],
    IDS.token2022,
  );
  const outsiderDirectTransfer = await simulateCase(
    'outsider_direct_token2022_transfer',
    attacker.publicKey,
    attacker,
    [directTokenTheft],
    [attackerUsdu, IDS.stakePool],
  );

  const [flashCensus, swapVaults, forkSlot] = await Promise.all([
    censusExactMint(),
    getAccounts([IDS.kliquidityUsduVault, IDS.kliquidityUsdcVault]),
    rpc('getSlot', [{commitment: 'processed'}]),
  ]);

  const output = {
    generatedAt: new Date().toISOString(),
    safety: {
      defensive: true,
      upstreamMode: 'public mainnet read through local Surfpool fork',
      localForkRpc: LOCAL_RPC,
      liveTransactionsSubmitted: 0,
      sendTransactionCalls: 0,
      localForkWritesOnly: true,
      simulationsOnly: true,
    },
    forkSlot,
    programs: Object.fromEntries(Object.entries(IDS)
      .filter(([, value]) => value instanceof PublicKey)
      .map(([name, value]) => [name, value.toBase58()])),
    attacker: {
      address: attacker.publicKey.toBase58(),
      generatedEphemerally: true,
      syntheticLocalOnlyUsduRaw: syntheticInput.toString(),
      usduAta: attackerUsdu.toBase58(),
      susduAta: attackerSusdu.toBase58(),
      cooldown: attackerCooldown.toBase58(),
      nonexistentVaultAdminRolePda: attackerVaultAdmin.toBase58(),
    },
    composition: {
      inputUsduRaw: syntheticInput.toString(),
      stakePositiveControlMintedSusduRaw: mintedShares.toString(),
      composedUnstakeSusduRaw: unstakeShares.toString(),
      rationale: 'The local-only synthetic balance isolates current program accounting. One million raw shares are retained to tolerate sub-second vesting/rounding changes between independent simulations.',
    },
    exactMintFlashCensus: flashCensus,
    indirectSwapInventory: {
      pool: '94BpFoyri4uTT55NFSHKYNFyUMtoWXEisMA4LK7nTKPU',
      pair: [IDS.usduMint.toBase58(), 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
      usduVault: {address: IDS.kliquidityUsduVault.toBase58(), ...summarizeAccount(swapVaults.value[0])},
      usdcVault: {address: IDS.kliquidityUsdcVault.toBase58(), ...summarizeAccount(swapVaults.value[1])},
    },
    cases: [
      stakeOnly,
      stakeUnstake,
      atomicExit,
      atomicExitV1,
      outsiderEmergency,
      outsiderVictimUnstake,
      outsiderVictimWithdraw,
      outsiderDirectTransfer,
    ],
  };
  fs.writeFileSync(path.join(__dirname, 'local-fork-outsider-probes.json'), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: path.join(__dirname, 'local-fork-outsider-probes.json'),
    forkSlot,
    attacker: output.attacker,
    composition: output.composition,
    flashCensus,
    indirectSwapInventory: output.indirectSwapInventory,
    cases: output.cases.map((row) => ({
      label: row.label,
      err: row.err,
      wireBytes: row.wireBytes,
      accountCount: row.accountCount,
      unitsConsumed: row.unitsConsumed,
      logsOfInterest: row.logsOfInterest,
      deltas: row.watched.map((address, index) => ({
        address,
        preRaw: row.before[index]?.rawTokenAmount || null,
        postRaw: row.after[index]?.rawTokenAmount || null,
        cooldown: row.after[index]?.cooldown || null,
      })),
    })),
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
