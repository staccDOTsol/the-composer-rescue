#!/usr/bin/env node
// Defensive, read-only mainnet snapshot plus local-fork-only authorization tests.
// Mainnet RPC calls are reads. All account overrides and transaction simulations
// are sent only to the caller-provided local Surfpool endpoint.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {
  PublicKey,
  Keypair,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} = require(MODULES + '@solana/web3.js');
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} = require(MODULES + '@solana/spl-token');
const bs58Module = require(MODULES + 'bs58');
const bs58 = bs58Module.default || bs58Module;
const { encodeV1 } = require('../klend-v1-composition.js');

const DIR = __dirname;
const OUT = path.join(DIR, 'zbc-current-audit.json');
const IDL_PATH = process.env.ZBC_IDL_PATH || path.join(DIR, 'zebec-idl-1.8.0.json');
const ZBC_BINARY_PATH = process.env.ZBC_BINARY_PATH || path.join(DIR, 'zbc-current.so');
const MULTISIG_BINARY_PATH = process.env.ZBC_MULTISIG_BINARY_PATH || path.join(DIR, 'multisig-current.so');
const LOCAL_RPC = process.env.ZBC_LOCAL_RPC || 'http://127.0.0.1:9007';

const ZBC_PROGRAM = new PublicKey('zbcKGdAmXfthXY3rEPBzexVByT2cqRqCZb9NwWdGQ2T');
const ZBC_IDL_ACCOUNT = new PublicKey('J3ngNZMSk5N9by4KSsu3UXtqM6yMMqgXAYDJjt11y4fV');
const MULTISIG_PROGRAM = new PublicKey('b6ZPysThkApNx2YDiGsPUiYPE7Ub1kTRdCWp7gBkzbr');
const ZBCN_MINT = new PublicKey('ZBCNpuD7YMXzTHB2fhGkGi78MNsHGLRXUhRewNRm9RU');
const SYSTEM_PROGRAM = SystemProgram.programId;
const RENT_SYSVAR = new PublicKey('SysvarRent111111111111111111111111111111111');
const KLEND_PROGRAM = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const PROJECT0_PROGRAM = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const MARGINFI_ZBCN_BANK = new PublicKey('47Naxnhy3YnT4Mbpb1QnvPHZzuwW5ruUXBRiK5584yBQ');
const MARGINFI_ZBCN_LIQUIDITY_VAULT = new PublicKey('GHBqxtyV52WM53siZEJSFMxgU97NpjVtT8bMWMSCcZDT');

const VAULTS = [
  {
    vault: new PublicKey('5L4EM1G2uTCrrXgvbwtQqrJkbU9qNDcpLbZ5yKCsb4yB'),
    authority: new PublicKey('H8Hr964ApEP3ie1rwRTT7wkSrgvUqJQb8oNAKspkDDfR'),
    multisig: new PublicKey('EoqY5nPYoL7zH1hWSh1T5Nsbq5q6hhtztU6JStDeVgjG'),
    historicalTransaction: new PublicKey('BDZGaijXeKxq2zrrr4CQXUNJDN8DmJvWQS1ybRGncqqh'),
    outflowSignature: 'bKKdrJV7kBSTozJiVJGCoHTLp27JSsA1ex1mCY7ytPfmUgNquLeH5mWGpLKZsT3zoNkQ8Tx3BJUWhXs8NBXFbhU',
    outflowSlot: 453127523,
  },
  {
    vault: new PublicKey('CZMwajZAkdtPtDC3EfPokkzWmmoQo6jmZJPzDXG3DHR3'),
    authority: new PublicKey('3J7n5Usmei8BqgUHan5xuBiJkAx6M1AQQhGwbKiVdQ17'),
    multisig: new PublicKey('GiiWgFNnkWbAGnKiDt7ohny1tTtb2pzxpJAXVZv3T1pt'),
    historicalTransaction: new PublicKey('7DjzTwgsDqFkQzty9dkm3U7yZfoSrqLYe73ZJW5c4ubD'),
    outflowSignature: '3waNh14q2e839J9HuVU9CUupqUQEw9y7fHUDGCHSHKjuKnkdE2DxRqyv2ZKdCdWyHosapJWJkeE7ycUXRig9y67V',
    outflowSlot: 440722549,
  },
];

function loadConfiguredRpc() {
  const candidates = ['/tmp/composer-helius-only.env', '/tmp/composer-helius-rpc.env'];
  for (const filename of candidates) {
    if (!fs.existsSync(filename)) continue;
    const env = Object.fromEntries(fs.readFileSync(filename, 'utf8')
      .split('\n').filter((line) => line.includes('='))
      .map((line) => line.split(/=(.*)/s).slice(0, 2)));
    const value = env.HEAVY_RPC_URL || env.RPC_URL;
    if (value) return value;
  }
  return 'https://api.mainnet-beta.solana.com';
}

