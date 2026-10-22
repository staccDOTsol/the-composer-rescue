#!/usr/bin/env node
'use strict';

// Read-only current-mainnet v1 probes for AuthUnstakeFox, reconstructed from
// five successful current-deployment transactions. Transactions are serialized
// solely for simulateTransaction(sigVerify=false); nothing is signed/submitted.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const { encodeV1 } = require('../klend-v1-composition.js');

const P = (value) => new PublicKey(value);
const PROGRAM = P('FoXpJL1exLBJgHVvdSHNKyKu2xX2uatctH9qp6dLmfpP');
const CONFIG = P('7N7M1H2CK51ip7sNtPgKhhv2eScx6BokLgHi1Ke3ZLiq');
const AUTH = P('Gd18t9bFpigpnEWpYkXD6bhcbtKW5szN2HkgmFUtsM3m');
const VAULT = P('32Xe8tQYy7hZDH3PWFA8q34oPbHK1BXaDLnRDhuWCx8h');
const FOXY_MINT = P('FoXyMu5xwXre7zEoSvzViRk3nGawHUp9kUh97y2NDhcq');
const METADATA_PROGRAM = P('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const CLAIM_AUTHORITY = P('3pMvTLUA9NzZQd4gi725p89mvND1wRNQM3C8XEv1hTdA');
const ORIGINAL = {
  owner: P('BNF1uzrS9XUyjUYJ89X3QAhmJZLU7GyXXpMSp96pSx3X'),
  stake: P('5ouUMrQuhr7n2241g4q9Ddq7FesgTGCgBgWZHeKUrxxM'),
  mint: P('3YqCz8eNJDhW3boSQdyCVmtpL9CzNmyPkyapF2qdBDwD'),
  rewardAta: P('BH8BkxJgP5VZ4cHazTD2VvNxTTJFh7zdgq85g1EQUZPq'),
};
const OUTSIDER = {
  owner: P('HyJGn2q8vgYCH6urPsQXwxu6W5DqecVvBNTMU5RnnWrW'),
  rewardAta: P('48Xc19yM6UYjbSE78AHn2KEwmw7AN8eiU4THgdup5L4X'),
};
const OUT = process.argv[2] || path.join(__dirname, 'auth-unstake-simulations.json');

const [MAIN_ACCOUNT, mainBump] = PublicKey.findProgramAddressSync(
  [CONFIG.toBuffer(), Buffer.from('auth'), ORIGINAL.owner.toBuffer()], PROGRAM,
);
const FROM_NFT = getAssociatedTokenAddressSync(ORIGINAL.mint, ORIGINAL.owner);
const TO_NFT = getAssociatedTokenAddressSync(ORIGINAL.mint, OUTSIDER.owner);
const [MASTER_EDITION, editionBump] = PublicKey.findProgramAddressSync(
  [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), ORIGINAL.mint.toBuffer(), Buffer.from('edition')],
  METADATA_PROGRAM,
);

const env = Object.fromEntries(
  fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
    .split(/\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
);
const rpcUrl = process.env.HEAVY_RPC_URL || env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('missing RPC endpoint configuration');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const discriminator = crypto.createHash('sha256').update('global:auth_unstake_fox').digest().subarray(0, 8);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, attempts = 8) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      });
      const body = await response.json();
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt + 1 === attempts) break;
      await sleep(300 * (2 ** attempt));
    }
  }
  throw last;
}

function authUnstakeIx({
  claimAuthority = CLAIM_AUTHORITY,
  claimAuthoritySigner = true,
  rewardDestination = OUTSIDER.rewardAta,
  newOwner = OUTSIDER.owner,
  mainAccount = MAIN_ACCOUNT,
  stake = ORIGINAL.stake,
  fromNft = FROM_NFT,
  toNft = TO_NFT,
  vault = VAULT,
} = {}) {
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: CONFIG, isSigner: false, isWritable: true },
      { pubkey: mainAccount, isSigner: false, isWritable: true },
      { pubkey: AUTH, isSigner: false, isWritable: false },
      { pubkey: stake, isSigner: false, isWritable: true },
      { pubkey: ORIGINAL.owner, isSigner: false, isWritable: false },
      { pubkey: newOwner, isSigner: false, isWritable: true },
      { pubkey: fromNft, isSigner: false, isWritable: true },
      { pubkey: toNft, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: rewardDestination, isSigner: false, isWritable: true },
      { pubkey: FOXY_MINT, isSigner: false, isWritable: false },
      { pubkey: ORIGINAL.mint, isSigner: false, isWritable: false },
      { pubkey: MASTER_EDITION, isSigner: false, isWritable: false },
      { pubkey: METADATA_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: claimAuthority, isSigner: claimAuthoritySigner, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });
}

