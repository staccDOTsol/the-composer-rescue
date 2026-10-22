#!/usr/bin/env node
'use strict';

// Current-state local-fork probes only. Transactions are signed by fresh
// ephemeral outsiders and passed only to simulateTransaction with sigVerify:true.
// There is deliberately no sendTransaction path.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const { encodeV1 } = require('../klend-v1-composition.js');

const P = (value) => new PublicKey(value);
const FORK = process.env.MANGO_FORK_RPC || 'http://127.0.0.1:8997';
const OUT = process.argv[2] || path.join(__dirname, 'signed-outsider-claim.json');
const PROGRAM = P('DisJzzeTrLXzJgtaaqBxcNKLrLFyc4mY3ELGCdEkVPzt');
const COLLECTION = P('3JaWRPs677Q22oLz3xT1rPD7yhCEL3Njp9raruM81VCS');
const COLLECTED_MINT = P('MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac');
const COLLECTION_VAULT = P('AgLqWkeqAVrQbj1tMuTAtAao1oRVXScVjrPRmBC5AxeY');
const REPLACEMENT_MINT = P('8cE4psxE5z8eVrMWdQPtcSpPewv36PJeu15J5KnmdBLk');
const CLAIM_AMOUNT = 1_000_000n; // 1 MNGO
const distributions = [
  ['6RpPxMhr8xkJZw3GS2sYGc9d61Srhui2bjq1jb13o732', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '9LxNd3Cahh2m41R1KC9wduQCSRpXWrfXLis4p9gSVEXp'],
  ['5PFAENJVM72sh4JJckZWC9ywarCMmUTPse8KRguttSV8', 'So11111111111111111111111111111111111111112', 'B4YLApaHDrHwhSdwySqknywi1pPLEqN55qUe9iHuGByV'],
  ['EHEiVfCesSsa7TDwMAL1kCZBHPZhFJ6mgxNcvvbpEYxb', '3jsFX1tx2Z8ewmamiwSU851GzyzM2DJMq7KWW5DM8Py3', 'CP9YwdnFz5sZXMJSMghXu4YGvYoa1UjSbAzTMMLt6adu'],
  ['27BKiiUbJAUXBZSAs7defx1BDPmciWLf7kCoLiNfHajm', '6DNSN2BJsaPFdFFc1zP37kkeNe4Usc1Sqkzr9C9vPWcU', '5rjkXaWbou7xhgFdBknuUG3g1ZgNHn61Ae1pigCKyv7'],
  ['Fny8P3Wy5uu2RpjqeF1iPBDwwisoC2Yj2t4ds4HiT1vS', 'ZScHuTtqZukUrtZS43teTKGs2VqkKL8k4QCouR2n6Uo', 'CEg6ayeV7B71Pd9mEQbcLejXmeaoTGcM7mJxwBHGFtaD'],
  ['4NcjVs9xEsP7ny7Ku9fAxBdEgA7vPgWTDhssSs7v6bsd', 'MangmsBgFqJhW4cLUR9LxfVgMboY1xAoP8UUBiWwwuY', 'EukVHqQDMUy8La6R9KR7PHPh5YYmBZt8XoYNuYvmWXsE'],
].map(([distribution, mint, vault]) => ({ distribution: P(distribution), mint: P(mint), vault: P(vault) }));

