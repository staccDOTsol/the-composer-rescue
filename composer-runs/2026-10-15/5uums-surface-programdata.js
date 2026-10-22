#!/usr/bin/env node
'use strict';
// Read-only census of upgradeable ProgramData authorized by the 3LWzk multisig PDA.
const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const AUTH = '5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi';
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const ENV_PATH = '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries(fs.readFileSync(ENV_PATH, 'utf8').split(/\n/).filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
if (!env.RPC_URL) throw Error('RPC_URL missing');
let reqId = 0;
async function rpc(method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(env.RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++reqId, method, params }) });
    let body; try { body = await resp.json(); } catch { throw Error(`${method}: HTTP ${resp.status}, invalid JSON`); }
    if (resp.ok && !body.error) return body.result;
    const message = body.error?.message || `HTTP ${resp.status}`;
    if (attempt === 3 || !/429|rate limit|too many requests|502|503|504/i.test(`${resp.status} ${message}`)) throw Error(`${method}: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}
function parseProgramData(address, account, slot) {
  const bytes = Buffer.from(account.data[0], 'base64');
  if (account.owner !== LOADER || bytes.readUInt32LE(0) !== 3 || bytes.length < 45 || bytes[12] !== 1 || new PublicKey(bytes.subarray(13, 45)).toBase58() !== AUTH) return null;
  return {
    programDataAddress: address,
    accountOwner: account.owner,
    accountSpace: account.space,
    returnedDataLength: bytes.length,
    rentLamports: account.lamports,
    lastDeploymentSlot: Number(bytes.readBigUInt64LE(4)),
    upgradeAuthority: AUTH,
    observedSlot: slot,
  };
}
async function main() {
  const startedAt = new Date().toISOString();
  const firstSlot = await rpc('getSlot', [{ commitment: 'finalized' }]);
  const census = await rpc('getProgramAccounts', [LOADER, {
    encoding: 'base64',
    commitment: 'finalized',
    withContext: true,
    dataSlice: { offset: 0, length: 45 },
    filters: [{ memcmp: { offset: 13, bytes: AUTH } }],
  }]);
  const censusSlot = census.context?.slot ?? null;
  const vals = census.value || census;
  const pd = vals.map(({ pubkey, account }) => parseProgramData(pubkey, account, censusSlot));
  if (pd.some(x => !x)) throw Error('GPA filter returned account that failed ProgramData/authority validation');
  const pdAddresses = pd.map(x => x.programDataAddress);
  const uniquePd = new Set(pdAddresses);
  if (uniquePd.size !== pdAddresses.length) throw Error('duplicate ProgramData in GPA');
  const programs = await Promise.all(pd.map(async item => {
    const result = await rpc('getProgramAccounts', [LOADER, {
      encoding: 'base64', commitment: 'finalized', withContext: true,
      dataSlice: { offset: 0, length: 36 },
      filters: [
        { dataSize: 36 },
        { memcmp: { offset: 4, bytes: item.programDataAddress } },
      ],
    }]);
    const matches = (result.value || result).map(({ pubkey, account }) => {
      const data = Buffer.from(account.data[0], 'base64');
      if (account.owner !== LOADER || data.length !== 36 || data.readUInt32LE(0) !== 2 || new PublicKey(data.subarray(4, 36)).toBase58() !== item.programDataAddress) throw Error(`invalid Program account ${pubkey}`);
      return { programAddress: pubkey, executable: account.executable, owner: account.owner, accountSpace: account.space, rentLamports: account.lamports, observedSlot: result.context?.slot ?? null };
    });
    return { ...item, linkedPrograms: matches };
  }));
  const lastSlot = await rpc('getSlot', [{ commitment: 'finalized' }]);
  const out = {
    method: 'getProgramAccounts(BPFLoaderUpgradeab1e11111111111111111111111) filtered by upgradeAuthority bytes at ProgramData offset 13; separately reverse-linked Program account tag=2 by each ProgramData pubkey at offset 4',
    commitment: 'finalized', firstSlot, censusSlot, lastSlot, startedAt, finishedAt: new Date().toISOString(),
    authority: AUTH,
    programDataCount: programs.length,
    linkedProgramCount: programs.reduce((n, p) => n + p.linkedPrograms.length, 0),
    executableLinkedProgramCount: programs.reduce((n, p) => n + p.linkedPrograms.filter(q => q.executable).length, 0),
    orphanProgramDataCount: programs.filter(p => p.linkedPrograms.length === 0).length,
    programs,
  };
  fs.writeFileSync(path.join(DIR, '5uums-surface-programdata.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
