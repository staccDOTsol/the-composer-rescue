// Read-only current validation of every market in the official OpenBook v1 and
// Serum v3 registries. Registry size is the explicit denominator.
const fs = require('fs');
const MODULES = '/Users/stacc/Documents/Codex/2026-09-11/uhmm-i-want-frost-enabled-wallets/outputs/frost-snap/node_modules';
const {Connection, PublicKey} = require(`${MODULES}/@solana/web3.js`);
const conn = new Connection(process.env.SOLANA_RPC, 'confirmed');
const token = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const token22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const openbookRegistry = 'https://raw.githubusercontent.com/openbook-dex/resources/main/markets.json';
const serumRegistry = 'https://raw.githubusercontent.com/project-serum/serum-ts/master/packages/serum/src/markets.json';
const le8 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchInfos(addresses) {
  const out = [];
  for (let i = 0; i < addresses.length; i += 80) {
    out.push(...await conn.getMultipleAccountsInfo(addresses.slice(i, i + 80).map(x => new PublicKey(x)), 'confirmed'));
    await sleep(180);
  }
  return out;
}
function tokenAccount(address, info) {
  if (!info || info.data.length < 72 || ![token, token22].includes(info.owner.toBase58())) return null;
  return {vault: address, mint: new PublicKey(info.data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(info.data.subarray(32, 64)).toBase58(), rawAmount: info.data.readBigUInt64LE(64).toString(),
    tokenProgram: info.owner.toBase58()};
}
async function scan(name, programString, registryUrl) {
  const registryResponse = await fetch(registryUrl); if (!registryResponse.ok) throw new Error(`${registryUrl}: ${registryResponse.status}`);
  const registryAll = await registryResponse.json();
  const registry = registryAll.filter(row => row.programId === programString);
  const stateInfos = await fetchInfos(registry.map(x => x.address));
  const program = new PublicKey(programString), states = [], unavailable = [];
  for (let i = 0; i < registry.length; i++) {
    const listed = registry[i], info = stateInfos[i];
    if (!info || !info.owner.equals(program) || info.data.length !== 388) {
      unavailable.push({address: listed.address, name: listed.name, deprecated: listed.deprecated,
        reason: !info ? 'missing' : `owner=${info.owner.toBase58()} length=${info.data.length}`});
      continue;
    }
    const data = info.data, flags = Number(data.readBigUInt64LE(5));
    if ((flags & 3) !== 3 || new PublicKey(data.subarray(13, 45)).toBase58() !== listed.address) {
      unavailable.push({address: listed.address, name: listed.name, deprecated: listed.deprecated, reason: `invalid market header flags=${flags}`});
      continue;
    }
    states.push({address: listed.address, name: listed.name, deprecated: listed.deprecated, flags,
      nonce: data.readBigUInt64LE(45), baseMint: new PublicKey(data.subarray(53, 85)),
      quoteMint: new PublicKey(data.subarray(85, 117)), baseVault: new PublicKey(data.subarray(117, 149)),
      quoteVault: new PublicKey(data.subarray(165, 197))});
  }
  const vaultInfos = await fetchInfos(states.flatMap(x => [x.baseVault.toBase58(), x.quoteVault.toBase58()]));
  const rows = [];
  for (let i = 0; i < states.length; i++) {
    const state = states[i]; let signer = null;
    try { signer = PublicKey.createProgramAddressSync([new PublicKey(state.address).toBuffer(), le8(state.nonce)], program); } catch (_) {}
    for (const [j, side] of [[0, 'base'], [1, 'quote']]) {
      const mint = state[`${side}Mint`], vault = state[`${side}Vault`], account = tokenAccount(vault.toBase58(), vaultInfos[i * 2 + j]);
      if (!account) continue;
      const verified = !!signer && account.authority === signer.toBase58() && account.mint === mint.toBase58();
      rows.push({market: state.name, deprecated: state.deprecated, state: state.address, flags: state.flags, side,
        ...account, proof: {stateOwner: true, ownAddressMatches: true, signerPdaDerived: !!signer,
          tokenAuthorityMatches: !!signer && account.authority === signer.toBase58(), tokenMintMatches: account.mint === mint.toBase58()}, verified});
    }
  }
  const verifiedNonzero = rows.filter(x => x.verified && x.rawAmount !== '0'), prices = {}, mints = [...new Set(verifiedNonzero.map(x => x.mint))];
  for (let i = 0; i < mints.length; i += 80) {
    const ids = mints.slice(i, i + 80).map(x => `solana:${x}`).join(','), response = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
    if (response.ok) Object.assign(prices, (await response.json()).coins || {});
  }
  for (const row of verifiedNonzero) {
    const price = prices[`solana:${row.mint}`];
    if (price) row.valuation = {amount: Number(row.rawAmount) / 10 ** price.decimals, symbol: price.symbol,
      usdPrice: price.price, usdValue: Number(row.rawAmount) / 10 ** price.decimals * price.price, priceTimestamp: price.timestamp};
  }
  return {name, program: programString, registryUrl, registryEntries: registry.length,
    registryDeprecatedEntries: registry.filter(x => x.deprecated).length, currentDecodedMarkets: states.length,
    unavailable, referencedVaults: rows.length, verifiedNonzeroVaults: verifiedNonzero.length,
    pricedVaults: verifiedNonzero.filter(x => x.valuation).length, unpricedVaults: verifiedNonzero.filter(x => !x.valuation).length,
    pricedGrossUsd: verifiedNonzero.reduce((sum, x) => sum + (x.valuation?.usdValue || 0), 0), rows: verifiedNonzero};
}
(async () => {
  const slotStart = await conn.getSlot('confirmed');
  const results = [];
  for (const args of [['OpenBook v1', 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX', openbookRegistry],
    ['Serum DEX v3 legacy', '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', serumRegistry]]) {
    results.push(await scan(...args)); console.error(`completed ${args[0]}`);
  }
  const out = {timestamp: new Date().toISOString(), slotStart, slotEnd: await conn.getSlot('confirmed'),
    denominator: {registryEntries: results.reduce((sum, x) => sum + x.registryEntries, 0),
      registryScope: 'Every market address attributed to the selected mainnet program ID in each official first-party registry; not every account ever created under either program.'}, results};
  fs.writeFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/legacy-dex-official-registry.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({timestamp: out.timestamp, slotStart, slotEnd: out.slotEnd,
    results: results.map(x => ({name: x.name, program: x.program, registryEntries: x.registryEntries,
      currentDecodedMarkets: x.currentDecodedMarkets, unavailable: x.unavailable.length,
      verifiedNonzeroVaults: x.verifiedNonzeroVaults, pricedVaults: x.pricedVaults,
      unpricedVaults: x.unpricedVaults, pricedGrossUsd: x.pricedGrossUsd}))}, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
