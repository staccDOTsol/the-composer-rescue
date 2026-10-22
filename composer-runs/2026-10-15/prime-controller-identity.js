#!/usr/bin/env node
'use strict';

// Reproducibly binds the dumped mainnet program bytes to the official v1.6.2
// Chainlink release artifact and exact source commit. This script is offline.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const RUN = __dirname;
const currentPath = path.join(RUN, 'prime-controller-current.so');
const releasePath = path.join(
  RUN, 'prime-controller-release-artifacts/target/deploy/lockrelease_token_pool.so');
const archivePath = path.join(RUN, 'prime-controller-release-artifacts.tar.gz');
const sourcePath = path.join(RUN, 'prime-controller-source');
const metadataPath = path.join(RUN, 'prime-controller-program-metadata.json');
const runtimePath = path.join(RUN, 'prime-controller-runtime-probe.json');
const outputPath = path.join(RUN, 'prime-controller-identity.json');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', ['-C', sourcePath, ...args], {encoding: 'utf8'}).trim();

const current = fs.readFileSync(currentPath);
const release = fs.readFileSync(releasePath);
const archive = fs.readFileSync(archivePath);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')).entries[0];
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
const tail = current.subarray(release.length);
const nonzeroEnd = (() => {
  for (let i = current.length - 1; i >= 0; i -= 1) if (current[i] !== 0) return i + 1;
  return 0;
})();
const tags = git('tag', '--points-at', 'HEAD').split(/\r?\n/).filter(Boolean).sort();

const output = {
  generatedAt: new Date().toISOString(),
  programId: runtime.programId,
  mainnet: {
    observationSlot: metadata.observationSlot,
    programDataAddress: metadata.programDataAddress,
    upgradeAuthority: metadata.upgradeAuthority,
    lastDeployedSlot: metadata.lastDeployedSlot,
    allocatedPayloadBytes: current.length,
    allocatedPayloadSha256: hash(current),
    nonzeroEndOffset: nonzeroEnd,
    metadataConsistency: {
      allocatedBytesMatch: metadata.payloadBytes === current.length,
      allocatedSha256Match: metadata.payloadSha256 === hash(current),
      nonzeroBytesMatch: metadata.nonzeroPayloadBytes === nonzeroEnd,
      nonzeroSha256Match: metadata.nonzeroPayloadSha256 === hash(current.subarray(0, nonzeroEnd)),
    },
    idl: runtime.idl,
    typeVersion: runtime.typeVersion,
  },
  officialRelease: {
    repository: 'github:smartcontractkit/chainlink-ccip',
    releaseTag: 'solana-v1.6.2',
    sourceCommit: git('rev-parse', 'HEAD'),
    tagsAtCommit: tags,
    archiveBytes: archive.length,
    archiveSha256: hash(archive),
    lockreleaseElfBytes: release.length,
    lockreleaseElfSha256: hash(release),
  },
  comparison: {
    releaseElfIsExactMainnetPrefix: current.subarray(0, release.length).equals(release),
    allocatedTailBytes: tail.length,
    allocatedTailAllZero: tail.every((byte) => byte === 0),
    exactArtifactPlusZeroPadding: current.subarray(0, release.length).equals(release) &&
      tail.every((byte) => byte === 0),
    currentNonzeroEndEqualsReleaseNonzeroEnd: nonzeroEnd === (() => {
      for (let i = release.length - 1; i >= 0; i -= 1) if (release[i] !== 0) return i + 1;
      return 0;
    })(),
  },
  sourcePathsReviewed: [
    'chains/solana/contracts/programs/lockrelease-token-pool/src/lib.rs',
    'chains/solana/contracts/programs/lockrelease-token-pool/src/context.rs',
    'chains/solana/contracts/programs/base-token-pool/src/common.rs',
    'chains/solana/contracts/programs/base-token-pool/src/rate_limiter.rs',
  ],
};

if (runtime.idl.metadata.version !== '1.6.2' || runtime.typeVersion.err !== null ||
    runtime.typeVersion.returnData.value !== 'lockrelease-token-pool 1.6.2' ||
    !output.comparison.exactArtifactPlusZeroPadding ||
    output.officialRelease.sourceCommit !== '9546a59bd0a3cee4ddc8ae4042da533e62225b78' ||
    !tags.includes('solana-v1.6.2')) {
  throw new Error('Program identity assertion failed');
}

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({outputPath, programId: output.programId,
  version: runtime.idl.metadata.version, sourceCommit: output.officialRelease.sourceCommit,
  exactArtifactPlusZeroPadding: output.comparison.exactArtifactPlusZeroPadding}, null, 2));
