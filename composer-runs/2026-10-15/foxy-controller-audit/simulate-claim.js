#!/usr/bin/env node
'use strict';

// Read-only current-mainnet v1 claim probes. This script serializes transactions
// only for simulateTransaction with sigVerify:false. It never signs or submits.

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
const OTHER_CONFIG = P('6kW1byGh9RaeJGQNTDx8UWKuajD8u1tv83vrLzn7GSN7');
const AUTH = P('Gd18t9bFpigpnEWpYkXD6bhcbtKW5szN2HkgmFUtsM3m');
const VAULT = P('32Xe8tQYy7hZDH3PWFA8q34oPbHK1BXaDLnRDhuWCx8h');
const FOXY_MINT = P('FoXyMu5xwXre7zEoSvzViRk3nGawHUp9kUh97y2NDhcq');
const VICTIM = {
  owner: P('BNF1uzrS9XUyjUYJ89X3QAhmJZLU7GyXXpMSp96pSx3X'),
  destination: P('BH8BkxJgP5VZ4cHazTD2VvNxTTJFh7zdgq85g1EQUZPq'),
  stake: P('5ouUMrQuhr7n2241g4q9Ddq7FesgTGCgBgWZHeKUrxxM'),
  mint: P('3YqCz8eNJDhW3boSQdyCVmtpL9CzNmyPkyapF2qdBDwD'),
};
const ATTACKER = {
  owner: P('HyJGn2q8vgYCH6urPsQXwxu6W5DqecVvBNTMU5RnnWrW'),
  destination: P('48Xc19yM6UYjbSE78AHn2KEwmw7AN8eiU4THgdup5L4X'),
  stake: P('ESiw85HcTdPMT6qxx7s45KpLrb2DnvBNxtVuSHNpgRm9'),
  mint: P('3Nit28ebyNmC6WhKm6hGASTdewzdTwGafE1Dw19fFJqQ'),
};
const OUT = process.argv[2] || path.join(__dirname, 'claim-simulations.json');

const env = Object.fromEntries(
  fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
    .split(/\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
);
const rpcUrl = process.env.HEAVY_RPC_URL || env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('missing RPC endpoint configuration');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const claimDiscriminator = crypto.createHash('sha256').update('global:claim').digest().subarray(0, 8);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, attempts = 7) {
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
      await sleep(250 * (2 ** attempt));
    }
  }
  throw last;
}

function claimIx({
  config = CONFIG,
  authority = AUTH,
  vault = VAULT,
  destination = VICTIM.destination,
  stake = VICTIM.stake,
  owner = VICTIM.owner,
  ownerSigner = true,
  mint = VICTIM.mint,
  rewardMint = FOXY_MINT,
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
      { pubkey: rewardMint, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: claimDiscriminator,
  });
}

const watched = [
  CONFIG, OTHER_CONFIG, AUTH, VAULT,
  VICTIM.destination, VICTIM.stake, VICTIM.owner,
  ATTACKER.destination, ATTACKER.stake, ATTACKER.owner,
];

function decodeAccount(address, account) {
  if (!account) return { address, exists: false };
  const data = Buffer.from(account.data[0], 'base64');
  const out = {
    address,
    exists: true,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: data.length,
    dataSha256: sha256(data),
  };
  if (account.owner === TOKEN_PROGRAM_ID.toBase58() && data.length >= 72) {
    out.kind = 'spl-token-account';
    out.mint = new PublicKey(data.subarray(0, 32)).toBase58();
    out.tokenAuthority = new PublicKey(data.subarray(32, 64)).toBase58();
    out.rawAmount = data.readBigUInt64LE(64).toString();
  } else if (account.owner === PROGRAM.toBase58() && data.length <= 256) {
    out.dataBase64 = data.toString('base64');
  }
  return out;
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

function decodeSimulationAccounts(accounts) {
  return Object.fromEntries(watched.map((address, index) => [
    address.toBase58(), decodeAccount(address.toBase58(), accounts?.[index] || null),
  ]));
}

function accountDeltas(before, after) {
  const result = {};
  for (const address of watched.map((key) => key.toBase58())) {
    const pre = before[address];
    const post = after[address];
    result[address] = {
      lamports: pre?.exists && post?.exists ? String(BigInt(post.lamports) - BigInt(pre.lamports)) : null,
      tokenRaw: pre?.rawAmount !== undefined && post?.rawAmount !== undefined
        ? String(BigInt(post.rawAmount) - BigInt(pre.rawAmount)) : null,
      dataChanged: pre?.dataSha256 !== undefined && post?.dataSha256 !== undefined
        ? pre.dataSha256 !== post.dataSha256 : null,
    };
  }
  return result;
}

function messageMetadata(instructions, payer, blockhash) {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions })
    .compileToV0Message();
  const header = message.header;
  return {
    header,
    accounts: message.staticAccountKeys.map((pubkey, index) => ({
      index,
      pubkey: pubkey.toBase58(),
      signer: index < header.numRequiredSignatures,
      writable: index < header.numRequiredSignatures
        ? index < header.numRequiredSignatures - header.numReadonlySignedAccounts
        : index < message.staticAccountKeys.length - header.numReadonlyUnsignedAccounts,
    })),
  };
}

