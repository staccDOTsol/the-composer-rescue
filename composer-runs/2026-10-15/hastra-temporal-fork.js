#!/usr/bin/env node
// Isolated two-phase test-validator fork of an observed reward-to-price transition.
// Mainnet access is read-only. Transactions are signed and sent only to 127.0.0.1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
} = require(`${MOD}/@solana/web3.js`);

const P = (value) => new PublicKey(value);
const HAS = P('97V7JsExNC6yFWu5KjK1FLfVkNVvtMpAFL5QkLWKEGxY');
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const STAKE_CONFIG = P('4qZvMr1THcZzHFicLAv9MtAi7cBGzQ7EzaY4K4cyYF18');
const VAULT_CONFIG = P('3BgchdaQWVeHke4iTgagADkX6LPPjuQLuNYVvPwBUpWt');
const HAS_VAULT = P('FvkbfMm98jefJWrqkvXvsSZ9RFaRBae8k6c1jaYA5vY3');
const VAULT_AUTHORITY = P('DT7z9w9fGJ6sH7vmGbPCa5JLi2xp6XPrL61z2gctzmHb');
const MINT_AUTHORITY = P('EtnHujEkqJJbgfTA2aC6vgZp8DVgwG6KdBxt9V1J31KK');
const PRICE_CONFIG = P('Ev92L9D2CsPczeKHF3UWybQSweQCG4NRfexwJfVwyqsn');
const PRIME = P('3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7');
const WYLDS = P('8fr7WGTVFszfyNWRMXj6fRjZZAnDwmXwEpCrtzmUkdih');
const SOURCE_USER_WYLDS = P('AwqQ2SZEfrKrWAW1i9TFC1s8xModoh8xkKrduRPomr2i');
const SOURCE_USER_PRIME = P('4SYnQVuKwC1SJ9e3d8jdi614CFtADMkR69EwtY2JHwes');
const PROGRAM_SO = `${__dirname}/hastra-current.so`;
const OLD_PRICE = 1064716884235726713n;
const OLD_TIMESTAMP = 1792090584n;
const NEW_PRICE = 1064723917765092433n;
const NEW_TIMESTAMP = 1792093164n;
const FORK_NOW = BigInt(Math.floor(Date.now() / 1000));
const FORK_OLD_TIMESTAMP = FORK_NOW - 10n;
const FORK_NEW_TIMESTAMP = FORK_NOW - 5n;
const ASSETS_IN = 1_000_000n * 1_000_000n;

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^export\s+/, '');
    if (!cleaned || cleaned.startsWith('#')) continue;
    const i = cleaned.indexOf('=');
    if (i > 0) out[cleaned.slice(0, i)] = cleaned.slice(i + 1).replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = { ...readEnv('/tmp/composer-helius-rpc.env'), ...process.env };
const mainnetUrl = env.RPC_URL || env.HEAVY_RPC_URL;
if (!mainnetUrl) throw new Error('RPC_URL or HEAVY_RPC_URL is required');

