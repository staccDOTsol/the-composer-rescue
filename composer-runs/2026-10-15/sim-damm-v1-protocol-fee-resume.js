// Read-only protocol-fee wrapper and direct-call mutation simulations.
const fs = require('fs');
const { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58mod = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58mod.default || bs58mod;
const root = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/';
const outputPath = root + 'damm-v1-protocol-fee-simulation-resume.json';
const signature = '3XSfFvsDnCsXcbwDHAoKMGPvobxMdkWAa3LMbN6xHqCZPh1q6aKb4t1wPihdUuXv74KjCtyou8rZ1bnthDWmatfx';
const wrapper = new PublicKey('pFee3tb7qh5z53jRF4PbLwmNd148Q8ypLNZbqsMeinA');
const damm = new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');
const amount = info => info && info.data.length >= 72 ? info.data.readBigUInt64LE(64).toString() : null;

async function simulate(rpcUrl, payer, instruction, monitor, blockhash) {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [instruction] }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const request = { jsonrpc: '2.0', id: 1, method: 'simulateTransaction', params: [Buffer.from(tx.serialize()).toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', innerInstructions: true,
    accounts: { encoding: 'base64', addresses: monitor.map(x => x.toBase58()) },
  }] };
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  const json = await response.json();
  if (json.error) return { transportError: json.error };
  const post = {};
  monitor.forEach((key, index) => {
    const entry = json.result.value.accounts?.[index];
    post[key.toBase58()] = entry && entry.data ? amount({ data: Buffer.from(entry.data[0], 'base64') }) : null;
  });
  return { slot: json.result.context.slot, err: json.result.value.err, unitsConsumed: json.result.value.unitsConsumed, logs: json.result.value.logs, innerInstructions: json.result.value.innerInstructions, post };
}

async function main() {
  const connection = new Connection(process.env.RPC_URL, 'confirmed');
  const original = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 });
  const staticKeys = original.transaction.message.staticAccountKeys;
  const allKeys = [...staticKeys, ...(original.meta.loadedAddresses?.writable || []), ...(original.meta.loadedAddresses?.readonly || [])].map(x => new PublicKey(x));
  const header = original.transaction.message.header;
  const writable = index => {
    if (index < header.numRequiredSignatures) return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
    if (index < staticKeys.length) return index < staticKeys.length - header.numReadonlyUnsignedAccounts;
    return index < staticKeys.length + (original.meta.loadedAddresses?.writable || []).length;
  };
  const top = original.transaction.message.compiledInstructions.find(ix => allKeys[ix.programIdIndex].equals(wrapper));
  const topIndexes = Array.from(top.accountKeyIndexes);
  const base = topIndexes.map(index => ({ pubkey: allKeys[index], isWritable: writable(index), isSigner: index < header.numRequiredSignatures }));
  const data = Buffer.isBuffer(top.data) ? top.data : Buffer.from(bs58.decode(top.data));
  const payer = allKeys[0];
  const receiver = base[4].pubkey;
  const protocolA = base[10].pubkey;
  const protocolB = base[11].pubkey;
  const monitor = [receiver, protocolA, protocolB];
  const pre = await connection.getMultipleAccountsInfoAndContext(monitor, 'confirmed');
  const before = Object.fromEntries(monitor.map((key, index) => [key.toBase58(), amount(pre.value[index])]));
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const alternateVaultLp = new PublicKey(JSON.parse(fs.readFileSync(root + 'damm-v1-integration-census-resume.json')).pools[0].legs[0].vaultLp);
  const cases = [
    { name: 'wrapper_baseline', programId: wrapper, mutate: () => {} },
    { name: 'wrapper_receiver_is_protocol_source', programId: wrapper, mutate: accounts => { accounts[4].pubkey = protocolB; } },
    { name: 'wrapper_wrong_pool', programId: wrapper, mutate: accounts => { accounts[9].pubkey = new PublicKey(JSON.parse(fs.readFileSync(root + 'damm-v1-integration-census-resume.json')).pools[0].pool); } },
    { name: 'wrapper_wrong_a_vault_lp', programId: wrapper, mutate: accounts => { accounts[12].pubkey = alternateVaultLp; } },
    { name: 'wrapper_protocol_a_is_protocol_b', programId: wrapper, mutate: accounts => { accounts[10].pubkey = protocolB; } },
  ];
  const outcomes = [];
  for (const test of cases) {
    const accounts = base.map(x => ({ ...x })); test.mutate(accounts);
    const result = await simulate(process.env.RPC_URL, payer, new TransactionInstruction({ programId: test.programId, keys: accounts, data }), monitor, blockhash);
    const deltas = {};
    for (const key of monitor) {
      const address = key.toBase58();
      deltas[address] = before[address] !== null && result.post?.[address] !== null ? (BigInt(result.post[address]) - BigInt(before[address])).toString() : null;
    }
    outcomes.push({ name: test.name, accounts: accounts.map(x => x.pubkey.toBase58()), result: { ...result, deltas } });
  }

  const directAccounts = [
    { pubkey: base[4].pubkey, isWritable: true, isSigner: false },
    { pubkey: base[5].pubkey, isWritable: false, isSigner: false },
    { pubkey: base[6].pubkey, isWritable: false, isSigner: false },
    { pubkey: base[7].pubkey, isWritable: false, isSigner: false },
    { pubkey: base[8].pubkey, isWritable: false, isSigner: false },
    { pubkey: base[9].pubkey, isWritable: false, isSigner: false },
    { pubkey: base[10].pubkey, isWritable: true, isSigner: false },
    { pubkey: base[11].pubkey, isWritable: true, isSigner: false },
    { pubkey: base[12].pubkey, isWritable: false, isSigner: false },
    { pubkey: base[13].pubkey, isWritable: false, isSigner: true },
  ];
  const innerData = Buffer.alloc(16);
  Buffer.from([235, 194, 54, 69, 65, 10, 236, 112]).copy(innerData);
  data.subarray(data.length - 8).copy(innerData, 8);
  const direct = await simulate(process.env.RPC_URL, payer, new TransactionInstruction({ programId: damm, keys: directAccounts, data: innerData }), monitor, blockhash);
  const directDeltas = {};
  for (const key of monitor) {
    const address = key.toBase58();
    directDeltas[address] = before[address] !== null && direct.post?.[address] !== null ? (BigInt(direct.post[address]) - BigInt(before[address])).toString() : null;
  }
  outcomes.push({ name: 'direct_claim_protocol_fee2_with_fixed_signer_meta', accounts: directAccounts.map(x => x.pubkey.toBase58()), result: { ...direct, deltas: directDeltas } });

  const output = { timestamp: new Date().toISOString(), historicalSignature: signature, historicalSlot: original.slot, historicalError: original.meta.err, program: damm.toBase58(), wrapper: wrapper.toBase58(), payer: payer.toBase58(), monitor: monitor.map(x => x.toBase58()), preSlot: pre.context.slot, before, outcomes };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ outputPath, historicalSlot: original.slot, outcomes: outcomes.map(x => ({ name: x.name, err: x.result.err || x.result.transportError, deltas: x.result.deltas, tail: x.result.logs?.slice(-5) })) }, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
