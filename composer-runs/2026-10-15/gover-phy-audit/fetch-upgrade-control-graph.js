#!/usr/bin/env node
'use strict';

// Read-only graph for the governance instance that owns the native-treasury PDA
// used as the current upgrade authority of both GovER... and GoVERLM....

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const {PublicKey} = require(path.join(HERE, '../onre-harness/node_modules/@solana/web3.js'));
const CONTROLLER = new PublicKey('GoVERLMGbGF8kwAwhyNgF1BQ2uyQPawHCWbnFRmLZCf');
const GOVERNANCE = new PublicKey('6rFUnQik5dhUsxJaxN2dKGJRD3cX8kQM3cyLD1kbaoCF');
const EXPECTED_TREASURY = new PublicKey('HF7gCq7BMB6cFfhharTGGm31sqDdpmvLTgF4WEoW8y9n');
const PROPOSAL_TYPES = new Set([5, 14]);
const TOKEN_OWNER_RECORD_V2 = 17;
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
if (!env.RPC_URL) throw new Error('RPC_URL missing from private environment file');

let id = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(env.RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
      const body = await response.json();
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 6) await sleep(500 * (2 ** attempt));
    }
  }
  throw last;
}
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const pk = (bytes) => new PublicKey(bytes).toBase58();
function normalized(account) {
  if (!account) return null;
  const bytes = Buffer.from(account.data[0], 'base64');
  return {...account, dataSha256: sha256(bytes)};
}
async function accounts(keys, minimumContextSlot) {
  const result = await rpc('getMultipleAccounts', [keys.map(String), {
    commitment: 'finalized', encoding: 'base64', minContextSlot: minimumContextSlot,
  }]);
  return {slot: result.context.slot, accounts: Object.fromEntries(keys.map((key, index) => [String(key), normalized(result.value[index])]))};
}
async function records(field, minimumContextSlot) {
  const result = await rpc('getProgramAccounts', [String(CONTROLLER), {
    commitment: 'finalized', encoding: 'base64', withContext: true,
    minContextSlot: minimumContextSlot,
    filters: [{memcmp: {offset: 1, bytes: String(field)}}],
  }]);
  return {slot: result.context.slot, records: result.value.map(({pubkey, account}) => ({pubkey, account: normalized(account)}))};
}
function governanceFields(base64) {
  const bytes = Buffer.from(base64, 'base64');
  return {accountType: bytes[0], realm: new PublicKey(bytes.subarray(1, 33)), governedAccount: new PublicKey(bytes.subarray(33, 65))};
}
function realmFields(base64) {
  const bytes = Buffer.from(base64, 'base64');
  let offset = 1;
  const communityMint = new PublicKey(bytes.subarray(offset, offset += 32));
  offset += 8;
  const minCommunityWeightToCreateGovernance = bytes.readBigUInt64LE(offset); offset += 8;
  const maxKind = bytes[offset++];
  const maxValue = bytes.readBigUInt64LE(offset); offset += 8;
  const councilTag = bytes[offset++];
  const councilMint = councilTag === 1 ? new PublicKey(bytes.subarray(offset, offset + 32)) : null;
  return {accountType: bytes[0], communityMint, councilMint, minCommunityWeightToCreateGovernance, maxKind, maxValue};
}
function parseProgram(address, row) {
  const bytes = Buffer.from(row.data[0], 'base64');
  if (row.owner !== LOADER || bytes.readUInt32LE(0) !== 2) throw new Error('controller is not an upgradeable program');
  return {address, owner: row.owner, executable: row.executable, programdataAddress: pk(bytes.subarray(4, 36)), dataSha256: sha256(bytes)};
}
function parseProgramData(address, row) {
  const bytes = Buffer.from(row.data[0], 'base64');
  if (row.owner !== LOADER || bytes.readUInt32LE(0) !== 3) throw new Error('invalid controller ProgramData');
  const hasAuthority = bytes[12] === 1;
  const elfOffset = hasAuthority ? 45 : 13;
  return {address, owner: row.owner, lastDeploymentSlot: Number(bytes.readBigUInt64LE(4)),
    upgradeAuthority: hasAuthority ? pk(bytes.subarray(13, 45)) : null,
    elfLength: bytes.length - elfOffset, elfSha256: sha256(bytes.subarray(elfOffset)), fullDataSha256: sha256(bytes)};
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(path.join(HERE, 'current-snapshot.json'), 'utf8'));
  const minimumContextSlot = snapshot.observedSlot;
  const initial = await accounts([CONTROLLER, GOVERNANCE], minimumContextSlot);
  const program = parseProgram(String(CONTROLLER), initial.accounts[String(CONTROLLER)]);
  const programdataKey = new PublicKey(program.programdataAddress);
  const programdataFetch = await accounts([programdataKey], minimumContextSlot);
  const programdata = parseProgramData(String(programdataKey), programdataFetch.accounts[String(programdataKey)]);
  const governanceAccount = initial.accounts[String(GOVERNANCE)];
  if (governanceAccount.owner !== String(CONTROLLER)) throw new Error('controller governance owner mismatch');
  const gf = governanceFields(governanceAccount.data[0]);
  const [derivedGovernance, governanceBump] = PublicKey.findProgramAddressSync([
    Buffer.from('account-governance'), gf.realm.toBuffer(), gf.governedAccount.toBuffer(),
  ], CONTROLLER);
  const [nativeTreasury, nativeTreasuryBump] = PublicKey.findProgramAddressSync([
    Buffer.from('native-treasury'), GOVERNANCE.toBuffer(),
  ], CONTROLLER);
  if (!derivedGovernance.equals(GOVERNANCE) || !nativeTreasury.equals(EXPECTED_TREASURY)) throw new Error('controller PDA mismatch');
  if (programdata.upgradeAuthority !== String(EXPECTED_TREASURY)) throw new Error('controller is not self-governed by expected native treasury');

  const governanceFetch = {slot: initial.slot, accounts: {[String(GOVERNANCE)]: governanceAccount}};
  const realmFetch = await accounts([gf.realm], minimumContextSlot);
  const realmAccount = realmFetch.accounts[String(gf.realm)];
  const rf = realmFields(realmAccount.data[0]);
  const [realmConfig] = PublicKey.findProgramAddressSync([Buffer.from('realm-config'), gf.realm.toBuffer()], CONTROLLER);
  const [communityHolding] = PublicKey.findProgramAddressSync([Buffer.from('governance'), gf.realm.toBuffer(), rf.communityMint.toBuffer()], CONTROLLER);
  const councilHolding = rf.councilMint ? PublicKey.findProgramAddressSync([Buffer.from('governance'), gf.realm.toBuffer(), rf.councilMint.toBuffer()], CONTROLLER)[0] : null;
  const relatedKeys = [realmConfig, rf.communityMint, communityHolding, ...(rf.councilMint ? [rf.councilMint] : []), ...(councilHolding ? [councilHolding] : [])];
  const relatedFetch = await accounts(relatedKeys, minimumContextSlot);

  const proposalSearch = await records(GOVERNANCE, minimumContextSlot);
  const proposals = proposalSearch.records.filter(({account}) => PROPOSAL_TYPES.has(Buffer.from(account.data[0], 'base64')[0]))
    .map((record) => ({governance: String(GOVERNANCE), searchSlot: proposalSearch.slot, ...record}));
  const proposalChildren = [];
  for (const proposal of proposals) proposalChildren.push({proposal: proposal.pubkey, ...(await records(new PublicKey(proposal.pubkey), minimumContextSlot))});
  const realmSearch = await records(gf.realm, minimumContextSlot);
  const tokenOwnerRecords = realmSearch.records.filter(({account}) => Buffer.from(account.data[0], 'base64')[0] === TOKEN_OWNER_RECORD_V2)
    .map((record) => ({realm: String(gf.realm), searchSlot: realmSearch.slot, ...record}));

  const output = {
    generatedAt: new Date().toISOString(), commitment: 'finalized', minimumContextSlot,
    noTransactionsSubmitted: true,
    controller: {program, programdata, governance: String(GOVERNANCE), governanceBump,
      governedAccount: String(gf.governedAccount), realm: String(gf.realm),
      nativeTreasury: String(nativeTreasury), nativeTreasuryBump,
      controlsTargetProgram: snapshot.program.address, targetProgramdata: snapshot.programdata.address,
      targetUpgradeAuthority: snapshot.programdata.upgradeAuthority},
    governances: [{address: String(GOVERNANCE), accountType: gf.accountType, realm: String(gf.realm), governanceSeed: String(gf.governedAccount),
      pdaBump: governanceBump, derivedAddress: String(derivedGovernance), exactPdaMatch: true}],
    governanceFetch,
    realmFetch,
    realms: [{address: String(gf.realm), accountType: rf.accountType, communityMint: String(rf.communityMint), councilMint: rf.councilMint ? String(rf.councilMint) : null,
      realmConfig: String(realmConfig), communityHolding: String(communityHolding), councilHolding: councilHolding ? String(councilHolding) : null,
      minCommunityWeightToCreateGovernance: rf.minCommunityWeightToCreateGovernance.toString(),
      communityMintMaxVoterWeightSource: {kind: rf.maxKind, value: rf.maxValue.toString()}}],
    relatedFetch,
    tokenOwnerRecords,
    proposalSearches: [{governance: String(GOVERNANCE), ...proposalSearch}],
    proposals,
    proposalChildren,
    tokenAccountsByGovernance: [],
  };
  const outputPath = path.join(HERE, 'upgrade-control-graph-raw.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({outputPath, controller: output.controller, proposalCount: proposals.length,
    proposalChildCounts: proposalChildren.map(({proposal, records}) => ({proposal, count: records.length})), tokenOwnerRecordCount: tokenOwnerRecords.length}, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
