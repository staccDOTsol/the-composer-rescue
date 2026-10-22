const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const requireWorkspace = process.env.WHIRLPOOLS_REPO
  ? createRequire(`${process.env.WHIRLPOOLS_REPO}/package.json`)
  : require;
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } = requireWorkspace('@solana/web3.js');

const PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const X64 = 1n << 64n;
const LIQUIDITY = 1_000_000_000n;
const POSITION_LIQUIDITY = 210_000_000n;
const GROWTH_STEP = X64 / LIQUIDITY;

function discriminator(namespace, name) {
  return createHash('sha256').update(`${namespace}:${name}`).digest().subarray(0, 8);
}

function u128(value) {
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(value & ((1n << 64n) - 1n), 0);
  buf.writeBigUInt64LE(value >> 64n, 8);
  return buf;
}

function encodeWhirlpool(growth, {liquidity = LIQUIDITY} = {}) {
  const out = Buffer.alloc(653);
  discriminator('account', 'Whirlpool').copy(out, 0);
  let i = 8;
  i += 32; // config pubkey
  i += 1; // PDA bump
  out.writeUInt16LE(1, i); i += 2; // tick spacing
  i += 2; // fee tier seed
  out.writeUInt16LE(3000, i); i += 2; // 0.3% fee
  i += 2; // protocol fee
  u128(liquidity).copy(out, i); i += 16;
  u128(X64).copy(out, i); i += 16; // sqrt price = 1
  out.writeInt32LE(0, i); i += 4; // current tick
  i += 8 + 8; // protocol fee owed
  i += 32 + 32; // A mint/vault
  u128(growth).copy(out, i); i += 16;
  i += 32 + 32; // B mint/vault
  i += 16; // B growth
  i += 8; // reward timestamp
  i += 384; // uninitialized rewards
  if (i !== out.length) throw new Error(`whirlpool layout ${i}`);
  return out;
}

function encodePosition(whirlpool, {liquidity = POSITION_LIQUIDITY, checkpointA = 0n, owedA = 0n} = {}) {
  const out = Buffer.alloc(216);
  discriminator('account', 'Position').copy(out, 0);
  let i = 8;
  whirlpool.toBuffer().copy(out, i); i += 32;
  i += 32; // position mint
  u128(liquidity).copy(out, i); i += 16;
  out.writeInt32LE(-1, i); i += 4;
  out.writeInt32LE(1, i); i += 4;
  u128(checkpointA).copy(out, i); i += 16;
  out.writeBigUInt64LE(owedA, i); i += 8;
  i += 16 + 8 + 72;
  if (i !== out.length) throw new Error(`position layout ${i}`);
  return out;
}

function encodeTickArray(whirlpool, start, initializedOffset) {
  const out = Buffer.alloc(9988);
  discriminator('account', 'TickArray').copy(out, 0);
  out.writeInt32LE(start, 8);
  out[12 + initializedOffset * 113] = 1;
  whirlpool.toBuffer().copy(out, 12 + 88 * 113);
  return out;
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function setAccount(url, key, owner, data, lamports) {
  return rpc(url, 'surfnet_setAccount', [key.toBase58(), {
    data: data.toString('hex'), owner: owner.toBase58(),
    lamports, executable: false, rentEpoch: 0,
  }]);
}

function owed(data) { return data.readBigUInt64LE(8 + 32 + 32 + 16 + 4 + 4 + 16); }
function checkpoint(data) {
  const i = 8 + 32 + 32 + 16 + 4 + 4;
  return data.readBigUInt64LE(i) + (data.readBigUInt64LE(i + 8) << 64n);
}

async function main(url) {
  const connection = new Connection(url, 'confirmed');
  const payer = Keypair.generate();
  const whirlpool = Keypair.generate().publicKey;
  const position = Keypair.generate().publicKey;
  const lower = Keypair.generate().publicKey;
  const upper = Keypair.generate().publicKey;

  await setAccount(url, payer.publicKey, SystemProgram.programId, Buffer.alloc(0), 1_000_000_000);
  await setAccount(url, whirlpool, PROGRAM, encodeWhirlpool(0n), 10_000_000);
  await setAccount(url, position, PROGRAM, encodePosition(whirlpool), 10_000_000);
  await setAccount(url, lower, PROGRAM, encodeTickArray(whirlpool, -88, 87), 100_000_000);
  await setAccount(url, upper, PROGRAM, encodeTickArray(whirlpool, 0, 1), 100_000_000);

  const ix = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      {pubkey: whirlpool, isSigner: false, isWritable: true},
      {pubkey: position, isSigner: false, isWritable: true},
      {pubkey: lower, isSigner: false, isWritable: false},
      {pubkey: upper, isSigner: false, isWritable: false},
    ],
    data: discriminator('global', 'update_fees_and_rewards'),
  });

  for (let n = 1; n <= Number(process.argv[3] || 20); n++) {
    await setAccount(url, whirlpool, PROGRAM, encodeWhirlpool(GROWTH_STEP * BigInt(n)), 10_000_000);
    try {
      const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], { commitment: 'confirmed', skipPreflight: false });
      if (n === 1) {
        const transaction = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        console.log(`signature=${signature} compute_units=${transaction?.meta?.computeUnitsConsumed}`);
        console.log(`logs=${JSON.stringify(transaction?.meta?.logMessages || [])}`);
      }
    } catch (e) {
      console.error(`round=${n} failed`, e.logs || e.message || e);
      process.exitCode = 1;
      return;
    }
    const account = await connection.getAccountInfo(position, 'confirmed');
    console.log(`round=${n} owed=${owed(account.data)} checkpoint=${checkpoint(account.data)}`);
  }
}

if (require.main === module) {
  main(process.argv[2]).catch(e => {console.error(e); process.exitCode = 1;});
}

module.exports = {
  PROGRAM, X64, LIQUIDITY, POSITION_LIQUIDITY, GROWTH_STEP,
  discriminator, u128, encodeWhirlpool, encodePosition, encodeTickArray,
  rpc, setAccount, owed, checkpoint,
};
