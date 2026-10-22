// Read-only custody census for material Solana orderbook/exchange deployments.
// Bulk discovery prefers the supplied Flux endpoint; every included account is
// re-read and validated at the current Helius endpoint before valuation.
const fs = require('fs');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-09-11/uhmm-i-want-frost-enabled-wallets/outputs/frost-snap/node_modules';
const { Connection, PublicKey } = require(`${MODULES}/@solana/web3.js`);
const bs58Module = require(`${MODULES}/bs58`);
const bs58 = bs58Module.default || bs58Module;

const OUT = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/orderbook-dex-custody.json';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ASSOCIATED = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const ZERO = new PublicKey('11111111111111111111111111111111');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pk = b => new PublicKey(b).toBase58();
const le = (n, bytes) => { const b = Buffer.alloc(bytes); bytes === 2 ? b.writeUInt16LE(Number(n)) : bytes === 4 ? b.writeUInt32LE(Number(n)) : b.writeBigUInt64LE(BigInt(n)); return b; };
const disc = name => crypto.createHash('sha256').update(name).digest().subarray(0, 8);
const d64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return bs58.encode(b); };

const current = new Connection(process.env.SOLANA_RPC, 'confirmed');
const heavy = new Connection(process.env.HEAVY_RPC || process.env.SOLANA_RPC, 'confirmed');

async function retry(label, fn) {
  let last;
  for (let i = 0; i < 5; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(900 * (i + 1)); }
  }
  throw new Error(`${label}: ${last?.message || last}`);
}

async function discover(program, filters) {
  const programKey = new PublicKey(program);
  const heavyRows = await retry(`Flux GPA ${program}`, () => heavy.getProgramAccounts(programKey, { commitment: 'confirmed', filters, dataSlice: { offset: 0, length: 0 } }));
  // The current endpoint rate-limits full program scans. Use Flux as the
  // explicitly bounded discovery snapshot, then validate every discovered
  // address from the current endpoint below.
  const keys = [...new Set(heavyRows.map(x => x.pubkey.toBase58()))];
  const infos = [];
  for (let i = 0; i < keys.length; i += 80) {
    infos.push(...await retry(`current multi ${program}`, () => current.getMultipleAccountsInfo(keys.slice(i, i + 80).map(x => new PublicKey(x)), 'confirmed')));
    await sleep(180);
  }
  return {
    fluxCount: heavyRows.length,
    currentDiscoveryCount: null,
    discoveryBound: 'Flux getProgramAccounts only; every discovered address was re-read from the current endpoint, but accounts created after the Flux snapshot can be absent.',
    unionCount: keys.length,
    live: keys.map((address, i) => ({ address, info: infos[i] })).filter(x => x.info && x.info.owner.equals(programKey)),
  };
}

async function fetchInfos(addresses) {
  const out = [];
  for (let i = 0; i < addresses.length; i += 80) {
    out.push(...await retry('current vault multi', () => current.getMultipleAccountsInfo(addresses.slice(i, i + 80).map(x => new PublicKey(x)), 'confirmed')));
    await sleep(180);
  }
  return out;
}

function tokenAccount(address, info) {
  if (!info || info.data.length < 72) return null;
  const ownerProgram = info.owner.toBase58();
  if (ownerProgram !== TOKEN && ownerProgram !== TOKEN22) return null;
  return {
    address,
    mint: pk(info.data.subarray(0, 32)),
    authority: pk(info.data.subarray(32, 64)),
    rawAmount: info.data.readBigUInt64LE(64).toString(),
    tokenProgram: ownerProgram,
    dataLength: info.data.length,
  };
}

