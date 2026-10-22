#!/usr/bin/env node
// Read-only snapshot of the current MOVEUSD controller, SPL mint/vault state,
// controller-owned accounts, and recent controller transactions. No transaction
// is constructed, signed, simulated, or submitted by this script.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MODULE_ROOT = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { PublicKey } = require(path.join(MODULE_ROOT, '@solana/web3.js'));
const bs58Module = require(path.join(MODULE_ROOT, 'bs58'));
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const PROGRAM_ID = 'EmiytJ3zWX9koH3emPsWDEs9RqNm6NNFp4CkMLoiA1KC';
const MOVEUSD_MINT = '3AdhVEX6k85yNivHVXDEiY3WyP2WgFQTUZCahGaeC2qm';
const CUSTODY_VAULT = '9LbzSsqxTyaa9dA9nVv7oBaZy85qJuAonX7wCuEaXoXX';
const CUSTODY_AUTHORITY = 'F42zAoH6HGZqrXroPWTXP9fHujFc2mLrycMgn3kJkMrr';
const OBSERVED_DESTINATION = 'BrFoeW3Fa7xiMoGUJSPpe2aCZRmN7L9RE7nSiR5fgmnW';
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const OUTPUT = path.join(DIR, 'moveusd-current-state.json');
const TX_OUTPUT = path.join(DIR, 'moveusd-recent-transactions.json');
const PROGRAM_OUTPUT = path.join(DIR, 'moveusd-current.so');

function loadEndpoint() {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  const envPath = '/tmp/composer-helius-rpc.env';
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^RPC_URL=(.*)$/);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  throw new Error('RPC_URL is unavailable');
}

const ENDPOINT = loadEndpoint();

let nextId = 1;
async function rpc(method, params) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function readPubkey(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function decodeUpgradeableProgram(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {
    exists: true,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: data.length,
    loaderStateTag: data.length >= 4 ? data.readUInt32LE(0) : null,
    programDataAddress: data.length >= 36 && data.readUInt32LE(0) === 2 ? readPubkey(data, 4) : null,
    dataBase64: account.data[0],
  };
}

function decodeProgramData(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const tag = data.length >= 4 ? data.readUInt32LE(0) : null;
  const hasAuthority = tag === 3 && data.length >= 13 && data[12] === 1;
  const metadataLength = hasAuthority ? 45 : 13;
  const payload = tag === 3 && data.length >= metadataLength ? data.subarray(metadataLength) : Buffer.alloc(0);
  let nonzeroLength = payload.length;
  while (nonzeroLength > 0 && payload[nonzeroLength - 1] === 0) nonzeroLength--;
  return {
    exists: true,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: data.length,
    loaderStateTag: tag,
    lastDeployedSlot: tag === 3 && data.length >= 12 ? Number(data.readBigUInt64LE(4)) : null,
    upgradeAuthority: hasAuthority ? readPubkey(data, 13) : null,
    metadataLength,
    payloadBytes: payload.length,
    payloadSha256: sha256(payload),
    nonzeroPayloadBytes: nonzeroLength,
    nonzeroPayloadSha256: sha256(payload.subarray(0, nonzeroLength)),
    payload,
  };
}

function decodeCOptionPubkey(data, optionOffset, keyOffset) {
  if (data.length < keyOffset + 32) return { option: null, address: null };
  const option = data.readUInt32LE(optionOffset);
  return { option, address: option === 1 ? readPubkey(data, keyOffset) : null };
}

function decodeMint(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const mintAuthority = decodeCOptionPubkey(data, 0, 4);
  const freezeAuthority = decodeCOptionPubkey(data, 46, 50);
  return {
    exists: true,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: data.length,
    mintAuthority: mintAuthority.address,
    mintAuthorityOption: mintAuthority.option,
    supplyRaw: data.length >= 44 ? data.readBigUInt64LE(36).toString() : null,
    decimals: data.length >= 45 ? data[44] : null,
    initialized: data.length >= 46 ? data[45] === 1 : null,
    freezeAuthority: freezeAuthority.address,
    freezeAuthorityOption: freezeAuthority.option,
    dataBase64: account.data[0],
  };
}

function decodeTokenAccount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {
    exists: true,
    ownerProgram: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: data.length,
    mint: data.length >= 32 ? readPubkey(data, 0) : null,
    tokenAuthority: data.length >= 64 ? readPubkey(data, 32) : null,
    amountRaw: data.length >= 72 ? data.readBigUInt64LE(64).toString() : null,
    state: data.length >= 109 ? data[108] : null,
    dataBase64: account.data[0],
  };
}

