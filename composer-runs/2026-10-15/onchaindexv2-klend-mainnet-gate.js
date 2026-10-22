#!/usr/bin/env node
'use strict';
// Signed mainnet-beta simulations only. No sendTransaction or synthetic account balances.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { Keypair, PublicKey, TransactionInstruction, TransactionMessage } = require(`${MOD}/@solana/web3.js`);
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require(`${MOD}/@solana/spl-token`);
const bs58 = require(`${MOD}/bs58`);
const { encodeV1 } = require('./klend-v1-composition.js');
const P = value => new PublicKey(value);
const PROGRAM = '1qbkdrr3z4ryLA7pZykqxvxWPoeifcVKo6ZG9CfkvVE';
const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const STATE = '9P3N4QxjMumpTNNdvaNNskXu2t7VHMMXtePQB72kkSAk';
const VAULT_USDC = 'HkGq6HSQZeoah15RbyYK2YF6bfCkNmAK4F5VDxYMiwJv';
const VAULT_USDT = 'PRYpoFwPHBcL82JGeqrU7czwmQiSHa9udbeTbtXLv7d';
const SOURCE = '3Tr8Zsi2YpJMkkmL36YxxEj8KFhor4mXc6kp9BDo2gobJsJBWpyhD7hYfz76FBjYTczVmcXLpaKYVvGsUJkxUF8t';
const RESERVE = 'AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z';
const INPUT = 892_432n;
const PRIOR_OUTPUT = 893_142n;
const OUT = `${__dirname}/onchaindexv2-klend-mainnet-gate.json`;

