#!/usr/bin/env node
// Reproduce exact SP12 stake-withdraw authority attribution from current state.
const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const DIR = __dirname;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
const programId = 'SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY';
const examples = [
  { pool: '9mhGNSPArRMHpLDMSmxAvuoizBqtBGqYdT8WGuqgxNdn',
    authority: '6727ZvQ2YEz8jky1Z9fqDFG5mYuAvC9G34o2MxwzmrUK',
    signature: '3m1fHhPvQCsSpEEBEdqMkwgSPmCZKf8t1Q2ibM65eknG4L8fJhTcAvt2P7ULL6RNWu5HYYbDGkG8Xa9PzJGBgshX' },
  { pool: '2iZHumJq19hyCYkD3xFoZ6dbiFbJ5nqbwALMdJBYQsJa',
    authority: '3ndMuPC9Cz5VC4RJkpoPaZz6Px6eVXtRenw9Yi1o2xnA',
    signature: '37v559TdKik2ionF82rwNTyWnTDqj9XqZFdAJ3kPMNQpYTyEUdWP4fUtVxaoTUPGErX6ubYWAXZd5TnnpkqQu9Ed' },
  { pool: 'pyZMBjpWsVjKANAYK5mpNbKiws2krjRPZ2N2UYCSnbP',
    authority: '7cWNhDsHe1m36ttDkJVBgbee1hRFvPqWZT2iWaBAyYGW',
    signature: '4UrUqq6wQSkuguzX8og8ewocHNmyhS2cJdKkDqj3kPyw2MogijDCPQryCzQ73yAtnaSQJNS75S37BPSdtE7jyCCW' },
];
async function rpc(method, params) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`${method}: ${data.error.code} ${data.error.message}`);
  return data.result;
}
async function main() {
  const census = JSON.parse(fs.readFileSync(path.join(DIR, 'native-stake-authority-census.json')));
  const censusGroups = new Map(census.retainedWithdrawerGroups.map((row) => [row.authority, row]));
  const accountResult = await rpc('getMultipleAccounts', [[programId, ...examples.map((row) => row.pool)],
    { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 110 } }]);
  const program = accountResult.value[0];
  const rows = [];
  for (let i = 0; i < examples.length; i += 1) {
    const example = examples[i];
    const [derived, bump] = PublicKey.findProgramAddressSync(
      [new PublicKey(example.pool).toBuffer(), Buffer.from('withdraw')], new PublicKey(programId));
    const state = accountResult.value[i + 1];
    const stateBytes = state ? Buffer.from(state.data[0], 'base64') : null;
    const tx = await rpc('getTransaction', [example.signature, { encoding: 'jsonParsed', commitment: 'confirmed',
      maxSupportedTransactionVersion: 0 }]);
    const top = tx?.transaction?.message?.instructions || [];
    const invocations = [...top, ...(tx?.meta?.innerInstructions || []).flatMap((group) => group.instructions || [])]
      .filter((ix) => ix.programId === programId);
    const matchingInvocation = invocations.find((ix) => ix.accounts?.[0] === example.pool &&
      ix.accounts?.[1] === example.authority);
    const balance = censusGroups.get(example.authority);
    rows.push({ ...example, derivedAuthority: derived.toBase58(), derivedBump: bump,
      derivationMatches: derived.toBase58() === example.authority,
      stateExistsNow: Boolean(state), stateOwnedByProgramNow: state?.owner === programId,
      stateAccountType: stateBytes?.[0] ?? null, storedWithdrawBump: stateBytes?.[97] ?? null,
      storedBumpMatches: stateBytes?.[97] === bump,
      successfulReferenceSignature: tx?.meta?.err === null, referenceSlot: tx?.slot ?? null,
      referenceInstructionAccountOrderMatches: Boolean(matchingInvocation),
      referenceInvocationStackHeight: matchingInvocation?.stackHeight ?? null,
      censusSol: balance?.sol ?? null, censusStakeAccounts: balance?.accountCount ?? null });
  }
  const report = { generatedAt: new Date().toISOString(), programId,
    currentStateSlot: accountResult.context.slot, programExecutableNow: program?.executable === true,
    programOwnerNow: program?.owner || null, censusGeneratedAt: census.generatedAt,
    censusCompletedShards: census.completedShards.length, censusRequestedShards: census.requestedShardCount,
    threeAuthorityCensusSol: rows.reduce((sum, row) => sum + row.censusSol, 0), rows };
  fs.writeFileSync(path.join(DIR, 'long-tail-sp12-proof.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