const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
function writePositiveI128LE(buffer, offset, value) {
  buffer.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  buffer.writeBigUInt64LE(value >> 64n, offset + 8);
}
function tokenAmount(data) { return data.readBigUInt64LE(64); }
function mintSupply(data) { return data.readBigUInt64LE(36); }
function modifyTokenAccount(source, mint, owner, amount) {
  const data = Buffer.from(source);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt32LE(0, 72); // no delegate
  data.fill(0, 76, 108);
  data[108] = 1; // initialized
  data.writeUInt32LE(0, 109); // not native
  data.fill(0, 113, 121);
  data.writeBigUInt64LE(0n, 121);
  data.writeUInt32LE(0, 129); // no close authority
  data.fill(0, 133, 165);
  return data;
}
function modifyPriceAccount(source, price, timestamp) {
  const data = Buffer.from(source);
  writePositiveI128LE(data, 136, price);
  data.writeBigInt64LE(timestamp, 160);
  return data;
}
function fixture(address, account, data = account.data) {
  return {
    pubkey: address.toBase58(),
    account: {
      lamports: account.lamports,
      data: [Buffer.from(data).toString('base64'), 'base64'],
      owner: account.owner.toBase58(),
      executable: account.executable,
      rentEpoch: 0,
      space: Buffer.from(data).length,
    },
  };
}
function writeFixtures(directory, accounts) {
  fs.mkdirSync(directory, { recursive: true });
  for (const { address, account, data } of accounts) {
    fs.writeFileSync(path.join(directory, `${address.toBase58()}.json`),
      `${JSON.stringify(fixture(address, account, data))}\n`);
  }
}
function depositIx(user, userWylds, userPrime, amount) {
  return new TransactionInstruction({
    programId: HAS,
    keys: [
      [STAKE_CONFIG, false, false], [VAULT_CONFIG, false, false], [HAS_VAULT, false, true],
      [VAULT_AUTHORITY, false, false], [PRIME, false, true], [WYLDS, false, true],
      [MINT_AUTHORITY, false, false], [user, true, false], [userWylds, false, true],
      [userPrime, false, true], [PRICE_CONFIG, false, false], [TOKEN, false, false],
    ].map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })),
    data: Buffer.concat([Buffer.from('f223c68952e1f2b6', 'hex'), u64(amount)]),
  });
}
function redeemIx(user, userWylds, userPrime, amount) {
  return new TransactionInstruction({
    programId: HAS,
    keys: [
      [STAKE_CONFIG, false, false], [VAULT_CONFIG, false, false], [HAS_VAULT, false, true],
      [VAULT_AUTHORITY, false, false], [user, true, true], [HAS, false, false],
      [userWylds, false, true], [userPrime, false, true], [PRIME, false, true],
      [WYLDS, false, true], [PRICE_CONFIG, false, false], [TOKEN, false, false],
    ].map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })),
    data: Buffer.concat([Buffer.from('b80c569546c461e1', 'hex'), u64(amount)]),
  });
}
async function waitHealthy(connection, child) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode != null) throw new Error(`test-validator exited during startup with ${child.exitCode}`);
    try { if (await connection.getVersion()) return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out waiting for local test-validator');
}
async function startValidator(root, fixtures, rpcPort, faucetPort) {
  const ledger = path.join(root, `ledger-${rpcPort}`);
  const stderr = [];
  const child = spawn('solana-test-validator', [
    '--ledger', ledger, '--reset', '--quiet', '--rpc-port', String(rpcPort),
    '--faucet-port', String(faucetPort), '--account-dir', fixtures,
    '--bpf-program', HAS.toBase58(), PROGRAM_SO,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => stderr.push(chunk.toString()));
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
  const connection = new Connection(`http://127.0.0.1:${rpcPort}`, 'confirmed');
  try { await waitHealthy(connection, child); } catch (error) {
    throw new Error(`${error.message}\n${stderr.join('').slice(-4000)}`);
  }
  return { child, connection, stderr };
}
async function stopValidator(child) {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode == null) child.kill('SIGKILL');
}
async function fund(connection, user) {
  const sig = await connection.requestAirdrop(user.publicKey, 10_000_000_000);
  await waitSignature(connection, sig);
}
async function waitSignature(connection, signature) {
  for (let i = 0; i < 120; i += 1) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err) throw new Error(`local transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for local signature ${signature}`);
}
async function sendLocal(connection, transaction, signer) {
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.feePayer = signer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(signer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5,
  });
  await waitSignature(connection, signature);
  return signature;
}
async function image(connection, userWylds, userPrime) {
  const infos = await connection.getMultipleAccountsInfo([userWylds, userPrime, HAS_VAULT, PRIME], 'confirmed');
  return {
    userWyldsRaw: tokenAmount(infos[0].data).toString(),
    userPrimeRaw: tokenAmount(infos[1].data).toString(),
    vaultWyldsRaw: tokenAmount(infos[2].data).toString(),
    primeSupplyRaw: mintSupply(infos[3].data).toString(),
  };
}
function delta(before, after) {
  return Object.fromEntries(Object.keys(before).map((key) => [key,
    (BigInt(after[key]) - BigInt(before[key])).toString()]));
}

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hastra-temporal-fork-'));
  let phase1;
  let phase2;
  try {
    const mainnet = new Connection(mainnetUrl, 'confirmed');
    const baseKeys = [STAKE_CONFIG, VAULT_CONFIG, HAS_VAULT, PRIME, WYLDS, PRICE_CONFIG,
      SOURCE_USER_WYLDS, SOURCE_USER_PRIME];
    const baseInfos = await mainnet.getMultipleAccountsInfo(baseKeys, 'confirmed');
    if (baseInfos.some((info) => !info)) throw new Error('one or more mainnet fixture accounts are missing');
    const base = new Map(baseKeys.map((key, index) => [key.toBase58(), baseInfos[index]]));

    const user = Keypair.generate();
    const userWylds = Keypair.generate().publicKey;
    const userPrime = Keypair.generate().publicKey;
    const phase1Dir = path.join(scratch, 'phase1-fixtures');
    const userWyldsData = modifyTokenAccount(base.get(SOURCE_USER_WYLDS.toBase58()).data, WYLDS, user.publicKey, ASSETS_IN);
    const userPrimeData = modifyTokenAccount(base.get(SOURCE_USER_PRIME.toBase58()).data, PRIME, user.publicKey, 0n);
    const oldPriceData = modifyPriceAccount(base.get(PRICE_CONFIG.toBase58()).data, OLD_PRICE, FORK_OLD_TIMESTAMP);
    const commonAddresses = [STAKE_CONFIG, VAULT_CONFIG, HAS_VAULT, PRIME, WYLDS];
    const phase1Accounts = commonAddresses.map((address) => ({ address, account: base.get(address.toBase58()) }));
    phase1Accounts.push({ address: PRICE_CONFIG, account: base.get(PRICE_CONFIG.toBase58()), data: oldPriceData });
    phase1Accounts.push({ address: userWylds, account: base.get(SOURCE_USER_WYLDS.toBase58()), data: userWyldsData });
    phase1Accounts.push({ address: userPrime, account: base.get(SOURCE_USER_PRIME.toBase58()), data: userPrimeData });
    writeFixtures(phase1Dir, phase1Accounts);

    phase1 = await startValidator(scratch, phase1Dir, 18999, 19999);
    await fund(phase1.connection, user);
    const before = await image(phase1.connection, userWylds, userPrime);
    const depositSignature = await sendLocal(phase1.connection,
      new Transaction().add(depositIx(user.publicKey, userWylds, userPrime, ASSETS_IN)), user);
    const afterDeposit = await image(phase1.connection, userWylds, userPrime);
    const mintedShares = BigInt(afterDeposit.userPrimeRaw) - BigInt(before.userPrimeRaw);

    const phase2Keys = [STAKE_CONFIG, VAULT_CONFIG, HAS_VAULT, PRIME, WYLDS, PRICE_CONFIG, userWylds, userPrime];
    const postDepositInfos = await phase1.connection.getMultipleAccountsInfo(phase2Keys, 'confirmed');
    await stopValidator(phase1.child);
    phase1 = null;

    const phase2Dir = path.join(scratch, 'phase2-fixtures');
    const newPriceData = modifyPriceAccount(postDepositInfos[5].data, NEW_PRICE, FORK_NEW_TIMESTAMP);
    writeFixtures(phase2Dir, phase2Keys.map((address, index) => ({
      address, account: postDepositInfos[index], data: index === 5 ? newPriceData : postDepositInfos[index].data,
    })));
    phase2 = await startValidator(scratch, phase2Dir, 19099, 20099);
    await fund(phase2.connection, user);
    const beforeRedeem = await image(phase2.connection, userWylds, userPrime);
    const redeemSignature = await sendLocal(phase2.connection,
      new Transaction().add(redeemIx(user.publicKey, userWylds, userPrime, mintedShares)), user);
    const afterRedeem = await image(phase2.connection, userWylds, userPrime);

    const finalVsInitial = delta(before, afterRedeem);
    const output = {
      generatedAt: new Date().toISOString(),
      method: 'two isolated local test-validator phases using the exact current on-chain .so; mainnet was read-only',
      safety: { mainnetTransactionsSignedOrSent: false, localOnlyRpc: ['127.0.0.1:18999', '127.0.0.1:19099'] },
      observedTransition: {
        oldPriceRaw: OLD_PRICE.toString(), oldObservationTimestamp: OLD_TIMESTAMP.toString(),
        newPriceRaw: NEW_PRICE.toString(), newObservationTimestamp: NEW_TIMESTAMP.toString(),
      },
      localForkFreshnessAnchors: {
        oldTimestamp: FORK_OLD_TIMESTAMP.toString(), newTimestamp: FORK_NEW_TIMESTAMP.toString(),
        note: 'The observed price values are exact. Local timestamps are rebased only to satisfy the deployed one-hour freshness guard on reproducible later runs; timestamps do not enter either conversion formula.',
      },
      syntheticOutsider: user.publicKey.toBase58(),
      localSignatures: { deposit: depositSignature, redeem: redeemSignature },
      before, afterDeposit, beforeRedeem, afterRedeem,
      mintedSharesRaw: mintedShares.toString(),
      depositDelta: delta(before, afterDeposit),
      redeemDelta: delta(beforeRedeem, afterRedeem),
      finalVsInitial,
      reconciliation: {
        userPrimeReturnedToInitial: afterRedeem.userPrimeRaw === before.userPrimeRaw,
        primeSupplyReturnedToInitial: afterRedeem.primeSupplyRaw === before.primeSupplyRaw,
        userNetGainWyldsRaw: finalVsInitial.userWyldsRaw,
        vaultNetLossWyldsRaw: finalVsInitial.vaultWyldsRaw,
        userGainEqualsVaultLoss: BigInt(finalVsInitial.userWyldsRaw) === -BigInt(finalVsInitial.vaultWyldsRaw),
      },
    };
    fs.writeFileSync(`${__dirname}/hastra-temporal-fork.json`, `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify(output, null, 2));
  } finally {
    if (phase1) await stopValidator(phase1.child);
    if (phase2) await stopValidator(phase2.child);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
