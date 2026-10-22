#!/usr/bin/env node
'use strict';

// Current Jupiter-routed independent USDG/USDC exit, signed and simulated on
// the local current-state fork. The JupLend AMM is excluded. Never submits.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram} =
  require(path.join(MODULES, '@solana', 'web3.js'));
const {getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID} =
  require(path.join(MODULES, '@solana', 'spl-token'));
const {BorshAccountsCoder} = require(path.join(MODULES, '@coral-xyz', 'anchor'));
const {encodeV1} = require('../2026-10-15/klend-v1-composition.js');

const FORK = process.env.V95_FORK_RPC || 'http://127.0.0.1:9033';
const OUT = path.join(__dirname, 'jupiter-v95-independent-exit.json');
const USDG = new PublicKey('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MANIFEST_POOL = 'EXMcKF76kmBUH8xZ5fi1jv3ezh3eVQCeL4rQbpjCRxvF';
const PATH95 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '2026-10-15',
  'jupiter-dex-peg-path-census.json'))).paths.find((row) => row.vaultId === 95);
const liquidityIdl = JSON.parse(fs.readFileSync(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl/liquidity.json'));
const liquidityCoder = new BorshAccountsCoder(liquidityIdl);
const P = (value) => value instanceof PublicKey ? value : new PublicKey(value);
let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(FORK, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
function ixFromJson(row) {
  return new TransactionInstruction({programId: P(row.programId),
    keys: row.accounts.map((key) => ({pubkey: P(key.pubkey), isSigner: key.isSigner,
      isWritable: key.isWritable})), data: Buffer.from(row.data, 'base64')});
}
function signV1(instructions, signer, blockhash) {
  const encoded = encodeV1(instructions, signer.publicKey, blockhash);
  if (encoded.requiredSignatures !== 1) throw new Error('Unexpected signer count');
  const compiled = new TransactionMessage({payerKey: signer.publicKey, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (!compiled.staticAccountKeys[0].equals(signer.publicKey)) throw new Error('Signer order changed');
  const wire = Buffer.from(encoded.wire);
  const message = wire.subarray(0, wire.length - 64);
  const privateKey = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(signer.secretKey.subarray(0, 32)),
  ]), format: 'der', type: 'pkcs8'});
  crypto.sign(null, message, privateKey).copy(wire, wire.length - 64);
  return {encoded, wire};
}
async function setToken(templateAddress, target, mint, authority, amount) {
  const template = (await rpc('getAccountInfo', [String(templateAddress),
    {encoding: 'base64', commitment: 'processed'}])).value;
  if (!template) throw new Error(`Missing template ${templateAddress}`);
  const data = Buffer.from(template.data[0], 'base64');
  if (!data.subarray(0, 32).equals(mint.toBuffer())) throw new Error('Template mint mismatch');
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  await rpc('surfnet_setAccount', [target.toBase58(), {data: data.toString('hex'),
    executable: false, lamports: template.lamports, owner: template.owner, rentEpoch: 0}]);
}
function amount(row) {
  return row?.data ? Buffer.from(row.data[0], 'base64').readBigUInt64LE(64).toString() : null;
}

async function main() {
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync(path.join(os.homedir(), 'hooked.json'), 'utf8'))));
  const usdgAta = getAssociatedTokenAddressSync(USDG, signer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const usdcAta = getAssociatedTokenAddressSync(USDC, signer.publicKey, false, TOKEN_PROGRAM_ID);
  const quoteUrl = new URL('https://lite-api.jup.ag/swap/v1/quote');
  for (const [key, value] of Object.entries({inputMint: USDG.toBase58(),
    outputMint: USDC.toBase58(), amount: '100000000000', slippageBps: '50',
    excludeDexes: 'JupLend AMM'})) quoteUrl.searchParams.set(key, value);
  const quote = await (await fetch(quoteUrl)).json();
  if (quote.error) throw new Error(`Quote: ${quote.error}`);
  if (quote.routePlan?.length !== 1 || quote.routePlan[0].swapInfo.ammKey !== MANIFEST_POOL)
    throw new Error(`Independent direct Manifest route changed: ${JSON.stringify(quote.routePlan)}`);
  const instructionsResponse = await (await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({
      quoteResponse: quote, userPublicKey: signer.publicKey.toBase58(),
      wrapAndUnwrapSol: false, useSharedAccounts: false, skipUserAccountsRpcCalls: true,
      dynamicComputeUnitLimit: false,
    }),
  })).json();
  if (instructionsResponse.error) throw new Error(`Swap instructions: ${instructionsResponse.error}`);
  const instructions = [instructionsResponse.swapInstruction].filter(Boolean).map(ixFromJson);

  await rpc('surfnet_setAccount', [signer.publicKey.toBase58(), {data: '', executable: false,
    lamports: 20_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  const reserveRows = await rpc('getMultipleAccounts', [[PATH95.tokenReserve0, PATH95.tokenReserve1],
    {encoding: 'base64', commitment: 'processed'}]);
  const reserve0 = liquidityCoder.decode('TokenReserve', Buffer.from(reserveRows.value[0].data[0], 'base64'));
  const reserve1 = liquidityCoder.decode('TokenReserve', Buffer.from(reserveRows.value[1].data[0], 'base64'));
  const startUsdg = 100_000_000_000n;
  await setToken(reserve0.vault, usdgAta, USDG, signer.publicKey, startUsdg);
  await setToken(reserve1.vault, usdcAta, USDC, signer.publicKey, 0n);
  const publicKeys = [...new Set(instructions.flatMap((instruction) => [instruction.programId,
    ...instruction.keys.map((key) => key.pubkey)].map(String)))]
    .filter((address) => ![signer.publicKey, usdgAta, usdcAta]
      .some((key) => key.toBase58() === address));
  for (let offset = 0; offset < publicKeys.length; offset += 50)
    await rpc('getMultipleAccounts', [publicKeys.slice(offset, offset + 50),
      {encoding: 'base64', commitment: 'processed'}]);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const signed = signV1(instructions, signer, blockhash);
  const simulation = await rpc('simulateTransaction', [signed.wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: [usdgAta.toBase58(), usdcAta.toBase58()]},
  }]);
  const post = simulation.value.accounts || [];
  const output = {generatedAt: new Date().toISOString(), fork: FORK,
    scope: 'signed current-state local-fork independent exit; no mainnet submission',
    signerSource: '~/hooked.json (private bytes not retained)', signatureVerification: true,
    liveSubmission: false, quote: {inputRaw: quote.inAmount, outputRaw: quote.outAmount,
      otherAmountThresholdRaw: quote.otherAmountThreshold, priceImpactPct: quote.priceImpactPct,
      route: quote.routePlan.map((row) => ({label: row.swapInfo.label,
        ammKey: row.swapInfo.ammKey, inputMint: row.swapInfo.inputMint,
        outputMint: row.swapInfo.outputMint}))}, excludedDexes: ['JupLend AMM'],
    simulation: {err: simulation.value.err, unitsConsumed: simulation.value.unitsConsumed,
      wireBytes: signed.encoded.sizeBytes, addressCount: signed.encoded.addressCount,
      instructionCount: signed.encoded.instructionCount,
      requiredSignatures: signed.encoded.requiredSignatures,
      startingUsdgRaw: startUsdg.toString(), startingUsdcRaw: '0',
      endingUsdgRaw: amount(post[0]), endingUsdcRaw: amount(post[1]),
      lastLogs: simulation.value.logs?.slice(-20)}};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({out: OUT, quote: output.quote, simulation: output.simulation}));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