async function simulate(label, instructions, payer, blockhash, before) {
  const encoded = encodeV1(instructions, payer, blockhash, 1_400_000, 67_108_864);
  const metadata = messageMetadata(instructions, payer, blockhash);
  const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64',
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
    minContextSlot: before.slot,
    innerInstructions: true,
    accounts: { encoding: 'base64', addresses: watched.map((key) => key.toBase58()) },
  }]);
  const value = response.value;
  const post = decodeSimulationAccounts(value.accounts);
  return {
    label,
    simulationSlot: response.context.slot,
    err: value.err || null,
    unitsConsumed: value.unitsConsumed,
    loadedAccountsDataSize: value.loadedAccountsDataSize,
    returnData: value.returnData || null,
    logs: value.logs || [],
    innerInstructions: value.innerInstructions || [],
    message: {
      format: 'solana-v1',
      sizeBytes: encoded.sizeBytes,
      v0EquivalentBytes: encoded.v0Bytes,
      addressCount: encoded.addressCount,
      writableCount: encoded.writableCount,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      sha256: sha256(encoded.wire),
      base64: encoded.wire.toString('base64'),
      ...metadata,
    },
    post,
    deltas: accountDeltas(before.accounts, post),
  };
}

async function main() {
  const before = await snapshot();
  const blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
  const [derivedAuth, authBump] = PublicKey.findProgramAddressSync(
    [CONFIG.toBuffer(), Buffer.from('auth')], PROGRAM,
  );
  const [derivedOtherAuth, otherAuthBump] = PublicKey.findProgramAddressSync(
    [OTHER_CONFIG.toBuffer(), Buffer.from('auth')], PROGRAM,
  );
  const [derivedVictimStake, victimStakeBump] = PublicKey.findProgramAddressSync(
    [VICTIM.owner.toBuffer(), Buffer.from('stake'), VICTIM.mint.toBuffer()], PROGRAM,
  );
  const [derivedAttackerStake, attackerStakeBump] = PublicKey.findProgramAddressSync(
    [ATTACKER.owner.toBuffer(), Buffer.from('stake'), ATTACKER.mint.toBuffer()], PROGRAM,
  );
  const victimAta = getAssociatedTokenAddressSync(FOXY_MINT, VICTIM.owner, false,
    TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const attackerAta = getAssociatedTokenAddressSync(FOXY_MINT, ATTACKER.owner, false,
    TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const victimClaim = claimIx();
  const attackerClaim = claimIx({
    destination: ATTACKER.destination,
    stake: ATTACKER.stake,
    owner: ATTACKER.owner,
    mint: ATTACKER.mint,
  });
  const specs = [
    ['victim_current_positive', [victimClaim], VICTIM.owner],
    ['attacker_own_position_positive', [attackerClaim], ATTACKER.owner],
    ['victim_owner_not_signer', [claimIx({ ownerSigner: false })], ATTACKER.owner],
    ['outsider_signer_with_victim_position', [claimIx({ owner: ATTACKER.owner })], ATTACKER.owner],
    ['outsider_signer_and_destination_with_victim_position', [claimIx({
      owner: ATTACKER.owner,
      destination: ATTACKER.destination,
    })], ATTACKER.owner],
    ['victim_signer_redirect_to_outsider_destination', [claimIx({
      destination: ATTACKER.destination,
    })], VICTIM.owner],
    ['victim_signer_destination_aliases_vault', [claimIx({ destination: VAULT })], VICTIM.owner],
    ['reward_vault_replaced_by_outsider_destination', [claimIx({
      vault: ATTACKER.destination,
    })], VICTIM.owner],
    ['authority_replaced_by_outsider', [claimIx({ authority: ATTACKER.owner })], VICTIM.owner],
    ['other_config_with_selected_authority_and_vault', [claimIx({
      config: OTHER_CONFIG,
    })], VICTIM.owner],
    ['other_config_with_derived_authority_and_selected_vault', [claimIx({
      config: OTHER_CONFIG,
      authority: derivedOtherAuth,
    })], VICTIM.owner],
    ['victim_position_with_outsider_nft_mint', [claimIx({
      mint: ATTACKER.mint,
    })], VICTIM.owner],
    ['victim_owner_with_outsider_stake_account', [claimIx({
      stake: ATTACKER.stake,
    })], VICTIM.owner],
    ['victim_claim_twice_atomic', [victimClaim, victimClaim], VICTIM.owner],
    ['victim_claim_ten_times_atomic', Array.from({ length: 10 }, () => victimClaim), VICTIM.owner],
    ['victim_claim_sixty_times_atomic', Array.from({ length: 60 }, () => victimClaim), VICTIM.owner],
  ];

  const results = [];
  for (const [label, instructions, payer] of specs) {
    try {
      const result = await simulate(label, instructions, payer, blockhash, before);
      results.push(result);
      const deltas = Object.fromEntries(Object.entries(result.deltas)
        .filter(([, delta]) => delta.tokenRaw !== null || delta.dataChanged)
        .map(([address, delta]) => [address, delta]));
      process.stdout.write(`${JSON.stringify({
        label,
        err: result.err,
        unitsConsumed: result.unitsConsumed,
        bytes: result.message.sizeBytes,
        accounts: result.message.addressCount,
        instructions: result.message.instructionCount,
        deltas,
        tail: result.logs.slice(-8),
      })}\n`);
    } catch (error) {
      results.push({ label, localError: error.stack || error.message });
      process.stdout.write(`${JSON.stringify({ label, localError: error.message })}\n`);
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    method: 'read-only mainnet simulateTransaction; sigVerify:false; no transaction signed or submitted',
    target: {
      programId: PROGRAM.toBase58(),
      config: CONFIG.toBase58(),
      otherConfig: OTHER_CONFIG.toBase58(),
      authority: AUTH.toBase58(),
      vault: VAULT.toBase58(),
      mint: FOXY_MINT.toBase58(),
      claimDiscriminatorHex: claimDiscriminator.toString('hex'),
    },
    derivations: {
      authority: { address: derivedAuth.toBase58(), bump: authBump, matches: derivedAuth.equals(AUTH), seeds: ['config_pubkey', 'auth'] },
      otherAuthority: { address: derivedOtherAuth.toBase58(), bump: otherAuthBump },
      victimStake: { address: derivedVictimStake.toBase58(), bump: victimStakeBump, matches: derivedVictimStake.equals(VICTIM.stake), seeds: ['owner_pubkey', 'stake', 'nft_mint_pubkey'] },
      attackerStake: { address: derivedAttackerStake.toBase58(), bump: attackerStakeBump, matches: derivedAttackerStake.equals(ATTACKER.stake), seeds: ['owner_pubkey', 'stake', 'nft_mint_pubkey'] },
      victimFoxyAta: { address: victimAta.toBase58(), matches: victimAta.equals(VICTIM.destination) },
      attackerFoxyAta: { address: attackerAta.toBase58(), matches: attackerAta.equals(ATTACKER.destination) },
    },
    roles: {
      victim: Object.fromEntries(Object.entries(VICTIM).map(([key, value]) => [key, value.toBase58()])),
      outsiderControl: Object.fromEntries(Object.entries(ATTACKER).map(([key, value]) => [key, value.toBase58()])),
    },
    preSnapshot: before,
    limits: { maxWireBytes: 4096, maxInlineAccounts: 64 },
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`wrote ${OUT}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
