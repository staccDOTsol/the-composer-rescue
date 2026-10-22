#!/usr/bin/env node
'use strict';

// Exact current PancakeSwap USDT/WSOL gate. This script can only issue read-only
// RPC calls and simulateTransaction; it has no send/broadcast method.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/onre-harness/node_modules';
const {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require(`${MOD}/@solana/web3.js`);
const spl = require(`${MOD}/@solana/spl-token`);
const bs58Module = require(`${MOD}/bs58`);
const bs58 = bs58Module.default || bs58Module;

const ROOT = __dirname;
const OUT = path.join(ROOT, 'pancake-outsider-signed-gate.json');
const IDL_PATH = path.join(ROOT, 'pancake-current-idl.json');
const LEARN_PATH = path.join(ROOT, 'pancake-composer-learn.json');
const RPC_ENV = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
const WALLET_PATH = '/Users/stacc/hooked.json';

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const PROGRAM = new PublicKey('HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq');
const PROGRAM_DATA = new PublicKey('66S4Bs8HVyaPdQ5JGfKixEZMf5CczcfnLGgGYEKnvi3Z');
const POOL = new PublicKey('22HUWiJaTNph96KQTKZVy2wg8KzfCems5nyW7E5H5J6w');
const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const USDT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const WSOL_VAULT = new PublicKey('7YcR78PKBHE5divhPVJ668kmmaDzove2d9msY9NpAJL2');
const USDT_VAULT = new PublicKey('FCBauqNLbEBUci1v3NT4gWyFZXS4YUGnX7ZsPmWVzrvV');
const SOURCE_SIGNATURE = '35edy8JF1qt7n6MFvWbLumb2oi61cRarFeeCsSPiiignthyu4Vz8sAUUBfA7wveZrqkGc5p84wvP1LLCZ4xbeD2';
const INPUT_RAW = 10_000_000n;
const OUTSIDER_FUNDING_LAMPORTS = 60_000_000;
const JUPITER_V6 = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const READ_METHODS = new Set([
  'getGenesisHash', 'getAccountInfo', 'getMultipleAccounts', 'getLatestBlockhash',
  'getFeeForMessage', 'getTransaction', 'simulateTransaction',
]);
let rpcId = 0;

function loadEnv(file) {
  const values = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw.trim());
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(\x22|')(.*)\1$/, '$2');
  }
  const endpoint = values.SOLANA_RPC_URL || values.RPC || values.RPC_URL ||
    values.SOLANA_RPC || values.FLUX_RPC_A || values.HEAVY_RPC_URL || values.HELIUS_RPC_URL;
  if (!endpoint) throw new Error('RPC endpoint unavailable');
  return endpoint;
}

const RPC = loadEnv(RPC_ENV);
const feePayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'))));

