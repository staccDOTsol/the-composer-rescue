#!/usr/bin/env node
// Reproducible binding from the current on-chain dump to the official verified release/source.
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PROGRAM = '97V7JsExNC6yFWu5KjK1FLfVkNVvtMpAFL5QkLWKEGxY';
const sha256 = (path) => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');

(async () => {
  const response = await fetch(`https://verify.osec.io/status/${PROGRAM}`);
  if (!response.ok) throw new Error(`verification service returned HTTP ${response.status}`);
  const verification = await response.json();
  const deployedSource = `${__dirname}/hastra-deployed-source`;
  const output = {
    generatedAt: new Date().toISOString(),
    programId: PROGRAM,
    verificationService: 'https://verify.osec.io (public status API; no credentials)',
    verification,
    localSource: {
      repository: execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: deployedSource, encoding: 'utf8' }).trim(),
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: deployedSource, encoding: 'utf8' }).trim(),
      exactTags: execFileSync('git', ['tag', '--points-at', 'HEAD'], { cwd: deployedSource, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean),
    },
    rawArtifactComparison: {
      onChainDump: { path: 'hastra-current.so', bytes: fs.statSync(`${__dirname}/hastra-current.so`).size,
        sha256: sha256(`${__dirname}/hastra-current.so`) },
      officialRelease: { path: 'hastra-release-v0.0.6/programs/vault_stake_prime.so',
        bytes: fs.statSync(`${__dirname}/hastra-release-v0.0.6/programs/vault_stake_prime.so`).size,
        sha256: sha256(`${__dirname}/hastra-release-v0.0.6/programs/vault_stake_prime.so`) },
      byteForByteEqual: fs.readFileSync(`${__dirname}/hastra-current.so`)
        .equals(fs.readFileSync(`${__dirname}/hastra-release-v0.0.6/programs/vault_stake_prime.so`)),
      releaseIdlSha256: sha256(`${__dirname}/hastra-release-v0.0.6/idl/vault_stake.json`),
    },
  };
  fs.writeFileSync(`${__dirname}/hastra-build-verification.json`, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
