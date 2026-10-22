#!/usr/bin/env node

// Read-only xORCA/Project0 Solana v1 simulation harness.
// Mainnet is queried with get* and simulateTransaction only. Nothing is sent.
// The local fork is used only for fresh attacker-owned accounts and signed
// simulations; protocol custody accounts are imported unchanged from mainnet.
const fs = require('fs');
const crypto = require('crypto');

const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require(modules + '@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} = require(modules + '@solana/spl-token');
const {encodeV1} = require('./klend-v1-composition.js');

const DIR = __dirname;
const OUTPUT = `${DIR}/orca-xorca-v1-simulations.json`;
const LIVE = JSON.parse(fs.readFileSync(`${DIR}/orca-xorca-live-revalidation.json`, 'utf8'));
const KLEND_CENSUS = JSON.parse(fs.readFileSync(`${DIR}/klend-zero-fee-census.json`, 'utf8'));
const ROUNDTRIP = JSON.parse(fs.readFileSync(`${DIR}/orca-xorca-roundtrip-economics.json`, 'utf8'));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const upstreamUrls = [...new Set([env.RPC_URL, env.HEAVY_RPC_URL].filter(Boolean))];
if (!upstreamUrls.length) throw new Error('No read-only RPC configured');
const connection = new Connection(upstreamUrls[0], 'confirmed');
const forkUrl = 'http://127.0.0.1:9007';

const P = (value) => new PublicKey(value);
const PROGRAM = P('StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT');
const STATE = P('CSqKhyW1cpdyjheAx5HXx4ibcnYrzpL5JywEMAkZixBK');
const VAULT = P('Ce5j11WAsSzM3nkzrw4Kw6v6ic3nbyqpv5eywjYKeKc5');
const ORCA = P('orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE');
const XORCA = P('xorcaYqbXUNz3474ubUMJAdu2xgPsew3rUCe5ughT3N');
const PROJECT0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const P0_GROUP = P(LIVE.project0.group);
const P0_BANK = P(LIVE.project0.bank);
const P0_VAULT = P(LIVE.project0.liquidityVault);
const P0_VAULT_AUTHORITY = P(LIVE.project0.derivedLiquidityVaultAuthority);
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const SOURCE_SIGNATURE = '3ok9CzX7U7oAkgaqUxLx6zhjCC4sMe6EeqKQRNnwMMw4TteVFCAvxf7g9kGtQbNM6m4B9FN7x4MxXGFLuxFt7D8i';
const P0_ACCOUNT = P('93rXRLxa3nJ6WkEbsxHCPS6doffoVf4yXb8hxWaphPsw');
const P0_AUTHORITY = P('3zdXwWm9GVGzSBmYEtWGBgP9E2A95TbUz7ccGavWMPL8');

const P0_DISCS = {
  start: Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]),
  borrow: Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]),
  repay: Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]),
  end: Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]),
};

function fromJupiter(ix) {
  return new TransactionInstruction({
    programId: P(ix.programId),
    keys: ix.accounts.map((account) => ({pubkey: P(account.pubkey),
      isSigner: account.isSigner, isWritable: account.isWritable})),
    data: Buffer.from(ix.data, 'base64'),
  });
}

async function jupiterXorcaExit(user, destinationTokenAccount, amount) {
  const url = new URL('https://lite-api.jup.ag/swap/v1/quote');
  url.searchParams.set('inputMint', XORCA.toString());
  url.searchParams.set('outputMint', ORCA.toString());
  url.searchParams.set('amount', BigInt(amount).toString());
  url.searchParams.set('swapMode', 'ExactIn');
  url.searchParams.set('slippageBps', '100');
  url.searchParams.set('restrictIntermediateTokens', 'true');
  url.searchParams.set('onlyDirectRoutes', 'true');
  url.searchParams.set('maxAccounts', '32');
  const quoteResponse = await fetch(url).then(async (response) => {
    const body = await response.json();
    if (!response.ok || !body.outAmount) throw new Error(`Jupiter quote failed: ${JSON.stringify(body)}`);
    return body;
  });
  const response = await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({quoteResponse, userPublicKey: user.toString(),
      destinationTokenAccount: destinationTokenAccount.toString(),
      wrapAndUnwrapSol: false, useSharedAccounts: false,
      dynamicComputeUnitLimit: false, skipUserAccountsRpcCalls: true}),
  });
  const body = await response.json();
  if (!response.ok || body.error || !body.swapInstruction) {
    throw new Error(`Jupiter swap-instructions failed: ${JSON.stringify(body)}`);
  }
  return {
    instructions: [...(body.setupInstructions || []).map(fromJupiter),
      fromJupiter(body.swapInstruction), ...(body.cleanupInstruction ? [fromJupiter(body.cleanupInstruction)] : [])],
    quote: {inAmount: quoteResponse.inAmount, outAmount: quoteResponse.outAmount,
      otherAmountThreshold: quoteResponse.otherAmountThreshold,
      priceImpactPct: quoteResponse.priceImpactPct,
      contextSlot: quoteResponse.contextSlot,
      routePlan: quoteResponse.routePlan.map((step) => ({label: step.swapInfo?.label,
        ammKey: step.swapInfo?.ammKey, inAmount: step.swapInfo?.inAmount,
        outAmount: step.swapInfo?.outAmount}))},
    addressLookupTableAddresses: body.addressLookupTableAddresses || [],
  };
}

