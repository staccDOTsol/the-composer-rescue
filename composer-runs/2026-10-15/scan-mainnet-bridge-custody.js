#!/usr/bin/env node
'use strict';

// Read-only Solana bridge custody census. Requires SOLANA_RPC in the environment.
// It never constructs, signs, or submits a transaction.
const fs = require('fs');
const crypto = require('crypto');
const {
  PublicKey,
  Connection,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC = process.env.SOLANA_RPC;
if (!RPC) throw new Error('SOLANA_RPC is required');
const OUT = process.argv[2] || 'mainnet-bridge-custody.json';
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const connection = new Connection(RPC, 'confirmed');

const PROGRAMS = {
  cctpV1Message: 'CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd',
  cctpV1Token: 'CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3',
  cctpV2Message: 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
  cctpV2Token: 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
  allbridgeClassic: 'BBbD1WSjbHKfyE3TSFWF6vx1JV51c8msKSQy4ess6pXp',
  allbridgeCore: 'BrdgN2RPzEMWF96ZbnnJaUtQDQx7VRXYaHHbYCBvceWB',
  wormholeCore: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
  wormholeTokenBridge: 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',
  wormholeNftBridge: 'WnFt12ZrnzZrFZkt2xsNsaNWoQribnuQ5B5FrDbwDhD',
  layerZeroEndpoint: '76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6',
  layerZeroOft: 'HRPXLCqspQocTjfcX4rvAPaY9q6Gwb1rrD3xXWrfJWdW',
  mayan: 'FC4eXxkyrMPTjiYUpp4EAnkmwMbQyZ6NDCh1kfLn6vsf',
  mayanMctp: 'dkpZqrxHFrhziEMQ931GLtfy11nFkCsfMftH9u6QwBU',
  mayanFastMctp: 'Gx9rivpS3YR8pBFwMuP6omYqVxunpLvLkNn7ubNyuZZ5',
  mayanSwiftV1: 'BLZRi6frs4X4DNLw56V4EXai1b6QVESN1BhHBTYM9VcY',
  mayanSwiftV2: 'mayan34VedncxdK2XobtvWFDXQASUTBXhUVzt2kKgny',
  mayanMps: 'GFRP4yXUjvcQemf2zRJN8w9sPNaDk5PyBUQdPHD1AzLp',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rpcId = 1;
async function rpc(method, params, retries = 6) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: rpcId++, method, params}),
    });
    if ((res.status === 429 || res.status >= 500) && i < retries) {
      await sleep(600 * (i + 1));
      continue;
    }
    const j = await res.json();
    if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
    return j.result;
  }
}

function u64(b, o) { return b.readBigUInt64LE(o); }
function u128(b, o) { return u64(b, o) + (u64(b, o + 8) << 64n); }
function pk(b, o) { return new PublicKey(b.subarray(o, o + 32)).toBase58(); }
function disc(name) { return crypto.createHash('sha256').update(`account:${name}`).digest().subarray(0, 8); }
function trimAscii(b) { return b.toString('utf8').replace(/\0.*$/, '').trim(); }
function uiAmount(raw, decimals) { return Number(raw) / 10 ** decimals; }

function decodeTokenAccount(data) {
  if (data.length < 72) return null;
  return {mint: pk(data, 0), authority: pk(data, 32), rawAmount: u64(data, 64).toString()};
}
function decodeMint(data) {
  if (data.length < 82) return null;
  const mintAuthority = data.readUInt32LE(0) === 1 ? pk(data, 4) : null;
  const freezeAuthority = data.readUInt32LE(46) === 1 ? pk(data, 50) : null;
  return {mintAuthority, supply: u64(data, 36).toString(), decimals: data[44], freezeAuthority};
}

async function getAccounts(pubkeys) {
  const out = new Map();
  for (let i = 0; i < pubkeys.length; i += 100) {
    const keys = pubkeys.slice(i, i + 100);
    const result = await rpc('getMultipleAccounts', [keys, {encoding: 'base64', commitment: 'confirmed'}]);
    keys.forEach((k, n) => out.set(k, result.value[n]));
    await sleep(80);
  }
  return out;
}