async function scanOpenBookV2() {
  const program = new PublicKey('opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb');
  const found = await discover(program, [{ dataSize: 848 }]);
  const marketDisc = disc('account:Market');
  const states = found.live.filter(a => a.info.data.subarray(0, 8).equals(marketDisc)).map(a => {
    const d = a.info.data;
    return { address: a.address, bump: d[8], marketAuthority: new PublicKey(d.subarray(16, 48)), baseMint: new PublicKey(d.subarray(576, 608)), quoteMint: new PublicKey(d.subarray(608, 640)), marketBaseVault: new PublicKey(d.subarray(640, 672)), marketQuoteVault: new PublicKey(d.subarray(680, 712)) };
  });
  const vaultAddresses = states.flatMap(x => [x.marketBaseVault.toBase58(), x.marketQuoteVault.toBase58()]);
  const vaultInfos = await fetchInfos(vaultAddresses);
  const rows = [];
  for (let i = 0; i < states.length; i++) {
    const s = states[i], address = s.address;
    const [authority, bump] = PublicKey.findProgramAddressSync([Buffer.from('Market'), new PublicKey(address).toBuffer()], program);
    for (const [j, side, mint, vault] of [[0, 'base', s.baseMint, s.marketBaseVault], [1, 'quote', s.quoteMint, s.marketQuoteVault]]) {
      const t = tokenAccount(vault.toBase58(), vaultInfos[i * 2 + j]);
      if (!t) continue;
      const [ata] = PublicKey.findProgramAddressSync([authority.toBuffer(), new PublicKey(t.tokenProgram).toBuffer(), mint.toBuffer()], ASSOCIATED);
      rows.push({ family: 'OpenBook v2', program: program.toBase58(), state: address, kind: side, ...t,
        proof: { stateOwnedByProgram: true, stateReferenceMatches: true, authorityPdaMatches: s.marketAuthority.equals(authority) && s.bump === bump, vaultIsAuthorityAta: ata.equals(vault), tokenAuthorityMatches: t.authority === authority.toBase58(), tokenMintMatches: t.mint === mint.toBase58() } });
    }
  }
  return { name: 'OpenBook v2', program: program.toBase58(), discovery: found, stateAccountsDecoded: states.length, rows };
}

async function scanPhoenixLegacy() {
  const program = new PublicKey('PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY');
  const found = await discover(program, [{ memcmp: { offset: 0, bytes: d64(8167313896524341111n) } }]);
  const states = found.live.filter(x => x.info.data.length >= 576).map(x => {
    const d = x.info.data;
    return { address: x.address, baseMint: new PublicKey(d.subarray(48, 80)), baseVault: new PublicKey(d.subarray(80, 112)), baseBump: d.readUInt32LE(44), quoteMint: new PublicKey(d.subarray(128, 160)), quoteVault: new PublicKey(d.subarray(160, 192)), quoteBump: d.readUInt32LE(124) };
  });
  const infos = await fetchInfos(states.flatMap(x => [x.baseVault.toBase58(), x.quoteVault.toBase58()]));
  const rows = [];
  for (let i = 0; i < states.length; i++) for (const [j, side] of [[0, 'base'], [1, 'quote']]) {
    const s = states[i], mint = s[`${side}Mint`], vault = s[`${side}Vault`];
    const [derived, bump] = PublicKey.findProgramAddressSync([Buffer.from('vault'), new PublicKey(s.address).toBuffer(), mint.toBuffer()], program);
    const t = tokenAccount(vault.toBase58(), infos[i * 2 + j]); if (!t) continue;
    rows.push({ family: 'Phoenix Legacy', program: program.toBase58(), state: s.address, kind: side, ...t,
      proof: { stateOwnedByProgram: true, stateReferenceMatches: true, vaultPdaMatches: derived.equals(vault) && bump === s[`${side}Bump`], tokenAuthorityIsVaultPda: t.authority === vault.toBase58(), tokenMintMatches: t.mint === mint.toBase58() } });
  }
  return { name: 'Phoenix Legacy', program: program.toBase58(), discovery: found, stateAccountsDecoded: states.length, rows };
}