const watched = [...new Map([
  CONFIG, MAIN_ACCOUNT, AUTH, ORIGINAL.stake, ORIGINAL.owner, OUTSIDER.owner,
  FROM_NFT, TO_NFT, VAULT, OUTSIDER.rewardAta, ORIGINAL.rewardAta,
  CLAIM_AUTHORITY, MASTER_EDITION,
].map((key) => [key.toBase58(), key])).values()];

function decodeAccount(address, account) {
  if (!account) return { address, exists: false };
  const data = Buffer.from(account.data[0], 'base64');
  const result = {
    address,
    exists: true,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: data.length,
    dataSha256: sha256(data),
  };
  if (account.owner === TOKEN_PROGRAM_ID.toBase58() && data.length >= 72) {
    result.kind = 'spl-token-account';
    result.mint = new PublicKey(data.subarray(0, 32)).toBase58();
    result.tokenAuthority = new PublicKey(data.subarray(32, 64)).toBase58();
    result.rawAmount = data.readBigUInt64LE(64).toString();
    result.state = data[108];
    if (data.readUInt32LE(72) === 1) result.delegate = new PublicKey(data.subarray(76, 108)).toBase58();
    result.delegatedAmount = data.readBigUInt64LE(121).toString();
  } else if (account.owner === PROGRAM.toBase58() && data.length <= 256) {
    result.dataBase64 = data.toString('base64');
  }
  return result;
}

async function snapshot() {
  const response = await rpc('getMultipleAccounts', [watched.map((key) => key.toBase58()), {
    encoding: 'base64', commitment: 'confirmed',
  }]);
  return {
    slot: response.context.slot,
    accounts: Object.fromEntries(watched.map((address, index) => [
      address.toBase58(), decodeAccount(address.toBase58(), response.value[index]),
    ])),
  };
}

function decodePost(accounts) {
  return Object.fromEntries(watched.map((address, index) => [
    address.toBase58(), decodeAccount(address.toBase58(), accounts?.[index] || null),
  ]));
}

function deltas(before, after) {
  return Object.fromEntries(watched.map((key) => {
    const address = key.toBase58();
    const pre = before[address];
    const post = after[address];
    return [address, {
      lamports: pre?.exists && post?.exists ? String(BigInt(post.lamports) - BigInt(pre.lamports)) : null,
      tokenRaw: pre?.rawAmount !== undefined && post?.rawAmount !== undefined
        ? String(BigInt(post.rawAmount) - BigInt(pre.rawAmount)) : null,
      existsBefore: Boolean(pre?.exists),
      existsAfter: Boolean(post?.exists),
      dataChanged: pre?.dataSha256 !== undefined && post?.dataSha256 !== undefined
        ? pre.dataSha256 !== post.dataSha256 : null,
    }];
  }));
}

function messageMetadata(instructions, payer, blockhash) {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions })
    .compileToV0Message();
  return {
    header: message.header,
    accounts: message.staticAccountKeys.map((pubkey, index) => ({
      index,
      pubkey: pubkey.toBase58(),
      signer: index < message.header.numRequiredSignatures,
    })),
  };
}

async function simulate(label, instructions, payer, blockhash, before) {
  const encoded = encodeV1(instructions, payer, blockhash, 1_400_000, 67_108_864);
  const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64',
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
    minContextSlot: before.slot,
    innerInstructions: true,
    accounts: { encoding: 'base64', addresses: watched.map((key) => key.toBase58()) },
  }]);
  const post = decodePost(response.value.accounts);
  return {
    label,
    simulationSlot: response.context.slot,
    err: response.value.err || null,
    unitsConsumed: response.value.unitsConsumed,
    logs: response.value.logs || [],
    innerInstructions: response.value.innerInstructions || [],
    message: {
      format: 'solana-v1',
      sizeBytes: encoded.sizeBytes,
      v0EquivalentBytes: encoded.v0Bytes,
      addressCount: encoded.addressCount,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      sha256: sha256(encoded.wire),
      base64: encoded.wire.toString('base64'),
      ...messageMetadata(instructions, payer, blockhash),
    },
    post,
    deltas: deltas(before.accounts, post),
  };
}

