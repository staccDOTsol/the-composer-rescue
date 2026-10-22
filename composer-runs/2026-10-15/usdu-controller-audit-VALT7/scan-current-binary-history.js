'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const modules = path.resolve(__dirname, '..', 'kliquidity-sdk-official', 'node_modules');
const { Connection, PublicKey } = require(path.join(modules, '@solana', 'web3.js'));
const { utils: anchorUtils } = require(path.join(modules, '@coral-xyz', 'anchor'));

const PROGRAM = new PublicKey('VALT7AM76ZWfRhjVeYQRrLvNRLvqBzNs8dTsAcLW3jj');
const STAKE_POOL = 'CFgrWjb9DYKVqf7QyQfmwjboDDkXpFHQ6292rnYxrjsa';
const SILO = 'xyLZUzaaFdn9tuoBAM7qLNEh5HFkTyjXFoSqoC4WBwb';
const CURRENT_BINARY_DEPLOY_SLOT = 350866586;

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

function tokenAmountMap(rows, accountKeys) {
  const map = new Map();
  for (const row of rows || []) {
    const address = accountKeys[row.accountIndex];
    if (!address) continue;
    map.set(`${address}:${row.mint}`, BigInt(row.uiTokenAmount.amount));
  }
  return map;
}

function parsedTransfer(ix) {
  if (!ix || !ix.parsed || !ix.parsed.info) return null;
  const type = ix.parsed.type;
  if (!['transfer', 'transferChecked', 'burn', 'burnChecked', 'mintTo', 'mintToChecked'].includes(type)) return null;
  const info = ix.parsed.info;
  return {
    type,
    programId: ix.programId.toBase58(),
    source: info.source || info.account || null,
    destination: info.destination || null,
    mint: info.mint || null,
    authority: info.authority || info.owner || info.multisigAuthority || info.mintAuthority || null,
    amount: info.amount || info.tokenAmount?.amount || null,
  };
}

async function main() {
  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, 'unitas-idl-source', 'vault', 'vault.json'), 'utf8'));
  const names = new Map(idl.instructions.map((ix) => [Buffer.from(ix.discriminator).toString('hex'), ix.name]));
  const connection = new Connection(readConfiguredRpc(), 'confirmed');

  const signatures = [];
  let before;
  while (true) {
    const page = await connection.getSignaturesForAddress(PROGRAM, { before, limit: 1000 }, 'confirmed');
    signatures.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  const postDeploy = signatures.filter((row) => row.slot >= CURRENT_BINARY_DEPLOY_SLOT);

  const records = [];
  const batchSize = 5;
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  for (let start = 0; start < postDeploy.length; start += batchSize) {
    const batch = postDeploy.slice(start, start + batchSize);
    let txs;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        txs = await connection.getParsedTransactions(batch.map((row) => row.signature), {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        break;
      } catch (error) {
        if (!/Too many requests/i.test(String(error)) || attempt === 5) throw error;
        await wait(750 * (attempt + 1));
      }
    }
    txs.forEach((tx, index) => {
      const sigRow = batch[index];
      if (!tx) {
        records.push({ signature: sigRow.signature, slot: sigRow.slot, unavailable: true });
        return;
      }
      const accountKeys = tx.transaction.message.accountKeys.map((entry) => entry.pubkey.toBase58());
      const signers = tx.transaction.message.accountKeys.filter((entry) => entry.signer).map((entry) => entry.pubkey.toBase58());
      const topLevelInstructions = tx.transaction.message.instructions
        .filter((ix) => ix.programId.equals(PROGRAM))
        .map((ix) => ({ name: ixName(ix.data, names), accounts: (ix.accounts || []).map((key) => key.toBase58()) }));
      const innerInstructions = [];
      const tokenInstructions = [];
      for (const group of tx.meta?.innerInstructions || []) {
        for (const ix of group.instructions || []) {
          if (ix.programId?.equals(PROGRAM)) {
            innerInstructions.push({ parentIndex: group.index, name: ixName(ix.data, names), accounts: (ix.accounts || []).map((key) => key.toBase58()) });
          }
          const transfer = parsedTransfer(ix);
          if (transfer && (transfer.source === STAKE_POOL || transfer.destination === STAKE_POOL || transfer.source === SILO || transfer.destination === SILO)) {
            tokenInstructions.push({ parentIndex: group.index, ...transfer });
          }
        }
      }
      const pre = tokenAmountMap(tx.meta?.preTokenBalances, accountKeys);
      const post = tokenAmountMap(tx.meta?.postTokenBalances, accountKeys);
      const deltas = {};
      for (const vault of [STAKE_POOL, SILO]) {
        const matches = new Set([...pre.keys(), ...post.keys()].filter((key) => key.startsWith(`${vault}:`)));
        for (const key of matches) {
          const delta = (post.get(key) || 0n) - (pre.get(key) || 0n);
          deltas[key] = delta.toString();
        }
      }
      records.push({
        signature: sigRow.signature,
        slot: tx.slot,
        blockTime: tx.blockTime,
        err: tx.meta?.err || null,
        fee: tx.meta?.fee || null,
        signers,
        topLevelInstructions,
        innerInstructions,
        tokenInstructions,
        vaultDeltas: deltas,
        logTail: (tx.meta?.logMessages || []).slice(-12),
      });
    });
    await wait(125);
  }

  const successful = records.filter((row) => !row.unavailable && row.err === null);
  const touchingVaults = successful.filter((row) => Object.values(row.vaultDeltas || {}).some((delta) => delta !== '0'));
  const outgoing = touchingVaults.filter((row) => Object.values(row.vaultDeltas || {}).some((delta) => BigInt(delta) < 0n));
  const instructionHistogram = {};
  for (const row of successful) {
    for (const ix of [...row.topLevelInstructions, ...row.innerInstructions]) {
      instructionHistogram[ix.name] = (instructionHistogram[ix.name] || 0) + 1;
    }
  }
  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    submittedTransactions: 0,
    commitment: 'confirmed',
    programId: PROGRAM.toBase58(),
    currentBinaryDeploySlot: CURRENT_BINARY_DEPLOY_SLOT,
    signatureRows: signatures.length,
    postDeploySignatureRows: postDeploy.length,
    fetchedTransactions: records.length,
    successfulTransactions: successful.length,
    unavailableTransactions: records.filter((row) => row.unavailable).length,
    instructionHistogram,
    vaultMovementTransactions: touchingVaults.length,
    outgoingVaultMovementTransactions: outgoing.length,
    outgoing,
    records,
  };
  fs.writeFileSync(path.join(__dirname, 'current-binary-history.json'), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ...output,
    records: undefined,
    outgoing: outgoing.map((row) => ({
      signature: row.signature,
      slot: row.slot,
      blockTime: row.blockTime,
      signers: row.signers,
      instructions: [...row.topLevelInstructions, ...row.innerInstructions].map((ix) => ix.name),
      tokenInstructions: row.tokenInstructions,
      vaultDeltas: row.vaultDeltas,
    })),
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
