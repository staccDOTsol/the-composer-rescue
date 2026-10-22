#!/usr/bin/env node
'use strict';
// Signed mainnet-beta simulateTransaction only. This file never calls sendTransaction.
const fs = require('fs');
const M = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, Keypair, TransactionMessage, VersionedTransaction} = require(M+'@solana/web3.js');
const spl = require(M+'@solana/spl-token');
const raw = JSON.parse(fs.readFileSync(process.env.HOOKED_KEYPAIR_PATH || '/Users/stacc/hooked.json', 'utf8'));
if (!Array.isArray(raw) || raw.length !== 64 || !raw.every(x => Number.isInteger(x) && x >= 0 && x <= 255)) {
  throw Error('invalid signer keypair shape');
}
const wallet = Keypair.fromSecretKey(Uint8Array.from(raw));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const RPC = env.HEAVY_RPC_URL || env.RPC_URL;
if (!RPC) throw Error('missing RPC URL');
let id = 0;
async function rpc(method, params) {
  const r = await fetch(RPC, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0', id:++id, method, params})});
  const j = await r.json();
  if (j.error) throw Error(method + ': ' + JSON.stringify(j.error));
  return j.result;
}
const rows = [
  ['WETZ', 'WETZjtprkDMCcUxPi9PfWnowMRZkiGGHDb9rABuRZ2U', spl.TOKEN_PROGRAM_ID],
  ['PUMP_A', 'Ar8mYJece3kHPQUxwoW8sk6LRpdCLZd5N3mZ8BMRpump', spl.TOKEN_2022_PROGRAM_ID],
  ['CASH', 'CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH', spl.TOKEN_2022_PROGRAM_ID],
].map(([name,mint,tokenProgram]) => ({name, mint:new PublicKey(mint), tokenProgram,
  ata:spl.getAssociatedTokenAddressSync(new PublicKey(mint), wallet.publicKey, false, tokenProgram)}));
const mode = process.env.ATA_MODE === 'all-then-close' ? 'all-then-close' : 'interleaved';
const create = x => spl.createAssociatedTokenAccountIdempotentInstruction(
  wallet.publicKey, x.ata, wallet.publicKey, x.mint, x.tokenProgram);
const close = x => spl.createCloseAccountInstruction(
  x.ata, wallet.publicKey, wallet.publicKey, [], x.tokenProgram);
async function snapshot() {
  const [balance, accounts] = await Promise.all([
    rpc('getBalance', [wallet.publicKey.toBase58(), {commitment:'confirmed'}]),
    rpc('getMultipleAccounts', [rows.map(x=>x.ata.toBase58()),
      {encoding:'base64', commitment:'confirmed'}]),
  ]);
  return {lamports:balance.value, atas:accounts.value.map((a,i)=>({name:rows[i].name,
    exists:!!a, lamports:a?.lamports || 0}))};
}
async function main() {
  const before = await snapshot();
  const ixs = mode === 'interleaved' ? rows.flatMap(x=>[create(x),close(x)]) :
    [...rows.map(create), ...rows.map(close)];
  const bh = (await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const message = new TransactionMessage({payerKey:wallet.publicKey,
    recentBlockhash:bh, instructions:ixs}).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([wallet]);
  const wire = Buffer.from(tx.serialize());
  if (wire.length > 1232) throw Error('serialized transaction exceeds 1232 bytes: '+wire.length);
  const sim = await rpc('simulateTransaction',[wire.toString('base64'),{
    encoding:'base64', sigVerify:true, replaceRecentBlockhash:false,
    commitment:'processed', innerInstructions:true,
    accounts:{encoding:'base64',addresses:[wallet.publicKey.toBase58(),
      ...rows.map(x=>x.ata.toBase58())]},
  }]);
  const after = await snapshot();
  const simulationAccounts = (sim.value.accounts || []).map(a=>({
    exists:!!a && a.lamports > 0,lamports:a?.lamports || 0,
    owner:a?.owner || null}));
  const artifact = {observedAt:new Date().toISOString(),network:'mainnet-beta',
    method:'simulateTransaction',sigVerify:true,mainnetSubmission:false,
    wallet:wallet.publicKey.toBase58(),mode,wireVersion:0,wireBytes:wire.length,
    addressCount:message.staticAccountKeys.length,instructionCount:ixs.length,
    rows:rows.map(x=>({name:x.name,mint:x.mint.toBase58(),
      tokenProgram:x.tokenProgram.toBase58(),ata:x.ata.toBase58()})),
    before,simulation:{slot:sim.context.slot,err:sim.value.err,
      computeUnits:sim.value.unitsConsumed,accounts:simulationAccounts,
      logs:sim.value.logs},after,
    chainUnchanged:before.lamports===after.lamports && before.atas.every((x,i)=>
      x.exists===after.atas[i].exists && x.lamports===after.atas[i].lamports)};
  const name='hooked-mainnet-remaining-ata-'+mode+'-sim.json';
  fs.writeFileSync(__dirname+'/'+name,JSON.stringify(artifact,null,2)+'\n');
  console.log(JSON.stringify({artifact:name,err:artifact.simulation.err,
    slot:artifact.simulation.slot,wireBytes:artifact.wireBytes,
    computeUnits:artifact.simulation.computeUnits,chainUnchanged:artifact.chainUnchanged,
    before:artifact.before,simulationAccounts,
    logs:artifact.simulation.logs?.slice(-18)},null,2));
}
main().catch(e=>{console.error(e.stack || e);process.exitCode=1});
