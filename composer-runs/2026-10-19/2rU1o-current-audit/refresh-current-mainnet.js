#!/usr/bin/env node
// Read-only current-mainnet refresh for the Vault liquid-unstaker program.
// Prints and writes only public on-chain identifiers and aggregate values.
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const bs58 = require(modules + 'bs58');
const {PublicKey} = require(modules + '@solana/web3.js');

const RPC = process.env.RPC_URL || 'https://api.mainnet.solana.com';
const OUT = process.argv[2] || __dirname + '/current-mainnet-refresh.json';
const PROGRAM = '2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo';
const POOL = '9nyw5jxhzuSs88HxKJyDCsWBZMhxj2uNXsFcyHF5KBAb';
const VAULT = '6RLKARrt6oPCyuMCdYdUHmJxd4wUa6ZeyiC8VSMcYxRv';
const LP_MINT = 'EUWoTx5vQQrxaDFdeK2PLUVbnmRWjw4x6sBbmcxBaHjF';
const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const BPF_UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';
let id = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params, attempts = 8) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
      const body = JSON.parse(text);
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt + 1 < attempts) await sleep(600 * (2 ** attempt));
    }
  }
  throw last;
}
function sha(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function compact(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {owner: account.owner, executable: account.executable, lamports: String(account.lamports),
    dataBytes: data.length, dataSha256: sha(data)};
}
async function getAccount(address) {
  return rpc('getAccountInfo', [address, {commitment: 'finalized', encoding: 'base64'}]);
}
async function stakeRows(offset) {
  const result = await rpc('getProgramAccounts', [STAKE_PROGRAM, {commitment: 'finalized',
    encoding: 'base64', withContext: true,
    filters: [{dataSize: 200}, {memcmp: {offset, bytes: POOL}}],
    dataSlice: {offset: 0, length: 76}}]);
  const rows = result.value.map((row) => {
    const data = Buffer.from(row.account.data[0], 'base64');
    return {address: row.pubkey, lamports: String(row.account.lamports), stateKind: data.readUInt32LE(0),
      staker: bs58.encode(data.subarray(12, 44)), withdrawer: bs58.encode(data.subarray(44, 76))};
  }).filter((row) => row.stateKind === 1 || row.stateKind === 2);
  rows.sort((a, b) => a.address.localeCompare(b.address));
  return {slot: result.context.slot, rows};
}
function summarize(rows) {
  const lamports = rows.reduce((sum, row) => sum + BigInt(row.lamports), 0n);
  return {accountCount: rows.length, delegatedCount: rows.filter((row) => row.stateKind === 2).length,
    lamports: lamports.toString(), sol: Number(lamports) / 1e9,
    addressDigest: sha(Buffer.from(rows.map((row) => `${row.address}:${row.lamports}:${row.stateKind}`).join('\n')))};
}
async function tokenCustody(tokenProgram) {
  const result = await rpc('getTokenAccountsByOwner', [POOL, {programId: tokenProgram},
    {commitment: 'finalized', encoding: 'base64'}]);
  const rows = result.value.map((row) => {
    const data = Buffer.from(row.account.data[0], 'base64');
    return {address: row.pubkey, tokenProgram: row.account.owner, lamports: String(row.account.lamports),
      dataBytes: data.length, mint: bs58.encode(data.subarray(0, 32)),
      authority: bs58.encode(data.subarray(32, 64)), amountRaw: data.readBigUInt64LE(64).toString()};
  });
  rows.sort((a, b) => a.address.localeCompare(b.address));
  return {slot: result.context.slot, accountCount: rows.length,
    nonzeroAccountCount: rows.filter((row) => BigInt(row.amountRaw) > 0n).length,
    addressDigest: sha(Buffer.from(rows.map((row) => `${row.address}:${row.mint}:${row.amountRaw}`).join('\n'))), rows};
}
function decodePool(account) {
  const data = Buffer.from(account.data[0], 'base64');
  return {dataBytes: data.length, dataSha256: sha(data), authority: bs58.encode(data.subarray(8, 40)),
    solVault: bs58.encode(data.subarray(40, 72)), lpMint: bs58.encode(data.subarray(72, 104)),
    managerFeeAccount: bs58.encode(data.subarray(104, 136)), totalLpSupply: data.readBigUInt64LE(136).toString(),
    totalAccruedFees: data.readBigUInt64LE(144).toString(),
    deactivatingStakeLamports: data.readBigUInt64LE(152).toString(), feeMaxBps: data.readUInt32LE(160),
    feeMinBps: data.readUInt32LE(164), minSolBalance: data.readBigUInt64LE(168).toString(),
    managerFeePercentage: data.readUInt8(176), poolBump: data.readUInt8(177), vaultBump: data.readUInt8(178),
    stateVaultLamports: data.readBigUInt64LE(179).toString(), capLamports: data.readBigUInt64LE(187).toString(),
    withdrawSolFeeBps: data.readUInt16LE(195), withdrawStakeFeeBps: data.readUInt16LE(197),
    flashLoanFee: data.readUInt32LE(199), flashBorrowed: data.readBigUInt64LE(203).toString(),
    flashEnabled: data.readUInt8(211)};
}
function accountKeys(tx) {
  const msg = tx.transaction.message;
  return [...msg.accountKeys.map((x) => typeof x === 'string' ? x : x.pubkey),
    ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
}
function signerKeys(tx) {
  const msg = tx.transaction.message;
  if (msg.header) return msg.accountKeys.slice(0, msg.header.numRequiredSignatures)
    .map((x) => typeof x === 'string' ? x : x.pubkey);
  return msg.accountKeys.filter((x) => typeof x !== 'string' && x.signer).map((x) => x.pubkey);
}
async function newestSignerPositiveReceipt() {
  const signatures = await rpc('getSignaturesForAddress', [VAULT, {limit: 100, commitment: 'finalized'}]);
  for (const sig of signatures) {
    if (sig.err) continue;
    const tx = await rpc('getTransaction', [sig.signature, {encoding: 'jsonParsed', commitment: 'finalized',
      maxSupportedTransactionVersion: 1}]);
    if (!tx?.meta || tx.meta.err) continue;
    const keys = accountKeys(tx);
    const vaultIndex = keys.indexOf(VAULT);
    if (vaultIndex < 0) continue;
    const vaultDelta = BigInt(tx.meta.postBalances[vaultIndex]) - BigInt(tx.meta.preBalances[vaultIndex]);
    if (vaultDelta >= 0n) continue;
    const target = tx.transaction.message.instructions.find((ix) => ix.programId === PROGRAM);
    if (!target?.data || !Array.isArray(target.accounts)) continue;
    const data = Buffer.from(bs58.decode(target.data));
    const disc = data.subarray(0, 8).toString('hex');
    if (!['06f2f2003de6603a', '91834a8841892a26'].includes(disc)) continue;
    const deltas = target.accounts.map((address) => {
      const index = keys.indexOf(address);
      return {address, index,
        preLamports: index < 0 ? null : String(tx.meta.preBalances[index]),
        postLamports: index < 0 ? null : String(tx.meta.postBalances[index]),
        lamports: index < 0 ? null : String(BigInt(tx.meta.postBalances[index]) - BigInt(tx.meta.preBalances[index]))};
    });
    const innerStake = (tx.meta.innerInstructions || []).flatMap((group) => group.instructions)
      .filter((ix) => ix.program === 'stake' && ix.parsed)
      .map((ix) => ({type: ix.parsed.type, info: ix.parsed.info}));
    return {signature: sig.signature, slot: tx.slot, blockTime: tx.blockTime, discriminatorHex: disc,
      instruction: disc === '06f2f2003de6603a' ? 'LiquidUnstakeStakeAccount' : 'WithdrawSol',
      signers: signerKeys(tx), feeLamports: String(tx.meta.fee), vaultDeltaLamports: vaultDelta.toString(),
      instructionAccounts: target.accounts, accountDeltas: deltas, innerStake};
  }
  return null;
}
async function main() {
  const genesis = await rpc('getGenesisHash', []);
  const slot = await rpc('getSlot', [{commitment: 'finalized'}]);
  const [programResult, poolResult, vaultResult, mintSupply, stakerResult, withdrawerResult] = await Promise.all([
    getAccount(PROGRAM), getAccount(POOL), getAccount(VAULT),
    rpc('getTokenSupply', [LP_MINT, {commitment: 'finalized'}]), stakeRows(12), stakeRows(44)]);
  const program = programResult.value;
  if (!program || program.owner !== BPF_UPGRADEABLE || !program.executable) throw new Error('program account mismatch');
  const programDataAddress = bs58.encode(Buffer.from(program.data[0], 'base64').subarray(4, 36));
  const programDataResult = await getAccount(programDataAddress);
  const programData = programDataResult.value;
  const pd = Buffer.from(programData.data[0], 'base64');
  const deploySlot = pd.readBigUInt64LE(4).toString();
  const authorityOption = pd.readUInt8(12);
  const upgradeAuthority = authorityOption ? bs58.encode(pd.subarray(13, 45)) : null;
  const executable = pd.subarray(authorityOption ? 45 : 13);
  const stakerBy = new Map(stakerResult.rows.map((row) => [row.address, row]));
  const withdrawerBy = new Map(withdrawerResult.rows.map((row) => [row.address, row]));
  const intersection = [...stakerBy.keys()].filter((address) => withdrawerBy.has(address)).map((address) => stakerBy.get(address));
  const union = new Map([...stakerBy, ...withdrawerBy]);
  const custody = {stakerQuery: {...summarize(stakerResult.rows), slot: stakerResult.slot},
    withdrawerQuery: {...summarize(withdrawerResult.rows), slot: withdrawerResult.slot},
    intersection: summarize(intersection), unionDeduplicated: summarize([...union.values()])};
  const vaultLamports = BigInt(vaultResult.value.lamports);
  const stakeLamports = BigInt(custody.unionDeduplicated.lamports);
  custody.vaultLamports = vaultLamports.toString();
  custody.vaultSol = Number(vaultLamports) / 1e9;
  custody.grossNativeLamports = (stakeLamports + vaultLamports).toString();
  custody.grossNativeSol = Number(stakeLamports + vaultLamports) / 1e9;
  const poolState = decodePool(poolResult.value);
  const [derivedPool, derivedPoolBump] = PublicKey.findProgramAddressSync([
    Buffer.from('pool'), new PublicKey(poolState.authority).toBuffer(),
  ], new PublicKey(PROGRAM));
  const [derivedVault, derivedVaultBump] = PublicKey.findProgramAddressSync([
    Buffer.from('sol_vault'), new PublicKey(POOL).toBuffer(),
  ], new PublicKey(PROGRAM));
  const [legacyTokens, token2022] = await Promise.all([
    tokenCustody(TOKEN_PROGRAM), tokenCustody(TOKEN_2022_PROGRAM),
  ]);
  const report = {generatedAt: new Date().toISOString(), rpcEndpointClass: 'public mainnet endpoint; no key',
    network: 'mainnet-beta', genesis, observationSlot: slot, programId: PROGRAM, pool: POOL, vault: VAULT,
    deployment: {programDataAddress, deploySlot, upgradeAuthority, program: compact(program),
      programData: compact(programData), executableBytes: executable.length, executableSha256: sha(executable)},
    poolState, pdaProofs: {pool: {seeds: ['pool', poolState.authority], derived: derivedPool.toBase58(),
      bump: derivedPoolBump, matches: derivedPool.toBase58() === POOL},
    vault: {seeds: ['sol_vault', POOL], derived: derivedVault.toBase58(), bump: derivedVaultBump,
      matches: derivedVault.toBase58() === VAULT}},
    lpMint: LP_MINT, lpMintSupplyRaw: mintSupply.value.amount,
    custody, tokenCustody: {legacy: legacyTokens, token2022},
    newestSignerPositiveReceipt: await newestSignerPositiveReceipt(),
    method: {stakeDedup: 'exact finalized Stake-program GPA by 32-byte staker offset 12 and withdrawer offset 44; union by pubkey',
      binary: 'UpgradeableLoader ProgramData bytes; SHA-256 over executable payload only', liveTransactionSent: false}};
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({out: OUT, generatedAt: report.generatedAt, observationSlot: slot,
    deployment: report.deployment, custody: report.custody, receipt: report.newestSignerPositiveReceipt}));
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
