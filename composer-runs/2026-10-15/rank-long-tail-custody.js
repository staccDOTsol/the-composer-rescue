#!/usr/bin/env node
/*
 * Read-only long-tail program triage.
 *
 * Joins the bounded Jupiter-registry top-20 token-account census to the exact
 * executable universe, freshly checks Program/ProgramData accounts, then scans
 * recent vault history for successful outbound SPL transfers.  An outbound
 * inner transfer whose authority is the observed off-curve address identifies
 * the parent invoking program that supplied signer privileges.  State-account
 * ownership alone is retained as a weaker, separate fact.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const RAW_PATH = path.join(DIR, 'mainnet-token-authority-census.raw.json');
const UNIVERSE_PATH = path.join(DIR, 'mainnet-program-universe.csv');
const QUEUE_PATH = path.join(DIR, 'mainnet-high-value-queue.json');
const ANNOTATIONS_PATH = path.join(DIR, 'long-tail-program-annotations.json');
const OUTPUT_PATH = path.join(DIR, 'mainnet-long-tail-custody-ranked.json');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const programLimit = Number(arg('--program-limit', '30'));
const authoritiesPerProgram = Number(arg('--authorities-per-program', '2'));
const accountsPerAuthority = Number(arg('--accounts-per-authority', '3'));
const signaturesPerAccount = Number(arg('--signatures-per-account', '12'));
const maxTransactionsPerAuthority = Number(arg('--max-transactions-per-authority', '18'));

const envPath = fs.existsSync('/tmp/composer-helius-rpc.env')
  ? '/tmp/composer-helius-rpc.env' : '/tmp/composer-helius-only.env';
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL || env.HELIUS_RPC_URL;
if (!endpoint) throw new Error('RPC_URL unavailable in the approved temporary environment files');

const raw = JSON.parse(fs.readFileSync(RAW_PATH));
const annotations = fs.existsSync(ANNOTATIONS_PATH)
  ? JSON.parse(fs.readFileSync(ANNOTATIONS_PATH)).programs || {} : {};
const universe = new Map(fs.readFileSync(UNIVERSE_PATH, 'utf8').trim().split(/\r?\n/).slice(1).map((line) => {
  const [programId, loaderClass, owner, programdataAddress, observedSlot] = line.split(',');
  return [programId, { programId, loaderClass, owner, programdataAddress: programdataAddress || null,
    observedSlot: Number(observedSlot) }];
}));
const knownQueue = new Set(JSON.parse(fs.readFileSync(QUEUE_PATH)).map((row) => row.program_id));

const EXCLUDED = new Set([
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'ComputeBudget111111111111111111111111111111',
  'BPFLoaderUpgradeab1e11111111111111111111111',
  'BPFLoader2111111111111111111111111111111111',
  'BPFLoader1111111111111111111111111111111111',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let rpcSeq = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcSeq, method, params }) });
      if (response.status === 429 || response.status >= 500) throw new Error(`retryable HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 5) await sleep(250 * (2 ** attempt));
    }
  }
  throw last;
}
async function mapLimit(items, limit, fn) {
  let next = 0;
  const result = Array(items.length);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { result[i] = await fn(items[i], i); }
      catch (error) { result[i] = { error: String(error.stack || error.message || error) }; }
    }
  }));
  return result;
}

function credibleAccount(account) {
  const tags = new Set(account.tags || []);
  return tags.has('strict') || tags.has('stable') || tags.has('lst');
}
function sum(rows, fn) { return rows.reduce((total, row) => total + fn(row), 0); }
function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading += 1;
  return '1'.repeat(leading) + digits.reverse().map((digit) => alphabet[digit]).join('');
}
function parseProgramData(info) {
  if (!info?.data?.[0]) return null;
  const data = Buffer.from(info.data[0], 'base64');
  if (data.length < 13 || data.readUInt32LE(0) !== 3) return { parseError: 'not ProgramData state' };
  const lastDeploySlot = Number(data.readBigUInt64LE(4));
  // bincode encodes Option<Pubkey> with a one-byte tag. ProgramData metadata is 45 bytes.
  const hasAuthority = data[12] === 1;
  return { lastDeploySlot, upgradeAuthority: hasAuthority && data.length >= 45 ? base58(data.subarray(13, 45)) : null,
    immutable: !hasAuthority };
}
function programIdOf(ix) { return typeof ix?.programId === 'string' ? ix.programId : ix?.programId?.toString?.() || null; }
function transferEvidence(ix, parentProgramId, rootProgramId, authority, vault, signature, tx) {
  const parsed = ix?.parsed;
  if (!parsed || !['transfer', 'transferChecked'].includes(parsed.type)) return null;
  const info = parsed.info || {};
  if (info.source !== vault || info.authority !== authority) return null;
  return { signature, slot: tx.slot, blockTime: tx.blockTime, parentProgramId, rootProgramId,
    transactionVersion: tx.version ?? null,
    transactionAccountCount: tx.transaction?.message?.accountKeys?.length ?? null,
    topLevelInstructionCount: tx.transaction?.message?.instructions?.length ?? null,
    tokenProgramId: programIdOf(ix), type: parsed.type, source: info.source, destination: info.destination,
    authority: info.authority, mint: info.mint || null,
    rawAmount: info.amount || info.tokenAmount?.amount || null,
    uiAmountString: info.tokenAmount?.uiAmountString || null };
}
function findOutflows(tx, authority, vault, signature) {
  if (!tx || tx.meta?.err) return [];
  const top = tx.transaction?.message?.instructions || [];
  const evidence = [];
  for (const ix of top) {
    const rootProgramId = programIdOf(ix);
    const found = transferEvidence(ix, rootProgramId, rootProgramId, authority, vault, signature, tx);
    if (found) evidence.push({ ...found, instructionLevel: 'top' });
  }
  for (const group of tx.meta?.innerInstructions || []) {
    const rootProgramId = programIdOf(top[group.index]);
    const programAtDepth = new Map([[1, rootProgramId]]);
    for (const ix of group.instructions || []) {
      const depth = Number(ix.stackHeight || 2);
      const immediateParentProgramId = programAtDepth.get(depth - 1) || rootProgramId;
      const found = transferEvidence(ix, immediateParentProgramId, rootProgramId,
        authority, vault, signature, tx);
      if (found) evidence.push({ ...found, instructionLevel: 'inner', stackHeight: depth });
      programAtDepth.set(depth, programIdOf(ix));
      for (const existingDepth of [...programAtDepth.keys()]) {
        if (existingDepth > depth) programAtDepth.delete(existingDepth);
      }
    }
  }
  return evidence;
}

function buildCandidates() {
  const byProgram = new Map();
  for (const authority of raw.authorities) {
    const programId = authority.directExecutableOwner;
    if (!programId || EXCLUDED.has(programId) || !universe.has(programId)) continue;
    const tokenAccounts = authority.tokenAccounts || [];
    const row = {
      authority: authority.authority,
      authorityAccountOwner: authority.authorityAccount?.owner || null,
      authorityAccountDataLength: authority.authorityAccount?.dataLength ?? null,
      grossUsd: sum(tokenAccounts, (item) => item.usdValue || 0),
      credibleUsd: sum(tokenAccounts, (item) => credibleAccount(item) ? (item.usdValue || 0) : 0),
      stableUsd: sum(tokenAccounts, (item) => (item.tags || []).includes('stable') ? (item.usdValue || 0) : 0),
      tokenAccounts,
    };
    if (!byProgram.has(programId)) byProgram.set(programId, { programId, authorities: [] });
    byProgram.get(programId).authorities.push(row);
  }
  return [...byProgram.values()].map((program) => {
    program.authorities.sort((a, b) => (b.credibleUsd - a.credibleUsd) || (b.grossUsd - a.grossUsd));
    program.grossUsd = sum(program.authorities, (item) => item.grossUsd);
    program.credibleUsd = sum(program.authorities, (item) => item.credibleUsd);
    program.stableUsd = sum(program.authorities, (item) => item.stableUsd);
    program.authorityCount = program.authorities.length;
    program.tokenAccountCount = sum(program.authorities, (item) => item.tokenAccounts.length);
    program.knownHighValueQueue = knownQueue.has(program.programId);
    program.universe = universe.get(program.programId);
    program.annotation = annotations[program.programId] || { label: null, sourceStatus: 'not_assessed',
      sourceSparsityScore: 5 };
    // Keep an untrusted-price candidate visible, but cap its ranking contribution.
    program.custodyRankingUsd = program.credibleUsd > 0 ? program.credibleUsd : Math.min(program.grossUsd, 1000000);
    return program;
  }).filter((program) => !program.knownHighValueQueue)
    .sort((a, b) => (b.custodyRankingUsd - a.custodyRankingUsd) || (b.grossUsd - a.grossUsd));
}

async function scanAuthority(authority) {
  const accounts = [...authority.tokenAccounts].sort((a, b) => {
    const ca = credibleAccount(a) ? 1 : 0;
    const cb = credibleAccount(b) ? 1 : 0;
    return (cb - ca) || ((b.usdValue || 0) - (a.usdValue || 0));
  }).slice(0, accountsPerAuthority);
  const signatureRows = [];
  for (const account of accounts) {
    const rows = await rpc('getSignaturesForAddress', [account.address,
      { limit: signaturesPerAccount, commitment: 'confirmed' }]);
    for (const row of rows) if (!row.err) signatureRows.push({ ...row, vault: account.address, mint: account.mint,
      symbol: account.symbol });
  }
  const unique = [...new Map(signatureRows.sort((a, b) => b.slot - a.slot)
    .map((row) => [row.signature, row])).values()].slice(0, maxTransactionsPerAuthority);
  const transactions = await mapLimit(unique, 3, async (row) => ({ row,
    tx: await rpc('getTransaction', [row.signature, { encoding: 'jsonParsed', commitment: 'confirmed',
      maxSupportedTransactionVersion: 1 }]) }));
  const outflows = [];
  const errors = [];
  for (const result of transactions) {
    if (result?.error) { errors.push(result.error); continue; }
    outflows.push(...findOutflows(result.tx, authority.authority, result.row.vault, result.row.signature)
      .map((item) => ({ ...item, symbol: result.row.symbol, observedVaultMint: result.row.mint })));
  }
  return { accountsScanned: accounts.map((item) => item.address), signaturesScanned: unique.length,
    outflows: outflows.sort((a, b) => b.slot - a.slot).slice(0, 5), errors };
}

function scoreProgram(program, tipSlot) {
  const custodyScore = Math.max(0, Math.min(45,
    9 * (Math.log10(Math.max(program.custodyRankingUsd, 10000)) - 4)));
  const deployAgeSlots = program.programData?.lastDeploySlot == null ? null
    : Math.max(0, tipSlot - program.programData.lastDeploySlot);
  const recencyScore = deployAgeSlots == null ? 0 : deployAgeSlots <= 100000 ? 15
    : deployAgeSlots <= 500000 ? 12 : deployAgeSlots <= 2000000 ? 9
      : deployAgeSlots <= 10000000 ? 5 : 2;
  const sourceSparsityScore = Number(program.annotation.sourceSparsityScore || 0);
  const exits = program.sampledAuthorities.flatMap((row) => row.exitScan?.outflows || []);
  const ownExits = exits.filter((row) => row.parentProgramId === program.programId);
  const latestOwnAge = ownExits.length ? Math.max(0, tipSlot - Math.max(...ownExits.map((row) => row.slot))) : null;
  const exitActivityScore = latestOwnAge == null ? (exits.length ? 8 : 0)
    : latestOwnAge <= 100000 ? 25 : latestOwnAge <= 1000000 ? 21
      : latestOwnAge <= 5000000 ? 16 : 12;
  return { score: Number((custodyScore + recencyScore + sourceSparsityScore + exitActivityScore).toFixed(2)),
    scoreComponents: { custody: Number(custodyScore.toFixed(2)), upgradeRecency: recencyScore,
      sourceIdlSparsity: sourceSparsityScore, sampledExitActivity: exitActivityScore },
    deployAgeSlots, sampledOutflowCount: exits.length, sampledOwnProgramOutflowCount: ownExits.length,
    latestOwnProgramOutflowSlotAge: latestOwnAge };
}

async function main() {
  const programs = buildCandidates().slice(0, programLimit);
  const programIds = programs.map((row) => row.programId);
  const currentPrograms = await rpc('getMultipleAccounts', [programIds,
    { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 4 } }]);
  const programDataIds = programs.map((row) => row.universe.programdataAddress);
  const currentProgramData = await rpc('getMultipleAccounts', [programDataIds,
    { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 48 } }]);
  const tipSlot = Math.max(currentPrograms.context.slot, currentProgramData.context.slot);
  programs.forEach((program, index) => {
    const info = currentPrograms.value[index];
    program.currentExecutable = Boolean(info?.executable);
    program.currentProgramOwner = info?.owner || null;
    program.programData = parseProgramData(currentProgramData.value[index]);
  });

  const scanTargets = [];
  programs.forEach((program) => program.authorities.slice(0, authoritiesPerProgram)
    .forEach((authority) => scanTargets.push({ program, authority })));
  const scans = await mapLimit(scanTargets, 3, async ({ authority }) => scanAuthority(authority));
  scanTargets.forEach(({ program, authority }, index) => {
    const compact = { authority: authority.authority, authorityAccountOwner: authority.authorityAccountOwner,
      authorityAccountDataLength: authority.authorityAccountDataLength, grossUsd: authority.grossUsd,
      credibleUsd: authority.credibleUsd, stableUsd: authority.stableUsd,
      tokenAccounts: [...authority.tokenAccounts].sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0)).slice(0, 6),
      exitScan: scans[index] };
    if (!program.sampledAuthorities) program.sampledAuthorities = [];
    program.sampledAuthorities.push(compact);
  });
  for (const program of programs) {
    Object.assign(program, scoreProgram(program, tipSlot));
    delete program.authorities;
  }
  programs.sort((a, b) => (b.score - a.score) || (b.custodyRankingUsd - a.custodyRankingUsd));
  const report = {
    generatedAt: new Date().toISOString(),
    method: {
      scope: 'Bounded to the top 20 token accounts for each of 3,987 current Jupiter verified-registry mints; not an exhaustive token-account census.',
      mapping: 'Observed off-curve token authority -> authority account owner -> current executable; recent successful outbound inner SPL transfer separately identifies the invoking signer program.',
      value: 'grossUsd uses registry price without liquidity validation. credibleUsd only includes strict, stable, or LST-tagged assets and remains a prioritization estimate, not exploitable value.',
      exclusions: 'Native/System/Token/Token-2022/ATA/loaders and programs already in the existing high-value queue are excluded from this long-tail queue.',
      score: '0-45 credible custody, 0-15 deployment recency, 0-15 manually assessed source/IDL sparsity, 0-25 sampled recent outbound signer activity.',
      limitations: [
        'Below-top-20 token accounts, mints absent from the registry, native SOL/stake, and compressed tokens are outside this census.',
        'Absence of a sampled outflow is not evidence that no withdrawal path exists.',
        'Program-owned authority state is not treated as control proof unless outbound invoke-signer evidence joins it to a parent program.',
        'Custody, locked allocations, bridge liquidity, and protocol TVL are not equivalent to an exploitable amount.'
      ]
    },
    source: { censusCompletedAt: raw.completedAt, censusObservationSlots: raw.observationSlots,
      censusDenominator: raw.denominator, executableUniverseSize: universe.size },
    liveCheck: { contextSlot: tipSlot, programCount: programs.length },
    ranking: programs,
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT_PATH, contextSlot: tipSlot,
    rankedPrograms: programs.length, top: programs.slice(0, 15).map((program) => ({ rank: programs.indexOf(program) + 1,
      score: program.score, programId: program.programId, label: program.annotation.label,
      credibleUsd: program.credibleUsd, grossUsd: program.grossUsd,
      lastDeploySlot: program.programData?.lastDeploySlot, ownProgramOutflows: program.sampledOwnProgramOutflowCount })) }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
