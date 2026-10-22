#!/usr/bin/env node

// Read-only mainnet evidence probe. This script only calls get* and
// simulateTransaction RPC methods; it never signs or submits a transaction.
const fs = require('fs');
const crypto = require('crypto');
const bs58Module = require('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/kliquidity-sdk-official/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const MARGINFI = 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA';
const DAMM_V2 = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
function configuredRpc() {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  const envPath = '/tmp/composer-helius-only.env';
  if (!fs.existsSync(envPath)) return null;
  const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split('\n').filter(Boolean)
    .map((line) => line.split(/=(.*)/s).slice(0, 2)));
  return env.HEAVY_RPC_URL || env.RPC_URL || null;
}
const rpcUrl = configuredRpc();
const outputPath = process.env.OUTPUT_PATH;
const maxSignatures = Number(process.env.MAX_SIGNATURES || 3000);
const concurrency = Number(process.env.CONCURRENCY || 12);
const sourceSignature = process.env.SOURCE_SIGNATURE;
const findBorrowMint = process.env.FIND_BORROW_MINT;
const simulateSource = process.env.SIMULATE_SOURCE === '1';
const scanAddress = process.env.SCAN_ADDRESS || DAMM_V2;
const otherProgram = scanAddress === MARGINFI ? DAMM_V2 : MARGINFI;

if (!rpcUrl) throw new Error('RPC_URL is required');
if (!outputPath) throw new Error('OUTPUT_PATH is required');

