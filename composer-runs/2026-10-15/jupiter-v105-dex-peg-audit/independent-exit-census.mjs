import fs from 'node:fs';

const RPC = process.env.RPC_URL || 'http://127.0.0.1:9057';
const USDGO = '72puLt71H93Z9CzHuBRTwFpL4TG3WZUhnoCC7p8gxigu';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const TARGET_DEX_AUTHORITY = '7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z';
const rawPath = '../mainnet-token-authority-census.raw.json';
const raw = JSON.parse(fs.readFileSync(new URL(rawPath, import.meta.url)));

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const usdgoAccounts = raw.tokenAccounts
  .filter((row) => row.mint === USDGO)
  .sort((a, b) => Number(BigInt(b.rawAmount) - BigInt(a.rawAmount)));

const authorities = [...new Set(usdgoAccounts.map((row) => row.authority))];
const rows = authorities.map((authority) => {
  const authorityRow = raw.authorities.find((row) => row.authority === authority);
  const all = raw.tokenAccounts.filter((row) => row.authority === authority);
  return {
    authority,
    authorityState: authorityRow ? {
      onCurve: authorityRow.onCurve,
      directExecutableOwner: authorityRow.directExecutableOwner,
    } : null,
    isTargetDexAuthority: authority === TARGET_DEX_AUTHORITY,
    usdgo: all.filter((row) => row.mint === USDGO && BigInt(row.rawAmount || 0) > 0n),
    usdc: all.filter((row) => row.mint === USDC && BigInt(row.rawAmount || 0) > 0n),
    nonzeroTokenAccountCount: all.filter((row) => BigInt(row.rawAmount || 0) > 0n).length,
  };
});

const sameAuthorityPairs = rows.filter((row) => row.usdgo.length && row.usdc.length);
const quoteTests = [];
for (const amount of ['1000000', '100000000', '1000000000', '10000000000', '100000000000', '1000000000000']) {
  const params = new URLSearchParams({inputMint: USDGO, outputMint: USDC, amount, slippageBps: '100'});
  const base = `https://api.jup.ag/swap/v1/quote?${params}`;
  const excluded = `${base}&excludeDexes=${encodeURIComponent('JupLend AMM')}`;
  const [normalResponse, excludedResponse] = await Promise.all([fetch(base), fetch(excluded)]);
  quoteTests.push({
    amountRaw: amount,
    normal: await normalResponse.json(),
    excludingAllJupLendAmm: await excludedResponse.json(),
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  rpc: RPC,
  inputs: {usdgoMint: USDGO, usdcMint: USDC, targetDexAuthority: TARGET_DEX_AUTHORITY},
  methodology: [
    'Enumerate the 20 largest USDGO accounts from the prior current-mainnet authority census.',
    'For every distinct authority, enumerate both legacy SPL and Token-2022 token accounts and identify authorities holding nonzero USDGO and USDC inventories.',
    'Query Jupiter v6 at sizes 1, 100, 1k, 10k, 100k, and 1m USDGO both normally and with every JupLend AMM route excluded.',
    'A same-authority inventory is only an exit candidate, not proof of a permissionless swap surface; absence of an aggregator route is counterevidence, not a proof that no unpublished venue exists.',
  ],
  observationSlot: await rpc('getSlot', [{commitment: 'processed'}]),
  usdgoLargestAccountCountCovered: usdgoAccounts.length,
  authorities: rows,
  sameAuthorityPairs,
  quoteTests,
};

fs.writeFileSync(new URL('./independent-exit-census.json', import.meta.url), JSON.stringify(output, null, 2));
console.log(JSON.stringify({
  observationSlot: output.observationSlot,
  authorities: rows.length,
  sameAuthorityPairs: sameAuthorityPairs.map((row) => ({
    authority: row.authority,
    owner: row.authorityState.owner,
    target: row.isTargetDexAuthority,
    usdgo: row.usdgo,
    usdc: row.usdc,
  })),
  quotes: quoteTests.map((test) => ({
    amountRaw: test.amountRaw,
    normalAmm: test.normal.routePlan?.map((p) => p.swapInfo.ammKey),
    excludedError: test.excludingAllJupLendAmm.error,
  })),
}, null, 2));
