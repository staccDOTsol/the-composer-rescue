'use strict';

const fs = require('fs');
const path = require('path');

const RPC = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!RPC) throw new Error('RPC_URL or HEAVY_RPC_URL is required');
const VAULT = '5HrP4MEggWDsENFTFX7QqW7U49RTei6Qqh7TVCczhgWa';
const PROGRAM = 'fragnAis7Bp6FTsMoa6YcH8UffhEw43Ph79qAiK3iF3';

async function rpc(method, params) {
  for (let n = 0; n < 7; n++) {
    try {
      const response = await fetch(RPC, {method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0', id:`${method}-${n}`, method, params})});
      const json = await response.json();
      if (json.error) throw new Error(JSON.stringify(json.error));
      return json.result;
    } catch (error) {
      if (n === 6) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * (n + 1)));
    }
  }
}

function allKeys(tx) {
  const base = tx.transaction.message.accountKeys.map(row => typeof row === 'string' ? row : row.pubkey);
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  return base.concat(loaded.writable || [], loaded.readonly || []);
}

function amountFor(rows, index) {
  const row = (rows || []).find(item => item.accountIndex === index);
  return row ? BigInt(row.uiTokenAmount.amount) : 0n;
}

async function main() {
  const signatures = await rpc('getSignaturesForAddress', [VAULT, {limit: 100, commitment: 'finalized'}]);
  const results = [];
  for (let i = 0; i < signatures.length; i += 10) {
    const batch = signatures.slice(i, i + 10);
    const txs = await Promise.all(batch.map(row => rpc('getTransaction', [row.signature, {encoding:'jsonParsed', commitment:'finalized', maxSupportedTransactionVersion: 1}])));
    for (let j = 0; j < batch.length; j++) {
      const summary = batch[j];
      const tx = txs[j];
      if (!tx) continue;
      const keys = allKeys(tx);
      const index = keys.indexOf(VAULT);
      const pre = amountFor(tx.meta.preTokenBalances, index);
      const post = amountFor(tx.meta.postTokenBalances, index);
      const outerPrograms = tx.transaction.message.instructions.map(ix => ix.programId || keys[ix.programIdIndex]);
      const innerPrograms = (tx.meta.innerInstructions || []).flatMap(group => group.instructions.map(ix => ix.programId || keys[ix.programIdIndex]));
      const logs = tx.meta.logMessages || [];
      results.push({
        signature: summary.signature, slot: tx.slot, blockTime: tx.blockTime,
        err: tx.meta.err, fee: tx.meta.fee, vaultPreRaw: pre.toString(), vaultPostRaw: post.toString(), deltaRaw: (post - pre).toString(),
        signerKeys: tx.transaction.message.accountKeys.filter(row => typeof row !== 'string' && row.signer).map(row => row.pubkey),
        outerPrograms, innerPrograms,
        fragmetricInvoked: outerPrograms.includes(PROGRAM) || innerPrograms.includes(PROGRAM) || logs.some(line => line.includes(PROGRAM)),
        fragmetricInstructionLogs: logs.filter(line => line.startsWith('Program log: Instruction:') || line.includes(PROGRAM)),
      });
    }
  }
  results.sort((a,b) => b.slot - a.slot);
  const output = {
    observedAt: new Date().toISOString(), commitment: 'finalized', address: VAULT,
    signaturesRequested: 100, transactionsReturned: results.length,
    outflows: results.filter(row => BigInt(row.deltaRaw) < 0n),
    inflows: results.filter(row => BigInt(row.deltaRaw) > 0n),
    unchanged: results.filter(row => BigInt(row.deltaRaw) === 0n),
  };
  fs.writeFileSync(path.join(__dirname, 'vault-history-finalized.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({
    transactionsReturned: results.length,
    outflows: output.outflows.length,
    inflows: output.inflows.length,
    outflowSummary: output.outflows.slice(0, 20).map(row => ({signature:row.signature, slot:row.slot, deltaRaw:row.deltaRaw, signers:row.signerKeys, fragmetricInvoked:row.fragmetricInvoked, logs:row.fragmetricInstructionLogs})),
  }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
