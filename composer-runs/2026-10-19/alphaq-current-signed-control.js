#!/usr/bin/env node
'use strict';

// Builds the current Jupiter route constrained to the AlphaQ CASH/USDC market,
// signs it with a runtime-loaded local wallet, and calls mainnet-beta
// simulateTransaction. It never calls sendTransaction or broadcasts the wire.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  VersionedTransaction
} = require(MODULES + '/@solana/web3.js');
const {getAssociatedTokenAddressSync} = require(MODULES + '/@solana/spl-token');

const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const KEYPAIR_PATH = process.env.HOOKED_KEYPAIR_PATH || path.join(process.env.HOME, 'hooked.json');
const ALPHAQ = 'ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA';
const DFLOW = 'DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH';
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const ALPHAQ_POOL = '2YR8bXXn4tTnq8nVjvpYnBiQ7ZKjN3G16wxE8ShL3KaB';
const POOL_CASH = '2A5Cmp2mYwPzdxsQ5w6YTukYR2dNjCWVhnDTWUrifRxd';
const POOL_USDC = 'F2KCaXcp7AoQtxTDvNEDCyMyWjSCAMWNzcyN9dsPfPs5';
const CASH = 'CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const INPUT_RAW = '5000';
let rpcId = 0;

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rpc(method, params = [], attempts = 10) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})
    });
    const body = await response.text();
    if (response.status === 429) {
      last = new Error(`${method}: rate limited`);
      await sleep(Math.min(8000, 750 * (attempt + 1)));
      continue;
    }
    let json;
    try { json = JSON.parse(body); } catch {
      throw new Error(`${method}: non-JSON response (${response.status})`);
    }
    if (json.error) throw new Error(`${method}: ${json.error.message || JSON.stringify(json.error)}`);
    return json.result;
  }
  throw last || new Error(`${method}: exhausted retries`);
}

async function quote() {
  const params = new URLSearchParams({
    inputMint: USDC,
    outputMint: CASH,
    amount: INPUT_RAW,
    slippageBps: '100',
    onlyDirectRoutes: 'true',
    dexes: 'AlphaQ'
  });
  const response = await fetch('https://lite-api.jup.ag/swap/v1/quote?' + params);
  const body = await response.text();
  if (!response.ok) throw new Error(`Jupiter quote failed (${response.status})`);
  return JSON.parse(body);
}

async function swapTransaction(quoteResponse, userPublicKey) {
  const response = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 0
    })
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Jupiter swap build failed (${response.status}): ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

function parseSecret() {
  const parsed = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every(x => Number.isInteger(x) && x >= 0 && x <= 255)) {
    throw new Error('runtime signer has invalid shape');
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function tokenAmount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function invocationParents(logs, target) {
  const stack = [];
  const found = [];
  for (const line of logs || []) {
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      const depth = Number(invoke[2]);
      stack.length = depth - 1;
      const parent = depth > 1 ? stack[depth - 2] || null : null;
      stack[depth - 1] = invoke[1];
      if (invoke[1] === target) found.push({depth, immediateParent: parent});
      continue;
    }
    const done = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:)/.exec(line);
    if (done) {
      const index = stack.lastIndexOf(done[1]);
      if (index >= 0) stack.length = index;
    }
  }
  return found;
}

async function lookupTables(message) {
  const tables = [];
  for (const lookup of message.addressTableLookups || []) {
    const response = await rpc('getAccountInfo', [lookup.accountKey.toBase58(), {encoding: 'base64', commitment: 'confirmed'}]);
    if (!response.value) throw new Error('missing address lookup table');
    const data = Buffer.from(response.value.data[0], 'base64');
    tables.push(new AddressLookupTableAccount({key: lookup.accountKey, state: AddressLookupTableAccount.deserialize(data)}));
  }
  return tables;
}

