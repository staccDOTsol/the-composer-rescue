#!/usr/bin/env node
'use strict';

// Reproducible, local-only metadata/disassembly extract for the exact ELF
// downloaded by janusfi-current-inventory.js.

const crypto = require('crypto');
const fs = require('fs');
const {execFileSync} = require('child_process');

const DIR = __dirname;
const ELF = `${DIR}/janusfi-current.so`;
const OUT = `${DIR}/janusfi-elf-analysis.json`;
const LLVM = '/Users/stacc/.local/share/solana/install/active_release/bin/platform-tools-sdk/sbf/dependencies/platform-tools/llvm/bin';
const run = (command, args) => execFileSync(command, args,
  {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
const bytes = fs.readFileSync(ELF);
const strings = run('/usr/bin/strings', ['-a', ELF]).split(/\r?\n/);
const sourcePathStrings = strings.filter((line) =>
  line.includes('programs/janusfi/') || line.includes('crates/oracle-interface/'));
const dispatcherDisassembly = run(`${LLVM}/llvm-objdump`, [
  '-d', '--no-show-raw-insn', '--start-address=0x10001f228',
  '--stop-address=0x10001f500', ELF,
]);
const output = {
  generatedAt: new Date().toISOString(), localOnly: true,
  elfPath: ELF, bytes: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  fileIdentification: run('/usr/bin/file', [ELF]).trim(),
  elfHeader: run(`${LLVM}/llvm-readelf`, ['-h', ELF]),
  sectionHeaders: run(`${LLVM}/llvm-readelf`, ['-S', ELF]),
  sourcePathStrings,
  dispatcher: {
    entryPoint: '0x10001f500',
    maximumAcceptedInstructionTag: 21,
    maximumTagEvidence: 'At 0x10001f258 the first data byte is loaded; 0x10001f260 branches out when it is greater than 0x15.',
    swapTag: 7,
    swapCallSite: '0x10001f4d0',
    swapCallRelativeImmediate: '-0x18a6',
    swapCallTarget: '0x100012fa8',
    disassembly: dispatcherDisassembly,
  },
};
fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({output: OUT, bytes: output.bytes, sha256: output.sha256,
  sourcePathStrings: output.sourcePathStrings, dispatcher: {
    maximumAcceptedInstructionTag: output.dispatcher.maximumAcceptedInstructionTag,
    swapTag: output.dispatcher.swapTag, swapCallTarget: output.dispatcher.swapCallTarget,
  }}, null, 2));