async function getProgramAccounts(program, filters = [], dataSlice) {
  const cfg = {encoding: 'base64', commitment: 'confirmed', filters};
  if (dataSlice) cfg.dataSlice = dataSlice;
  return rpc('getProgramAccounts', [program, cfg]);
}

async function programMeta(program) {
  const info = await rpc('getAccountInfo', [program, {encoding: 'base64', commitment: 'confirmed'}]);
  if (!info.value) return {exists: false};
  const d = Buffer.from(info.value.data[0], 'base64');
  const base = {exists: true, executable: info.value.executable, owner: info.value.owner, lamports: info.value.lamports};
  if (info.value.owner !== UPGRADEABLE.toBase58() || d.length < 36 || d.readUInt32LE(0) !== 2) return base;
  const programData = pk(d, 4);
  const pdi = await rpc('getAccountInfo', [programData, {encoding: 'base64', commitment: 'confirmed'}]);
  if (!pdi.value) return {...base, programData, programDataMissing: true};
  const pd = Buffer.from(pdi.value.data[0], 'base64');
  const slot = Number(pd.readBigUInt64LE(4));
  const hasAuthority = pd.readUInt32LE(12) === 1;
  const elfOffset = hasAuthority ? 48 : 16;
  return {
    ...base,
    programData,
    lastDeployedSlot: slot,
    upgradeAuthority: hasAuthority ? pk(pd, 16) : null,
    programDataLength: pd.length,
    elfSha256: crypto.createHash('sha256').update(pd.subarray(elfOffset)).digest('hex'),
  };
}

async function tokenRows(addresses, expectedAuthority) {
  const infos = await getAccounts(addresses);
  const decoded = [];
  const mints = new Set();
  for (const a of addresses) {
    const ai = infos.get(a);
    if (!ai) { decoded.push({address: a, exists: false}); continue; }
    const row = decodeTokenAccount(Buffer.from(ai.data[0], 'base64'));
    decoded.push({address: a, tokenProgram: ai.owner, ...row, authorityMatches: expectedAuthority ? row?.authority === expectedAuthority : undefined});
    if (row) mints.add(row.mint);
  }
  const mintInfos = await getAccounts([...mints]);
  const mintMap = new Map();
  for (const m of mints) {
    const ai = mintInfos.get(m);
    mintMap.set(m, ai ? {tokenProgram: ai.owner, ...decodeMint(Buffer.from(ai.data[0], 'base64'))} : null);
  }
  for (const r of decoded) if (r.mint && mintMap.get(r.mint)) {
    r.mintInfo = mintMap.get(r.mint);
    r.uiAmount = uiAmount(BigInt(r.rawAmount), r.mintInfo.decimals);
  }
  return decoded;
}

