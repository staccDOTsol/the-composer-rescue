#!/usr/bin/env node
'use strict';

// Signed, fork-only XP1BR ONyc mathematical screen. The outsider's ONyc ATA is
// seeded synthetically on loopback, so these cases can disprove arithmetic
// precursors but can never establish feasible funding or a reportable gain.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const spl = require(`${modules}@solana/spl-token`);
const {Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage,
  VersionedTransaction} = require(`${modules}@solana/web3.js`);

const DIR = __dirname;
const OUT = path.join(DIR, 'xp1br-onyc-synthetic-extremes.json');
const REFRESH = JSON.parse(fs.readFileSync(path.join(DIR, 'xp1br-onyc-current-refresh.json'), 'utf8'));
const INVENTORY = JSON.parse(fs.readFileSync(path.join(DIR, '..', '2026-10-15',
  'xp1br-current-inventory.json'), 'utf8'));
const RPC = process.env.XP1BR_FORK_RPC || 'http://127.0.0.1:18997';
const P = (value) => new PublicKey(value);
const XP = P('XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy');
const META = P('BmLiVHRb9ppTrEA5jhTgNJ2WFtjUZEkfzJZGswEidxzu');
const ONYC = P('5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5');
const SY = P('G1qbuP11CdquJCzuDjruWqatQAHroajmxhLfeQVgHosF');
const VAULT = P('2bBGqb9qY7e2q6pFDKdsHqDoQiGmaeDKktezXJ2AcGDo');
const SY_ESCROW = P('5muRaHt3Zb2c1NK8T11ygTMUpf2sAhxQU6Z7Ayx2iCvU');
const SCOPE = P('3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const SYSTEM = SystemProgram.programId;
let rpcId = 0;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const delta = (after, before) => (BigInt(after) - BigInt(before)).toString();

async function rpc(method, params) {
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    signal: AbortSignal.timeout(30000)});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function tokenData(mint, owner, amount) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data[108] = 1;
  return data;
}

function amount(account, mint = false) {
  if (!account?.data) return '0';
  const data = Buffer.from(account.data[0], 'base64');
  return (mint ? data.readBigUInt64LE(36) : data.readBigUInt64LE(64)).toString();
}

function mintIx(user, userBase, userSy, requested, interfaceAccount = SCOPE,
  source = userBase) {
  return new TransactionInstruction({programId: XP, keys: [
    {pubkey: user, isSigner: true, isWritable: true},
    {pubkey: META, isSigner: false, isWritable: true},
    {pubkey: SY, isSigner: false, isWritable: true},
    {pubkey: ONYC, isSigner: false, isWritable: false},
    {pubkey: source, isSigner: false, isWritable: true},
    {pubkey: VAULT, isSigner: false, isWritable: true},
    {pubkey: userSy, isSigner: false, isWritable: true},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: interfaceAccount, isSigner: false, isWritable: true},
  ], data: Buffer.concat([Buffer.from([1]), u64(requested)])});
}

function redeemIx(user, userBase, userSy, requested, interfaceAccount = SCOPE,
  sourceSy = userSy, destination = userBase) {
  return new TransactionInstruction({programId: XP, keys: [
    {pubkey: user, isSigner: true, isWritable: true},
    {pubkey: META, isSigner: false, isWritable: true},
    {pubkey: destination, isSigner: false, isWritable: true},
    {pubkey: VAULT, isSigner: false, isWritable: true},
    {pubkey: sourceSy, isSigner: false, isWritable: true},
    {pubkey: SY, isSigner: false, isWritable: true},
    {pubkey: ONYC, isSigner: false, isWritable: false},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: interfaceAccount, isSigner: false, isWritable: true},
  ], data: Buffer.concat([Buffer.from([2]), u64(requested)])});
}

function compact(logs) {
  return (logs || []).filter((line) => line.includes('Instruction:') ||
    line.includes('Error') || line.includes('failed') || line.includes(`${XP} success`));
}

