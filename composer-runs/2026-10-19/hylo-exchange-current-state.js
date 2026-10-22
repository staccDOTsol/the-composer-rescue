#!/usr/bin/env node
// Read-only Oct 19 Hylo deployment, custody, and recent-instruction probe.
// It never signs, submits, or broadcasts a transaction.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const {
  Connection,
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const spl = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const ROOT = __dirname;
const ENV_PATH = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
const OUTPUT = `${ROOT}/hylo-exchange-current-state.json`;
const BINARY = `${ROOT}/hylo-exchange-current.so`;
const PRIOR_BINARY = `${ROOT}/../2026-10-15/hylo-exchange-current.so`;
const IDL_PATH = `${ROOT}/../2026-10-15/hylo-exchange-sdk-source/hylo-idl/idls/hylo_exchange.json`;
const HYLO = new PublicKey('HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn');
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const JITOSOL = new PublicKey('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');
const HYLO_STATE = PublicKey.findProgramAddressSync([Buffer.from('hylo')], HYLO)[0];
const HYUSD = PublicKey.findProgramAddressSync([Buffer.from('hyUSD')], HYLO)[0];
const XSOL = PublicKey.findProgramAddressSync([Buffer.from('xSOL')], HYLO)[0];
const VAULT_AUTH = PublicKey.findProgramAddressSync([Buffer.from('vault_auth'), JITOSOL.toBuffer()], HYLO)[0];
const FEE_AUTH = PublicKey.findProgramAddressSync([Buffer.from('fee_auth'), JITOSOL.toBuffer()], HYLO)[0];
const JITOSOL_VAULT = spl.getAssociatedTokenAddressSync(JITOSOL, VAULT_AUTH, true);
const JITOSOL_FEE_VAULT = spl.getAssociatedTokenAddressSync(JITOSOL, FEE_AUTH, true);

