#!/usr/bin/env node

const fs = require('fs');
const util = require('util');
const anchor = require('@coral-xyz/anchor');
const {Connection, PublicKey} = require('@solana/web3.js');

const baseDir = __dirname;
const idl = JSON.parse(fs.readFileSync(`${baseDir}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`, 'utf8'));
const census = JSON.parse(fs.readFileSync(`${baseDir}/marginfi-vaults-current.json`, 'utf8'));
const rpcUrl = process.env.RPC_URL;
if (!rpcUrl) throw new Error('RPC_URL is required');
const programId = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');

async function main() {
  const connection = new Connection(rpcUrl, 'processed');
  const coder = new anchor.BorshAccountsCoder(idl);
  const [feeState] = PublicKey.findProgramAddressSync([Buffer.from('feestate')], programId);
  const feeInfo = await connection.getAccountInfo(feeState, 'processed');
  const decodedFee = coder.decode('FeeState', feeInfo.data);
  process.stdout.write(`feeState ${feeState}\n${util.inspect(decodedFee, {depth: 3})}\n`);
  const uniqueBanks = [...new Set(census.rows.map((row) => row.bank))].slice(0, 20).map((key) => new PublicKey(key));
  const infos = await connection.getMultipleAccountsInfo(uniqueBanks, 'processed');
  for (let index = 0; index < infos.length; index += 1) {
    const bank = coder.decode('Bank', infos[index].data);
    process.stdout.write(`${uniqueBanks[index]} ${util.inspect({
      mint: bank.mint,
      collected_insurance_fees_outstanding: bank.collected_insurance_fees_outstanding,
      collected_group_fees_outstanding: bank.collected_group_fees_outstanding,
      collected_program_fees_outstanding: bank.collected_program_fees_outstanding,
      collected_premium_outstanding: bank.collected_premium_outstanding,
    }, {depth: 2})}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
