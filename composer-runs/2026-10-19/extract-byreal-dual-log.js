#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const source = process.argv[2];
const output = process.argv[3];
if (!source || !output) throw new Error('usage: extract-byreal-dual-log.js INPUT OUTPUT');
const rows = fs.readFileSync(source, 'utf8').split(/\r?\n/).filter(Boolean)
  .map(line => { try { return JSON.parse(line); } catch (_) { return null; } }).filter(Boolean);
const cases = rows.filter(row => /^dual_(boundary|klend_project0|asymmetric)/.test(row.label || ''));
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, JSON.stringify({
  extractedAt: new Date().toISOString(), sourceLog: source,
  note: 'Signed v1 local-fork simulations captured before the fork oracle aged stale; no transaction broadcast.',
  cases,
}, null, 2) + '\n');
console.log(JSON.stringify({output, cases: cases.map(row => ({label: row.label, err: row.err,
  unitsConsumed: row.units, wire: row.wire, attackerUsdcDelta: row.deltas?.attackerUsdc}))}));
