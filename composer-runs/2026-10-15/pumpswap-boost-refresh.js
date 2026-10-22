/* Read-only current PumpSwap boost mutation probe; simulateTransaction only. */
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } = require(modules + '/@solana/web3.js');
const bs58Module = require(modules + '/bs58');
const bs58 = bs58Module.default || bs58Module;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split('\n').filter((x) => x.includes('=')).map((x) => x.split(/=(.*)/s).slice(0, 2)));
const connection = new Connection(env.RPC_URL.replace(/^['"]|['"]$/g, ''), 'confirmed');
const program = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const systemProgram = new PublicKey('11111111111111111111111111111111');
const discriminator = Buffer.from([105, 68, 6, 175, 0, 7, 35, 162]);
const attacker = new PublicKey('CBfV4E8tbEvVKhLF5DEMVv1Mx2AJD2cTykdRWEntkSBc');
const u64 = (data, offset) => data.readBigUInt64LE(offset);
const putU64 = (data, offset, value) => data.writeBigUInt64LE(BigInt(value), offset);
const tokenAmount = (info) => info && info.data.length >= 72 ? u64(info.data, 64) : null;
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const clone = (ix) => new TransactionInstruction({ programId: ix.programId, data: Buffer.from(ix.data), keys: ix.keys.map((x) => ({ ...x })) });
const mutate = (ix, index, pubkey, signer, writable) => { const out = clone(ix); out.keys[index] = { pubkey, isSigner: signer ?? out.keys[index].isSigner, isWritable: writable ?? out.keys[index].isWritable }; return out; };

function snap(info) {
  if (!info) return null;
  const amount = tokenAmount(info);
  return { owner: info.owner.toBase58(), tokenAmountRaw: amount === null ? null : amount.toString(), dataSha256: hash(info.data) };
}

function snapSim(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return { owner: account.owner, tokenAmountRaw: data.length >= 72 ? u64(data, 64).toString() : null, dataSha256: hash(data) };
}

async function simulate(label, payer, instructions, tracked) {
  const keys = [...new Set(tracked.map((x) => x.toBase58()))];
  const preInfo = await connection.getMultipleAccountsInfo(keys.map((x) => new PublicKey(x)), 'confirmed');
  const pre = Object.fromEntries(keys.map((x, i) => [x, snap(preInfo[i])]));
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const value = (await connection.simulateTransaction(new VersionedTransaction(message), { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: keys } })).value;
  const post = value.accounts ? Object.fromEntries(keys.map((x, i) => [x, snapSim(value.accounts[i])])) : null;
  return { label, error: value.err, pre, post, logs: (value.logs || []).filter((line) => /Instruction:|AnchorError|Error|failed:|Transfer|Burn/.test(line)) };
}

async function findControl() {
  let before;
  let signaturesScanned = 0;
  for (let page = 0; page < 6; page++) {
    const signatures = await connection.getSignaturesForAddress(program, { limit: 1000, ...(before ? { before } : {}) }, 'confirmed');
    if (!signatures.length) break;
    before = signatures[signatures.length - 1].signature;
    signaturesScanned += signatures.length;
    for (let start = 0; start < signatures.length; start += 40) {
      const batch = signatures.slice(start, start + 40);
      const txs = await connection.getParsedTransactions(batch.map((x) => x.signature), { commitment: 'confirmed', maxSupportedTransactionVersion: 1 });
      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i];
        if (!tx || tx.meta?.err) continue;
        const meta = new Map(tx.transaction.message.accountKeys.map((x) => [x.pubkey.toBase58(), x]));
        for (const raw of tx.transaction.message.instructions) {
          if (!raw.programId?.equals(program) || !raw.data || !raw.accounts) continue;
          const data = Buffer.from(bs58.decode(raw.data));
          if (!data.subarray(0, 8).equals(discriminator)) continue;
          const boostVault = raw.accounts[8];
          const info = await connection.getAccountInfo(boostVault, 'confirmed');
          if ((tokenAmount(info) || 0n) < 2000n) continue;
          return { signaturesScanned, page, signature: batch[i].signature, slot: tx.slot, payer: tx.transaction.message.accountKeys[0].pubkey, ix: new TransactionInstruction({ programId: program, data, keys: raw.accounts.map((pubkey) => ({ pubkey, isSigner: Boolean(meta.get(pubkey.toBase58())?.signer), isWritable: Boolean(meta.get(pubkey.toBase58())?.writable) })) }) };
        }
      }
    }
  }
  return { signaturesScanned };
}

async function main() {
  const control = await findControl();
  const output = { simulatedOnly: true, transactionNeverSubmitted: true, program: program.toBase58(), generatedAt: new Date().toISOString(), signaturesScanned: control.signaturesScanned };
  if (!control.ix) {
    output.blocker = 'No currently funded boost vault found in the bounded recent-signature search.';
  } else {
    const base = clone(control.ix);
    const available = tokenAmount(await connection.getAccountInfo(base.keys[8].pubkey, 'confirmed')) || 0n;
    let amount = u64(base.data, 8);
    if (amount > available / 20n) amount = available / 20n;
    if (amount > 100000000n) amount = 100000000n;
    putU64(base.data, 8, amount); putU64(base.data, 16, 0n);
    const authorityMutant = mutate(base, 1, attacker, true, true);
    const destinationMutant = mutate(base, 6, base.keys[8].pubkey, false, true);
    const vaultMutant = mutate(base, 8, base.keys[6].pubkey, false, true);
    const cpiMutant = mutate(base, 10, systemProgram, false, false);
    const tracked = [base.keys[0].pubkey, base.keys[5].pubkey, base.keys[6].pubkey, base.keys[8].pubkey];
    output.control = { signature: control.signature, slot: control.slot, page: control.page, payer: control.payer.toBase58(), inputAvailableRaw: available.toString(), tunedAmountRaw: amount.toString() };
    output.variants = [
      await simulate('boost:positive_control', control.payer, [base], tracked),
      await simulate('boost:authority_substitution', control.payer, [authorityMutant], tracked),
      await simulate('boost:destination_alias_boost_vault', control.payer, [destinationMutant], tracked),
      await simulate('boost:vault_alias_pool_quote', control.payer, [vaultMutant], tracked),
      await simulate('boost:cpi_program_substitution', control.payer, [cpiMutant], tracked),
      await simulate('boost:duplicate_same_transaction', control.payer, [base, clone(base)], tracked),
      await simulate('boost:positive_then_failing_authority_atomicity', control.payer, [base, authorityMutant], tracked),
    ];
  }
  fs.writeFileSync(__dirname + '/pumpswap-boost-refresh-results.json', JSON.stringify(output, null, 2));
  process.stdout.write(JSON.stringify({ blocker: output.blocker, control: output.control, variants: output.variants?.map((x) => ({ label: x.label, error: x.error })) }, null, 2) + '\n');
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
