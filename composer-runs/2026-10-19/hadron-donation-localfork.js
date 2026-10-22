#!/usr/bin/env node
// Isolated local-validator comparison using the exact current Hadron binary.
// Mainnet is read-only. Signed transactions are sent only to 127.0.0.1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const {Connection, Keypair, PublicKey, Transaction} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const spl = require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const {Hadron} = require('./hadron-sdk/package/dist/index.js');

const P = value => new PublicKey(value);
const PROGRAM = P('HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8');
const mode = process.argv[2] === 'dgld' ? 'dgld' : 'stable';
const POOL = P(mode === 'dgld' ? 'rQsUkcKpia3v3VykWVNZWALuYehNZSTTjDa7qJ3oxWs' : 'GPHRA3MJGT4ERmsq3sgt9Mcf3WVdG81oJia7yuLZ6ixU');
const PROGRAM_SO = path.join(__dirname, 'hadron-binary-state-current.so');
const USER_BALANCE = 50_000n * 1_000_000n;
const SWAP_IN = 1_000n * 1_000_000n;

const envRow = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8').split(/\r?\n/)
  .find(x => /^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if (!envRow) throw Error('SOLANA_RPC missing');
const mainnet = new Connection(envRow.slice(envRow.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, ''), 'confirmed');

function fixture(address, account, data = account.data) {
  return {pubkey: address.toBase58(), account: {lamports: account.lamports,
    data: [Buffer.from(data).toString('base64'), 'base64'], owner: account.owner.toBase58(),
    executable: account.executable, rentEpoch: 0, space: Buffer.from(data).length}};
}
function writeFixture(dir, address, account, data = account.data) {
  fs.writeFileSync(path.join(dir, `${address.toBase58()}.json`), JSON.stringify(fixture(address, account, data)) + '\n');
}
function tokenData(source, mint, owner, amount) {
  const data = Buffer.from(source);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt32LE(0, 72); data.fill(0, 76, 108); data[108] = 1;
  data.writeUInt32LE(0, 109); data.fill(0, 113, 121); data.writeBigUInt64LE(0n, 121);
  data.writeUInt32LE(0, 129); data.fill(0, 133, 165);
  return data;
}
function amount(data) { return data.readBigUInt64LE(64); }
async function waitHealthy(connection, child, log) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode != null) throw Error(`validator exited ${child.exitCode}: ${log.join('').slice(-4000)}`);
    try { if (await connection.getVersion()) return; } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw Error('validator startup timeout');
}
async function stop(child) {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 5000))]);
  if (child.exitCode == null) child.kill('SIGKILL');
}
async function confirm(connection, signature) {
  for (let i = 0; i < 120; i++) {
    const s = (await connection.getSignatureStatuses([signature])).value[0];
    if (s?.err) throw Error(`local transaction failed ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw Error('signature confirmation timeout');
}

async function runScenario(root, base, user, userX, userY, side, donationSide, donationRaw, index) {
  const fixtureDir = path.join(root, `fixtures-${index}`); fs.mkdirSync(fixtureDir);
  const vaultXData = Buffer.from(base.vaultX.data); const vaultYData = Buffer.from(base.vaultY.data);
  if (donationSide === 'x') vaultXData.writeBigUInt64LE(amount(vaultXData) + donationRaw, 64);
  if (donationSide === 'y') vaultYData.writeBigUInt64LE(amount(vaultYData) + donationRaw, 64);
  const oracleData = Buffer.from(base.oracle.data); oracleData.writeBigUInt64LE(0n, 56); // freshness-only rebase
  for (const item of base.fixed) writeFixture(fixtureDir, item.address, item.account);
  writeFixture(fixtureDir, base.oracleAddress, base.oracle, oracleData);
  writeFixture(fixtureDir, base.vaultXAddress, base.vaultX, vaultXData);
  writeFixture(fixtureDir, base.vaultYAddress, base.vaultY, vaultYData);
  writeFixture(fixtureDir, userX, base.vaultX, tokenData(base.vaultX.data, base.mintX, user.publicKey, USER_BALANCE));
  writeFixture(fixtureDir, userY, base.vaultY, tokenData(base.vaultY.data, base.mintY, user.publicKey, USER_BALANCE));
  const rpcPort = 19100 + index, faucetPort = 20100 + index;
  const log = [];
  const child = spawn('solana-test-validator', ['--ledger', path.join(root, `ledger-${index}`), '--reset', '--quiet',
    '--rpc-port', String(rpcPort), '--faucet-port', String(faucetPort), '--account-dir', fixtureDir,
    '--bpf-program', PROGRAM.toBase58(), PROGRAM_SO], {stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.on('data', x => log.push(x.toString())); child.stderr.on('data', x => log.push(x.toString()));
  const local = new Connection(`http://127.0.0.1:${rpcPort}`, 'confirmed');
  try {
    await waitHealthy(local, child, log);
    const airdrop = await local.requestAirdrop(user.publicKey, 2_000_000_000); await confirm(local, airdrop);
    const h = await Hadron.load(local, POOL);
    const before = await local.getMultipleAccountsInfo([userX, userY, h.addresses.vaultX, h.addresses.vaultY], 'confirmed');
    const ix = h.swap(user.publicKey, {isX: side === 'x', amountIn: SWAP_IN, minOut: 0n, expiration: 9223372036854775807n});
    // The deployed program intentionally ignores account 6; alias it to config as observed in live swaps.
    ix.keys[6].pubkey = POOL;
    const latest = await local.getLatestBlockhash('confirmed');
    const tx = new Transaction({feePayer: user.publicKey, recentBlockhash: latest.blockhash}).add(ix); tx.sign(user);
    const signature = await local.sendRawTransaction(tx.serialize(), {skipPreflight: false, preflightCommitment: 'confirmed'});
    await confirm(local, signature);
    const after = await local.getMultipleAccountsInfo([userX, userY, h.addresses.vaultX, h.addresses.vaultY], 'confirmed');
    const image = rows => rows.map(x => amount(x.data));
    const a = image(before), b = image(after);
    return {side, donationSide, donationRaw: donationRaw.toString(), localSignature: signature,
      before: a.map(String), after: b.map(String), delta: a.map((v, i) => (b[i] - v).toString()),
      outputRaw: (side === 'x' ? b[1] - a[1] : b[0] - a[0]).toString()};
  } finally { await stop(child); }
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hadron-donation-fork-'));
  const user = Keypair.generate();
  const h = await Hadron.load(mainnet, POOL);
  const userX = spl.getAssociatedTokenAddressSync(h.config.mintX, user.publicKey, false, h.config.tokenProgramX);
  const userY = spl.getAssociatedTokenAddressSync(h.config.mintY, user.publicKey, false, h.config.tokenProgramY);
  const feeX = spl.getAssociatedTokenAddressSync(h.config.mintX, h.feeConfig.feeRecipient, true, h.config.tokenProgramX);
  const feeY = spl.getAssociatedTokenAddressSync(h.config.mintY, h.feeConfig.feeRecipient, true, h.config.tokenProgramY);
  const extraMints = [
    ...(h.needsCheckedTransferX ? [h.config.mintX] : []),
    ...(h.needsCheckedTransferY ? [h.config.mintY] : [])
  ];
  const fixedAddresses = [h.poolAddress, h.addresses.curveMeta, h.addresses.curvePrefabs, h.addresses.curveUpdates,
    h.feeConfigPda, feeX, feeY, ...extraMints];
  const addresses = [...fixedAddresses, h.addresses.midpriceOracle, h.addresses.vaultX, h.addresses.vaultY];
  const infos = await mainnet.getMultipleAccountsInfo(addresses, 'confirmed');
  if (infos.some(x => !x)) throw Error('missing mainnet fixture');
  const offset = fixedAddresses.length;
  const base = {mintX: h.config.mintX, mintY: h.config.mintY,
    oracleAddress: addresses[offset], oracle: infos[offset], vaultXAddress: addresses[offset + 1], vaultX: infos[offset + 1],
    vaultYAddress: addresses[offset + 2], vaultY: infos[offset + 2], fixed: fixedAddresses.map((address, i) => ({address, account: infos[i]}))};
  const rawX = amount(base.vaultX.data), rawY = amount(base.vaultY.data);
  const specs = [
    ['x', null, 0n], ['x', 'x', rawX], ['x', 'y', rawY],
    ['y', null, 0n], ['y', 'x', rawX], ['y', 'y', rawY]
  ];
  const scenarios = [];
  for (let i = 0; i < specs.length; i++) scenarios.push(await runScenario(root, base, user, userX, userY, ...specs[i], i));
  const output = {observedAtUtc: new Date().toISOString(), method: 'exact current deployed .so on isolated solana-test-validator; only oracle lastUpdateSlot rebased to 0 for local Clock freshness',
    safety: {mainnetTransactions: false, localOnly: true}, pool: POOL.toBase58(), currentVaultXRaw: rawX.toString(), currentVaultYRaw: rawY.toString(),
    swapInRaw: SWAP_IN.toString(), scenarios};
  fs.writeFileSync(path.join(__dirname, `hadron-donation-localfork-${mode}.json`), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