async function scanManifest() {
  const program = new PublicKey('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms');
  const markets = await discover(program, [{ memcmp: { offset: 0, bytes: d64(4859840929024028656n) } }]);
  await sleep(700);
  const globals = await discover(program, [{ memcmp: { offset: 0, bytes: d64(10787423733276977665n) } }]);
  const refs = [];
  for (const x of markets.live) if (x.info.data.length >= 144) {
    const d = x.info.data;
    for (const [kind, mo, vo] of [['market-base', 16, 80], ['market-quote', 48, 112]]) refs.push({ kind, state: x.address, mint: new PublicKey(d.subarray(mo, mo + 32)), vault: new PublicKey(d.subarray(vo, vo + 32)), stateType: 'market' });
  }
  for (const x of globals.live) if (x.info.data.length >= 72) refs.push({ kind: 'global', state: x.address, mint: new PublicKey(x.info.data.subarray(8, 40)), vault: new PublicKey(x.info.data.subarray(40, 72)), stateType: 'global' });
  const infos = await fetchInfos(refs.map(x => x.vault.toBase58()));
  const rows = refs.map((r, i) => {
    const t = tokenAccount(r.vault.toBase58(), infos[i]); if (!t) return null;
    const [vault, bump] = PublicKey.findProgramAddressSync(r.stateType === 'global' ? [Buffer.from('global-vault'), r.mint.toBuffer()] : [Buffer.from('vault'), new PublicKey(r.state).toBuffer(), r.mint.toBuffer()], program);
    const [statePda] = r.stateType === 'global' ? PublicKey.findProgramAddressSync([Buffer.from('global'), r.mint.toBuffer()], program) : [new PublicKey(r.state)];
    return { family: 'Manifest', program: program.toBase58(), state: r.state, kind: r.kind, ...t, proof: { stateOwnedByProgram: true, stateReferenceMatches: true, globalStatePdaMatches: r.stateType !== 'global' || statePda.toBase58() === r.state, vaultPdaMatches: vault.equals(r.vault), tokenAuthorityIsVaultPda: t.authority === r.vault.toBase58(), tokenMintMatches: t.mint === r.mint.toBase58(), bumpObserved: bump } };
  }).filter(Boolean);
  return { name: 'Manifest', program: program.toBase58(), marketDiscovery: markets, globalDiscovery: globals, rows };
}

async function scanLegacyDex(name, programAddress) {
  const program = new PublicKey(programAddress);
  const found = await discover(program, [{ dataSize: 388 }]);
  const states = found.live.filter(x => {
    const d = x.info.data;
    return d.length === 388 && (d.readBigUInt64LE(5) & 3n) === 3n && pk(d.subarray(13, 45)) === x.address;
  }).map(x => {
    const d = x.info.data;
    return { address: x.address, nonce: d.readBigUInt64LE(45), baseMint: new PublicKey(d.subarray(53, 85)), quoteMint: new PublicKey(d.subarray(85, 117)), baseVault: new PublicKey(d.subarray(117, 149)), quoteVault: new PublicKey(d.subarray(165, 197)) };
  });
  const infos = await fetchInfos(states.flatMap(x => [x.baseVault.toBase58(), x.quoteVault.toBase58()]));
  const rows = [];
  for (let i = 0; i < states.length; i++) {
    const s = states[i]; let signer = null;
    try { signer = PublicKey.createProgramAddressSync([new PublicKey(s.address).toBuffer(), le(s.nonce, 8)], program); } catch (_) {}
    for (const [j, side] of [[0, 'base'], [1, 'quote']]) {
      const mint = s[`${side}Mint`], vault = s[`${side}Vault`], t = tokenAccount(vault.toBase58(), infos[i * 2 + j]); if (!t) continue;
      rows.push({ family: name, program: program.toBase58(), state: s.address, kind: side, ...t, proof: { stateOwnedByProgram: true, initializedMarketFlags: true, ownAddressMatches: true, stateReferenceMatches: true, vaultSignerPdaDerived: !!signer, tokenAuthorityMatches: !!signer && t.authority === signer.toBase58(), tokenMintMatches: t.mint === mint.toBase58() } });
    }
  }
  return { name, program: program.toBase58(), discovery: found, stateAccountsDecoded: states.length, rows };
}

function blockedLegacyDex(name, program) {
  return {
    name,
    program,
    status: 'blocked',
    blocker: 'Flux getProgramAccounts did not complete within bounded attempts: a dataSize=388 pubkey-only request transferred 66,543,259 bytes before a 45-second timeout; adding the exact initialized-market flag transferred 43,467,936 bytes before 45 seconds. The provider returned full account payloads despite dataSlice length 0. No partial JSON was accepted.',
    rows: [],
  };
}

