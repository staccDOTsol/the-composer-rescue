#!/usr/bin/env node
// Read-only current-mainnet probes for the verified MetaDAO token migrator.
// Builds real v1 wire transactions and calls simulateTransaction only.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const {encodeV1} = require('./klend-v1-composition.js');

const DIR = __dirname;
const PROGRAM = new PublicKey('gr8tqq2ripsM6N46gLWpSDXtdrH6J9jaXoyya1ELC9t');
const VAULT = new PublicKey('4viadAyxnRpHyW2g2NEzjLwGGgLTQK2QBmniJJqXWpXN');
const EXPECTED_FROM = new PublicKey('METADDFL6wWMWEoKTFJwcThTbUmtarRJZjRpzUvkxhr');
const EXPECTED_TO = new PublicKey('METAwkXcqyXKy1AtsSgJ8JiUHwGCafnZL38n3vYmeta');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const conn = new Connection(rpcUrl, 'confirmed');

const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const key = data => new PublicKey(data).toBase58();
const rawU64 = n => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(n));
  return out;
};

function decodeVault(data) {
  if (!data || data.length < 99 || data[0] !== 1) throw new Error('Unexpected Vault layout');
  const tag = data[97];
  let strategy;
  let bumpOffset;
  if (tag === 0) {
    strategy = {proRata: {}};
    bumpOffset = 98;
  } else if (tag === 1) {
    strategy = {fixed: {e: data.readInt8(98)}};
    bumpOffset = 99;
  } else if (tag === 2) {
    strategy = {ratio: {
      numerator: data.readBigUInt64LE(98).toString(),
      denominator: data.readBigUInt64LE(106).toString(),
    }};
    bumpOffset = 114;
  } else {
    throw new Error(`Unknown strategy tag ${tag}`);
  }
  if (data.length <= bumpOffset) throw new Error('Vault bump missing');
  return {
    discriminator: data[0],
    admin: key(data.subarray(1, 33)),
    mintFrom: key(data.subarray(33, 65)),
    mintTo: key(data.subarray(65, 97)),
    strategy,
    bump: data[bumpOffset],
    dataLength: data.length,
    sha256: hash(data),
    dataBase64: data.toString('base64'),
  };
}

function decodeAccount(address, info) {
  if (!info) return {address, exists: false};
  const base = {
    address,
    exists: true,
    owner: info.owner.toBase58(),
    lamports: info.lamports,
    executable: info.executable,
    dataLength: info.data.length,
    sha256: hash(info.data),
  };
  if (info.owner.equals(TOKEN_PROGRAM_ID) && info.data.length >= 165) {
    return {...base, kind: 'tokenAccount', mint: key(info.data.subarray(0, 32)),
      tokenAuthority: key(info.data.subarray(32, 64)),
      rawAmount: info.data.readBigUInt64LE(64).toString()};
  }
  if (info.owner.equals(TOKEN_PROGRAM_ID) && info.data.length >= 82) {
    return {...base, kind: 'mint', supplyRaw: info.data.readBigUInt64LE(36).toString(),
      decimals: info.data[44]};
  }
  if (address === VAULT.toBase58()) return {...base, kind: 'vault', ...decodeVault(info.data)};
  return {...base, kind: 'opaque'};
}

function migrateIx(user, userFrom, userTo, vault, vaultFrom, vaultTo, mintFrom, mintTo, amount) {
  const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PROGRAM);
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      {pubkey: user, isSigner: true, isWritable: true},
      {pubkey: mintFrom, isSigner: false, isWritable: false},
      {pubkey: mintTo, isSigner: false, isWritable: false},
      {pubkey: userFrom, isSigner: false, isWritable: true},
      {pubkey: userTo, isSigner: false, isWritable: true},
      {pubkey: vaultFrom, isSigner: false, isWritable: true},
      {pubkey: vaultTo, isSigner: false, isWritable: true},
      {pubkey: vault, isSigner: false, isWritable: false},
      {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
      {pubkey: eventAuthority, isSigner: false, isWritable: false},
      {pubkey: PROGRAM, isSigner: false, isWritable: false},
    ],
    data: Buffer.concat([Buffer.from([0]), rawU64(amount)]),
  });
}

