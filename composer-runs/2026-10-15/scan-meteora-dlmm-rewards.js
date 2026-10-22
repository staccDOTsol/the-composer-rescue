#!/usr/bin/env node
'use strict';

// Read-only inventory of configured reward slots in the PDA-verified custody
// sample. This does not construct, sign, or submit transactions.

const fs = require('fs');
const { Connection, PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const DLMM = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@meteora-ag/dlmm');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const rpc = env.HEAVY_RPC_URL || env.RPC_URL;
const connection = new Connection(rpc, 'confirmed');
const custodyPath = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-current-custody.json';
const outputPath = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-current-rewards.json';
const zero = '11111111111111111111111111111111';

async function main() {
  const custody = JSON.parse(fs.readFileSync(custodyPath));
  const rows = custody.rows.filter((row) => row.controlVerified);
  const program = DLMM.createProgram(connection);
  const accounts = await program.account.lbPair.fetchMultiple(rows.map((row) => new PublicKey(row.address)));
  const configured = [];
  for (let i = 0; i < rows.length; i += 1) {
    const state = accounts[i];
    for (let slot = 0; slot < state.rewardInfos.length; slot += 1) {
      const reward = state.rewardInfos[slot];
      if (reward.vault.toBase58() === zero) continue;
      configured.push({
        pair: rows[i].address,
        pairName: rows[i].name,
        slot,
        mint: reward.mint.toBase58(),
        vault: reward.vault.toBase58(),
        funder: reward.funder.toBase58(),
        rewardDurationEnd: reward.rewardDurationEnd.toString(),
        rewardRate: reward.rewardRate.toString(),
        lastUpdateTime: reward.lastUpdateTime.toString(),
      });
    }
  }
  const slot = await connection.getSlot('confirmed');
  const unixNow = Math.floor(Date.now() / 1000);
  const output = {
    observedAt: new Date().toISOString(),
    observedSlot: slot,
    rpcHost: new URL(rpc).hostname,
    sourceSample: custodyPath,
    verifiedPools: rows.length,
    configuredRewardSlots: configured.length,
    activeRewardSlots: configured.filter((reward) => Number(reward.rewardDurationEnd) > unixNow).length,
    configured,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
