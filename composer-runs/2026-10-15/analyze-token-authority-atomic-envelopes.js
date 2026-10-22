#!/usr/bin/env node
// Read-only transport-envelope analysis. This does not construct, simulate, sign,
// or submit a combined target transaction. It conservatively adds the full wire
// size/account count of an observed successful target transaction to the proven
// Project 0 start/borrow/repay/end control envelope.

const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const PROVENANCE = JSON.parse(fs.readFileSync(path.join(HERE, 'mainnet-token-authority-signer-provenance.json'), 'utf8'));
const CALLERS = JSON.parse(fs.readFileSync(path.join(HERE, 'mainnet-token-authority-caller-programs.json'), 'utf8'));
const LONG_TAIL = JSON.parse(fs.readFileSync(path.join(HERE, 'mainnet-long-tail-custody-ranked.json'), 'utf8'));
const CROSSWALK = JSON.parse(fs.readFileSync(path.join(HERE, 'mainnet-token-authority-flash-crosswalk.json'), 'utf8'));
const P0 = JSON.parse(fs.readFileSync(path.join(HERE, 'project0-v1-composition.json'), 'utf8'));
const OUT = path.join(HERE, 'mainnet-token-authority-atomic-envelopes.json');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LIMITS = { wireBytes: 4096, accounts: 64 };

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const parsed = await response.json();
      if (response.status === 429 || response.status >= 500) throw new Error(`${method}: retryable ${response.status}`);
      if (parsed.error) throw new Error(`${method}: ${parsed.error.code} ${parsed.error.message}`);
      return parsed.result;
    } catch (error) {
      last = error;
      if (attempt === 6) break;
      await sleep(500 * (2 ** attempt));
    }
  }
  throw last;
}

function latestCallerEvidence(programId) {
  const rows = [];
  for (const candidate of PROVENANCE.candidates) for (const evidence of candidate.provenance || []) {
    if (evidence.callerProgram === programId) rows.push(evidence);
  }
  return rows.sort((a, b) => b.slot - a.slot)[0] || null;
}

function latestLongTailEvidence(programId) {
  const ranked = LONG_TAIL.ranking.find((row) => row.programId === programId);
  const rows = (ranked?.sampledAuthorities || []).flatMap((authority) => authority.exitScan?.outflows || [])
    .filter((row) => row.parentProgramId === programId);
  return rows.sort((a, b) => b.slot - a.slot)[0] || null;
}

async function main() {
  const p0Control = P0.cases.find((row) => row.name === 'start_borrow_repay_end');
  if (!p0Control || p0Control.err) throw new Error('missing successful Project 0 borrow/repay control');
  const priorityPrograms = CROSSWALK.targets.filter((row) => row.prioritySameMintAssets.length)
    .filter((row) => row.programId !== P0.p0Program)
    .map((row) => row.programId);
  const selections = [];
  for (const programId of priorityPrograms) {
    const evidence = latestCallerEvidence(programId) || latestLongTailEvidence(programId);
    if (!evidence?.signature) continue;
    selections.push({ programId, evidence });
  }

  const rows = [];
  for (let index = 0; index < selections.length; index += 1) {
    const { programId, evidence } = selections[index];
    const [encoded, json] = await Promise.all([
      rpc('getTransaction', [evidence.signature, { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]),
      rpc('getTransaction', [evidence.signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]),
    ]);
    const wireBytes = encoded ? Buffer.from(encoded.transaction[0], 'base64').length : null;
    const staticAccounts = json?.transaction?.message?.accountKeys?.length ?? null;
    const loadedAccounts = (json?.meta?.loadedAddresses?.writable?.length || 0) + (json?.meta?.loadedAddresses?.readonly?.length || 0);
    const totalAccounts = staticAccounts === null ? null : staticAccounts + loadedAccounts;
    const conservativeWireBytes = wireBytes === null ? null : wireBytes + p0Control.v1Bytes;
    const conservativeAccounts = totalAccounts === null ? null : totalAccounts + p0Control.accountCount;
    const target = CROSSWALK.targets.find((row) => row.programId === programId);
    const sameMint = target.prioritySameMintAssets.map((asset) => ({
      mint: asset.mint, symbols: asset.symbols, sampledCustodyUsd: asset.sampledCustodyUsd,
      inventoryUsdByProvider: Object.fromEntries([...new Set(asset.liveInventory.map((entry) => entry.provider))].map((provider) => [provider, asset.liveInventory.filter((entry) => entry.provider === provider).reduce((sum, entry) => sum + (entry.observedUsdValue || 0), 0)])),
    }));
    rows.push({
      programId, currentExecutable: CALLERS.programs.find((row) => row.programId === programId)?.currentExecutable ?? target.currentExecutable,
      evidenceSignature: evidence.signature, evidenceSlot: evidence.slot,
      observedSuccessfulTransaction: { version: json?.version ?? null, wireBytes, staticAccounts, loadedAccounts, totalAccounts },
      project0Control: { case: p0Control.name, wireBytes: p0Control.v1Bytes, accounts: p0Control.accountCount, instructions: p0Control.instructionCount },
      conservativeFullTransactionSum: { wireBytes: conservativeWireBytes, accounts: conservativeAccounts },
      withinV1EnvelopeUnderConservativeSum: conservativeWireBytes <= LIMITS.wireBytes && conservativeAccounts <= LIMITS.accounts,
      sameMint,
    });
    process.stderr.write(`envelope ${index + 1}/${selections.length}\n`);
    await sleep(125);
  }
  rows.sort((a, b) => b.sameMint.reduce((sum, row) => sum + row.sampledCustodyUsd, 0) - a.sameMint.reduce((sum, row) => sum + row.sampledCustodyUsd, 0));
  const output = {
    timestamp: new Date().toISOString(), noTransactionsSubmitted: true, noCombinedSimulationPerformed: true,
    limits: LIMITS,
    interpretation: 'A true value only establishes generous transport headroom: even the entire observed successful target transaction plus the entire proven Project 0 control fit under conservative size/account sums. It does not establish that the target instruction accepts attacker-chosen state, that all inventory is flash-borrowable, or that an exploit exists.',
    programSpecificCombinedSimulationStillRequired: true,
    rows,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUT, rows: rows.map((row) => ({ programId: row.programId, evidenceSlot: row.evidenceSlot, observed: row.observedSuccessfulTransaction, conservative: row.conservativeFullTransactionSum, fits: row.withinV1EnvelopeUnderConservativeSum, sameMint: row.sameMint })) }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
