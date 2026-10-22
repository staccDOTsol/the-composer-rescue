#!/usr/bin/env node
// Read-only, signed mainnet simulations of the current YOLO open/close account gate.
const fs = require('fs');
const {Keypair, PublicKey, Transaction, TransactionInstruction} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const bs58Module = require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const program = 'yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA';
const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'))));
const rpcRow = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8')
  .split(/\r?\n/).find(row => /^\s*export SOLANA_RPC=/.test(row));
const endpoint = rpcRow?.slice(rpcRow.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
if (!endpoint?.startsWith('https://')) throw new Error('Mainnet RPC unavailable');

async function rpc(method, params) {
  const response = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}), signal:AbortSignal.timeout(30000)});
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${method}: ${body.error?.message || response.status}`);
  return body.result;
}

async function observedInstruction(signature, selector) {
  const tx = await rpc('getTransaction', [signature, {encoding:'jsonParsed', maxSupportedTransactionVersion:1, commitment:'confirmed'}]);
  if (!tx) throw new Error('Historical transaction unavailable');
  const ix = tx.transaction.message.instructions.find(row => row.programId === program &&
    Buffer.from(bs58.decode(row.data || '')).subarray(0,8).toString('hex') === selector);
  if (!ix) throw new Error('Expected instruction absent');
  const keyRoles = new Map(tx.transaction.message.accountKeys.map(row => [row.pubkey, row]));
  return {slot:tx.slot, accounts:ix.accounts, data:Buffer.from(bs58.decode(ix.data)), keyRoles};
}

async function simulate(label, sample, operatorSubstitution) {
  const blockhash = (await rpc('getLatestBlockhash', [{commitment:'confirmed'}])).value.blockhash;
  const keys = sample.accounts.map((address, index) => {
    const replaced = index === 0 || (index === 1 && operatorSubstitution);
    const pubkey = replaced ? signer.publicKey : new PublicKey(address);
    return {pubkey, isSigner:index === 0 || (index === 1 && operatorSubstitution),
      isWritable:index === 0 || !!sample.keyRoles.get(address)?.writable};
  });
  const tx = new Transaction({feePayer:signer.publicKey, recentBlockhash:blockhash}).add(
    new TransactionInstruction({programId:new PublicKey(program), keys, data:sample.data}));
  tx.sign(signer);
  const wire = tx.serialize();
  const result = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding:'base64', sigVerify:true, replaceRecentBlockhash:false,
    commitment:'confirmed', innerInstructions:true
  }]);
  return {label, slot:result.context.slot, wireBytes:wire.length, error:result.value.err,
    computeUnits:result.value.unitsConsumed,
    logs:(result.value.logs || []).filter(line => /Program log:|failed:|success/.test(line)).slice(-12)};
}

async function main() {
  const genesis = await rpc('getGenesisHash', []);
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Not mainnet-beta');
  const cases = [
    {name:'open_position', selector:'87802f4d0f98f031', signature:'2NX47m8N8qyiUBhkVXfEwo9Ws8yiQmqo84ehcMGowcStt6wYGybn5ux9EWTyXMbJ6L7NPjnPWCPJp7LrDPB51sv2'},
    {name:'close_position', selector:'7b86510031446262', signature:'ZFgcNGjsfZxmANaDe8Ndo23diEubVezxfPZv9BuyqPfR6dFxuWcqz1ZVk6pgdgabVHgpkHNNq7bMj9nFKo3wWU5'}
  ];
  const output = {observedAt:new Date().toISOString(), network:'mainnet-beta', genesis,
    method:'simulateTransaction', sigVerify:true, broadcast:false, probes:[]};
  for (const row of cases) {
    const sample = await observedInstruction(row.signature, row.selector);
    output.probes.push({name:row.name, receiptSignature:row.signature, receiptSlot:sample.slot,
      operator:sample.accounts[1], operatorListedSigner:!!sample.keyRoles.get(sample.accounts[1])?.signer,
      noOperatorSignature:await simulate(`${row.name}_operator_not_signer`, sample, false),
      selfAsOperator:await simulate(`${row.name}_self_as_operator`, sample, true)});
  }
  const target = `${__dirname}/yolov-signer-gate.json`;
  fs.writeFileSync(target, JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(output.probes.map(row => ({name:row.name, receiptSlot:row.receiptSlot,
    noOperatorSignature:row.noOperatorSignature, selfAsOperator:row.selfAsOperator}))));
}
main().catch(error => {console.error(error.message);process.exitCode=1});
