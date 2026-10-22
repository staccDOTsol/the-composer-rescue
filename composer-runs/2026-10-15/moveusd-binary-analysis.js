#!/usr/bin/env node
// Offline current-binary and recent-transaction census. This intentionally
// treats the on-chain Anchor IDL as historical/stale evidence and derives the
// live instruction inventory from the deployed payload's own strings.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const BINARY = path.join(DIR, 'moveusd-current.so');
const TXS = path.join(DIR, 'moveusd-recent-transactions.json');
const OUT = path.join(DIR, 'moveusd-binary-analysis.json');

function asciiStrings(buffer, minimum = 5) {
  const out = [];
  let start = null;
  for (let i = 0; i <= buffer.length; i++) {
    const byte = i < buffer.length ? buffer[i] : 0;
    const printable = byte >= 0x20 && byte <= 0x7e;
    if (printable && start === null) start = i;
    if (!printable && start !== null) {
      if (i - start >= minimum) out.push(buffer.subarray(start, i).toString('ascii'));
      start = null;
    }
  }
  return out;
}

function snakeCase(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function discriminator(name) {
  return crypto.createHash('sha256').update(`global:${snakeCase(name)}`).digest().subarray(0, 8).toString('hex');
}

const binary = fs.readFileSync(BINARY);
const strings = asciiStrings(binary);
// Some adjacent Anchor instruction-name strings have no NUL separator (for
// example `Instruction: CreateTokenInstruction: CommitRedeem`). Scan every
// marker position first so the next marker itself provides an exact boundary.
const latin1 = binary.toString('latin1');
const instructionMarker = 'Instruction: ';
const markerOffsets = [];
for (let offset = latin1.indexOf(instructionMarker); offset !== -1;
  offset = latin1.indexOf(instructionMarker, offset + instructionMarker.length)) {
  markerOffsets.push(offset);
}
const instructionNames = [...new Set(markerOffsets.map((offset, index) => {
  const start = offset + instructionMarker.length;
  const end = markerOffsets[index + 1] ?? latin1.length;
  return (latin1.slice(start, end).match(/^[A-Za-z0-9]+/) || [null])[0];
}).filter(Boolean))].sort();
const liveMap = new Map(instructionNames.map((name) => [discriminator(name), name]));
const txs = JSON.parse(fs.readFileSync(TXS, 'utf8')).transactions;
const observed = new Map();
for (const tx of txs) {
  for (const ix of tx.controllerInstructions || []) {
    if (ix.level !== 'outer' || !ix.data?.hex) continue;
    const disc = ix.data.hex.slice(0, 16);
    const key = `${disc}:${ix.data.byteLength}:${ix.accounts.length}`;
    const row = observed.get(key) || {
      discriminator: disc,
      inferredName: liveMap.get(disc) || null,
      dataLength: ix.data.byteLength,
      accountCount: ix.accounts.length,
      count: 0,
      successCount: 0,
      failedCount: 0,
      sampleSignatures: [],
      signerSets: [],
      tokenOperationTypes: [],
    };
    row.count++;
    if (tx.error === null) row.successCount++; else row.failedCount++;
    if (row.sampleSignatures.length < 5) row.sampleSignatures.push(tx.signature);
    const signers = (tx.accountKeys || []).filter((keyRow) => keyRow.signer).map((keyRow) => keyRow.pubkey);
    const signerKey = signers.join(',');
    if (!row.signerSets.includes(signerKey)) row.signerSets.push(signerKey);
    for (const tokenIx of tx.tokenInstructions || []) {
      const type = tokenIx.parsed?.type;
      if (type && !row.tokenOperationTypes.includes(type)) row.tokenOperationTypes.push(type);
    }
    observed.set(key, row);
  }
}

const sourcePaths = strings.filter((value) => value.includes('programs/mintfx/src/'));
const securityStrings = strings.filter((value) => /permission|idempot|redemption|withdrawal|supply limit|replay|oracle|pyth|switchboard|price/i.test(value));
const output = {
  generatedAt: new Date().toISOString(),
  offline: true,
  binary: {
    path: path.basename(BINARY),
    bytes: binary.length,
    sha256: crypto.createHash('sha256').update(binary).digest('hex'),
  },
  currentInstructionNamesFromBinary: instructionNames,
  currentInstructionDiscriminators: Object.fromEntries(instructionNames.map((name) => [name, discriminator(name)])),
  observedRecentInstructionShapes: [...observed.values()].sort((a, b) => b.count - a.count),
  embeddedSourcePaths: [...new Set(sourcePaths)].sort(),
  securityRelevantStrings: [...new Set(securityStrings)].sort(),
  negativeSearches: {
    oracle: !strings.some((value) => /oracle/i.test(value)),
    pyth: !strings.some((value) => /pyth/i.test(value)),
    switchboard: !strings.some((value) => /switchboard/i.test(value)),
    mintViaSwapInstruction: !instructionNames.includes('MintViaSwap'),
  },
  staleIdlWarning: 'The decoded on-chain IDL identifies mintfx but predates the live binary: current binary strings and recent wire lengths include newer withdrawal/external-redemption instructions and extended argument layouts.',
};
fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  binary: output.binary,
  instructions: output.currentInstructionNamesFromBinary,
  recentShapes: output.observedRecentInstructionShapes.map((row) => ({ name: row.inferredName,
    discriminator: row.discriminator, dataLength: row.dataLength, accountCount: row.accountCount,
    count: row.count, successes: row.successCount, tokenOperations: row.tokenOperationTypes })),
  negativeSearches: output.negativeSearches,
}, null, 2)}\n`);
