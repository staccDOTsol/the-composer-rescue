#!/usr/bin/env node
'use strict';

// Read-only mainnet-beta census for the Kipseli route surfaced by Jupiter.
// This script never signs or submits a transaction.
const fs = require('fs');
const crypto = require('crypto');
const {PublicKey} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');

const outputPath = `${__dirname}/kipseli-current-census.json`;
const binaryPath = `${__dirname}/kipseli-current.so`;
const envRow = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8')
  .split(/\r?\n/).find(line => /^\s*(?:export\s+)?SOLANA_RPC=/.test(line));
if (!envRow) throw new Error('SOLANA_RPC unavailable');
const endpoint = envRow.slice(envRow.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');

const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const POOL = '7yD7gfXv49SFxhx9uTc11dEd7Nj98rGWeYMdZJgheZbG';
const EXPECTED_PROGRAM = '3TK9D8aoBFYjYZtKCjciPrVrRStsnvo7KmpcJqDavpaU';
const USER = '331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth';
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);
let rpcId = 0;

async function rpc(method, params = []) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    if (response.ok && !body.error) return body.result;
    if (attempt === 4) throw new Error(`${method}: ${body.error?.message || response.status}`);
    await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
  }
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(30000)});
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${url}: ${body.error || response.status}`);
  return body;
}

function accountKeys(tx) {
  const staticKeys = tx.transaction.message.accountKeys.map(row =>
    typeof row === 'string' ? row : row.pubkey);
  return [
    ...staticKeys,
    ...(tx.meta?.loadedAddresses?.writable || []),
    ...(tx.meta?.loadedAddresses?.readonly || []),
  ];
}

function tokenDeltas(tx, keys) {
  const pre = new Map((tx.meta?.preTokenBalances || []).map(row => [row.accountIndex, row]));
  const post = new Map((tx.meta?.postTokenBalances || []).map(row => [row.accountIndex, row]));
  return [...new Set([...pre.keys(), ...post.keys()])].map(index => {
    const before = pre.get(index);
    const after = post.get(index);
    const row = after || before;
    const beforeRaw = BigInt(before?.uiTokenAmount?.amount || '0');
    const afterRaw = BigInt(after?.uiTokenAmount?.amount || '0');
    return {
      index,
      address: keys[index],
      mint: row.mint,
      tokenAuthority: row.owner || null,
      before: beforeRaw.toString(),
      after: afterRaw.toString(),
      delta: (afterRaw - beforeRaw).toString(),
    };
  }).filter(row => row.delta !== '0');
}

function summarizeAccount(address, account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const out = {
    address,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataBytes: data.length,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
  if (TOKEN_PROGRAMS.has(account.owner) && data.length >= 165) {
    out.mint = new PublicKey(data.subarray(0, 32)).toBase58();
    out.tokenAuthority = new PublicKey(data.subarray(32, 64)).toBase58();
    out.tokenAmount = data.readBigUInt64LE(64).toString();
  }
  return out;
}

async function main() {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') {
    throw new Error(`unexpected genesis ${genesis}`);
  }

  const quoteUrl = 'https://lite-api.jup.ag/swap/v1/quote?' + new URLSearchParams({
    inputMint: WSOL,
    outputMint: USDC,
    amount: '100000000000',
    slippageBps: '50',
    onlyDirectRoutes: 'true',
    dexes: 'Kipseli',
  });
  const quote = await jsonFetch(quoteUrl);
  if (quote.routePlan?.length !== 1 || quote.routePlan[0].swapInfo?.ammKey !== POOL ||
      quote.routePlan[0].swapInfo?.label !== 'Kipseli') {
    throw new Error('current quote did not resolve to the expected Kipseli pool');
  }

  const build = await jsonFetch('https://lite-api.jup.ag/swap/v1/swap-instructions', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: USER,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: false,
    }),
  });
  const swap = build.swapInstruction;
  const routeAddresses = [...new Set([
    swap.programId,
    ...swap.accounts.map(row => row.pubkey),
  ])];
  const routeAccountsResponse = await rpc('getMultipleAccounts', [routeAddresses, {
    encoding: 'base64',
    commitment: 'confirmed',
  }]);
  const routeAccounts = routeAddresses.map((address, index) =>
    summarizeAccount(address, routeAccountsResponse.value[index]));
  const poolAccount = routeAccounts.find(row => row?.address === POOL);
  if (!poolAccount || poolAccount.owner !== EXPECTED_PROGRAM) {
    throw new Error(`pool owner mismatch: ${poolAccount?.owner}`);
  }

  const programAccount = (await rpc('getAccountInfo', [EXPECTED_PROGRAM, {
    encoding: 'base64', commitment: 'confirmed',
  }])).value;
  const programSummary = summarizeAccount(EXPECTED_PROGRAM, programAccount);
  if (!programAccount?.executable || programSummary.owner !== 'BPFLoaderUpgradeab1e11111111111111111111111') {
    throw new Error('Kipseli owner is not an upgradeable executable');
  }
  const programBytes = Buffer.from(programAccount.data[0], 'base64');
  const programDataAddress = new PublicKey(programBytes.subarray(4, 36)).toBase58();
  const programDataAccount = (await rpc('getAccountInfo', [programDataAddress, {
    encoding: 'base64', commitment: 'confirmed',
  }])).value;
  const programData = Buffer.from(programDataAccount.data[0], 'base64');
  const elfOffset = programData.indexOf(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  if (elfOffset < 16 || elfOffset > 128) throw new Error('deployed ELF header not found');
  const executable = programData.subarray(elfOffset);
  fs.writeFileSync(binaryPath, executable);
  const programDataSummary = {
    ...summarizeAccount(programDataAddress, programDataAccount),
    lastDeploySlot: Number(programData.readBigUInt64LE(4)),
    upgradeAuthority: programData[12] === 1
      ? new PublicKey(programData.subarray(13, 45)).toBase58()
      : null,
    elfOffset,
    binaryBytes: executable.length,
    binarySha256: crypto.createHash('sha256').update(executable).digest('hex'),
  };

  const candidateTokenAccounts = routeAccounts.filter(row => row?.mint === WSOL || row?.mint === USDC);
  const signatures = await rpc('getSignaturesForAddress', [POOL, {limit: 60, commitment: 'confirmed'}]);
  const receipts = [];
  for (const row of signatures) {
    if (row.err) continue;
    const tx = await rpc('getTransaction', [row.signature, {
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 1,
      commitment: 'confirmed',
    }]);
    if (!tx) continue;
    const keys = accountKeys(tx);
    const deltas = tokenDeltas(tx, keys);
    const majorDeltas = deltas.filter(delta => delta.mint === WSOL || delta.mint === USDC);
    if (!majorDeltas.length) continue;
    const logs = tx.meta?.logMessages || [];
    if (!logs.some(line => line.includes(`Program ${EXPECTED_PROGRAM} invoke`))) continue;
    receipts.push({
      signature: row.signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      err: tx.meta?.err,
      feeLamports: tx.meta?.fee,
      majorTokenDeltas: majorDeltas,
      logs: logs.filter(line =>
        line.includes(EXPECTED_PROGRAM) || line.includes('Instruction: Transfer') || line.includes('failed:')),
    });
    if (receipts.length >= 5) break;
  }

  const out = {
    observedAt: new Date().toISOString(),
    network: 'mainnet-beta',
    genesis,
    slot: routeAccountsResponse.context.slot,
    correction: {
      suppliedAddress: 'FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n',
      suppliedAddressActualOwner: 'TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH',
      kipseliPool: POOL,
      reason: 'The supplied quote artifact labels FLck as TesseraV and 7yD7 as Kipseli.',
    },
    quote: {
      contextSlot: quote.contextSlot,
      updateContextSlot: quote.routePlan[0].swapInfo.updateContextSlot,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      priceImpactPct: quote.priceImpactPct,
      ammKey: POOL,
      label: quote.routePlan[0].swapInfo.label,
    },
    routeInstruction: {
      aggregatorProgram: swap.programId,
      wireDataBytes: Buffer.from(swap.data, 'base64').length,
      accountCount: swap.accounts.length,
      accounts: swap.accounts,
      lookupTables: build.addressLookupTableAddresses,
    },
    pool: poolAccount,
    executable: programSummary,
    programData: programDataSummary,
    candidateTokenAccounts,
    recentSignaturesListed: signatures.length,
    successfulValueMovingReceipts: receipts,
    safety: {readOnly: true, signed: false, broadcast: false},
  };
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({
    observedAt: out.observedAt,
    slot: out.slot,
    quote: out.quote,
    pool: out.pool,
    executable: out.executable,
    programData: out.programData,
    candidateTokenAccounts: out.candidateTokenAccounts,
    successfulValueMovingReceipts: out.successfulValueMovingReceipts.slice(0, 2),
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