async function rpc(method, params = []) {
  if (!READ_METHODS.has(method)) throw new Error(`RPC method forbidden by harness: ${method}`);
  let last;
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const response = await fetch(RPC, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
        signal: AbortSignal.timeout(45_000),
      });
      const body = await response.json();
      if (response.ok && !body.error) return body.result;
      last = new Error(`${method}: ${JSON.stringify(body.error || {status: response.status})}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 450 * (attempt + 1)));
  }
  throw last;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(90_000)});
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${new URL(url).pathname}: non-JSON HTTP ${response.status}`); }
  if (!response.ok) throw new Error(`${new URL(url).pathname}: HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function tokenImage(account) {
  if (!account?.data || account.owner !== spl.TOKEN_PROGRAM_ID.toBase58()) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 165) return null;
  return {
    mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(data.subarray(32, 64)).toBase58(),
    amountRaw: data.readBigUInt64LE(64).toString(),
    lamports: account.lamports,
  };
}

function accountImage(account) {
  if (!account) return null;
  return {owner: account.owner, lamports: account.lamports, token: tokenImage(account)};
}

function numericDelta(after, before) {
  if (after == null || before == null) return null;
  return (BigInt(after) - BigInt(before)).toString();
}

function imageDelta(after, before) {
  return {
    lamports: numericDelta(after?.lamports, before?.lamports),
    tokenRaw: after?.token?.mint && after.token.mint === before?.token?.mint ?
      numericDelta(after.token.amountRaw, before.token.amountRaw) : null,
  };
}

function discriminatorHex(data) {
  return Buffer.from(data).subarray(0, 8).toString('hex');
}

function parseProgramData(account) {
  const data = Buffer.from(account.data[0], 'base64');
  const tag = data.readUInt32LE(0);
  const lastDeploySlot = Number(data.readBigUInt64LE(4));
  const authorityOption = data[12];
  const metadataLength = authorityOption === 1 ? 45 : 13;
  const upgradeAuthority = authorityOption === 1 ? new PublicKey(data.subarray(13, 45)).toBase58() : null;
  const elf = data.subarray(metadataLength);
  return {
    stateTag: tag,
    lastDeploySlot,
    upgradeAuthority,
    accountBytes: data.length,
    accountSha256: sha256(data),
    elfBytes: elf.length,
    elfSha256: sha256(elf),
  };
}

function decodePoolState(account) {
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 233) throw new Error('pool state is too short');
  const keyAt = offset => new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  return {
    discriminatorHex: data.subarray(0, 8).toString('hex'),
    bump: data[8],
    ammConfig: keyAt(9),
    owner: keyAt(41),
    tokenMint0: keyAt(73),
    tokenMint1: keyAt(105),
    tokenVault0: keyAt(137),
    tokenVault1: keyAt(169),
    observationKey: keyAt(201),
  };
}

function decodeAmmConfig(account) {
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 93) throw new Error('AMM config is too short');
  return {
    discriminatorHex: data.subarray(0, 8).toString('hex'),
    bump: data[8],
    index: data.readUInt16LE(9),
    owner: new PublicKey(data.subarray(11, 43)).toBase58(),
    protocolFeeRate: data.readUInt32LE(43),
    tradeFeeRate: data.readUInt32LE(47),
    tickSpacing: data.readUInt16LE(51),
    fundFeeRate: data.readUInt32LE(53),
    fundOwner: new PublicKey(data.subarray(61, 93)).toBase58(),
  };
}

async function loadLookupTables(transaction) {
  const rows = [];
  for (const lookup of transaction.message.addressTableLookups || []) {
    const info = await rpc('getAccountInfo', [lookup.accountKey.toBase58(), {
      encoding: 'base64', commitment: 'processed',
    }]);
    if (!info.value) throw new Error(`lookup table unavailable: ${lookup.accountKey}`);
    rows.push(new AddressLookupTableAccount({
      key: lookup.accountKey,
      state: AddressLookupTableAccount.deserialize(Buffer.from(info.value.data[0], 'base64')),
    }));
  }
  return rows;
}

function addressCount(message) {
  return message.staticAccountKeys.length + (message.addressTableLookups || [])
    .reduce((sum, row) => sum + row.writableIndexes.length + row.readonlyIndexes.length, 0);
}

async function compileAndSign(instructions, signers, lookupTables) {
  const latest = await rpc('getLatestBlockhash', [{commitment: 'processed'}]);
  const message = new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash: latest.value.blockhash,
    instructions,
  }).compileToV0Message(lookupTables);
  const transaction = new VersionedTransaction(message);
  transaction.sign(signers);
  const wire = Buffer.from(transaction.serialize());
  return {transaction, message, wire, latest};
}

async function simulateEncoded(encoded, watched) {
  const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  return {
    contextSlot: response.context.slot,
    err: response.value.err,
    unitsConsumed: response.value.unitsConsumed,
    loadedAccountsDataSize: response.value.loadedAccountsDataSize,
    logs: response.value.logs || [],
    innerInstructions: response.value.innerInstructions || [],
    accounts: (response.value.accounts || []).map(accountImage),
  };
}

function findInnerProgramInstruction(simulation, encoded, program) {
  const keys = encoded.message.getAccountKeys({addressLookupTableAccounts: encoded.lookupTables});
  const matches = [];
  for (const group of simulation.innerInstructions || []) {
    for (const ix of group.instructions || []) {
      const programId = Number.isInteger(ix.programIdIndex) ? keys.get(ix.programIdIndex) :
        (typeof ix.programId === 'string' ? new PublicKey(ix.programId) : null);
      if (!programId?.equals(program)) continue;
      const accountIndexes = (ix.accounts || []).map(value => {
        if (Number.isInteger(value)) return value;
        const address = typeof value === 'string' ? value : value?.pubkey;
        for (let index = 0; index < keys.length; index++) {
          if (keys.get(index)?.toBase58() === address) return index;
        }
        throw new Error(`inner account not present in message keys: ${address}`);
      });
      matches.push({
        outerIndex: group.index,
        stackHeight: ix.stackHeight ?? null,
        programId: programId.toBase58(),
        accounts: accountIndexes.map(index => ({
          index,
          address: keys.get(index).toBase58(),
          signer: encoded.message.isAccountSigner(index),
          writable: encoded.message.isAccountWritable(index),
        })),
        data: Buffer.from(bs58.decode(ix.data)),
      });
    }
  }
  return matches;
}

function summarizeInnerPrograms(simulation, encoded) {
  const keys = encoded.message.getAccountKeys({addressLookupTableAccounts: encoded.lookupTables});
  return (simulation.innerInstructions || []).flatMap(group => (group.instructions || []).map(ix => ({
    outerIndex: group.index,
    programIdIndex: ix.programIdIndex ?? null,
    programId: Number.isInteger(ix.programIdIndex) ? keys.get(ix.programIdIndex)?.toBase58() || null : ix.programId || null,
    accountCount: Array.isArray(ix.accounts) ? ix.accounts.length : null,
    dataPrefix: typeof ix.data === 'string' ? ix.data.slice(0, 20) : null,
    stackHeight: ix.stackHeight ?? null,
  })));
}

function cloneInstruction(ix, replacements = {}) {
  return new TransactionInstruction({
    programId: ix.programId,
    keys: ix.keys.map((key, index) => ({
      pubkey: replacements[index] ? new PublicKey(replacements[index]) : key.pubkey,
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

function directInstruction(recovered) {
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: recovered.accounts.map(row => ({
      pubkey: new PublicKey(row.address), isSigner: row.signer, isWritable: row.writable,
    })),
    data: Buffer.from(recovered.data),
  });
}

function compactWire(encoded, instructionCount) {
  return {
    version: 0,
    bytes: encoded.wire.length,
    addressCount: addressCount(encoded.message),
    requiredSignatures: encoded.message.header.numRequiredSignatures,
    instructionCount,
    sha256: sha256(encoded.wire),
    withinRequestedEnvelope: encoded.wire.length <= 4096 && addressCount(encoded.message) <= 64,
    withinSolanaPacketLimit: encoded.wire.length <= 1232,
  };
}

async function simulateCase(label, instructions, signers, lookupTables, watched, metadata = {}) {
  const encoded = await compileAndSign(instructions, signers, lookupTables);
  encoded.lookupTables = lookupTables;
  const fee = await rpc('getFeeForMessage', [
    Buffer.from(encoded.message.serialize()).toString('base64'), {commitment: 'processed'},
  ]);
  const simulation = await simulateEncoded(encoded, watched);
  return {
    label,
    ...metadata,
    sigVerify: true,
    replaceRecentBlockhash: false,
    broadcast: false,
    wire: compactWire(encoded, instructions.length),
    estimatedFeeLamports: fee.value,
    simulation,
  };
}

function instructionData(discriminator, u64s = [], trailing = []) {
  const data = Buffer.alloc(8 + u64s.length * 8 + trailing.length);
  Buffer.from(discriminator).copy(data, 0);
  u64s.forEach((value, index) => data.writeBigUInt64LE(BigInt(value), 8 + index * 8));
  Buffer.from(trailing).copy(data, 8 + u64s.length * 8);
  return data;
}

function parsedTokenTransfers(simulation, outerIndex) {
  const rows = [];
  for (const group of simulation.innerInstructions || []) {
    if (outerIndex != null && group.index !== outerIndex) continue;
    for (const ix of group.instructions || []) {
      const type = ix.parsed?.type;
      const info = ix.parsed?.info;
      if (!info || (type !== 'transfer' && type !== 'transferChecked')) continue;
      rows.push({
        outerIndex: group.index,
        stackHeight: ix.stackHeight ?? null,
        programId: ix.programId || null,
        type,
        source: info.source || null,
        destination: info.destination || null,
        authority: info.authority || null,
        amountRaw: info.amount || info.tokenAmount?.amount || null,
        mint: info.mint || null,
      });
    }
  }
  return rows;
}

async function main() {
  const [genesis, programAccount, programDataAccount, poolSnapshot, sourceTx] = await Promise.all([
    rpc('getGenesisHash'),
    rpc('getAccountInfo', [PROGRAM.toBase58(), {encoding: 'base64', commitment: 'processed'}]),
    rpc('getAccountInfo', [PROGRAM_DATA.toBase58(), {encoding: 'base64', commitment: 'processed'}]),
    rpc('getMultipleAccounts', [[POOL, WSOL_VAULT, USDT_VAULT].map(String), {
      encoding: 'base64', commitment: 'processed',
    }]),
    rpc('getTransaction', [SOURCE_SIGNATURE, {
      encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
    }]),
  ]);
  if (genesis !== MAINNET_GENESIS) throw new Error('RPC is not mainnet-beta');
  if (!programAccount.value?.executable) throw new Error('target program is not executable');
  if (!programDataAccount.value) throw new Error('target ProgramData is unavailable');
  if (!sourceTx || sourceTx.meta?.err) throw new Error('successful source receipt unavailable');

  const programData = parseProgramData(programDataAccount.value);
  const decodedPool = decodePoolState(poolSnapshot.value[0]);
  const configAccount = await rpc('getAccountInfo', [decodedPool.ammConfig, {
    encoding: 'base64', commitment: 'processed',
  }]);
  if (!configAccount.value) throw new Error('canonical AMM config unavailable');
  const decodedConfig = decodeAmmConfig(configAccount.value);
  const idlBytes = fs.readFileSync(IDL_PATH);
  const idl = JSON.parse(idlBytes);
  const learnedBytes = fs.readFileSync(LEARN_PATH);
  const learned = JSON.parse(learnedBytes);
  const idlSwap = idl.instructions.find(row => row.name === 'swap');
  const swapDiscriminator = Buffer.from(idlSwap.discriminator).toString('hex');

  const outsider = Keypair.generate();
  const decoy = Keypair.generate();
  const outsiderWsol = spl.getAssociatedTokenAddressSync(WSOL, outsider.publicKey);
  const outsiderUsdt = spl.getAssociatedTokenAddressSync(USDT, outsider.publicKey);
  const payerUsdt = spl.getAssociatedTokenAddressSync(USDT, feePayer.publicKey);

  const quoteParams = new URLSearchParams({
    inputMint: WSOL.toBase58(), outputMint: USDT.toBase58(), amount: INPUT_RAW.toString(),
    slippageBps: '100', onlyDirectRoutes: 'true', dexes: 'PancakeSwap',
  });
  const quote = await requestJson(`https://lite-api.jup.ag/swap/v1/quote?${quoteParams}`);
  const route = (quote.routePlan || []).map(row => ({
    ammKey: row.swapInfo?.ammKey || null,
    label: row.swapInfo?.label || null,
    inputMint: row.swapInfo?.inputMint || null,
    outputMint: row.swapInfo?.outputMint || null,
    inAmount: row.swapInfo?.inAmount || null,
    outAmount: row.swapInfo?.outAmount || null,
  }));
  if (route.length !== 1 || route[0].ammKey !== POOL.toBase58() || route[0].label !== 'PancakeSwap') {
    throw new Error(`exact direct Pancake pool quote unavailable: ${JSON.stringify(route)}`);
  }
  const built = await requestJson('https://lite-api.jup.ag/swap/v1/swap', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: outsider.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 0,
    }),
  });
  if (!built.swapTransaction) throw new Error(`Jupiter build failed: ${JSON.stringify(built).slice(0, 400)}`);
  const jupiterTransaction = VersionedTransaction.deserialize(Buffer.from(built.swapTransaction, 'base64'));
  const lookupTables = await loadLookupTables(jupiterTransaction);
  const decompiled = TransactionMessage.decompile(jupiterTransaction.message, {
    addressLookupTableAccounts: lookupTables,
  });
  const swapIndexes = decompiled.instructions.map((ix, index) => ({ix, index})).filter(row =>
    row.ix.programId.equals(JUPITER_V6) && row.ix.keys.some(key => key.pubkey.equals(POOL)) &&
    row.ix.keys.some(key => key.pubkey.equals(PROGRAM)));
  if (swapIndexes.length !== 1) throw new Error(`expected one Jupiter swap instruction, found ${swapIndexes.length}`);
  const jupiterSwapIndex = swapIndexes[0].index;

  const funding = SystemProgram.transfer({
    fromPubkey: feePayer.publicKey,
    toPubkey: outsider.publicKey,
    lamports: OUTSIDER_FUNDING_LAMPORTS,
  });
  const outerInstructions = [funding, ...decompiled.instructions];
  const outerEncoded = await compileAndSign(outerInstructions, [feePayer, outsider], lookupTables);
  outerEncoded.lookupTables = lookupTables;
  const outerWatched = [outsider.publicKey, outsiderUsdt, WSOL_VAULT, USDT_VAULT];
  const outerSimulation = await simulateEncoded(outerEncoded, outerWatched);
  if (outerSimulation.err !== null) {
    throw new Error(`fresh outsider Jupiter control failed: ${JSON.stringify(outerSimulation.err)}; ${outerSimulation.logs.slice(-8).join(' | ')}`);
  }
  const recovered = findInnerProgramInstruction(outerSimulation, outerEncoded, PROGRAM)
    .find(row => discriminatorHex(row.data) === swapDiscriminator);
  if (!recovered) throw new Error(`successful outer control did not expose a Pancake swap CPI: ${JSON.stringify({
    innerPrograms: summarizeInnerPrograms(outerSimulation, outerEncoded),
    pancakeLogLines: outerSimulation.logs.filter(line => line.includes(PROGRAM.toBase58())),
  })}`);
  if (recovered.accounts.length < 10 || recovered.accounts[2].address !== POOL.toBase58()) {
    throw new Error('recovered Pancake account layout does not match published swap schema');
  }
  recovered.dataHex = recovered.data.toString('hex');
  recovered.discriminatorHex = discriminatorHex(recovered.data);
  delete recovered.data;

  const liveDirect = directInstruction({...recovered, data: Buffer.from(recovered.dataHex, 'hex')});
  const directBase = decompiled.instructions.map((ix, index) => index === jupiterSwapIndex ? liveDirect : ix);
  const baseInstructions = [funding, ...directBase];
  const baselineInstructions = [funding, ...decompiled.instructions.filter((_, index) => index !== jupiterSwapIndex)];
  const watched = [feePayer.publicKey, outsider.publicKey, outsiderUsdt, WSOL_VAULT, USDT_VAULT];

  const baseline = await simulateCase('same_setup_without_swap', baselineInstructions,
    [feePayer, outsider], lookupTables, watched, {controlType: 'economic baseline'});
  const control = await simulateCase('fresh_outsider_direct_swap_control', baseInstructions,
    [feePayer, outsider], lookupTables, watched, {
      sourceSignature: SOURCE_SIGNATURE,
      mutation: 'Fresh outsider signer and fresh outsider WSOL/USDT accounts; canonical config, pool, vault, observation and tick-array roles.',
    });

  const role = {
    payer: 0, ammConfig: 1, poolState: 2, inputToken: 3, outputToken: 4,
    inputVault: 5, outputVault: 6, observation: 7, tokenProgram: 8, firstTickArray: 9,
  };
  const accountAt = index => liveDirect.keys[index].pubkey.toBase58();
  if (accountAt(role.inputVault) !== WSOL_VAULT.toBase58() || accountAt(role.outputVault) !== USDT_VAULT.toBase58()) {
    throw new Error(`recovered vault direction mismatch: ${accountAt(5)} -> ${accountAt(6)}`);
  }

  const cases = [];
  const addCase = async (label, replacements, metadata = {}, extra = [], signers = [feePayer, outsider]) => {
    const mutated = cloneInstruction(liveDirect, replacements);
    const instructions = [funding, ...extra,
      ...decompiled.instructions.map((ix, index) => index === jupiterSwapIndex ? mutated : ix)];
    cases.push(await simulateCase(label, instructions, signers, lookupTables, watched, metadata));
  };
  await addCase('signer_to_fresh_decoy', {0: decoy.publicKey}, {
    mutation: 'Swap authority replaced by a second fresh signer while the funded WSOL source remains outsider-owned.',
    expectedControl: 'Token ownership/signature binding must reject.',
  }, [], [feePayer, outsider, decoy]);
  await addCase('recipient_to_fee_payer_usdt', {4: payerUsdt}, {
    mutation: 'Output recipient replaced by the fee-payer USDT ATA; both controlled parties sign the envelope.',
    interpretationIfSuccess: 'Expected user-authorized recipient flexibility, not unauthorized value release.',
  }, [spl.createAssociatedTokenAccountIdempotentInstruction(
    feePayer.publicKey, payerUsdt, feePayer.publicKey, USDT)]);
  await addCase('pool_state_to_outsider', {2: outsider.publicKey}, {
    mutation: 'Canonical pool state replaced by an on-curve outsider system account.',
  });
  await addCase('amm_config_to_pool_state', {1: POOL}, {
    mutation: 'AMM config role aliased to the canonical pool state.',
  });
  await addCase('input_vault_to_user_source', {5: outsiderWsol}, {
    mutation: 'Canonical WSOL pool vault replaced by the fresh outsider WSOL account.',
  });
  await addCase('output_vault_to_user_destination', {6: outsiderUsdt}, {
    mutation: 'Canonical USDT pool vault replaced by the fresh outsider USDT account.',
  });
  await addCase('vault_roles_swapped', {5: USDT_VAULT, 6: WSOL_VAULT}, {
    mutation: 'Canonical input/output vault roles swapped.',
  });
  await addCase('observation_to_pool_state', {7: POOL}, {
    mutation: 'Observation-state role aliased to the pool state.',
  });
  await addCase('first_tick_array_to_pool_state', {9: POOL}, {
    mutation: 'First tick-array role aliased to the pool state.',
  });

  const mint0 = new PublicKey(decodedPool.tokenMint0);
  const mint1 = new PublicKey(decodedPool.tokenMint1);
  const outsiderToken0 = spl.getAssociatedTokenAddressSync(mint0, outsider.publicKey);
  const outsiderToken1 = spl.getAssociatedTokenAddressSync(mint1, outsider.publicKey);
  const collectSetup = [
    funding,
    spl.createAssociatedTokenAccountIdempotentInstruction(
      feePayer.publicKey, outsiderToken0, outsider.publicKey, mint0),
    spl.createAssociatedTokenAccountIdempotentInstruction(
      feePayer.publicKey, outsiderToken1, outsider.publicKey, mint1),
  ];
  const collectAccounts = [
    {pubkey: outsider.publicKey, isSigner: true, isWritable: false},
    {pubkey: POOL, isSigner: false, isWritable: true},
    {pubkey: new PublicKey(decodedPool.ammConfig), isSigner: false, isWritable: false},
    {pubkey: new PublicKey(decodedPool.tokenVault0), isSigner: false, isWritable: true},
    {pubkey: new PublicKey(decodedPool.tokenVault1), isSigner: false, isWritable: true},
    {pubkey: mint0, isSigner: false, isWritable: false},
    {pubkey: mint1, isSigner: false, isWritable: false},
    {pubkey: outsiderToken0, isSigner: false, isWritable: true},
    {pubkey: outsiderToken1, isSigner: false, isWritable: true},
    {pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
    {pubkey: spl.TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false},
  ];
  const makeCollect = name => {
    const row = idl.instructions.find(ix => ix.name === name);
    if (!row) throw new Error(`IDL instruction unavailable: ${name}`);
    return new TransactionInstruction({
      programId: PROGRAM,
      keys: collectAccounts,
      data: instructionData(row.discriminator, [1n, 1n]),
    });
  };
  const collectWatch = [outsiderToken0, outsiderToken1,
    new PublicKey(decodedPool.tokenVault0), new PublicKey(decodedPool.tokenVault1)];
  const privilegedProbes = [];
  for (const name of ['collect_protocol_fee', 'collect_fund_fee']) {
    privilegedProbes.push(await simulateCase(`outsider_${name}`,
      [...collectSetup, makeCollect(name)], [feePayer, outsider], [], collectWatch, {
        mutation: `Fresh outsider signer and outsider-owned recipients on canonical ${name} accounts; request one raw unit of each token.`,
        expectedControl: name === 'collect_protocol_fee' ? decodedConfig.owner : decodedConfig.fundOwner,
      }));
  }

  const baselineSameBank = baseline.simulation.contextSlot === control.simulation.contextSlot;
  const directOuterIndex = baseInstructions.findIndex(ix => ix.programId.equals(PROGRAM));
  const transferLedger = parsedTokenTransfers(control.simulation, directOuterIndex);
  const inputTransfer = transferLedger.find(row => row.source === outsiderWsol.toBase58() &&
    row.destination === WSOL_VAULT.toBase58() && row.authority === outsider.publicKey.toBase58());
  const outputTransfer = transferLedger.find(row => row.source === USDT_VAULT.toBase58() &&
    row.destination === outsiderUsdt.toBase58() && row.authority === POOL.toBase58());
  const transferConservation = inputTransfer?.amountRaw === INPUT_RAW.toString() &&
    BigInt(outputTransfer?.amountRaw || 0) >= BigInt(quote.otherAmountThreshold || 0);
  const reconciliation = watched.map((address, index) => ({
    address: address.toBase58(),
    baseline: baseline.simulation.accounts[index],
    control: control.simulation.accounts[index],
    deltaControlMinusBaseline: baselineSameBank ?
      imageDelta(control.simulation.accounts[index], baseline.simulation.accounts[index]) : null,
  }));
  const roleSubstitutionSuccesses = cases.filter(row => row.simulation.err === null &&
    row.label !== 'recipient_to_fee_payer_usdt').map(row => row.label);
  const recipientCase = cases.find(row => row.label === 'recipient_to_fee_payer_usdt');
  const privilegedSuccesses = privilegedProbes.filter(row => row.simulation.err === null).map(row => row.label);

  const programAccountBytes = Buffer.from(programAccount.value.data[0], 'base64');
  const report = {
    generatedAtUtc: new Date().toISOString(),
    environment: {
      network: 'mainnet-beta', genesisVerified: true,
      method: 'read-only RPC and signed simulateTransaction only',
      sigVerify: true, replaceRecentBlockhash: false,
      sendTransactionAvailableInHarness: false, broadcast: false,
      rpcEndpointRedacted: true, walletSecretRetainedPrivate: true,
    },
    target: {
      program: PROGRAM.toBase58(), pool: POOL.toBase58(), programData: PROGRAM_DATA.toBase58(),
      sourceReceipt: {signature: SOURCE_SIGNATURE, slot: sourceTx.slot, err: sourceTx.meta.err},
      programAccount: {
        executable: programAccount.value.executable,
        owner: programAccount.value.owner,
        bytes: programAccountBytes.length,
        sha256: sha256(programAccountBytes),
      },
      programData,
      currentReadSlot: poolSnapshot.context.slot,
      pool: accountImage(poolSnapshot.value[0]),
      decodedPool,
      decodedConfig,
      wsolVault: {address: WSOL_VAULT.toBase58(), image: accountImage(poolSnapshot.value[1])},
      usdtVault: {address: USDT_VAULT.toBase58(), image: accountImage(poolSnapshot.value[2])},
    },
    composer: {
      queriedFirst: true,
      publishedIdl: {
        path: path.basename(IDL_PATH), sha256: sha256(idlBytes), address: idl.address,
        metadata: idl.metadata, instructionCount: idl.instructions.length,
        swap: idlSwap,
      },
      learnedSchema: {
        path: path.basename(LEARN_PATH), sha256: sha256(learnedBytes), cached: learned.cached,
        evidence: learned.evidence, caveats: learned.caveats, instructionVariants: learned.instructions.length,
      },
    },
    quote: {
      contextSlot: quote.contextSlot, inAmount: quote.inAmount, outAmount: quote.outAmount,
      otherAmountThreshold: quote.otherAmountThreshold, priceImpactPct: quote.priceImpactPct, route,
      note: 'Quote is construction evidence only and is not treated as a finding.',
    },
    principals: {
      feePayer: feePayer.publicKey.toBase58(), outsider: outsider.publicKey.toBase58(),
      decoy: decoy.publicKey.toBase58(), outsiderWsol: outsiderWsol.toBase58(),
      outsiderUsdt: outsiderUsdt.toBase58(), payerUsdt: payerUsdt.toBase58(),
      privateKeysPersisted: false,
    },
    outerSignedControl: {
      wire: compactWire(outerEncoded, outerInstructions.length),
      simulation: outerSimulation,
      recoveredPancakeInstruction: recovered,
    },
    publishedRoleMap: {
      ...role,
      recoveredAccounts: liveDirect.keys.map((key, index) => ({
        index, address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable,
        role: Object.entries(role).find(([, value]) => value === index)?.[0] || 'remaining_tick_array_or_bitmap',
      })),
    },
    baseline,
    control,
    mutations: cases,
    privilegedProbes,
    reconciliation: {
      sameBank: baselineSameBank,
      watchedOrder: watched.map(String),
      rows: reconciliation,
      transferLedger,
      authoritativeTransferLedgerUsed: true,
      input: inputTransfer || null,
      output: outputTransfer || null,
      expectedInputRaw: INPUT_RAW.toString(),
      quotedOutputRaw: quote.outAmount,
      minimumOutputRaw: quote.otherAmountThreshold,
      walletAndPoolConservationChecked: control.simulation.err === null && transferConservation,
      statement: transferConservation ?
        'The outsider authorized exactly the WSOL input credited to the pool vault; the pool PDA authorized exactly the USDT output credited to the outsider. No third-party or synthetic token delta is counted.' :
        'Transfer ledger did not satisfy the exact input/output conservation check.',
    },
    conclusion: {
      controlSucceeded: control.simulation.err === null,
      roleSubstitutionSuccesses,
      privilegedFeeCollectionSuccesses: privilegedSuccesses,
      recipientRedirectSucceeded: recipientCase?.simulation.err === null,
      unauthorizedValueChangingRouteObserved: roleSubstitutionSuccesses.length > 0 || privilegedSuccesses.length > 0,
      flashEnvelopeRequired: roleSubstitutionSuccesses.length > 0 || privilegedSuccesses.length > 0,
      flashEnvelopeBuilt: false,
      finding: roleSubstitutionSuccesses.length > 0 || privilegedSuccesses.length > 0 ?
        'candidate_requires_independent_value_exit_validation' : null,
    },
    limitations: [
      'The published IDL is matched to current receipt discriminators and roles but is not a source-code proof of every binary guard.',
      'A successful user-authorized recipient redirect is expected swap functionality and is not an authorization bypass.',
      'No flash envelope is built unless a value-changing pool/config/vault/observation/tick substitution survives.',
    ],
  };
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, {mode: 0o600});
  console.log(JSON.stringify({
    output: OUT,
    deployed: report.target.programData,
    quote: report.quote,
    outerControl: {err: outerSimulation.err, wire: report.outerSignedControl.wire},
    directControl: {
      err: control.simulation.err, slot: control.simulation.contextSlot,
      wire: control.wire, logTail: control.simulation.logs.slice(-8),
    },
    mutations: cases.map(row => ({
      label: row.label, err: row.simulation.err, units: row.simulation.unitsConsumed,
      logTail: row.simulation.logs.slice(-6), wire: row.wire,
    })),
    privilegedProbes: privilegedProbes.map(row => ({
      label: row.label, expectedControl: row.expectedControl,
      err: row.simulation.err, units: row.simulation.unitsConsumed,
      logTail: row.simulation.logs.slice(-8), wire: row.wire,
    })),
    reconciliation: report.reconciliation,
    conclusion: report.conclusion,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