let rpcId = 0;
async function rpcAt(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function rpcUpstream(method, params) {
  const errors = [];
  for (const url of upstreamUrls) {
    try {
      const value = await rpcAt(url, method, params);
      if (value !== null && value !== undefined) return value;
      errors.push('null result');
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(`${method} unavailable from configured RPCs: ${errors.join(' | ')}`);
}

const rpcFork = (method, params) => rpcAt(forkUrl, method, params);
const u64 = (value) => {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(BigInt(value));
  return data;
};
const cloneIx = (ix) => new TransactionInstruction({
  programId: ix.programId,
  keys: ix.keys.map((key) => ({...key})),
  data: Buffer.from(ix.data),
});
const instruction = (programId, keys, data) => new TransactionInstruction({
  programId,
  keys,
  data,
});

function findIx(instructions, discriminator) {
  const found = instructions.find((ix) => ix.programId.equals(PROJECT0) &&
    Buffer.from(ix.data).subarray(0, 8).equals(discriminator));
  if (!found) throw new Error(`Project0 template instruction not found: ${discriminator.toString('hex')}`);
  return cloneIx(found);
}

async function fetchP0Templates() {
  const fetched = await rpcUpstream('getTransaction', [SOURCE_SIGNATURE, {
    encoding: 'base64',
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 1,
  }]);
  const tx = VersionedTransaction.deserialize(Buffer.from(fetched.transaction[0], 'base64'));
  const tables = await Promise.all(tx.message.addressTableLookups.map(async ({accountKey}) => {
    const result = await connection.getAddressLookupTable(accountKey);
    if (!result.value) throw new Error(`missing address table ${accountKey}`);
    return result.value;
  }));
  const decompiled = TransactionMessage.decompile(tx.message, {addressLookupTableAccounts: tables});
  return {
    sourceSlot: fetched.slot,
    start: findIx(decompiled.instructions, P0_DISCS.start),
    borrow: findIx(decompiled.instructions, P0_DISCS.borrow),
    repay: findIx(decompiled.instructions, P0_DISCS.repay),
    end: findIx(decompiled.instructions, P0_DISCS.end),
  };
}

function p0Builders(templates, account, authority, destination) {
  const start = (endIndex) => {
    const ix = cloneIx(templates.start);
    ix.keys[0].pubkey = account;
    ix.keys[1].pubkey = authority;
    ix.keys[2].pubkey = IX_SYSVAR;
    ix.data = Buffer.concat([P0_DISCS.start, u64(endIndex)]);
    return ix;
  };
  const borrow = (amount) => {
    const ix = cloneIx(templates.borrow);
    if (ix.keys.length < 10) throw new Error('Project0 borrow template has too few accounts');
    const replacements = [P0_GROUP, account, authority, P0_BANK, destination,
      P0_VAULT_AUTHORITY, P0_VAULT, TOKEN_PROGRAM_ID, P0_BANK, SystemProgram.programId];
    replacements.forEach((pubkey, index) => { ix.keys[index].pubkey = pubkey; });
    ix.data = Buffer.concat([P0_DISCS.borrow, u64(amount)]);
    return ix;
  };
  const repay = (amount) => {
    const ix = cloneIx(templates.repay);
    if (ix.keys.length < 7) throw new Error('Project0 repay template has too few accounts');
    const replacements = [P0_GROUP, account, authority, P0_BANK, destination,
      P0_VAULT, TOKEN_PROGRAM_ID];
    replacements.forEach((pubkey, index) => { ix.keys[index].pubkey = pubkey; });
    ix.data = Buffer.concat([P0_DISCS.repay, u64(amount), Buffer.from([1, 1])]);
    return ix;
  };
  const end = () => {
    const ix = cloneIx(templates.end);
    ix.keys[0].pubkey = account;
    ix.keys[1].pubkey = P0_GROUP;
    ix.keys[2].pubkey = authority;
    for (let index = 3; index < ix.keys.length; index += 1) {
      ix.keys[index].pubkey = SystemProgram.programId;
    }
    ix.data = P0_DISCS.end;
    return ix;
  };
  return {start, borrow, repay, end};
}

const stakeIx = (authority, orcaToken, xorcaToken, amount, vault = VAULT,
  tokenProgram = TOKEN_PROGRAM_ID) => instruction(PROGRAM, [
  {pubkey: authority, isSigner: true, isWritable: true},
  {pubkey: vault, isSigner: false, isWritable: true},
  {pubkey: orcaToken, isSigner: false, isWritable: true},
  {pubkey: xorcaToken, isSigner: false, isWritable: true},
  {pubkey: XORCA, isSigner: false, isWritable: true},
  {pubkey: STATE, isSigner: false, isWritable: false},
  {pubkey: ORCA, isSigner: false, isWritable: false},
  {pubkey: tokenProgram, isSigner: false, isWritable: false},
], Buffer.concat([Buffer.from([0]), u64(amount)]));

const unstakeIx = (authority, xorcaToken, pending, shares, index, vault = VAULT) =>
  instruction(PROGRAM, [
    {pubkey: authority, isSigner: true, isWritable: true},
    {pubkey: STATE, isSigner: false, isWritable: true},
    {pubkey: pending, isSigner: false, isWritable: true},
    {pubkey: xorcaToken, isSigner: false, isWritable: true},
    {pubkey: XORCA, isSigner: false, isWritable: true},
    {pubkey: ORCA, isSigner: false, isWritable: false},
    {pubkey: vault, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
  ], Buffer.concat([Buffer.from([1]), u64(shares), Buffer.from([index])]));

const withdrawIx = (authority, orcaToken, pending, index, vault = VAULT) =>
  instruction(PROGRAM, [
    {pubkey: authority, isSigner: true, isWritable: true},
    {pubkey: STATE, isSigner: false, isWritable: true},
    {pubkey: pending, isSigner: false, isWritable: true},
    {pubkey: orcaToken, isSigner: false, isWritable: true},
    {pubkey: vault, isSigner: false, isWritable: true},
    {pubkey: ORCA, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
  ], Buffer.from([2, index]));

const pendingAddress = (authority, index) => PublicKey.findProgramAddressSync([
  Buffer.from('pending_withdraw'), authority.toBuffer(), Buffer.from([index]),
], PROGRAM)[0];

const liveAssets = BigInt(LIVE.currentAccounts.nonEscrowedOrcaRaw);
const liveSupply = BigInt(LIVE.currentAccounts.xorcaMint.supplyRaw);
const virtual = 100n;
const mintedFor = (stake, assets = liveAssets, supply = liveSupply) =>
  BigInt(stake) * (BigInt(supply) + virtual) / (BigInt(assets) + virtual);
const claimFor = (shares, assets = liveAssets, supply = liveSupply) =>
  BigInt(shares) * (BigInt(assets) + virtual) / (BigInt(supply) + virtual);

function dataBuffer(account) {
  if (!account?.data) return null;
  if (Buffer.isBuffer(account.data)) return account.data;
  return Buffer.from(account.data[0], 'base64');
}

function accountImage(address, account) {
  if (!account) return null;
  const data = dataBuffer(account);
  const owner = account.owner instanceof PublicKey ? account.owner.toString() : account.owner;
  const row = {
    address: address.toString(),
    owner,
    lamports: account.lamports,
    dataLength: data?.length ?? 0,
    dataSha256: data ? crypto.createHash('sha256').update(data).digest('hex') : null,
  };
  if (!data) return row;
  if (address.equals(XORCA) && data.length >= 82) {
    row.mint = {supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44]};
  } else if (owner === TOKEN_PROGRAM_ID.toString() && data.length >= 165) {
    row.token = {
      mint: new PublicKey(data.subarray(0, 32)).toString(),
      authority: new PublicKey(data.subarray(32, 64)).toString(),
      amountRaw: data.readBigUInt64LE(64).toString(),
      state: data[108],
    };
  } else if (address.equals(STATE) && data.length >= 56) {
    row.xorcaState = {
      discriminator: data[0],
      bump: data[6],
      vaultBump: data[7],
      escrowedOrcaRaw: data.readBigUInt64LE(8).toString(),
      coolDownSeconds: data.readBigInt64LE(16).toString(),
      updateAuthority: new PublicKey(data.subarray(24, 56)).toString(),
    };
  } else if (owner === PROGRAM.toString() && data.length === 1024) {
    row.pendingWithdraw = {
      discriminator: data[0],
      bump: data[6],
      withdrawIndex: data[7],
      unstaker: new PublicKey(data.subarray(8, 40)).toString(),
      claimRaw: data.readBigUInt64LE(40).toString(),
      withdrawableTimestamp: data.readBigInt64LE(48).toString(),
    };
  }
  return row;
}

function compactLogs(logs) {
  return (logs || []).filter((line) => line.includes('Instruction:') ||
    line.includes('Error') || line.includes('failed') || line.includes('success') ||
    line.includes('consumed'));
}

function signerFor(keypair) {
  return crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
}

function signV1(encoded, instructions, payer, blockhash, keypairs) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const signerOrder = compiled.staticAccountKeys
    .slice(0, encoded.requiredSignatures).map(String);
  const keyMap = new Map(keypairs.map((keypair) => [keypair.publicKey.toString(), keypair]));
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  signerOrder.forEach((address, index) => {
    const keypair = keyMap.get(address);
    if (!keypair) throw new Error(`uncontrolled signer ${address}`);
    crypto.sign(null, message, signerFor(keypair))
      .copy(signed, signed.length - 64 * encoded.requiredSignatures + index * 64);
  });
  return {signed, signerOrder};
}

async function upstreamPreImage(addresses) {
  const result = await connection.getMultipleAccountsInfoAndContext(addresses, 'confirmed');
  return {
    slot: result.context.slot,
    rows: result.value.map((account, index) => accountImage(addresses[index], account)),
  };
}

async function simulateMainnet(name, instructions, payer, watched, blockhash, metadata = {}) {
  const encoded = encodeV1(instructions, payer, blockhash);
  const pre = await upstreamPreImage(watched);
  const result = await rpcUpstream('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64',
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  const value = result.value;
  return {
    name,
    environment: 'current-mainnet simulateTransaction',
    liveSubmission: false,
    signatureVerification: false,
    preSlot: pre.slot,
    simulationSlot: result.context?.slot ?? null,
    metadata,
    wire: {
      version: 1,
      bytes: encoded.sizeBytes,
      addressCount: encoded.addressCount,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      sha256: crypto.createHash('sha256').update(encoded.wire).digest('hex'),
      base64: encoded.wire.toString('base64'),
    },
    err: value?.err ?? null,
    unitsConsumed: value?.unitsConsumed ?? null,
    loadedAccountsDataSize: value?.loadedAccountsDataSize ?? null,
    watched: watched.map(String),
    pre: pre.rows,
    post: watched.map((address, index) => accountImage(address, value?.accounts?.[index])),
    logs: value?.logs || null,
    trace: compactLogs(value?.logs),
    innerInstructions: value?.innerInstructions || null,
  };
}

function tokenAccountData(mint, authority, amount) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data[108] = 1;
  return data;
}

async function setForkAccount(address, owner, lamports, data) {
  await rpcFork('surfnet_setAccount', [address.toString(), {
    data: data.toString('hex'),
    executable: false,
    lamports,
    owner: owner.toString(),
    rentEpoch: 0,
  }]);
}

async function forkPreImage(addresses) {
  const result = await rpcFork('getMultipleAccounts', [addresses.map(String), {
    encoding: 'base64', commitment: 'processed',
  }]);
  return {
    slot: result.context.slot,
    rows: result.value.map((account, index) => accountImage(addresses[index], account)),
  };
}

function outsiderEquity(rows, addresses, fallbackRows = []) {
  const byAddress = new Map(rows.filter(Boolean).map((row) => [row.address, row]));
  const fallbackByAddress = new Map(fallbackRows.filter(Boolean).map((row) => [row.address, row]));
  const image = (address) => byAddress.get(address.toString()) ||
    fallbackByAddress.get(address.toString());
  const orca = BigInt(image(addresses.orcaToken)?.token?.amountRaw || 0);
  const xorca = BigInt(image(addresses.xorcaToken)?.token?.amountRaw || 0);
  const pending = BigInt(image(addresses.pending)
    ?.pendingWithdraw?.claimRaw || 0);
  const vault = BigInt(image(VAULT)?.token?.amountRaw ||
    LIVE.currentAccounts.vault.amountRaw);
  const escrow = BigInt(image(STATE)?.xorcaState?.escrowedOrcaRaw ||
    LIVE.currentAccounts.state.escrowedOrcaRaw);
  const supply = BigInt(image(XORCA)?.mint?.supplyRaw ||
    LIVE.currentAccounts.xorcaMint.supplyRaw);
  const nonEscrowed = vault - escrow;
  const xorcaAsOrca = claimFor(xorca, nonEscrowed, supply);
  return {
    liquidOrcaRaw: orca.toString(),
    xorcaRaw: xorca.toString(),
    xorcaMarkedAsOrcaRaw: xorcaAsOrca.toString(),
    pendingClaimOrcaRaw: pending.toString(),
    totalOrcaEquivalentRaw: (orca + xorcaAsOrca + pending).toString(),
  };
}

async function simulateFork(name, instructions, payerKeypair, watched, blockhash,
  equityAddresses, metadata = {}, additionalSigners = []) {
  const encoded = encodeV1(instructions, payerKeypair.publicKey, blockhash);
  const {signed, signerOrder} = signV1(encoded, instructions, payerKeypair.publicKey,
    blockhash, [payerKeypair, ...additionalSigners]);
  const pre = await forkPreImage(watched);
  const result = await rpcFork('simulateTransaction', [signed.toString('base64'), {
    encoding: 'base64',
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: 'processed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  const value = result.value;
  const postRows = watched.map((address, index) => accountImage(address, value?.accounts?.[index]));
  const preEquity = outsiderEquity(pre.rows, equityAddresses);
  const postEquity = value?.err ? preEquity : outsiderEquity(postRows, equityAddresses, pre.rows);
  return {
    name,
    environment: 'local fork of current mainnet accounts',
    liveSubmission: false,
    signatureVerification: true,
    forkProtocolMutation: false,
    syntheticMutation: 'fresh attacker system/token accounts only',
    preSlot: pre.slot,
    simulationSlot: result.context?.slot ?? null,
    metadata,
    wire: {
      version: 1,
      bytes: encoded.sizeBytes,
      addressCount: encoded.addressCount,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      signerOrder,
      sha256: crypto.createHash('sha256').update(signed).digest('hex'),
      signedBase64: signed.toString('base64'),
    },
    err: value?.err ?? null,
    unitsConsumed: value?.unitsConsumed ?? null,
    loadedAccountsDataSize: value?.loadedAccountsDataSize ?? null,
    watched: watched.map(String),
    pre: pre.rows,
    post: postRows,
    outsiderEquity: {
      pre: preEquity,
      post: postEquity,
      deltaOrcaEquivalentRaw: (BigInt(postEquity.totalOrcaEquivalentRaw) -
        BigInt(preEquity.totalOrcaEquivalentRaw)).toString(),
    },
    logs: value?.logs || null,
    trace: compactLogs(value?.logs),
    innerInstructions: value?.innerInstructions || null,
  };
}

async function findUnusedPending(authority, rpcGet) {
  const addresses = Array.from({length: 256}, (_, index) => pendingAddress(authority, index));
  const found = await rpcGet(addresses);
  const index = found.findIndex((account) => account === null);
  if (index < 0) throw new Error('no free pending-withdraw index');
  return {index, address: addresses[index]};
}

async function mainnetCases(templates) {
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const orcaAta = getAssociatedTokenAddressSync(ORCA, P0_AUTHORITY);
  const xorcaAta = getAssociatedTokenAddressSync(XORCA, P0_AUTHORITY);
  const ataRows = await connection.getMultipleAccountsInfo([orcaAta, xorcaAta], 'confirmed');
  const prefixOrca = ataRows[0] ? [] : [createAssociatedTokenAccountIdempotentInstruction(
    P0_AUTHORITY, orcaAta, P0_AUTHORITY, ORCA)];
  const prefixBoth = [
    ...prefixOrca,
    ...(ataRows[1] ? [] : [createAssociatedTokenAccountIdempotentInstruction(
      P0_AUTHORITY, xorcaAta, P0_AUTHORITY, XORCA)]),
  ];
  const builders = p0Builders(templates, P0_ACCOUNT, P0_AUTHORITY, orcaAta);
  const p0Available = BigInt(LIVE.project0.liquidityVaultAccount.amountRaw);
  const watchedPair = [P0_AUTHORITY, P0_ACCOUNT, P0_BANK, orcaAta, P0_VAULT];
  const results = [];

  const pairInstructions = (amount) => {
    const end = builders.end();
    const ixs = [...prefixOrca, null, builders.borrow(amount), builders.repay(amount), end];
    ixs[prefixOrca.length] = builders.start(ixs.indexOf(end));
    return ixs;
  };

  for (const [name, amount] of [
    ['project0_orca_pair_dust_2', 2n],
    ['project0_orca_pair_near_vault_minus_1', p0Available - 1n],
    ['project0_orca_pair_full_vault', p0Available],
    ['project0_orca_pair_vault_plus_1', p0Available + 1n],
  ]) {
    results.push(await simulateMainnet(name, pairInstructions(amount), P0_AUTHORITY,
      watchedPair, blockhash, {amountRaw: amount.toString(), fullRepayRequested: true}));
  }

  let maximumObserved = results[0].err ? 0n : 2n;
  if (!results[0].err && results[1].err) {
    let low = maximumObserved + 1n;
    let high = p0Available - 1n;
    while (low <= high) {
      const amount = (low + high) / 2n;
      const row = await simulateMainnet(`project0_orca_limit_probe_${amount}`,
        pairInstructions(amount), P0_AUTHORITY, watchedPair, blockhash,
        {amountRaw: amount.toString(), binarySearchProbe: true, fullRepayRequested: true});
      results.push(row);
      if (!row.err) {
        maximumObserved = amount;
        low = amount + 1n;
      } else {
        high = amount - 1n;
      }
    }
  } else {
    maximumObserved = p0Available - 1n;
  }

  const pendingCandidates = Array.from({length: 256}, (_, index) =>
    pendingAddress(P0_AUTHORITY, index));
  const pendingRows = [];
  for (let offset = 0; offset < pendingCandidates.length; offset += 100) {
    pendingRows.push(...await connection.getMultipleAccountsInfo(
      pendingCandidates.slice(offset, offset + 100), 'confirmed'));
  }
  const freeIndex = pendingRows.findIndex((account) => account === null);
  if (freeIndex < 0) throw new Error('Project0 template authority has no free pending index');
  const pending = pendingAddress(P0_AUTHORITY, freeIndex);

  const route = (amount, includeWithdraw) => {
    const shares = mintedFor(amount);
    if (shares === 0n) throw new Error(`stake amount ${amount} mints zero xORCA`);
    const end = builders.end();
    const body = [builders.borrow(amount), stakeIx(P0_AUTHORITY, orcaAta, xorcaAta, amount),
      unstakeIx(P0_AUTHORITY, xorcaAta, pending, shares, freeIndex)];
    if (includeWithdraw) body.push(withdrawIx(P0_AUTHORITY, orcaAta, pending, freeIndex));
    body.push(builders.repay(amount), end);
    const ixs = [...prefixBoth, null, ...body];
    ixs[prefixBoth.length] = builders.start(ixs.indexOf(end));
    return {ixs, shares};
  };

  if (!results[0].err) {
    for (const [name, amount, includeWithdraw] of [
      ['project0_xorca_dust_unstake_then_repay', 2n, false],
      ['project0_xorca_dust_same_tx_withdraw_then_repay', 2n, true],
      ['project0_xorca_near_same_tx_withdraw_then_repay', maximumObserved, true],
    ]) {
      if (amount < 2n) continue;
      const built = route(amount, includeWithdraw);
      results.push(await simulateMainnet(name, built.ixs, P0_AUTHORITY,
        [P0_AUTHORITY, P0_ACCOUNT, P0_BANK, orcaAta, xorcaAta, P0_VAULT,
          VAULT, STATE, XORCA, pending], blockhash, {
          amountRaw: amount.toString(),
          xorcaUnstakeRaw: built.shares.toString(),
          includesSameTransactionWithdraw: includeWithdraw,
          fullRepayRequested: true,
        }));
    }
  }

  return {
    sourceSignature: SOURCE_SIGNATURE,
    sourceSlot: templates.sourceSlot,
    templateAuthority: P0_AUTHORITY.toString(),
    templateMarginfiAccount: P0_ACCOUNT.toString(),
    derivedOrcaAta: orcaAta.toString(),
    derivedXorcaAta: xorcaAta.toString(),
    p0VaultRaw: p0Available.toString(),
    maximumSuccessfulPairObservedRaw: maximumObserved.toString(),
    pendingIndex: freeIndex,
    pendingAddress: pending.toString(),
    results,
  };
}

async function forkCases(templates) {
  const attacker = Keypair.generate();
  const orcaToken = Keypair.generate().publicKey;
  const xorcaToken = Keypair.generate().publicKey;
  const dexXorcaToken = getAssociatedTokenAddressSync(XORCA, attacker.publicKey);
  const alternateVault = Keypair.generate().publicKey;
  const flashOrcaToken = Keypair.generate().publicKey;
  const freshMarginfiAccount = Keypair.generate();
  const initialOrca = BigInt(LIVE.project0.liquidityVaultAccount.amountRaw) * 4n + 1_000_000_000n;

  // Force lazy import of current protocol accounts, without changing them.
  for (const address of [PROGRAM, STATE, VAULT, ORCA, XORCA]) {
    await rpcFork('getAccountInfo', [address.toString(), {encoding: 'base64', commitment: 'processed'}]);
  }
  await setForkAccount(attacker.publicKey, SystemProgram.programId, 20_000_000_000, Buffer.alloc(0));
  await setForkAccount(orcaToken, TOKEN_PROGRAM_ID, 2_039_280,
    tokenAccountData(ORCA, attacker.publicKey, initialOrca));
  await setForkAccount(xorcaToken, TOKEN_PROGRAM_ID, 2_039_280,
    tokenAccountData(XORCA, attacker.publicKey, 0n));
  await setForkAccount(dexXorcaToken, TOKEN_PROGRAM_ID, 2_039_280,
    tokenAccountData(XORCA, attacker.publicKey, 0n));
  await setForkAccount(alternateVault, TOKEN_PROGRAM_ID, 2_039_280,
    tokenAccountData(ORCA, STATE, BigInt(LIVE.currentAccounts.vault.amountRaw)));
  await setForkAccount(flashOrcaToken, TOKEN_PROGRAM_ID, 2_039_280,
    tokenAccountData(ORCA, attacker.publicKey, 0n));

  const blockhash = (await rpcFork('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const pending = (index) => pendingAddress(attacker.publicKey, index);
  const watchedFor = (index) => [attacker.publicKey, orcaToken, xorcaToken,
    VAULT, STATE, XORCA, pending(index)];
  const equityFor = (index) => ({orcaToken, xorcaToken, pending: pending(index)});
  const results = [];

  async function run(name, ixs, index, metadata = {}, watched = watchedFor(index)) {
    const row = await simulateFork(name, ixs, attacker, watched, blockhash,
      equityFor(index), metadata);
    results.push(row);
    return row;
  }

  await run('stake_dust_1', [stakeIx(attacker.publicKey, orcaToken, xorcaToken, 1n)], 0,
    {stakeRaw: '1', expectedProgramError: 6014});

  const threshold = 2n;
  const thresholdMint = mintedFor(threshold);
  await run('stake_threshold_2', [stakeIx(attacker.publicKey, orcaToken, xorcaToken, threshold)], 1,
    {stakeRaw: threshold.toString(), expectedMintRaw: thresholdMint.toString()});

  const near = BigInt(LIVE.project0.liquidityVaultAccount.amountRaw) - 1n;
  const nearMint = mintedFor(near);
  await run('stake_near_project0_available', [stakeIx(attacker.publicKey, orcaToken,
    xorcaToken, near)], 2, {stakeRaw: near.toString(), expectedMintRaw: nearMint.toString()});

  await run('stake_unstake_threshold', [
    stakeIx(attacker.publicKey, orcaToken, xorcaToken, threshold),
    unstakeIx(attacker.publicKey, xorcaToken, pending(3), thresholdMint, 3),
  ], 3, {
    stakeRaw: threshold.toString(),
    mintedAndBurnedXorcaRaw: thresholdMint.toString(),
    expectedPendingClaimRaw: claimFor(thresholdMint,
      liveAssets + threshold, liveSupply + thresholdMint).toString(),
  });

  await run('stake_unstake_near_project0_available', [
    stakeIx(attacker.publicKey, orcaToken, xorcaToken, near),
    unstakeIx(attacker.publicKey, xorcaToken, pending(4), nearMint, 4),
  ], 4, {
    stakeRaw: near.toString(),
    mintedAndBurnedXorcaRaw: nearMint.toString(),
    expectedPendingClaimRaw: claimFor(nearMint,
      liveAssets + near, liveSupply + nearMint).toString(),
  });

  await run('stake_unstake_same_tx_withdraw', [
    stakeIx(attacker.publicKey, orcaToken, xorcaToken, near),
    unstakeIx(attacker.publicKey, xorcaToken, pending(5), nearMint, 5),
    withdrawIx(attacker.publicKey, orcaToken, pending(5), 5),
  ], 5, {stakeRaw: near.toString(), expectedProgramError: 6011});

  const donation = 100_000_000n;
  const orderingStake = near;
  const beforeMint = mintedFor(orderingStake);
  const beforeClaim = claimFor(beforeMint,
    liveAssets + orderingStake + donation, liveSupply + beforeMint);
  await run('stake_then_self_funded_donation_then_unstake', [
    stakeIx(attacker.publicKey, orcaToken, xorcaToken, orderingStake),
    createTransferInstruction(orcaToken, VAULT, attacker.publicKey, donation),
    unstakeIx(attacker.publicKey, xorcaToken, pending(6), beforeMint, 6),
  ], 6, {
    stakeRaw: orderingStake.toString(),
    donationRaw: donation.toString(),
    mintedAndBurnedXorcaRaw: beforeMint.toString(),
    expectedPendingClaimRaw: beforeClaim.toString(),
    expectedNetAfterSelfFundedDonationRaw: (beforeClaim - orderingStake - donation).toString(),
  });

  const afterMint = mintedFor(orderingStake, liveAssets + donation, liveSupply);
  const afterClaim = claimFor(afterMint,
    liveAssets + donation + orderingStake, liveSupply + afterMint);
  await run('self_funded_donation_then_stake_then_unstake', [
    createTransferInstruction(orcaToken, VAULT, attacker.publicKey, donation),
    stakeIx(attacker.publicKey, orcaToken, xorcaToken, orderingStake),
    unstakeIx(attacker.publicKey, xorcaToken, pending(7), afterMint, 7),
  ], 7, {
    stakeRaw: orderingStake.toString(),
    donationRaw: donation.toString(),
    mintedAndBurnedXorcaRaw: afterMint.toString(),
    expectedPendingClaimRaw: afterClaim.toString(),
    expectedNetAfterSelfFundedDonationRaw: (afterClaim - orderingStake - donation).toString(),
  });

  await run('substitute_wrong_vault_pda', [stakeIx(attacker.publicKey, orcaToken,
    xorcaToken, threshold, alternateVault)], 8,
    {stakeRaw: threshold.toString(), expectedProgramError: 6005},
    [...watchedFor(8), alternateVault]);

  await run('substitute_protocol_vault_as_user_source', [stakeIx(attacker.publicKey,
    VAULT, xorcaToken, threshold)], 9, {stakeRaw: threshold.toString(),
    expectation: 'reject because the protocol vault is not owned by the attacker'});

  await run('substitute_token_program', [stakeIx(attacker.publicKey, orcaToken,
    xorcaToken, threshold, VAULT, SystemProgram.programId)], 10,
    {stakeRaw: threshold.toString(), expectedProgramError: 6006});

  const victim = LIVE.currentAccounts.pendingWithdraws[0];
  const victimPending = P(victim.address);
  await rpcFork('getAccountInfo', [victimPending.toString(), {encoding: 'base64', commitment: 'processed'}]);
  await run('outsider_withdraw_other_users_pending_claim', [withdrawIx(attacker.publicKey,
    orcaToken, victimPending, victim.withdrawIndex)], 11, {
    victimPending: victimPending.toString(),
    victimUnstaker: victim.unstaker,
    victimClaimRaw: victim.withdrawableOrcaRaw,
    expectation: 'reject because pending PDA is bound to the signer',
    expectedProgramError: 6005,
  }, [attacker.publicKey, orcaToken, xorcaToken, VAULT, STATE, XORCA, victimPending,
    pending(11)]);

  // A liquid secondary-market exit avoids Withdraw entirely. Test it at dust,
  // ordinary, displayed-lender, and the live Jupiter direct-route ceiling.
  const ceilingShares = BigInt(ROUNDTRIP.directRouteQuoteCeiling.exactLastSuccessRaw);
  const stakeForCeiling = (ceilingShares * (liveAssets + virtual) +
    (liveSupply + virtual) - 1n) / (liveSupply + virtual);
  const dexCases = [
    ['signed_stake_then_whirlpool_exit_dust_10', 10n],
    ['signed_stake_then_whirlpool_exit_one_orca', 1_000_000n],
    ['signed_stake_then_whirlpool_exit_project0_displayed',
      BigInt(LIVE.project0.liquidityVaultAccount.amountRaw)],
    ['signed_stake_then_whirlpool_exit_quote_ceiling', stakeForCeiling],
  ];
  for (let offset = 0; offset < dexCases.length; offset += 1) {
    const [name, amount] = dexCases[offset];
    const shares = mintedFor(amount);
    const exit = await jupiterXorcaExit(attacker.publicKey, orcaToken, shares);
    const index = 13 + offset;
    const watched = [attacker.publicKey, orcaToken, dexXorcaToken,
      VAULT, STATE, XORCA, pending(index)];
    results.push(await simulateFork(name, [
      stakeIx(attacker.publicKey, orcaToken, dexXorcaToken, amount),
      ...exit.instructions,
    ], attacker, watched, blockhash, {orcaToken, xorcaToken: dexXorcaToken,
      pending: pending(index)}, {
      stakeRaw: amount.toString(), mintedXorcaRaw: shares.toString(),
      quotedOrcaOutRaw: exit.quote.outAmount,
      quotedDeltaBeforeFeesRaw: (BigInt(exit.quote.outAmount) - amount).toString(),
      quote: exit.quote,
      secondaryExit: 'Jupiter direct Whirlpool xORCA->ORCA',
      fullUnwind: true,
    }));
  }

  // A fully signed, fresh-attacker Project0 envelope proves the live ORCA
  // lender gate independently of the unsigned current-mainnet replays above.
  const flashBuilders = p0Builders(templates, freshMarginfiAccount.publicKey,
    attacker.publicKey, flashOrcaToken);
  const initMarginfi = instruction(PROJECT0, [
    {pubkey: P0_GROUP, isSigner: false, isWritable: false},
    {pubkey: freshMarginfiAccount.publicKey, isSigner: true, isWritable: true},
    {pubkey: attacker.publicKey, isSigner: true, isWritable: false},
    {pubkey: attacker.publicKey, isSigner: true, isWritable: true},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
  ], Buffer.from([43, 78, 61, 255, 148, 52, 249, 154]));
  const p0Available = BigInt(LIVE.project0.liquidityVaultAccount.amountRaw);
  const flashWatched = (index) => [attacker.publicKey, freshMarginfiAccount.publicKey,
    flashOrcaToken, xorcaToken, P0_BANK, P0_VAULT, VAULT, STATE, XORCA, pending(index)];
  const flashEquity = (index) => ({orcaToken: flashOrcaToken,
    xorcaToken, pending: pending(index)});

  const signedFlashPair = (amount) => {
    const end = flashBuilders.end();
    const ixs = [initMarginfi, null, flashBuilders.borrow(amount),
      flashBuilders.repay(amount), end];
    ixs[1] = flashBuilders.start(ixs.indexOf(end));
    return ixs;
  };
  for (const [name, amount] of [
    ['signed_project0_orca_flash_dust_2', 2n],
    ['signed_project0_orca_flash_available_minus_1', p0Available - 1n],
    ['signed_project0_orca_flash_exact_available', p0Available],
    ['signed_project0_orca_flash_available_plus_1', p0Available + 1n],
  ]) {
    results.push(await simulateFork(name, signedFlashPair(amount), attacker,
      flashWatched(12), blockhash, flashEquity(12), {
        lender: PROJECT0.toString(),
        amountRaw: amount.toString(),
        fullRepayRequested: true,
        expectedLenderError: {code: 6017, name: 'BankReduceOnly'},
      }, [freshMarginfiAccount]));
  }

  const flashStake = p0Available;
  const flashShares = mintedFor(flashStake);
  const end = flashBuilders.end();
  const wrapped = [initMarginfi, null, flashBuilders.borrow(flashStake),
    stakeIx(attacker.publicKey, flashOrcaToken, xorcaToken, flashStake),
    unstakeIx(attacker.publicKey, xorcaToken, pending(12), flashShares, 12),
    withdrawIx(attacker.publicKey, flashOrcaToken, pending(12), 12),
    flashBuilders.repay(flashStake), end];
  wrapped[1] = flashBuilders.start(wrapped.indexOf(end));
  results.push(await simulateFork('signed_project0_flash_wrapped_xorca_route', wrapped,
    attacker, flashWatched(12), blockhash, flashEquity(12), {
      lender: PROJECT0.toString(),
      amountRaw: flashStake.toString(),
      xorcaStakeRaw: flashStake.toString(),
      xorcaUnstakeRaw: flashShares.toString(),
      includesSameTransactionWithdraw: true,
      fullRepayRequested: true,
      expectedFirstBlocker: {program: PROJECT0.toString(), code: 6017,
        name: 'BankReduceOnly'},
      downstreamBlockerProvedSeparately: {program: PROGRAM.toString(), code: 6011,
        name: 'CoolDownPeriodStillActive'},
    }, [freshMarginfiAccount]));

  // Same lender envelope with the real liquid xORCA exit rather than Withdraw.
  // The first blocker remains Project0's current ReduceOnly gate, but the
  // complete signed v1 route proves serialization/account capacity.
  const flashDexExit = await jupiterXorcaExit(attacker.publicKey, flashOrcaToken, flashShares);
  const endDex = flashBuilders.end();
  const wrappedDex = [initMarginfi, null, flashBuilders.borrow(flashStake),
    stakeIx(attacker.publicKey, flashOrcaToken, dexXorcaToken, flashStake),
    ...flashDexExit.instructions, flashBuilders.repay(flashStake), endDex];
  wrappedDex[1] = flashBuilders.start(wrappedDex.indexOf(endDex));
  results.push(await simulateFork('signed_project0_flash_stake_whirlpool_exit_repay', wrappedDex,
    attacker, [attacker.publicKey, freshMarginfiAccount.publicKey, flashOrcaToken,
      dexXorcaToken, P0_BANK, P0_VAULT, VAULT, STATE, XORCA, pending(17)], blockhash,
    {orcaToken: flashOrcaToken, xorcaToken: dexXorcaToken, pending: pending(17)}, {
      lender: PROJECT0.toString(), amountRaw: flashStake.toString(),
      mintedXorcaRaw: flashShares.toString(), quotedOrcaOutRaw: flashDexExit.quote.outAmount,
      quotedShortfallBeforeLenderFeesRaw: (flashStake - BigInt(flashDexExit.quote.outAmount)).toString(),
      quote: flashDexExit.quote, includesWithdraw: false, fullRepayRequested: true,
      expectedFirstBlocker: {program: PROJECT0.toString(), code: 6017,
        name: 'BankReduceOnly'},
    }, [freshMarginfiAccount]));

  return {
    forkEndpoint: 'local-only',
    attacker: attacker.publicKey.toString(),
    attackerOrcaToken: orcaToken.toString(),
    attackerXorcaToken: xorcaToken.toString(),
    attackerDexXorcaToken: dexXorcaToken.toString(),
    alternateVault: alternateVault.toString(),
    flashOrcaToken: flashOrcaToken.toString(),
    freshMarginfiAccount: freshMarginfiAccount.publicKey.toString(),
    syntheticInitialOrcaRaw: initialOrca.toString(),
    protocolAccountsMutated: false,
    results,
  };
}

async function main() {
  const templates = await fetchP0Templates();
  const mainnet = await mainnetCases(templates);
  const fork = await forkCases(templates);
  const klendOrca = [...(KLEND_CENSUS.activeZero || []),
    ...(KLEND_CENSUS.otherRows || [])].filter((row) => row.mint === ORCA.toString());
  const all = [...mainnet.results, ...fork.results];
  const output = {
    generatedAt: new Date().toISOString(),
    scope: 'read-only current-mainnet simulation plus signed local-fork simulation; no live submission',
    safety: {
      liveSubmission: false,
      upstreamMethods: ['getTransaction', 'getAccountInfo/getMultipleAccounts',
        'getLatestBlockhash', 'simulateTransaction'],
      forkProtocolAccountsMutated: false,
      forkSyntheticAccounts: 'fresh attacker-owned system/token accounts only',
      rpcUrlsStored: false,
      secretKeysStored: false,
    },
    currentIdentity: {
      program: PROGRAM.toString(), state: STATE.toString(), vault: VAULT.toString(),
      orcaMint: ORCA.toString(), xorcaMint: XORCA.toString(),
      contextSlot: LIVE.contextSlot,
    },
    liveMath: {
      nonEscrowedOrcaRaw: liveAssets.toString(),
      xorcaSupplyRaw: liveSupply.toString(),
      virtualOrcaRaw: virtual.toString(),
      virtualXorcaRaw: virtual.toString(),
    },
    flashSourceCensus: {
      exactZeroRateKlendOrcaReserveCount: (KLEND_CENSUS.activeZero || [])
        .filter((row) => row.mint === ORCA.toString()).length,
      anyKlendOrcaReserveCount: klendOrca.length,
      project0OrcaVaultRaw: LIVE.project0.liquidityVaultAccount.amountRaw,
      project0OperationalState: LIVE.project0.operationalState,
      maximumJointlyRouteValidOrcaFlashRaw: '0',
      asymmetricMultiSourceInputsApplicable: false,
      secondaryXorcaExitAvailable: true,
      reason: 'No KLend ORCA reserve exists and Project0 rejects every positive ORCA borrow in ReduceOnly mode. A Whirlpool xORCA exit exists, but every tested stake-to-exit amount is loss-making before lender and cross-asset swap fees; authorized external reward transfers cannot be inserted inside an outsider flash transaction.',
    },
    mainnet,
    fork,
    summary: {
      cases: all.length,
      successes: all.filter((row) => !row.err).length,
      failures: all.filter((row) => row.err).length,
      maxWireBytes: Math.max(...all.map((row) => row.wire?.bytes || 0)),
      allWithin4096Bytes: all.every((row) => (row.wire?.bytes || 0) <= 4096),
      signedForkCases: fork.results.length,
      positiveOutsiderEquityCases: fork.results.filter((row) =>
        BigInt(row.outsiderEquity?.deltaOrcaEquivalentRaw || 0) > 0n).map((row) => row.name),
    },
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({
    output: OUTPUT,
    mainnetCases: mainnet.results.length,
    forkCases: fork.results.length,
    mainnetOutcomes: mainnet.results.map((row) => ({name: row.name, err: row.err,
      bytes: row.wire.bytes, trace: row.trace.slice(-4)})),
    forkOutcomes: fork.results.map((row) => ({name: row.name, err: row.err,
      bytes: row.wire.bytes, equityDeltaRaw: row.outsiderEquity.deltaOrcaEquivalentRaw,
      trace: row.trace.slice(-4)})),
    summary: output.summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
