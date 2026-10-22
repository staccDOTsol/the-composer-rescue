// Read-only DBC custody census. Enumerates token accounts held by the
// canonical DBC pool-authority for the most common live PoolConfig quote
// mints, prices balances from a token-price feed, and links the largest
// vaults back to current program-owned pool state and canonical PDAs.
const fs = require('fs');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!RPC) throw new Error('HEAVY_RPC_URL or RPC_URL is required');

const PROGRAM = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
const POOL_AUTHORITY = new PublicKey('FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM');
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const POOL_DISCS = new Set(['d5e005d16245775c', 'eddbb8172abda923']);

// Top quote mints by live PoolConfig account frequency at slot 457342444.
const QUOTE_MINTS = [
  ['So11111111111111111111111111111111111111112', 483938],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 46418],
  ['5dvXTZ5qwgafnHtwu3Ls3QrWx1U4LQsFeCuJgkk4QEC6', 1608],
  ['METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL', 1335],
  ['USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', 1306],
  ['Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', 804],
  ['JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 737],
  ['A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS', 525],
  ['Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8', 412],
  ['XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', 392],
];

async function rpc(method, params) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { body = { error: { code: response.status, message: text.slice(0, 200) } }; }
    if (!body.error) return body.result;
    if (attempt === 9) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }
}

function decodeTokenAccount(data, expectedAuthority) {
  if (!data || data.length < 72) return null;
  const mint = new PublicKey(data.subarray(0, 32)).toBase58();
  const authority = new PublicKey(data.subarray(32, 64)).toBase58();
  return {
    mint,
    authority,
    rawAmount: data.readBigUInt64LE(64).toString(),
    authorityMatches: authority === expectedAuthority,
  };
}

function sortMints(a, b) {
  return Buffer.compare(a.toBuffer(), b.toBuffer()) >= 0 ? [a, b] : [b, a];
}

async function getMany(addresses) {
  const values = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const result = await rpc('getMultipleAccounts', [
      addresses.slice(i, i + 100),
      { commitment: 'confirmed', encoding: 'base64' },
    ]);
    values.push(...result.value);
  }
  return values;
}

async function getPrices(mints) {
  const response = await fetch(`https://coins.llama.fi/prices/current/${mints.map((m) => `solana:${m}`).join(',')}`);
  if (!response.ok) throw new Error(`price HTTP ${response.status}`);
  return (await response.json()).coins || {};
}

