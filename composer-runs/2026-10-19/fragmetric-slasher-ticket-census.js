#!/usr/bin/env node
'use strict';

// Read-only census of live normalized-token withdrawal tickets, restricted to
// the normalized pool under audit. No transaction construction or key access.
const fs = require('fs');
const path = require('path');
const base = path.resolve(__dirname, '../2026-10-15/fragmetric-core-current-audit/sdk-3.0.2');
const {restakingTypes: T} = require(base);
const bs58m = require(path.join(base, 'node_modules/bs58'));
const bs58 = bs58m.default || bs58m;
const envFile = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
if ((fs.statSync(envFile).mode & 0o777) !== 0o600) throw new Error('RPC env file must be mode 0600');
const env = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)=(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const endpoint = env.SOLANA_RPC_URL || env.SOLANA_RPC || env.HELIUS_RPC || env.RPC;
if (!endpoint) throw new Error('RPC endpoint absent');
const PROGRAM = 'fragnAis7Bp6FTsMoa6YcH8UffhEw43Ph79qAiK3iF3';
const POOL = 'AkbZvKxUAxMKz92FF7g5k2YLCJftg8SnYEPWdmZTt3mp';
const discriminator = Buffer.from(T.getNormalizedTokenWithdrawalAccountDiscriminatorBytes());
let id = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0', id:++id, method, params}), signal:AbortSignal.timeout(120000)});
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${method}: ${JSON.stringify(body.error || response.status)}`);
  return body.result;
}
async function main() {
  // normalized_token_pool begins at byte 75: discriminator(8), version(2),
  // bump(1), withdrawal_authority(32), normalized_token_mint(32).
  const result = await rpc('getProgramAccounts', [PROGRAM, {encoding:'base64', commitment:'finalized', withContext:true, filters:[{memcmp:{offset:0, bytes:bs58.encode(discriminator)}},{memcmp:{offset:75, bytes:POOL}}]}]);
  const rows = result.value.map(({pubkey, account}) => {
    const decoded = T.getNormalizedTokenWithdrawalAccountDecoder().decode(Buffer.from(account.data[0], 'base64'));
    return {address:pubkey, withdrawalAuthority:String(decoded.withdrawalAuthority), normalizedTokenMint:String(decoded.normalizedTokenMint), normalizedTokenPool:String(decoded.normalizedTokenPool), normalizedTokenAmountRaw:String(decoded.normalizedTokenAmount), claimableTokenCount:decoded.claimableTokens.length, claimableTokens:decoded.claimableTokens.map(x=>({mint:String(x.mint), amountRaw:String(x.amount)})), createdAt:String(decoded.createdAt)};
  });
  const out = {observedAt:new Date().toISOString(), network:'mainnet-beta', commitment:'finalized', contextSlot:result.context.slot, program:PROGRAM, pool:POOL, ticketCount:rows.length, totalNormalizedTokenAmountRaw:rows.reduce((n,x)=>n+BigInt(x.normalizedTokenAmountRaw),0n).toString(), tickets:rows, safety:'Read-only getProgramAccounts; no transaction construction, signing, simulation, or broadcast.'};
  fs.writeFileSync(path.join(__dirname, 'fragmetric-slasher-ticket-census.json'), JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({contextSlot:out.contextSlot,ticketCount:out.ticketCount,totalNormalizedTokenAmountRaw:out.totalNormalizedTokenAmountRaw},null,2));
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
