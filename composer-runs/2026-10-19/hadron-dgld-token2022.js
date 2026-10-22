#!/usr/bin/env node
// Read-only DGLD Token-2022 extension snapshot. Never signs or submits transactions.
const fs = require('fs');
const path = require('path');
const {Connection, PublicKey} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const spl = require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');

const mintAddress = new PublicKey('dg1dmo6NZNagkwB6EAfUeaco6CFXFLRhb1KCrsqXTVz');
const envFile = '/Users/stacc/.config/stacc-ladder/rpc.env';
const row = fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  .find(line => /^\s*(?:export\s+)?SOLANA_RPC=/.test(line));
if (!row) throw new Error('SOLANA_RPC missing');
const rpcUrl = row.slice(row.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
const connection = new Connection(rpcUrl, 'confirmed');

const key = value => value?.toBase58?.() || null;
const json = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));

async function main() {
  const genesis = await connection.getGenesisHash();
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('wrong cluster');
  const result = await connection.getAccountInfoAndContext(mintAddress, 'confirmed');
  if (!result.value) throw new Error('DGLD mint missing');
  const mint = spl.unpackMint(mintAddress, result.value, spl.TOKEN_2022_PROGRAM_ID);
  const fee = spl.getTransferFeeConfig(mint);
  const permanentDelegate = spl.getPermanentDelegate(mint);
  const pausable = spl.getPausableConfig(mint);
  const output = {
    observedAtUtc: new Date().toISOString(),
    genesis,
    slot: result.context.slot,
    noTransactions: true,
    address: mintAddress.toBase58(),
    owner: result.value.owner.toBase58(),
    dataLen: result.value.data.length,
    decimals: mint.decimals,
    supply: mint.supply.toString(),
    mintAuthority: key(mint.mintAuthority),
    freezeAuthority: key(mint.freezeAuthority),
    extensions: spl.getExtensionTypes(mint.tlvData).map(type => spl.ExtensionType[type]),
    permanentDelegate: key(permanentDelegate?.delegate),
    transferFeeConfig: json(fee),
    pausableConfig: json(pausable),
    accountingConclusion: fee && fee.olderTransferFee.transferFeeBasisPoints === 0 &&
      fee.newerTransferFee.transferFeeBasisPoints === 0 &&
      fee.olderTransferFee.maximumFee === 0n && fee.newerTransferFee.maximumFee === 0n
      ? 'Current DGLD Token-2022 transfers have zero configured transfer fee in both fee schedules.'
      : 'A nonzero Token-2022 transfer fee is configured and must be included in route economics.',
  };
  fs.writeFileSync(path.join(__dirname, 'hadron-dgld-token2022.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