const secret = JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'));
if (!Array.isArray(secret) || secret.length !== 64) throw Error('invalid audit keypair shape');
const signer = Keypair.fromSecretKey(Uint8Array.from(secret));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
if (!endpoint) throw Error('mainnet RPC endpoint unavailable');
let requestId = 0;
async function rpc(method, params = []) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }) });
  const result = await response.json();
  if (result.error) throw Error(`${method}: ${JSON.stringify(result.error)}`);
  return result.result;
}
function image(account) {
  if (!account) return null;
  const b = Buffer.from(account.data[0], 'base64');
  const token = account.owner === String(TOKEN_PROGRAM_ID) && b.length >= 165;
  return { owner: account.owner, lamports: account.lamports,
    mint: token ? String(new PublicKey(b.subarray(0, 32))) : null,
    tokenAuthority: token ? String(new PublicKey(b.subarray(32, 64))) : null,
    raw: token ? b.readBigUInt64LE(64).toString() : null,
    sha256: crypto.createHash('sha256').update(b).digest('hex') };
}
function historicalTopIx(tx, index) {
  const m = tx.transaction.message, loaded = tx.meta.loadedAddresses || { writable: [], readonly: [] };
  const all = [...m.accountKeys, ...loaded.writable, ...loaded.readonly];
  const h = m.header, n = m.accountKeys.length, src = m.instructions[index];
  const writable = j => j < n ? j < h.numRequiredSignatures ?
    j < h.numRequiredSignatures - h.numReadonlySignedAccounts :
    j < n - h.numReadonlyUnsignedAccounts : j < n + loaded.writable.length;
  return new TransactionInstruction({ programId: P(all[src.programIdIndex]),
    keys: src.accounts.map(j => ({ pubkey: P(all[j]), isSigner: j < h.numRequiredSignatures,
      isWritable: writable(j) })), data: Buffer.from(bs58.decode(src.data)) });
}
async function stableSwapIx(userUsdc, userUsdt) {
  const tx = await rpc('getTransaction', [SOURCE, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
  if (!tx || tx.meta.err) throw Error('historical selected Swap source unavailable');
  const m = tx.transaction.message, loaded = tx.meta.loadedAddresses || { writable: [], readonly: [] };
  const all = [...m.accountKeys, ...loaded.writable, ...loaded.readonly], h = m.header, n = m.accountKeys.length;
  const src = tx.meta.innerInstructions.flatMap(g => g.instructions)
    .find(ix => all[ix.programIdIndex] === PROGRAM && ix.accounts.length >= 17 &&
      all[ix.accounts[0]] === STATE && all[ix.accounts[5]] === VAULT_USDC &&
      all[ix.accounts[6]] === VAULT_USDT);
  if (!src) throw Error('historical selected Swap instruction unavailable');
  const writable = j => j < n ? j < h.numRequiredSignatures ?
    j < h.numRequiredSignatures - h.numReadonlySignedAccounts :
    j < n - h.numReadonlyUnsignedAccounts : j < n + loaded.writable.length;
  const keys = src.accounts.map((j, i) => ({
    pubkey: i === 7 ? userUsdc : i === 8 ? userUsdt : i === 9 ? signer.publicKey : P(all[j]),
    isSigner: i === 9, isWritable: writable(j) }));
  const data = Buffer.from(bs58.decode(src.data));
  if (data.readBigUInt64LE(8) !== INPUT) throw Error('historical selected Swap amount changed');
  return { sourceSlot: tx.slot, ix: new TransactionInstruction({ programId: P(PROGRAM), keys, data }) };
}
function flashIx(template, reserve, userUsdc, amount, borrowIndex) {
  const keys = template.keys.map(k => ({ ...k }));
  const market = P(reserve.market);
  const lma = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], P(KLEND))[0];
  for (const [i, address] of Object.entries({ 0: signer.publicKey, 1: lma, 2: market,
    3: P(reserve.reserve), 4: P(USDC), 5: P(reserve.supplyVault), 6: userUsdc,
    7: P(reserve.feeVault), 11: TOKEN_PROGRAM_ID })) keys[Number(i)].pubkey = address;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (borrowIndex !== undefined) data[16] = borrowIndex;
  return new TransactionInstruction({ programId: P(KLEND), keys, data });
}
async function jupiterQuote(amount) {
  const url = new URL('https://lite-api.jup.ag/swap/v1/quote');
  for (const [key, value] of Object.entries({ inputMint: USDT, outputMint: USDC,
    amount: String(amount), swapMode: 'ExactIn', slippageBps: '50',
    maxAccounts: '24', restrictIntermediateTokens: 'true' })) url.searchParams.set(key, value);
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.outAmount) throw Error(`independent exit quote unavailable: ${body.error || response.status}`);
  return body;
}
function quoteImage(quote, inputRaw) {
  return { contextSlot: quote.contextSlot, inAmount: quote.inAmount,
    outAmount: quote.outAmount, otherAmountThreshold: quote.otherAmountThreshold,
    netAfterRepayRaw: String(BigInt(quote.outAmount) - inputRaw),
    route: quote.routePlan.map(step => ({ label: step.swapInfo.label, ammKey: step.swapInfo.ammKey,
      percent: step.percent })) };
}
function fromJupiter(ix) {
  return new TransactionInstruction({ programId: P(ix.programId),
    keys: ix.accounts.map(a => ({ pubkey: P(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, 'base64') });
}
async function routeInstructionScreen(quote, borrow, swap, repay, blockhash) {
  const response = await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: String(signer.publicKey),
      wrapAndUnwrapSol: false, useSharedAccounts: true, dynamicComputeUnitLimit: false,
      skipUserAccountsRpcCalls: true }) });
  const built = await response.json();
  if (!response.ok || built.error || !built.swapInstruction)
    return { buildStatus: response.status, buildError: built.error || 'no swap instruction' };
  const route = [...(built.setupInstructions || []).map(fromJupiter), fromJupiter(built.swapInstruction),
    ...(built.cleanupInstruction ? [fromJupiter(built.cleanupInstruction)] : [])];
  let packet;
  try {
    const encoded = encodeV1([borrow, swap, ...route, repay], signer.publicKey, blockhash);
    packet = { v1Bytes: encoded.sizeBytes, v0NoLookupBytes: encoded.v0Bytes,
      accountCount: encoded.addressCount, instructionCount: encoded.instructionCount,
      v1Limit: 4096 };
  } catch (error) { packet = { screenError: error.message }; }
  return { buildStatus: response.status, setupInstructionCount: (built.setupInstructions || []).length,
    routeInstructionKeys: built.swapInstruction.accounts.length,
    lookupTableCount: (built.addressLookupTableAddresses || []).length,
    packet };
}
function signedV1(instructions, blockhash) {
  const encoded = encodeV1(instructions, signer.publicKey, blockhash);
  const compiled = new TransactionMessage({ payerKey: signer.publicKey,
    recentBlockhash: blockhash, instructions }).compileToV0Message();
  if (encoded.requiredSignatures !== 1 || compiled.header.numRequiredSignatures !== 1 ||
    !compiled.staticAccountKeys[0].equals(signer.publicKey)) throw Error('uncontrolled signer required');
  const wire = Buffer.from(encoded.wire);
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(signer.secretKey.subarray(0, 32)) ]), format: 'der', type: 'pkcs8' });
  crypto.sign(null, wire.subarray(0, wire.length - 64), privateKey).copy(wire, wire.length - 64);
  return { wire, encoded, keys: compiled.staticAccountKeys.map(String) };
}
function transferTrace(sim, keys) {
  const rows = [];
  for (const group of sim.value.innerInstructions || []) for (const ix of group.instructions || []) {
    if (ix.programId === String(TOKEN_PROGRAM_ID) && ix.parsed?.type === 'transferChecked') {
      rows.push({ parentInstruction: group.index, source: ix.parsed.info.source,
        destination: ix.parsed.info.destination,
        amountRaw: ix.parsed.info.tokenAmount.amount });
      continue;
    }
    if (keys[ix.programIdIndex] !== String(TOKEN_PROGRAM_ID)) continue;
    const data = Buffer.from(bs58.decode(ix.data));
    const checked = data[0] === 12, plain = data[0] === 3;
    if (!checked && !plain) continue;
    rows.push({ parentInstruction: group.index, source: keys[ix.accounts[0]],
      destination: keys[ix.accounts[checked ? 2 : 1]],
      amountRaw: data.readBigUInt64LE(1).toString() });
  }
  return rows;
}
async function main() {
  const genesisHash = await rpc('getGenesisHash');
  const userUsdc = getAssociatedTokenAddressSync(P(USDC), signer.publicKey);
  const userUsdt = getAssociatedTokenAddressSync(P(USDT), signer.publicKey);
  const reserve = JSON.parse(fs.readFileSync(`${__dirname}/klend-zero-fee-census.json`, 'utf8'))
    .activeZero.find(row => row.reserve === RESERVE);
  if (!reserve || reserve.flashFeeSf !== '0' || reserve.mint !== USDC)
    throw Error('pinned KLend zero-fee USDC reserve missing');
  const history = JSON.parse(fs.readFileSync(`${__dirname}/kamino-flash-history.json`, 'utf8')).hits[0].transaction;
  const borrow = flashIx(historicalTopIx(history, 3), reserve, userUsdc, INPUT);
  const repay = flashIx(historicalTopIx(history, 13), reserve, userUsdc, INPUT, 0);
  const selected = await stableSwapIx(userUsdc, userUsdt);
  const watch = [String(userUsdc), String(userUsdt), reserve.supplyVault, reserve.feeVault,
    reserve.reserve, VAULT_USDC, VAULT_USDT, STATE];
  const before = await rpc('getMultipleAccounts', [watch, { encoding: 'base64', commitment: 'confirmed' }]);
  const pre = before.value.map(image);
  const reserveData = Buffer.from(before.value[4].data[0], 'base64');
  const available = reserveData.readBigUInt64LE(224);
  const feeSf = reserveData.readBigUInt64LE(4904);
  if (feeSf !== 0n || available < INPUT) throw Error('KLend fee or available amount changed');
  if (pre[0]?.raw !== '0' || pre[1]?.raw !== '0' ||
    pre[0]?.tokenAuthority !== String(signer.publicKey) ||
    pre[1]?.tokenAuthority !== String(signer.publicKey))
    throw Error('audit signer token accounts changed');
  if (pre[7]?.owner !== PROGRAM || PublicKey.isOnCurve(P(STATE).toBytes()) ||
    pre[5]?.tokenAuthority !== STATE || pre[6]?.tokenAuthority !== STATE)
    throw Error('selected stable-pool authority changed');
  const blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
  const quotePrior = await jupiterQuote(PRIOR_OUTPUT);
  const exitScreen = await routeInstructionScreen(quotePrior, borrow, selected.ix, repay, blockhash);
  const signed = signedV1([borrow, selected.ix, repay], blockhash);
  const sim = await rpc('simulateTransaction', [signed.wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'confirmed', innerInstructions: true,
    accounts: { encoding: 'base64', addresses: watch } }]);
  const transfers = transferTrace(sim, signed.keys);
  const selectedOutput = transfers.find(row => row.source === VAULT_USDT &&
    row.destination === String(userUsdt))?.amountRaw || null;
  const quoteActual = selectedOutput && selectedOutput !== String(PRIOR_OUTPUT) ?
    await jupiterQuote(selectedOutput) : quotePrior;
  const after = await rpc('getMultipleAccounts', [watch, { encoding: 'base64', commitment: 'confirmed' }]);
  const postRead = after.value.map(image);
  const report = { observedAtUtc: new Date().toISOString(), network: 'mainnet-beta', genesisHash,
    program: PROGRAM, signer: String(signer.publicKey), selectedSource: SOURCE,
    selectedSourceSlot: selected.sourceSlot,
    klend: { reserve: RESERVE, supplyVault: reserve.supplyVault, feeVault: reserve.feeVault,
      availableRaw: String(available), feeSf: String(feeSf) },
    inputUsdcRaw: String(INPUT), priorLocalForkOutputUsdtRaw: String(PRIOR_OUTPUT),
    initialExitQuote: quoteImage(quotePrior, INPUT), exitPacketScreen: exitScreen,
    preSlot: before.context.slot, simulationSlot: sim.context.slot, postReadSlot: after.context.slot,
    watch, pre, postRead, postReadHashesMatch: pre.map((a, i) => a?.sha256 === postRead[i]?.sha256),
    fundedSwapSimulation: { tx: { version: 1, bytes: signed.encoded.sizeBytes,
      v0NoLookupBytes: signed.encoded.v0Bytes, accountCount: signed.encoded.addressCount,
      instructionCount: signed.encoded.instructionCount, requiredSignatures: signed.encoded.requiredSignatures,
      sigVerify: true, sha256: crypto.createHash('sha256').update(signed.wire).digest('hex') },
      err: sim.value.err, unitsConsumed: sim.value.unitsConsumed,
      selectedOutputUsdtRaw: selectedOutput, transfers,
      innerInstructions: sim.value.innerInstructions || null,
      returnData: sim.value.returnData || null,
      simulatedPost: (sim.value.accounts || []).map(image), logs: sim.value.logs || [] },
    actualOutputExitQuote: quoteImage(quoteActual, INPUT) };
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUT, preSlot: report.preSlot,
    simulationSlot: report.simulationSlot, postReadSlot: report.postReadSlot,
    fundedSwapErr: report.fundedSwapSimulation.err,
    selectedOutputUsdtRaw: selectedOutput,
    independentExitUsdcRaw: report.actualOutputExitQuote.outAmount,
    netAfterRepayRaw: report.actualOutputExitQuote.netAfterRepayRaw,
    packet: report.exitPacketScreen.packet,
    postReadHashesMatch: report.postReadHashesMatch,
    logs: report.fundedSwapSimulation.logs.filter(x => x.includes('Instruction:') ||
      x.includes('failed:') || x.includes('Error:')).slice(-20) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
