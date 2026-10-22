#!/usr/bin/env node
// Read-only current state and authority graph for SanctumSpl program namespaces.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey} = require(`${modules}/@solana/web3.js`);
const {StakePoolLayout, ValidatorListLayout} = require(`${modules}/@solana/spl-stake-pool`);

const DIR = __dirname;
const PROGRAMS = {
  SanctumSpl: 'SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY',
  SanctumSplMulti: 'SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn',
};
const PINNED_POOLS = new Set([
  '9mhGNSPArRMHpLDMSmxAvuoizBqtBGqYdT8WGuqgxNdn',
  '2iZHumJq19hyCYkD3xFoZ6dbiFbJ5nqbwALMdJBYQsJa',
  'pyZMBjpWsVjKANAYK5mpNbKiws2krjRPZ2N2UYCSnbP',
]);
const envFile = ['/tmp/composer-helius-rpc.env', '/tmp/composer-helius-only.env']
  .find((candidate) => fs.existsSync(candidate));
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = (env.HEAVY_RPC_URL || env.RPC_URL).replace(/^['"]|['"]$/g, '');

async function rpc(method, params) {
  const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function pk(value) { return value.toBase58(); }
function bn(value) { return value.toString(10); }
function fee(value) { return {numerator: bn(value.numerator), denominator: bn(value.denominator)}; }
function derive(program, pool, suffix) {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [new PublicKey(pool).toBuffer(), Buffer.from(suffix)], new PublicKey(program));
  return {address: address.toBase58(), bump};
}
function deriveValidatorStake(program, pool, vote) {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(vote).toBuffer(), new PublicKey(pool).toBuffer()], new PublicKey(program))[0].toBase58();
}
function deriveTransient(program, pool, vote, seed) {
  const seedBytes = Buffer.alloc(8); seedBytes.writeBigUInt64LE(BigInt(seed));
  return PublicKey.findProgramAddressSync(
    [Buffer.from('transient'), new PublicKey(vote).toBuffer(), new PublicKey(pool).toBuffer(), seedBytes],
    new PublicKey(program))[0].toBase58();
}
function decodedPool(pubkey, account, programName, programId) {
  const data = Buffer.from(account.data[0], 'base64');
  const state = StakePoolLayout.decode(data);
  return {
    programName, programId, pool: pubkey, stateDataLength: data.length,
    stateSha256: crypto.createHash('sha256').update(data).digest('hex'),
    manager: pk(state.manager), staker: pk(state.staker), stakeDepositAuthority: pk(state.stakeDepositAuthority),
    withdrawAuthority: derive(programId, pubkey, 'withdraw'), depositAuthorityPda: derive(programId, pubkey, 'deposit'),
    storedWithdrawBump: state.stakeWithdrawBumpSeed,
    validatorList: pk(state.validatorList), reserveStake: pk(state.reserveStake), poolMint: pk(state.poolMint),
    managerFeeAccount: pk(state.managerFeeAccount), tokenProgramId: pk(state.tokenProgramId),
    totalLamports: bn(state.totalLamports), poolTokenSupply: bn(state.poolTokenSupply),
    lastUpdateEpoch: bn(state.lastUpdateEpoch),
    stakeDepositFee: fee(state.stakeDepositFee), stakeWithdrawalFee: fee(state.stakeWithdrawalFee),
    solDepositFee: fee(state.solDepositFee), solWithdrawalFee: fee(state.solWithdrawalFee),
    solDepositAuthority: state.solDepositAuthority ? pk(state.solDepositAuthority) : null,
    solWithdrawAuthority: state.solWithdrawAuthority ? pk(state.solWithdrawAuthority) : null,
    pinned: PINNED_POOLS.has(pubkey),
  };
}

