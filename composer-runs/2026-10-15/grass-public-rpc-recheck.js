#!/usr/bin/env node
// Independent public Solana RPC corroboration of the Helius account snapshot.
const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const dir = __dirname;
const prior = JSON.parse(fs.readFileSync(path.join(dir, 'grass-custody-recheck.json')));
const addresses = [prior.program.programId, prior.program.programDataAddress, prior.mint.address,
  ...prior.vaults.flatMap((row) => [row.authority, row.vault])];
async function main() {
  const response = await fetch('https://api.mainnet-beta.solana.com', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1,
      method: 'getMultipleAccounts', params: [addresses, { encoding: 'base64', commitment: 'confirmed',
        dataSlice: { offset: 0, length: 72 } }] }) });
  if (!response.ok) throw new Error(`public RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  const byAddress = new Map(addresses.map((address, index) => [address, body.result.value[index]]));
  const rows = prior.vaults.map((row) => {
    const authority = byAddress.get(row.authority);
    const vault = byAddress.get(row.vault);
    const bytes = Buffer.from(vault.data[0], 'base64');
    return { authority: row.authority, authorityOwner: authority?.owner ?? null,
      vault: row.vault, vaultOwner: vault?.owner ?? null,
      mint: new PublicKey(bytes.subarray(0, 32)).toBase58(),
      tokenAuthority: new PublicKey(bytes.subarray(32, 64)).toBase58(),
      rawAmount: bytes.readBigUInt64LE(64).toString(),
      agreesWithHelius: authority?.owner === prior.program.programId &&
        vault?.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' &&
        bytes.readBigUInt64LE(64).toString() === row.rawAmount &&
        new PublicKey(bytes.subarray(0, 32)).toBase58() === prior.mint.address &&
        new PublicKey(bytes.subarray(32, 64)).toBase58() === row.authority };
  });
  const output = { generatedAt: new Date().toISOString(), endpoint: 'https://api.mainnet-beta.solana.com',
    slot: body.result.context.slot, programExecutable: byAddress.get(prior.program.programId)?.executable,
    rows, rawResponse: body };
  fs.writeFileSync(path.join(dir, 'grass-public-rpc-recheck.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ slot: output.slot, programExecutable: output.programExecutable,
    allNineAgree: rows.every((r) => r.agreesWithHelius), rows: rows.map((r) => ({vault:r.vault, agrees:r.agreesWithHelius})) }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