async function main() {
  const user = Keypair.generate();
  const userBase = spl.getAssociatedTokenAddressSync(ONYC, user.publicKey);
  const userSy = spl.getAssociatedTokenAddressSync(SY, user.publicKey);
  const vaultRaw = BigInt(REFRESH.balances.principalVaultRaw);
  const sySupplyRaw = BigInt(REFRESH.balances.syMintSupplyRaw);
  const seedRaw = vaultRaw + 1n;
  await rpc('surfnet_setAccount', [user.publicKey.toBase58(), {data: '', executable: false,
    lamports: 100_000_000_000, owner: SYSTEM.toBase58(), rentEpoch: 0}]);
  await rpc('surfnet_setAccount', [userBase.toBase58(), {data: tokenData(ONYC, user.publicKey,
    seedRaw).toString('hex'), executable: false, lamports: 2039280,
    owner: TOKEN.toBase58(), rentEpoch: 0}]);
  await rpc('surfnet_setAccount', [userSy.toBase58(), {data: tokenData(SY, user.publicKey, 0n)
    .toString('hex'), executable: false, lamports: 2039280, owner: TOKEN.toBase58(), rentEpoch: 0}]);

  const watched = [user.publicKey, userBase, userSy, VAULT, SY, SY_ESCROW, META];
  const baseline = await rpc('getMultipleAccounts', [watched.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  if (amount(baseline.value[1]) !== seedRaw.toString()) throw new Error('synthetic seed mismatch');
  const rateWord = String(REFRESH.meta.index['0'][0]);
  const rate = BigInt(/[a-f]/i.test(rateWord) ? `0x${rateWord}` : rateWord);
  const syForBase = (base) => BigInt(base) * 1_000_000_000_000n / rate;
  const wrongRow = INVENTORY.rows.find((row) => row.interfaceAccounts?.length &&
    row.interfaceAccounts[0] !== SCOPE.toBase58());
  const wrongRateAccount = wrongRow ? P(wrongRow.interfaceAccounts[0]) : ONYC;

  async function simulate(name, instructions, classification, details = {}) {
    const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
    const message = new TransactionMessage({payerKey: user.publicKey, recentBlockhash: blockhash,
      instructions}).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([user]);
    const wire = Buffer.from(tx.serialize());
    const result = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64',
      sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map(String)}}]);
    const value = result.value;
    const after = value.accounts || [];
    // `simulateTransaction.accounts` may return null for a watched account that
    // was not loaded by the transaction. SY escrow is intentionally watched as
    // a liability boundary but is not an input to direct mint/redeem.
    if (after[5] == null) after[5] = baseline.value[5];
    const completed = !value.err;
    const equity = completed ? {
      outsiderOnycDeltaRaw: delta(amount(after[1]), amount(baseline.value[1])),
      outsiderSyDeltaRaw: delta(amount(after[2]), amount(baseline.value[2])),
      outsiderLamportsDelta: delta(String(after[0].lamports), String(baseline.value[0].lamports)),
      vaultOnycDeltaRaw: delta(amount(after[3]), amount(baseline.value[3])),
      syMintSupplyDeltaRaw: delta(amount(after[4], true), amount(baseline.value[4], true)),
      syEscrowDeltaRaw: delta(amount(after[5]), amount(baseline.value[5])),
    } : null;
    const tokenCpis = (value.innerInstructions || []).flatMap((row) => row.instructions || [])
      .filter((ix) => ix.program === 'spl-token' && ix.parsed).map((ix) => ix.parsed);
    return {name, classification, details, liveSubmission: false, localForkOnly: true,
      syntheticOnycSeedRaw: seedRaw.toString(), syntheticSeedExcludedFromProfit: true,
      signatureVerification: true, txVersion: 1, sizeBytes: wire.length,
      addressCount: message.staticAccountKeys.length, wireSha256: sha256(wire), err: value.err,
      unitsConsumed: value.unitsConsumed, equity, xpExecution: {
        mintLogged: (value.logs || []).some((line) => line === 'Program log: Instruction: Mint'),
        redeemLogged: (value.logs || []).some((line) => line === 'Program log: Instruction: Redeem'),
        successLogCount: (value.logs || []).filter((line) => line === `Program ${XP} success`).length,
      }, tokenCpis, trace: compact(value.logs)};
  }

  const cases = [];
  const sizes = [...new Set([1n, 2n, 3n, 999n, 1_000n, 1_000_000_000n,
    vaultRaw / 1000n, vaultRaw / 100n, vaultRaw / 10n, vaultRaw - 1n, vaultRaw])];
  for (const base of sizes) cases.push(await simulate(`roundtrip_${base}`, [
    mintIx(user.publicKey, userBase, userSy, base),
    redeemIx(user.publicKey, userBase, userSy, syForBase(base)),
  ], 'synthetic-rounding-extreme', {requestedBaseRaw: base.toString(),
    computedRedeemRaw: syForBase(base).toString(), rateWord: rate.toString()}));
  for (const cycles of [2, 4, 8]) {
    const base = 1_000_000n;
    const instructions = Array.from({length: cycles}, () => [
      mintIx(user.publicKey, userBase, userSy, base),
      redeemIx(user.publicKey, userBase, userSy, syForBase(base)),
    ]).flat();
    cases.push(await simulate(`roundtrip_${cycles}_cycles_${base}`, instructions,
      'synthetic-rounding-repetition', {cycles, requestedBaseRaw: base.toString()}));
  }
  const probe = 1_000_000n;
  cases.push(await simulate('protocol_sy_escrow_as_outsider_redeem_source', [
    mintIx(user.publicKey, userBase, userSy, probe),
    redeemIx(user.publicKey, userBase, userSy, syForBase(probe), SCOPE, SY_ESCROW),
  ], 'synthetic-authorization-probe'));
  cases.push(await simulate('principal_vault_as_outsider_mint_source', [
    mintIx(user.publicKey, userBase, userSy, probe, SCOPE, VAULT),
  ], 'synthetic-authorization-probe'));
  cases.push(await simulate('principal_vault_as_redeem_destination', [
    mintIx(user.publicKey, userBase, userSy, probe),
    redeemIx(user.publicKey, userBase, userSy, syForBase(probe), SCOPE, userSy, VAULT),
  ], 'synthetic-alias-probe'));
  cases.push(await simulate('redeem_one_more_than_fresh_shares', [
    mintIx(user.publicKey, userBase, userSy, probe),
    redeemIx(user.publicKey, userBase, userSy, syForBase(probe) + 1n),
  ], 'synthetic-share-liability-probe'));
  cases.push(await simulate('unrelated_rate_input_account', [
    mintIx(user.publicKey, userBase, userSy, probe, wrongRateAccount),
  ], 'synthetic-rate-input-probe', {suppliedRateAccount: wrongRateAccount.toBase58(),
    sourceMeta: wrongRow?.meta || null, sourceSymbol: wrongRow?.symbol || null}));

  const successes = cases.filter((row) => !row.err);
  const positive = successes.filter((row) => row.equity &&
    (BigInt(row.equity.outsiderOnycDeltaRaw) > 0n || BigInt(row.equity.outsiderSyDeltaRaw) > 0n));
  const output = {generatedAt: new Date().toISOString(), safety:
    'Loopback current-mainnet-backed fork only; synthetic outsider ONyc seed is explicit and excluded from profit; all transactions are signed with sigVerify:true; nothing broadcast.',
    deploymentElfSha256: REFRESH.deployment.executableSha256,
    baseline: {forkSlot: baseline.context.slot, syntheticOnycSeedRaw: seedRaw.toString(),
      principalVaultRaw: amount(baseline.value[3]), syMintSupplyRaw: amount(baseline.value[4], true),
      rawBackingSurplus: (BigInt(amount(baseline.value[3])) - BigInt(amount(baseline.value[4], true))).toString(),
      rateWord: rate.toString()},
    criteria: {syntheticPositiveIsOnlyMathematicalPrecursor: true, maxWireBytes: 4096,
      maxInlineAddresses: 64},
    summary: {cases: cases.length, succeeded: successes.length, failed: cases.length - successes.length,
      maximumWireBytes: Math.max(...cases.map((row) => row.sizeBytes)),
      maximumInlineAddresses: Math.max(...cases.map((row) => row.addressCount)),
      syntheticPositiveTokenEquityCases: positive.map((row) => row.name),
      feasibleValidatedFindingCount: 0}, cases};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({output: OUT, baseline: output.baseline,
    summary: output.summary, outcomes: cases.map((row) => ({name: row.name, err: row.err,
      equity: row.equity, xpExecution: row.xpExecution}))}, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
