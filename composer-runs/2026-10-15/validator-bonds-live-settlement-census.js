#!/usr/bin/env node
// Read-only mainnet census. No transaction construction or submission.
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection, PublicKey} = require(modules + '@solana/web3.js');
const {BorshAccountsCoder} = require(modules + '@coral-xyz/anchor');
const bs58module = require(modules + 'bs58');
const bs58 = bs58module.default || bs58module;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
if (!url) throw new Error('RPC URL unavailable');
const connection = new Connection(url, 'confirmed');
const program = new PublicKey('vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4');
const idl = JSON.parse(fs.readFileSync(__dirname +
  '/validator-bonds-deployed-1989b66/packages/validator-bonds-sdk/idl/json/validator_bonds.json'));
const coder = new BorshAccountsCoder(idl);
const disc = Buffer.from(idl.accounts.find(x => x.name === 'Settlement').discriminator);
function bn(x) { return x?.toString() ?? null; }
function pk(x) { return x?.toBase58() ?? null; }
async function main() {
  const [epoch, rows] = await Promise.all([
    connection.getEpochInfo('confirmed'),
    connection.getProgramAccounts(program, {commitment:'confirmed',
      filters:[{memcmp:{offset:0, bytes:bs58.encode(disc)}}]})
  ]);
  const settlements = rows.map(({pubkey, account}) => {
    const s = coder.decode('Settlement', account.data);
    const max = BigInt(bn(s.max_total_claim));
    const funded = BigInt(bn(s.lamports_funded));
    const claimed = BigInt(bn(s.lamports_claimed));
    return {address:pk(pubkey),bond:pk(s.bond),stakerAuthority:pk(s.staker_authority),
      maxTotalClaimLamports:String(max),fundedLamports:String(funded),
      claimedLamports:String(claimed),unclaimedFundedLamports:String(funded>claimed?funded-claimed:0n),
      maxMerkleNodes:bn(s.max_merkle_nodes),merkleNodesClaimed:bn(s.merkle_nodes_claimed),
      epochCreatedFor:bn(s.epoch_created_for),slotCreatedAt:bn(s.slot_created_at),
      merkleRootHex:Buffer.from(s.merkle_root).toString('hex'),
      accountLamports:account.lamports};
  }).sort((a,b)=>BigInt(a.unclaimedFundedLamports)>BigInt(b.unclaimedFundedLamports)?-1:1);
  const total = settlements.reduce((sum,s)=>sum+BigInt(s.unclaimedFundedLamports),0n);
  const out={generatedAt:new Date().toISOString(),scope:'read-only confirmed mainnet settlement account census',
    program:pk(program),slot:epoch.absoluteSlot,epoch:epoch.epoch,accountCount:rows.length,
    totalUnclaimedFundedLamports:String(total),settlements};
  const path=__dirname+'/validator-bonds-live-settlement-census.json';
  fs.writeFileSync(path,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({path,slot:out.slot,epoch:out.epoch,count:rows.length,
    unclaimedFundedSol:Number(total)/1e9,top:settlements.slice(0,5).map(s=>({address:s.address,
      unclaimedFundedSol:Number(s.unclaimedFundedLamports)/1e9,epoch:s.epochCreatedFor}))}));
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1});
