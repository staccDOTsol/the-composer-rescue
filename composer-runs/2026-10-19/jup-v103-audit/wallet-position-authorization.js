#!/usr/bin/env node
// Read-only check of whether the supplied test wallet controls any live v103 position NFT.
const fs = require('fs');
const path = require('path');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection, Keypair} = require(modules + '@solana/web3.js');
const {TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID} = require(modules + '@solana/spl-token');
const bs58m = require(modules + 'bs58'), bs58 = bs58m.default || bs58m;
if (!process.env.SOLANA_RPC) throw Error('SOLANA_RPC is required');
const secret = Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8')));
const wallet = Keypair.fromSecretKey(secret).publicKey;
const conn = new Connection(process.env.SOLANA_RPC, 'confirmed');
async function main() {
  const positions = JSON.parse(fs.readFileSync(path.join(__dirname, 'current-position-value.json'))).positions;
  const [legacy, t22] = await Promise.all([
    conn.getTokenAccountsByOwner(wallet, {programId: TOKEN_PROGRAM_ID}, 'confirmed'),
    conn.getTokenAccountsByOwner(wallet, {programId: TOKEN_2022_PROGRAM_ID}, 'confirmed')]);
  const tokens = [...legacy.value, ...t22.value].map(x => ({
    address: x.pubkey.toBase58(), mint: x.account.data.subarray(0, 32).toString('hex'),
    balanceRaw: x.account.data.length >= 72 ? x.account.data.readBigUInt64LE(64).toString() : '0'}));
  const positionMintHex = new Map(positions.map(p => [Buffer.from(bs58.decode(p.positionMint)).toString('hex'), p]));
  const held = tokens.filter(x => BigInt(x.balanceRaw) > 0n && positionMintHex.has(x.mint))
    .map(x => ({tokenAccount: x.address, balanceRaw: x.balanceRaw,
      positionAddress: positionMintHex.get(x.mint).address,
      nftId: positionMintHex.get(x.mint).nftId,
      borrowing: !positionMintHex.get(x.mint).supplyOnly}));
  const out = {generatedAt: new Date().toISOString(), commitment: 'confirmed',
    readOnly: true, walletPublicKey: wallet.toBase58(), tokenAccountsInspected: tokens.length,
    livePositionNftsHeld: held};
  fs.writeFileSync(path.join(__dirname, 'wallet-position-authorization.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
