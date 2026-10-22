#!/usr/bin/env node
// Read-only census of token control associated with the 3LWzk and 5UuMS PDAs.
// No transaction construction, signing, or submission.
'use strict';
const fs = require('fs');
const path = require('path');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {getAssociatedTokenAddressSync, getExtensionTypes, ExtensionType} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');

const OUT = path.join(__dirname, '5uums-surface-token-census.json');
const ENV_FILE = '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split(/\n/)
  .filter(line => line.includes('=')).map(line => line.split(/=(.*)/s).slice(0, 2)));
const RPC = process.env.SOLANA_RPC || env.RPC_URL;
const HEAVY_RPC = env.HEAVY_RPC_URL || RPC;
if (!RPC) throw new Error('Missing RPC endpoint');
const AUTHORITIES = {
  wrapperPda: '5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi',
  bridgePda: 'Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK',
  secondBridgePda: '4kNkeveV4WoKYmncSe4KoUW9umwQHSA8prH7acM1uxwB',
};
const TOKEN_PROGRAMS = {
  splToken: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let nextId = 1;
const attempts = [];

async function rpc(method, params, label, retries = 8, endpoint = RPC) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: nextId++, method, params}), signal: AbortSignal.timeout(20000)});
      const json = await response.json();
      if (response.status === 429 || response.status >= 500) {
        if (i < retries) { await sleep(750 * (i + 1)); continue; }
      }
      if (!response.ok || json.error) throw new Error(`HTTP ${response.status}: ${JSON.stringify(json.error || json).slice(0, 700)}`);
      attempts.push({label, method, ok: true, slot: json.result?.context?.slot ?? null,
        count: Array.isArray(json.result?.value) ? json.result.value.length : Array.isArray(json.result) ? json.result.length : null});
      return json.result;
    } catch (error) {
      if (i < retries && /fetch failed|ETIMEDOUT|ECONNRESET|timeout/i.test(String(error))) {
        await sleep(750 * (i + 1)); continue;
      }
      attempts.push({label, method, ok: false, error: String(error.message || error)});
      throw error;
    }
  }
}

