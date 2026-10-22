#!/usr/bin/env node
'use strict';

// Signed v1 read-only simulation of CollectFees for an attacker-owned NFT
// position after the real flash-funded deposit/withdraw round trip. Never send.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {Keypair, PublicKey, TransactionInstruction} =
  require(`${MODULES}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID} = require(`${MODULES}/@solana/spl-token`);
const {encodeV1, signV1} =
  require('../../2026-10-15/hylo-exchange-v1-wire.js');
const {rpc, PROGRAMS} = require('./real-flash-envelope.js');
const {POOL, WSOL_VAULT, USDC_VAULT, tokenAmount, positionImage} =
  require('./real-flash-swap-roundtrip.js');

const FORK = 'http://127.0.0.1:48899';
const OWNED = JSON.parse(fs.readFileSync(path.join(__dirname,
  'real-flash-owned-liquidity.json'), 'utf8'));
const actor = Keypair.fromSeed(crypto.createHash('sha256')
  .update('orca-pr1396-optimized-cycle-actor-2026-10-19').digest());
if (actor.publicKey.toBase58() !== OWNED.actor)
  throw new Error('Actor does not match the genuine owned-position receipt');
const p = value => value instanceof PublicKey ? value : new PublicKey(value);
const key = (pubkey, isWritable = false, isSigner = false) =>
  ({pubkey: p(pubkey), isWritable, isSigner});
const D = name => crypto.createHash('sha256').update(`global:${name}`)
  .digest().subarray(0, 8);

async function main() {
  if (await rpc(FORK, 'getGenesisHash') !==
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('This is not a Solana mainnet-backed local fork');
  const position = p(OWNED.position);
  const nftAta = p(OWNED.positionNftAta);
  const ataA = p(OWNED.wsolAta);
  const ataB = p(OWNED.usdcAta);
  const addresses = [position, ataA, ataB, WSOL_VAULT, USDC_VAULT];
  const before = (await rpc(FORK, 'getMultipleAccounts', [
    addresses.map(address => address.toBase58()),
    {encoding: 'base64', commitment: 'processed'},
  ])).value;
  const beforePosition = positionImage(before[0]);
  if (!beforePosition || beforePosition.feeOwedA !== '0' ||
      beforePosition.feeOwedB !== '0')
    throw new Error('Owned position is not a zero-fee control at this fork state');
  const nftAmount = (await rpc(FORK, 'getTokenAccountBalance',
    [nftAta.toBase58()])).value.amount;
  if (nftAmount !== '1') throw new Error('Actor no longer owns position NFT');
  const ix = new TransactionInstruction({programId: p(PROGRAMS.whirlpool),
    data: D('collect_fees'), keys: [
      key(POOL), key(actor.publicKey, false, true), key(position, true),
      key(nftAta), key(ataA, true), key(WSOL_VAULT, true),
      key(ataB, true), key(USDC_VAULT, true), key(TOKEN_PROGRAM_ID),
    ]});
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1([ix], actor.publicKey, blockhash, 200_000);
  const signed = signV1(encoded, [ix], actor.publicKey, blockhash, [actor]);
  const sim = await rpc(FORK, 'simulateTransaction', [
    signed.wire.toString('base64'), {encoding: 'base64', sigVerify: true,
      replaceRecentBlockhash: false, commitment: 'processed',
      innerInstructions: true, accounts: {encoding: 'base64',
        addresses: addresses.map(address => address.toBase58())}},
  ]);
  const after = sim.value.accounts || [];
  const receipt = {
    schema: 'orca-pr1396-economic-harvest-collect-control/v1',
    execution: 'signed transaction-v1 simulation on local Surfpool fork only',
    mainnetSubmission: false, fork: FORK, actor: OWNED.actor,
    position: OWNED.position, positionNftAta: OWNED.positionNftAta,
    nftAmount, err: sim.value.err || null,
    unitsConsumed: sim.value.unitsConsumed,
    wire: {version: 1, bytes: encoded.sizeBytes,
      accounts: encoded.addressCount,
      instructions: encoded.instructionCount,
      sha256: crypto.createHash('sha256').update(signed.wire).digest('hex')},
    beforePosition, afterPosition: positionImage(after[0]),
    tokenDeltas: Object.fromEntries(addresses.slice(1).map((address, offset) => {
      const first = tokenAmount(before[offset + 1]);
      const last = tokenAmount(after[offset + 1]);
      return [address.toBase58(), first !== null && last !== null
        ? String(BigInt(last) - BigInt(first)) : null];
    })),
    logs: sim.value.logs || [],
  };
  const out = path.join(__dirname, 'economic-harvest-collect-control.json');
  fs.writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({err: receipt.err, unitsConsumed: receipt.unitsConsumed,
    beforePosition: receipt.beforePosition,
    afterPosition: receipt.afterPosition, tokenDeltas: receipt.tokenDeltas}));
  if (receipt.err || Object.values(receipt.tokenDeltas).some(delta => delta !== '0'))
    throw new Error('CollectFees zero-fee control did not produce zero transfers');
}

main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