let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(FORK, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${method}: ${response.status} ${JSON.stringify(body.error || body)}`);
  return body.result;
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out; };
const discriminator = (name) => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

function tokenData(mint, owner, amount) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data;
}

async function setSystemAccount(owner) {
  await rpc('surfnet_setAccount', [owner.toBase58(), {
    data: '', executable: false, lamports: 10_000_000_000,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
}

async function setTokenAccount(address, mint, owner, amount) {
  await rpc('surfnet_setAccount', [address.toBase58(), {
    data: tokenData(mint, owner, amount).toString('hex'), executable: false,
    lamports: 2_039_280, owner: TOKEN_PROGRAM_ID.toBase58(), rentEpoch: 0,
  }]);
}

function claimIx(user, userAccounts, wrongMangoSolRecipient = null) {
  const termsHash = Buffer.from('caa45210e2028549922a81611f58408114d96af0999eb77d32e8b839370bb9cb', 'hex');
  const keys = [
    { pubkey: COLLECTION, isSigner: false, isWritable: true },
    { pubkey: COLLECTED_MINT, isSigner: false, isWritable: true },
    { pubkey: userAccounts.get(COLLECTED_MINT.toBase58()), isSigner: false, isWritable: true },
    { pubkey: COLLECTION_VAULT, isSigner: false, isWritable: true },
    { pubkey: REPLACEMENT_MINT, isSigner: false, isWritable: true },
    { pubkey: userAccounts.get(REPLACEMENT_MINT.toBase58()), isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  for (const entry of distributions) {
    keys.push(
      { pubkey: entry.distribution, isSigner: false, isWritable: true },
      { pubkey: entry.vault, isSigner: false, isWritable: true },
      { pubkey: wrongMangoSolRecipient && entry.mint.toBase58() === distributions[5].mint.toBase58()
        ? wrongMangoSolRecipient : userAccounts.get(entry.mint.toBase58()), isSigner: false, isWritable: true },
    );
  }
  return new TransactionInstruction({
    programId: PROGRAM,
    keys,
    data: Buffer.concat([discriminator('user_commit_and_claim_stateless'), u64(CLAIM_AMOUNT), termsHash]),
  });
}

function signV1(encoded, instructions, payer, keypair, blockhash) {
  const compiled = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  if (signerOrder.length !== 1 || signerOrder[0] !== keypair.publicKey.toBase58()) throw new Error(`unexpected signers: ${signerOrder}`);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(keypair.secretKey.subarray(0, 32))]),
    format: 'der', type: 'pkcs8',
  });
  crypto.sign(null, message, privateKey).copy(signed, signed.length - 64);
  return { signed, signerOrder };
}

function accountImage(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const out = { owner: account.owner, dataLength: data.length, dataSha256: sha256(data) };
  if (account.owner === TOKEN_PROGRAM_ID.toBase58() && data.length >= 165) out.rawAmount = data.readBigUInt64LE(64).toString();
  return out;
}

async function snapshot(addresses) {
  const result = await rpc('getMultipleAccounts', [addresses.map(String), { encoding: 'base64', commitment: 'processed' }]);
  return { slot: result.context.slot, accounts: Object.fromEntries(addresses.map((address, index) => [String(address), accountImage(result.value[index])])) };
}

async function simulate(label, instructions, user, blockhash, watched) {
  const encoded = encodeV1(instructions, user.publicKey, blockhash, 1_400_000, 67_108_864);
  const { signed, signerOrder } = signV1(encoded, instructions, user.publicKey, user, blockhash);
  const before = await snapshot(watched);
  const result = await rpc('simulateTransaction', [signed.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: { encoding: 'base64', addresses: watched.map(String) },
  }]);
  const post = Object.fromEntries(watched.map((address, index) => [String(address), accountImage(result.value.accounts?.[index])]));
  const after = await snapshot(watched);
  return {
    label, simulationSlot: result.context.slot, err: result.value.err || null,
    unitsConsumed: result.value.unitsConsumed, logs: result.value.logs || [],
    innerInstructions: result.value.innerInstructions || [],
    message: { format: 'solana-v1', sigVerify: true, replaceRecentBlockhash: false,
      sizeBytes: encoded.sizeBytes, addressCount: encoded.addressCount,
      instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      signerOrder, sha256: sha256(signed) },
    before: before.accounts, simulatedPost: post, forkAfter: after.accounts,
    forkStateUnchanged: JSON.stringify(before.accounts) === JSON.stringify(after.accounts),
  };
}

async function main() {
  const outsider = Keypair.generate();
  const other = Keypair.generate();
  await setSystemAccount(outsider.publicKey);
  await setSystemAccount(other.publicKey);

  const mints = [COLLECTED_MINT, REPLACEMENT_MINT, ...distributions.map((entry) => entry.mint)];
  const userAccounts = new Map();
  for (const mint of mints) {
    const ata = getAssociatedTokenAddressSync(mint, outsider.publicKey);
    userAccounts.set(mint.toBase58(), ata);
    await setTokenAccount(ata, mint, outsider.publicKey, mint.equals(COLLECTED_MINT) ? CLAIM_AMOUNT : 0n);
  }
  const wrongMangoSolAta = getAssociatedTokenAddressSync(distributions[5].mint, other.publicKey);
  await setTokenAccount(wrongMangoSolAta, distributions[5].mint, other.publicKey, 0n);
  const otherMngoAta = getAssociatedTokenAddressSync(COLLECTED_MINT, other.publicKey);
  await setTokenAccount(otherMngoAta, COLLECTED_MINT, other.publicKey, CLAIM_AMOUNT);

  const watched = [COLLECTION, COLLECTION_VAULT, ...distributions.flatMap((entry) => [entry.distribution, entry.vault]), ...userAccounts.values(), wrongMangoSolAta, otherMngoAta];
  const blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'processed' }])).value.blockhash;
  const base = claimIx(outsider.publicKey, userAccounts);
  const wrongRecipientIx = claimIx(outsider.publicKey, userAccounts, wrongMangoSolAta);
  const wrongSourceIx = new TransactionInstruction({ programId: base.programId,
    keys: base.keys.map((entry, index) => index === 2 ? { ...entry, pubkey: otherMngoAta } : { ...entry }),
    data: Buffer.from(base.data) });
  const wrongTermsIx = new TransactionInstruction({ programId: base.programId,
    keys: base.keys.map((entry) => ({ ...entry })), data: Buffer.from(base.data) });
  wrongTermsIx.data[wrongTermsIx.data.length - 1] ^= 1;
  const duplicateDistributionIx = new TransactionInstruction({ programId: base.programId,
    keys: base.keys.map((entry) => ({ ...entry })), data: Buffer.from(base.data) });
  duplicateDistributionIx.keys.splice(25, 3, ...duplicateDistributionIx.keys.slice(10, 13).map((entry) => ({ ...entry })));
  const cases = [];
  cases.push(await simulate('signed_one_mngo_claim_control', [base], outsider, blockhash, watched));
  cases.push(await simulate('signed_foreign_source_account', [wrongSourceIx], outsider, blockhash, watched));
  cases.push(await simulate('signed_wrong_terms_hash', [wrongTermsIx], outsider, blockhash, watched));
  cases.push(await simulate('signed_duplicate_distribution', [duplicateDistributionIx], outsider, blockhash, watched));
  cases.push(await simulate('signed_duplicate_claim_atomic_replay', [base, base], outsider, blockhash, watched));
  cases.push(await simulate('signed_mangosol_recipient_substitution', [wrongRecipientIx], outsider, blockhash, watched));
  const output = {
    generatedAt: new Date().toISOString(), fork: FORK,
    noLiveSubmission: true, claimAmountRaw: CLAIM_AMOUNT.toString(),
    outsider: outsider.publicKey.toBase58(), otherOutsider: other.publicKey.toBase58(),
    userTokenAccounts: Object.fromEntries(userAccounts), wrongMangoSolAta: wrongMangoSolAta.toBase58(),
    cases,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output.cases.map((entry) => ({
    label: entry.label, err: entry.err, unitsConsumed: entry.unitsConsumed,
    sizeBytes: entry.message.sizeBytes, addressCount: entry.message.addressCount,
    forkStateUnchanged: entry.forkStateUnchanged,
    logs: entry.logs.filter((line) => line.includes('Instruction:') || line.includes('Error') || line.includes('failed')).slice(-8),
  })), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
