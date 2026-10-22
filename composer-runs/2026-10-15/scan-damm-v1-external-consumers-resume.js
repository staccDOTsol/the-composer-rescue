#!/usr/bin/env node
// Read-only current-mainnet cross-reference for permissionless consumers of DAMM-v1 LP/spot state.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bs58m = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58m.default || bs58m;
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {BorshCoder} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');

const root = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/';
const outputPath = root + 'damm-v1-external-consumer-census-resume.json';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(x => x && !x.startsWith('#'))
  .map(x => x.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const DAMM = 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB';
const ALPHA = 'vaU6kP7iNEGkbmPkLmZfGwiGxd4Mob24QQCie5R9kd2';
const DYNAMIC_VAULT = '24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi';
const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const SAVE = 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo';
const P0 = 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA';
const KVAULT = 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd';
const WSOL = 'So11111111111111111111111111111111111111112';
const dammDisc = Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]);
const reserveDisc = crypto.createHash('sha256').update('account:Reserve').digest().subarray(0, 8);
const alphaDisc = Buffer.from([211, 8, 232, 43, 2, 152, 117, 119]);
const dynamicVaultDisc = crypto.createHash('sha256').update('account:Vault').digest().subarray(0, 8);
const alphaIdl = JSON.parse(fs.readFileSync('/tmp/damm-v1-alpha-15W3I8/alpha-vault-sdk/idls/alpha_vault.json'));
const dammIdl = JSON.parse(fs.readFileSync(root + 'damm-v1-sdk-2.0.0-resume.idl.json'));
const alphaCoder = new BorshCoder(alphaIdl), dammCoder = new BorshCoder(dammIdl);

async function rpc(method, params, attempts = 5) {
  for (let n = 1; n <= attempts; n++) {
    const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: method, method, params})});
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      if (json.error) throw new Error(JSON.stringify(json.error));
      return json.result;
    } catch (e) {
      if (n === attempts) throw new Error(`${method}: ${text.slice(0, 300)}`);
      await new Promise(resolve => setTimeout(resolve, n * 500));
    }
  }
}
async function gpa(program, filters, dataSlice) {
  return rpc('getProgramAccounts', [program, {encoding: 'base64', commitment: 'confirmed',
    withContext: true, filters, ...(dataSlice ? {dataSlice} : {})}]);
}
async function multi(keys, slots) {
  const out = [];
  for (let i = 0; i < keys.length; i += 100) {
    const page = await rpc('getMultipleAccounts', [keys.slice(i, i + 100),
      {encoding: 'base64', commitment: 'confirmed'}]);
    slots.push(page.context.slot); out.push(...page.value);
  }
  return out;
}
const pk = (data, offset) => bs58.encode(data.subarray(offset, offset + 32));
const raw = account => Buffer.from(account.data[0], 'base64');
const min = (a, b) => a < b ? a : b;

function matchesFor(label, rows, poolByLp) {
  const matches = [];
  for (const row of rows) {
    const pools = poolByLp.get(row.mint);
    if (pools) for (const pool of pools) matches.push({...row, pools: [pool]});
  }
  return {label, testedRows: rows.length, uniqueMints: new Set(rows.map(x => x.mint)).size,
    matchedRows: matches.length, matchedPools: new Set(matches.flatMap(x => x.pools)).size, matches};
}
function walkSo(dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') walkSo(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.so')) out.push(full);
  }
  return out;
}
function embeddedIdScan() {
  const needle = new PublicKey(DAMM).toBuffer(), matches = [], files = walkSo(root);
  for (const file of files) {
    const data = fs.readFileSync(file), offsets = [];
    for (let from = 0;;) {
      const at = data.indexOf(needle, from); if (at < 0) break;
      offsets.push(at); from = at + 1;
    }
    if (offsets.length) matches.push({file: path.relative(root, file), offsets,
      sha256: crypto.createHash('sha256').update(data).digest('hex'), bytes: data.length});
  }
  return {filesScanned: files.length, needle: DAMM, matchedFiles: matches.length, matches};
}

