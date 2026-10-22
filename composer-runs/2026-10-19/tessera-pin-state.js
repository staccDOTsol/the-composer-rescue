#!/usr/bin/env node
'use strict';

// Captures Tessera's live pricing/custody account images in one mainnet RPC read,
// or applies those exact bytes to an isolated Surfpool fork. No mainnet writes.

const fs = require('fs');
const path = require('path');
const OUTPUT = path.join(__dirname, 'tessera-fixed-state.json');
const FORK = process.env.TESSERA_FORK_RPC || 'http://127.0.0.1:9239';
const ADDRESSES = [
  '8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF',
  'FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n',
  '5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV',
  '9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx',
  'BAT1Ndpu5gbLTp2AZkSXP79LJBZfCH4B3zGhi6LtvdhK',
  '4cG31VNF9TzFinNc7BmnjhFvGjxkY3sCETVMtMgbrhPs',
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
];
let id = 0;
async function rpc(url, method, params = []) {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}),
    signal: AbortSignal.timeout(60_000)});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
function mainnetEndpoint() {
  const row = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8')
    .split(/\r?\n/).find(line => /^\s*(?:export\s+)?SOLANA_RPC=/.test(line));
  if (!row) throw new Error('SOLANA_RPC missing');
  return row.slice(row.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
}
async function main() {
  if (process.argv[2] === 'capture') {
    const endpoint = mainnetEndpoint();
    const [genesis, result] = await Promise.all([
      rpc(endpoint, 'getGenesisHash'),
      rpc(endpoint, 'getMultipleAccounts', [ADDRESSES,
        {encoding: 'base64', commitment: 'confirmed'}]),
    ]);
    const output = {capturedAtUtc: new Date().toISOString(), genesis,
      slot: result.context.slot, addresses: ADDRESSES,
      accounts: Object.fromEntries(ADDRESSES.map((address, index) => [address, result.value[index]]))};
    fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify({output: OUTPUT, slot: output.slot, accountCount: ADDRESSES.length}, null, 2));
    return;
  }
  if (process.argv[2] === 'apply') {
    const input = JSON.parse(fs.readFileSync(OUTPUT));
    const genesis = await rpc(FORK, 'getGenesisHash');
    if (genesis !== input.genesis) throw new Error('fork genesis mismatch');
    for (const address of input.addresses) {
      const account = input.accounts[address];
      if (!account) throw new Error(`captured account missing ${address}`);
      await rpc(FORK, 'surfnet_setAccount', [address, {data: Buffer.from(account.data[0], 'base64').toString('hex'),
        executable: account.executable, lamports: account.lamports,
        owner: account.owner, rentEpoch: 0}]);
    }
    console.log(JSON.stringify({sourceSlot: input.slot, appliedAccountCount: input.addresses.length,
      forkSlot: await rpc(FORK, 'getSlot', [{commitment: 'processed'}])}, null, 2));
    return;
  }
  throw new Error('usage: tessera-pin-state.js capture|apply');
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