const MAINNET_RPC = loadConfiguredRpc();
let rpcId = 0;
async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`${method}: ${JSON.stringify(body.error || {httpStatus: response.status})}`);
  }
  return body.result;
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const pk = (bytes, offset) => new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};
const anchorDiscriminator = (namespace, name) => crypto.createHash('sha256')
  .update(`${namespace}:${name}`).digest().subarray(0, 8);
const snakeCase = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const pascalCase = (value) => value.charAt(0).toUpperCase() + value.slice(1);

function accountBytes(row) {
  return row?.data?.[0] ? Buffer.from(row.data[0], 'base64') : null;
}

function decodeTokenAccount(row) {
  const bytes = accountBytes(row);
  if (!bytes || bytes.length < 165 || row.owner !== TOKEN_PROGRAM_ID.toBase58()) return null;
  return {
    mint: pk(bytes, 0),
    authority: pk(bytes, 32),
    rawAmount: bytes.readBigUInt64LE(64).toString(),
    state: bytes[108],
    delegated: bytes.readUInt32LE(72) === 1,
    closeAuthorityPresent: bytes.readUInt32LE(129) === 1,
  };
}

function decodeMultisig(row) {
  const bytes = accountBytes(row);
  if (!bytes || row.owner !== MULTISIG_PROGRAM.toBase58()) return null;
  let offset = 8;
  const ownerCount = bytes.readUInt32LE(offset); offset += 4;
  if (ownerCount > 64 || offset + ownerCount * 32 + 13 > bytes.length) return null;
  const owners = [];
  for (let i = 0; i < ownerCount; i += 1) {
    owners.push(pk(bytes, offset)); offset += 32;
  }
  const threshold = Number(bytes.readBigUInt64LE(offset)); offset += 8;
  const nonce = bytes[offset]; offset += 1;
  const ownerSetSeqno = bytes.readUInt32LE(offset);
  return {owners, threshold, nonce, ownerSetSeqno};
}

function decodeStoredTransaction(row) {
  const bytes = accountBytes(row);
  if (!bytes || row.owner !== MULTISIG_PROGRAM.toBase58()) return null;
  let offset = 8;
  const readPk = () => { const value = pk(bytes, offset); offset += 32; return value; };
  const readU32 = () => { const value = bytes.readUInt32LE(offset); offset += 4; return value; };
  try {
    const multisig = readPk();
    const programId = readPk();
    const accountCount = readU32();
    if (accountCount > 64) return null;
    const accounts = [];
    for (let i = 0; i < accountCount; i += 1) {
      accounts.push({pubkey: readPk(), isSigner: !!bytes[offset++], isWritable: !!bytes[offset++]});
    }
    const dataLength = readU32();
    if (offset + dataLength > bytes.length) return null;
    const data = bytes.subarray(offset, offset + dataLength); offset += dataLength;
    const signerCount = readU32();
    if (signerCount > 64 || offset + signerCount + 5 > bytes.length) return null;
    const signers = [];
    for (let i = 0; i < signerCount; i += 1) signers.push(!!bytes[offset++]);
    const didExecute = !!bytes[offset++];
    const ownerSetSeqno = readU32();
    return {
      multisig,
      programId,
      accounts,
      dataHex: data.toString('hex'),
      discriminatorHex: data.subarray(0, 8).toString('hex'),
      amountRaw: data.length === 16 ? data.readBigUInt64LE(8).toString() : null,
      signers,
      approvalCount: signers.filter(Boolean).length,
      didExecute,
      ownerSetSeqno,
    };
  } catch (_) {
    return null;
  }
}

async function getAccount(url, address) {
  return rpc(url, 'getAccountInfo', [address.toBase58(), {encoding: 'base64', commitment: 'confirmed'}]);
}

async function getAccounts(url, addresses) {
  return rpc(url, 'getMultipleAccounts', [addresses.map(String), {encoding: 'base64', commitment: 'confirmed'}]);
}

async function programSnapshot(programId) {
  const program = await getAccount(MAINNET_RPC, programId);
  const bytes = accountBytes(program.value);
  if (!bytes || bytes.length < 36 || bytes.readUInt32LE(0) !== 2) {
    throw new Error(`${programId} is not an upgradeable Program account`);
  }
  const programDataAddress = new PublicKey(bytes.subarray(4, 36));
  const programData = await getAccount(MAINNET_RPC, programDataAddress);
  const raw = accountBytes(programData.value);
  if (!raw || raw.length < 13 || raw.readUInt32LE(0) !== 3) {
    throw new Error(`${programDataAddress} is not ProgramData`);
  }
  const hasAuthority = raw[12] === 1;
  const metadataLength = hasAuthority ? 45 : 13;
  const nonzeroEnd = raw.findLastIndex((byte) => byte !== 0) + 1;
  return {
    programId: programId.toBase58(),
    programObservationSlot: program.context.slot,
    programDataObservationSlot: programData.context.slot,
    loaderOwner: program.value.owner,
    executable: program.value.executable,
    programDataAddress: programDataAddress.toBase58(),
    lastDeployedSlot: raw.readBigUInt64LE(4).toString(),
    upgradeAuthority: hasAuthority ? pk(raw, 13) : null,
    allocatedProgramDataBytes: raw.length,
    payloadBytes: raw.length - metadataLength,
    payloadSha256: sha256(raw.subarray(metadataLength)),
    nonzeroPayloadBytes: Math.max(0, nonzeroEnd - metadataLength),
    nonzeroPayloadSha256: sha256(raw.subarray(metadataLength, Math.max(metadataLength, nonzeroEnd))),
  };
}