async function scanQuoteMint(mint, configCount, mintInfo, price) {
  const mintData = Buffer.from(mintInfo.data[0], 'base64');
  const decimals = mintData[44];
  const tokenProgram = mintInfo.owner;
  const rows = [];
  let rawTotal = 0n;
  let paginationKey;
  let accountCount = 0;
  let pages = 0;
  while (true) {
    const options = {
      commitment: 'confirmed',
      encoding: 'base64',
      dataSlice: { offset: 64, length: 8 },
      filters: [
        { memcmp: { offset: 0, bytes: mint } },
        { memcmp: { offset: 32, bytes: POOL_AUTHORITY.toBase58() } },
      ],
      limit: 10_000,
    };
    if (paginationKey) options.paginationKey = paginationKey;
    const result = await rpc('getProgramAccountsV2', [tokenProgram, options]);
    pages++;
    accountCount += result.accounts.length;
    for (const item of result.accounts) {
      const data = Buffer.from(item.account.data[0], 'base64');
      if (data.length !== 8) continue;
      const amount = data.readBigUInt64LE(0);
      if (amount === 0n) continue;
      rawTotal += amount;
      rows.push({ address: item.pubkey, rawAmount: amount.toString() });
    }
    paginationKey = result.paginationKey;
    if (!paginationKey || result.accounts.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  rows.sort((a, b) => BigInt(a.rawAmount) > BigInt(b.rawAmount) ? -1 : BigInt(a.rawAmount) < BigInt(b.rawAmount) ? 1 : 0);
  const amount = Number(rawTotal) / 10 ** decimals;
  return {
    mint,
    configCount,
    tokenProgram,
    decimals,
    observationSlot: null,
    pages,
    authorityTokenAccountCount: accountCount,
    nonzeroAuthorityTokenAccountCount: rows.length,
    rawTotal: rawTotal.toString(),
    amount,
    price: price ? { symbol: price.symbol, usdPrice: price.price, timestamp: price.timestamp } : null,
    pricedGrossUsd: price ? amount * price.price : null,
    topAccounts: rows.slice(0, 100),
  };
}

async function linkCandidate(candidate) {
  const filters = [
    { dataSize: 424 },
    { memcmp: { offset: 200, bytes: candidate.address } },
  ];
  const matches = await rpc('getProgramAccounts', [
    PROGRAM.toBase58(),
    { commitment: 'confirmed', encoding: 'base64', filters },
  ]);
  if (matches.length !== 1) return { ...candidate, linked: false, matchCount: matches.length };
  const poolKey = new PublicKey(matches[0].pubkey);
  const data = Buffer.from(matches[0].account.data[0], 'base64');
  const discriminator = data.subarray(0, 8).toString('hex');
  if (data.length !== 424 || !POOL_DISCS.has(discriminator)) {
    return { ...candidate, linked: false, matchCount: matches.length, invalidPoolData: true };
  }
  const config = new PublicKey(data.subarray(72, 104));
  const creator = new PublicKey(data.subarray(104, 136));
  const baseMint = new PublicKey(data.subarray(136, 168));
  const baseVault = new PublicKey(data.subarray(168, 200));
  const quoteVault = new PublicKey(data.subarray(200, 232));
  const quoteMint = new PublicKey(candidate.mint);
  const [maxMint, minMint] = sortMints(baseMint, quoteMint);
  const [derivedPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), config.toBuffer(), maxMint.toBuffer(), minMint.toBuffer()],
    PROGRAM,
  );
  const [derivedBaseVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_vault'), baseMint.toBuffer(), poolKey.toBuffer()],
    PROGRAM,
  );
  const [derivedQuoteVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_vault'), quoteMint.toBuffer(), poolKey.toBuffer()],
    PROGRAM,
  );
  const current = await getMany([baseVault.toBase58(), quoteVault.toBase58(), config.toBase58()]);
  const baseData = current[0] ? Buffer.from(current[0].data[0], 'base64') : null;
  const quoteData = current[1] ? Buffer.from(current[1].data[0], 'base64') : null;
  const configData = current[2] ? Buffer.from(current[2].data[0], 'base64') : null;
  const baseToken = decodeTokenAccount(baseData, POOL_AUTHORITY.toBase58());
  const quoteToken = decodeTokenAccount(quoteData, POOL_AUTHORITY.toBase58());
  const configQuoteMint = configData && configData.length >= 40 ? new PublicKey(configData.subarray(8, 40)).toBase58() : null;
  const controlVerified =
    derivedPool.equals(poolKey) &&
    derivedBaseVault.equals(baseVault) &&
    derivedQuoteVault.equals(quoteVault) &&
    baseToken?.mint === baseMint.toBase58() &&
    baseToken?.authorityMatches &&
    quoteToken?.mint === quoteMint.toBase58() &&
    quoteToken?.authorityMatches &&
    current[2]?.owner === PROGRAM.toBase58() &&
    configQuoteMint === quoteMint.toBase58();
  return {
    ...candidate,
    linked: true,
    controlVerified,
    pool: poolKey.toBase58(),
    poolDiscriminator: discriminator,
    config: config.toBase58(),
    creator: creator.toBase58(),
    baseMint: baseMint.toBase58(),
    baseVault: baseVault.toBase58(),
    quoteVault: quoteVault.toBase58(),
    storedBaseReserve: data.readBigUInt64LE(232).toString(),
    storedQuoteReserve: data.readBigUInt64LE(240).toString(),
    poolPdaMatches: derivedPool.equals(poolKey),
    baseVaultPdaMatches: derivedBaseVault.equals(baseVault),
    quoteVaultPdaMatches: derivedQuoteVault.equals(quoteVault),
    baseToken,
    quoteToken,
    configOwnedByProgram: current[2]?.owner === PROGRAM.toBase58(),
    configQuoteMint,
  };
}