function summarizeGenericAccount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {
    exists: true,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: data.length,
    dataSha256: sha256(data),
    dataBase64: account.data[0],
  };
}

function normalizedPubkey(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.pubkey === 'string') return value.pubkey;
  return String(value);
}

function decodeInstructionData(value) {
  if (typeof value !== 'string') return null;
  try {
    const raw = Buffer.from(bs58.decode(value));
    return { base58: value, hex: raw.toString('hex'), byteLength: raw.length };
  } catch (_) {
    return { base58: value, hex: null, byteLength: null };
  }
}

function collectInstructions(transaction) {
  const message = transaction?.transaction?.message;
  const meta = transaction?.meta;
  if (!message) return [];
  const keys = (message.accountKeys || []).map(normalizedPubkey);
  const groups = [{ outerIndex: null, instructions: message.instructions || [] }];
  for (const group of meta?.innerInstructions || []) groups.push({ outerIndex: group.index, instructions: group.instructions || [] });
  const result = [];
  for (const group of groups) {
    for (const ix of group.instructions) {
      const programId = ix.programId || (Number.isInteger(ix.programIdIndex) ? keys[ix.programIdIndex] : null);
      const accountKeys = Array.isArray(ix.accounts)
        ? ix.accounts.map((item) => Number.isInteger(item) ? keys[item] : normalizedPubkey(item))
        : [];
      result.push({
        level: group.outerIndex === null ? 'outer' : 'inner',
        parentOuterIndex: group.outerIndex,
        program: ix.program || null,
        programId,
        accounts: accountKeys,
        data: decodeInstructionData(ix.data),
        parsed: ix.parsed || null,
        stackHeight: ix.stackHeight ?? null,
      });
    }
  }
  return result;
}

function summarizeTransaction(signature, tx) {
  const message = tx?.transaction?.message;
  const meta = tx?.meta;
  const keys = (message?.accountKeys || []).map((item) => ({
    pubkey: normalizedPubkey(item),
    signer: Boolean(item?.signer),
    writable: Boolean(item?.writable),
    source: item?.source || null,
  }));
  const instructions = collectInstructions(tx);
  return {
    signature,
    slot: tx?.slot ?? null,
    blockTime: tx?.blockTime ?? null,
    version: tx?.version ?? null,
    error: meta?.err ?? null,
    fee: meta?.fee ?? null,
    computeUnitsConsumed: meta?.computeUnitsConsumed ?? null,
    accountKeys: keys,
    controllerInstructions: instructions.filter((ix) => ix.programId === PROGRAM_ID),
    tokenInstructions: instructions.filter((ix) => ix.programId === TOKEN_PROGRAM),
    allInstructions: instructions,
    preTokenBalances: meta?.preTokenBalances || [],
    postTokenBalances: meta?.postTokenBalances || [],
    preBalances: meta?.preBalances || [],
    postBalances: meta?.postBalances || [],
    logMessages: meta?.logMessages || [],
    recentBlockhash: message?.recentBlockhash || null,
  };
}

async function getAccounts(addresses) {
  const result = await rpc('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized' }]);
  return { slot: result.context.slot, accounts: new Map(addresses.map((address, index) => [address, result.value[index]])) };
}

async function getProgramOwnedAccounts() {
  try {
    const result = await rpc('getProgramAccounts', [PROGRAM_ID, {
      encoding: 'base64',
      commitment: 'finalized',
      withContext: true,
    }]);
    const rows = Array.isArray(result) ? result : result.value;
    const slot = Array.isArray(result) ? null : result.context?.slot ?? null;
    return {
      status: 'ok',
      slot,
      count: rows.length,
      accounts: rows.map((row) => {
        const data = Buffer.from(row.account.data[0], 'base64');
        return {
          address: row.pubkey,
          owner: row.account.owner,
          executable: row.account.executable,
          lamports: row.account.lamports,
          dataLength: data.length,
          dataSha256: sha256(data),
          dataBase64: row.account.data[0],
        };
      }),
    };
  } catch (error) {
    return { status: 'error', error: error.message, slot: null, count: null, accounts: [] };
  }
}

