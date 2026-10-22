#!/usr/bin/env node
// Current read-only flash source and pool token inventory; no loan is initiated.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection, PublicKey} = require(modules + '@solana/web3.js');
if (!process.env.SOLANA_RPC) throw Error('SOLANA_RPC is required');
const conn = new Connection(process.env.SOLANA_RPC, 'confirmed');
const addresses = [
  {kind: 'klend-usdc', reserve: 'AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z', vault: '8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB'},
  {kind: 'klend-usdc', reserve: 'C2Wp6bpsVevig3AZ1KSCkgHZhsWfN2tw9eQ4kG9z7U7J', vault: '7KcyBoZNQr4L5kRHxtkfmAuyJ1UhYonWBDxFGcBTSGi6'},
  {kind: 'project0-usdc', reserve: '2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB', vault: '7jaiZR5Sk8hdYN9MxTpczTcwbWpb5WEoxSANuUwveuat'},
  {kind: 'project0-usdc', reserve: '7wYBRtPh4BoGVgdV6smRPHbN3z4hafiyqk9gGtY6EWTk', vault: 'GTr3FFhgp9VtK8VfGMckeCi3S6GMfB8BZpoofQ7LeMa8'},
  {kind: 'klend-susdai', reserve: '5vq24eGz45YWt4x8ub4eiJHU952UgFKpCTyW7rLb8wF2', vault: 'ARQ9taJ9vEic3MfSY1ekrjJnMsraZhTcGRZBryWQPhQh'},
];
function tokenAccount(info) {
  if (!info || info.data.length < 72) return null;
  const data = info.data;
  return {ownerProgram: info.owner.toBase58(),
    mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    tokenAuthority: new PublicKey(data.subarray(32, 64)).toBase58(),
    balanceRaw: data.readBigUInt64LE(64).toString()};
}
function reserveAccount(info, kind) {
  if (!info) return null;
  const data = info.data;
  const out = {ownerProgram: info.owner.toBase58(), dataBytes: data.length,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex')};
  if (kind.startsWith('klend') && data.length > 4912) {
    out.availableRaw = data.readBigUInt64LE(224).toString();
    out.flashLoanFeeSf = data.readBigUInt64LE(4904).toString();
    out.status = data[4856];
    out.emergencyMode = data[4864];
  }
  return out;
}
async function main() {
  const keys = addresses.flatMap(x => [x.reserve, x.vault]).map(x => new PublicKey(x));
  const response = await conn.getMultipleAccountsInfoAndContext(keys, 'confirmed');
  const rows = addresses.map((x, i) => ({...x,
    reserveState: reserveAccount(response.value[2*i], x.kind),
    vaultState: tokenAccount(response.value[2*i+1])}));
  const out = {generatedAt: new Date().toISOString(), commitment: 'confirmed',
    contextSlot: response.context.slot, readOnly: true,
    note: 'Vault token balance is observed inventory, not an executable flash limit; bank/reserve controls still apply.', rows};
  fs.writeFileSync(path.join(__dirname, 'loan-inventory.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({contextSlot: out.contextSlot, rows: rows.map(x => ({kind: x.kind,
    reserve: x.reserve, vault: x.vault, mint: x.vaultState?.mint,
    observedVaultRaw: x.vaultState?.balanceRaw,
    reserveAvailableRaw: x.reserveState?.availableRaw || null,
    flashLoanFeeSf: x.reserveState?.flashLoanFeeSf || null,
    reserveStatus: x.reserveState?.status ?? null}))}, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