function pubkey(data, offset) { return new PublicKey(data.subarray(offset, offset + 32)).toBase58(); }
function coption(data, offset, valueOffset) {
  if (data.length < valueOffset + 32) return {valid: false};
  const flag = data.readUInt32LE(offset);
  return {valid: flag === 0 || flag === 1, value: flag === 1 ? pubkey(data, valueOffset) : null};
}
function decodeToken(data, program) {
  if (data.length < 165) return null;
  if (program === TOKEN_PROGRAMS.splToken && data.length !== 165) return null;
  if (program === TOKEN_PROGRAMS.token2022 && data.length > 165 && data[165] !== 2) return null;
  const delegate = coption(data, 72, 76);
  const isNative = data.readUInt32LE(109);
  const close = coption(data, 129, 133);
  if (!delegate.valid || !close.valid || ![0,1].includes(isNative) || ![1,2].includes(data[108])) return null;
  return {mint: pubkey(data, 0), authority: pubkey(data, 32), amountRaw: data.readBigUInt64LE(64).toString(),
    delegate: delegate.value, delegatedAmountRaw: data.readBigUInt64LE(121).toString(),
    closeAuthority: close.value, state: data[108] === 1 ? 'initialized' : 'frozen',
    isNative: isNative === 1, nativeRentReserveRaw: isNative === 1 ? data.readBigUInt64LE(113).toString() : null,
    dataLength: data.length,
    extensionTypes: program === TOKEN_PROGRAMS.token2022 && data.length > 166 ?
      getExtensionTypes(data.subarray(166)).map(x => ExtensionType[x] || String(x)) : []};
}
function decodeMint(data, program) {
  if (data.length < 82) return null;
  if (program === TOKEN_PROGRAMS.splToken && data.length !== 82) return null;
  if (program === TOKEN_PROGRAMS.token2022 && data.length > 82 &&
      (data.length <= 165 || data[165] !== 1)) return null;
  const ma = coption(data, 0, 4);
  const fa = coption(data, 46, 50);
  if (!ma.valid || !fa.valid || data[45] !== 1) return null;
  return {mintAuthority: ma.value, freezeAuthority: fa.value,
    supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44], initialized: true, dataLength: data.length,
    extensionTypes: program === TOKEN_PROGRAMS.token2022 && data.length > 166 ?
      getExtensionTypes(data.subarray(166)).map(x => ExtensionType[x] || String(x)) : []};
}
function b64Account(item) { return Buffer.from(item.account.data[0], 'base64'); }
function base58(data) { return bs58.encode(data); }
function memcmp(offset, data) { return {memcmp: {offset, bytes: base58(data)}}; }
function optionOne() { const b = Buffer.alloc(4); b.writeUInt32LE(1); return b; }
function pdaBytes(pda) { return new PublicKey(pda).toBuffer(); }
function authorityRows(records, role, authority, program, rows, errors) {
  for (const item of rows) {
    const decoded = decodeToken(b64Account(item), program);
    if (!decoded) { errors.push({role, authority, program, pubkey: item.pubkey, reason: 'Unrecognized token-account layout'}); continue; }
    if (decoded[role] !== authority) {
      errors.push({role, authority, program, pubkey: item.pubkey, reason: `Field mismatch: ${decoded[role]}`}); continue;
    }
    const row = records.get(item.pubkey) || {address: item.pubkey, tokenProgram: program, lamports: item.account.lamports, ...decoded, matches: []};
    row.matches.push({role, authority});
    records.set(item.pubkey, row);
  }
}
async function getProgramAccounts(program, filters, label) {
  // First ask for the exact filtered result. This endpoint currently rejects all broad Token-program scans.
  let unpaginatedError = null;
  try {
    const result = await rpc('getProgramAccounts', [program, {encoding: 'base64', commitment: 'confirmed',
      withContext: true, filters}], `${label}-standard`, 1);
    return {slot: result.context?.slot ?? null, slots: [result.context?.slot ?? null],
      pages: 1, rows: result.value || result, complete: true, method: 'getProgramAccounts', unpaginatedError};
  } catch (error) { unpaginatedError = String(error.message || error); }
  // Helius paginates before all filters have matched. One page is a bounded sample, not an exhaustive zero.
  const rows = [];
  const slots = [];
  const seenKeys = new Set();
  let paginationKey = null;
  let pages = 0;
  do {
    const config = {encoding: 'base64', commitment: 'confirmed', withContext: true, filters, limit: 10000};
    if (paginationKey) config.paginationKey = paginationKey;
    const result = await rpc('getProgramAccountsV2', [program, config], `${label}-page-${pages}`);
    const page = result.value || result;
    if (!Array.isArray(page.accounts)) throw new Error('getProgramAccountsV2 response lacks accounts array');
    slots.push(result.context?.slot ?? null);
    for (const row of page.accounts) {
      if (seenKeys.has(row.pubkey)) throw new Error(`Duplicate pubkey across pages: ${row.pubkey}`);
      seenKeys.add(row.pubkey);
      rows.push(row);
    }
    paginationKey = page.paginationKey || null;
    pages++;
    if (pages >= 1) break;
  } while (paginationKey);
  return {slot: slots[0] || null, slots, pages, rows, complete: !paginationKey,
    method: 'getProgramAccountsV2', paginationRemaining: !!paginationKey, unpaginatedError};
}
async function getMultipleAccounts(addresses, label) {
  const results = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const batch = addresses.slice(i, i + 100);
    const response = await rpc('getMultipleAccounts', [batch, {encoding: 'base64', commitment: 'confirmed'}], `${label}-${i / 100}`);
    results.push(...batch.map((address, j) => ({address, account: response.value[j], slot: response.context.slot})));
  }
  return results;
}