async function scanMangoV4() {
  const program = new PublicKey('4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg');
  const banksFound = await discover(program, [{ memcmp: { offset: 0, bytes: bs58.encode(disc('account:Bank')) } }]);
  await sleep(700);
  const groupsFound = await discover(program, [{ memcmp: { offset: 0, bytes: bs58.encode(disc('account:Group')) } }]);
  const refs = [];
  for (const x of banksFound.live) {
    const d = x.info.data; if (d.length < 120) continue;
    const group = new PublicKey(d.subarray(8, 40)), mint = new PublicKey(d.subarray(56, 88)), vault = new PublicKey(d.subarray(88, 120));
    let seedMatch = null;
    for (let tokenIndex = 0; tokenIndex < 256 && !seedMatch; tokenIndex++) for (let bankNum = 0; bankNum < 16; bankNum++) {
      const [candidate] = PublicKey.findProgramAddressSync([Buffer.from('Vault'), group.toBuffer(), le(tokenIndex, 2), le(bankNum, 4)], program);
      if (candidate.equals(vault)) { seedMatch = { tokenIndex, bankNum }; break; }
    }
    refs.push({ kind: 'bank', state: x.address, group, mint, vault, seedMatch });
  }
  for (const x of groupsFound.live) {
    const d = x.info.data; if (d.length < 176) continue;
    refs.push({ kind: 'insurance', state: x.address, group: new PublicKey(x.address), mint: new PublicKey(d.subarray(144, 176)), vault: new PublicKey(d.subarray(112, 144)) });
  }
  const infos = await fetchInfos(refs.map(x => x.vault.toBase58()));
  const rows = refs.map((r, i) => {
    const t = tokenAccount(r.vault.toBase58(), infos[i]); if (!t) return null;
    let derived = [];
    if (r.kind === 'bank') derived = r.seedMatch ? [r.vault] : [];
    else derived = [PublicKey.findProgramAddressSync([Buffer.from('InsuranceVault'), r.group.toBuffer()], program)[0], PublicKey.findProgramAddressSync([Buffer.from('InsuranceVault'), r.group.toBuffer(), r.mint.toBuffer()], program)[0]];
    return { family: 'Mango v4', program: program.toBase58(), state: r.state, kind: r.kind, ...t, proof: { stateOwnedByProgram: true, stateReferenceMatches: true, vaultPdaMatches: derived.some(x => x.equals(r.vault)), tokenAuthorityIsGroupPda: t.authority === r.group.toBase58(), tokenMintMatches: t.mint === r.mint.toBase58() } };
  }).filter(Boolean);
  return { name: 'Mango v4', program: program.toBase58(), bankDiscovery: banksFound, groupDiscovery: groupsFound, rows };
}