function messageMetadata(instructions, payer, blockhash) {
  const msg = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (msg.addressTableLookups.length) throw new Error('Probe unexpectedly used address tables');
  const h = msg.header;
  const accounts = msg.staticAccountKeys.map((pubkey, index) => ({
    index,
    pubkey: pubkey.toBase58(),
    signer: index < h.numRequiredSignatures,
    writable: index < h.numRequiredSignatures ?
      index < h.numRequiredSignatures - h.numReadonlySignedAccounts :
      index < msg.staticAccountKeys.length - h.numReadonlyUnsignedAccounts,
  }));
  return {header: h, accounts};
}

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: method, method, params})});
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  return json.result;
}

async function findFundedUser(mintFrom, mintTo, excludedAccounts) {
  const largest = await conn.getTokenLargestAccounts(mintFrom, 'confirmed');
  const candidates = [];
  for (const row of largest.value) {
    if (excludedAccounts.has(row.address.toBase58()) || BigInt(row.amount) === 0n) continue;
    const info = await conn.getAccountInfo(row.address, 'confirmed');
    if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length < 165) continue;
    const owner = new PublicKey(info.data.subarray(32, 64));
    if (!PublicKey.isOnCurve(owner.toBytes())) continue;
    const ownerInfo = await conn.getAccountInfo(owner, 'confirmed');
    if (!ownerInfo || ownerInfo.lamports < 2_100_000) continue;
    const destination = getAssociatedTokenAddressSync(mintTo, owner, false, TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID);
    const destinationInfo = await conn.getAccountInfo(destination, 'confirmed');
    candidates.push({source: row.address, owner, amountRaw: BigInt(row.amount), ownerLamports: ownerInfo.lamports,
      destination, destinationExists: Boolean(destinationInfo)});
  }
  if (!candidates.length) throw new Error('No on-curve funded current holder found');
  candidates.sort((a, b) => a.amountRaw > b.amountRaw ? -1 : a.amountRaw < b.amountRaw ? 1 : 0);
  // Prefer an already-initialized destination so simulateTransaction can return
  // exact pre/post balances for both sides of the migration.
  return {selected: candidates.find(x => x.destinationExists) || candidates[0], candidates};
}

async function simulate(label, instructions, payer, blockhash, watched, preDecoded) {
  const encoded = encodeV1(instructions, payer, blockhash);
  const meta = messageMetadata(instructions, payer, blockhash);
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
    commitment: 'confirmed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(x => x.toBase58())},
  }]);
  const value = result.value;
  const post = Object.fromEntries(watched.map((address, i) => {
    const raw = value.accounts?.[i];
    const info = raw ? {owner: new PublicKey(raw.owner), lamports: raw.lamports,
      executable: raw.executable, data: Buffer.from(raw.data[0], 'base64')} : null;
    return [address.toBase58(), decodeAccount(address.toBase58(), info)];
  }));
  const tokenDeltas = {};
  for (const address of watched.map(x => x.toBase58())) {
    const before = preDecoded[address]?.rawAmount;
    const after = post[address]?.rawAmount;
    if (before !== undefined || after !== undefined) {
      tokenDeltas[address] = before !== undefined && after !== undefined ?
        (BigInt(after) - BigInt(before)).toString() : null;
    }
  }
  return {
    label,
    slot: result.context?.slot,
    err: value.err || null,
    unitsConsumed: value.unitsConsumed,
    loadedAccountsDataSize: value.loadedAccountsDataSize,
    returnData: value.returnData || null,
    message: {
      wireVersion: 1,
      sizeBytes: encoded.sizeBytes,
      v0EquivalentBytes: encoded.v0Bytes,
      sha256: hash(encoded.wire),
      base64: encoded.wire.toString('base64'),
      addressCount: encoded.addressCount,
      writableCount: encoded.writableCount,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      config: encoded.config,
      header: meta.header,
      accounts: meta.accounts,
    },
    post,
    tokenDeltas,
    innerInstructions: value.innerInstructions || null,
    logs: value.logs || [],
  };
}

