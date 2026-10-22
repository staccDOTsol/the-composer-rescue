#!/usr/bin/env node
// Read-only SKR staking vault, mint, and public swap-quote snapshot.
const fs = require('fs');
const path = require('path');
const outDir = __dirname;
const SKR = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const VAULT = '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8';
const CONFIG = '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw';
const PROGRAM = 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';
const PROGRAMDATA = '7f1KoiGPFFouvAafZtVmtdpgGJuADprihB9Pdzut3gaJ';
const envFile = '/tmp/composer-helius-rpc.env';
let rpcUrl = 'https://api.mainnet-beta.solana.com';
let rpcProvider = 'Solana public';
if (fs.existsSync(envFile)) {
  const line = fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find((s) => s.startsWith('RPC_URL='));
  if (line) { rpcUrl = line.slice('RPC_URL='.length); rpcProvider = 'existing Helius'; }
}
async function rpc(method, params) {
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result;
}
async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(`${new URL(url).pathname} HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}
async function main() {
  const accounts = await rpc('getMultipleAccounts', [[VAULT, CONFIG, PROGRAM, PROGRAMDATA, SKR],
    { encoding: 'base64', commitment: 'confirmed' }]);
  const parsedVault = await rpc('getAccountInfo', [VAULT, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const parsedMint = await rpc('getAccountInfo', [SKR, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const supply = await rpc('getTokenSupply', [SKR, { commitment: 'confirmed' }]);
  const registry = await getJson(`https://lite-api.jup.ag/tokens/v2/search?query=${SKR}`);
  const quoteAmountsSkr = [1000, 10000, 100000, 1000000, 2000000, 5000000, 10000000,
    15000000, 20000000, 30000000, 40000000, 50000000, 75000000, 100000000,
    1000000000, 5077227354];
  const quotes = [];
  for (const amountSkr of quoteAmountsSkr) {
    const amount = (BigInt(amountSkr) * 1000000n).toString();
    const query = new URLSearchParams({ inputMint: SKR, outputMint: USDC, amount,
      slippageBps: '100', restrictIntermediateTokens: 'true' });
    const url = `https://lite-api.jup.ag/swap/v1/quote?${query}`;
    try { quotes.push({ amountSkr, response: await getJson(url) }); }
    catch (e) { quotes.push({ amountSkr, error: e.message }); }
  }
  const output = {
    generatedAt: new Date().toISOString(), rpcProvider, addresses: { SKR, USDC, VAULT, CONFIG, PROGRAM, PROGRAMDATA },
    rpcAccountSlot: accounts.context.slot, rawAccounts: accounts.value,
    parsedVault, parsedMint, supply,
    registry: Array.isArray(registry) ? registry.filter((x) => x.id === SKR) : registry,
    quotes,
    notes: ['Read-only RPC methods and public GET quote requests only.',
      'Quotes are isolated route estimates, not executed fills or proof of simultaneous liquidity.']
  };
  fs.writeFileSync(path.join(outDir, 'snapshot.json'), `${JSON.stringify(output, null, 2)}\n`);
  const vaultAmount = parsedVault.value?.data?.parsed?.info?.tokenAmount?.uiAmountString;
  process.stdout.write(JSON.stringify({slot: accounts.context.slot, vaultAmount,
    supply: supply.value.uiAmountString,
    registry: output.registry.map((r)=>({usdPrice:r.usdPrice,liquidity:r.liquidity,organicScore:r.organicScore,updatedAt:r.updatedAt})),
    quotes: quotes.map(({amountSkr,response,error}) => ({amountSkr,error,
      outAmountUsdc: response?.outAmount ? Number(response.outAmount)/1e6 : undefined,
      priceImpactPct: response?.priceImpactPct,
      routeLabels: response?.routePlan?.map((p)=>p.swapInfo?.label)}))}, null, 2)+'\n');
}
main().catch((e) => { process.stderr.write(`${e.stack || e.message}\n`); process.exitCode = 1; });