async function scanMangoV3() {
  const program = new PublicKey('mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68');
  const groups = await discover(program, [{ dataSize: 6032 }, { memcmp: { offset: 0, bytes: bs58.encode(Buffer.from([0, 0, 1, 0, 0, 0, 0, 0])) } }]);
  const refs = [], rootRefs = [];
  for (const x of groups.live) {
    const d = x.info.data; if (d.length !== 6032) continue;
    const nonce = d.readBigUInt64LE(5728), storedSigner = new PublicKey(d.subarray(5736, 5768));
    let signer = null; try { signer = PublicKey.createProgramAddressSync([new PublicKey(x.address).toBuffer(), le(nonce, 8)], program); } catch (_) {}
    for (let i = 0; i < 16; i++) { const o = 16 + i * 72, mint = new PublicKey(d.subarray(o, o + 32)), root = new PublicKey(d.subarray(o + 32, o + 64)); if (!root.equals(ZERO)) rootRefs.push({ group: x.address, signer, storedSigner, mint, root: root.toBase58() }); }
    for (const [kind, o] of [['insurance', 5872], ['srm', 5904], ['msrm', 5936], ['fees', 5968]]) { const vault = new PublicKey(d.subarray(o, o + 32)); if (!vault.equals(ZERO)) refs.push({ kind, state: x.address, group: x.address, signer, storedSigner, vault }); }
  }
  const rootInfos = await fetchInfos(rootRefs.map(x => x.root));
  const nodeRefs = [];
  for (let i = 0; i < rootRefs.length; i++) { const r = rootRefs[i], info = rootInfos[i]; if (!info || !info.owner.equals(program) || info.data.length !== 424 || info.data[0] !== 2 || info.data[2] !== 1) continue; const n = Math.min(Number(info.data.readBigUInt64LE(56)), 8); for (let j = 0; j < n; j++) { const node = new PublicKey(info.data.subarray(64 + j * 32, 96 + j * 32)); if (!node.equals(ZERO)) nodeRefs.push({ ...r, node: node.toBase58() }); } }
  const nodeInfos = await fetchInfos(nodeRefs.map(x => x.node));
  for (let i = 0; i < nodeRefs.length; i++) { const r = nodeRefs[i], info = nodeInfos[i]; if (!info || !info.owner.equals(program) || info.data.length !== 72 || info.data[0] !== 3 || info.data[2] !== 1) continue; refs.push({ kind: 'node-bank', state: r.node, group: r.group, signer: r.signer, storedSigner: r.storedSigner, mint: r.mint, vault: new PublicKey(info.data.subarray(40, 72)), root: r.root }); }
  const infos = await fetchInfos(refs.map(x => x.vault.toBase58()));
  const rows = refs.map((r, i) => { const t = tokenAccount(r.vault.toBase58(), infos[i]); if (!t) return null; return { family: 'Mango v3 legacy', program: program.toBase58(), state: r.state, kind: r.kind, root: r.root, ...t, proof: { stateOwnedByProgram: true, reachableFromGroup: true, stateReferenceMatches: true, storedSignerMatchesDerived: !!r.signer && r.signer.equals(r.storedSigner), tokenAuthorityMatchesGroupSigner: !!r.signer && t.authority === r.signer.toBase58(), tokenMintMatches: !r.mint || t.mint === r.mint.toBase58() } }; }).filter(Boolean);
  return { name: 'Mango v3 legacy', program: program.toBase58(), groupDiscovery: groups, reachableRootBanks: rootRefs.length, reachableNodeBanks: nodeRefs.length, rows };
}

async function scanPhoenixPerps() {
  const program = new PublicKey('EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih');
  const global = new PublicKey('2zskx2iyCvb6Stg7RBZkt1f6MrF4dpYtMG3yMvKwqtUZ');
  const globalInfo = await current.getAccountInfo(global, 'confirmed');
  const mint = new PublicKey(globalInfo.data.subarray(296, 328)), vault = new PublicKey(globalInfo.data.subarray(328, 360));
  const [derivedGlobal] = PublicKey.findProgramAddressSync([Buffer.from('global')], program);
  const [derivedVault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), mint.toBuffer()], program);
  const t = tokenAccount(vault.toBase58(), await current.getAccountInfo(vault, 'confirmed'));
  return { name: 'Phoenix Perpetuals', program: program.toBase58(), rows: t ? [{ family: 'Phoenix Perpetuals', program: program.toBase58(), state: global.toBase58(), kind: 'global-quote-vault', ...t, proof: { stateOwnedByProgram: globalInfo.owner.equals(program), globalStatePdaMatches: derivedGlobal.equals(global), stateReferenceMatches: true, vaultPdaMatches: derivedVault.equals(vault), tokenAuthorityIsVaultPda: t.authority === vault.toBase58(), tokenMintMatches: t.mint === mint.toBase58() } }] : [] };
}

