#!/usr/bin/env node
// Read-only current executable and upgrade-metadata check for programs observed
// signing successful outgoing token transfers in the signer-provenance sample.

const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const SOURCE = path.join(__dirname, 'mainnet-token-authority-signer-provenance.json');
const OUT = path.join(__dirname, 'mainnet-token-authority-caller-programs.json');
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
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

async function multiple(addresses) {
  const map = new Map(); const slots = [];
  for (let start = 0; start < addresses.length; start += 255) {
    const batch = addresses.slice(start, start + 255);
    const result = await rpc('getMultipleAccounts', [batch, { encoding: 'base64', commitment: 'confirmed' }]);
    slots.push(result.context.slot);
    batch.forEach((address, index) => map.set(address, result.value[index]));
  }
  return { map, slots };
}

function decodeProgramDataAddress(info) {
  if (!info || info.owner !== UPGRADEABLE_LOADER) return null;
  const data = Buffer.from(info.data[0], 'base64');
  if (data.length < 36 || data.readUInt32LE(0) !== 2) return null;
  return new PublicKey(data.subarray(4, 36)).toBase58();
}

function decodeProgramData(info) {
  if (!info) return null;
  const data = Buffer.from(info.data[0], 'base64');
  if (data.length < 13 || data.readUInt32LE(0) !== 3) return { layoutMatches: false };
  const deploySlot = data.readBigUInt64LE(4).toString();
  const option = data[12];
  let upgradeAuthority = null;
  if (option === 1 && data.length >= 45) upgradeAuthority = new PublicKey(data.subarray(13, 45)).toBase58();
  return { layoutMatches: option === 0 || option === 1, deploySlot, upgradeAuthority };
}

async function main() {
  const source = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const byProgram = new Map();
  for (const candidate of source.candidates) {
    const byCandidateProgram = new Map();
    for (const row of candidate.provenance || []) {
      if (!row.callerProgram) continue;
      if (!byCandidateProgram.has(row.callerProgram)) byCandidateProgram.set(row.callerProgram, []);
      byCandidateProgram.get(row.callerProgram).push(row);
    }
    for (const [programId, evidence] of byCandidateProgram) {
      if (!byProgram.has(programId)) byProgram.set(programId, []);
      byProgram.get(programId).push({
        authority: candidate.authority,
        pricedGrossUsd: candidate.pricedGrossUsd,
        tokenAccounts: candidate.tokenAccounts,
        successfulOutgoingTransferEvidence: evidence.length,
        uniqueSignatures: [...new Set(evidence.map((row) => row.signature))].length,
        latestEvidenceSlot: Math.max(...evidence.map((row) => row.slot)),
      });
    }
  }

  const programIds = [...byProgram.keys()].sort();
  const programRead = await multiple(programIds);
  const programDataAddresses = [...new Set(programIds.map((id) => decodeProgramDataAddress(programRead.map.get(id))).filter(Boolean))];
  const programDataRead = await multiple(programDataAddresses);
  const programs = programIds.map((programId) => {
    const info = programRead.map.get(programId);
    const authorities = byProgram.get(programId);
    const programDataAddress = decodeProgramDataAddress(info);
    return {
      programId,
      currentAccountExists: Boolean(info),
      currentExecutable: info?.executable === true,
      loader: info?.owner || null,
      lamports: info?.lamports ?? null,
      programDataAddress,
      programData: decodeProgramData(programDataRead.map.get(programDataAddress)),
      sampledAttributedGrossUsd: authorities.reduce((sum, row) => sum + row.pricedGrossUsd, 0),
      attributedAuthorityCount: authorities.length,
      authorities,
    };
  }).sort((a, b) => b.sampledAttributedGrossUsd - a.sampledAttributedGrossUsd);

  const slots = [...programRead.slots, ...programDataRead.slots];
  const output = {
    timestamp: new Date().toISOString(), source: SOURCE, noTransactionsSubmitted: true,
    attribution: 'caller program immediately above the successful outgoing Token/Token-2022 CPI in sampled confirmed transaction history',
    warning: 'sampledAttributedGrossUsd is a top-holder sample and is not additive when more than one caller program is observed for the same authority',
    observationSlots: { min: Math.min(...slots), max: Math.max(...slots) },
    summary: {
      callerPrograms: programs.length,
      currentExecutable: programs.filter((row) => row.currentExecutable).length,
      missingOrNotExecutable: programs.filter((row) => !row.currentExecutable).map((row) => row.programId),
    },
    programs,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUT, observationSlots: output.observationSlots, summary: output.summary, programs: programs.map((row) => ({ programId: row.programId, currentExecutable: row.currentExecutable, sampledAttributedGrossUsd: row.sampledAttributedGrossUsd, authorityCount: row.attributedAuthorityCount, programDataAddress: row.programDataAddress, deploySlot: row.programData?.deploySlot, upgradeAuthority: row.programData?.upgradeAuthority })) }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
