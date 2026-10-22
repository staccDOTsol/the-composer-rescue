#!/usr/bin/env node
// Offline crosswalk over previously captured read-only mainnet evidence:
// 1) reconcile sampled authorities to independently PDA-proved lending rows;
// 2) identify same-mint live inventory in Kamino Lend and Project 0/marginfi;
// 3) classify, without overstating, which targets merit combined atomic simulation.

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const RAW_PATH = path.join(HERE, 'mainnet-token-authority-census.raw.json');
const PROVENANCE_PATH = path.join(HERE, 'mainnet-token-authority-signer-provenance.json');
const CALLERS_PATH = path.join(HERE, 'mainnet-token-authority-caller-programs.json');
const STATE_PATH = path.join(HERE, 'mainnet-token-authority-state-proofs.json');
const LONG_TAIL_PATH = path.join(HERE, 'mainnet-long-tail-custody-ranked.json');
const MARGINFI_PATH = path.join(HERE, 'marginfi-vaults-current.json');
const LENDING_PATH = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/outputs/current-lending-vaults.json';
const OUT = path.join(HERE, 'mainnet-token-authority-flash-crosswalk.json');
const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
const provenance = JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf8'));
const callers = JSON.parse(fs.readFileSync(CALLERS_PATH, 'utf8'));
const states = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
const longTail = JSON.parse(fs.readFileSync(LONG_TAIL_PATH, 'utf8'));
const marginfi = JSON.parse(fs.readFileSync(MARGINFI_PATH, 'utf8'));
const lending = JSON.parse(fs.readFileSync(LENDING_PATH, 'utf8'));

const lendingRows = lending.protocols.flatMap((protocol) => protocol.rows);
const lendingByAddress = new Map(lendingRows.map((row) => [row.address, row]));

const exactLendingReconciliation = [];
for (const candidate of provenance.candidates) {
  const matches = candidate.tokenAccounts.map((token) => {
    const row = lendingByAddress.get(token.address);
    if (!row) return null;
    return {
      tokenAccount: token.address, mint: token.mint, symbol: token.symbol,
      protocol: row.protocol, programId: row.programId, reserve: row.reserve,
      market: row.market, controlVerified: row.controlVerified, proof: row.proof,
    };
  }).filter(Boolean);
  if (matches.length) exactLendingReconciliation.push({
    authority: candidate.authority, pricedGrossUsd: candidate.pricedGrossUsd, matches,
  });
}

function addInventory(map, provider, row, usdValue) {
  if (!row.controlVerified || row.kind && row.kind !== 'liquidity' || BigInt(row.rawAmount || '0') <= 0n) return;
  if (!map.has(row.mint)) map.set(row.mint, []);
  map.get(row.mint).push({
    provider, programId: row.programId || marginfi.program, vault: row.address,
    bank: row.bank || null, reserve: row.reserve || null, market: row.market || null,
    rawAmount: row.rawAmount, observedUsdValue: usdValue ?? null,
    pdaControlVerified: row.controlVerified,
  });
}

const inventory = new Map();
for (const row of lendingRows.filter((row) => row.protocol === 'Kamino Lend')) {
  addInventory(inventory, 'Kamino Lend', row, row.valuation?.usdValue);
}
for (const row of marginfi.rows) {
  addInventory(inventory, 'Project 0 / marginfi v1', row, row.valuation?.usdValue);
}

const longTailByProgram = new Map(longTail.ranking.map((row) => [row.programId, row]));
const stateSummaryByProgram = new Map(states.programSummary.map((row) => [row.programId, row]));
const authoritiesByAddress = new Map(raw.authorities.map((row) => [row.authority, row]));
const excluded = new Set([SYSTEM, TOKEN, TOKEN22]);

const targets = new Map();
function target(programId, evidenceType) {
  if (!targets.has(programId)) targets.set(programId, { programId, evidenceTypes: new Set(), assets: new Map() });
  targets.get(programId).evidenceTypes.add(evidenceType);
  return targets.get(programId);
}
function addAsset(row, token) {
  const existing = row.assets.get(token.mint) || { mint: token.mint, symbols: new Set(), sampledCustodyUsd: 0, tokenAccounts: new Set() };
  if (token.symbol) existing.symbols.add(token.symbol);
  existing.sampledCustodyUsd += token.usdValue || 0;
  existing.tokenAccounts.add(token.address);
  row.assets.set(token.mint, existing);
}