async function main() {
  const before = await snapshot();
  const configBytes = Buffer.from(before.accounts[CONFIG.toBase58()].dataBase64, 'base64');
  const configClaimAuthority = new PublicKey(configBytes.subarray(41, 73));
  if (!configClaimAuthority.equals(CLAIM_AUTHORITY)) {
    throw new Error(`current config claim authority changed to ${configClaimAuthority.toBase58()}`);
  }
  const blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
  const positive = authUnstakeIx();
  const specs = [
    ['current_admin_positive_control', [positive], CLAIM_AUTHORITY],
    ['configured_claim_authority_not_signer', [authUnstakeIx({ claimAuthoritySigner: false })], OUTSIDER.owner],
    ['outsider_substitutes_claim_authority', [authUnstakeIx({
      claimAuthority: OUTSIDER.owner,
      claimAuthoritySigner: true,
    })], OUTSIDER.owner],
    ['original_owner_substitutes_claim_authority', [authUnstakeIx({
      claimAuthority: ORIGINAL.owner,
      claimAuthoritySigner: true,
    })], ORIGINAL.owner],
    ['admin_redirects_reward_to_original_owner', [authUnstakeIx({
      rewardDestination: ORIGINAL.rewardAta,
    })], CLAIM_AUTHORITY],
    ['admin_aliases_reward_destination_to_vault', [authUnstakeIx({
      rewardDestination: VAULT,
    })], CLAIM_AUTHORITY],
    ['admin_repeats_auth_unstake_twice_atomic', [positive, positive], CLAIM_AUTHORITY],
  ];
  const results = [];
  for (const [label, instructions, payer] of specs) {
    results.push(await simulate(label, instructions, payer, blockhash, before));
  }
  const output = {
    generatedAt: new Date().toISOString(),
    method: 'read-only simulateTransaction; sigVerify=false; no transaction signed or submitted',
    noTransactionsSubmitted: true,
    limits: { maxWireBytes: 4096, maxUniqueAccounts: 64 },
    target: {
      programId: PROGRAM.toBase58(),
      config: CONFIG.toBase58(),
      vault: VAULT.toBase58(),
      authority: AUTH.toBase58(),
      configClaimAuthority: configClaimAuthority.toBase58(),
    },
    derivations: {
      mainAccount: { address: MAIN_ACCOUNT.toBase58(), seeds: ['config', 'auth', 'original_owner'], bump: mainBump },
      fromNftAta: FROM_NFT.toBase58(),
      toNftAta: TO_NFT.toBase58(),
      masterEdition: { address: MASTER_EDITION.toBase58(), bump: editionBump },
    },
    roles: {
      originalOwner: ORIGINAL.owner.toBase58(),
      newOwnerAndOutsider: OUTSIDER.owner.toBase58(),
      stakeAccount: ORIGINAL.stake.toBase58(),
      nftMint: ORIGINAL.mint.toBase58(),
      outsiderRewardAta: OUTSIDER.rewardAta.toBase58(),
    },
    preSnapshot: before,
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUT,
    preSlot: before.slot,
    configClaimAuthority: configClaimAuthority.toBase58(),
    derivations: output.derivations,
    results: results.map((result) => ({
      label: result.label,
      simulationSlot: result.simulationSlot,
      err: result.err,
      unitsConsumed: result.unitsConsumed,
      wireBytes: result.message.sizeBytes,
      addressCount: result.message.addressCount,
      instructionCount: result.message.instructionCount,
      vaultDelta: result.deltas[VAULT.toBase58()],
      outsiderRewardDelta: result.deltas[OUTSIDER.rewardAta.toBase58()],
      sourceNftDelta: result.deltas[FROM_NFT.toBase58()],
      destinationNftDelta: result.deltas[TO_NFT.toBase58()],
      lastLogs: result.logs.slice(-8),
    })),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
