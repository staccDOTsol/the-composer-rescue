#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const { Connection, PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const lines = fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\r?\n/);
const match = lines.find((line) => line.startsWith('RPC_URL='));
if (!match) throw new Error('RPC_URL unavailable');

const connection = new Connection(match.slice('RPC_URL='.length), 'confirmed');
const wallet = {
  publicKey: PublicKey.default,
  signTransaction: async () => { throw new Error('read-only'); },
  signAllTransactions: async () => { throw new Error('read-only'); },
};
const provider = new anchor.AnchorProvider(connection, wallet, {});

async function main() {
  const programId = new PublicKey('vesFcnNXtfS9JMtspbe9SkMJiRiSPwsywuWMjYwxQ2K');
  const idl = await anchor.Program.fetchIdl(programId, provider);
  if (!idl) throw new Error('No on-chain Anchor IDL found');
  const output = path.join(__dirname, 'vesfcn-idl.json');
  fs.writeFileSync(output, `${JSON.stringify(idl, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, address: idl.address || null,
    instructions: (idl.instructions || []).map((ix) => ix.name),
    accounts: (idl.accounts || []).map((account) => account.name),
    errors: idl.errors || [] }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