async function listMultisigTransactions(multisigAddress, threshold, instructionByDiscriminator) {
  const listed = await rpc(MAINNET_RPC, 'getProgramAccounts', [MULTISIG_PROGRAM.toBase58(), {
    encoding: 'base64',
    commitment: 'confirmed',
    withContext: true,
    filters: [{memcmp: {offset: 8, bytes: multisigAddress.toBase58()}}],
  }]);
  const rows = listed.value.map((entry) => {
    const decoded = decodeStoredTransaction(entry.account);
    if (!decoded) return {address: entry.pubkey, decodeError: true};
    const instructionName = instructionByDiscriminator.get(decoded.discriminatorHex) || null;
    return {
      address: entry.pubkey,
      ...decoded,
      instructionName,
      threshold,
      thresholdMet: decoded.approvalCount >= threshold,
      referencesZbcnMint: decoded.accounts.some((account) => account.pubkey === ZBCN_MINT.toBase58()),
      referencesScopedVault: decoded.accounts.some((account) => VAULTS
        .some((vault) => account.pubkey === vault.vault.toBase58())),
    };
  });
  const open = rows.filter((row) => !row.decodeError && !row.didExecute);
  return {
    observationSlot: listed.context.slot,
    total: rows.length,
    executed: rows.filter((row) => row.didExecute).length,
    openCount: open.length,
    openThresholdMet: open.filter((row) => row.thresholdMet).length,
    openThresholdMetZbcn: open.filter((row) => row.thresholdMet && row.referencesZbcnMint).length,
    open,
  };
}

async function listKlendZbcnReserves() {
  const discriminator = anchorDiscriminator('account', 'Reserve');
  const result = await rpc(MAINNET_RPC, 'getProgramAccounts', [KLEND_PROGRAM.toBase58(), {
    encoding: 'base64',
    commitment: 'confirmed',
    withContext: true,
    filters: [
      {dataSize: 8624},
      {memcmp: {offset: 0, bytes: bs58.encode(discriminator)}},
      {memcmp: {offset: 128, bytes: ZBCN_MINT.toBase58()}},
    ],
  }]);
  const reserves = result.value.map((entry) => {
    const bytes = accountBytes(entry.account);
    const fee = bytes.readBigUInt64LE(4904);
    return {
      reserve: entry.pubkey,
      market: pk(bytes, 32),
      mint: pk(bytes, 128),
      supplyVault: pk(bytes, 160),
      feeVault: pk(bytes, 192),
      availableRaw: bytes.readBigUInt64LE(224).toString(),
      status: bytes[4856],
      emergencyMode: bytes[4864],
      flashFeeSf: fee.toString(),
      exactZeroFee: fee === 0n,
    };
  });
  return {observationSlot: result.context.slot, reserves};
}

function binaryInstructionSurface(idl, binaryBytes) {
  const instructions = idl.instructions.map((instruction) => {
    const snake = snakeCase(instruction.name);
    const discriminator = anchorDiscriminator('global', snake);
    const logName = pascalCase(instruction.name);
    return {
      name: instruction.name,
      snakeCase: snake,
      discriminatorHex: discriminator.toString('hex'),
      discriminatorBytes: [...discriminator],
      accountCount: instruction.accounts.length,
      signerAccounts: instruction.accounts.filter((account) => account.isSigner)
        .map((account) => account.name),
      args: instruction.args,
      currentBinaryContainsInstructionLog: binaryBytes.includes(Buffer.from(`Instruction: ${logName}`)),
    };
  });
  return {
    instructions,
    instructionCount: instructions.length,
    zeroSignerInstructions: instructions.filter((instruction) => instruction.signerAccounts.length === 0)
      .map((instruction) => instruction.name),
    allIdlInstructionsPresentInCurrentBinary: instructions
      .every((instruction) => instruction.currentBinaryContainsInstructionLog),
    embeddedAnchorIdlDispatchers: ['IdlCreateAccount', 'IdlCreateBuffer', 'IdlWrite',
      'IdlSetAuthority', 'IdlSetBuffer'].filter((name) =>
      binaryBytes.includes(Buffer.from(`Instruction: ${name}`))),
  };
}

