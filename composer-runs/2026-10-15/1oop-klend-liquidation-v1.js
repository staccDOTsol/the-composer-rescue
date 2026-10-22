#!/usr/bin/env node
// Read-only current-mainnet v1 composition: zero-rate KLend USDC flash liquidity
// around the selected Loopscale BONK liquidation path. Never signs or submits.

const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, TransactionInstruction} = require(modules + '@solana/web3.js');
const spl = require(modules + '@solana/spl-token');
const b58mod = require(modules + 'bs58');
const bs58 = b58mod.default || b58mod;
const {encodeV1} = require('./klend-v1-composition.js');

const P = (value) => new PublicKey(value);
const ROOT = __dirname;
const OPERATIONS_ADMIN_MODE = process.env.LOOPSCALE_OPERATIONS_ADMIN === '1';
const OUTPUT = `${ROOT}/${OPERATIONS_ADMIN_MODE ? '1oop-klend-liquidation-operations-admin-v1.json' : '1oop-klend-liquidation-v1.json'}`;
const LOOP = P('1oopBoJG58DgkUVKkEzKgyG9dvRmpgeEm1AVjoHkF78');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const FEE_PAYER = P('Dsg7ZFQzXuiKsBAmL78Y5V5VjN6ASkfKDxB7VUNpp6aM');
const OPERATIONS_ADMIN = P('BBEPbsJAM5ecjXEKzcSK7XNdJ4JfEkiauJRgRcybQeoA');
const LIQUIDATOR = OPERATIONS_ADMIN_MODE ? OPERATIONS_ADMIN : FEE_PAYER;
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const BONK = P('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
const LIQUIDATOR_USDC = spl.getAssociatedTokenAddressSync(USDC, LIQUIDATOR, true);
const LIQUIDATOR_BONK = spl.getAssociatedTokenAddressSync(BONK, LIQUIDATOR, true);
const LOAN = P('634QWfYYzXuqdDWoVtNgQisVYkTdBmfBbBPYZoNZyHwE');
const BORROWER = P('DJTiaWW2osQwz4wwHJrzrK6U2vD7cRUGymgmVTHzuDAd');
const STRATEGY = P('6tv6XYnXUFjLSaAeap4T1GQusYeEw3nK6KTcVyyHf3ns');
const MARKET_INFO = P('5qjqX4YQL6HSQMagRfTVfFDXrwxzKpS6bHguCWPe768y');
const STRATEGY_USDC = P('3GAu8zG1bLHEd2K5JUvysEjLSkfTw4aXYCFaUcQCYsA2');
const LOAN_BONK = P('9FXfaV6eVe5RfD8vLg137u8kzA1aNmNsV3kDHCZhdqzF');
const ORACLE = P('E22Z2nKBdA3RpJhM8G2mB35zFA95Qdbs3WGbMNxFhmuH');
const ADMIN_STATE = P('HcgXEnEsgvGowVnSjMmrzSewdx9yGvfXixiuMJPhyW2z');
const EVENT_AUTHORITY = P('6sbyEiDvcYELrqoxurz3XTTLLg5wpe8dHCXi4uTvSSTV');
const SYSTEM = P('11111111111111111111111111111111');
const FLASH_AMOUNT = BigInt(process.env.LOOPSCALE_FLASH_RAW || '900000000000');

const census = JSON.parse(fs.readFileSync(`${ROOT}/klend-zero-fee-census.json`, 'utf8'));
const history = JSON.parse(fs.readFileSync(`${ROOT}/kamino-flash-history.json`, 'utf8'));
const reserve = census.activeZero.filter((row) => row.mint === USDC.toBase58())
  .sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1)[0];
if (!reserve || BigInt(reserve.availableRaw) <= FLASH_AMOUNT) throw new Error('No suitable current zero-rate KLend USDC reserve');

function rpcUrl() {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
    .split(/\n/).filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)));
  if (!env.RPC_URL) throw new Error('RPC_URL unavailable');
  return env.RPC_URL;
}

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(rpcUrl(), {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function historyInstruction(index) {
  const tx = history.hits[0].transaction;
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys;
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  const keys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const header = message.header;
  const writable = (i) => i < staticKeys.length ?
    (i < header.numRequiredSignatures ? i < header.numRequiredSignatures - header.numReadonlySignedAccounts :
      i < staticKeys.length - header.numReadonlyUnsignedAccounts) :
    i < staticKeys.length + loaded.writable.length;
  const source = message.instructions[index];
  return new TransactionInstruction({
    programId: P(keys[source.programIdIndex]),
    keys: source.accounts.map((i) => ({
      pubkey: P(keys[i]), isSigner: i < header.numRequiredSignatures, isWritable: writable(i),
    })),
    data: Buffer.from(bs58.decode(source.data)),
  });
}

function flashInstruction(template, amount, repayIndex) {
  const keys = template.keys.map((key) => ({...key}));
  const market = P(reserve.market);
  const marketAuthority = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  for (const [index, pubkey] of Object.entries({
    0: LIQUIDATOR, 1: marketAuthority, 2: market, 3: P(reserve.reserve), 4: USDC,
    5: P(reserve.supplyVault), 6: LIQUIDATOR_USDC, 7: P(reserve.feeVault), 11: spl.TOKEN_PROGRAM_ID,
  })) keys[Number(index)].pubkey = pubkey;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: KLEND, keys, data});
}

