// Read-only helper: locate recently traded DBC pools with accrued partner or
// creator fees and retain one real swap's signer/token accounts for simulation.
const fs = require('fs');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const bs58 = require(`${MOD}/bs58`);
const { PublicKey } = require(`${MOD}/@solana/web3.js`);

const RPC = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!RPC) throw new Error('RPC_URL required');
const PROGRAM = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const SWAPS = new Map([
  [Buffer.from([248,198,158,145,225,117,135,200]).toString('hex'), 'swap'],
  [Buffer.from([65,75,63,76,235,91,91,136]).toString('hex'), 'swap2'],
]);

async function rpc(method, params) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await fetch(RPC, {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { body = {error:{message:text.slice(0,200)}}; }
    if (!body.error) return body.result;
    if (attempt === 7) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
    await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
  }
}

function txKeys(tx) {
  const msg = tx.transaction.message;
  const stat = msg.accountKeys.map(k => typeof k === 'string' ? k : k.pubkey);
  const loaded = tx.meta.loadedAddresses || {writable:[],readonly:[]};
  return [...stat, ...loaded.writable, ...loaded.readonly];
}

function parseOuterSwaps(tx, signature) {
  const keys = txKeys(tx);
  const out = [];
  for (const ix of tx.transaction.message.instructions) {
    const program = keys[ix.programIdIndex] || ix.programId;
    if (program !== PROGRAM || !ix.data) continue;
    const data = Buffer.from(bs58.decode(ix.data));
    const kind = SWAPS.get(data.subarray(0,8).toString('hex'));
    if (!kind || ix.accounts.length < 12) continue;
    const a = ix.accounts.map(i => keys[i]);
    out.push({
      signature, slot: tx.slot, blockTime: tx.blockTime, kind,
      poolAuthority:a[0], config:a[1], pool:a[2], inputTokenAccount:a[3],
      outputTokenAccount:a[4], baseVault:a[5], quoteVault:a[6],
      baseMint:a[7], quoteMint:a[8], payer:a[9],
      tokenBaseProgram:a[10], tokenQuoteProgram:a[11],
    });
  }
  return out;
}

async function main() {
  const sigRows = await rpc('getSignaturesForAddress', [PROGRAM, {limit: 120, commitment:'confirmed'}]);
  const swaps = [];
  for (let i = 0; i < sigRows.length && swaps.length < 30; i += 10) {
    const batch = sigRows.slice(i, i + 10);
    const txs = await Promise.all(batch.map(row => rpc('getTransaction', [row.signature, {
      commitment:'confirmed', encoding:'json', maxSupportedTransactionVersion:0,
    }]).catch(() => null)));
    for (let j = 0; j < txs.length; j++) {
      if (txs[j] && txs[j].meta && txs[j].meta.err == null) swaps.push(...parseOuterSwaps(txs[j], batch[j].signature));
    }
    console.error(JSON.stringify({transactionsExamined:Math.min(i+batch.length,sigRows.length),swapsFound:swaps.length}));
  }
  const unique = [...new Map(swaps.map(x => [x.pool, x])).values()];
  const accounts = [];
  for (let i = 0; i < unique.length; i += 100) {
    const result = await rpc('getMultipleAccounts', [unique.slice(i,i+100).map(x=>x.pool), {encoding:'base64',commitment:'confirmed'}]);
    accounts.push(...result.value);
  }
  const candidates = [];
  for (let i = 0; i < unique.length; i++) {
    const value = accounts[i];
    if (!value) continue;
    const data = Buffer.from(value.data[0], 'base64');
    if (data.length !== 424) continue;
    const swap = unique[i];
    const decoded = {
      ...swap,
      accountOwner:value.owner,
      storedConfig:new PublicKey(data.subarray(72,104)).toBase58(),
      creator:new PublicKey(data.subarray(104,136)).toBase58(),
      storedBaseMint:new PublicKey(data.subarray(136,168)).toBase58(),
      storedBaseVault:new PublicKey(data.subarray(168,200)).toBase58(),
      storedQuoteVault:new PublicKey(data.subarray(200,232)).toBase58(),
      baseReserve:data.readBigUInt64LE(232).toString(),
      quoteReserve:data.readBigUInt64LE(240).toString(),
      protocolBaseFee:data.readBigUInt64LE(248).toString(),
      protocolQuoteFee:data.readBigUInt64LE(256).toString(),
      partnerBaseFee:data.readBigUInt64LE(264).toString(),
      partnerQuoteFee:data.readBigUInt64LE(272).toString(),
      creatorBaseFee:data.readBigUInt64LE(352).toString(),
      creatorQuoteFee:data.readBigUInt64LE(360).toString(),
    };
    decoded.hasPartnerFee = BigInt(decoded.partnerBaseFee) + BigInt(decoded.partnerQuoteFee) > 0n;
    decoded.hasCreatorFee = BigInt(decoded.creatorBaseFee) + BigInt(decoded.creatorQuoteFee) > 0n;
    decoded.controlsMatch = decoded.accountOwner === PROGRAM && decoded.storedConfig === swap.config &&
      decoded.storedBaseMint === swap.baseMint && decoded.storedBaseVault === swap.baseVault &&
      decoded.storedQuoteVault === swap.quoteVault;
    candidates.push(decoded);
  }
  candidates.sort((a,b) => {
    const af = BigInt(a.partnerBaseFee)+BigInt(a.partnerQuoteFee)+BigInt(a.creatorBaseFee)+BigInt(a.creatorQuoteFee);
    const bf = BigInt(b.partnerBaseFee)+BigInt(b.partnerQuoteFee)+BigInt(b.creatorBaseFee)+BigInt(b.creatorQuoteFee);
    return af > bf ? -1 : af < bf ? 1 : 0;
  });
  const path = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dbc-recent-fee-pools.json';
  fs.writeFileSync(path, JSON.stringify({timestamp:new Date().toISOString(), signaturesExamined:sigRows.length, swapsFound:swaps.length, uniquePools:unique.length, candidates}, null, 2));
  console.log(JSON.stringify({path, signaturesExamined:sigRows.length, swapsFound:swaps.length, uniquePools:unique.length, feeBearing:candidates.filter(x=>x.hasPartnerFee||x.hasCreatorFee).length, top:candidates.slice(0,10)}));
}

main().catch(e => { console.error(e); process.exit(1); });
