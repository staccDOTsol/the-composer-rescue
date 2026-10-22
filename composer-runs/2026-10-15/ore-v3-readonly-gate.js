#!/usr/bin/env node
'use strict';

// Read only. This script fetches account state and transaction history; it does
// not load a wallet, build a transaction, or submit a simulation.
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection, PublicKey} = require(modules + '@solana/web3.js');

const envPath = '/tmp/composer-helius-only.env';
const env = fs.existsSync(envPath)
  ? Object.fromEntries(fs.readFileSync(envPath, 'utf8')
      .split(/\r?\n/).filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)))
  : {};
const connection = new Connection(env.HEAVY_RPC_URL || env.RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
const address = {
  program: 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv',
  programData: 'GXa6JV9AwsccP3hxvKFcZGp4w3MMtf7PJ6HYuTSyokfJ',
  treasury: '45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG',
  treasuryOre: 'GwZS8yBuPPkPgY4uh7eEhHN5EEdpkf7EBZ1za6nuP3wF',
  mint: 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp',
  board: 'BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi',
  config: '9c9X7aDRAF41faiDs94ELjT19UrGnn72wBW9hPsS4Awy',
};
const oldOutflowSignatures = [
  '3EqTFF4wqmjgvecJvTgwJMYgEkNLtDeeA74Q42Ki1P4ij3pDZiZ7z2Qp446AWmEXuRvm4MnJCMz2vEQ5FDi1jKry',
  '51rcqF4qkwmBFpfGTHhPz6gZ76Qr4AWMnHYZYADUEmNfC1bB6zhnMnS7uCcdKyn81NGEH7sya7yXz1UWjbzcBdcc',
  '3sZdASzKEdfkXqNccT6tR8fafv8p3BLMpD277MLyeBJWbhAxi98w35eXwMRRUnaN38e5bWWU5EoymgsCQCt9ZAAK',
];

const key = value => new PublicKey(value);
const pubkey = value => value?.toBase58?.() || value;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const names = Object.keys(address);
  const keys = names.map(name => key(address[name]));
  const {context, value} = await connection.getMultipleAccountsInfoAndContext(keys, 'confirmed');
  const accounts = {};
  for (let i = 0; i < value.length; i++) {
    const data = value[i]?.data;
    accounts[names[i]] = value[i] ? {
      address: address[names[i]], owner: pubkey(value[i].owner), executable: value[i].executable,
      lamports: value[i].lamports, dataLength: data.length,
      dataSha256: hash(data), dataPrefixHex: data.subarray(0, 48).toString('hex'),
    } : null;
  }
  if (value[1]) {
    accounts.programData.deploymentSlot = Number(value[1].data.readBigUInt64LE(4));
    accounts.programData.upgradeAuthority = new PublicKey(value[1].data.subarray(13, 45)).toBase58();
    accounts.programData.elfSha256 = hash(value[1].data.subarray(45));
  }
  const rawTreasury = value[names.indexOf('treasury')]?.data;
  if (rawTreasury) {
    accounts.treasury.parsed = {
      motherlodeRaw:rawTreasury.readBigUInt64LE(8).toString(),
      minerRewardsFactorRaw:rawTreasury.subarray(16, 32).toString('hex'),
      totalRefinedRaw:rawTreasury.readBigUInt64LE(32).toString(),
      totalUnclaimedRaw:rawTreasury.readBigUInt64LE(40).toString(),
    };
  }
  const rawBoard = value[names.indexOf('board')]?.data;
  if (rawBoard) {
    accounts.board.parsed = {
      roundId:rawBoard.readBigUInt64LE(8).toString(),
      startSlot:rawBoard.readBigUInt64LE(16).toString(),
      endSlot:rawBoard.readBigUInt64LE(24).toString(),
    };
  }
  const rawConfig = value[names.indexOf('config')]?.data;
  if (rawConfig) {
    accounts.config.parsed = {
      intermissionSlots:rawConfig.readBigUInt64LE(152).toString(),
      roundSlots:rawConfig.readBigUInt64LE(160).toString(),
    };
  }
  const rawVault = value[names.indexOf('treasuryOre')]?.data;
  if (rawVault) accounts.treasuryOre.rawAmountAtContext = rawVault.readBigUInt64LE(64).toString();
  let currentRound = null;
  if (rawBoard) {
    const roundId = rawBoard.readBigUInt64LE(8);
    const idBytes = Buffer.alloc(8); idBytes.writeBigUInt64LE(roundId);
    const [roundAddress] = PublicKey.findProgramAddressSync([Buffer.from('round'), idBytes], key(address.program));
    const roundResponse = await connection.getAccountInfoAndContext(roundAddress, 'confirmed');
    const roundInfo = roundResponse.value;
    currentRound = {address:roundAddress.toBase58(), roundId:roundId.toString(),
      contextSlot:roundResponse.context.slot,
      owner:roundInfo && pubkey(roundInfo.owner), lamports:roundInfo?.lamports,
      dataLength:roundInfo?.data.length};
  }
  const parsedVault = await connection.getParsedAccountInfo(key(address.treasuryOre), 'confirmed');
  accounts.treasuryOre.parsed = parsedVault.value?.data?.parsed?.info;
  accounts.treasuryOre.parsedContextSlot = parsedVault.context.slot;
  const treasuryTokens = await connection.getTokenAccountsByOwner(key(address.treasury), {programId:key('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')}, 'confirmed');
  const treasuryTokenAccounts = treasuryTokens.value.map(row => ({
    address: row.pubkey.toBase58(), dataLength: row.account.data.length,
    rawAmount: row.account.data.readBigUInt64LE(64).toString(),
    mint: new PublicKey(row.account.data.subarray(0, 32)).toBase58(),
  }));
  const recent = await connection.getSignaturesForAddress(key(address.treasuryOre), {limit: 30}, 'confirmed');
  const signatures = [...new Set([...oldOutflowSignatures, ...recent.slice(0, 12).map(row => row.signature)])];
  const txs = [];
  for (const signature of signatures) {
    const tx = await connection.getParsedTransaction(signature, {commitment:'confirmed', maxSupportedTransactionVersion:1});
    if (!tx) { txs.push({signature, found:false}); continue; }
    const message = tx.transaction.message;
    txs.push({
      signature, slot:tx.slot, blockTime:tx.blockTime, err:tx.meta?.err,
      signers:message.accountKeys.filter(row => row.signer).map(row => pubkey(row.pubkey)),
      topInstructions:message.instructions.map((ix, index) => ({
        index, program:pubkey(ix.programId), data:ix.data,
        accounts:ix.accounts?.map(pubkey), parsed:ix.parsed,
      })),
      innerTokenTransfers:(tx.meta?.innerInstructions || []).flatMap(group => group.instructions.map(ix => ({
        parentIndex:group.index, program:pubkey(ix.programId), parsed:ix.parsed,
      }))).filter(ix => ix.parsed?.type === 'transfer' || ix.parsed?.type === 'transferChecked'),
      tokenBalances:{pre:tx.meta?.preTokenBalances, post:tx.meta?.postTokenBalances},
      programLogs:(tx.meta?.logMessages || []).filter(line => line.includes('oreV3EG1') || line.includes('Claiming') || line.includes('Program log:')),
    });
  }
  const output = {
    observedAt:new Date().toISOString(), commitment:'confirmed', slot:context.slot,
    accounts, currentRound, treasuryTokenAccounts,
    treasuryTokenAccountsContextSlot:treasuryTokens.context.slot,
    recentVaultSignatures:recent.map(row => ({signature:row.signature, slot:row.slot, err:row.err})),
    transactions:txs,
  };
  const outputPath = __dirname + '/ore-v3-readonly-gate.json';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(JSON.stringify({observedAt:output.observedAt,slot:output.slot,
    programData:accounts.programData,
    treasuryOre:{address:accounts.treasuryOre.address,rawAmountAtContext:accounts.treasuryOre.rawAmountAtContext,
      parsedContextSlot:accounts.treasuryOre.parsedContextSlot,parsed:accounts.treasuryOre.parsed},
    treasuryLiabilities:accounts.treasury.parsed, board:accounts.board.parsed,
    config:accounts.config.parsed, currentRound,
    treasuryTokenAccounts, transactionCount:txs.length,
    outflowTransactions:txs.slice(0,3).map(tx=>({signature:tx.signature,slot:tx.slot,signers:tx.signers,
      topPrograms:tx.topInstructions?.map(ix=>ix.program),
      innerTokenTransfers:tx.innerTokenTransfers?.filter(ix=>ix.parsed?.info?.source === address.treasuryOre),
      programLogs:tx.programLogs?.slice(-10)}))},null,2) + '\n');
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
