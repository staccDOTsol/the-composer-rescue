#!/usr/bin/env node
/* Read-only same-asset flash-liquidity and v1-envelope prioritization overlay. */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ranking = JSON.parse(fs.readFileSync(path.join(DIR, 'mainnet-long-tail-custody-ranked.json')));
const marginfi = JSON.parse(fs.readFileSync(path.join(DIR, 'marginfi-vaults-current.json')));
const kvault = JSON.parse(fs.readFileSync(path.join(DIR, 'kvault-idle-pda-census.json')));
const OUTPUT = path.join(DIR, 'mainnet-long-tail-flash-overlay.json');
const envPath = fs.existsSync('/tmp/composer-helius-rpc.env')
  ? '/tmp/composer-helius-rpc.env' : '/tmp/composer-helius-only.env';
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL || env.HELIUS_RPC_URL;
if (!endpoint) throw new Error('RPC_URL unavailable');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let seq = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }) });
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
async function getMultiple(addresses, config) {
  const values = [];
  const slots = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const result = await rpc('getMultipleAccounts', [addresses.slice(i, i + 100), config]);
    slots.push(result.context.slot);
    values.push(...result.value);
  }
  return { values, slots };
}
function rawAmount(info) {
  if (!info?.data?.[0]) return 0n;
  const data = Buffer.from(info.data[0], 'base64');
  return data.length >= 8 ? data.readBigUInt64LE(0) : 0n;
}
function add(map, mint, amount, address, extra = {}) {
  if (!map.has(mint)) map.set(mint, { mint, rawAvailable: 0n, sources: [] });
  const item = map.get(mint);
  item.rawAvailable += amount;
  if (amount > 0n) item.sources.push({ address, rawAvailable: amount.toString(), ...extra });
}
function registryDecimals(program, mint) {
  for (const authority of program.sampledAuthorities || []) {
    for (const account of authority.tokenAccounts || []) {
      if (account.mint !== mint || !account.usdPrice || !account.usdValue) continue;
      const ui = account.usdValue / account.usdPrice;
      const raw = Number(account.rawAmount);
      if (!(ui > 0) || !(raw > 0)) continue;
      return Math.max(0, Math.round(Math.log10(raw / ui)));
    }
  }
  return null;
}
function ownOutflows(program) {
  return (program.sampledAuthorities || []).flatMap((authority) => (authority.exitScan?.outflows || [])
    .filter((outflow) => outflow.parentProgramId === program.programId)
    .map((outflow) => ({ ...outflow, stateAuthority: authority.authority })));
}