async function deriveAnchorIdlAddress() {
  const program = new PublicKey(PROGRAM_ID);
  const [base] = PublicKey.findProgramAddressSync([], program);
  return (await PublicKey.createWithSeed(base, 'anchor:idl', program)).toBase58();
}

async function main() {
  const initial = await getAccounts([PROGRAM_ID]);
  const program = decodeUpgradeableProgram(initial.accounts.get(PROGRAM_ID));
  if (!program || program.owner !== UPGRADEABLE_LOADER || program.loaderStateTag !== 2 || !program.programDataAddress) {
    throw new Error('MOVEUSD controller is not the expected upgradeable-loader Program account');
  }

  const idlAddress = await deriveAnchorIdlAddress();
  const addresses = [
    PROGRAM_ID,
    program.programDataAddress,
    MOVEUSD_MINT,
    CUSTODY_VAULT,
    CUSTODY_AUTHORITY,
    OBSERVED_DESTINATION,
    idlAddress,
  ];
  const snapshot = await getAccounts(addresses);
  const programData = decodeProgramData(snapshot.accounts.get(program.programDataAddress));
  if (!programData || programData.loaderStateTag !== 3) throw new Error('invalid MOVEUSD ProgramData account');
  fs.writeFileSync(PROGRAM_OUTPUT, programData.payload);

  const programOwned = await getProgramOwnedAccounts();
  const signatures = await rpc('getSignaturesForAddress', [PROGRAM_ID, { limit: 100, commitment: 'finalized' }]);
  const inheritedEvidence = [
    '4LzzHMY8eCKiVCxb2258q9VbVa9XmsWpC3RZRaXzTUYkLNaxsPZjFjHX8gu2MnTrrrVdS5dZW5w2auQRf9Y5Drxq',
    '2aFBT5iRbidBUnxnxncJRvDH5NiSUQvJxBCSafM8eyyQZUUDNFFfh1okt5wb9USaJVmE3rRsFqk17Vd9TMK95NWf',
    '4Gq5YFZGDyXEaB4rdY8HP468iao8GtXN9EM6RrRbEcjrU2c8kqrgYpVWVEVj2rmDQB4cPMRMavQFm6EDfpmWa6S',
    '4ALFuBXUmLUYkxncvwLrWkTB3copj3Eg9AyLr5wPmProg65cyNzWsTRrXM6h8Hu7vt92pMQAsTsyvEkApqy7yfEW',
    'WPyEXrmUouDUsmhV9H6NEA4Tv1qoUM1edM98FCLn22MQmQcovGxJTe2cDjN6vrX2YsDVz3BU6fTeCVfZ5TjSXqp',
    '4fpKJRHG5tA3KtGZADtH7WMBeBqm4UERUEBoZnbwanfRcmN3M32Bj9cVE3VrkcAyqv6d22XN73TTAfr71vRTHv1u',
    '3gVxkrAimFauHNnwLQt2qkJmCfk15coRTMcDHouYBDvDCcWSptQM7v356cvi124xHwaUYyZm3UpLSf2e5jFuAN65',
    '33XdYDGyjCfAJkT1m4eqXhmzBUJkT3U6VC8GpWPiMs2wmHHZWxYp7sDWUh7Zr6yST9NtMNaAoNpfosWe3LYAbEn2',
    '3neAjRoekBD5FL7kASBnkofroSJ9aHZr6fWAXj2n71HWAJS8CzSjvbvMRJg92UVhy18pRSPkEiZvNHR1xJ4CXz11',
    'k8wPpdLYwXYq53ci9My8c4dMAPi6mHTwDa8FCwsXADZCxcEwuniEHcYkyMVeMm63JfQJFdHLDJ8sgajpS1DemaT',
  ];
  const selectedSignatures = [...new Set([
    ...signatures.slice(0, 60).map((row) => row.signature),
    ...inheritedEvidence,
  ])];
  const transactions = [];
  for (let offset = 0; offset < selectedSignatures.length; offset += 10) {
    const batch = selectedSignatures.slice(offset, offset + 10);
    const results = await Promise.all(batch.map((signature) => rpc('getTransaction', [signature, {
      encoding: 'jsonParsed',
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    }]).catch((error) => ({ fetchError: error.message }))));
    for (let index = 0; index < batch.length; index++) {
      const result = results[index];
      transactions.push(result?.fetchError
        ? { signature: batch[index], fetchError: result.fetchError }
        : summarizeTransaction(batch[index], result));
    }
  }

  const mint = decodeMint(snapshot.accounts.get(MOVEUSD_MINT));
  const vault = decodeTokenAccount(snapshot.accounts.get(CUSTODY_VAULT));
  const destination = decodeTokenAccount(snapshot.accounts.get(OBSERVED_DESTINATION));
  const controllerPdaChecks = {
    mintIsOffCurve: !PublicKey.isOnCurve(new PublicKey(MOVEUSD_MINT).toBytes()),
    custodyAuthorityIsOffCurve: !PublicKey.isOnCurve(new PublicKey(CUSTODY_AUTHORITY).toBytes()),
  };

  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    noTransactionConstructedOrSubmitted: true,
    observationSlot: snapshot.slot,
    identities: {
      programId: PROGRAM_ID,
      programDataAddress: program.programDataAddress,
      moveusdMint: MOVEUSD_MINT,
      custodyVault: CUSTODY_VAULT,
      custodyAuthority: CUSTODY_AUTHORITY,
      observedDestination: OBSERVED_DESTINATION,
      anchorIdlAddress: idlAddress,
    },
    program: decodeUpgradeableProgram(snapshot.accounts.get(PROGRAM_ID)),
    programData: { ...programData, payload: undefined },
    programBinary: {
      path: path.basename(PROGRAM_OUTPUT),
      bytes: programData.payloadBytes,
      sha256: programData.payloadSha256,
      nonzeroBytes: programData.nonzeroPayloadBytes,
      nonzeroSha256: programData.nonzeroPayloadSha256,
    },
    mint,
    custodyVault: vault,
    observedDestination: destination,
    custodyAuthorityAccount: summarizeGenericAccount(snapshot.accounts.get(CUSTODY_AUTHORITY)),
    anchorIdlAccount: summarizeGenericAccount(snapshot.accounts.get(idlAddress)),
    controllerPdaChecks,
    invariants: {
      mintOwnedBySplTokenProgram: mint?.owner === TOKEN_PROGRAM,
      mintAuthorityEqualsMintAddress: mint?.mintAuthority === MOVEUSD_MINT,
      freezeAuthorityEqualsMintAddress: mint?.freezeAuthority === MOVEUSD_MINT,
      vaultMintMatchesMoveusd: vault?.mint === MOVEUSD_MINT,
      vaultAuthorityMatchesObservedControllerPda: vault?.tokenAuthority === CUSTODY_AUTHORITY,
      destinationMintMatchesMoveusd: destination?.mint === MOVEUSD_MINT,
    },
    programOwnedAccounts: programOwned,
    recentSignatureCount: signatures.length,
    recentSignatures: signatures,
    transactionCorpus: {
      path: path.basename(TX_OUTPUT),
      requested: selectedSignatures.length,
      fetched: transactions.filter((row) => !row.fetchError).length,
      failedFetches: transactions.filter((row) => row.fetchError).length,
    },
  };

  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(TX_OUTPUT, `${JSON.stringify({
    generatedAt: output.generatedAt,
    programId: PROGRAM_ID,
    requestedSignatures: selectedSignatures,
    transactions,
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    observationSlot: output.observationSlot,
    lastDeployedSlot: output.programData.lastDeployedSlot,
    upgradeAuthority: output.programData.upgradeAuthority,
    programBinary: output.programBinary,
    mintAuthority: output.mint.mintAuthority,
    freezeAuthority: output.mint.freezeAuthority,
    supplyRaw: output.mint.supplyRaw,
    custodyRaw: output.custodyVault.amountRaw,
    programOwnedAccounts: output.programOwnedAccounts.count,
    transactionsFetched: output.transactionCorpus.fetched,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
