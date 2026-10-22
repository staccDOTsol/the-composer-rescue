#!/usr/bin/env node
// Read-only Hylo mainnet deployment/build-attestation probe. Never signs or submits.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const {
  Connection,
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const ROOT = __dirname;
const ENV_PATH = process.env.HYLO_RPC_ENV || '/tmp/composer-helius-rpc.env';
const OUTPUT_PATH = process.env.HYLO_ATTESTATION_OUTPUT
  || `${ROOT}/hylo-exchange-deployment-attestation.json`;
const BINARY_PATH = process.env.HYLO_BINARY_PATH || `${ROOT}/hylo-exchange-current.so`;
const SDK_PATH = `${ROOT}/hylo-exchange-sdk-source`;
const IDL_PATH = `${SDK_PATH}/hylo-idl/idls/hylo_exchange.json`;
const PROGRAM_ID = new PublicKey('HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn');
const UPGRADEABLE_LOADER_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const AUDITED_BUILD_SHA256 = '7d4e5ff843530aeeefb44e3356edec81999ee0f71bf0516b6c9ab16cb577d0fa';
const AUDITED_COMMIT = '0c3c6d34c5c50d94425f150f86913e2be7431cb7';
const VERIFIED_BUILD_BASE = ['https:', '', 'verify.osec.io'].join('/');

function readEnv(path) {
  const out = {};
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!raw || raw.trimStart().startsWith('#')) continue;
    const i = raw.indexOf('=');
    if (i > 0) out[raw.slice(0, i).trim().replace(/^export\s+/, '')]
      = raw.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function readGitHead(repoPath) {
  const head = fs.readFileSync(`${repoPath}/.git/HEAD`, 'utf8').trim();
  if (!head.startsWith('ref: ')) return head;
  const ref = head.slice(5);
  const loose = `${repoPath}/.git/${ref}`;
  if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
  const packed = fs.readFileSync(`${repoPath}/.git/packed-refs`, 'utf8')
    .split(/\r?\n/)
    .find(line => line.endsWith(` ${ref}`));
  if (!packed) throw new Error(`Cannot resolve ${ref}`);
  return packed.split(' ')[0];
}

