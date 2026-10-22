'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const idlPath = path.join(__dirname, 'unitas-idl-source', 'vault', 'vault.json');
const binaryPath = path.join(__dirname, 'valt-current.so');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
const binary = fs.readFileSync(binaryPath);

const pascal = (name) => name.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
const text = binary.toString('latin1');

const instructions = idl.instructions.map((instruction) => ({
  name: instruction.name,
  discriminatorHex: Buffer.from(instruction.discriminator).toString('hex'),
  accountCount: instruction.accounts.length,
  signerAccounts: instruction.accounts.filter((account) => account.signer).map((account) => account.name),
  writableAccounts: instruction.accounts.filter((account) => account.writable).map((account) => account.name),
  args: instruction.args,
  currentBinaryContainsInstructionLog: text.includes(`Instruction: ${pascal(instruction.name)}`),
}));

const errors = (idl.errors || []).map((error) => ({
  ...error,
  currentBinaryContainsName: text.includes(error.name),
  currentBinaryContainsMessage: text.includes(error.msg),
}));

const output = {
  generatedAt: new Date().toISOString(),
  currentBinary: {
    path: binaryPath,
    bytes: binary.length,
    sha256: crypto.createHash('sha256').update(binary).digest('hex'),
  },
  interfaceSource: {
    path: idlPath,
    commit: '17ed34217eb5b280c13a0e80b1727bc681070b3c',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(idlPath)).digest('hex'),
    externalSourceTreatedAsUntrustedUntilCrossChecked: true,
  },
  instructionCount: instructions.length,
  allInstructionLogsPresentInCurrentBinary: instructions.every((instruction) => instruction.currentBinaryContainsInstructionLog),
  instructions,
  errors,
};

fs.writeFileSync(path.join(__dirname, 'current-interface-evidence.json'), `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  instructionCount: output.instructionCount,
  allInstructionLogsPresentInCurrentBinary: output.allInstructionLogsPresentInCurrentBinary,
  instructions,
  errorsPresent: errors.filter((error) => error.currentBinaryContainsName || error.currentBinaryContainsMessage).length,
}, null, 2)}\n`);
