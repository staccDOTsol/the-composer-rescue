#!/usr/bin/env node
// Read-only, current-mainnet SKR lender census. Never signs or sends a transaction.
const fs = require('fs');
const crypto = require('crypto');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
if (!url) throw new Error('Read-only RPC unavailable');
const P0 = 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA';
const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const SKR = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';
const sampledP0Bank = 'CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh';
const sampledKaminoReserve = 'AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z';
const b58 = data => new PublicKey(data).toBase58();
let id = 0;
async function rpc(method, params) {
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
function anchorDisc(name) {
  return crypto.createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
}
async function account(address) {
  const result = await rpc('getAccountInfo', [address,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const v = result.value;
  return {slot: result.context.slot, owner: v?.owner,
    data: v ? Buffer.from(v.data[0], 'base64') : null};
}
async function directMintFilter(program, name, offset, mint) {
  const result = await rpc('getProgramAccounts', [program, {
    encoding: 'base64', commitment: 'confirmed', withContext: true,
    filters: [
      {memcmp: {offset: 0, bytes: bs58.encode(anchorDisc(name))}},
      {memcmp: {offset, bytes: mint}},
    ],
    dataSlice: {offset: 0, length: 0},
  }]);
  return {slot: result.context.slot, count: result.value.length,
    addresses: result.value.map(x => x.pubkey)};
}
async function census(program, name, offset, length, knownAddress, expectedMint) {
  const control = await account(knownAddress);
  if (!control.data || control.owner !== program ||
      !control.data.subarray(0, 8).equals(anchorDisc(name)) ||
      b58(control.data.subarray(offset, offset + 32)) !== expectedMint) {
    throw new Error(`layout control failed: ${name} ${knownAddress}`);
  }
  const result = await rpc('getProgramAccounts', [program, {
    encoding: 'base64', commitment: 'confirmed', withContext: true,
    filters: [{memcmp: {offset: 0, bytes: bs58.encode(anchorDisc(name))}}],
    dataSlice: {offset: 0, length},
  }]);
  const rows = result.value.map(({pubkey, account: v}) => {
    const data = Buffer.from(v.data[0], 'base64');
    if (!data.subarray(0, 8).equals(anchorDisc(name)))
      throw new Error(`census discriminator mismatch: ${pubkey}`);
    return {address: pubkey, mint: b58(data.subarray(offset, offset + 32)),
      fullDataLength: v.space ?? null};
  });
  const matches = rows.filter(x => x.mint === SKR);
  const usdcControls = rows.filter(x => x.mint === USDC);
  const directSkrFilter = await directMintFilter(program, name, offset, SKR);
  const directExpectedFilter = await directMintFilter(program, name, offset, expectedMint);
  if (directSkrFilter.count !== matches.length ||
      directExpectedFilter.count !== rows.filter(x => x.mint === expectedMint).length) {
    throw new Error(`Direct mint filter disagrees with sliced census: ${name}`);
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify(rows
    .sort((a, b) => a.address.localeCompare(b.address)))).digest('hex');
  return {program, accountType: name, mintOffset: offset,
    positiveControl: {address: knownAddress, slot: control.slot, mint: expectedMint,
      dataLength: control.data.length}, observationSlot: result.context.slot,
    stateCount: rows.length, distinctMints: new Set(rows.map(x => x.mint)).size,
    skrMint: SKR, skrMatches: matches,
    directSkrFilter, directExpectedFilter,
    usdcControlCount: usdcControls.length,
    usdcControlFirst: usdcControls.slice(0, 3),
    rowDigestSha256: digest,
    rows};
}
async function main() {
  // Marginfi Bank: Anchor discriminator (8), followed by mint (32).
  const p0 = await census(P0, 'Bank', 8, 40, sampledP0Bank, WSOL);
  // Kamino Reserve: discriminator (8), version (8), LastUpdate (16),
  // lendingMarket (32), farmCollateral (32), farmDebt (32), then liquidity mint.
  const kamino = await census(KLEND, 'Reserve', 128, 160,
    sampledKaminoReserve, USDC);
  const out = {generatedAt: new Date().toISOString(), transport: 'read-only RPC',
    noLiveSubmission: true, p0, kamino};
  const output = __dirname + '/lender-census.json';
  fs.writeFileSync(output, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({output,
    p0: {slot: p0.observationSlot, stateCount: p0.stateCount,
      skrCount: p0.skrMatches.length, usdcControls: p0.usdcControlCount},
    kamino: {slot: kamino.observationSlot, stateCount: kamino.stateCount,
      skrCount: kamino.skrMatches.length, usdcControls: kamino.usdcControlCount}}, null, 2));
}
main().catch(e => {console.error(e.stack || e); process.exitCode = 1;});
