#!/usr/bin/env node
'use strict';

// Read-only current lookup for same-mint state across every independent generic
// flash provider found by the companion provider inventory: Project0/marginfi,
// KLend, Save/Solend, and Jupiter's isolated Liquidity deployment. The general
// Jupiter Lend Liquidity deployment is also checked even though its `operate`
// access is protocol-bound rather than a generic outsider flash entrypoint.

const fs = require('fs');
const path = require('path');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const MINT = 'FoXyMu5xwXre7zEoSvzViRk3nGawHUp9kUh97y2NDhcq';
const OUT = process.argv[2] || path.join(__dirname, 'lender-check.json');
const env = Object.fromEntries(
  fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
    .split(/\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
);
const rpcUrl = process.env.HEAVY_RPC_URL || env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('missing RPC endpoint configuration');

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function main() {
  const tokenReserveDiscriminator = bs58.encode(Buffer.from([21, 18, 59, 135, 120, 20, 31, 12]));
  const probes = [
    {
      label: 'project0_marginfi_v1_bank_by_mint',
      programId: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
      mintOffset: 8,
    },
    {
      label: 'kamino_lend_reserve_by_liquidity_mint',
      programId: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
      mintOffset: 128,
    },
    {
      label: 'save_solend_reserve_by_liquidity_mint',
      programId: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo',
      mintOffset: 42,
      dataSize: 619,
    },
    {
      label: 'jupiter_isolated_liquidity_token_reserve_by_mint',
      programId: 'jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS',
      mintOffset: 8,
      discriminator: tokenReserveDiscriminator,
    },
    {
      label: 'jupiter_lend_liquidity_token_reserve_by_mint',
      programId: 'jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC',
      mintOffset: 8,
      discriminator: tokenReserveDiscriminator,
    },
  ];
  const results = [];
  for (const probe of probes) {
    const filters = [{ memcmp: { offset: probe.mintOffset, bytes: MINT } }];
    if (probe.dataSize) filters.unshift({ dataSize: probe.dataSize });
    if (probe.discriminator) filters.unshift({ memcmp: { offset: 0, bytes: probe.discriminator } });
    const response = await rpc('getProgramAccounts', [probe.programId, {
      encoding: 'base64',
      commitment: 'confirmed',
      withContext: true,
      filters,
      dataSlice: { offset: 0, length: 256 },
    }]);
    results.push({
      ...probe,
      observationSlot: response.context.slot,
      accounts: response.value.map((item) => ({
        address: item.pubkey,
        owner: item.account.owner,
        dataLength: item.account.space,
        dataPrefixBase64: item.account.data[0],
      })),
    });
  }
  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    noTransactionsSubmitted: true,
    mint: MINT,
    results,
    providerClassification: [
      {
        label: 'project0_marginfi_v1_bank_by_mint',
        outsiderAtomicSemantics: 'flashloan start/borrow/repay/end; fresh attacker-owned marginfi account supported',
      },
      {
        label: 'kamino_lend_reserve_by_liquidity_mint',
        outsiderAtomicSemantics: 'flash borrow/repay pair; one borrow per reserve per transaction',
      },
      {
        label: 'save_solend_reserve_by_liquidity_mint',
        outsiderAtomicSemantics: 'flash borrow/repay pair; one borrow per transaction',
      },
      {
        label: 'jupiter_isolated_liquidity_token_reserve_by_mint',
        outsiderAtomicSemantics: 'zero-fee isolated flash wrapper for its configured reserve set',
      },
      {
        label: 'jupiter_lend_liquidity_token_reserve_by_mint',
        outsiderAtomicSemantics: 'protocol-bound operate path; checked for completeness, not counted as generic outsider source',
      },
    ],
    conclusion: results.every((result) => result.accounts.length === 0)
      ? 'no_same_mint_bank_or_reserve_across_current_provider_set'
      : 'same_mint_state_requires_fee_and-borrowability_decode',
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUT,
    mint: MINT,
    conclusion: output.conclusion,
    results: results.map((result) => ({
      label: result.label,
      observationSlot: result.observationSlot,
      accountCount: result.accounts.length,
      addresses: result.accounts.map((account) => account.address),
    })),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