let rpcId = 0;
async function rpc(method, params, retries = 4) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    });
    const body = response.ok ? await response.json() : null;
    if (response.ok && body && !body.error) return body.result;
    if (attempt >= retries) {
      throw new Error(`${method}: ${body?.error ? JSON.stringify(body.error) : `HTTP ${response.status}`}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
  }
}

function instructionNames(logs) {
  return (logs || []).flatMap((line) => {
    const match = /^Program log: Instruction: (.+)$/.exec(line);
    return match ? [match[1]] : [];
  });
}

function accountKeys(tx) {
  const message = tx.transaction.message;
  return [
    ...(message.accountKeys || []),
    ...(tx.meta?.loadedAddresses?.writable || []),
    ...(tx.meta?.loadedAddresses?.readonly || []),
  ].map((value) => typeof value === 'string' ? value : value.pubkey);
}

function tokenDeltas(tx) {
  const keys = accountKeys(tx);
  const before = new Map((tx.meta?.preTokenBalances || []).map((row) => [row.accountIndex, row]));
  const after = new Map((tx.meta?.postTokenBalances || []).map((row) => [row.accountIndex, row]));
  return [...new Set([...before.keys(), ...after.keys()])].map((accountIndex) => {
    const pre = before.get(accountIndex);
    const post = after.get(accountIndex);
    return {
      account: keys[accountIndex],
      mint: post?.mint || pre?.mint,
      owner: post?.owner || pre?.owner || null,
      rawDelta: (BigInt(post?.uiTokenAmount?.amount || 0) - BigInt(pre?.uiTokenAmount?.amount || 0)).toString(),
    };
  }).filter((row) => row.rawDelta !== '0');
}

function discriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex');
}

const KNOWN_MARGINFI = new Map([
  'lending_account_start_flashloan',
  'lending_account_end_flashloan',
  'lending_account_borrow',
  'lending_account_repay',
  'lending_account_withdraw',
].map((name) => [discriminator(name), name]));

function instructionRows(tx) {
  const keys = accountKeys(tx);
  const message = tx.transaction.message;
  const header = message.header;
  const staticLength = message.accountKeys.length;
  const writableLoaded = tx.meta?.loadedAddresses?.writable?.length || 0;
  const isSigner = (index) => index < header.numRequiredSignatures;
  const isWritable = (index) => {
    if (index < header.numRequiredSignatures) {
      return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
    }
    if (index < staticLength) return index < staticLength - header.numReadonlyUnsignedAccounts;
    return index < staticLength + writableLoaded;
  };
  return (message.instructions || []).map((ix, index) => {
    const data = Buffer.from(bs58.decode(ix.data));
    return {
      index,
      programId: keys[ix.programIdIndex],
      marginfiName: keys[ix.programIdIndex] === MARGINFI ? (KNOWN_MARGINFI.get(data.subarray(0, 8).toString('hex')) || null) : null,
      dataBase58: ix.data,
      dataHex: data.toString('hex'),
      accounts: ix.accounts.map((accountIndex) => ({
        pubkey: keys[accountIndex],
        isSigner: isSigner(accountIndex),
        isWritable: isWritable(accountIndex),
      })),
    };
  });
}

function innerInstructionRows(tx) {
  const keys = accountKeys(tx);
  return (tx.meta?.innerInstructions || []).flatMap((group) =>
    (group.instructions || []).map((ix, innerIndex) => {
      const data = Buffer.from(bs58.decode(ix.data));
      return {
        parentIndex: group.index,
        innerIndex,
        stackHeight: ix.stackHeight ?? null,
        programId: keys[ix.programIdIndex],
        dataBase58: ix.data,
        dataHex: data.toString('hex'),
        accounts: ix.accounts.map((accountIndex) => keys[accountIndex]),
      };
    }));
}

function compactAccount(value) {
  if (!value) return null;
  const data = Buffer.from(value.data[0], 'base64');
  const result = {
    owner: value.owner,
    lamports: value.lamports,
    dataLength: data.length,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
  if ((value.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
       value.owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') && data.length >= 72) {
    result.tokenMint = bs58.encode(data.subarray(0, 32));
    result.tokenAuthority = bs58.encode(data.subarray(32, 64));
    result.tokenAmount = data.readBigUInt64LE(64).toString();
  }
  if (value.owner === DAMM_V2 && data.length === 1112) {
    result.dammPool = {
      protocolAFee: data.readBigUInt64LE(392).toString(),
      protocolBFee: data.readBigUInt64LE(400).toString(),
      totalProtocolAFee: data.readBigUInt64LE(600).toString(),
      totalProtocolBFee: data.readBigUInt64LE(608).toString(),
      tokenAAmount: data.readBigUInt64LE(680).toString(),
      tokenBAmount: data.readBigUInt64LE(688).toString(),
      layoutVersion: data[696],
    };
  }
  return result;
}

async function main() {
  if (sourceSignature) {
    const [tx, base64] = await Promise.all([
      rpc('getTransaction', [sourceSignature, {encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed'}]),
      rpc('getTransaction', [sourceSignature, {encoding: 'base64', maxSupportedTransactionVersion: 1, commitment: 'confirmed'}]),
    ]);
    if (!tx?.meta || tx.meta.err) throw new Error('source transaction unavailable or failed');
    const keys = accountKeys(tx);
    const topRows = instructionRows(tx);
    const innerRows = innerInstructionRows(tx);
    const result = {
      generatedAt: new Date().toISOString(),
      rpcMode: 'getTransaction only; no sendTransaction',
      signature: sourceSignature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      version: tx.version,
      feePayer: keys[0],
      wireBytes: Buffer.from(base64.transaction[0], 'base64').length,
      accountCount: keys.length,
      staticAccountCount: tx.transaction.message.accountKeys.length,
      lookupTableCount: tx.transaction.message.addressTableLookups?.length || 0,
      instructions: topRows,
      innerInstructions: innerRows,
      instructionNames: instructionNames(tx.meta.logMessages),
      unitsConsumed: tx.meta.computeUnitsConsumed ?? null,
      tokenDeltas: tokenDeltas(tx),
    };
    if (simulateSource) {
      const trackedAddresses = [...new Set(topRows.flatMap((ix) =>
        ix.accounts.filter((account) => account.isWritable).map((account) => account.pubkey)))];
      const preResult = await rpc('getMultipleAccounts', [trackedAddresses, {encoding: 'base64', commitment: 'confirmed'}]);
      const simulation = await rpc('simulateTransaction', [base64.transaction[0], {
        encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
        commitment: 'confirmed', innerInstructions: true,
        accounts: {encoding: 'base64', addresses: trackedAddresses},
      }]);
      result.currentReplay = {
        contextSlot: simulation.context.slot,
        signerVerification: false,
        submitted: false,
        err: simulation.value.err,
        unitsConsumed: simulation.value.unitsConsumed ?? null,
        loadedAccountsDataSize: simulation.value.loadedAccountsDataSize ?? null,
        trackedAccounts: trackedAddresses.map((address, index) => ({
          address,
          before: compactAccount(preResult.value[index]),
          after: compactAccount(simulation.value.accounts?.[index]),
        })),
        logs: simulation.value.logs || [],
      };
    }
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({outputPath, signature: sourceSignature, wireBytes: result.wireBytes,
      accountCount: result.accountCount, instructions: result.instructions.map(({index, programId, marginfiName}) => ({index, programId, marginfiName}))}, null, 2)}\n`);
    return;
  }
  if (findBorrowMint) {
    const signatures = [];
    let before;
    while (signatures.length < maxSignatures) {
      const limit = Math.min(1000, maxSignatures - signatures.length);
      const page = await rpc('getSignaturesForAddress', [MARGINFI, {limit, ...(before ? {before} : {})}]);
      if (!page.length) break;
      signatures.push(...page.filter((row) => !row.err));
      before = page.at(-1).signature;
      if (page.length < limit) break;
    }
    const matches = [];
    for (let offset = 0; offset < signatures.length; offset += concurrency) {
      const batch = signatures.slice(offset, offset + concurrency);
      const transactions = await Promise.all(batch.map(async (row) => ({row, tx: await rpc('getTransaction', [row.signature, {
        encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed',
      }])})));
      for (const {row, tx} of transactions) {
        if (!tx?.meta || tx.meta.err) continue;
        const keys = accountKeys(tx);
        const names = instructionNames(tx.meta.logMessages);
        if (!names.includes('LendingAccountStartFlashloan') || !names.includes('LendingAccountBorrow') ||
            !names.includes('LendingAccountEndFlashloan')) continue;
        const mintByIndex = new Map([
          ...(tx.meta.preTokenBalances || []).map((value) => [value.accountIndex, value.mint]),
          ...(tx.meta.postTokenBalances || []).map((value) => [value.accountIndex, value.mint]),
        ]);
        const borrowDiscriminator = discriminator('lending_account_borrow');
        const borrowIxs = (tx.transaction.message.instructions || []).filter((ix) =>
          keys[ix.programIdIndex] === MARGINFI && Buffer.from(bs58.decode(ix.data)).subarray(0, 8).toString('hex') === borrowDiscriminator);
        for (const ix of borrowIxs) {
          const destinationIndex = ix.accounts[4];
          const mint = mintByIndex.get(destinationIndex) || null;
          if (mint !== findBorrowMint) continue;
          matches.push({
            signature: row.signature,
            slot: row.slot,
            blockTime: row.blockTime,
            version: tx.version,
            feePayer: keys[0],
            accountCount: keys.length,
            borrowDestination: keys[destinationIndex],
            mint,
            instructions: names,
            unitsConsumed: tx.meta.computeUnitsConsumed ?? null,
            tokenDeltas: tokenDeltas(tx),
          });
        }
      }
      if (matches.length >= 8) break;
    }
    const result = {generatedAt: new Date().toISOString(), rpcMode: 'get* only; no sendTransaction',
      targetMint: findBorrowMint, signaturesScanned: signatures.length, matches};
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({outputPath, signaturesScanned: signatures.length, matches}, null, 2)}\n`);
    return;
  }
  const signatures = [];
  let before;
  while (signatures.length < maxSignatures) {
    const limit = Math.min(1000, maxSignatures - signatures.length);
    const page = await rpc('getSignaturesForAddress', [scanAddress, {limit, ...(before ? {before} : {})}]);
    if (!page.length) break;
    signatures.push(...page.filter((row) => !row.err));
    before = page.at(-1).signature;
    if (page.length < limit) break;
  }

  const matches = [];
  for (let offset = 0; offset < signatures.length; offset += concurrency) {
    const batch = signatures.slice(offset, offset + concurrency);
    const transactions = await Promise.all(batch.map(async (row) => ({
      row,
      tx: await rpc('getTransaction', [row.signature, {
        encoding: 'json',
        maxSupportedTransactionVersion: 1,
        commitment: 'confirmed',
      }]),
    })));
    for (const {row, tx} of transactions) {
      if (!tx?.meta || tx.meta.err) continue;
      const keys = accountKeys(tx);
      if (!keys.includes(otherProgram)) continue;
      matches.push({
        signature: row.signature,
        slot: row.slot,
        blockTime: row.blockTime,
        version: tx.version,
        feePayer: keys[0],
        accountCount: keys.length,
        instructions: instructionNames(tx.meta.logMessages),
        unitsConsumed: tx.meta.computeUnitsConsumed ?? null,
        tokenDeltas: tokenDeltas(tx),
      });
    }
    if (matches.length >= 8) break;
  }

  const result = {
    generatedAt: new Date().toISOString(),
    rpcMode: 'getSignaturesForAddress/getTransaction only; no sendTransaction',
    programs: {marginfi: MARGINFI, dammV2: DAMM_V2},
    signaturesScanned: signatures.length,
    matches,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({outputPath, signaturesScanned: signatures.length, matches}, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