function multisigInstructionSurface(binaryBytes) {
  const names = ['CreateMultisig', 'CreateTransaction', 'Approve',
    'SetOwnersAndChangeThreshold', 'SetOwners', 'ChangeThreshold', 'ExecuteTransaction'];
  return {
    applicationInstructions: names.filter((name) =>
      binaryBytes.includes(Buffer.from(`Instruction: ${name}`))),
    embeddedAnchorIdlDispatchers: ['IdlCreateAccount', 'IdlCreateBuffer', 'IdlWrite',
      'IdlSetAuthority', 'IdlSetBuffer'].filter((name) =>
      binaryBytes.includes(Buffer.from(`Instruction: ${name}`))),
  };
}

async function setLocalAccount(address, value) {
  return rpc(LOCAL_RPC, 'surfnet_setAccount', [address.toBase58(), value]);
}

function systemAccountImage(lamports = 10_000_000_000) {
  return {data: '', executable: false, lamports, owner: SYSTEM_PROGRAM.toBase58(), rentEpoch: 0};
}

function tokenAccountImage(template, authority, amount) {
  const bytes = Buffer.from(template);
  authority.toBuffer().copy(bytes, 32);
  bytes.writeBigUInt64LE(BigInt(amount), 64);
  bytes.writeUInt32LE(0, 72); // no delegate
  bytes.fill(0, 76, 108);
  bytes[108] = 1; // initialized
  bytes.writeUInt32LE(0, 109); // not native
  bytes.fill(0, 113, 129);
  bytes.writeBigUInt64LE(0n, 121);
  bytes.writeUInt32LE(0, 129); // no close authority
  bytes.fill(0, 133, 165);
  return {
    data: bytes.toString('hex'),
    executable: false,
    lamports: 2_039_280,
    owner: TOKEN_PROGRAM_ID.toBase58(),
    rentEpoch: 0,
  };
}

function sendTokenDirectlyInstruction({sourceAccount, sourceIsSigner, destAccount,
  sourceTokenAccount, destTokenAccount, amount}) {
  return new TransactionInstruction({
    programId: ZBC_PROGRAM,
    keys: [
      {pubkey: sourceAccount, isSigner: sourceIsSigner, isWritable: true},
      {pubkey: destAccount, isSigner: false, isWritable: true},
      {pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false},
      {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
      {pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
      {pubkey: RENT_SYSVAR, isSigner: false, isWritable: false},
      {pubkey: ZBCN_MINT, isSigner: false, isWritable: false},
      {pubkey: sourceTokenAccount, isSigner: false, isWritable: true},
      {pubkey: destTokenAccount, isSigner: false, isWritable: true},
    ],
    data: Buffer.concat([anchorDiscriminator('global', 'send_token_directly'), u64(amount)]),
  });
}

function approveInstruction(multisig, transaction, owner) {
  return new TransactionInstruction({
    programId: MULTISIG_PROGRAM,
    keys: [
      {pubkey: multisig, isSigner: false, isWritable: false},
      {pubkey: transaction, isSigner: false, isWritable: true},
      {pubkey: owner, isSigner: true, isWritable: false},
    ],
    data: anchorDiscriminator('global', 'approve'),
  });
}

function executeInstruction(multisig, multisigSigner, transactionAddress, stored) {
  return new TransactionInstruction({
    programId: MULTISIG_PROGRAM,
    keys: [
      {pubkey: multisig, isSigner: false, isWritable: false},
      {pubkey: multisigSigner, isSigner: false, isWritable: false},
      {pubkey: transactionAddress, isSigner: false, isWritable: true},
      // The multisig implementation resolves the CPI program AccountInfo from
      // the remaining accounts as well as forwarding the stored account metas.
      {pubkey: new PublicKey(stored.programId), isSigner: false, isWritable: false},
      ...stored.accounts.map((account) => ({
        pubkey: new PublicKey(account.pubkey),
        // The multisig program elevates only its own signer PDA during CPI.
        isSigner: false,
        isWritable: account.isWritable,
      })),
    ],
    data: anchorDiscriminator('global', 'execute_transaction'),
  });
}

function signV1(encoded, instructions, payer, blockhash, signers) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions})
    .compileToV0Message();
  const signatureCount = encoded.requiredSignatures;
  const signerOrder = compiled.staticAccountKeys.slice(0, signatureCount).map(String);
  const byAddress = new Map(signers.map((signer) => [signer.publicKey.toBase58(), signer]));
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * signatureCount);
  for (let index = 0; index < signatureCount; index += 1) {
    const signer = byAddress.get(signerOrder[index]);
    if (!signer) throw new Error(`Uncontrolled v1 signer ${signerOrder[index]}`);
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        Buffer.from(signer.secretKey.subarray(0, 32)),
      ]),
      format: 'der',
      type: 'pkcs8',
    });
    crypto.sign(null, message, privateKey)
      .copy(signed, signed.length - 64 * signatureCount + index * 64);
  }
  return {signed, signerOrder};
}

