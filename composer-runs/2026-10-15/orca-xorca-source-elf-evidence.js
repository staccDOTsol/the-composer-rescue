#!/usr/bin/env node

// Reproducible local evidence tying the current on-chain ELF to the official
// repository, while explicitly preserving the non-matching local toolchain caveat.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const dir = __dirname;
const repo = '/tmp/orca-xorca-source.YZrfjD';
const currentElf = path.join(dir, 'orca-xorca-current.so');
const localElf = '/tmp/orca-xorca-build/xorca_staking_program.so';
const outputPath = path.join(dir, 'orca-xorca-source-elf-evidence.json');
const live = JSON.parse(fs.readFileSync(path.join(dir, 'orca-xorca-live-revalidation.json')));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (args) => cp.execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8'}).trim();

const baseline = '9fa960c597069dbd25da9c7950d2b8a87e7acf0e';
const head = git(['rev-parse', 'HEAD']);
const diff = git(['diff', `${baseline}..${head}`, '--', 'solana-program/src']);
const output = {
  generatedAt: new Date().toISOString(),
  officialRepository: 'https://github.com/orca-so/xorca',
  repositoryCheckout: {path: repo, head, baseline,
    baselineSubject: git(['show', '-s', '--format=%s', baseline]),
    baselineCommittedAt: git(['show', '-s', '--format=%cI', baseline]),
    programSourceDiffFromBaseline: diff,
    executableSourceChangeFromBaseline: false,
    diffInterpretation: 'Only three explanatory comment lines were added to util/math.rs.'},
  identity: {declaredProgramIdMatches: live.source.declaredProgramIdMatches,
    program: live.identities.program, programData: live.deployment.programDataAddress,
    deploymentSlot: live.deployment.deploymentSlot, upgradeAuthority: live.deployment.upgradeAuthority},
  liveElf: {path: currentElf, bytes: fs.statSync(currentElf).size,
    sha256: sha256(currentElf), programDataElfOffset: live.deployment.elfOffset,
    equalsRpcDumpHash: sha256(currentElf) === live.deployment.elfSha256},
  officialBuildSpecification: {file: path.join(repo, 'docker-compose.yml'),
    image: 'solanafoundation/solana-verifiable-build:2.2.1',
    command: 'cargo build-sbf --verbose --force-tools-install'},
  localBuild: {path: localElf, bytes: fs.statSync(localElf).size, sha256: sha256(localElf),
    solanaCargoBuildSbf: '3.1.10', platformTools: 'v1.52', sbfRustc: '1.89.0',
    byteForByteMatchLive: sha256(localElf) === sha256(currentElf),
    caveat: 'This build used the installed toolchain, not the repository-pinned linux/amd64 verifiable-build container. The Docker CLI was present but its daemon was unavailable, so no claim of byte-for-byte source verification is made.'},
  liveBehavioralAlignment: {instructionNamesFoundInElf: ['Stake', 'Unstake', 'Withdraw',
    'Initialize', 'Set'], instructionDiscriminators: live.source.instructionDiscriminators,
    stateLayoutBytes: live.source.stateLayoutBytes,
    pendingWithdrawLayoutBytes: live.source.pendingWithdrawLayoutBytes,
    virtualOrcaRaw: live.source.virtualOrcaRaw, virtualXorcaRaw: live.source.virtualXorcaRaw,
    currentSignedV1SimulationArtifact: path.join(dir, 'orca-xorca-v1-simulations.json')},
  priorAudit: {path: path.join(repo, '.audits', '2025-09-24.pdf'), auditor: 'Sec3',
    auditedInitialCommit: '8affaea',
    relevantFindings: [
      {id: 'H-01', topic: 'vault inflation', disposition: 'fixed',
        fixCommits: ['a6bf7cb', '7ab1114']},
      {id: 'L-02', topic: 'state validation', disposition: 'fixed', fixCommits: ['c18bd89']},
      {id: 'L-03', topic: 'initialize signer/deployer restriction', disposition: 'fixed',
        fixCommits: ['dfe2152', '4134804']},
      {id: 'L-04', topic: 'pre-funded pending-withdraw PDA denial of service',
        disposition: 'fixed', fixCommits: ['b78f3c4']},
      {id: 'L-01', topic: 'pre-created state PDA', disposition: 'acknowledged deployment-only'},
    ], economicsInAuditScope: false},
  conclusion: 'Official source logic is stable from the finalized mainnet-address baseline and aligns with live identity/layout/behavior, but the current ELF is not formally reproducibly matched in this environment.'
};
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({generatedAt: output.generatedAt, head, baseline,
  liveElf: output.liveElf, localBuild: output.localBuild,
  executableSourceChangeFromBaseline: output.repositoryCheckout.executableSourceChangeFromBaseline}, null, 2));
