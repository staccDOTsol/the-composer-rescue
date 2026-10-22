#!/usr/bin/env node

// Read-only exact-boundary probe for the thinnest current zero-rate WSOL KLend
// reserve in the retained census. Uses simulateTransaction only.
const fs = require('fs');
const crypto = require('crypto');
const {Connection, PublicKey, TransactionInstruction} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const {encodeV1} = require('./klend-v1-composition.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split(/\r?\n/)
  .filter(x => x && !x.startsWith('#')).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('read-only RPC unavailable');
const conn = new Connection(rpcUrl, 'confirmed');
const P = x => new PublicKey(x), KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const OWNER = P('4i4rYMBihHVv4VwuGQmu2eu9FEPf5tqvHQFrbFpCwQP1');
const WSOL = P('So11111111111111111111111111111111111111112');
const SYSVAR_INSTRUCTIONS = P('Sysvar1nstructions1111111111111111111111111');
const census = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/klend-zero-fee-census.json', 'utf8'));
const row = census.activeZero.filter(x => x.mint === WSOL.toBase58() && BigInt(x.availableRaw) > 0n)
  .sort((a, b) => BigInt(a.availableRaw) < BigInt(b.availableRaw) ? -1 : 1)[0];
if (!row || row.flashFeeSf !== '0') throw new Error('no thin zero-rate WSOL reserve in census');
const RESERVE = P(row.reserve), MARKET = P(row.market), SUPPLY = P(row.supplyVault), FEE = P(row.feeVault);
const [MARKET_AUTHORITY] = PublicKey.findProgramAddressSync([Buffer.from('lma'), MARKET.toBuffer()], KLEND);
const WALLET = getAssociatedTokenAddressSync(WSOL, OWNER, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const createWallet = createAssociatedTokenAccountIdempotentInstruction(OWNER, WALLET, OWNER, WSOL, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const borrowDisc = Buffer.from([135, 231, 52, 167, 7, 52, 212, 193]);
const repayDisc = Buffer.from([185, 117, 0, 203, 96, 245, 180, 186]);
const u64 = x => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(x)); return b; };
const k = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});
const common = () => [k(OWNER, true), k(MARKET_AUTHORITY), k(MARKET), k(RESERVE, false, true), k(WSOL),
  k(SUPPLY, false, true), k(WALLET, false, true), k(FEE, false, true), k(KLEND), k(KLEND),
  k(SYSVAR_INSTRUCTIONS), k(TOKEN_PROGRAM_ID)];
const borrow = amount => new TransactionInstruction({programId: KLEND, data: Buffer.concat([borrowDisc, u64(amount)]), keys: common()});
const repay = amount => new TransactionInstruction({programId: KLEND, data: Buffer.concat([repayDisc, u64(amount), Buffer.from([1])]), keys: common()});
const watched = [WALLET, SUPPLY, FEE, RESERVE], labels = ['walletWsol','supplyVault','feeVault','reserve'];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function decode(address, account) {
  if (!account?.data) return null;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const owner = typeof account.owner === 'string' ? account.owner : account.owner.toBase58();
  if (owner === TOKEN_PROGRAM_ID.toBase58() && data.length >= 165) return {kind:'token', amountRaw:data.readBigUInt64LE(64).toString(), sha256:sha(data)};
  if (address.equals(RESERVE)) return {kind:'reserve', availableRaw:data.readBigUInt64LE(224).toString(), flashFeeSf:data.readBigUInt64LE(4904).toString(), sha256:sha(data)};
  return {kind:'state', sha256:sha(data), dataLength:data.length};
}
function delta(a, b) {
  if (a?.kind === 'token' && b?.kind === 'token') return (BigInt(b.amountRaw)-BigInt(a.amountRaw)).toString();
  if (!a && b?.kind === 'token') return b.amountRaw;
  if (a?.kind === 'reserve' && b?.kind === 'reserve') return (BigInt(b.availableRaw)-BigInt(a.availableRaw)).toString();
  return a?.sha256 && b?.sha256 ? String(a.sha256 === b.sha256) : null;
}
async function simulate(name, amount, blockhash, before) {
  const encoded = encodeV1([createWallet, borrow(amount), repay(amount)], OWNER, blockhash);
  const request = {jsonrpc:'2.0',id:name,method:'simulateTransaction',params:[encoded.wire.toString('base64'),
    {encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',innerInstructions:true,
      accounts:{encoding:'base64',addresses:watched.map(String)}}]};
  const response = await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});
  const json = await response.json(), value = json.result?.value;
  const after = watched.map((a,i)=>decode(a,value?.accounts?.[i]));
  return {name,amountRaw:amount.toString(),slot:json.result?.context?.slot||null,transportError:json.error||null,err:value?.err||null,
    sizeBytes:encoded.sizeBytes,equivalentV0Bytes:encoded.v0Bytes,addressCount:encoded.addressCount,instructionCount:encoded.instructionCount,
    unitsConsumed:value?.unitsConsumed||null,messageBase64:encoded.wire.toString('base64'),postDecoded:after,
    deltas:Object.fromEntries(labels.map((x,i)=>[x,delta(before[i],after[i])])),
    logs:value?.logs?.filter(x=>/Instruction:|Error|failed:|insufficient/i.test(x))||null};
}
async function main() {
  const pre = await conn.getMultipleAccountsInfoAndContext(watched,'confirmed');
  const before = watched.map((a,i)=>decode(a,pre.value[i]));
  const available = BigInt(before[3].availableRaw), fee = BigInt(before[3].flashFeeSf);
  if (fee !== 0n) throw new Error(`live flash fee is no longer zero: ${fee}`);
  const blockhash=(await conn.getLatestBlockhash('confirmed')).blockhash;
  const cases=[];
  for (const amount of [1n,available-1n,available,available+1n]) {
    const result=await simulate(`thin_direct_${amount}`,amount,blockhash,before); cases.push(result);
    process.stdout.write(JSON.stringify({name:result.name,err:result.err,bytes:result.sizeBytes,units:result.unitsConsumed,deltas:result.deltas,logs:result.logs?.slice(-5)})+'\n');
  }
  const output={generatedAt:new Date().toISOString(),safety:{readOnly:true,simulateTransactionOnly:true,submitted:false,sigVerify:false},
    transactionFormat:{version:1,maxBytes:4096,maxInlineAddresses:64,encoder:'local v1 encoder preserved in klend-v1-composition.js'},
    reserve:{...row,currentReadSlot:pre.context.slot,currentDecodedAvailableRaw:available.toString(),currentDecodedFlashFeeSf:fee.toString(),
      marketAuthority:MARKET_AUTHORITY.toBase58(),classification:'smallest positive current-census WSOL reserve; exact-zero-rate, not rounded'},
    watched:watched.map(String),watchedLabels:labels,preDecoded:before,cases};
  const path='composer-runs/2026-10-15/klend-thin-wsol-v1.json'; fs.writeFileSync(path,JSON.stringify(output,null,2)+'\n');
  const stable='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/orca-current-revalidation';
  fs.mkdirSync(stable,{recursive:true}); fs.writeFileSync(`${stable}/klend-thin-wsol-v1.json`,JSON.stringify(output,null,2)+'\n');
}
main().catch(error=>{process.stderr.write(`${error.stack||error}\n`);process.exitCode=1;});
