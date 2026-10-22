#!/usr/bin/env node
'use strict';

// Read-only expansion of the two selected governance accounts into their live
// realms, realm-config accounts, governing mints/holdings, proposals, and
// proposal-owned child records. All raw account data is retained for an
// independent Borsh decoder.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const { PublicKey } = require(path.join(HERE, '../onre-harness/node_modules/@solana/web3.js'));
const RPC_ENV = '/tmp/composer-helius-rpc.env';
const PROGRAM = new PublicKey('GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const PROPOSAL_V2 = 14;
const PROPOSAL_V1 = 5;
const TOKEN_OWNER_RECORD_V2 = 17;
const SELECTED_AUTHORITIES = [
  new PublicKey('6Va7K51FRbnPcYZTUwkoFfoYtnfh8qyJaZqT4W1GGxVi'),
  new PublicKey('2jfAMh48b37bBTKkoNwmvNZAqVQc1G7gh5vYv5FoWTUR'),
];

const env = Object.fromEntries(fs.readFileSync(RPC_ENV, 'utf8')
  .split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
if (!env.RPC_URL) throw new Error('RPC_URL missing from private environment file');

let requestId = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params) {
  let lastError;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(env.RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      });
      const body = await response.json();
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await sleep(400 * (2 ** attempt));
    }
  }
  throw lastError;
}

function pk(bytes) {
  return new PublicKey(bytes).toBase58();
}

class Reader {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  u8() { return this.bytes[this.offset++]; }
  u16() { const value = this.bytes.readUInt16LE(this.offset); this.offset += 2; return value; }
  u32() { const value = this.bytes.readUInt32LE(this.offset); this.offset += 4; return value; }
  u64() { const value = this.bytes.readBigUInt64LE(this.offset); this.offset += 8; return value; }
  bytesN(length) { const value = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return value; }
  pubkey() { return new PublicKey(this.bytesN(32)); }
  option(readValue) { const tag = this.u8(); if (tag === 0) return null; if (tag !== 1) throw new Error(`invalid option tag ${tag}`); return readValue(); }
}

function readGovernanceAddressFields(base64) {
  const reader = new Reader(Buffer.from(base64, 'base64'));
  const accountType = reader.u8();
  const realm = reader.pubkey();
  const governanceSeed = reader.pubkey();
  return { accountType, realm, governanceSeed };
}

function readMaxVoterWeightSource(reader) {
  const kind = reader.u8();
  if (kind !== 0 && kind !== 1) throw new Error(`invalid MintMaxVoterWeightSource ${kind}`);
  return { kind, value: reader.u64() };
}

function readRealmAddressFields(base64) {
  const reader = new Reader(Buffer.from(base64, 'base64'));
  const accountType = reader.u8();
  const communityMint = reader.pubkey();
  const legacy1 = reader.u8();
  const legacy2 = reader.u8();
  reader.bytesN(6);
  const minCommunityWeightToCreateGovernance = reader.u64();
  const communityMintMaxVoterWeightSource = readMaxVoterWeightSource(reader);
  const councilMint = reader.option(() => reader.pubkey());
  return {
    accountType,
    communityMint,
    councilMint,
    legacy1,
    legacy2,
    minCommunityWeightToCreateGovernance,
    communityMintMaxVoterWeightSource,
  };
}

function normalizeAccount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {
    ...account,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
}

function uniquePublicKeys(keys) {
  return [...new Map(keys.map((key) => [key.toBase58(), key])).values()];
}

async function multipleAccounts(keys, minContextSlot) {
  const result = await rpc('getMultipleAccounts', [keys.map((key) => key.toBase58()), {
    commitment: 'finalized',
    encoding: 'base64',
    minContextSlot,
  }]);
  if (!result?.context?.slot || result.value.length !== keys.length) throw new Error('invalid getMultipleAccounts response');
  return {
    slot: result.context.slot,
    accounts: Object.fromEntries(keys.map((key, index) => [key.toBase58(), normalizeAccount(result.value[index])])),
  };
}

