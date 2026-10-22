#!/usr/bin/env node
'use strict';

// Signed mainnet-beta simulation only. Compares the current Kipseli swap with
// an atomic raw-lamport donation + SyncNative to the pool WSOL vault.
// Never sends a transaction and never serializes secret key material to output.
const fs = require('fs');
const {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {createSyncNativeInstruction} = require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const bs58Module = require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const outputPath = process.env.KIPSELI_FORK_RPC
  ? `${__dirname}/kipseli-donation-fork.json`
  : `${__dirname}/kipseli-donation-sim.json`;
const composerPath = `${__dirname}/kipseli-composer-learn.json`;
const envRow = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8')
  .split(/\r?\n/).find(line => /^\s*(?:export\s+)?SOLANA_RPC=/.test(line));
if (!envRow) throw new Error('SOLANA_RPC unavailable');
const mainnetEndpoint = envRow.slice(envRow.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
const endpoint = process.env.KIPSELI_FORK_RPC || mainnetEndpoint;
const isFork = Boolean(process.env.KIPSELI_FORK_RPC);
const signer = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'))));

const pk = value => new PublicKey(value);
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const POOL = '7yD7gfXv49SFxhx9uTc11dEd7Nj98rGWeYMdZJgheZbG';
const PROGRAM = '3TK9D8aoBFYjYZtKCjciPrVrRStsnvo7KmpcJqDavpaU';
const WSOL_VAULT = 'HgFLBWQugxt6qbPaWiwXjrqauXdQmcpMV6H6t8ttD8s1';
const USDC_VAULT = 'FzvRbXDdrsYVMa9KohXyQytWNAZAo4PsF8yujDH7KCfG';
const USER_USDC = 'BgfAes9oQmYS6sa2LefzNwdkAA1mwTq9iDZxVDhaxKDZ';
const DONATION_LAMPORTS = 1_000_000;
const TEST_INPUT_LAMPORTS = 5_000_000;
const trackedAddresses = [signer.publicKey.toBase58(), USER_USDC, WSOL_VAULT, USDC_VAULT];
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
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {...options, signal: AbortSignal.timeout(120000)});
    const body = await response.json();
    if (response.ok && !body.error) return body;
    if (attempt === 4) throw new Error(`${url}: ${body.error || response.status}`);
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
}

