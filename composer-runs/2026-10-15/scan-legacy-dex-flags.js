// Bounded legacy Serum/OpenBook market census by every defined market-flag
// combination. This avoids unbounded program-account payloads from accounts
// that merely share the legacy 388-byte allocation.
const fs = require('fs');
const MODULES = '/Users/stacc/Documents/Codex/2026-09-11/uhmm-i-want-frost-enabled-wallets/outputs/frost-snap/node_modules';
const {Connection, PublicKey} = require(`${MODULES}/@solana/web3.js`);
const b = require(`${MODULES}/bs58`); const bs58 = b.default || b;
const current = new Connection(process.env.SOLANA_RPC, 'confirmed');
const token = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const token22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const le8 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };

const definedOptionalFlags = [128, 256, 512, 1024]; // Disabled, Closed, Permissioned, CrankAuthorityRequired.
const flagValues = Array.from({length: 16}, (_, mask) => 3 + definedOptionalFlags.reduce((sum, bit, i) => sum + ((mask >> i) & 1 ? bit : 0), 0));
async function rawFlagScan(program) {
  const countsByFlags = [], keys = new Set(), slots = []; let responseBytes = 0;
  for (const flags of flagValues) {
    let paginationKey, flagCount = 0, pages = 0;
    do {
      const config = {commitment: 'confirmed', encoding: 'base64', withContext: true, limit: 1000,
        filters: [{dataSize: 388}, {memcmp: {offset: 5, bytes: bs58.encode(le8(flags))}}],
        dataSlice: {offset: 0, length: 0}};
      if (paginationKey) config.paginationKey = paginationKey;
      const payload = {jsonrpc: '2.0', id: pages, method: 'getProgramAccountsV2', params: [program, config]};
      const response = await fetch(process.env.SOLANA_RPC, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000)});
      const body = await response.text(); responseBytes += Buffer.byteLength(body);
      const row = JSON.parse(body);
      if (row?.error) throw new Error(`${program} flags ${flags}: ${JSON.stringify(row.error)}`);
      const page = row?.result?.value;
      if (row?.result?.context?.slot) slots.push(row.result.context.slot);
      for (const account of page?.accounts || []) { keys.add(account.pubkey); flagCount++; }
      paginationKey = page?.paginationKey || null;
      pages++;
      if (pages > 100) throw new Error(`${program} flags ${flags}: page bound exceeded`);
      await sleep(250);
    } while (paginationKey);
    countsByFlags.push({flags, count: flagCount, pages});
  }
  return {provider: 'current Helius getProgramAccountsV2 fallback after Flux getProgramAccounts response-volume failure',
    countsByFlags, keys: [...keys], snapshotSlots: [...new Set(slots)], responseBytes};
}
async function infos(addresses) {
  const out = [];
  for (let i = 0; i < addresses.length; i += 80) {
    out.push(...await current.getMultipleAccountsInfo(addresses.slice(i, i + 80).map(x => new PublicKey(x)), 'confirmed'));
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
async function scan(name, programString) {
  const program = new PublicKey(programString), discovery = await rawFlagScan(programString);
  const stateInfos = await infos(discovery.keys), states = [];
  for (let i = 0; i < discovery.keys.length; i++) {
    const info = stateInfos[i], address = discovery.keys[i];
    if (!info || !info.owner.equals(program) || info.data.length !== 388) continue;
    const data = info.data, flags = Number(data.readBigUInt64LE(5));
    if ((flags & 3) !== 3 || new PublicKey(data.subarray(13, 45)).toBase58() !== address) continue;
    states.push({address, flags, nonce: data.readBigUInt64LE(45),
      baseMint: new PublicKey(data.subarray(53, 85)), quoteMint: new PublicKey(data.subarray(85, 117)),
      baseVault: new PublicKey(data.subarray(117, 149)), quoteVault: new PublicKey(data.subarray(165, 197))});
  }
  const vaultInfos = await infos(states.flatMap(x => [x.baseVault.toBase58(), x.quoteVault.toBase58()]));
  const rows = [];
  for (let i = 0; i < states.length; i++) {
    const state = states[i]; let signer = null;
    try { signer = PublicKey.createProgramAddressSync([new PublicKey(state.address).toBuffer(), le8(state.nonce)], program); } catch (_) {}
    for (const [j, side] of [[0, 'base'], [1, 'quote']]) {
      const mint = state[`${side}Mint`], vault = state[`${side}Vault`], account = tokenAccount(vault.toBase58(), vaultInfos[i * 2 + j]);
      if (!account) continue;
      const verified = !!signer && account.authority === signer.toBase58() && account.mint === mint.toBase58();
      rows.push({state: state.address, flags: state.flags, side, ...account, verified});
    }
  }
  const verifiedNonzero = rows.filter(x => x.verified && x.rawAmount !== '0'), mints = [...new Set(verifiedNonzero.map(x => x.mint))], prices = {};
  for (let i = 0; i < mints.length; i += 80) {
    const ids = mints.slice(i, i + 80).map(x => `solana:${x}`).join(',');
    const response = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
    if (response.ok) Object.assign(prices, (await response.json()).coins || {});
  }
  for (const row of verifiedNonzero) {
    const price = prices[`solana:${row.mint}`];
    if (price) row.valuation = {amount: Number(row.rawAmount) / 10 ** price.decimals, symbol: price.symbol,
      usdPrice: price.price, usdValue: Number(row.rawAmount) / 10 ** price.decimals * price.price, priceTimestamp: price.timestamp};
  }
  return {name, program: programString, discovery: {...discovery, keys: undefined}, decodedMarkets: states.length,
    referencedVaults: rows.length, verifiedNonzeroVaults: verifiedNonzero.length,
    pricedVaults: verifiedNonzero.filter(x => x.valuation).length, unpricedVaults: verifiedNonzero.filter(x => !x.valuation).length,
    pricedGrossUsd: verifiedNonzero.reduce((sum, x) => sum + (x.valuation?.usdValue || 0), 0),
    rows: verifiedNonzero.sort((a, b) => (b.valuation?.usdValue || 0) - (a.valuation?.usdValue || 0))};
}

(async () => {
  const slotStart = await current.getSlot('confirmed');
  const results = [];
  for (const [name, program] of [['OpenBook v1', 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX'],
    ['Serum DEX v3 legacy', '9xQeWvG816bUx9EPjHmaT23yvVM4t4DkH2c1v6pDNfN']]) {
    results.push(await scan(name, program)); console.error(`completed ${name}`); await sleep(700);
  }
  const out = {timestamp: new Date().toISOString(), slotStart, slotEnd: await current.getSlot('confirmed'),
    denominator: {programs: 2, exactFlagCombinationsPerProgram: flagValues.length,
      flagsEnumerated: flagValues, baseRequired: ['Initialized', 'Market'], optionalEnumerated: ['Disabled', 'Closed', 'Permissioned', 'CrankAuthorityRequired'],
      caveat: 'This is exhaustive over the defined legacy Market account-flag bit combinations, not over unknown future flag bits.'}, results};
  fs.writeFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/legacy-dex-flag-census.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