async function enumerateProgram(programName, programId) {
  const result = await rpc('getProgramAccounts', [programId, {commitment: 'confirmed', encoding: 'base64',
    withContext: true, filters: [{memcmp: {offset: 0, bytes: '2'}}]}]);
  const pools = result.value.map((row) => decodedPool(row.pubkey, row.account, programName, programId));
  pools.sort((a, b) => BigInt(a.totalLamports) === BigInt(b.totalLamports) ? a.pool.localeCompare(b.pool)
    : BigInt(a.totalLamports) > BigInt(b.totalLamports) ? -1 : 1);
  return {slot: result.context.slot, poolCount: pools.length,
    sumStateTotalLamports: pools.reduce((sum, row) => sum + BigInt(row.totalLamports), 0n).toString(), pools};
}

async function expandPinned(rows) {
  const pinned = rows.filter((row) => row.pinned);
  const addresses = [...new Set(pinned.flatMap((row) => [row.validatorList, row.reserveStake]))];
  const infos = await rpc('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'confirmed'}]);
  const map = new Map(addresses.map((address, index) => [address, infos.value[index]]));
  const stakeAddresses = [];
  for (const row of pinned) {
    const validatorInfo = map.get(row.validatorList);
    const decoded = ValidatorListLayout.decode(Buffer.from(validatorInfo.data[0], 'base64'));
    row.validatorListState = {maxValidators: decoded.maxValidators, validators: decoded.validators.map((validator) => {
      const vote = pk(validator.voteAccountAddress);
      const validatorStake = deriveValidatorStake(row.programId, row.pool, vote);
      const transientStake = deriveTransient(row.programId, row.pool, vote, bn(validator.transientSeedSuffixStart));
      stakeAddresses.push(validatorStake, transientStake);
      return {voteAccount: vote, validatorStake, transientStake,
        activeStakeLamports: bn(validator.activeStakeLamports), transientStakeLamports: bn(validator.transientStakeLamports),
        lastUpdateEpoch: bn(validator.lastUpdateEpoch), status: validator.status,
        transientSeedSuffixStart: bn(validator.transientSeedSuffixStart),
        transientSeedSuffixEnd: bn(validator.transientSeedSuffixEnd)};
    })};
  }
  const uniqueStake = [...new Set(stakeAddresses)];
  const stakeInfos = uniqueStake.length ? await rpc('getMultipleAccounts', [uniqueStake, {encoding: 'base64', commitment: 'confirmed'}]) : {value: []};
  const stakeMap = new Map(uniqueStake.map((address, index) => [address, stakeInfos.value[index]]));
  for (const row of pinned) {
    const reserve = map.get(row.reserveStake);
    row.reserveAccount = reserve ? {lamports: String(reserve.lamports), owner: reserve.owner,
      dataLength: Buffer.from(reserve.data[0], 'base64').length} : null;
    for (const validator of row.validatorListState.validators) {
      validator.validatorStakeAccount = stakeMap.get(validator.validatorStake)
        ? {lamports: String(stakeMap.get(validator.validatorStake).lamports), owner: stakeMap.get(validator.validatorStake).owner} : null;
      validator.transientStakeAccount = stakeMap.get(validator.transientStake)
        ? {lamports: String(stakeMap.get(validator.transientStake).lamports), owner: stakeMap.get(validator.transientStake).owner} : null;
    }
  }
}

async function main() {
  const results = {};
  for (const [name, programId] of Object.entries(PROGRAMS)) results[name] = await enumerateProgram(name, programId);
  await expandPinned(results.SanctumSpl.pools);
  const output = {generatedAt: new Date().toISOString(), rpcEndpointRedacted: true, programs: results};
  fs.writeFileSync(path.join(DIR, 'sp12-state-authority-graph.json'), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, value]) => [name,
    {slot: value.slot, poolCount: value.poolCount, sumStateTotalLamports: value.sumStateTotalLamports,
      topPools: value.pools.slice(0, 8).map((row) => ({pool: row.pool, totalLamports: row.totalLamports,
        withdrawAuthority: row.withdrawAuthority.address, pinned: row.pinned}))}])), null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