async function main() {
  const signer = parseSecret();
  const genesis = await rpc('getGenesisHash');
  if (genesis !== MAINNET_GENESIS) throw new Error('RPC is not mainnet-beta');
  const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC), signer.publicKey, false, new PublicKey(TOKEN));
  const cashAta = getAssociatedTokenAddressSync(new PublicKey(CASH), signer.publicKey, false, new PublicKey(TOKEN2022));
  const pre = await rpc('getMultipleAccounts', [[signer.publicKey.toBase58(), usdcAta.toBase58(), cashAta.toBase58(), POOL_CASH, POOL_USDC], {encoding: 'base64', commitment: 'confirmed'}]);
  if (!pre.value[0] || pre.value[0].lamports < 5000000) throw new Error('runtime signer lacks SOL for a signed simulation');
  if (BigInt(tokenAmount(pre.value[1]) || 0) < BigInt(INPUT_RAW)) throw new Error('runtime signer lacks the bounded USDC input');

  const quoteResponse = await quote();
  const route = (quoteResponse.routePlan || []).map(x => ({
    label: x.swapInfo?.label || null,
    ammKey: x.swapInfo?.ammKey || null,
    percent: x.percent ?? null
  }));
  if (route.length !== 1 || route[0].label !== 'AlphaQ' || route[0].ammKey !== ALPHAQ_POOL) {
    throw new Error('Jupiter did not return the exact AlphaQ CASH/USDC route');
  }
  const built = await swapTransaction(quoteResponse, signer.publicKey.toBase58());
  const unsignedWire = Buffer.from(built.swapTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(unsignedWire);
  const message = transaction.message;
  if (message.header.numRequiredSignatures !== 1 || !message.staticAccountKeys[0].equals(signer.publicKey)) {
    throw new Error('swap transaction requests an uncontrolled signer');
  }
  const tables = await lookupTables(message);
  const keyCount = message.staticAccountKeys.length + (message.addressTableLookups || []).reduce(
    (sum, lookup) => sum + lookup.writableIndexes.length + lookup.readonlyIndexes.length, 0);
  if (keyCount > 64) throw new Error(`route exceeds 64 keys (${keyCount})`);
  transaction.sign([signer]);
  const wire = Buffer.from(transaction.serialize());
  if (wire.length > 4096) throw new Error(`route exceeds 4096 bytes (${wire.length})`);

  const accountKeys = message.getAccountKeys({addressLookupTableAccounts: tables});
  const topLevelPrograms = [...new Set(message.compiledInstructions.map(ix => accountKeys.get(ix.programIdIndex).toBase58()))];
  if (!topLevelPrograms.includes(DFLOW) && !topLevelPrograms.includes(JUPITER)) {
    throw new Error('route has neither the live DFlow nor Jupiter parent');
  }
  const fee = await rpc('getFeeForMessage', [Buffer.from(message.serialize()).toString('base64'), {commitment: 'confirmed'}]);
  const simulation = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64',
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: 'confirmed',
    innerInstructions: true,
    accounts: {
      encoding: 'base64',
      addresses: [usdcAta.toBase58(), cashAta.toBase58(), POOL_CASH, POOL_USDC]
    }
  }]);
  const post = simulation.value.accounts || [];
  const out = {
    generatedAtUtc: new Date().toISOString(),
    network: 'mainnet-beta',
    genesis,
    scope: 'one bounded signed mainnet-beta AlphaQ CASH/USDC routed control',
    signer: 'runtime-loaded and redacted',
    quote: {
      inputMint: USDC,
      outputMint: CASH,
      inAmount: quoteResponse.inAmount,
      outAmount: quoteResponse.outAmount,
      otherAmountThreshold: quoteResponse.otherAmountThreshold,
      priceImpactPct: quoteResponse.priceImpactPct,
      contextSlot: quoteResponse.contextSlot,
      route
    },
    routeEnvelope: {
      topLevelPrograms,
      alphaQParents: invocationParents(simulation.value.logs, ALPHAQ),
      wireBytes: wire.length,
      accountKeyCount: keyCount,
      requiredSignatures: message.header.numRequiredSignatures,
      recentBlockhash: 'redacted',
      wireSha256: sha256(wire)
    },
    slots: {
      preAccountRead: pre.context.slot,
      simulation: simulation.context.slot,
      poolDeltaComparable: pre.context.slot === simulation.context.slot
    },
    preRaw: {
      walletUsdc: tokenAmount(pre.value[1]),
      walletCash: tokenAmount(pre.value[2]),
      poolCash: tokenAmount(pre.value[3]),
      poolUsdc: tokenAmount(pre.value[4])
    },
    postRaw: {
      walletUsdc: tokenAmount(post[0]),
      walletCash: tokenAmount(post[1]),
      poolCash: tokenAmount(post[2]),
      poolUsdc: tokenAmount(post[3])
    },
    simulation: {
      err: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed,
      feeLamports: fee.value,
      logs: (simulation.value.logs || []).filter(line =>
        line.includes(ALPHAQ) || line.includes(DFLOW) || line.includes(JUPITER) || line.includes('Instruction: Transfer'))
    },
    accountingNote: pre.context.slot === simulation.context.slot
      ? 'Pre-read and simulation used the same slot.'
      : 'Wallet deltas are the signed control result; pool pre/post values span different live slots and are not used as an exact transaction delta.',
    sigVerify: true,
    sendTransactionCalled: false,
    broadcast: false
  };
  const outputPath = path.join(__dirname, 'alphaq-current-signed-control.json');
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({
    generatedAtUtc: out.generatedAtUtc,
    quote: out.quote,
    routeEnvelope: out.routeEnvelope,
    preRaw: out.preRaw,
    postRaw: out.postRaw,
    simulation: {err: out.simulation.err, unitsConsumed: out.simulation.unitsConsumed, feeLamports: out.simulation.feeLamports},
    sigVerify: true,
    broadcast: false,
    evidence: outputPath
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
