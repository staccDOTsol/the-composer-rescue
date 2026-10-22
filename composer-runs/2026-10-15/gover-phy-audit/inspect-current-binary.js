#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const binaryPath = path.join(HERE, 'spl-governance-current.so');
const bytes = fs.readFileSync(binaryPath);
const printable = bytes.toString('latin1').match(/[\x20-\x7e]{4,}/g) || [];
const joined = printable.join('\n');
const needles = [
  '3.1.7',
  'governance/program/src/processor/process_execute_transaction.rs',
  'governance/program/src/processor/proposal_versioned_transactions/process_execute_proposal_versioned_transaction.rs',
  'account-governance',
  'native-treasury',
  "Invalid State: Can't execute transaction",
  "Can't execute transaction within its hold up time",
  'Transaction already executed',
  'Invalid Proposal for ProposalTransaction,',
  'Governing Token Owner or Delegate must sign transaction',
  'Governance PDA must sign',
  'Loaded account does not match pubkey from lookup table',
  'Account is protected, it cannot be passed into a CPI as writable',
  'Program is in maintenance mode and cannot create proposals',
];
const output = {
  generatedAt: new Date().toISOString(),
  binaryPath,
  byteLength: bytes.length,
  elfMagicHex: bytes.subarray(0, 4).toString('hex'),
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  evidence: Object.fromEntries(needles.map((needle) => [needle, joined.includes(needle)])),
  sourceCaveat: 'Printable-string evidence identifies embedded version/path/error text but does not establish source equivalence; behavioral claims use the exact ELF in local-fork simulation.',
};
fs.writeFileSync(path.join(HERE, 'current-binary-evidence.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