for (const group of raw.programsByDirectStateAuthority) {
  if (excluded.has(group.programId)) continue;
  const row = target(group.programId, 'direct_program_owned_authority_state');
  for (const authority of group.authorities) {
    const found = authoritiesByAddress.get(authority);
    for (const token of found?.tokenAccounts || []) addAsset(row, token);
  }
}
for (const program of callers.programs) {
  const row = target(program.programId, 'successful_outgoing_signer_provenance');
  for (const authority of program.authorities) for (const token of authority.tokenAccounts) addAsset(row, token);
}

const rows = [...targets.values()].map((row) => {
  const long = longTailByProgram.get(row.programId);
  const state = stateSummaryByProgram.get(row.programId);
  const caller = callers.programs.find((program) => program.programId === row.programId);
  const successfulOutflow = Boolean(caller) || (long?.sampledOwnProgramOutflowCount || 0) > 0;
  const assets = [...row.assets.values()].map((asset) => {
    const liveInventory = inventory.get(asset.mint) || [];
    let atomicRouteStatus = 'no_same_mint_inventory_observed';
    if (liveInventory.length && successfulOutflow) atomicRouteStatus = 'priority_candidate_not_yet_combined_simulated';
    else if (liveInventory.length) atomicRouteStatus = 'same_mint_inventory_but_exit_path_not_proven';
    return {
      mint: asset.mint, symbols: [...asset.symbols], sampledCustodyUsd: asset.sampledCustodyUsd,
      sampledTokenAccounts: [...asset.tokenAccounts], liveInventory,
      atomicRouteStatus,
    };
  }).sort((a, b) => b.sampledCustodyUsd - a.sampledCustodyUsd);
  return {
    programId: row.programId,
    currentExecutable: caller?.currentExecutable ?? long?.currentExecutable ?? state?.executable ?? null,
    evidenceTypes: [...row.evidenceTypes], successfulOutgoingSignerEvidence: successfulOutflow,
    sampledGrossUsd: assets.reduce((sum, asset) => sum + asset.sampledCustodyUsd, 0),
    exactStatePdaProofs: state?.exactPdaProofs || 0,
    assets,
    prioritySameMintAssets: assets.filter((asset) => asset.atomicRouteStatus === 'priority_candidate_not_yet_combined_simulated'),
  };
}).sort((a, b) => b.sampledGrossUsd - a.sampledGrossUsd);

const output = {
  timestamp: new Date().toISOString(), noTransactionsSubmitted: true,
  sources: { census: RAW_PATH, signerProvenance: PROVENANCE_PATH, callerPrograms: CALLERS_PATH, stateProofs: STATE_PATH, lending: LENDING_PATH, project0Marginfi: MARGINFI_PATH },
  interpretation: {
    liveInventory: 'verified nonzero token balance in a PDA-derived Kamino Lend or Project 0/marginfi liquidity vault; this is an upper-bound inventory observation, not proof the full amount can be flash-borrowed',
    atomicV1Envelope: '4096-byte transaction and 64 inline-account ceiling supplied by the audit specification; generic Project 0 v1 start/borrow/repay/end composition is separately proven in project0-v1-composition.json',
    priorityCandidate: 'same mint plus successful outgoing program-signer evidence; a program-specific combined read-only simulation is still required before saying the target exit is atomically reachable',
  },
  exactLendingReconciliation,
  targetCount: rows.length,
  priorityTargetCount: rows.filter((row) => row.prioritySameMintAssets.length).length,
  targets: rows,
};
fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  output: OUT,
  exactLendingAuthorities: exactLendingReconciliation.length,
  priorityTargets: rows.filter((row) => row.prioritySameMintAssets.length).map((row) => ({
    programId: row.programId, sampledGrossUsd: row.sampledGrossUsd,
    assets: row.prioritySameMintAssets.map((asset) => ({ symbol: asset.symbols, mint: asset.mint, custodyUsd: asset.sampledCustodyUsd, providers: [...new Set(asset.liveInventory.map((entry) => entry.provider))] })),
  })).slice(0, 40),
}, null, 2)}\n`);
