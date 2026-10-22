#!/usr/bin/env node
// Decode the legacy Anchor IDL account captured by moveusd-snapshot.js.

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = __dirname;
const INPUT = path.join(DIR, 'moveusd-current-state.json');
const OUTPUT = path.join(DIR, 'moveusd-onchain-idl.json');

const snapshot = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const encoded = snapshot.anchorIdlAccount?.dataBase64;
if (!encoded) throw new Error('snapshot does not contain an Anchor IDL account');

const raw = Buffer.from(encoded, 'base64');
if (raw.length < 44) throw new Error('Anchor IDL account is too short');
const compressedLength = raw.readUInt32LE(40);
if (44 + compressedLength > raw.length) throw new Error('Anchor IDL compressed length is out of bounds');
const compressed = raw.subarray(44, 44 + compressedLength);
const decoded = zlib.inflateSync(compressed);
const idl = JSON.parse(decoded.toString('utf8'));

fs.writeFileSync(OUTPUT, `${JSON.stringify(idl, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  address: idl.address,
  name: idl.metadata?.name || null,
  version: idl.metadata?.version || null,
  instructions: idl.instructions?.length || 0,
  accounts: idl.accounts?.length || 0,
  types: idl.types?.length || 0,
  errors: idl.errors?.length || 0,
  output: path.basename(OUTPUT),
}, null, 2)}\n`);