async function ownedRecordsWithField(fieldAddress, minContextSlot) {
  const result = await rpc('getProgramAccounts', [PROGRAM.toBase58(), {
    commitment: 'finalized',
    encoding: 'base64',
    withContext: true,
    minContextSlot,
    filters: [{ memcmp: { offset: 1, bytes: fieldAddress.toBase58() } }],
  }]);
  const value = result.value || result;
  return {
    slot: result.context?.slot ?? null,
    records: value.map(({ pubkey, account }) => ({ pubkey, account: normalizeAccount(account) })),
  };
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(path.join(HERE, 'current-snapshot.json'), 'utf8'));
  const baseSlot = snapshot.observedSlot;
  const targetAuthorities = SELECTED_AUTHORITIES;
  const governanceFetch = await multipleAccounts(targetAuthorities, baseSlot);
  const authorityData = new Map(targetAuthorities.map((address) => {
    const account = governanceFetch.accounts[address.toBase58()];
    if (!account || account.owner !== PROGRAM.toBase58()) {
      throw new Error(`authority ${address} is not a live ${PROGRAM} account`);
    }
    return [address.toBase58(), account.data[0]];
  }));

  const governances = targetAuthorities.map((address) => {
    const fields = readGovernanceAddressFields(authorityData.get(address.toBase58()));
    const [derivedAddress, bump] = PublicKey.findProgramAddressSync([
      Buffer.from('account-governance'),
      fields.realm.toBuffer(),
      fields.governanceSeed.toBuffer(),
    ], PROGRAM);
    return {
      address: address.toBase58(),
      accountType: fields.accountType,
      realm: fields.realm.toBase58(),
      governanceSeed: fields.governanceSeed.toBase58(),
      pdaBump: bump,
      derivedAddress: derivedAddress.toBase58(),
      exactPdaMatch: derivedAddress.equals(address),
    };
  });
  if (governances.some((item) => !item.exactPdaMatch)) throw new Error('governance PDA mismatch');

  const realmKeys = uniquePublicKeys(governances.map(({ realm }) => new PublicKey(realm)));
  const realmFetch = await multipleAccounts(realmKeys, baseSlot);
  const realms = realmKeys.map((realm) => {
    const account = realmFetch.accounts[realm.toBase58()];
    if (!account || account.owner !== PROGRAM.toBase58()) throw new Error(`invalid realm ${realm}`);
    const fields = readRealmAddressFields(account.data[0]);
    const [realmConfig] = PublicKey.findProgramAddressSync([Buffer.from('realm-config'), realm.toBuffer()], PROGRAM);
    const [communityHolding] = PublicKey.findProgramAddressSync([
      Buffer.from('governance'), realm.toBuffer(), fields.communityMint.toBuffer(),
    ], PROGRAM);
    const councilHolding = fields.councilMint ? PublicKey.findProgramAddressSync([
      Buffer.from('governance'), realm.toBuffer(), fields.councilMint.toBuffer(),
    ], PROGRAM)[0] : null;
    return {
      address: realm.toBase58(),
      accountType: fields.accountType,
      communityMint: fields.communityMint.toBase58(),
      councilMint: fields.councilMint?.toBase58() ?? null,
      realmConfig: realmConfig.toBase58(),
      communityHolding: communityHolding.toBase58(),
      councilHolding: councilHolding?.toBase58() ?? null,
      minCommunityWeightToCreateGovernance: fields.minCommunityWeightToCreateGovernance.toString(),
      communityMintMaxVoterWeightSource: {
        kind: fields.communityMintMaxVoterWeightSource.kind,
        value: fields.communityMintMaxVoterWeightSource.value.toString(),
      },
    };
  });

  const relatedKeys = uniquePublicKeys(realms.flatMap((realm) => [
    new PublicKey(realm.realmConfig),
    new PublicKey(realm.communityMint),
    new PublicKey(realm.communityHolding),
    ...(realm.councilMint ? [new PublicKey(realm.councilMint)] : []),
    ...(realm.councilHolding ? [new PublicKey(realm.councilHolding)] : []),
  ]));
  const relatedFetch = await multipleAccounts(relatedKeys, baseSlot);

  const tokenOwnerRecords = [];
  for (const realm of realmKeys) {
    const search = await ownedRecordsWithField(realm, baseSlot);
    tokenOwnerRecords.push(...search.records
      .filter(({account}) => Buffer.from(account.data[0], 'base64')[0] === TOKEN_OWNER_RECORD_V2)
      .map((record) => ({realm: realm.toBase58(), searchSlot: search.slot, ...record})));
  }

  const proposalSearches = [];
  for (const governance of targetAuthorities) {
    proposalSearches.push({ governance: governance.toBase58(), ...(await ownedRecordsWithField(governance, baseSlot)) });
  }
  const proposals = proposalSearches.flatMap(({ governance, slot, records }) => records
    .filter(({ account }) => {
      const type = Buffer.from(account.data[0], 'base64')[0];
      return type === PROPOSAL_V1 || type === PROPOSAL_V2;
    })
    .map((record) => ({ governance, searchSlot: slot, ...record })));

  const proposalChildren = [];
  for (const proposal of proposals) {
    proposalChildren.push({
      proposal: proposal.pubkey,
      ...(await ownedRecordsWithField(new PublicKey(proposal.pubkey), baseSlot)),
    });
  }

  const tokenAccountsByGovernance = [];
  for (const governance of targetAuthorities) {
    const result = await rpc('getTokenAccountsByOwner', [governance.toBase58(), {
      programId: TOKEN_PROGRAM.toBase58(),
    }, {
      commitment: 'finalized',
      encoding: 'base64',
      minContextSlot: baseSlot,
    }]);
    tokenAccountsByGovernance.push({
      governance: governance.toBase58(),
      slot: result.context?.slot ?? null,
      accounts: result.value.map(({ pubkey, account }) => ({ pubkey, account: normalizeAccount(account) })),
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    commitment: 'finalized',
    minimumContextSlot: baseSlot,
    noTransactionsSubmitted: true,
    governanceFetch,
    governances,
    realmFetch,
    realms,
    relatedFetch,
    tokenOwnerRecords,
    proposalSearches,
    proposals,
    proposalChildren,
    tokenAccountsByGovernance,
  };
  fs.writeFileSync(path.join(HERE, 'governance-graph-raw.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    baseSlot,
    realmSlot: realmFetch.slot,
    relatedSlot: relatedFetch.slot,
    governances,
    realms,
    proposalCounts: Object.fromEntries(governances.map(({ address }) => [
      address,
      proposals.filter((proposal) => proposal.governance === address).length,
    ])),
    tokenOwnerRecordCount: tokenOwnerRecords.length,
    proposalChildCounts: Object.fromEntries(proposalChildren.map(({ proposal, records }) => [proposal, records.length])),
    tokenAccountsByGovernance: tokenAccountsByGovernance.map(({ governance, slot, accounts }) => ({ governance, slot, count: accounts.length })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
