const { createRequire } = require('node:module');
const requireWorkspace = process.env.WHIRLPOOLS_REPO
  ? createRequire(`${process.env.WHIRLPOOLS_REPO}/package.json`)
  : require;
const {
  Connection, Keypair, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} = requireWorkspace('@solana/web3.js');
const {
  PROGRAM, X64, discriminator, encodeWhirlpool, encodePosition,
  encodeTickArray, setAccount, owed, checkpoint,
} = require('./checkpoint_fuzz_helpers.cjs');

const U64 = (1n << 64n) - 1n;
const U128 = (1n << 128n) - 1n;
const URL = process.argv[2] || 'http://127.0.0.1:28899';
const connection = new Connection(URL, 'confirmed');
const payer = Keypair.generate();

function oracle(state, growth, liquidity) {
  const delta = (growth - state.checkpoint) & U128;
  const product = liquidity * delta;
  if (product > U128) return {checkpoint: growth, owed: state.owed, delta: 0n, overflow: true};
  const owedDelta = product >> 64n;
  if (owedDelta === 0n) return {...state, delta: 0n, overflow: false};
  const converted = (owedDelta * X64 + liquidity - 1n) / liquidity;
  return {
    checkpoint: (state.checkpoint + converted) & U128,
    owed: (state.owed + owedDelta) & U64,
    delta: owedDelta,
    overflow: false,
  };
}

let totalTransactions = 0;
let totalChecks = 0;
let overflows = 0;
let firstTransaction = true;

async function runCase(spec) {
  const whirlpool = Keypair.generate().publicKey;
  const position = Keypair.generate().publicKey;
  const lower = Keypair.generate().publicKey;
  const upper = Keypair.generate().publicKey;
  const liquidity = spec.liquidity;
  let state = {checkpoint: spec.initialCheckpoint || 0n, owed: spec.initialOwed || 0n};
  let growth = spec.initialGrowth === undefined ? state.checkpoint : spec.initialGrowth;
  await setAccount(URL, whirlpool, PROGRAM, encodeWhirlpool(state.checkpoint, {liquidity}), 10_000_000);
  await setAccount(URL, position, PROGRAM, encodePosition(whirlpool, {
    liquidity, checkpointA: state.checkpoint, owedA: state.owed,
  }), 10_000_000);
  await setAccount(URL, lower, PROGRAM, encodeTickArray(whirlpool, -88, 87), 100_000_000);
  await setAccount(URL, upper, PROGRAM, encodeTickArray(whirlpool, 0, 1), 100_000_000);
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
  for (let n = 0; n < spec.deltas.length; n++) {
    growth = (growth + spec.deltas[n]) & U128;
    // Directly seed pool growth to isolate checkpoint arithmetic in the real SBF program.
    await setAccount(URL, whirlpool, PROGRAM, encodeWhirlpool(growth, {liquidity}), 10_000_000);
    const predicted = oracle(state, growth, liquidity);
    let signature;
    try {
      signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], {
        commitment: 'confirmed', skipPreflight: false,
      });
    } catch (error) {
      throw new Error(`${spec.name}[${n}] tx failed: ${JSON.stringify(error.logs || error.message || error)}`);
    }
    totalTransactions++;
    if (firstTransaction) {
      const tx = await connection.getTransaction(signature, {commitment: 'confirmed', maxSupportedTransactionVersion: 0});
      const logs = tx?.meta?.logMessages || [];
      if (!logs.some(line => line.includes('Instruction: UpdateFeesAndRewards')) ||
          logs.some(line => line.includes('Hello from my program!'))) {
        throw new Error(`program execution is not Whirlpool: ${JSON.stringify(logs)}`);
      }
      console.log(`REAL_SBF signature=${signature} compute_units=${tx.meta.computeUnitsConsumed}`);
      firstTransaction = false;
    }
    const account = await connection.getAccountInfo(position, 'confirmed');
    const actual = {checkpoint: checkpoint(account.data), owed: owed(account.data)};
    if (actual.checkpoint !== predicted.checkpoint || actual.owed !== predicted.owed) {
      throw new Error(`${spec.name}[${n}] mismatch growth=${growth} liquidity=${liquidity} previous=${JSON.stringify(state, (_, v) => typeof v === 'bigint' ? String(v) : v)} predicted=${JSON.stringify(predicted, (_, v) => typeof v === 'bigint' ? String(v) : v)} actual=${JSON.stringify(actual, (_, v) => typeof v === 'bigint' ? String(v) : v)}`);
    }
    if (predicted.overflow) overflows++;
    totalChecks++;
    state = actual;
  }
  console.log(`PASS ${spec.name}: rounds=${spec.deltas.length} owed=${state.owed} checkpoint=${state.checkpoint}`);
}

function xorshift(seed) {
  let s = seed & U128;
  return () => {
    s ^= (s << 13n) & U128;
    s ^= s >> 7n;
    s ^= (s << 17n) & U128;
    return s & U128;
  };
}

async function main() {
  await setAccount(URL, payer.publicKey, SystemProgram.programId, Buffer.alloc(0), 2_000_000_000);
  const cases = [
    {name: 'subunit_accumulation', liquidity: 1n, deltas: [X64/10n, X64/5n, X64/2n, X64-1n, X64, X64/3n, X64]},
    {name: 'ordinary_21pct_repeated', liquidity: 210_000_000n, deltas: Array(20).fill(X64/1_000_000_000n)},
    {name: 'q64_wrap_integer', liquidity: X64, initialCheckpoint: U128-5n, deltas: [8n, 5n, 1n, 16n]},
    {name: 'q64_wrap_fractional', liquidity: 1n, initialCheckpoint: U128-10n, deltas: [5n, 16n, X64+16n]},
    {name: 'owed_u64_wrap', liquidity: X64, initialOwed: U64-2n, deltas: [5n, 5n, 1n]},
    {name: 'checked_product_overflow', liquidity: 1n<<127n, deltas: [2n, 1n, 2n, 1n]},
    {name: 'max_liquidity', liquidity: U128, deltas: [1n, 1n, 2n]},
    {name: 'zero_then_one', liquidity: 1n, initialCheckpoint: 123n, deltas: [X64/2n, X64-1n, X64, 0n]},
  ];
  const random = xorshift(0x1396f2a3d13n);
  const liquidityChoices = [1n, 2n, 3n, 1_000_000n, 210_000_000n, 1_000_000_000n, U64, X64, 1n<<96n, 1n<<127n, U128];
  const randomCases = Number(process.argv[3] || 40);
  for (let i = 0; i < randomCases; i++) {
    const liquidity = liquidityChoices[Number(random() % BigInt(liquidityChoices.length))];
    const initialCheckpoint = random();
    const initialOwed = random() & U64;
    const boundary = U128 / liquidity;
    const deltas = [0n, 1n, boundary, boundary+1n, X64-1n, X64, X64+1n, random() & ((1n<<80n)-1n)];
    const selected = Array.from({length: 3}, () => deltas[Number(random() % BigInt(deltas.length))]);
    cases.push({name: `seeded_${String(i).padStart(2,'0')}`, liquidity, initialCheckpoint, initialOwed, deltas: selected});
  }
  for (const spec of cases) await runCase(spec);
  console.log(`ALL_PASS cases=${cases.length} transactions=${totalTransactions} assertions=${totalChecks} multiplication_overflows=${overflows}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
