#!/usr/bin/env node
// Decode the current 193-byte StakeConfig using the historical first-party IDL.
const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshot.json')));
const idl = JSON.parse(fs.readFileSync(path.join(__dirname, 'official-idl.json')));
const data = Buffer.from(source.rawAccounts[1].data[0], 'base64');
if (data.length !== 193) throw new Error(`config length ${data.length}`);
const expectedDiscriminator = Buffer.from(idl.accounts.find((a)=>a.name === 'StakeConfig').discriminator);
if (!data.subarray(0,8).equals(expectedDiscriminator)) throw new Error('StakeConfig discriminator mismatch');
const pk = (at) => new PublicKey(data.subarray(at,at+32)).toBase58();
const u128 = (at) => BigInt('0x'+Buffer.from(data.subarray(at,at+16)).reverse().toString('hex')).toString();
const state = {
  discriminatorHex: data.subarray(0,8).toString('hex'), bump: data[8],
  authority: pk(9), mint: pk(41), stakeVault: pk(73),
  minStakeAmountRaw: data.readBigUInt64LE(105).toString(),
  cooldownSeconds: data.readBigUInt64LE(113).toString(),
  totalShares: u128(121), sharePrice: u128(137), commissionWeightSum: u128(153),
  cumulativeCommissionPerShare: u128(169), lastVaultAmountRaw: data.readBigUInt64LE(185).toString(),
};
const program = new PublicKey(source.addresses.PROGRAM);
const [derivedConfig, configBump] = PublicKey.findProgramAddressSync([Buffer.from('stake_config')],program);
const [derivedVault, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from('stake_vault')],program);
const vaultAmountRaw = source.parsedVault.value.data.parsed.info.tokenAmount.amount;
const result = {
  generatedAt:new Date().toISOString(), sourceAccountSlot:source.rpcAccountSlot,
  sourceIdlCommit:'6ae3d418bedfcf1b982b18ce8078d57d9c536ad0',
  sourceIdlHistorical:true, // Official sample removed from current main branch.
  state, derivations:{
    config:{address:derivedConfig.toBase58(),bump:configBump,matches:derivedConfig.toBase58()===source.addresses.CONFIG},
    vault:{address:derivedVault.toBase58(),bump:vaultBump,matches:derivedVault.toBase58()===source.addresses.VAULT},
  },
  vaultAmountRaw,
  recordedAmountDeltaRaw:(BigInt(vaultAmountRaw)-BigInt(state.lastVaultAmountRaw)).toString(),
  approximateShareClaimRaw:(BigInt(state.totalShares)*BigInt(state.sharePrice)/1000000000n).toString(),
  shareScale:1000000000,
  mintSupplyRaw:source.supply.value.amount,
  vaultShareOfMintSupplyPct:Number(BigInt(vaultAmountRaw)*1000000n/BigInt(source.supply.value.amount))/10000,
};
fs.writeFileSync(path.join(__dirname,'decoded-config.json'),JSON.stringify(result,null,2)+'\n');
process.stdout.write(JSON.stringify(result,null,2)+'\n');