async function main() {
  const vaultInfo = await conn.getAccountInfoAndContext(VAULT, 'confirmed');
  const decoded = decodeVault(vaultInfo.value.data);
  const mintFrom = new PublicKey(decoded.mintFrom);
  const mintTo = new PublicKey(decoded.mintTo);
  if (!mintFrom.equals(EXPECTED_FROM) || !mintTo.equals(EXPECTED_TO))
    throw new Error('Live vault mint binding changed');
  const admin = new PublicKey(decoded.admin);
  const [derivedVault, derivedBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), admin.toBuffer(), mintFrom.toBuffer(), mintTo.toBuffer()], PROGRAM);
  const vaultFrom = getAssociatedTokenAddressSync(mintFrom, VAULT, true, TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID);
  const vaultTo = getAssociatedTokenAddressSync(mintTo, VAULT, true, TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID);
  const fixedAddresses = [PROGRAM, VAULT, mintFrom, mintTo, vaultFrom, vaultTo];
  const fixedInfos = await conn.getMultipleAccountsInfoAndContext(fixedAddresses, 'confirmed');
  const fixedSnapshot = Object.fromEntries(fixedAddresses.map((address, i) =>
    [address.toBase58(), decodeAccount(address.toBase58(), fixedInfos.value[i])]));
  const selectedResult = await findFundedUser(mintFrom, mintTo,
    new Set([vaultFrom.toBase58(), vaultTo.toBase58()]));
  const selected = selectedResult.selected;
  const userAddresses = [selected.owner, selected.source, selected.destination];
  const userInfos = await conn.getMultipleAccountsInfoAndContext(userAddresses, 'confirmed');
  const preSnapshot = {...fixedSnapshot, ...Object.fromEntries(userAddresses.map((address, i) =>
    [address.toBase58(), decodeAccount(address.toBase58(), userInfos.value[i])]))};
  const watched = [selected.source, selected.destination, vaultFrom, vaultTo, mintFrom, mintTo, VAULT];
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const ataIx = selected.destinationExists ? [] : [createAssociatedTokenAccountIdempotentInstruction(
    selected.owner, selected.destination, selected.owner, mintTo, TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID)];
  const make = (amount, overrides = {}) => migrateIx(
    selected.owner,
    overrides.userFrom || selected.source,
    overrides.userTo || selected.destination,
    overrides.vault || VAULT,
    overrides.vaultFrom || vaultFrom,
    overrides.vaultTo || vaultTo,
    overrides.mintFrom || mintFrom,
    overrides.mintTo || mintTo,
    amount,
  );
  const largestTo = await conn.getTokenLargestAccounts(mintTo, 'confirmed');
  let foreignTo = null;
  for (const row of largestTo.value) {
    const info = await conn.getAccountInfo(row.address, 'confirmed');
    if (!info || info.data.length < 165) continue;
    const authority = new PublicKey(info.data.subarray(32, 64));
    if (!authority.equals(selected.owner) && !row.address.equals(vaultTo)) {
      foreignTo = row.address;
      break;
    }
  }
  const largestFrom = await conn.getTokenLargestAccounts(mintFrom, 'confirmed');
  const foreignFrom = largestFrom.value.map(x => x.address).find(x =>
    !x.equals(selected.source) && !x.equals(vaultFrom));
  const programStates = await conn.getProgramAccounts(PROGRAM, {commitment: 'confirmed',
    filters: [{memcmp: {offset: 0, bytes: '2'}}]});
  const wrongVaultState = programStates.map(x => x.pubkey).find(x => !x.equals(VAULT));
  const vaultOut = BigInt(fixedSnapshot[vaultTo.toBase58()].rawAmount);
  const cases = [
    ['positive_smallest_nonzero', [...ataIx, make(1n)]],
    ['zero_amount', [...ataIx, make(0n)]],
    ['repeat_two_smallest_same_accounts', [...ataIx, make(1n), make(1n)]],
    ['holder_full_balance', [...ataIx, make(selected.amountRaw)]],
    ['user_to_aliases_vault_to', [...ataIx, make(1n, {userTo: vaultTo})]],
    ['vault_accounts_swapped', [...ataIx, make(1n, {vaultFrom: vaultTo, vaultTo: vaultFrom})]],
  ];
  if (foreignTo) cases.push(['foreign_destination_owner', [...ataIx, make(1n, {userTo: foreignTo})]]);
  if (foreignFrom) cases.push(['foreign_source_owner', [...ataIx, make(1n, {userFrom: foreignFrom})]]);
  if (wrongVaultState) cases.push(['foreign_program_state', [...ataIx, make(1n, {vault: wrongVaultState})]]);
  if (selected.amountRaw >= vaultOut - 1n) {
    cases.push(['vault_available_minus_one', [...ataIx, make(vaultOut - 1n)]]);
    cases.push(['vault_available_exact', [...ataIx, make(vaultOut)]]);
    cases.push(['vault_available_plus_one', [...ataIx, make(vaultOut + 1n)]]);
  }
  const simulations = [];
  for (const [label, instructions] of cases) {
    try {
      const result = await simulate(label, instructions, selected.owner, blockhash, watched, preSnapshot);
      simulations.push(result);
      console.log(JSON.stringify({label, err: result.err, units: result.unitsConsumed,
        bytes: result.message.sizeBytes, addresses: result.message.addressCount,
        tokenDeltas: result.tokenDeltas}));
    } catch (error) {
      simulations.push({label, localError: error.stack || error.message});
      console.log(JSON.stringify({label, localError: error.message}));
    }
  }
  const output = {
    generatedAt: new Date().toISOString(),
    liveSubmission: false,
    signerVerification: false,
    sourceCommit: '6b736cf65eb2296faf1f0af9bce0976715a6ba58',
    verifiedExecutableHash: '32519bcaafee0c8146846a96c6f430812fe826a0c9f0a1e44674f49f8682342e',
    observationSlots: {vault: vaultInfo.context.slot, fixed: fixedInfos.context.slot,
      user: userInfos.context.slot},
    binding: {
      program: PROGRAM.toBase58(),
      vault: VAULT.toBase58(),
      decoded,
      derivedVault: derivedVault.toBase58(),
      derivedBump,
      pdaMatches: derivedVault.equals(VAULT) && derivedBump === decoded.bump,
      vaultFrom: vaultFrom.toBase58(),
      vaultTo: vaultTo.toBase58(),
      fixedSnapshot,
    },
    fundedUser: {
      owner: selected.owner.toBase58(), source: selected.source.toBase58(),
      destination: selected.destination.toBase58(), amountRaw: selected.amountRaw.toString(),
      ownerLamports: selected.ownerLamports, destinationExists: selected.destinationExists,
      candidates: selectedResult.candidates.map(x => ({owner: x.owner.toBase58(),
        source: x.source.toBase58(), destination: x.destination.toBase58(),
        amountRaw: x.amountRaw.toString(), ownerLamports: x.ownerLamports,
        destinationExists: x.destinationExists})),
    },
    preSnapshot,
    skippedEdges: selected.amountRaw < vaultOut - 1n ? [{
      edge: 'direct vault available +/- 1',
      reason: 'No selected on-curve current holder had enough source-token balance',
      selectedRaw: selected.amountRaw.toString(), vaultOutputRaw: vaultOut.toString(),
    }] : [],
    simulations,
  };
  fs.writeFileSync(`${DIR}/gr8t-current-probes.json`, `${JSON.stringify(output, null, 2)}\n`);
}

main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
