// Read-only current-state DAMM v1 swap/account-alias/composition simulations.
const fs = require('fs');
const { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58mod = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58mod.default || bs58mod;
const root = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/';
const outputPath = root + 'damm-v1-swap-composition-simulation-resume.json';
const damm = new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');
const vaultProgram = new PublicKey('24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi');
const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const fundedPayer = new PublicKey('EKKhYjLqhefy16bQrpGbysxqRexZP8nXVcTTmHTzc4fz');
const swapDisc = Buffer.from([248,198,158,145,225,117,135,200]);
const tokenAmount = info => info && info.data.length >= 72 ? info.data.readBigUInt64LE(64) : null;

function allKeys(tx) {
  return [...tx.transaction.message.staticAccountKeys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])].map(x => new PublicKey(x));
}
function instructionRows(tx) {
  const keys = allKeys(tx); const rows = [];
  for (const ix of tx.transaction.message.compiledInstructions) rows.push({ program: keys[ix.programIdIndex], accounts: Array.from(ix.accountKeyIndexes).map(i => keys[i]), data: Buffer.isBuffer(ix.data) ? ix.data : Buffer.from(bs58.decode(ix.data)), location: 'outer' });
  for (const group of tx.meta.innerInstructions || []) for (const ix of group.instructions) rows.push({ program: keys[ix.programIdIndex], accounts: Array.from(ix.accounts).map(i => keys[i]), data: Buffer.isBuffer(ix.data) ? ix.data : Buffer.from(bs58.decode(ix.data)), location: `inner:${group.index}` });
  return rows;
}
function makeIx(accounts, data) {
  return new TransactionInstruction({ programId: damm, data, keys: accounts.map((pubkey, i) => ({ pubkey, isWritable: i <= 11, isSigner: i === 12 })) });
}
async function simulate(rpcUrl, payer, instructions, monitor, blockhash) {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const body = { jsonrpc:'2.0', id:1, method:'simulateTransaction', params:[Buffer.from(tx.serialize()).toString('base64'), { encoding:'base64', sigVerify:false, replaceRecentBlockhash:true, commitment:'confirmed', innerInstructions:true, accounts:{ encoding:'base64', addresses:monitor.map(x=>x.toBase58()) } }] };
  const response = await fetch(rpcUrl, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
  const json = await response.json(); if (json.error) return { transportError: json.error };
  const post = {};
  monitor.forEach((key,i) => { const e=json.result.value.accounts?.[i]; post[key.toBase58()] = e?.data ? tokenAmount({data:Buffer.from(e.data[0],'base64')})?.toString() ?? null : null; });
  return { slot:json.result.context.slot, err:json.result.value.err, unitsConsumed:json.result.value.unitsConsumed, logs:json.result.value.logs, innerInstructions:json.result.value.innerInstructions, post };
}
async function main() {
  const connection = new Connection(process.env.RPC_URL, 'confirmed');
  const sigs = await connection.getSignaturesForAddress(damm, { limit: 500 }, 'confirmed');
  let seed;
  for (let offset=0; offset<sigs.length && !seed; offset+=50) {
    const batch = await connection.getTransactions(sigs.slice(offset,offset+50).map(x=>x.signature), { commitment:'confirmed', maxSupportedTransactionVersion:1 });
    for (let i=0;i<batch.length && !seed;i++) {
      const tx=batch[i]; if (!tx || tx.meta.err) continue;
      for (const row of instructionRows(tx)) {
        if (!row.program.equals(damm) || row.accounts.length!==15 || !row.data.subarray(0,8).equals(swapDisc)) continue;
        const infos=await connection.getMultipleAccountsInfo(row.accounts.slice(0,15),'confirmed');
        const sourceAmount=tokenAmount(infos[1]); const destinationAmount=tokenAmount(infos[2]);
        const input=row.data.readBigUInt64LE(8);
        if (infos.every(Boolean) && sourceAmount!==null && destinationAmount!==null && sourceAmount>=input*2n && row.accounts[13].equals(vaultProgram) && row.accounts[14].equals(tokenProgram)) {
          seed={ signature:sigs[offset+i].signature, slot:tx.slot, location:row.location, accounts:row.accounts, data:row.data, input:input.toString(), minimumOut:row.data.readBigUInt64LE(16).toString(), sourceAmount:sourceAmount.toString(), destinationAmount:destinationAmount.toString() };
          break;
        }
      }
    }
  }
  if (!seed) throw new Error('No fresh successful swap with two-input source balance found in 500 signatures');
  const preInfos=await connection.getMultipleAccountsInfoAndContext(seed.accounts,'confirmed');
  const before=Object.fromEntries(seed.accounts.map((k,i)=>[k.toBase58(),tokenAmount(preInfos.value[i])?.toString()??null]));
  const monitor=[...new Map(seed.accounts.slice(1,13).map(x=>[x.toBase58(),x])).values()];
  const blockhash=(await connection.getLatestBlockhash('confirmed')).blockhash;
  const cases=[
    {name:'baseline_single_swap', count:1, mutate:a=>a},
    {name:'same_transaction_double_swap', count:2, mutate:a=>a},
    {name:'wrong_a_vault', count:1, mutate:a=>{a[3]=a[4];return a;}},
    {name:'a_token_vault_is_b_token_vault', count:1, mutate:a=>{a[5]=a[6];return a;}},
    {name:'a_vault_lp_is_b_vault_lp', count:1, mutate:a=>{a[9]=a[10];return a;}},
    {name:'protocol_fee_is_destination', count:1, mutate:a=>{a[11]=a[2];return a;}},
    {name:'source_is_destination', count:1, mutate:a=>{a[2]=a[1];return a;}},
    {name:'vault_program_is_damm', count:1, mutate:a=>{a[13]=damm;return a;}},
    {name:'user_is_pool', count:1, mutate:a=>{a[12]=a[0];return a;}},
  ];
  const outcomes=[];
  for (const c of cases) {
    const accounts=c.mutate([...seed.accounts]); const ix=makeIx(accounts,seed.data); const result=await simulate(process.env.RPC_URL,fundedPayer,Array(c.count).fill(ix),monitor,blockhash);
    const deltas={}; for(const key of monitor){const a=key.toBase58();deltas[a]=before[a]!==null&&result.post?.[a]!==null?(BigInt(result.post[a])-BigInt(before[a])).toString():null;}
    outcomes.push({name:c.name,accounts:accounts.map(x=>x.toBase58()),result:{...result,deltas}});
  }
  const output={timestamp:new Date().toISOString(),program:damm.toBase58(),seed:{...seed,accounts:seed.accounts.map(x=>x.toBase58()),dataBase58:bs58.encode(seed.data)},preSlot:preInfos.context.slot,before,outcomes};
  fs.writeFileSync(outputPath,JSON.stringify(output,null,2));
  console.log(JSON.stringify({outputPath,seed:output.seed,outcomes:outcomes.map(x=>({name:x.name,err:x.result.err||x.result.transportError,units:x.result.unitsConsumed,deltas:x.result.deltas,tail:x.result.logs?.slice(-6)}))},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