async function main() {
  const accounts = new Map();
  const mintCandidates = new Map();
  const errors = [];
  const scans = [];
  for (const [programLabel, program] of Object.entries(TOKEN_PROGRAMS)) {
    for (const [authorityLabel, authority] of Object.entries(AUTHORITIES)) {
      let ownerSlot = null;
      // Owner-indexed RPC gives all token accounts whose account owner authority equals the PDA.
      try {
        const result = await rpc('getTokenAccountsByOwner', [authority, {programId: program},
          {encoding: 'base64', commitment: 'confirmed'}], `${programLabel}-${authorityLabel}-owner`);
        ownerSlot = result.context.slot;
        scans.push({programLabel, authorityLabel, field: 'authority', method: 'getTokenAccountsByOwner',
          slot: result.context.slot, rawCount: result.value.length, ok: true, complete: true});
        authorityRows(accounts, 'authority', authority, program, result.value, errors);
      } catch (error) {
        scans.push({programLabel, authorityLabel, field: 'authority', method: 'getTokenAccountsByOwner', ok: false,
          error: String(error.message || error)});
      }
      // Helius's heavier endpoint implements the owner-indexed delegate method.
      try {
        const result = await rpc('getTokenAccountsByDelegate', [authority, {programId: program},
          {encoding: 'base64', commitment: 'confirmed', ...(ownerSlot && {minContextSlot: ownerSlot})}],
          `${programLabel}-${authorityLabel}-delegate`, 8, HEAVY_RPC);
        scans.push({programLabel, authorityLabel, field: 'delegate', method: 'getTokenAccountsByDelegate',
          slot: result.context.slot, minContextSlotRequested: ownerSlot,
          freshEnoughForOwnerSnapshot: ownerSlot ? result.context.slot >= ownerSlot : null,
          rawCount: result.value.length, ok: true, complete: true});
        authorityRows(accounts, 'delegate', authority, program, result.value, errors);
      } catch (error) {
        scans.push({programLabel, authorityLabel, field: 'delegate', method: 'getTokenAccountsByDelegate', ok: false,
          complete: false, error: String(error.message || error)});
      }
      // Close authority is a separate capability with no indexed RPC method.
      for (const [field, offset, flagOffset] of [['closeAuthority', 133, 129]]) {
        try {
          const filters = [memcmp(flagOffset, optionOne()), memcmp(offset, pdaBytes(authority))];
          if (programLabel === 'splToken') filters.unshift({dataSize: 165});
          const {slot, slots, pages, rows, complete, method, paginationRemaining, unpaginatedError} =
            await getProgramAccounts(program, filters, `${programLabel}-${authorityLabel}-${field}`);
          scans.push({programLabel, authorityLabel, field, method, slot, slots, pages, rawCount: rows.length,
            ok: true, complete, paginationRemaining, unpaginatedError});
          authorityRows(accounts, field, authority, program, rows, errors);
        } catch (error) {
          scans.push({programLabel, authorityLabel, field, method: 'getProgramAccountsV2', ok: false,
            complete: false, error: String(error.message || error)});
        }
      }
      // Both mint and freeze authorities occupy fixed offsets in legacy and Token-2022 base mints.
      for (const [field, offset, flagOffset] of [['mintAuthority', 4, 0], ['freezeAuthority', 50, 46]]) {
        try {
          const filters = [memcmp(flagOffset, optionOne()), memcmp(offset, pdaBytes(authority))];
          if (programLabel === 'splToken') filters.unshift({dataSize: 82});
          const {slot, slots, pages, rows, complete, method, paginationRemaining, unpaginatedError} =
            await getProgramAccounts(program, filters, `${programLabel}-${authorityLabel}-${field}`);
          scans.push({programLabel, authorityLabel, field, method, slot, slots, pages, rawCount: rows.length,
            ok: true, complete, paginationRemaining, unpaginatedError});
          for (const item of rows) {
            const decoded = decodeMint(b64Account(item), program);
            if (!decoded || decoded[field] !== authority) {
              errors.push({field, authority, program, pubkey: item.pubkey, reason: 'Mint layout or field mismatch'});
              continue;
            }
            const row = mintCandidates.get(item.pubkey) || {address: item.pubkey, tokenProgram: program,
              lamports: item.account.lamports, ...decoded, matches: []};
            row.matches.push({field, authority});
            mintCandidates.set(item.pubkey, row);
          }
        } catch (error) {
          scans.push({programLabel, authorityLabel, field, method: 'getProgramAccountsV2', ok: false,
            complete: false, error: String(error.message || error)});
        }
      }
    }
  }

  // Fetch current mints for every discovered token account and cross-check the token program.
  const mintAddresses = [...new Set([...accounts.values()].map(x => x.mint).concat([...mintCandidates.keys()]))].sort();
  const mintInfo = await getMultipleAccounts(mintAddresses, 'mint-current');
  const mints = mintInfo.map(({address, account, slot}) => {
    if (!account) return {address, exists: false, slot};
    const decoded = decodeMint(Buffer.from(account.data[0], 'base64'), account.owner);
    return {address, exists: true, slot, tokenProgram: account.owner, lamports: account.lamports,
      ...(decoded || {decodeError: 'Unrecognized mint layout'}),
      authorityMatches: mintCandidates.get(address)?.matches || []};
  });
  const mintMap = new Map(mints.map(row => [row.address, row]));
  for (const row of accounts.values()) {
    const mint = mintMap.get(row.mint);
    row.decimals = mint?.decimals ?? null;
    row.uiAmountExact = mint?.decimals == null ? null :
      `${BigInt(row.amountRaw) / (10n ** BigInt(mint.decimals))}${mint.decimals ? '.' +
      (BigInt(row.amountRaw) % (10n ** BigInt(mint.decimals))).toString().padStart(mint.decimals, '0') : ''}`;
    row.mintSupplyRaw = mint?.supplyRaw ?? null;
    row.mintAuthority = mint?.mintAuthority ?? null;
    row.freezeAuthority = mint?.freezeAuthority ?? null;
    row.canonicalAta = getAssociatedTokenAddressSync(new PublicKey(row.mint),
      new PublicKey(row.authority), true, new PublicKey(row.tokenProgram)).toBase58() === row.address;
    if (!mint || mint.tokenProgram !== row.tokenProgram) errors.push({account: row.address, mint: row.mint,
      reason: 'Mint missing or token program mismatch'});
  }
  const rows = [...accounts.values()].sort((a,b) => a.address.localeCompare(b.address));
  const summary = {
    uniqueTokenAccounts: rows.length,
    byAuthority: Object.fromEntries(Object.entries(AUTHORITIES).map(([label, address]) => [label, {
      directOwnerAccounts: rows.filter(x => x.authority === address).length,
      observedDelegateAccountsAtQueriedSnapshot: rows.filter(x => x.delegate === address).length,
      confirmedCloseAuthorityAccountsInBoundedProbe: rows.filter(x => x.closeAuthority === address).length,
      distinctMintsForDirectOwner: [...new Set(rows.filter(x => x.authority === address).map(x => x.mint))].length,
    }])),
    byProgram: Object.fromEntries(Object.entries(TOKEN_PROGRAMS).map(([label, address]) => [label,
      rows.filter(x => x.tokenProgram === address).length])),
    uniqueMintsReferencedByTokenAccounts: [...new Set(rows.map(x => x.mint))].length,
    confirmedMintsWithAuthorityMatchInBoundedProbe: mintCandidates.size,
    directOwnerScansComplete: scans.filter(x => x.field === 'authority').every(x => x.ok && x.complete !== false),
    delegateScansCompleteAtQueriedSnapshot: scans.filter(x => x.field === 'delegate').every(x => x.ok && x.complete),
    delegateScansFreshEnoughForOwnerSnapshot: scans.filter(x => x.field === 'delegate').every(x => x.freshEnoughForOwnerSnapshot),
    allGlobalAuthorityScansComplete: scans.filter(x => !['authority','delegate'].includes(x.field)).every(x => x.ok && x.complete),
    canonicalAtaCount: rows.filter(x => x.canonicalAta).length,
    decodeMismatchCount: errors.length,
  };
  const report = {generatedAt: new Date().toISOString(), commitment: 'confirmed', authorities: AUTHORITIES,
    tokenPrograms: TOKEN_PROGRAMS, queryMethod: 'Owner and delegate indexes; fixed-layout filtered getProgramAccounts with bounded Helius V2 fallback for close, mint, and freeze authorities; full base64 decode',
    summary, scans, tokenAccounts: rows, mints, decodeMismatches: errors, rpcAttempts: attempts};
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output: OUT, summary, scans, errors}, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
