'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const modules = path.resolve(__dirname, '..', 'kliquidity-sdk-official', 'node_modules');
const { Connection, PublicKey } = require(path.join(modules, '@solana', 'web3.js'));
const { utils: anchorUtils } = require(path.join(modules, '@coral-xyz', 'anchor'));

const VAULT_PROGRAM = new PublicKey('VALT7AM76ZWfRhjVeYQRrLvNRLvqBzNs8dTsAcLW3jj');
const STAKE_POOL = 'CFgrWjb9DYKVqf7QyQfmwjboDDkXpFHQ6292rnYxrjsa';
const SILO = 'xyLZUzaaFdn9tuoBAM7qLNEh5HFkTyjXFoSqoC4WBwb';
const KNOWN_SIGNATURES = [
  '34Q6HtE2wagf7aTxScwaNYFp6Py2Xn4rXJgT4xt6HnDyGSJsnPwNVmtfKKMcdahwe1ckFJ8RLmh2A1nmnR8TehEn',
];
const TARGET_SLOTS = new Set([457328977, 457317719]);

function readConfiguredRpc() {
  for (const name of ['RPC_URL', 'SOLANA_RPC', 'HEAVY_RPC_URL']) {
    if (process.env[name]) return process.env[name];
  }
  const configPath = path.join(os.homedir(), '.config', 'solana', 'cli', 'config.yml');
  const config = fs.readFileSync(configPath, 'utf8');
  const match = config.match(/^json_rpc_url:\s*(.+)\s*$/m);
  if (!match) throw new Error(`No json_rpc_url in ${configPath}`);
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function ixName(data, names) {
  if (!data) return null;
  let raw;
  try { raw = anchorUtils.bytes.bs58.decode(data); } catch (_) { return null; }
  return names.get(raw.subarray(0, 8).toString('hex')) || `unknown:${raw.subarray(0, 8).toString('hex')}`;
}

function simplifyInstruction(ix, names) {
  const programId = ix.programId.toBase58();
  const row = {
    programId,
    accounts: (ix.accounts || []).map((account) => account.toBase58()),
  };
  if (ix.data) {
    row.dataBase58 = ix.data;
    row.dataHex = Buffer.from(anchorUtils.bytes.bs58.decode(ix.data)).toString('hex');
  }
  if (programId === VAULT_PROGRAM.toBase58()) row.vaultInstruction = ixName(ix.data, names);
  if (ix.parsed) row.parsed = ix.parsed;
  return row;
}

function tokenBalanceRows(tx, accountKeys) {
  const pre = new Map((tx.meta?.preTokenBalances || []).map((row) => [
    `${accountKeys[row.accountIndex]}:${row.mint}`,
    BigInt(row.uiTokenAmount.amount),
  ]));
  const post = new Map((tx.meta?.postTokenBalances || []).map((row) => [
    `${accountKeys[row.accountIndex]}:${row.mint}`,
    BigInt(row.uiTokenAmount.amount),
  ]));
  return [...new Set([...pre.keys(), ...post.keys()])].map((key) => ({
    account: key.slice(0, key.indexOf(':')),
    mint: key.slice(key.indexOf(':') + 1),
    pre: (pre.get(key) || 0n).toString(),
    post: (post.get(key) || 0n).toString(),
    delta: ((post.get(key) || 0n) - (pre.get(key) || 0n)).toString(),
  })).filter((row) => row.delta !== '0');
}

async function main() {
  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, 'unitas-idl-source', 'vault', 'vault.json'), 'utf8'));
  const names = new Map(idl.instructions.map((ix) => [Buffer.from(ix.discriminator).toString('hex'), ix.name]));
  const connection = new Connection(readConfiguredRpc(), 'confirmed');
  const recent = await connection.getSignaturesForAddress(new PublicKey(STAKE_POOL), { limit: 32 }, 'confirmed');
  const discovered = recent.filter((row) => TARGET_SLOTS.has(row.slot)).map((row) => row.signature);
  const signatures = [...new Set([...discovered, ...KNOWN_SIGNATURES])];
  const records = [];

  for (const signature of signatures) {
    const [tx, encodedResponse] = await Promise.all([
      connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }),
      connection._rpcRequest('getTransaction', [signature, {
        commitment: 'confirmed',
        encoding: 'base64',
        maxSupportedTransactionVersion: 0,
      }]),
    ]);
    if (!tx || !encodedResponse.result) throw new Error(`Transaction unavailable: ${signature}`);
    const accountKeys = tx.transaction.message.accountKeys.map((entry) => entry.pubkey.toBase58());
    const inner = (tx.meta?.innerInstructions || []).map((group) => ({
      parentIndex: group.index,
      instructions: group.instructions.map((ix) => simplifyInstruction(ix, names)),
    }));
    const changed = tokenBalanceRows(tx, accountKeys);
    const sourceChanges = changed.filter((row) => [STAKE_POOL, SILO].includes(row.account));
    const txSerializedBytes = Buffer.from(encodedResponse.result.transaction[0], 'base64').length;
    records.push({
      signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      version: tx.version,
      err: tx.meta?.err || null,
      feeLamports: tx.meta?.fee,
      computeUnitsConsumed: tx.meta?.computeUnitsConsumed,
      txSerializedBytes,
      accountCount: accountKeys.length,
      accountKeys: tx.transaction.message.accountKeys.map((entry) => ({
        address: entry.pubkey.toBase58(),
        signer: entry.signer,
        writable: entry.writable,
        source: entry.source,
      })),
      topLevelInstructions: tx.transaction.message.instructions.map((ix) => simplifyInstruction(ix, names)),
      innerInstructions: inner,
      changedTokenBalances: changed,
      vaultTokenBalanceChanges: sourceChanges,
      logMessages: tx.meta?.logMessages || [],
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    submittedTransactions: 0,
    records,
  };
  const outputPath = path.join(__dirname, 'target-transaction-evidence.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(records.map((row) => ({
    signature: row.signature,
    slot: row.slot,
    blockTime: row.blockTime,
    version: row.version,
    err: row.err,
    txSerializedBytes: row.txSerializedBytes,
    accountCount: row.accountCount,
    signers: row.accountKeys.filter((key) => key.signer).map((key) => key.address),
    vaultInstructions: row.topLevelInstructions.filter((ix) => ix.vaultInstruction),
    vaultTokenBalanceChanges: row.vaultTokenBalanceChanges,
    changedTokenBalances: row.changedTokenBalances,
    logs: row.logMessages.filter((line) => /Instruction:|TransferChecked|BurnChecked|MintTo|success|failed/.test(line)),
  })), null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
