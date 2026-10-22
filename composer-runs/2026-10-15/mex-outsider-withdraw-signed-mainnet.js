#!/usr/bin/env node
// One wallet-signed mainnet-beta simulateTransaction for the live MEX BORG proxy vault.
// No sendTransaction, synthetic balances, or key material in output.
const fs = require('fs');
const path = require('path');
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction,
  SystemProgram, SYSVAR_RENT_PUBKEY} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const PROGRAM = new PublicKey('MEXkeo4BPUCZuEJ4idUUwMPu4qvc9nkqtLn3yAyZLxg');
const MINT = new PublicKey('3dQTr7ror2QPKQ3GbBCokJUmjErGg8kTJzdnYjNfvi3Z');
const VAULT = new PublicKey('HdF2e6ibqaRL8fXrNJ6tG4bmmkt11y2s3txA1wsbXZ3M');
const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  fs.readFileSync(path.join(process.env.HOME, 'hooked.json'), 'utf8'))));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
let id = 0;
async function rpc(method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
    if (r.status === 429) {await new Promise(ok => setTimeout(ok, (attempt + 1) * 1000)); continue;}
    const j = await r.json(); if (j.error) throw Error(method + ': ' + JSON.stringify(j.error));
    return j.result;
  }
  throw Error(method + ': rate limit');
}
function balance(account) {
  if (!account?.data?.[0]) return null;
  const bytes = Buffer.from(account.data[0], 'base64');
  if (bytes.length < 72) return null;
  return bytes.readBigUInt64LE(64).toString();
}
async function main() {
  const genesis = await rpc('getGenesisHash', []);
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw Error('not mainnet-beta');
  const proxy = PublicKey.findProgramAddressSync([Buffer.from('proxy')], PROGRAM)[0];
  const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PROGRAM)[0];
  const accounts = (await rpc('getMultipleAccounts', [[proxy.toBase58(), VAULT.toBase58(), MINT.toBase58(), signer.publicKey.toBase58()],
    {encoding: 'base64', commitment: 'confirmed'}])).value;
  if (accounts.some(x => !x)) throw Error('live state missing');
  if (accounts[0].owner !== PROGRAM.toBase58()) throw Error('proxy owner mismatch');
  const proxyBytes = Buffer.from(accounts[0].data[0], 'base64');
  if (proxyBytes.length !== 137 || !proxyBytes.subarray(0, 8).equals(Buffer.from([36, 36, 123, 35, 158, 89, 75, 41])))
    throw Error('proxy layout mismatch');
  const treasurer = new PublicKey(proxyBytes.subarray(72, 104)).toBase58();
  if (treasurer === signer.publicKey.toBase58()) throw Error('signer unexpectedly has treasury role');
  if (accounts[1].owner !== accounts[2].owner) throw Error('token program mismatch');
  const tokenProgram = new PublicKey(accounts[1].owner);
  const expectedVault = getAssociatedTokenAddressSync(MINT, proxy, true, tokenProgram);
  if (!expectedVault.equals(VAULT)) throw Error('selected vault is not proxy ATA');
  const signerAta = getAssociatedTokenAddressSync(MINT, signer.publicKey, false, tokenProgram);
  const before = await rpc('getMultipleAccounts', [[VAULT.toBase58(), signerAta.toBase58()],
    {encoding: 'base64', commitment: 'confirmed'}]);
  const data = Buffer.alloc(17);
  Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]).copy(data, 0);
  data.writeBigUInt64LE(1n, 8); // one raw BORG unit, enough to reach authorization.
  data[16] = 0;
  const withdraw = new TransactionInstruction({programId: PROGRAM, data, keys: [
    {pubkey: proxy, isSigner: false, isWritable: false},
    {pubkey: VAULT, isSigner: false, isWritable: true},
    {pubkey: signer.publicKey, isSigner: true, isWritable: true},
    {pubkey: signerAta, isSigner: false, isWritable: true},
    {pubkey: MINT, isSigner: false, isWritable: false},
    {pubkey: tokenProgram, isSigner: false, isWritable: false},
    {pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    {pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
    {pubkey: eventAuthority, isSigner: false, isWritable: false},
    {pubkey: PROGRAM, isSigner: false, isWritable: false},
  ]});
  const setup = createAssociatedTokenAccountIdempotentInstruction(signer.publicKey,
    signerAta, signer.publicKey, MINT, tokenProgram);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const message = new TransactionMessage({payerKey: signer.publicKey, recentBlockhash: blockhash,
    instructions: [setup, withdraw]}).compileToV0Message();
  const tx = new VersionedTransaction(message); tx.sign([signer]);
  const wire = Buffer.from(tx.serialize());
  if (wire.length > 1232) throw Error('packet too large');
  const sim = await rpc('simulateTransaction', [wire.toString('base64'),
    {encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed',
      accounts: {encoding: 'base64', addresses: [VAULT.toBase58(), signerAta.toBase58()]}}]);
  const out = {generatedAt: new Date().toISOString(), program: PROGRAM.toBase58(), genesis,
    proxy: proxy.toBase58(), vault: VAULT.toBase58(), mint: MINT.toBase58(),
    runtimeSigner: signer.publicKey.toBase58(), runtimeIsTreasurer: false,
    requestedRaw: '1', walletAta: signerAta.toBase58(), walletAtaExisted: !!before.value[1],
    vaultBeforeRaw: balance(before.value[0]), walletBeforeRaw: balance(before.value[1]),
    packetBytes: wire.length, accountKeys: message.staticAccountKeys.length, sigVerify: true,
    replaceRecentBlockhash: false, mainnetSubmitted: false, simulationError: sim.value.err,
    unitsConsumed: sim.value.unitsConsumed, logs: sim.value.logs,
    simulatedVaultPostRaw: balance(sim.value.accounts?.[0]),
    simulatedWalletPostRaw: balance(sim.value.accounts?.[1])};
  const dest = path.join(__dirname, 'mex-outsider-withdraw-signed-mainnet.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({file: dest, err: out.simulationError, packetBytes: wire.length,
    unitsConsumed: out.unitsConsumed, logsTail: out.logs?.slice(-8)}));
}
main().catch(e => {console.error(e.stack || e); process.exitCode = 1;});