async function scanCctp(label, program) {
  const pid = new PublicKey(program);
  const [tokenMinter] = PublicKey.findProgramAddressSync([Buffer.from('token_minter')], pid);
  const rows = await getProgramAccounts(program, [{memcmp: {offset: 0, bytes: require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58').encode(disc('LocalToken'))}}]);
  const localTokens = rows.map((r) => {
    const d = Buffer.from(r.account.data[0], 'base64');
    return {
      state: r.pubkey,
      custody: pk(d, 8),
      mint: pk(d, 40),
      burnLimitPerMessage: u64(d, 72).toString(),
      messagesSent: u64(d, 80).toString(),
      messagesReceived: u64(d, 88).toString(),
      amountSent: u128(d, 96).toString(),
      amountReceived: u128(d, 112).toString(),
    };
  });
  const balances = await tokenRows(localTokens.map((x) => x.custody), tokenMinter.toBase58());
  return {label, program, tokenMinter: tokenMinter.toBase58(), exactLocalTokenCount: localTokens.length, localTokens, balances};
}

async function scanAllbridgeClassic() {
  const program = PROGRAMS.allbridgeClassic;
  const bridge = 'bb1XfNoER5QC3rhVDaVz3AJp9oFKoHNHG6PHfZLcCjj';
  const authority = 'CYEFQXzQM6E5P8ZrXgS7XMSwU3CiqHMMyACX4zuaA2Z4';
  const rows = await getProgramAccounts(program, [{dataSize: 220}, {memcmp: {offset: 0, bytes: '4'}}]);
  const assets = rows.map((r) => {
    const d = Buffer.from(r.account.data[0], 'base64');
    return {state: r.pubkey, bridge: pk(d, 1), source: trimAscii(d.subarray(33, 37)), sourceAddressHex: d.subarray(37, 69).toString('hex'), decimalsDeclared: d[69], symbol: trimAscii(d.subarray(70, 82)), name: trimAscii(d.subarray(82, 114)), mint: pk(d, 114), tokenAccount: pk(d, 146), feeCollector: pk(d, 186), isWrapped: !!d[218], enabled: !!d[219]};
  });
  const custody = await tokenRows(assets.filter((x) => !x.isWrapped).map((x) => x.tokenAccount), authority);
  const wrappedMints = assets.filter((x) => x.isWrapped).map((x) => x.mint);
  const wrappedInfos = await getAccounts(wrappedMints);
  const wrapped = wrappedMints.map((m) => {
    const ai = wrappedInfos.get(m);
    return {mint: m, tokenProgram: ai?.owner || null, ...(ai ? decodeMint(Buffer.from(ai.data[0], 'base64')) : {exists: false}), authorityMatches: ai ? decodeMint(Buffer.from(ai.data[0], 'base64')).mintAuthority === authority : false};
  });
  return {program, bridge, authority, exactAssetCount: assets.length, nativeAssetCount: assets.filter((x) => !x.isWrapped).length, wrappedAssetCount: wrapped.length, assets, custody, wrapped};
}

async function scanAllbridgeCore() {
  const program = PROGRAMS.allbridgeCore;
  const pid = new PublicKey(program);
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], pid);
  const [authority] = PublicKey.findProgramAddressSync([config.toBuffer()], pid);
  const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
  const rows = await getProgramAccounts(program, [{memcmp: {offset: 0, bytes: bs58.encode(Buffer.from([241,154,109,4,17,177,109,188]))}}]);
  const pools = rows.map((r) => {
    const d = Buffer.from(r.account.data[0], 'base64');
    const mint = pk(d, 8);
    const [tokenAccount] = PublicKey.findProgramAddressSync([Buffer.from('token'), new PublicKey(mint).toBuffer()], pid);
    return {state: r.pubkey, mint, tokenAccount: tokenAccount.toBase58(), a: u64(d, 40).toString(), d: u64(d, 48).toString(), accountingTokenBalance: u64(d, 56).toString(), vUsdBalance: u64(d, 64).toString(), reserves: u64(d, 72).toString(), decimalsDeclared: d[80]};
  });
  const custody = await tokenRows(pools.map((x) => x.tokenAccount), authority.toBase58());
  return {program, config: config.toBase58(), authority: authority.toBase58(), exactPoolCount: pools.length, pools, custody};
}

async function tokenAccountsByOwner(owner) {
  const results = [];
  for (const tokenProgram of [TOKEN.toBase58(), TOKEN_2022.toBase58()]) {
    const r = await rpc('getTokenAccountsByOwner', [owner, {programId: tokenProgram}, {encoding: 'base64', commitment: 'confirmed'}]);
    for (const v of r.value) {
      const row = decodeTokenAccount(Buffer.from(v.account.data[0], 'base64'));
      results.push({address: v.pubkey, tokenProgram, ...row});
    }
    await sleep(60);
  }
  return results;
}

async function scanMayan() {
  const programNames = ['mayan','mayanMctp','mayanFastMctp','mayanSwiftV1','mayanSwiftV2','mayanMps'];
  const out = [];
  for (const name of programNames) {
    const program = PROGRAMS[name];
    const accounts = await getProgramAccounts(program, [], {offset: 0, length: 0});
    const owners = accounts.map((x) => x.pubkey);
    if (name === 'mayan') {
      const [main] = PublicKey.findProgramAddressSync([Buffer.from('MAIN')], new PublicKey(program));
      if (!owners.includes(main.toBase58())) owners.unshift(main.toBase58());
    }
    // Exact PDA/state denominator is recorded. A bounded full scan is deliberate:
    // if a program has >500 live state accounts, RPC owner-by-owner enumeration is
    // reported as a blocker rather than mislabeled exhaustive.
    const scanOwners = owners.length <= 500 ? owners : owners.slice(0, 500);
    const tokenAccounts = [];
    for (let i = 0; i < scanOwners.length; i++) {
      const rows = await tokenAccountsByOwner(scanOwners[i]);
      for (const r of rows) if (BigInt(r.rawAmount) > 0n) tokenAccounts.push({stateOwner: scanOwners[i], ...r});
      if (i % 25 === 24) await sleep(300);
    }
    const detailed = await tokenRows(tokenAccounts.map((x) => x.address));
    out.push({name, program, exactProgramAccountCount: accounts.length, scannedOwnerCount: scanOwners.length, fullOwnerScan: scanOwners.length === owners.length, positiveTokenAccounts: detailed});
  }
  return out;
}

async function accountCountsAndMetadata() {
  const counts = {};
  const metadata = {};
  for (const [name, program] of Object.entries(PROGRAMS)) {
    try {
      const rows = await getProgramAccounts(program, [], {offset: 0, length: 0});
      counts[name] = rows.length;
      metadata[name] = await programMeta(program);
    } catch (e) {
      counts[name] = {error: String(e)};
      try { metadata[name] = await programMeta(program); } catch (m) { metadata[name] = {error: String(m)}; }
    }
    await sleep(100);
  }
  return {counts, metadata};
}

async function addPrices(report) {
  const tokenRowsAll = [];
  for (const c of [report.cctpV1, report.cctpV2]) tokenRowsAll.push(...c.balances);
  tokenRowsAll.push(...report.allbridgeClassic.custody, ...report.allbridgeCore.custody);
  for (const m of report.mayan) tokenRowsAll.push(...m.positiveTokenAccounts);
  const mints = [...new Set(tokenRowsAll.filter((x) => x.mint).map((x) => x.mint))];
  const prices = {};
  for (let i = 0; i < mints.length; i += 100) {
    const ids = mints.slice(i, i + 100).map((m) => `solana:${m}`).join(',');
    const res = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
    if (res.ok) Object.assign(prices, (await res.json()).coins || {});
  }
  for (const r of tokenRowsAll) if (r.mintInfo && r.rawAmount) {
    const p = prices[`solana:${r.mint}`]?.price;
    r.priceUsd = p ?? null;
    r.valueUsd = p == null ? null : r.uiAmount * p;
  }
  report.prices = {source: 'DefiLlama current price API', fetchedAt: new Date().toISOString(), exactDistinctMintCount: mints.length, pricedMintCount: Object.keys(prices).length, unpricedMints: mints.filter((m) => !prices[`solana:${m}`])};
}

async function main() {
  const report = {generatedAt: new Date().toISOString(), slot: await connection.getSlot('confirmed'), rpcReadsOnly: true, programs: PROGRAMS};
  report.cctpV1 = await scanCctp('CCTP V1', PROGRAMS.cctpV1Token);
  report.cctpV2 = await scanCctp('CCTP V2', PROGRAMS.cctpV2Token);
  report.allbridgeClassic = await scanAllbridgeClassic();
  report.allbridgeCore = await scanAllbridgeCore();
  report.mayan = await scanMayan();
  Object.assign(report, await accountCountsAndMetadata());
  await addPrices(report);
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({out: OUT, slot: report.slot, cctpV1: report.cctpV1.exactLocalTokenCount, cctpV2: report.cctpV2.exactLocalTokenCount, allbridgeClassic: report.allbridgeClassic.exactAssetCount, allbridgeCore: report.allbridgeCore.exactPoolCount, mayan: report.mayan.map((x) => [x.name, x.exactProgramAccountCount, x.fullOwnerScan, x.positiveTokenAccounts.length])}, null, 2));
}

main().catch((e) => { console.error(e.stack || e); process.exit(1); });