async function scanEmber() {
  const phoenix = new PublicKey('EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih'), program = new PublicKey('EMBERpYNE6ehWmXymZZS2skiFmCa9V5dp14e1iduM5qy');
  const [state] = PublicKey.findProgramAddressSync([phoenix.toBuffer(), Buffer.from('state')], program), [vault] = PublicKey.findProgramAddressSync([phoenix.toBuffer(), Buffer.from('vault')], program);
  const [stateInfo, vaultInfo] = await current.getMultipleAccountsInfo([state, vault], 'confirmed');
  const t = tokenAccount(vault.toBase58(), vaultInfo);
  return { name: 'Ember (Phoenix Perps backing)', program: program.toBase58(), rows: t ? [{ family: 'Ember (Phoenix Perps backing)', program: program.toBase58(), state: state.toBase58(), kind: 'USDC-backing-vault', ...t, proof: { stateOwnedByProgram: stateInfo?.owner.equals(program) || false, statePdaMatches: true, vaultPdaMatches: true, tokenAuthorityIsStatePda: t.authority === state.toBase58(), tokenMintIsUSDC: t.mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } }] : [] };
}

function valid(row) { return row.rawAmount !== '0' && Object.entries(row.proof).filter(([k]) => !k.endsWith('Observed')).every(([, v]) => v === true); }

async function value(results) {
  const rows = results.flatMap(r => r.rows || []), mints = [...new Set(rows.filter(valid).map(r => r.mint))], prices = {};
  for (let i = 0; i < mints.length; i += 80) { const ids = mints.slice(i, i + 80).map(m => `solana:${m}`).join(','); const q = await fetch(`https://coins.llama.fi/prices/current/${ids}`); if (q.ok) Object.assign(prices, (await q.json()).coins || {}); await sleep(250); }
  for (const row of rows) { row.controlVerified = valid(row); if (!row.controlVerified) continue; const p = prices[`solana:${row.mint}`]; if (!p) continue; const amount = Number(row.rawAmount) / 10 ** p.decimals; row.valuation = { amount, symbol: p.symbol, usdPrice: p.price, usdValue: amount * p.price, priceTimestamp: p.timestamp }; }
  for (const r of results) { const verified = (r.rows || []).filter(x => x.controlVerified); r.summary = { referencedVaultRows: (r.rows || []).length, verifiedNonzeroVaults: verified.length, pricedVaults: verified.filter(x => x.valuation).length, unpricedVaults: verified.filter(x => !x.valuation).length, pricedGrossUsd: verified.reduce((s, x) => s + (x.valuation?.usdValue || 0), 0) }; delete r.discovery?.live; delete r.marketDiscovery?.live; delete r.globalDiscovery?.live; delete r.bankDiscovery?.live; delete r.groupDiscovery?.live; }
}

(async () => {
  if (!process.env.SOLANA_RPC || !process.env.HEAVY_RPC) throw new Error('SOLANA_RPC and HEAVY_RPC are required');
  const slots = { fluxStart: await heavy.getSlot('confirmed'), currentStart: await current.getSlot('confirmed') };
  const results = [];
  for (const f of [scanPhoenixPerps, scanEmber, scanOpenBookV2, scanPhoenixLegacy, scanManifest,
    () => blockedLegacyDex('OpenBook v1', 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX'),
    () => blockedLegacyDex('Serum DEX v3 legacy', '9xQeWvG816bUx9EPjHmaT23yvVM4t4DkH2c1v6pDNfN'),
    scanMangoV4, scanMangoV3]) {
    const row = await f();
    if (!row.status) row.status = 'completed';
    results.push(row);
    console.error(`completed ${row.name}`);
    await sleep(650);
  }
  await value(results);
  slots.currentEnd = await current.getSlot('confirmed'); slots.fluxEnd = await heavy.getSlot('confirmed');
  const out = { timestamp: new Date().toISOString(), slots, denominator: { programDeploymentsAttempted: results.length, programDeploymentsCompleted: results.filter(x => x.status === 'completed').length, programDeploymentsBlocked: results.filter(x => x.status === 'blocked').length, names: results.map(x => `${x.name} (${x.program})`) }, overlapWarning: 'Phoenix Perpetuals PhUsd is a claim on the separate Ember USDC backing vault; do not add both rows.', results };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ path: OUT, slots, ranking: results.map(r => ({ name: r.name, program: r.program, ...r.summary })).sort((a, b) => b.pricedGrossUsd - a.pricedGrossUsd) }, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
