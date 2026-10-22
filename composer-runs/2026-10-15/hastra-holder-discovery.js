#!/usr/bin/env node
// Read-only discovery of a quiet, system-owned holder with both PRIME and wYLDS accounts.
const fs = require('fs');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { Connection, PublicKey } = require(`${MOD}/@solana/web3.js`);

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^export\s+/, '');
    if (!cleaned || cleaned.startsWith('#')) continue;
    const i = cleaned.indexOf('=');
    if (i > 0) out[cleaned.slice(0, i)] = cleaned.slice(i + 1).replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...readEnv('/tmp/composer-helius-rpc.env'), ...process.env };
const rpcUrl = env.RPC_URL || env.HEAVY_RPC_URL;
if (!rpcUrl) throw new Error('RPC_URL or HEAVY_RPC_URL is required');
const connection = new Connection(rpcUrl, 'confirmed');
const PRIME = new PublicKey('3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7');
const WYLDS = new PublicKey('8fr7WGTVFszfyNWRMXj6fRjZZAnDwmXwEpCrtzmUkdih');

(async () => {
  const largest = await connection.getTokenLargestAccounts(PRIME, 'confirmed');
  const primeAccounts = largest.value.map((row) => row.address);
  const infos = await connection.getMultipleParsedAccounts(primeAccounts, 'confirmed');
  const candidates = [];
  for (let i = 0; i < primeAccounts.length; i += 1) {
    const parsed = infos.value[i]?.data?.parsed?.info;
    if (!parsed?.owner) continue;
    const owner = new PublicKey(parsed.owner);
    const [ownerInfo, wylds] = await Promise.all([
      connection.getAccountInfo(owner, 'confirmed'),
      connection.getParsedTokenAccountsByOwner(owner, { mint: WYLDS }, 'confirmed'),
    ]);
    candidates.push({
      owner: owner.toBase58(),
      ownerExecutable: ownerInfo?.executable ?? null,
      ownerProgram: ownerInfo?.owner?.toBase58() ?? null,
      lamports: ownerInfo?.lamports ?? null,
      primeToken: primeAccounts[i].toBase58(),
      primeRaw: parsed.tokenAmount.amount,
      wylds: wylds.value.map(({ pubkey, account }) => ({
        token: pubkey.toBase58(),
        raw: account.data.parsed.info.tokenAmount.amount,
      })),
    });
  }
  const output = {
    generatedAt: new Date().toISOString(),
    rpcEndpointRedacted: true,
    note: 'Public read-only holder discovery; no transaction was signed or sent.',
    candidates,
  };
  fs.writeFileSync(`${__dirname}/hastra-holder-discovery.json`, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(candidates.filter((row) => row.ownerProgram === '11111111111111111111111111111111' && row.wylds.some((x) => BigInt(x.raw) > 10n)), null, 2));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