async function main() {
  // marginfi/Project 0: current liquidity-vault token balances are a hard
  // on-chain upper bound, not proof a particular Bank permits a flash route.
  const marginRows = marginfi.rows.filter((row) => row.kind === 'liquidity' && row.controlVerified);
  const marginAccounts = await getMultiple(marginRows.map((row) => row.address),
    { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 64, length: 8 } });
  const marginByMint = new Map();
  marginRows.forEach((row, i) => add(marginByMint, row.mint, rawAmount(marginAccounts.values[i]), row.address,
    { bank: row.bank, group: row.group }));

  // Kamino: Reserve::liquidity.available_amount at byte offset 224. These
  // reserves were independently KLend-owner checked in the Kvault census.
  const reserveEntries = Object.entries(kvault.reserves);
  const reserveAccounts = await getMultiple(reserveEntries.map(([address]) => address),
    { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 224, length: 8 } });
  const kaminoByMint = new Map();
  reserveEntries.forEach(([address, fact], i) => add(kaminoByMint, fact.liquidityMint,
    rawAmount(reserveAccounts.values[i]), address));

  const overlays = [];
  for (const program of ranking.ranking) {
    const exits = ownOutflows(program).sort((a, b) => b.slot - a.slot);
    const mints = [...new Set((program.sampledAuthorities || [])
      .flatMap((authority) => authority.tokenAccounts || []).map((account) => account.mint))];
    const sameAssetSources = [];
    for (const mint of mints) {
      const decimals = registryDecimals(program, mint);
      const mf = marginByMint.get(mint);
      const kl = kaminoByMint.get(mint);
      if (mf?.rawAvailable > 0n) sameAssetSources.push({ provider: 'marginfi_project0', mint,
        rawAvailableUpperBound: mf.rawAvailable.toString(), decimals,
        uiAvailableUpperBound: decimals == null ? null : Number(mf.rawAvailable) / (10 ** decimals),
        vaultCount: mf.sources.length, evidence: 'fresh PDA-bound Bank liquidity-vault balances',
        mintSpecificFlashValidation: false });
      if (kl?.rawAvailable > 0n) sameAssetSources.push({ provider: 'kamino_lend', mint,
        rawAvailableUpperBound: kl.rawAvailable.toString(), decimals,
        uiAvailableUpperBound: decimals == null ? null : Number(kl.rawAvailable) / (10 ** decimals),
        reserveCount: kl.sources.length, evidence: 'fresh KLend Reserve available_amount fields',
        mintSpecificFlashValidation: mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });
    }
    const sameAssetMints = new Set(sameAssetSources.map((source) => source.mint));
    const matchingExits = exits.filter((exit) => sameAssetMints.has(exit.observedVaultMint));
    const currentExit = matchingExits[0] || exits[0] || null;
    let exitWire = null;
    if (currentExit) {
      try {
        const tx = await rpc('getTransaction', [currentExit.signature,
          { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
        const encoded = Array.isArray(tx?.transaction) ? tx.transaction[0] : null;
        exitWire = encoded ? { serializedBytes: Buffer.from(encoded, 'base64').length,
          transactionVersion: tx.version ?? null } : null;
      } catch (error) { exitWire = { error: String(error.message || error) }; }
    }
    const hasLiquidity = sameAssetSources.length > 0;
    const hasMatchingExit = matchingExits.length > 0;
    const flashPriority = hasLiquidity && hasMatchingExit && program.annotation?.sourceSparsityScore >= 8 ? 'extreme'
      : hasLiquidity && hasMatchingExit ? 'high' : hasLiquidity ? 'medium' : 'low';
    overlays.push({ programId: program.programId, label: program.annotation?.label || null,
      custodyRankScore: program.score, credibleCustodyUsd: program.credibleUsd,
      flashPriority, sameAssetSources,
      observedExit: currentExit ? { signature: currentExit.signature, slot: currentExit.slot,
        rootProgramId: currentExit.rootProgramId, immediateSignerProgramId: currentExit.parentProgramId,
        stateAuthority: currentExit.stateAuthority, vault: currentExit.source, mint: currentExit.observedVaultMint,
        transactionAccountCount: currentExit.transactionAccountCount,
        topLevelInstructionCount: currentExit.topLevelInstructionCount, serializedBytes: exitWire?.serializedBytes ?? null } : null,
      atomicV1: {
        limits: { serializedBytes: 4096, inlineAccounts: 64 },
        observedExitAloneWithinLimits: currentExit ? Boolean(
          currentExit.transactionAccountCount <= 64 && exitWire?.serializedBytes <= 4096) : null,
        sameAssetExitObserved: hasMatchingExit,
        composedStatus: hasLiquidity && hasMatchingExit ? 'candidate_not_constructed_or_simulated' : 'not_prioritized',
        note: 'The observed exit alone fitting is not proof the flash-borrow + exit + repay union fits. Build exact instructions, deduplicate metas, serialize a v1 message, and simulate before claiming reachability.',
      },
    });
  }
  const report = { generatedAt: new Date().toISOString(), readOnly: true,
    sourceRanking: path.basename(path.join(DIR, 'mainnet-long-tail-custody-ranked.json')),
    observations: { marginfiSlots: marginAccounts.slots, kaminoSlots: reserveAccounts.slots,
      marginfiProgram: marginfi.program, kaminoProgram: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD' },
    methodology: {
      scope: 'Overlay only; it does not replace the executable/token-authority census.',
      liquidity: 'Amounts are current vault/reserve available-balance upper bounds. They are not guaranteed borrowable amounts and are not exploitable value.',
      reachability: 'A recent successful off-curve-authority outflow proves a live exit path. It does not prove an unauthorized caller can satisfy that path or repay a flash loan.',
      transactionEnvelope: 'The exact composed v1 message is not fabricated. Only the observed exit transaction is measured against 4096 bytes and 64 accounts; program-specific construction/simulation remains required.'
    },
    priorities: overlays.sort((a, b) => {
      const order = { extreme: 0, high: 1, medium: 2, low: 3 };
      return (order[a.flashPriority] - order[b.flashPriority]) || (b.custodyRankScore - a.custodyRankScore);
    }) };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT, top: report.priorities.slice(0, 15).map((row) => ({
    priority: row.flashPriority, programId: row.programId, label: row.label,
    credibleCustodyUsd: row.credibleCustodyUsd,
    lenders: row.sameAssetSources.map((source) => ({ provider: source.provider, mint: source.mint,
      uiAvailableUpperBound: source.uiAvailableUpperBound })), exit: row.observedExit,
    atomicV1: row.atomicV1.composedStatus })) }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