async function main() {
  const mintInfos = await getMany(QUOTE_MINTS.map(([mint]) => mint));
  const prices = await getPrices(QUOTE_MINTS.map(([mint]) => mint));
  const quotes = [];
  for (let i = 0; i < QUOTE_MINTS.length; i++) {
    const [mint, count] = QUOTE_MINTS[i];
    if (!mintInfos[i]) continue;
    const row = await scanQuoteMint(mint, count, mintInfos[i], prices[`solana:${mint}`]);
    quotes.push(row);
    console.error(JSON.stringify({ mint, accounts: row.authorityTokenAccountCount, nonzero: row.nonzeroAuthorityTokenAccountCount, usd: row.pricedGrossUsd }));
  }
  const candidates = quotes.flatMap((quote) => quote.topAccounts.map((row) => ({
    ...row,
    mint: quote.mint,
    decimals: quote.decimals,
    symbol: quote.price?.symbol || null,
    usdPrice: quote.price?.usdPrice || null,
    usdValue: quote.price ? Number(row.rawAmount) / 10 ** quote.decimals * quote.price.usdPrice : null,
  }))).filter((row) => row.usdValue !== null).sort((a, b) => b.usdValue - a.usdValue).slice(0, 100);
  const linked = [];
  for (let i = 0; i < candidates.length; i++) {
    linked.push(await linkCandidate(candidates[i]));
    if ((i + 1) % 10 === 0) console.error(JSON.stringify({ linked: i + 1, total: candidates.length }));
  }
  const verified = linked.filter((row) => row.controlVerified);
  const verifiedUsdLowerBound = verified.reduce((sum, row) => sum + (row.usdValue || 0), 0);
  const pricedAuthorityUsd = quotes.reduce((sum, row) => sum + (row.pricedGrossUsd || 0), 0);
  const out = {
    timestamp: new Date().toISOString(),
    program: PROGRAM.toBase58(),
    poolAuthority: POOL_AUTHORITY.toBase58(),
    configCensus: { observationSlot: 457342444, poolConfigAccounts: 547785, distinctQuoteMints: 1647, selectedTopQuoteMints: QUOTE_MINTS.length },
    selectedQuoteMintPricedAuthorityCustodyUsd: pricedAuthorityUsd,
    top100CanonicalPoolLinkedPricedUsdLowerBound: verifiedUsdLowerBound,
    top100Candidates: linked.length,
    top100ControlVerified: verified.length,
    quotes: quotes.map(({ topAccounts, ...quote }) => ({ ...quote, topAccounts: topAccounts.slice(0, 20) })),
    linkedTop100: linked,
    limitations: [
      'Authority-wide totals cover only the ten most common live PoolConfig quote mints, not all 1,647 quote mints.',
      'The conservative canonical pool-linked lower bound includes only the 100 largest priced selected-quote accounts.',
      'Base-token vaults and unpriced quote mints are excluded from USD totals.',
      'Authority-wide totals may include non-pool token accounts controlled by the same DBC global PDA; only linkedTop100 is pool-state and PDA verified.',
    ],
  };
  const path = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dbc-custody.json';
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ path, selectedQuoteMintPricedAuthorityCustodyUsd: pricedAuthorityUsd, top100CanonicalPoolLinkedPricedUsdLowerBound: verifiedUsdLowerBound, top100ControlVerified: verified.length, top: verified.slice(0, 10).map((row) => ({ pool: row.pool, vault: row.address, symbol: row.symbol, usdValue: row.usdValue })) }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