function fromJupiter(row) {
  return new TransactionInstruction({
    programId: pk(row.programId),
    keys: row.accounts.map(account => ({
      pubkey: pk(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(row.data, 'base64'),
  });
}

function tokenAmount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function snapshot(accounts) {
  return {
    walletLamports: accounts[0]?.lamports ?? null,
    walletUsdcRaw: tokenAmount(accounts[1]),
    poolWsolLamports: accounts[2]?.lamports ?? null,
    poolWsolRaw: tokenAmount(accounts[2]),
    poolUsdcRaw: tokenAmount(accounts[3]),
  };
}

function delta(after, before, field) {
  if (after[field] === null || before[field] === null) return null;
  return (BigInt(after[field]) - BigInt(before[field])).toString();
}

function reconcile(before, after, feeLamports) {
  const walletLamports = delta(after, before, 'walletLamports');
  const walletUsdcRaw = delta(after, before, 'walletUsdcRaw');
  const poolWsolLamports = delta(after, before, 'poolWsolLamports');
  const poolWsolRaw = delta(after, before, 'poolWsolRaw');
  const poolUsdcRaw = delta(after, before, 'poolUsdcRaw');
  const partial = {
    walletLamports,
    walletUsdcRaw,
    poolWsolLamports,
    poolWsolRaw,
    poolUsdcRaw,
  };
  if ([walletLamports, walletUsdcRaw, poolWsolLamports, poolWsolRaw, poolUsdcRaw]
      .some(value => value === null)) return partial;
  return {
    ...partial,
    poolWsolRecordedAmountMinusLamportDelta:
      (BigInt(poolWsolRaw) - BigInt(poolWsolLamports)).toString(),
    combinedSolLamportEquityDelta:
      (BigInt(walletLamports) + BigInt(poolWsolLamports)).toString(),
    combinedUsdcRawDelta: (BigInt(walletUsdcRaw) + BigInt(poolUsdcRaw)).toString(),
    expectedCombinedSolRawDeltaFromFee: feeLamports === null ? null : (-BigInt(feeLamports)).toString(),
  };
}

async function quote(inputMint, outputMint, amount, extra = {}) {
  const url = 'https://lite-api.jup.ag/swap/v1/quote?' + new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amount),
    slippageBps: '50',
    onlyDirectRoutes: 'true',
    ...extra,
  });
  return jsonFetch(url);
}

async function main() {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') {
    throw new Error(`unexpected genesis ${genesis}`);
  }
  if (signer.publicKey.toBase58() !== '331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth') {
    throw new Error('unexpected test signer');
  }
  if (isFork) {
    await rpc('surfnet_setAccount', [signer.publicKey.toBase58(), {
      data: '', executable: false, lamports: 10_000_000_000,
      owner: '11111111111111111111111111111111', rentEpoch: 0,
    }]);
  }

  // Composer is queried only after the material-custody and outsider-callable gates.
  const composer = await jsonFetch(`https://the-composer-svc.fly.dev/learn/${PROGRAM}?limit=150`);
  fs.writeFileSync(composerPath, JSON.stringify(composer, null, 2) + '\n');
  const learnedSwap = composer.instructions.find(ix =>
    Buffer.from(ix.discriminator).toString('hex') === 'f0e02621b01ff1af');
  if (!learnedSwap || learnedSwap.accounts.length !== 15) {
    throw new Error('Composer did not recover expected current swap_v3 shape');
  }
  const holdoutFloorSlot = await rpc('getSlot', [{commitment: 'confirmed'}]);

  const testQuote = await quote(WSOL, USDC, TEST_INPUT_LAMPORTS, {dexes: 'Kipseli'});
  if (testQuote.routePlan?.length !== 1 || testQuote.routePlan[0].swapInfo?.ammKey !== POOL) {
    throw new Error('0.1 WSOL quote did not resolve to the expected Kipseli pool');
  }
  const build = await jsonFetch('https://lite-api.jup.ag/swap/v1/swap-instructions', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      quoteResponse: testQuote,
      userPublicKey: signer.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: false,
    }),
  });
  const lookupResponse = await rpc('getMultipleAccounts', [build.addressLookupTableAddresses, {
    encoding: 'base64', commitment: 'confirmed',
  }]);
  const lookups = build.addressLookupTableAddresses.map((address, index) =>
    new AddressLookupTableAccount({
      key: pk(address),
      state: AddressLookupTableAccount.deserialize(
        Buffer.from(lookupResponse.value[index].data[0], 'base64')),
    }));
  const preResponse = await rpc('getMultipleAccounts', [trackedAddresses, {
    encoding: 'base64', commitment: 'confirmed',
  }]);
  const pre = snapshot(preResponse.value);
  if (pre.walletLamports < TEST_INPUT_LAMPORTS + DONATION_LAMPORTS + 3_000_000) {
    throw new Error('test wallet has insufficient balance for signed simulations');
  }

  const latest = await rpc('getLatestBlockhash', [{commitment: 'confirmed'}]);
  const shared = [
    ...(build.computeBudgetInstructions || []).map(fromJupiter),
    ...(build.setupInstructions || []).map(fromJupiter),
  ];
  const tail = [
    fromJupiter(build.swapInstruction),
    ...(build.cleanupInstruction ? [fromJupiter(build.cleanupInstruction)] : []),
  ];
  const cases = [];
  for (const donated of [false, true]) {
    const manipulation = donated ? [
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: pk(WSOL_VAULT),
        lamports: DONATION_LAMPORTS,
      }),
      createSyncNativeInstruction(pk(WSOL_VAULT)),
    ] : [];
    const message = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: latest.value.blockhash,
      instructions: [...shared, ...manipulation, ...tail],
    }).compileToV0Message(lookups);
    const transaction = new VersionedTransaction(message);
    transaction.sign([signer]);
    const wire = transaction.serialize();
    const accountKeys = message.staticAccountKeys.length + message.addressTableLookups.reduce(
      (count, table) => count + table.writableIndexes.length + table.readonlyIndexes.length, 0);
    if (wire.length > 4096 || accountKeys > 64) throw new Error('v1 transaction envelope exceeded');
    const feeResponse = await rpc('getFeeForMessage', [
      Buffer.from(message.serialize()).toString('base64'),
      {commitment: 'confirmed'},
    ]);
    const simulation = await rpc('simulateTransaction', [
      Buffer.from(wire).toString('base64'),
      {
        encoding: 'base64',
        sigVerify: true,
        replaceRecentBlockhash: false,
        commitment: 'confirmed',
        accounts: {encoding: 'base64', addresses: trackedAddresses},
      },
    ]);
    const post = snapshot(simulation.value.accounts || []);
    const feeLamports = feeResponse.value;
    cases.push({
      donated,
      donationLamports: donated ? DONATION_LAMPORTS : 0,
      slot: simulation.context.slot,
      err: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed,
      feeLamports,
      wireBytes: wire.length,
      accountKeys,
      pre,
      post,
      reconciliation: reconcile(pre, post, feeLamports),
      logs: (simulation.value.logs || []).filter(line =>
        line.includes(PROGRAM) || line.includes('Instruction: SyncNative') ||
        line.includes('Instruction: Transfer') || line.includes('failed:')),
    });
  }

  // Economic exit screen: Kipseli first leg, then a direct venue excluding both
  // Kipseli and the explicitly out-of-scope TesseraV program.
  let independentExit;
  const priorMainnetPath = `${__dirname}/kipseli-donation-sim.json`;
  if (isFork && fs.existsSync(priorMainnetPath)) {
    independentExit = JSON.parse(fs.readFileSync(priorMainnetPath, 'utf8')).independentExit;
    independentExit = {...independentExit, reusedFromMainnetArtifact: 'kipseli-donation-sim.json'};
  } else {
    const largeFirst = await quote(WSOL, USDC, 100_000_000_000n, {dexes: 'Kipseli'});
    if (largeFirst.routePlan?.[0]?.swapInfo?.ammKey !== POOL) {
      throw new Error('100 WSOL first leg changed away from Kipseli');
    }
    const independent = await quote(USDC, WSOL, largeFirst.outAmount, {
      excludeDexes: 'Kipseli,TesseraV',
    });
    const independentRoute = independent.routePlan || [];
    if (!independentRoute.length || independentRoute.some(row =>
        row.swapInfo?.label === 'Kipseli' || row.swapInfo?.label === 'TesseraV' ||
        row.swapInfo?.ammKey === POOL ||
        row.swapInfo?.ammKey === 'FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n')) {
      throw new Error('independent exit is absent or reused an excluded venue');
    }
    const preFeeNetLamports = BigInt(independent.outAmount) - 100_000_000_000n;
    const conservativeFeeLamports = 2n * BigInt(Math.max(...cases.map(row => row.feeLamports || 5000)));
    independentExit = {
      method: 'time-separated ExactIn quotes; second leg excludes Kipseli and TesseraV',
      first: {
        contextSlot: largeFirst.contextSlot,
        inAmount: largeFirst.inAmount,
        outAmount: largeFirst.outAmount,
        route: largeFirst.routePlan.map(row => ({
          ammKey: row.swapInfo.ammKey, label: row.swapInfo.label, percent: row.percent,
        })),
      },
      second: {
        contextSlot: independent.contextSlot,
        inAmount: independent.inAmount,
        outAmount: independent.outAmount,
        route: independentRoute.map(row => ({
          ammKey: row.swapInfo.ammKey, label: row.swapInfo.label, percent: row.percent,
        })),
      },
      preFeeNetLamports: preFeeNetLamports.toString(),
      conservativeTwoTransactionFeeLamports: conservativeFeeLamports.toString(),
      feeAdjustedNetLamports: (preFeeNetLamports - conservativeFeeLamports).toString(),
      lender: null,
      lenderRepayment: 'not applicable: this bounded control is self-funded and does not claim a flash route',
      atomicExecutionClaim: false,
    };
  }

  // Wait briefly for one post-learn receipt and validate Composer's selector and
  // positional constants against a transaction not used to seed this run.
  let heldOut = null;
  for (let attempt = 0; !isFork && attempt < 8 && !heldOut; attempt++) {
    const rows = await rpc('getSignaturesForAddress', [PROGRAM, {limit: 40, commitment: 'confirmed'}]);
    for (const row of rows.filter(item => !item.err && item.slot > holdoutFloorSlot)) {
      const tx = await rpc('getTransaction', [row.signature, {
        encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed',
      }]);
      if (!tx) continue;
      const keys = tx.transaction.message.accountKeys.map(key =>
        typeof key === 'string' ? key : key.pubkey);
      const candidates = (tx.meta?.innerInstructions || []).flatMap(group =>
        group.instructions.map((ix, index) => ({...ix, source: `inner:${group.index}:${index}`})))
        .concat(tx.transaction.message.instructions.map((ix, index) => ({...ix, source: `top:${index}`})))
        .filter(ix => ix.programId === PROGRAM);
      for (const ix of candidates) {
        const data = ix.data ? bs58.decode(ix.data) : null;
        const discriminatorHex = data ? Buffer.from(data).subarray(0, 8).toString('hex') : null;
        if (discriminatorHex !== 'f0e02621b01ff1af' || ix.accounts.length !== 15) continue;
        const positions = ix.accounts.map(address =>
          typeof address === 'number' ? keys[address] : address);
        heldOut = {
          signature: row.signature,
          slot: row.slot,
          source: ix.source,
          discriminatorHex,
          accountCount: positions.length,
          constantsMatch: {
            pool: positions[1] === POOL,
            wsolVault: positions[2] === WSOL_VAULT,
            usdcVault: positions[3] === USDC_VAULT,
            wsolMint: positions[4] === WSOL,
            usdcMint: positions[5] === USDC,
            tokenProgram: positions[8] === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            systemProgram: positions[9] === '11111111111111111111111111111111',
            sysvarInstructions: positions[14] === 'Sysvar1nstructions1111111111111111111111111',
          },
        };
        break;
      }
      if (heldOut) break;
    }
    if (!heldOut) await new Promise(resolve => setTimeout(resolve, 2000));
  }

  const control = cases.find(row => !row.donated);
  const donation = cases.find(row => row.donated);
  const outputDifferenceRaw = donation.reconciliation.walletUsdcRaw === null ||
    control.reconciliation.walletUsdcRaw === null ? null :
    BigInt(donation.reconciliation.walletUsdcRaw) - BigInt(control.reconciliation.walletUsdcRaw);
  const out = {
    observedAt: new Date().toISOString(),
    network: isFork ? 'local current-mainnet-backed Surfpool fork' : 'mainnet-beta',
    genesis,
    program: PROGRAM,
    pool: POOL,
    testWallet: signer.publicKey.toBase58(),
    method: 'signed simulateTransaction only; sigVerify=true; no broadcast',
    composer: {
      endpoint: `/learn/${PROGRAM}?limit=150`,
      evidence: composer.evidence,
      recoveredSwapName: learnedSwap.name,
      recoveredSwapNameSource: learnedSwap.nameSource,
      discriminatorHex: Buffer.from(learnedSwap.discriminator).toString('hex'),
      accountCount: learnedSwap.accounts.length,
      holdoutFloorSlot,
      heldOut,
    },
    quote: {
      contextSlot: testQuote.contextSlot,
      inAmount: testQuote.inAmount,
      outAmount: testQuote.outAmount,
      otherAmountThreshold: testQuote.otherAmountThreshold,
    },
    manipulation: {
      type: 'raw WSOL-vault lamport donation followed by SyncNative before swap',
      donationLamports: DONATION_LAMPORTS,
      cases,
      outputDifferenceRaw: outputDifferenceRaw === null ? null : outputDifferenceRaw.toString(),
      priceSensitiveToDonation: outputDifferenceRaw === null ? null : outputDifferenceRaw !== 0n,
    },
    independentExit,
    safety: {mainnetSubmission: false, localFork: isFork, secretMaterialPersisted: false},
  };
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({
    observedAt: out.observedAt,
    composer: out.composer,
    quote: out.quote,
    manipulation: {
      type: out.manipulation.type,
      outputDifferenceRaw: out.manipulation.outputDifferenceRaw,
      priceSensitiveToDonation: out.manipulation.priceSensitiveToDonation,
      cases: out.manipulation.cases.map(row => ({
        donated: row.donated,
        err: row.err,
        feeLamports: row.feeLamports,
        wireBytes: row.wireBytes,
        accountKeys: row.accountKeys,
        reconciliation: row.reconciliation,
      })),
    },
    independentExit: out.independentExit,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