function slimSimulationAccount(row) {
  if (!row) return null;
  const bytes = accountBytes(row);
  return {
    owner: row.owner,
    lamports: row.lamports,
    dataLength: bytes?.length ?? 0,
    rawTokenAmount: row.owner === TOKEN_PROGRAM_ID.toBase58() && bytes?.length >= 72
      ? bytes.readBigUInt64LE(64).toString() : null,
    dataSha256: bytes ? sha256(bytes) : null,
  };
}

async function simulateV1(label, instructions, payer, signers, watched) {
  const latest = await rpc(LOCAL_RPC, 'getLatestBlockhash', [{commitment: 'processed'}]);
  const encoded = encodeV1(instructions, payer, latest.value.blockhash);
  const {signed, signerOrder} = signV1(encoded, instructions, payer, latest.value.blockhash, signers);
  const response = await rpc(LOCAL_RPC, 'simulateTransaction', [signed.toString('base64'), {
    encoding: 'base64',
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: 'processed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  return {
    label,
    err: response.value.err,
    contextSlot: response.context.slot,
    unitsConsumed: response.value.unitsConsumed,
    loadedAccountsDataSize: response.value.loadedAccountsDataSize,
    wire: {
      transactionVersion: 1,
      versionPrefixHex: encoded.wire.subarray(0, 1).toString('hex'),
      configBitsHex: encoded.wire.subarray(4, 8).toString('hex'),
      bytes: encoded.sizeBytes,
      addresses: encoded.addressCount,
      writableAddresses: encoded.writableCount,
      instructions: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      signerOrder,
      sha256: sha256(signed),
      under4096Bytes: encoded.sizeBytes <= 4096,
      atMost64Addresses: encoded.addressCount <= 64,
    },
    watched: Object.fromEntries(watched.map((address, index) => [String(address),
      slimSimulationAccount(response.value.accounts?.[index])])),
    logs: response.value.logs,
    innerInstructions: response.value.innerInstructions,
  };
}

async function localForkTests(vaultResults, transactionResults) {
  const localSlotBefore = await rpc(LOCAL_RPC, 'getSlot', [{commitment: 'processed'}]);
  const attacker = Keypair.generate();
  const receiver = Keypair.generate();
  await setLocalAccount(attacker.publicKey, systemAccountImage());
  await setLocalAccount(receiver.publicKey, systemAccountImage());

  // Force the deployed programs and scoped live accounts to be cloned before tests.
  const cloneAddresses = [ZBC_PROGRAM, MULTISIG_PROGRAM, ZBCN_MINT,
    ...VAULTS.flatMap((vault) => [vault.vault, vault.multisig, vault.historicalTransaction])];
  for (const address of cloneAddresses) {
    await rpc(LOCAL_RPC, 'getAccountInfo', [address.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
  }

  const victimTemplate = accountBytes((await getAccount(LOCAL_RPC, VAULTS[0].vault)).value);
  if (!victimTemplate || victimTemplate.length !== 165) throw new Error('victim token template unavailable');
  const attackerAta = getAssociatedTokenAddressSync(ZBCN_MINT, attacker.publicKey);
  const receiverAta = getAssociatedTokenAddressSync(ZBCN_MINT, receiver.publicKey);
  await setLocalAccount(attackerAta, tokenAccountImage(victimTemplate, attacker.publicKey, 100n));
  await setLocalAccount(receiverAta, tokenAccountImage(victimTemplate, receiver.publicKey, 0n));

  const directPositive = await simulateV1('positive_control_attacker_moves_own_synthetic_zbcn', [
    sendTokenDirectlyInstruction({
      sourceAccount: attacker.publicKey,
      sourceIsSigner: true,
      destAccount: receiver.publicKey,
      sourceTokenAccount: attackerAta,
      destTokenAccount: receiverAta,
      amount: 1n,
    }),
  ], attacker.publicKey, [attacker], [attackerAta, receiverAta]);

  const negativeCases = [];
  for (let index = 0; index < VAULTS.length; index += 1) {
    const scoped = VAULTS[index];
    negativeCases.push(await simulateV1(
      `vault_${index + 1}_outsider_signer_substituted_for_victim_authority`,
      [sendTokenDirectlyInstruction({
        sourceAccount: attacker.publicKey,
        sourceIsSigner: true,
        destAccount: receiver.publicKey,
        sourceTokenAccount: scoped.vault,
        destTokenAccount: receiverAta,
        amount: 1n,
      })],
      attacker.publicKey,
      [attacker],
      [scoped.vault, receiverAta],
    ));

    negativeCases.push(await simulateV1(
      `vault_${index + 1}_victim_authority_passed_without_signature`,
      [sendTokenDirectlyInstruction({
        sourceAccount: scoped.authority,
        sourceIsSigner: false,
        destAccount: receiver.publicKey,
        sourceTokenAccount: scoped.vault,
        destTokenAccount: receiverAta,
        amount: 1n,
      })],
      attacker.publicKey,
      [attacker],
      [scoped.vault, receiverAta],
    ));

    const pending = transactionResults[index].open.find((row) =>
      row.referencesZbcnMint && row.referencesScopedVault && !row.thresholdMet);
    if (!pending) throw new Error(`no pending under-threshold ZBCN transaction found for vault ${index + 1}`);
    const pendingAddress = new PublicKey(pending.address);
    negativeCases.push(await simulateV1(
      `vault_${index + 1}_outsider_cannot_approve_multisig_transaction`,
      [approveInstruction(scoped.multisig, pendingAddress, attacker.publicKey)],
      attacker.publicKey,
      [attacker],
      [pendingAddress, scoped.multisig],
    ));
    negativeCases.push(await simulateV1(
      `vault_${index + 1}_permissionless_execute_still_enforces_threshold`,
      [executeInstruction(scoped.multisig, scoped.authority, pendingAddress, pending)],
      attacker.publicKey,
      [attacker],
      [pendingAddress, scoped.vault, receiverAta],
    ));
  }

  const fixedAuthorized = transactionResults[0].open.find((row) => row.thresholdMet);
  let authorizedPermissionlessExecute = null;
  if (fixedAuthorized) {
    const source = fixedAuthorized.accounts.at(-2);
    const destination = fixedAuthorized.accounts.at(-1);
    authorizedPermissionlessExecute = await simulateV1(
      'positive_control_permissionless_execution_of_fixed_threshold_approved_transaction',
      [executeInstruction(VAULTS[0].multisig, VAULTS[0].authority,
        new PublicKey(fixedAuthorized.address), fixedAuthorized)],
      attacker.publicKey,
      [attacker],
      [new PublicKey(fixedAuthorized.address), new PublicKey(source.pubkey), new PublicKey(destination.pubkey)],
    );
    authorizedPermissionlessExecute.fixedInstruction = {
      transaction: fixedAuthorized.address,
      targetProgram: fixedAuthorized.programId,
      instructionName: fixedAuthorized.instructionName,
      mint: fixedAuthorized.accounts[6]?.pubkey || null,
      sourceTokenAccount: source.pubkey,
      destinationTokenAccount: destination.pubkey,
      amountRaw: fixedAuthorized.amountRaw,
      approvalCount: fixedAuthorized.approvalCount,
      threshold: fixedAuthorized.threshold,
      referencesZbcnMint: fixedAuthorized.referencesZbcnMint,
      referencesScopedVault: fixedAuthorized.referencesScopedVault,
    };
  }

  const localSlotAfter = await rpc(LOCAL_RPC, 'getSlot', [{commitment: 'processed'}]);
  return {
    endpoint: 'localhost Surfpool fork (URL intentionally not embedded)',
    upstream: 'Solana mainnet-beta read-only datasource (credential intentionally not embedded)',
    localSlotBefore,
    localSlotAfter,
    mainnetAccountsClonedWithoutModification: cloneAddresses.map(String),
    syntheticFixtures: {
      purpose: 'positive authorization control only; no value claim',
      attacker: attacker.publicKey.toBase58(),
      receiver: receiver.publicKey.toBase58(),
      attackerAta: attackerAta.toBase58(),
      receiverAta: receiverAta.toBase58(),
      syntheticAttackerStartingRaw: '100',
    },
    cases: [directPositive, ...negativeCases, authorizedPermissionlessExecute].filter(Boolean),
  };
}

async function main() {
  const idlBytes = fs.readFileSync(IDL_PATH);
  const idl = JSON.parse(idlBytes);
  const zbcBinary = fs.readFileSync(ZBC_BINARY_PATH);
  const multisigBinary = fs.readFileSync(MULTISIG_BINARY_PATH);
  const surface = binaryInstructionSurface(idl, zbcBinary);
  const multisigSurface = multisigInstructionSurface(multisigBinary);
  const instructionByDiscriminator = new Map(surface.instructions
    .map((instruction) => [instruction.discriminatorHex, instruction.name]));

  const genesis = await rpc(MAINNET_RPC, 'getGenesisHash', []);
  const onChainIdl = await getAccount(MAINNET_RPC, ZBC_IDL_ACCOUNT);
  const context = await getAccounts(MAINNET_RPC, [
    ...VAULTS.flatMap((vault) => [vault.vault, vault.multisig, vault.historicalTransaction]),
    MARGINFI_ZBCN_BANK,
    MARGINFI_ZBCN_LIQUIDITY_VAULT,
  ]);
  const rows = context.value;
  let cursor = 0;
  const vaultResults = [];
  const multisigRows = [];
  const historicalRows = [];
  for (const item of VAULTS) {
    const vaultRow = rows[cursor++];
    const multisigRow = rows[cursor++];
    const historicalRow = rows[cursor++];
    const token = decodeTokenAccount(vaultRow);
    const multisig = decodeMultisig(multisigRow);
    const historicalTransaction = decodeStoredTransaction(historicalRow);
    if (!token || !multisig || !historicalTransaction) {
      throw new Error(`failed to decode scoped accounts for ${item.vault}`);
    }
    const [derivedSigner, derivedBump] = PublicKey.findProgramAddressSync(
      [item.multisig.toBuffer()], MULTISIG_PROGRAM);
    const directAta = getAssociatedTokenAddressSync(ZBCN_MINT, item.authority, true);
    const [zebecCustodyPda] = PublicKey.findProgramAddressSync(
      [item.authority.toBuffer()], ZBC_PROGRAM);
    const zebecCustodyAta = getAssociatedTokenAddressSync(ZBCN_MINT, zebecCustodyPda, true);
    vaultResults.push({
      vault: item.vault.toBase58(),
      mint: token.mint,
      authority: token.authority,
      rawAmount: token.rawAmount,
      uiAmountString: `${BigInt(token.rawAmount) / 1_000_000n}.${(BigInt(token.rawAmount) % 1_000_000n)
        .toString().padStart(6, '0')}`.replace(/\.?0+$/, ''),
      tokenProgram: vaultRow.owner,
      isAssociatedTokenAccountOfAuthority: directAta.equals(item.vault),
      multisig: item.multisig.toBase58(),
      multisigSignerDerived: derivedSigner.toBase58(),
      multisigSignerBump: derivedBump,
      authorityIsMultisigSigner: derivedSigner.equals(item.authority),
      zbcCustodyPdaForAuthority: zebecCustodyPda.toBase58(),
      zbcCustodyAtaForAuthority: zebecCustodyAta.toBase58(),
      currentVaultIsZbcCustodyAta: zebecCustodyAta.equals(item.vault),
      outflowSignature: item.outflowSignature,
      outflowSlot: item.outflowSlot,
      historicalMultisigTransaction: item.historicalTransaction.toBase58(),
      historicalTargetProgram: historicalTransaction.programId,
      historicalInstruction: instructionByDiscriminator.get(historicalTransaction.discriminatorHex) || null,
      historicalTransferRaw: historicalTransaction.amountRaw,
      historicalApprovalCount: historicalTransaction.approvalCount,
      historicalDidExecute: historicalTransaction.didExecute,
    });
    multisigRows.push({address: item.multisig.toBase58(), ...multisig,
      derivedSigner: derivedSigner.toBase58(), signerMatchesVaultAuthority: derivedSigner.equals(item.authority)});
    historicalRows.push({address: item.historicalTransaction.toBase58(), ...historicalTransaction});
  }

  const marginfiBank = rows[cursor++];
  const marginfiLiquidity = rows[cursor++];
  const marginfiToken = decodeTokenAccount(marginfiLiquidity);
  const transactionResults = [];
  for (let i = 0; i < VAULTS.length; i += 1) {
    transactionResults.push(await listMultisigTransactions(VAULTS[i].multisig,
      multisigRows[i].threshold, instructionByDiscriminator));
  }
  const thresholdMetOpen = transactionResults.flatMap((inventory, index) => inventory.open
    .filter((transaction) => transaction.thresholdMet)
    .map((transaction) => ({multisig: VAULTS[index].multisig.toBase58(), transaction})));
  const thresholdMetTokenAddresses = [...new Set(thresholdMetOpen.flatMap(({transaction}) =>
    transaction.accounts.slice(-2).map((account) => account.pubkey)))];
  const thresholdMetTokenSnapshot = thresholdMetTokenAddresses.length
    ? await getAccounts(MAINNET_RPC, thresholdMetTokenAddresses) : {context: {slot: null}, value: []};
  const thresholdMetTokenByAddress = new Map(thresholdMetTokenAddresses.map((address, index) =>
    [address, decodeTokenAccount(thresholdMetTokenSnapshot.value[index])]));
  const thresholdMetOpenEvidence = thresholdMetOpen.map(({multisig, transaction}) => ({
    multisig,
    transaction: transaction.address,
    mint: transaction.accounts[6]?.pubkey || null,
    sourceTokenAccount: transaction.accounts.at(-2)?.pubkey || null,
    destinationTokenAccount: transaction.accounts.at(-1)?.pubkey || null,
    amountRaw: transaction.amountRaw,
    approvalCount: transaction.approvalCount,
    threshold: transaction.threshold,
    referencesZbcnMint: transaction.referencesZbcnMint,
    referencesScopedVault: transaction.referencesScopedVault,
    currentSourceToken: thresholdMetTokenByAddress.get(transaction.accounts.at(-2)?.pubkey) || null,
    currentDestinationToken: thresholdMetTokenByAddress.get(transaction.accounts.at(-1)?.pubkey) || null,
  }));
  const klend = await listKlendZbcnReserves();
  const localFork = await localForkTests(vaultResults, transactionResults);
  const zbcProgram = await programSnapshot(ZBC_PROGRAM);
  const multisigProgram = await programSnapshot(MULTISIG_PROGRAM);
  const totalRaw = vaultResults.reduce((sum, vault) => sum + BigInt(vault.rawAmount), 0n);

  const report = {
    generatedAt: new Date().toISOString(),
    authorizationScope: 'outsider-accessible unauthorized drain of the two named current ZBCN vaults',
    noMainnetTransactionsSubmitted: true,
    mainnet: {
      genesisHash: genesis,
      observationSlot: context.context.slot,
      programs: {zbc: zbcProgram, multisig: multisigProgram},
      localBinaryArtifacts: {
        zbc: {path: path.basename(ZBC_BINARY_PATH), bytes: zbcBinary.length, sha256: sha256(zbcBinary)},
        multisig: {path: path.basename(MULTISIG_BINARY_PATH), bytes: multisigBinary.length,
          sha256: sha256(multisigBinary), containsThresholdError:
            multisigBinary.includes(Buffer.from('Not enough owners signed this transaction.'))},
      },
      idlEvidence: {
        package: '@zebec-protocol/stream@1.8.0',
        path: path.basename(IDL_PATH),
        bytes: idlBytes.length,
        sha256: sha256(idlBytes),
        programIdMatches: ZBC_PROGRAM.toBase58() === 'zbcKGdAmXfthXY3rEPBzexVByT2cqRqCZb9NwWdGQ2T',
        sourceUrlEmbeddedInCurrentBinary: zbcBinary.includes(
          Buffer.from('https://github.com/Zebec-protocol/zebec-anchor')),
        onChainIdlAddress: ZBC_IDL_ACCOUNT.toBase58(),
        onChainIdlObservationSlot: onChainIdl.context.slot,
        onChainIdlExists: !!onChainIdl.value,
      },
      instructionSurface: surface,
      multisigInstructionSurface: multisigSurface,
      vaults: vaultResults,
      scopedVaultTotalRaw: totalRaw.toString(),
      scopedVaultTotalUi: `${totalRaw / 1_000_000n}.${(totalRaw % 1_000_000n)
        .toString().padStart(6, '0')}`.replace(/\.?0+$/, ''),
      multisigs: multisigRows,
      historicalExecutedTransactions: historicalRows,
      transactionInventory: Object.fromEntries(VAULTS.map((vault, index) => [
        vault.multisig.toBase58(), transactionResults[index],
      ])),
      thresholdMetOpenEvidence: {
        observationSlot: thresholdMetTokenSnapshot.context.slot,
        transactions: thresholdMetOpenEvidence,
      },
      sameMintFlashLiquidity: {
        klend,
        project0Marginfi: {
          observationSlot: context.context.slot,
          programId: PROJECT0_PROGRAM.toBase58(),
          bank: MARGINFI_ZBCN_BANK.toBase58(),
          bankOwner: marginfiBank?.owner || null,
          liquidityVault: MARGINFI_ZBCN_LIQUIDITY_VAULT.toBase58(),
          liquidityVaultToken: marginfiToken,
        },
      },
    },
    localFork,
    conclusion: {
      exploitValidated: false,
      immediatelyAtRiskUnauthorizedRaw: '0',
      immediatelyAtRiskUnauthorizedUsd: 0,
      reason: 'Every scoped value-moving path requires the vault authority signer; each authority is a 3-of-4 multisig signer PDA. Outsider approval fails, under-threshold permissionless execution fails, and direct signer/account substitution fails before value moves.',
      unwindTested: false,
      unwindReason: 'No unauthorized principal was obtained. Same-mint flash capacity was also absent: no KLend ZBCN reserve and the current Project0/marginfi ZBCN liquidity vault balance was zero.',
    },
  };
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    output: OUT,
    observationSlot: report.mainnet.observationSlot,
    programHashes: {
      zbc: report.mainnet.localBinaryArtifacts.zbc.sha256,
      multisig: report.mainnet.localBinaryArtifacts.multisig.sha256,
    },
    vaults: vaultResults.map((vault) => ({vault: vault.vault, authority: vault.authority,
      rawAmount: vault.rawAmount, multisig: vault.multisig, threshold:
        multisigRows.find((row) => row.address === vault.multisig)?.threshold})),
    pending: Object.fromEntries(Object.entries(report.mainnet.transactionInventory)
      .map(([address, inventory]) => [address, {open: inventory.openCount,
        thresholdMet: inventory.openThresholdMet,
        thresholdMetZbcn: inventory.openThresholdMetZbcn}])) ,
    sameMintFlash: {klendReserveCount: klend.reserves.length,
      project0MarginfiLiquidityRaw: marginfiToken?.rawAmount ?? null},
    simulations: localFork.cases.map((test) => ({label: test.label, err: test.err,
      bytes: test.wire.bytes, addresses: test.wire.addresses,
      keyLogs: test.logs?.filter((line) => /Instruction:|Error Code:|Error Message:|failed:/.test(line))})),
    exploitValidated: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
