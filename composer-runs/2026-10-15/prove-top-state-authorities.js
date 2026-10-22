#!/usr/bin/env node
// Read-only state-reference and PDA proof for the highest-value off-curve
// authorities whose authority account is directly owned by an executable.

const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const RAW = path.join(__dirname, 'mainnet-token-authority-census.raw.json');
const OUT = path.join(__dirname, 'mainnet-token-authority-state-proofs.json');
const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const LOC = 'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn';
const SKR = 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';
const EXCLUDED_OWNERS = new Set([SYSTEM, TOKEN, TOKEN22]);
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function multiple(addresses) {
  const map = new Map(); const slots = [];
  for (let start = 0; start < addresses.length; start += 255) {
    const batch = addresses.slice(start, start + 255);
    const result = await rpc('getMultipleAccounts', [batch, { encoding: 'base64', commitment: 'confirmed' }]);
    slots.push(result.context.slot);
    batch.forEach((address, index) => map.set(address, result.value[index]));
    await sleep(125);
  }
  return { map, slots };
}

function offsets(haystack, needle) {
  const result = []; let from = 0;
  while (from <= haystack.length - needle.length) {
    const offset = haystack.indexOf(needle, from);
    if (offset < 0) break;
    result.push(offset); from = offset + 1;
  }
  return result;
}

function pda(seeds, program) {
  const [address, bump] = PublicKey.findProgramAddressSync(seeds, new PublicKey(program));
  return { address: address.toBase58(), bump };
}

function proveJupiterLock(authority, data, tokenAccounts) {
  if (data.length !== 296) return { applicable: true, layoutMatches: false };
  const base = new PublicKey(data.subarray(104, 136));
  const storedMint = new PublicKey(data.subarray(40, 72));
  const storedBump = data[136];
  const derived = pda([Buffer.from('escrow'), base.toBuffer()], LOC);
  const accounts = tokenAccounts.map((token) => {
    const [ata] = PublicKey.findProgramAddressSync([
      new PublicKey(authority).toBuffer(), new PublicKey(token.tokenProgram).toBuffer(), new PublicKey(token.mint).toBuffer(),
    ], ATA);
    return { tokenAccount: token.address, mint: token.mint, storedMintMatches: storedMint.toBase58() === token.mint, ata: ata.toBase58(), ataMatches: ata.toBase58() === token.address };
  });
  return {
    applicable: true, layoutMatches: true, base: base.toBase58(), storedMint: storedMint.toBase58(), storedBump,
    seed: '["escrow", base]', derived, authorityMatches: derived.address === authority && derived.bump === storedBump, tokenAccounts: accounts,
  };
}

function proveSkr(authority, data, tokenAccounts) {
  const derived = pda([Buffer.from('stake_config')], SKR);
  return {
    applicable: true, seed: '["stake_config"]', derived,
    authorityMatches: derived.address === authority,
    stateReferences: tokenAccounts.map((token) => ({
      tokenAccount: token.address, tokenAccountOffsets: offsets(data, new PublicKey(token.address).toBuffer()),
      mint: token.mint, mintOffsets: offsets(data, new PublicKey(token.mint).toBuffer()),
    })),
  };
}

async function main() {
  const census = JSON.parse(fs.readFileSync(RAW, 'utf8'));
  const selected = census.authorities
    .filter((row) => !row.onCurve && row.directExecutableOwner && !EXCLUDED_OWNERS.has(row.directExecutableOwner))
    .slice(0, 120);
  const authorityRead = await multiple(selected.map((row) => row.authority));
  const programs = [...new Set(selected.map((row) => row.directExecutableOwner))];
  const programRead = await multiple(programs);
  const rows = [];
  for (const candidate of selected) {
    const info = authorityRead.map.get(candidate.authority);
    const programInfo = programRead.map.get(candidate.directExecutableOwner);
    if (!info) continue;
    const data = Buffer.from(info.data[0], 'base64');
    const stateReferences = candidate.tokenAccounts.map((token) => ({
      tokenAccount: token.address, symbol: token.symbol, mint: token.mint, usdValue: token.usdValue,
      tokenAccountOffsets: offsets(data, new PublicKey(token.address).toBuffer()),
      mintOffsets: offsets(data, new PublicKey(token.mint).toBuffer()),
    }));
    const row = {
      authority: candidate.authority, pricedGrossUsd: candidate.pricedGrossUsd,
      stateOwner: info.owner, stateOwnerMatchesCensus: info.owner === candidate.directExecutableOwner,
      stateLength: data.length, stateDiscriminatorHex: data.subarray(0, 8).toString('hex'),
      stateOffCurve: !PublicKey.isOnCurve(new PublicKey(candidate.authority).toBytes()),
      ownerProgramExecutable: programInfo?.executable === true,
      stateReferences,
    };
    if (info.owner === LOC) row.specificPdaProof = proveJupiterLock(candidate.authority, data, candidate.tokenAccounts);
    if (info.owner === SKR) row.specificPdaProof = proveSkr(candidate.authority, data, candidate.tokenAccounts);
    rows.push(row);
  }
  const programSummary = [];
  for (const programId of programs) {
    const relevant = rows.filter((row) => row.stateOwner === programId);
    programSummary.push({
      programId, pricedGrossUsd: relevant.reduce((sum, row) => sum + row.pricedGrossUsd, 0),
      authorityProofs: relevant.length,
      stateReferencesFound: relevant.filter((row) => row.stateReferences.some((ref) => ref.tokenAccountOffsets.length || ref.mintOffsets.length)).length,
      exactPdaProofs: relevant.filter((row) => row.specificPdaProof?.authorityMatches).length,
      executable: relevant.every((row) => row.ownerProgramExecutable),
    });
  }
  programSummary.sort((a, b) => b.pricedGrossUsd - a.pricedGrossUsd);
  const output = {
    timestamp: new Date().toISOString(), sourceCensus: RAW,
    selection: 'top 120 direct program-owned off-curve authorities, excluding System and Token programs',
    noTransactionsSubmitted: true,
    observationSlots: { authorityMin: Math.min(...authorityRead.slots), authorityMax: Math.max(...authorityRead.slots), programMin: Math.min(...programRead.slots), programMax: Math.max(...programRead.slots) },
    programSummary, rows,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUT, observationSlots: output.observationSlots, programSummary }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
