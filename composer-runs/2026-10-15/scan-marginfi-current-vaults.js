#!/usr/bin/env node

// Read-only live census using the IDL embedded at the exact verified source commit.
const {Connection, PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const fs = require('fs');

const rpcUrl = process.env.RPC_URL;
const outputPath = process.env.OUTPUT_PATH;
const idlPath = process.env.IDL_PATH;
if (!rpcUrl || !outputPath || !idlPath) throw new Error('RPC_URL, OUTPUT_PATH, and IDL_PATH are required');

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  const program = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
  const idl = JSON.parse(fs.readFileSync(idlPath));
  const coder = new anchor.BorshAccountsCoder(idl);
  const discriminator = Buffer.from(idl.accounts.find((account) => account.name === 'Bank').discriminator);
  const accounts = await connection.getProgramAccounts(program, {
    commitment: 'confirmed',
    filters: [{memcmp: {offset: 0, bytes: bs58.encode(discriminator)}}],
  });

  const banks = accounts.map((account) => ({
    address: account.pubkey.toBase58(),
    dataLength: account.account.data.length,
    state: coder.decode('Bank', account.account.data),
  }));
  const vaultKeys = banks.flatMap((bank) => [
    bank.state.liquidity_vault,
    bank.state.insurance_vault,
    bank.state.fee_vault,
  ].map((key) => key.toBase58()));
  const infos = [];
  for (let offset = 0; offset < vaultKeys.length; offset += 100) {
    infos.push(...await connection.getMultipleAccountsInfo(
      vaultKeys.slice(offset, offset + 100).map((key) => new PublicKey(key)),
      'confirmed',
    ));
  }

  const rows = [];
  const definitions = [
    ['liquidity', 'liquidity_vault', 'liquidity_vault_auth'],
    ['insurance', 'insurance_vault', 'insurance_vault_auth'],
    ['fee', 'fee_vault', 'fee_vault_auth'],
  ];
  for (let bankIndex = 0; bankIndex < banks.length; bankIndex += 1) {
    const bank = banks[bankIndex];
    const bankKey = new PublicKey(bank.address);
    for (let vaultIndex = 0; vaultIndex < definitions.length; vaultIndex += 1) {
      const [kind, vaultSeed, authoritySeed] = definitions[vaultIndex];
      const address = vaultKeys[(bankIndex * 3) + vaultIndex];
      const info = infos[(bankIndex * 3) + vaultIndex];
      if (!info || info.data.length < 72) continue;
      const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
        [Buffer.from(vaultSeed), bankKey.toBuffer()], program,
      );
      const [authorityPda, authorityBump] = PublicKey.findProgramAddressSync(
        [Buffer.from(authoritySeed), bankKey.toBuffer()], program,
      );
      const mint = new PublicKey(info.data.subarray(0, 32)).toBase58();
      const authority = new PublicKey(info.data.subarray(32, 64)).toBase58();
      const rawAmount = info.data.readBigUInt64LE(64).toString();
      const proof = {
        bankOwnedByProgram: true,
        vaultDerives: vaultPda.toBase58() === address,
        vaultBumpMatches: vaultBump === bank.state[`${kind}_vault_bump`],
        authorityDerives: authorityPda.toBase58() === authority,
        authorityBumpMatches: authorityBump === bank.state[`${kind}_vault_authority_bump`],
        mintMatchesBank: mint === bank.state.mint.toBase58(),
      };
      rows.push({
        bank: bank.address,
        bankDataLength: bank.dataLength,
        group: bank.state.group.toBase58(),
        kind,
        address,
        mint,
        authority,
        tokenProgram: info.owner.toBase58(),
        rawAmount,
        proof,
      });
    }
  }

  const mints = [...new Set(rows.map((row) => row.mint))];
  const prices = {};
  for (let offset = 0; offset < mints.length; offset += 80) {
    const ids = mints.slice(offset, offset + 80).map((mint) => `solana:${mint}`).join(',');
    const response = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
    if (response.ok) Object.assign(prices, (await response.json()).coins || {});
  }

  const seen = new Set();
  let verifiedNonzeroVaults = 0;
  let pricedVaults = 0;
  let unpricedVaults = 0;
  let pricedGrossUsdLowerBound = 0;
  for (const row of rows) {
    row.controlVerified = row.rawAmount !== '0' && Object.values(row.proof).every(Boolean) && !seen.has(row.address);
    if (!row.controlVerified) continue;
    seen.add(row.address);
    verifiedNonzeroVaults += 1;
    const price = prices[`solana:${row.mint}`];
    if (!price) {
      unpricedVaults += 1;
      continue;
    }
    pricedVaults += 1;
    const amount = Number(row.rawAmount) / (10 ** price.decimals);
    row.valuation = {
      amount,
      symbol: price.symbol,
      usdPrice: price.price,
      usdValue: amount * price.price,
      priceTimestamp: price.timestamp,
    };
    pricedGrossUsdLowerBound += row.valuation.usdValue;
  }

  const lengthCounts = Object.entries(banks.reduce((counts, bank) => {
    counts[bank.dataLength] = (counts[bank.dataLength] || 0) + 1;
    return counts;
  }, {})).map(([length, count]) => ({length: Number(length), count}));
  const result = {
    timestamp: new Date().toISOString(),
    observationSlot: await connection.getSlot('confirmed'),
    program: program.toBase58(),
    verifiedSourceCommit: 'c5d440f62365de503c89cf6ec39fb6673494cc7c',
    idlVersion: idl.metadata?.version,
    bankAccounts: accounts.length,
    decodedBanks: banks.length,
    bankDataLengths: lengthCounts,
    verifiedNonzeroVaults,
    pricedVaults,
    unpricedVaults,
    pricedGrossUsdLowerBound,
    rows,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    observationSlot: result.observationSlot,
    bankAccounts: result.bankAccounts,
    bankDataLengths: result.bankDataLengths,
    verifiedNonzeroVaults,
    pricedVaults,
    unpricedVaults,
    pricedGrossUsdLowerBound,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
