#!/usr/bin/env node
// Read-only mainnet simulations. sigVerify:false allows hypothetical PDA signers;
// those cases establish program checks only, not executable top-level authority.
const fs = require('fs');
const path = require('path');
const { PublicKey, Transaction, TransactionInstruction } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('=')).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const OUT = __dirname;
const PROGRAM = 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';
const CONFIG = '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw';
const AUTHORITY = 'Hgbea5UFVXD3dQoL2mJbXLVnnFFRqyJJis9vfm69w5oQ';
const PAYER = '5vwuHxvdfmiNWNXY38aLiroE9RBaXiVAft55vKMsUVaP';
const EVENT = '8rUTGg1XoyuvK9G64S7d37m3HtLZH24oPeMmXkpJH8ir';
const PK = (s) => new PublicKey(s);
const idl = JSON.parse(fs.readFileSync(path.join(OUT, 'official-sample-idl.json')));
const update = idl.instructions.find((ix) => ix.name === 'update_stake_config');

async function rpc(method, params) {
  const response = await fetch(env.RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error(`${method}: ${JSON.stringify(json.error || response.status)}`);
  return json.result;
}
function makeUpdate({ authority = AUTHORITY, markedSigner = true, swappedOrder = false, cooldownSeconds = null } = {}) {
  const accounts = { stake_config: CONFIG, authority, event_authority: EVENT, program: PROGRAM };
  const keys = update.accounts.map((a) => ({ pubkey: PK(accounts[a.name]), isWritable: !!a.writable,
    isSigner: a.name === 'authority' ? markedSigner : !!a.signer }));
  if (swappedOrder) [keys[0], keys[1]] = [keys[1], keys[0]];
  // Anchor/Borsh UpdateStakeConfigArgs: Option<u64> min, Option<u64> cooldown, Option<Pubkey> authority.
  const payload = cooldownSeconds === null ? Buffer.from([0, 0, 0]) :
    Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(8), Buffer.from([0])]);
  if (cooldownSeconds !== null) payload.writeBigUInt64LE(BigInt(cooldownSeconds), 2);
  return new TransactionInstruction({ programId: PK(PROGRAM), keys,
    data: Buffer.concat([Buffer.from(update.discriminator), payload]) });
}
async function simulate(name, ix) {
  const tx = new Transaction({ feePayer: PK(PAYER), recentBlockhash: '11111111111111111111111111111111' });
  tx.add(ix);
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const response = await rpc('simulateTransaction', [raw, { encoding: 'base64', sigVerify: false,
    replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [CONFIG] } }]);
  return { name, error: response.value.err, unitsConsumed: response.value.unitsConsumed,
    logs: response.value.logs, afterConfigData: response.value.accounts?.[0]?.data?.[0] || null };
}
async function main() {
  const authorityAccount = await rpc('getAccountInfo', [AUTHORITY, { encoding: 'base64', commitment: 'confirmed' }]);
  const cases = [];
  cases.push(await simulate('stored_authority_not_marked_signer', makeUpdate({ markedSigner: false })));
  cases.push(await simulate('wrong_signer_payer', makeUpdate({ authority: PAYER })));
  cases.push(await simulate('swapped_config_authority_order', makeUpdate({ swappedOrder: true })));
  cases.push(await simulate('hypothetical_stored_authority_signer_noop_update', makeUpdate()));
  cases.push(await simulate('hypothetical_stored_authority_signer_zero_cooldown', makeUpdate({ cooldownSeconds: 0 })));
  const report = { generatedAt: new Date().toISOString(), noTransactionsSubmitted: true,
    simulationSignatureVerification: false,
    caveat: 'The off-curve stored authority cannot sign a top-level transaction. Marking it signer in a sigVerify:false simulation is hypothetical and does not establish live control.',
    storedAuthority: AUTHORITY, storedAuthorityOffCurve: !PublicKey.isOnCurve(PK(AUTHORITY).toBytes()),
    authorityAccount: authorityAccount.value && { owner: authorityAccount.value.owner,
      dataLength: Buffer.from(authorityAccount.value.data[0], 'base64').length,
      lamports: authorityAccount.value.lamports, observedSlot: authorityAccount.context.slot },
    accountOrder: update.accounts.map((a) => a.name), cases };
  const file = path.join(OUT, 'update-simulations.json');
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ file, storedAuthorityOffCurve: report.storedAuthorityOffCurve,
    cases: cases.map((c) => ({ name: c.name, error: c.error, unitsConsumed: c.unitsConsumed,
      keyLogs: c.logs.filter((l) => /Instruction:|Error Code:|Error Message:|failed:/.test(l)) })) }, null, 2));
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