async function main() {
  const slots = [];
  const poolsPage = await gpa(DAMM, [{dataSize: 952},
    {memcmp: {offset: 0, bytes: bs58.encode(dammDisc)}}], {offset: 0, length: 104});
  slots.push(poolsPage.context.slot);
  const pools = poolsPage.value.map(x => {
    const d = raw(x.account);
    return {pool: x.pubkey, lpMint: pk(d, 8), tokenAMint: pk(d, 40), tokenBMint: pk(d, 72)};
  });
  const poolByLp = new Map();
  for (const p of pools) {
    if (!poolByLp.has(p.lpMint)) poolByLp.set(p.lpMint, []);
    poolByLp.get(p.lpMint).push(p.pool);
  }

  const klendPage = await gpa(KLEND, [{dataSize: 8624},
    {memcmp: {offset: 0, bytes: bs58.encode(reserveDisc)}}], {offset: 128, length: 32});
  slots.push(klendPage.context.slot);
  const klendRows = klendPage.value.map(x => ({account: x.pubkey, mint: pk(raw(x.account), 0)}));

  const savePage = await gpa(SAVE, [{dataSize: 619}], {offset: 42, length: 32});
  slots.push(savePage.context.slot);
  const saveRows = savePage.value.map(x => ({account: x.pubkey, mint: pk(raw(x.account), 0)}));

  const marginfiLocal = JSON.parse(fs.readFileSync(root + 'marginfi-vaults-current.json'));
  const marginfiSeed = marginfiLocal.rows.filter(x => x.kind === 'liquidity');
  const marginfiAccounts = await multi(marginfiSeed.map(x => x.address), slots);
  const marginfiRows = marginfiSeed.map((x, i) => {
    const d = marginfiAccounts[i] && raw(marginfiAccounts[i]);
    return {bank: x.bank, account: x.address, mint: d?.length >= 32 ? pk(d, 0) : null,
      currentTokenAccountValid: !!d && (d.length === 165 || d.length > 165)};
  }).filter(x => x.mint);

  const kvaultLocal = JSON.parse(fs.readFileSync(root + 'kvault-idle-pda-census.json'));
  const kvaultAccounts = await multi(kvaultLocal.rows.map(x => x.tokenVault), slots);
  const kvaultRows = kvaultLocal.rows.map((x, i) => {
    const d = kvaultAccounts[i] && raw(kvaultAccounts[i]);
    return {state: x.state, account: x.tokenVault, mint: d?.length >= 32 ? pk(d, 0) : null,
      currentTokenAccountValid: !!d && (d.length === 165 || d.length > 165)};
  }).filter(x => x.mint);

  let dynamicVaultResult, dynamicVaultRows = [], dammLpWrappers = [];
  try {
    // Vault.token_mint starts at 83: discriminator(8)+enabled(1)+two bumps(2)+
    // total_amount(8)+token_vault(32)+fee_vault(32).
    const page = await gpa(DYNAMIC_VAULT,
      [{memcmp: {offset: 0, bytes: bs58.encode(dynamicVaultDisc)}}], {offset: 83, length: 32});
    slots.push(page.context.slot);
    dynamicVaultRows = page.value.map(x => ({account: x.pubkey, mint: pk(raw(x.account), 0)}));
    dynamicVaultResult = matchesFor('Meteora Dynamic Vault underlying mint', dynamicVaultRows, poolByLp);
    dynamicVaultResult.slot = page.context.slot;
    const matchedAccounts = await multi(dynamicVaultResult.matches.map(x => x.account), slots);
    dammLpWrappers = dynamicVaultResult.matches.map((x, i) => {
      const state = dammCoder.accounts.decode('Vault', raw(matchedAccounts[i]));
      return {vault: x.account, dammLpMint: x.mint, dammPools: x.pools,
        wrapperLpMint: state.lp_mint.toBase58(), totalUnderlyingDammLpRaw: state.total_amount.toString(),
        wrapperLpSupplyRaw: state.total_lp_supply.toString(), enabled: state.enabled,
        nonzeroStrategies: state.strategies.filter(p =>
          p.toBase58() !== '11111111111111111111111111111111').map(p => p.toBase58())};
    });
  } catch (e) {
    dynamicVaultResult = {label: 'Meteora Dynamic Vault underlying mint', complete: false,
      blocker: e.message, testedRows: 0, matchedRows: null};
  }

  const alphaPage = await gpa(ALPHA, [{dataSize: 472},
    {memcmp: {offset: 0, bytes: bs58.encode(alphaDisc)}}]);
  slots.push(alphaPage.context.slot);
  const alphaAll = alphaPage.value.map(x => ({key: x.pubkey,
    state: alphaCoder.accounts.decode('Vault', raw(x.account))}));
  const alphaDamm = alphaAll.filter(x => x.state.pool_type === 1);
  const alphaPoolAccounts = await multi(alphaDamm.map(x => x.state.pool.toBase58()), slots);
  const currentSlot = await rpc('getSlot', [{commitment: 'confirmed'}]);
  const currentTime = await rpc('getBlockTime', [currentSlot]);
  const alphaRows = alphaDamm.map((x, i) => {
    const s = x.state, total = BigInt(s.total_deposit.toString()), swapped = BigInt(s.swapped_amount.toString()),
      cap = BigInt(s.max_buying_cap.toString()), target = s.vault_mode === 0 ? min(total, cap) : total,
      remaining = target > swapped ? target - swapped : 0n;
    const p = alphaPoolAccounts[i] && dammCoder.accounts.decode('Pool', raw(alphaPoolAccounts[i]));
    const activation = p && BigInt(p.bootstrapping.activation_point.toString());
    const beforeActivation = p ? (s.activation_type === 0 ? BigInt(currentSlot) < activation : BigInt(currentTime) < activation) : null;
    return {alphaVault: x.key, pool: s.pool.toBase58(), poolEnabled: p?.enabled ?? null,
      quoteMint: s.quote_mint.toBase58(), baseMint: s.base_mint.toBase58(), vaultMode: s.vault_mode,
      maxBuyingCapRaw: cap.toString(), totalDepositRaw: total.toString(), swappedAmountRaw: swapped.toString(),
      actualRemainingCapacityRaw: remaining.toString(), activationType: s.activation_type,
      activationPoint: activation?.toString() || null, beforeActivation};
  });
  const actualRemaining = alphaRows.filter(x => BigInt(x.actualRemainingCapacityRaw) > 0n);
  const lifecycleFuture = actualRemaining.filter(x => x.beforeActivation);
  const currentKlendMints = new Set(klendRows.map(x => x.mint));
  const currentP0Mints = new Set(marginfiRows.map(x => x.mint));

  const consumers = [
    matchesFor('KLend reserve liquidity mint', klendRows, poolByLp),
    matchesFor('Save reserve liquidity mint', saveRows, poolByLp),
    matchesFor('Marginfi/Project 0 bank liquidity mint', marginfiRows, poolByLp),
    matchesFor('Kamino Liquidity vault underlying mint', kvaultRows, poolByLp),
    dynamicVaultResult,
  ];
  const wrapperByMint = new Map(dammLpWrappers.map(x => [x.wrapperLpMint, [x.vault]]));
  const wrapperConsumers = wrapperByMint.size ? [
    matchesFor('KLend reserve liquidity mint', klendRows, wrapperByMint),
    matchesFor('Save reserve liquidity mint', saveRows, wrapperByMint),
    matchesFor('Marginfi/Project 0 bank liquidity mint', marginfiRows, wrapperByMint),
    matchesFor('Kamino Liquidity vault underlying mint', kvaultRows, wrapperByMint),
    matchesFor('Meteora Dynamic Vault underlying mint', dynamicVaultRows, wrapperByMint),
  ] : [];
  const output = {generatedAt: new Date().toISOString(), readOnly: true,
    method: 'current getProgramAccounts/getMultipleAccounts cross-reference; local binaries scanned by raw 32-byte program id',
    observedSlots: {min: Math.min(...slots), max: Math.max(...slots), currentSlot, currentUnixTimestamp: currentTime},
    dammPools: {listed: pools.length, uniqueLpMints: poolByLp.size, discriminatorHex: dammDisc.toString('hex'),
      accountSize: 952, offsets: {lpMint: 8, tokenAMint: 40, tokenBMint: 72}},
    consumers, dammLpWrappers: {count: dammLpWrappers.length, rows: dammLpWrappers,
      downstreamConsumersOfWrapperLp: wrapperConsumers},
    alphaVault: {listedAccounts: alphaAll.length, dammV1Vaults: alphaDamm.length,
      actualRemainingCapacityCount: actualRemaining.length,
      actualRemainingCapacityAndFutureActivationCount: lifecycleFuture.length,
      actualRemainingCapacity: actualRemaining.map(x => ({...x,
        currentZeroFeeKlendSameQuoteMint: currentKlendMints.has(x.quoteMint),
        currentProject0SameQuoteMint: currentP0Mints.has(x.quoteMint)}))},
    embeddedDammProgramId: embeddedIdScan(),
    limitations: [
      'LP-mint equality tests direct lending/vault acceptance of the DAMM LP token; it does not prove each protocol prices that mint from DAMM spot reserves.',
      'Embedded program-id matches prove a binary contains the DAMM-v1 address, not that every code path is permissionless or price-sensitive.',
      'The Alpha Vault lifecycle filter first applies vault mode/max-buy cap, then asks whether the pool activation point is still future. Direct simulations establish the actual deployed guard.',
    ]};
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({outputPath, slots: output.observedSlots, pools: output.dammPools,
    consumers: consumers.map(x => ({label: x.label, testedRows: x.testedRows,
      matchedRows: x.matchedRows, matchedPools: x.matchedPools, complete: x.complete ?? true, blocker: x.blocker})),
    dammLpWrappers: {count: dammLpWrappers.length,
      nonzero: dammLpWrappers.filter(x => BigInt(x.totalUnderlyingDammLpRaw) > 0n).length,
      withStrategies: dammLpWrappers.filter(x => x.nonzeroStrategies.length).length,
      downstream: wrapperConsumers.map(x => ({label: x.label, matchedRows: x.matchedRows}))},
    alpha: {dammV1Vaults: alphaDamm.length, actualRemaining: actualRemaining.length,
      lifecycleFuture: lifecycleFuture.length, rows: output.alphaVault.actualRemainingCapacity},
    binaries: {scanned: output.embeddedDammProgramId.filesScanned,
      matches: output.embeddedDammProgramId.matches.map(x => ({file: x.file, offsets: x.offsets}))}}));
}
main().catch(e => {console.error(e.stack); process.exitCode = 1;});
