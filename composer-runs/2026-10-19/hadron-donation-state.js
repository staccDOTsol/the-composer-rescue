#!/usr/bin/env node
'use strict';
// Read-only state probe for unsolicited-vault-donation analysis.
const fs = require('fs');
const path = require('path');
const {Connection, PublicKey} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {Hadron, decodeCurveUpdates, fromQ32} = require('./hadron-sdk/package/dist/index.js');

const pools = [
  {label: 'USDC_USDT', address: 'GPHRA3MJGT4ERmsq3sgt9Mcf3WVdG81oJia7yuLZ6ixU'},
  {label: 'DGLD_USDC', address: 'rQsUkcKpia3v3VykWVNZWALuYehNZSTTjDa7qJ3oxWs'},
];
const envRow = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8')
  .split(/\r?\n/).find(x => /^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
const rpcUrl = envRow.slice(envRow.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
const connection = new Connection(rpcUrl, 'confirmed');
const curve = side => ({
  numPoints: side.numPoints, defaultInterpolation: side.defaultInterpolation,
  xMode: side.xMode, riskMode: side.riskMode,
  points: side.points.map(p => ({amountIn: p.amountIn.toString(),
    priceFactorQ32: p.priceFactorQ32.toString(), priceFactor: fromQ32(p.priceFactorQ32),
    interpolation: p.interpolation, paramsHex: Buffer.from(p.params).toString('hex')})),
});

async function main() {
  const genesis = await connection.getGenesisHash();
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw Error('wrong cluster');
  const startSlot = await connection.getSlot('confirmed');
  const output = [];
  for (const spec of pools) {
    const pool = await Hadron.load(connection, new PublicKey(spec.address));
    const infos = await connection.getMultipleAccountsInfo([
      pool.addresses.vaultX, pool.addresses.vaultY, pool.addresses.curveUpdates,
      pool.config.mintX, pool.config.mintY,
    ], 'confirmed');
    const [vx, vy, updatesInfo, mx, my] = infos;
    const x = vx.data.readBigUInt64LE(64), y = vy.data.readBigUInt64LE(64);
    const updates = decodeCurveUpdates(updatesInfo.data);
    const active = pool.getActiveCurves();
    output.push({label: spec.label, pool: spec.address, state: pool.config.state,
      mints: {x: pool.config.mintX.toBase58(), y: pool.config.mintY.toBase58(),
        decimalsX: mx.data[44], decimalsY: my.data[44]},
      vaults: {x: pool.addresses.vaultX.toBase58(), y: pool.addresses.vaultY.toBase58(),
        rawX: x.toString(), rawY: y.toString()},
      oracle: {mode: pool.config.oracleMode, sequence: pool.oracle.sequence.toString(),
        midpriceQ32: pool.oracle.midpriceQ32.toString(), midpriceRawAtoms: pool.getMidprice(),
        spreadFactorQ32: pool.oracle.spreadFactorQ32.toString(), spreadBps: pool.getSpreadBps(),
        lastUpdateSlot: pool.oracle.lastUpdateSlot.toString()},
      fee: {...pool.resolveFee(), feeRecipient: pool.feeConfig.feeRecipient.toBase58()},
      activeSlots: pool.getActiveCurveSlots(),
      curves: {priceBid: curve(active.priceBid), priceAsk: curve(active.priceAsk),
        riskBid: curve(active.riskBid), riskAsk: curve(active.riskAsk)},
      curveUpdates: {sequence: updates.sequence.toString(), numOps: updates.numOps},
      inventorySdk: (() => { try { return pool.getInventoryRiskFactors(x, y); }
        catch (error) { return {error: error.message}; } })(),
    });
  }
  const result = {observedAtUtc: new Date().toISOString(), genesis, startSlot,
    endSlot: await connection.getSlot('confirmed'), noTransactions: true, pools: output};
  fs.writeFileSync(path.join(__dirname, 'hadron-donation-state.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