async function getJson(path) {
  const response = await fetch(`${VERIFIED_BUILD_BASE}${path}`, {
    headers: {'accept': 'application/json'},
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = {raw: text.slice(0, 512)};
  }
  return {httpStatus: response.status, body};
}

function parseProgramData(data) {
  if (data.length < 45 || data.readUInt32LE(0) !== 3) {
    throw new Error('Unexpected ProgramData account layout');
  }
  const deploySlot = data.readBigUInt64LE(4);
  const authorityOption = data[12];
  const upgradeAuthority = authorityOption === 1
    ? new PublicKey(data.subarray(13, 45)).toBase58()
    : null;
  const executable = data.subarray(45);
  return {
    deploySlot: deploySlot.toString(),
    upgradeAuthority,
    executable,
  };
}

async function main() {
  const env = readEnv(ENV_PATH);
  const rpcUrl = env.RPC || env.SOLANA_RPC || env.SOLANA_RPC_URL || env.RPC_URL
    || env.HEAVY_RPC_URL || env.FLUX_RPC_A || env.FLUX_RPC_B;
  if (!rpcUrl) throw new Error('Configured RPC endpoint is required');
  const connection = new Connection(rpcUrl, {commitment: 'confirmed'});

  const programResponse = await connection.getAccountInfoAndContext(PROGRAM_ID, 'confirmed');
  const programAccount = programResponse.value;
  if (!programAccount) throw new Error('Program account missing');
  if (!programAccount.owner.equals(UPGRADEABLE_LOADER_ID)) throw new Error('Unexpected loader owner');
  if (programAccount.data.length < 36 || programAccount.data.readUInt32LE(0) !== 2) {
    throw new Error('Unexpected Program account layout');
  }
  const programDataAddress = new PublicKey(programAccount.data.subarray(4, 36));
  const programDataResponse = await connection.getAccountInfoAndContext(programDataAddress, 'confirmed');
  const programDataAccount = programDataResponse.value;
  if (!programDataAccount) throw new Error('ProgramData account missing');
  const parsed = parseProgramData(programDataAccount.data);

  const dumpBytes = fs.readFileSync(BINARY_PATH);
  const dumpSha256 = sha256(dumpBytes);
  const onchainExecutableSha256 = sha256(parsed.executable);
  const currentShaMatchesDump = dumpSha256 === onchainExecutableSha256;

  const idlBytes = fs.readFileSync(IDL_PATH);
  const idl = JSON.parse(idlBytes.toString('utf8'));
  const sdkCargo = fs.readFileSync(`${SDK_PATH}/Cargo.toml`, 'utf8');
  const sdkVersionMatch = sdkCargo.match(/^version\s*=\s*"([^"]+)"/m);

  const [status, statusAll, hashResolution] = await Promise.all([
    getJson(`/status/${PROGRAM_ID.toBase58()}`),
    getJson(`/status-all/${PROGRAM_ID.toBase58()}`),
    getJson(`/resolve-hash/${onchainExecutableSha256}`),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    noTransactionsSubmitted: true,
    rpcEndpointRedacted: true,
    program: {
      address: PROGRAM_ID.toBase58(),
      observationSlots: {
        program: programResponse.context.slot,
        programData: programDataResponse.context.slot,
      },
      loader: programAccount.owner.toBase58(),
      programDataAddress: programDataAddress.toBase58(),
      lastDeploySlot: parsed.deploySlot,
      upgradeAuthority: parsed.upgradeAuthority,
      executableLength: parsed.executable.length,
      executableSha256: onchainExecutableSha256,
      fullProgramDataLength: programDataAccount.data.length,
      fullProgramDataSha256: sha256(programDataAccount.data),
    },
    localMainnetDump: {
      path: BINARY_PATH,
      length: dumpBytes.length,
      sha256: dumpSha256,
      matchesFetchedOnchainExecutable: currentShaMatchesDump,
    },
    publicSdk: {
      path: SDK_PATH,
      gitCommit: readGitHead(SDK_PATH),
      workspaceVersion: sdkVersionMatch ? sdkVersionMatch[1] : null,
      idlMetadataVersion: idl.metadata?.version || null,
      idlProgramAddress: idl.address || null,
      instructionCount: idl.instructions?.length || 0,
      idlSha256: sha256(idlBytes),
      containsClientIdlAndMathNotFullOnchainProcessor: true,
    },
    december2025Audit: {
      auditedCommit: AUDITED_COMMIT,
      attestedBuildSha256: AUDITED_BUILD_SHA256,
      currentExecutableMatchesAttestedBuild: onchainExecutableSha256 === AUDITED_BUILD_SHA256,
    },
    verifiedBuildRegistry: {
      status,
      statusAll,
      currentHashResolution: hashResolution,
    },
    conclusion: currentShaMatchesDump && onchainExecutableSha256 !== AUDITED_BUILD_SHA256
      ? 'Current mainnet bytes were reproduced by the local dump, but no source-to-current-binary match is established; the current hash differs from the December 2025 audit attestation.'
      : 'Deployment attestation requires manual review.',
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUTPUT_PATH,
    programDataAddress: report.program.programDataAddress,
    lastDeploySlot: report.program.lastDeploySlot,
    executableLength: report.program.executableLength,
    executableSha256: report.program.executableSha256,
    dumpMatches: report.localMainnetDump.matchesFetchedOnchainExecutable,
    auditBuildMatches: report.december2025Audit.currentExecutableMatchesAttestedBuild,
    rpcEndpointRedacted: true,
  }, null, 2)}\n`);
}

main().catch(error => {
  const rpcUrl = (() => {
    try {
      const env = readEnv(ENV_PATH);
      return env.RPC || env.SOLANA_RPC || env.SOLANA_RPC_URL || env.RPC_URL
        || env.HEAVY_RPC_URL || env.FLUX_RPC_A || env.FLUX_RPC_B || '';
    } catch { return ''; }
  })();
  const redacted = String(error.stack || error.message || error)
    .replaceAll(rpcUrl, rpcUrl ? '<redacted-rpc>' : '');
  console.error(redacted);
  process.exitCode = 1;
});
