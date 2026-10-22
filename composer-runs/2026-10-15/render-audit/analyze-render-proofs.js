#!/usr/bin/env node
'use strict';

// Read-only decoder for the exact Wormhole objects consumed by recent
// ReceiveRenderV3 calls. No transaction construction or submission exists.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey} = require(`${MOD}/@solana/web3.js`);
const {getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID} = require(`${MOD}/@solana/spl-token`);

const DIR = __dirname;
const INPUT = JSON.parse(fs.readFileSync(path.join(DIR, 'render-current-state-and-history.json')));
const OUT = path.join(DIR, 'render-v3-proof-binding.json');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC = env.HEAVY_RPC_URL || env.RPC_URL;
if (!RPC) throw new Error('Missing read-only RPC');
const CORE = new PublicKey('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth');
const TOKEN_BRIDGE = new PublicKey('wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb');
const MINT = new PublicKey(INPUT.mint.address || 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof');
const DISC = 'd6d621d0b8a1dcab';
let id = 0;

async function rpc(method, params) {
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const amountBe = (data) => BigInt(`0x${data.toString('hex')}`).toString();

function parsePostedVaa(data) {
  if (data.subarray(0, 3).toString() !== 'vaa' || data.length < 229) throw new Error('not PostedVAA');
  const emitterChain = data.readUInt16LE(57);
  const emitterBytes = Buffer.from(data.subarray(59, 91));
  const emitterAddress = new PublicKey(emitterBytes);
  const sequence = data.readBigUInt64LE(49);
  const p = data.subarray(95);
  const payloadType = p[0];
  if (payloadType !== 3) throw new Error(`expected TransferWithPayload type 3, got ${payloadType}`);
  const amountRaw = amountBe(p.subarray(1, 33));
  const tokenAddress = new PublicKey(p.subarray(33, 65));
  const tokenChain = p.readUInt16BE(65);
  const to = new PublicKey(p.subarray(67, 99));
  const toChain = p.readUInt16BE(99);
  const fromAddress = new PublicKey(p.subarray(101, 133));
  const app = p.subarray(133);
  const appPayloadType = app[0];
  const recipientOffset = app.length === 34 ? 2 : 1;
  const recipient = new PublicKey(app.subarray(recipientOffset, recipientOffset + 32));
  const chainBe = Buffer.from([emitterChain >> 8, emitterChain & 0xff]);
  const sequenceBe = Buffer.from(sequence.toString(16).padStart(16, '0'), 'hex');
  const [claim] = PublicKey.findProgramAddressSync([emitterBytes, chainBe, sequenceBe], TOKEN_BRIDGE);
  const [endpoint] = PublicKey.findProgramAddressSync([chainBe, emitterBytes], TOKEN_BRIDGE);
  return {emitterChain, emitterAddress: emitterAddress.toBase58(), sequence: sequence.toString(),
    payloadType, amountRaw, tokenAddress: tokenAddress.toBase58(), tokenChain,
    to: to.toBase58(), toChain, fromAddress: fromAddress.toBase58(),
    appPayloadLength: app.length, appPayloadType,
    subsidizedFlag: app.length === 34 ? app[1] : null,
    recipient: recipient.toBase58(), claim: claim.toBase58(), endpoint: endpoint.toBase58()};
}

async function main() {
  const calls = [];
  for (const tx of INPUT.transactions) {
    for (const ix of tx.top) {
      if (ix.programId === INPUT.addresses.bridge && ix.dataHex.startsWith(DISC)) {
        calls.push({signature: tx.signature, slot: tx.slot, ix});
      }
    }
  }
  const sampled = calls;
  const addresses = [...new Set(sampled.flatMap(({ix}) => [11, 17, 18, 19].map((i) => ix.accounts[i].address)))];
  const accountResponse = await rpc('getMultipleAccounts', [addresses,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const accounts = Object.fromEntries(addresses.map((address, i) => [address, accountResponse.value[i]]));
  const rows = sampled.map(({signature, slot, ix}) => {
    const postedAddress = ix.accounts[17].address;
    const postedAccount = accounts[postedAddress];
    if (!postedAccount) throw new Error(`missing PostedVAA ${postedAddress}`);
    const data = Buffer.from(postedAccount.data[0], 'base64');
    const parsed = parsePostedVaa(data);
    const instructionHash = Buffer.from(ix.dataHex.slice(16), 'hex');
    const [expectedPostedVaa] = PublicKey.findProgramAddressSync(
      [Buffer.from('PostedVAA'), instructionHash], CORE);
    const recipientAta = getAssociatedTokenAddressSync(MINT, new PublicKey(parsed.recipient));
    const claimAccount = accounts[ix.accounts[18].address];
    return {signature, slot, payer: ix.accounts[0].address,
      instructionHashHex: instructionHash.toString('hex'),
      postedVaa: postedAddress, postedVaaOwner: postedAccount.owner,
      postedVaaDataLength: data.length, postedVaaDataSha256: sha256(data),
      postedVaaPdaMatchesInstructionHash: expectedPostedVaa.toBase58() === postedAddress,
      claim: ix.accounts[18].address, claimPdaMatchesMessage: parsed.claim === ix.accounts[18].address,
      claimExists: !!claimAccount, claimOwner: claimAccount?.owner || null,
      endpoint: ix.accounts[19].address, endpointPdaMatchesEmitter: parsed.endpoint === ix.accounts[19].address,
      recipientWalletAccount: ix.accounts[12].address,
      recipientWalletMatchesSignedPayload: parsed.recipient === ix.accounts[12].address,
      recipientAtaAccount: ix.accounts[11].address,
      recipientAtaCurrentlyExists: !!accounts[ix.accounts[11].address],
      recipientAtaCurrentLamports: String(accounts[ix.accounts[11].address]?.lamports || 0),
      recipientAtaMatchesSignedPayload: recipientAta.toBase58() === ix.accounts[11].address,
      vault: ix.accounts[10].address, mint: ix.accounts[9].address,
      tokenProgram: ix.accounts[22].address, parsed};
  });
  const output = {generatedAt: new Date().toISOString(), observedSlot: accountResponse.context.slot,
    safety: {readOnly: true, mainnetTransactionsSubmitted: false},
    sampledSuccessfulCalls: rows.length, allBindingsMatch: rows.every((row) =>
      row.postedVaaOwner === CORE.toBase58() && row.postedVaaPdaMatchesInstructionHash &&
      row.claimPdaMatchesMessage && row.claimExists && row.claimOwner === TOKEN_BRIDGE.toBase58() &&
      row.endpointPdaMatchesEmitter && row.recipientWalletMatchesSignedPayload &&
      row.recipientAtaMatchesSignedPayload && row.mint === MINT.toBase58() &&
      row.tokenProgram === TOKEN_PROGRAM_ID.toBase58()), rows};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, observedSlot: output.observedSlot,
    sampledSuccessfulCalls: output.sampledSuccessfulCalls, allBindingsMatch: output.allBindingsMatch,
    first: rows[0]}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