function readEnv(path) {
  const out = {};
  if (!fs.existsSync(path)) return out;
  for (const rawLine of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!rawLine || rawLine.trimStart().startsWith('#')) continue;
    const raw = rawLine.replace(/^\s*export\s+/, '');
    const index = raw.indexOf('=');
    if (index > 0) out[raw.slice(0, index).trim()] = raw.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function parseProgramData(data) {
  if (data.length < 45 || data.readUInt32LE(0) !== 3) throw new Error('Unexpected ProgramData layout');
  const hasAuthority = data[12] === 1;
  const metadataLength = hasAuthority ? 45 : 13;
  return {
    deploySlot: data.readBigUInt64LE(4).toString(),
    upgradeAuthority: hasAuthority ? new PublicKey(data.subarray(13, 45)).toBase58() : null,
    metadataLength,
    executable: data.subarray(metadataLength),
  };
}

function tokenAccount(info) {
  if (!info || !info.owner.equals(TOKEN) || info.data.length < 165) return null;
  return {
    mint: new PublicKey(info.data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(info.data.subarray(32, 64)).toBase58(),
    amountRaw: info.data.readBigUInt64LE(64).toString(),
    decimals: 9,
  };
}

function mintAccount(info) {
  if (!info || !info.owner.equals(TOKEN) || info.data.length < 82) return null;
  return {
    supplyRaw: info.data.readBigUInt64LE(36).toString(),
    decimals: info.data[44],
    initialized: info.data[45] !== 0,
  };
}

function writableAt(message, loaded, index) {
  const staticCount = (message.staticAccountKeys || message.accountKeys).length;
  const header = message.header;
  if (index < staticCount) {
    if (index < header.numRequiredSignatures) {
      return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
    }
    return index < staticCount - header.numReadonlyUnsignedAccounts;
  }
  return index < staticCount + loaded.writable.length;
}

function instructionImage(tx, instruction, outerIndex, innerIndex, byDiscriminator) {
  const message = tx.transaction.message;
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  const keys = [...(message.staticAccountKeys || message.accountKeys), ...loaded.writable, ...loaded.readonly]
    .map(key => key instanceof PublicKey ? key : new PublicKey(key));
  const program = keys[instruction.programIdIndex];
  if (!program.equals(HYLO)) return null;
  const data = typeof instruction.data === 'string'
    ? Buffer.from(bs58.decode(instruction.data))
    : Buffer.from(instruction.data);
  const discriminatorHex = data.subarray(0, 8).toString('hex');
  const schema = byDiscriminator.get(discriminatorHex);
  const accountIndices = instruction.accountKeyIndexes || instruction.accounts;
  return {
    outerIndex,
    innerIndex,
    name: schema?.name || null,
    discriminatorHex,
    dataHex: data.toString('hex'),
    accounts: accountIndices.map((accountIndex, schemaIndex) => ({
      name: schema?.accounts?.[schemaIndex]?.name || null,
      address: keys[accountIndex].toBase58(),
      signer: accountIndex < message.header.numRequiredSignatures,
      writable: writableAt(message, loaded, accountIndex),
    })),
  };
}

async function main() {
  const env = readEnv(ENV_PATH);
  const rpcUrl = env.SOLANA_RPC || env.SOLANA_RPC_URL || env.RPC || env.RPC_URL
    || env.HEAVY_RPC_URL || env.FLUX_RPC_A || env.FLUX_RPC_B
    || ['https:', '', 'api.mainnet-beta.solana.com'].join('/');
  const connection = new Connection(rpcUrl, {commitment: 'confirmed'});
  const genesisHash = await connection.getGenesisHash();
  const expectedGenesisHash = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  if (genesisHash !== expectedGenesisHash) throw new Error('Configured RPC is not Solana mainnet-beta');
  const idlBytes = fs.readFileSync(IDL_PATH);
  const idl = JSON.parse(idlBytes);
  const byDiscriminator = new Map(idl.instructions.map(ix => [Buffer.from(ix.discriminator).toString('hex'), ix]));

  const observationSlot = await connection.getSlot('confirmed');
  const programResponse = await connection.getAccountInfoAndContext(HYLO, 'confirmed');
  const programInfo = programResponse.value;
  if (!programInfo || !programInfo.owner.equals(LOADER) || programInfo.data.readUInt32LE(0) !== 2) {
    throw new Error('Current program account is missing or has an unexpected loader layout');
  }
  const programDataAddress = new PublicKey(programInfo.data.subarray(4, 36));
  const programDataResponse = await connection.getAccountInfoAndContext(programDataAddress, 'confirmed');
  const parsedProgramData = parseProgramData(programDataResponse.value.data);
  fs.writeFileSync(BINARY, parsedProgramData.executable);

  const importantAddresses = [HYLO_STATE, JITOSOL, JITOSOL_VAULT, JITOSOL_FEE_VAULT, HYUSD, XSOL];
  const important = await connection.getMultipleAccountsInfo(importantAddresses, 'confirmed');
  const accountImages = importantAddresses.map((address, index) => {
    const info = important[index];
    return {
      address: address.toBase58(),
      exists: Boolean(info),
      owner: info?.owner.toBase58() || null,
      lamports: info?.lamports ?? null,
      dataLength: info?.data.length ?? null,
      dataSha256: info ? sha256(info.data) : null,
      token: tokenAccount(info),
      mint: mintAccount(info),
    };
  });

  const signatures = await connection.getSignaturesForAddress(HYLO, {limit: 100}, 'confirmed');
  const sampled = signatures.slice(0, 12);
  const transactions = [];
  for (const signatureRow of sampled) {
    let tx = null;
    try {
      tx = await connection.getTransaction(signatureRow.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 1,
      });
    } catch {
      await new Promise(resolve => setTimeout(resolve, 750));
      continue;
    }
    if (tx) {
      const instructions = [];
      tx.transaction.message.compiledInstructions.forEach((ix, outerIndex) => {
        const image = instructionImage(tx, ix, outerIndex, null, byDiscriminator);
        if (image) instructions.push(image);
      });
      for (const group of tx.meta?.innerInstructions || []) {
        group.instructions.forEach((ix, innerIndex) => {
          const image = instructionImage(tx, ix, group.index, innerIndex, byDiscriminator);
          if (image) instructions.push(image);
        });
      }
      if (instructions.length) {
        transactions.push({
          signature: signatureRow.signature,
          slot: tx.slot,
          blockTime: tx.blockTime,
          err: tx.meta?.err || null,
          version: tx.version,
          fee: tx.meta?.fee ?? null,
          instructions,
        });
      }
    }
    if (transactions.filter(row => row.err === null).length >= 6) break;
    await new Promise(resolve => setTimeout(resolve, 350));
  }

  const executableSha256 = sha256(parsedProgramData.executable);
  const priorBinary = fs.existsSync(PRIOR_BINARY) ? fs.readFileSync(PRIOR_BINARY) : null;
  const vault = accountImages.find(row => row.address === JITOSOL_VAULT.toBase58());
  const feeVault = accountImages.find(row => row.address === JITOSOL_FEE_VAULT.toBase58());
  const report = {
    generatedAt: new Date().toISOString(),
    noTransactionsSubmitted: true,
    rpcEndpointRedacted: true,
    genesisHash,
    observationSlot,
    deployment: {
      programId: HYLO.toBase58(),
      programContextSlot: programResponse.context.slot,
      programDataContextSlot: programDataResponse.context.slot,
      programDataAddress: programDataAddress.toBase58(),
      deploySlot: parsedProgramData.deploySlot,
      upgradeAuthority: parsedProgramData.upgradeAuthority,
      executableLength: parsedProgramData.executable.length,
      executableSha256,
      fullProgramDataSha256: sha256(programDataResponse.value.data),
      priorOct15ExecutableSha256: priorBinary ? sha256(priorBinary) : null,
      byteIdenticalToOct15: priorBinary ? priorBinary.equals(parsedProgramData.executable) : null,
      binaryPath: BINARY,
    },
    custody: {
      mint: JITOSOL.toBase58(),
      vault: JITOSOL_VAULT.toBase58(),
      vaultAuthority: VAULT_AUTH.toBase58(),
      amountRaw: vault?.token?.amountRaw || null,
      amountJitoSol: vault?.token?.amountRaw ? Number(vault.token.amountRaw) / 1e9 : null,
      feeVault: JITOSOL_FEE_VAULT.toBase58(),
      feeAuthority: FEE_AUTH.toBase58(),
      feeAmountRaw: feeVault?.token?.amountRaw || null,
    },
    importantAccounts: accountImages,
    idlUsedOnlyForPostIdentityInstructionLabels: {
      path: IDL_PATH,
      sha256: sha256(idlBytes),
      metadata: idl.metadata,
      instructionCount: idl.instructions.length,
    },
    recentProgramActivity: {
      signatureWindow: signatures.length,
      newestSignatureSlot: signatures[0]?.slot || null,
      newestSignatureBlockTime: signatures[0]?.blockTime || null,
      sampledTransactions: sampled.length,
      decodedHyloTransactions: transactions,
      successfulDecodedCount: transactions.filter(row => row.err === null).length,
    },
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUTPUT,
    observationSlot,
    deploySlot: report.deployment.deploySlot,
    executableSha256,
    byteIdenticalToOct15: report.deployment.byteIdenticalToOct15,
    custodyJitoSol: report.custody.amountJitoSol,
    feeVaultRaw: report.custody.feeAmountRaw,
    recentSuccessfulDecoded: report.recentProgramActivity.successfulDecodedCount,
    latestDecoded: transactions.slice(0, 8).map(row => ({
      signature: row.signature,
      slot: row.slot,
      blockTime: row.blockTime,
      err: row.err,
      instructions: row.instructions.map(ix => ix.name),
    })),
    rpcEndpointRedacted: true,
  }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
