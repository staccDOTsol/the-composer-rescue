#!/usr/bin/env node
// Read-only mainnet simulation of the deployed SKR staking program.
const fs = require('fs');
const path = require('path');
const { PublicKey, Transaction, TransactionInstruction } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('=')).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const OUT = __dirname;
const PROGRAM = 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';
const CONFIG = '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw';
const VAULT = '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const EVENT = '8rUTGg1XoyuvK9G64S7d37m3HtLZH24oPeMmXkpJH8ir';
const STAKE = process.env.SKR_TARGET_STAKE || 'AyTRxXrpfqcdbvujMnfYxAuHLxBvg2yHKA4pY6iojGYh';
const USER = process.env.SKR_TARGET_USER || 'HYfMMJgND4yuTLWTj67unqexHJjNpcGbc6SjYF4pBxsr';
const USER_ATA = process.env.SKR_TARGET_ATA || '3Czrym7atZ31uWbNpXvQppzuVLu15Lztr7hmcbVDTSjo';
const PAYER = '5vwuHxvdfmiNWNXY38aLiroE9RBaXiVAft55vKMsUVaP';
const PAYER_ATA = 'ErVcaaoQsJMuabLDpMAMgTSg1gNtd5oZWVqy9ozyeqYn';
const PK = (s) => new PublicKey(s);
const idl = JSON.parse(fs.readFileSync(path.join(OUT, 'official-sample-idl.json')));
const withdraw = idl.instructions.find((ix) => ix.name === 'withdraw');
const keyNames = withdraw.accounts.map((a) => a.name);

async function rpc(method, params) {
  const response = await fetch(env.RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error(`${method}: ${JSON.stringify(json.error || response.status)}`);
  return json.result;
}
function accountMap(override = {}) {
  return { user_stake: STAKE, stake_config: CONFIG, user: USER, stake_vault: VAULT,
    user_token_account: USER_ATA, token_program: TOKEN, event_authority: EVENT, program: PROGRAM,
    ...override };
}
function makeWithdraw(override = {}) {
  const byName = accountMap(override);
  return new TransactionInstruction({ programId: PK(PROGRAM),
    keys: withdraw.accounts.map((a) => ({ pubkey: PK(byName[a.name]), isWritable: !!a.writable, isSigner: !!a.signer })),
    data: Buffer.from(withdraw.discriminator) });
}
function decodeU64(bytes) { return bytes?.length >= 72 ? bytes.readBigUInt64LE(64).toString() : null; }
function decodePending(bytes) { return bytes?.length === 169 ? bytes.readBigUInt64LE(153).toString() : null; }
function decodeShare(bytes) { return bytes?.length === 169 ? bytes.readBigUInt64LE(105).toString() : null; }
function decodeU128(bytes, offset) {
  if (!bytes || bytes.length < offset + 16) return null;
  let amount = 0n;
  for (let i = 15; i >= 0; i -= 1) amount = (amount << 8n) + BigInt(bytes[offset + i]);
  return amount.toString();
}
function resultAccount(row) { return row ? { owner: row.owner, lamports: row.lamports, data: Buffer.from(row.data[0], 'base64') } : null; }
function slimAccount(row, key) {
  if (!row) return null;
  const bytes = row.data;
  return { address: key, owner: row.owner, lamports: row.lamports, dataLength: bytes.length,
    rawTokenAmount: row.owner === TOKEN ? decodeU64(bytes) : undefined,
    userStakePending: row.owner === PROGRAM && bytes.length === 169 ? decodePending(bytes) : undefined,
    userStakeSharesLow64: row.owner === PROGRAM && bytes.length === 169 ? decodeShare(bytes) : undefined,
    userStakeTimestamp: row.owner === PROGRAM && bytes.length === 169 ? bytes.readBigInt64LE(161).toString() : undefined,
    configTotalShares: row.owner === PROGRAM && bytes.length === 193 ? decodeU128(bytes, 121) : undefined,
    configSharePrice: row.owner === PROGRAM && bytes.length === 193 ? decodeU128(bytes, 137) : undefined,
    configCooldownSeconds: row.owner === PROGRAM && bytes.length === 193 ? bytes.readBigUInt64LE(113).toString() : undefined,
    configLastVaultAmount: row.owner === PROGRAM && bytes.length === 193 ? bytes.readBigUInt64LE(185).toString() : undefined };
}
async function runCase(name, instructions, observedAddresses) {
  const transaction = new Transaction({ feePayer: PK(PAYER), recentBlockhash: '11111111111111111111111111111111' });
  for (const ix of instructions) transaction.add(ix);
  const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const response = await rpc('simulateTransaction', [serialized, { encoding: 'base64', sigVerify: false,
    replaceRecentBlockhash: true, commitment: 'confirmed', innerInstructions: true,
    accounts: { encoding: 'base64', addresses: observedAddresses } }]);
  const after = Object.fromEntries(observedAddresses.map((key, i) => [key, slimAccount(resultAccount(response.value.accounts?.[i]), key)]));
  return { name, err: response.value.err, unitsConsumed: response.value.unitsConsumed,
    logs: response.value.logs, innerInstructions: response.value.innerInstructions, after };
}

async function main() {
  const observed = [VAULT, USER_ATA, PAYER_ATA, STAKE, CONFIG];
  const prior = await rpc('getMultipleAccounts', [observed, { encoding: 'base64', commitment: 'confirmed' }]);
  const before = Object.fromEntries(observed.map((key, i) => [key, slimAccount(resultAccount(prior.value[i]), key)]));
  const cases = [];
  cases.push(await runCase('valid_permissionless_withdraw_to_stored_user_ata', [makeWithdraw()], observed));
  cases.push(await runCase('redirect_destination_to_other_user_ata', [makeWithdraw({ user_token_account: PAYER_ATA })], observed));
  cases.push(await runCase('substitute_user_with_fee_payer', [makeWithdraw({ user: PAYER })], observed));
  cases.push(await runCase('substitute_vault_with_user_ata', [makeWithdraw({ stake_vault: USER_ATA })], observed));
  cases.push(await runCase('alias_destination_with_vault', [makeWithdraw({ user_token_account: VAULT })], observed));
  const swapped = makeWithdraw();
  [swapped.keys[0], swapped.keys[1]] = [swapped.keys[1], swapped.keys[0]];
  cases.push(await runCase('swap_user_stake_config_account_order', [swapped], observed));
  cases.push(await runCase('repeat_withdraw_in_same_transaction', [makeWithdraw(), makeWithdraw()], observed));
  const report = { generatedAt: new Date().toISOString(), noTransactionsSubmitted: true,
    program: PROGRAM, idlSource: 'official Solana Mobile sample commit d7ae7b13a8fc280985d69244ea2c4eade30542a6',
    payer: PAYER, targetUser: USER, payerAndTargetUserDiffer: PAYER !== USER,
    targetUserNotSignerOnWithdrawInstruction: !withdraw.accounts.find((a) => a.name === 'user').signer,
    contextSlot: prior.context.slot, accountOrder: keyNames, before, cases };
  const file = path.join(OUT, process.env.SKR_OUTPUT_BASENAME || 'withdraw-simulations.json');
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ file, contextSlot: report.contextSlot, before, cases: cases.map((c) => ({ name: c.name,
    err: c.err, unitsConsumed: c.unitsConsumed, keyLogs: c.logs.filter((l) => /Instruction:|Error Code:|Error Message:|failed:/.test(l)),
    after: c.after })) }, null, 2));
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
