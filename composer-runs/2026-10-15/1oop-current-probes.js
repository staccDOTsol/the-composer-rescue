#!/usr/bin/env node
// Defensive, read-only current-mainnet Loopscale authorization and liquidation probes.
// Builds real Solana v1 wire payloads and calls simulateTransaction only. Never signs or sends.

const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, TransactionInstruction} = require(modules + '@solana/web3.js');
const spl = require(modules + '@solana/spl-token');
const anchor = require(modules + '@coral-xyz/anchor');
const {encodeV1} = require('./klend-v1-composition.js');

const P = (value) => new PublicKey(value);
const ROOT = __dirname;
const OUTPUT = `${ROOT}/1oop-current-probes.json`;
const idl = JSON.parse(fs.readFileSync(`${ROOT}/1oop-loopscale-idl-0.9.30.json`, 'utf8'));
const instructionCoder = new anchor.BorshInstructionCoder(idl);

const PROGRAM = P('1oopBoJG58DgkUVKkEzKgyG9dvRmpgeEm1AVjoHkF78');
const EVENT_AUTHORITY = P('6sbyEiDvcYELrqoxurz3XTTLLg5wpe8dHCXi4uTvSSTV');
const PROTOCOL_ADMIN_STATE = P('HcgXEnEsgvGowVnSjMmrzSewdx9yGvfXixiuMJPhyW2z');
const PROTOCOL_ADMIN = P('CyNKPfqsSLAejjZtEeNG3pR4SkPhSPHXdGhuNTyudrNs');
const ATTACKER_MODEL = P('3zdXwWm9GVGzSBmYEtWGBgP9E2A95TbUz7ccGavWMPL8');
const ORACLE = P('E22Z2nKBdA3RpJhM8G2mB35zFA95Qdbs3WGbMNxFhmuH');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const BONK = P('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
const USD_INFRA = P('dawn7ZUF7h7anFuEsDdAU1Y3HYwikwqNMAENZsQJdNL');

const BONK_LOAN = P('634QWfYYzXuqdDWoVtNgQisVYkTdBmfBbBPYZoNZyHwE');
const BONK_BORROWER = P('DJTiaWW2osQwz4wwHJrzrK6U2vD7cRUGymgmVTHzuDAd');
const BONK_STRATEGY = P('6tv6XYnXUFjLSaAeap4T1GQusYeEw3nK6KTcVyyHf3ns');
const BONK_MARKET = P('5qjqX4YQL6HSQMagRfTVfFDXrwxzKpS6bHguCWPe768y');
const BONK_VAULT = P('9FXfaV6eVe5RfD8vLg137u8kzA1aNmNsV3kDHCZhdqzF');
const BONK_STRATEGY_USDC = P('3GAu8zG1bLHEd2K5JUvysEjLSkfTw4aXYCFaUcQCYsA2');
const ATTACKER_USDC = P('HYDz96iMcuTbGL8PF6bnD8Vav7diB54KdgbwwUMNGL2X');
const ATTACKER_BONK = spl.getAssociatedTokenAddressSync(BONK, ATTACKER_MODEL);

const USD_STRATEGY = P('836SQM4FLXELjrSu2cLLvi32aiqn22uNbZsZvBNdDHFm');
const USD_LENDER_VAULT = P('4rXteUmbxiXvgLqP14eQwtqkLyVNXVCBHnXyLQ9vZkSh');
const USD_MARKET = P('6TBbDMm1uoVbxVrcs8bWnmoyuks4wzHNyQqX3GaEFcgB');
const USD_STRATEGY_TA = P('F488bJXts4G2e5eeFqLCuT5A4ebifSqEZmwLX7qeKurV');
const USD_LENDER_TA = spl.getAssociatedTokenAddressSync(
  USD_INFRA, USD_LENDER_VAULT, true, spl.TOKEN_2022_PROGRAM_ID,
);

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

const meta = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function accountImage(row) {
  if (!row) return null;
  const bytes = Buffer.from(row.data[0], 'base64');
  const image = {
    owner: row.owner, executable: row.executable, lamports: row.lamports,
    dataLength: bytes.length, dataSha256: sha256(bytes),
  };
  if ((row.owner === spl.TOKEN_PROGRAM_ID.toBase58() || row.owner === spl.TOKEN_2022_PROGRAM_ID.toBase58()) && bytes.length >= 72) {
    image.token = {
      mint: new PublicKey(bytes.subarray(0, 32)).toBase58(),
      authority: new PublicKey(bytes.subarray(32, 64)).toBase58(),
      amountRaw: bytes.readBigUInt64LE(64).toString(),
    };
  }
  return image;
}

function liquidateInstruction() {
  const data = Buffer.concat([
    Buffer.from([5, 124, 101, 85, 254, 175, 184, 249]),
    Buffer.from([0, 0]), // ledger_index=0, unwrap_sol=false
    Buffer.from([2, 0, 0, 0, 1, 2]), // vec length 2: USDC index 1, BONK index 2
  ]);
  return new TransactionInstruction({programId: PROGRAM, data, keys: [
    meta(ATTACKER_MODEL, true, true),
    meta(ATTACKER_MODEL, true, true),
    meta(BONK_BORROWER, false, true),
    meta(BONK_LOAN, false, true),
    meta(BONK_STRATEGY, false, true),
    meta(BONK_MARKET, false, true),
    meta(ATTACKER_USDC, false, true),
    meta(BONK_STRATEGY_USDC, false, true),
    meta(USDC),
    meta(spl.ASSOCIATED_TOKEN_PROGRAM_ID),
    meta(spl.TOKEN_PROGRAM_ID),
    meta(spl.TOKEN_2022_PROGRAM_ID),
    meta(P('11111111111111111111111111111111')),
    meta(PROTOCOL_ADMIN_STATE),
    meta(EVENT_AUTHORITY),
    meta(PROGRAM),
    // Current market health suffix: principal oracle+conversion, collateral oracle+conversion.
    meta(ORACLE),
    meta(P('11111111111111111111111111111111')),
    meta(ORACLE),
    meta(P('11111111111111111111111111111111')),
    // SPL collateral exit suffix.
    meta(BONK),
    meta(BONK_VAULT, false, true),
    meta(ATTACKER_BONK, false, true),
  ]});
}

function withdrawStrategyInstruction({admin, lenderSigner}) {
  const data = Buffer.alloc(17);
  Buffer.from([31, 45, 162, 5, 193, 217, 134, 188]).copy(data);
  data.writeBigUInt64LE(1n, 8);
  data[16] = 0;
  return new TransactionInstruction({programId: PROGRAM, data, keys: [
    meta(admin, true, false),
    meta(ATTACKER_MODEL, true, true),
    meta(USD_LENDER_VAULT, lenderSigner, true),
    meta(USD_STRATEGY, false, true),
    meta(USD_INFRA),
    meta(USD_MARKET),
    meta(USD_LENDER_TA, false, true),
    meta(USD_STRATEGY_TA, false, true),
    meta(spl.ASSOCIATED_TOKEN_PROGRAM_ID),
    meta(spl.TOKEN_2022_PROGRAM_ID),
    meta(P('11111111111111111111111111111111')),
    meta(PROTOCOL_ADMIN_STATE),
    meta(EVENT_AUTHORITY),
    meta(PROGRAM),
  ]});
}

function withdrawCollateralInstruction({admin, borrower}) {
  const data = instructionCoder.encode('withdraw_collateral', {params: {
    amount: new anchor.BN(1),
    collateral_index: 0,
    asset_index_guidance: Buffer.from([1, 2]),
    expected_loan_values: {expected_apy: new anchor.BN(0), expected_lqt: [0, 0, 0, 0, 0]},
    close_if_eligible: false,
    withdraw_all: false,
  }});
  const borrowerBonk = spl.getAssociatedTokenAddressSync(BONK, borrower);
  return new TransactionInstruction({programId: PROGRAM, data, keys: [
    meta(admin, true, false),
    meta(ATTACKER_MODEL, true, true),
    meta(borrower, true, false),
    meta(BONK_LOAN, false, true),
    meta(borrowerBonk, false, true),
    meta(BONK_VAULT, false, true),
    meta(P('11111111111111111111111111111111')),
    meta(BONK),
    meta(spl.TOKEN_PROGRAM_ID),
    meta(spl.ASSOCIATED_TOKEN_PROGRAM_ID),
    meta(PROTOCOL_ADMIN_STATE),
    meta(EVENT_AUTHORITY),
    meta(PROGRAM),
  ]});
}

async function main() {
  const tracked = [
    ATTACKER_MODEL, ATTACKER_USDC, ATTACKER_BONK, BONK_LOAN, BONK_VAULT,
    BONK_STRATEGY, BONK_STRATEGY_USDC, USD_LENDER_VAULT, USD_STRATEGY,
    USD_STRATEGY_TA, USD_LENDER_TA, PROTOCOL_ADMIN_STATE,
  ];
  const baseline = await rpc('getMultipleAccounts', [tracked.map(String), {
    encoding: 'base64', commitment: 'confirmed',
  }]);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const cases = [
    {
      label: 'permissionless_liquidate_selected_bonk_current_state',
      note: 'Exact live loan/strategy/market/oracle/token suffix; outsider model has a real on-curve payer and USDC ATA.',
      instructions: [liquidateInstruction()],
    },
    {
      label: 'usd_withdraw_strategy_real_admin_but_lender_pda_not_signer',
      note: 'Models the real admin signer but leaves the off-curve lender Vault PDA unsigned.',
      instructions: [withdrawStrategyInstruction({admin: PROTOCOL_ADMIN, lenderSigner: false})],
    },
    {
      label: 'usd_withdraw_strategy_outsider_admin_with_synthetic_pda_signer_flag',
      note: 'sigVerify:false and a synthetic PDA signer flag isolate the independent protocol-admin equality check; this signer combination is not realizable top-level.',
      instructions: [withdrawStrategyInstruction({admin: ATTACKER_MODEL, lenderSigner: true})],
    },
    {
      label: 'bonk_withdraw_collateral_outsider_admin_with_real_borrower_signer_flag',
      note: 'Synthetic signer flags isolate the independent protocol-admin constraint; no signature is produced.',
      instructions: [withdrawCollateralInstruction({admin: ATTACKER_MODEL, borrower: BONK_BORROWER})],
    },
    {
      label: 'bonk_withdraw_collateral_real_admin_with_outsider_borrower',
      note: 'Synthetic signer flags isolate the borrower/loan relationship constraint; no signature is produced.',
      instructions: [withdrawCollateralInstruction({admin: PROTOCOL_ADMIN, borrower: ATTACKER_MODEL})],
    },
  ];
  const results = [];
  for (const item of cases) {
    const encoded = encodeV1(item.instructions, ATTACKER_MODEL, blockhash);
    const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
      commitment: 'confirmed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: tracked.map(String)},
    }]);
    const value = response.value;
    results.push({
      label: item.label,
      note: item.note,
      simulationSlot: response.context?.slot,
      err: value.err,
      unitsConsumed: value.unitsConsumed,
      loadedAccountsDataSize: value.loadedAccountsDataSize,
      wire: {
        version: 1,
        bytes: encoded.sizeBytes,
        addressCount: encoded.addressCount,
        instructionCount: encoded.instructionCount,
        requiredSignatures: encoded.requiredSignatures,
        sha256: sha256(encoded.wire),
      },
      postAccounts: (value.accounts || []).map(accountImage),
      logMessages: value.logs,
      innerInstructions: value.innerInstructions,
    });
    console.log(JSON.stringify({
      label: item.label,
      slot: response.context?.slot,
      err: value.err,
      bytes: encoded.sizeBytes,
      addresses: encoded.addressCount,
      signatures: encoded.requiredSignatures,
      units: value.unitsConsumed,
      logs: value.logs?.filter((line) => /Instruction:|Error|failed|liquidat|signer|constraint|authorized/i.test(line)).slice(-12),
    }));
  }
  const output = {
    generatedAt: new Date().toISOString(),
    scope: 'defensive read-only current-mainnet simulateTransaction; no signing; no sendTransaction',
    programId: PROGRAM.toBase58(),
    idlPackage: '@exponent-labs/loopscale-deserializer@0.9.30',
    idlSha256: sha256(Buffer.from(JSON.stringify(idl))),
    attackerModel: {
      pubkey: ATTACKER_MODEL.toBase58(),
      reason: 'Existing on-curve externally-owned signer used only as a public account-state stand-in; no key or control is claimed.',
      sigVerify: false,
    },
    baselineSlot: baseline.context.slot,
    trackedAddresses: tracked.map(String),
    baselineAccounts: baseline.value.map(accountImage),
    cases: results,
    interpretationRules: [
      'A sigVerify:false simulation can validate program-side signer flags and equality constraints, but cannot make an off-curve PDA sign a real top-level transaction.',
      'Every failing simulation is atomic; returned post-state is diagnostic only and no live state is committed.',
      'The liquidation case uses only signer roles actually permissionless in the current IDL and exact current live loan/account dependencies.',
    ],
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUTPUT, baselineSlot: output.baselineSlot, cases: results.length}));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