const meta = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});
function liquidateInstruction() {
  const data = Buffer.concat([
    Buffer.from([5, 124, 101, 85, 254, 175, 184, 249]),
    Buffer.from([0, 0]),
    Buffer.from([2, 0, 0, 0, 1, 2]),
  ]);
  return new TransactionInstruction({programId: LOOP, data, keys: [
    meta(FEE_PAYER, true, true), meta(LIQUIDATOR, true, true), meta(BORROWER, false, true),
    meta(LOAN, false, true), meta(STRATEGY, false, true), meta(MARKET_INFO, false, true),
    meta(LIQUIDATOR_USDC, false, true), meta(STRATEGY_USDC, false, true), meta(USDC),
    meta(spl.ASSOCIATED_TOKEN_PROGRAM_ID), meta(spl.TOKEN_PROGRAM_ID),
    meta(spl.TOKEN_2022_PROGRAM_ID), meta(SYSTEM), meta(ADMIN_STATE),
    meta(EVENT_AUTHORITY), meta(LOOP),
    meta(ORACLE), meta(SYSTEM), meta(ORACLE), meta(SYSTEM),
    meta(BONK), meta(LOAN_BONK, false, true), meta(LIQUIDATOR_BONK, false, true),
  ]});
}

function tokenAmount(row) {
  if (!row?.data) return null;
  const data = Buffer.from(row.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

async function main() {
  const setup = OPERATIONS_ADMIN_MODE ? [
    spl.createAssociatedTokenAccountIdempotentInstruction(
      FEE_PAYER, LIQUIDATOR_USDC, LIQUIDATOR, USDC,
    ),
    spl.createAssociatedTokenAccountIdempotentInstruction(
      FEE_PAYER, LIQUIDATOR_BONK, LIQUIDATOR, BONK,
    ),
  ] : [];
  const borrow = flashInstruction(historyInstruction(3), FLASH_AMOUNT);
  const liquidation = liquidateInstruction();
  const repay = flashInstruction(historyInstruction(13), FLASH_AMOUNT, setup.length);
  const instructions = [...setup, borrow, liquidation, repay];
  const watched = [LIQUIDATOR_USDC, LIQUIDATOR_BONK, P(reserve.supplyVault), P(reserve.feeVault),
    P(reserve.reserve), LOAN, LOAN_BONK, STRATEGY, STRATEGY_USDC];
  const baseline = await rpc('getMultipleAccounts', [watched.map(String), {
    encoding: 'base64', commitment: 'confirmed',
  }]);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const encoded = encodeV1(instructions, FEE_PAYER, blockhash);
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
    commitment: 'confirmed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  const after = result.value.accounts || [];
  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'read-only current-mainnet Solana v1 simulateTransaction; no signing or submission',
    programIds: {loopscale: LOOP.toBase58(), klend: KLEND.toBase58()},
    sourceFlash: {signature: history.hits[0].signature, slot: history.hits[0].slot},
    signerModel: {
      feePayer: FEE_PAYER.toBase58(), liquidator: LIQUIDATOR.toBase58(),
      liquidatorIsCurrentOperationsAdmin: OPERATIONS_ADMIN_MODE,
      liquidatorIsOnCurve: PublicKey.isOnCurve(LIQUIDATOR.toBytes()),
      usdcTokenAccount: LIQUIDATOR_USDC.toBase58(), bonkAta: LIQUIDATOR_BONK.toBase58(),
      sigVerify: false,
      note: 'Existing on-curve System account and token account used only as public-state stand-ins; no key or control is claimed.',
    },
    selectedLoan: {
      loan: LOAN.toBase58(), borrower: BORROWER.toBase58(), strategy: STRATEGY.toBase58(),
      marketInformation: MARKET_INFO.toBase58(), collateralVault: LOAN_BONK.toBase58(),
      principalMint: USDC.toBase58(), collateralMint: BONK.toBase58(),
    },
    flash: {
      reserve, amountRaw: FLASH_AMOUNT.toString(), amountUi: Number(FLASH_AMOUNT) / 1e6,
      feeRate: 0, repaymentInstructionIndex: instructions.length - 1,
      borrowInstructionIndexEncodedInRepay: setup.length,
    },
    route: [
      ...(OPERATIONS_ADMIN_MODE ? ['Create operations-admin USDC/BONK ATAs (idempotent)'] : []),
      'KLend FlashBorrowReserveLiquidity',
      'Loopscale LiquidateLedger',
      'KLend FlashRepayReserveLiquidity',
    ],
    reverseSwap: {
      included: false,
      reason: 'The current-binary liquidation guard rejects before collateral transfer; a swap cannot affect that predicate and no successful drain claim is made.',
    },
    baselineSlot: baseline.context.slot,
    simulationSlot: result.context.slot,
    wire: {
      version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
      instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      sha256: crypto.createHash('sha256').update(encoded.wire).digest('hex'),
      limits: {maxBytes: 4096, maxAddresses: 64},
    },
    err: result.value.err,
    unitsConsumed: result.value.unitsConsumed,
    loadedAccountsDataSize: result.value.loadedAccountsDataSize,
    watched: watched.map(String),
    beforeTokenAmountsRaw: baseline.value.map(tokenAmount),
    afterTokenAmountsRaw: after.map(tokenAmount),
    logMessages: result.value.logs,
    innerInstructions: result.value.innerInstructions,
    atomicRollbackExpected: result.value.err !== null,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    output: OUTPUT, baselineSlot: report.baselineSlot, simulationSlot: report.simulationSlot,
    err: report.err, bytes: report.wire.bytes, addresses: report.wire.addresses,
    instructions: report.wire.instructions, units: report.unitsConsumed,
    logs: report.logMessages?.filter((line) => /Instruction:|Error|failed|liquidat|healthy|default|maturity/i.test(line)),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
