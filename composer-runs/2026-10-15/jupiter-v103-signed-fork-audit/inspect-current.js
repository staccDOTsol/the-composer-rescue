#!/usr/bin/env node
// Read-only finalized-state attestation for the Jupiter Vault 103 -> DEX peg path.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection, PublicKey} = require(modules + '@solana/web3.js');
const {BorshAccountsCoder} = require(modules + '@coral-xyz/anchor');
const {getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID} =
  require(modules + '@solana/spl-token');

const root = path.resolve(__dirname, '..');
const idlRoot = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl';
const env = fs.existsSync('/tmp/composer-helius-only.env') ? Object.fromEntries(
  fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split('\n').filter(Boolean)
    .map(line => line.split(/=(.*)/s).slice(0, 2))) : {};
const rpcUrl = process.env.SOLANA_RPC || env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('SOLANA_RPC is required');
const conn = new Connection(rpcUrl, 'finalized');
const P = value => new PublicKey(value);
const PROGRAM = {
  liquidity: P('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC'),
  vaults: P('jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi'),
  flashloan: P('jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS'),
  oracle: P('jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc'),
  lending: P('jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9'),
  dex: P('jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd'),
};
const V103 = {
  vaultId: 103,
  config: P('83UCos6JtbPhs5Raa7HzwNbjCdToQWhvKHzWwyEDgAgr'),
  oracle: P('Hf9Yw2a1EA9aTUbHS8N7AoyqXvWrRvsZqGJuC4YVeaXN'),
  oracleSource: P('H8i4Bz4inXLyWQFgGjXc8sYNCvQgAaAAS45ZZ4UqCCcV'),
  dex: P('G41Dqz9A1v39TT2MryR5BkZU2a7UzfUkiRHyJGuRfeyF'),
  dexSupply0: P('EdRupWtgK6FRjTHCo2TgbjDUGe91oNQno1tG6Vj35fvW'),
  dexSupply1: P('8qXBLcG7hm1NKeAxGbX7kxEy9HhevX4SN6yAmDduQNYk'),
  reserve0: P('2zhomdC3giLb5vf91fCZiKWiFXAD9NwMcV8EQo8NmA3i'),
  reserve1: P('94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu'),
  position: P('Kvvdt33shaPjMeWfhnxKgEP447zKN79YuhS5AvztEyP'),
};
const vaultCoder = new BorshAccountsCoder(JSON.parse(fs.readFileSync(`${idlRoot}/vaults.json`, 'utf8')));
const dexCoder = new BorshAccountsCoder(JSON.parse(fs.readFileSync(`${idlRoot}/dex.json`, 'utf8')));
const liqCoder = new BorshAccountsCoder(JSON.parse(fs.readFileSync(`${idlRoot}/liquidity.json`, 'utf8')));
const u16 = value => { const out = Buffer.alloc(2); out.writeUInt16LE(value); return out; };
const pda = (program, ...seeds) => PublicKey.findProgramAddressSync(seeds, program)[0];
const str = value => value?.toString?.() ?? null;
function clean(value) {
  if (value instanceof PublicKey) return value.toBase58();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, clean(item)]));
  if (typeof value === 'bigint') return value.toString();
  return value;
}
async function upgradeable(program) {
  const first = await conn.getAccountInfoAndContext(program, 'finalized');
  const raw = first.value.data;
  const programdata = new PublicKey(raw.subarray(4, 36));
  const second = await conn.getAccountInfoAndContext(programdata, 'finalized');
  const data = second.value.data;
  const authorityTag = data[12];
  const header = authorityTag === 1 ? 45 : 13;
  return {
    program: program.toBase58(), programdata: programdata.toBase58(),
    contextSlot: Math.min(first.context.slot, second.context.slot),
    deploySlot: Number(data.readBigUInt64LE(4)),
    upgradeAuthority: authorityTag === 1 ? new PublicKey(data.subarray(13, 45)).toBase58() : null,
    binaryBytes: data.length - header,
    binarySha256: crypto.createHash('sha256').update(data.subarray(header)).digest('hex'),
  };
}
async function main() {
  const state = pda(PROGRAM.vaults, Buffer.from('vault_state'), u16(103));
  const addresses = [V103.config, state, V103.oracle, V103.oracleSource, V103.dex,
    V103.dexSupply0, V103.dexSupply1, V103.reserve0, V103.reserve1, V103.position];
  const fetched = await conn.getMultipleAccountsInfoAndContext(addresses, 'finalized');
  const [configInfo, stateInfo, oracleInfo, oracleSourceInfo, dexInfo, supply0Info,
    supply1Info, reserve0Info, reserve1Info, positionInfo] = fetched.value;
  const config = vaultCoder.decode('VaultConfig', configInfo.data);
  const vaultState = vaultCoder.decode('VaultState', stateInfo.data);
  const oracle = vaultCoder.decode('Oracle', oracleInfo.data);
  const dex = dexCoder.decode('Dex', dexInfo.data);
  const supply0 = liqCoder.decode('UserSupplyPosition', supply0Info.data);
  const supply1 = liqCoder.decode('UserSupplyPosition', supply1Info.data);
  const reserve0 = liqCoder.decode('TokenReserve', reserve0Info.data);
  const reserve1 = liqCoder.decode('TokenReserve', reserve1Info.data);
  const position = vaultCoder.decode('Position', positionInfo.data);
  const mint0 = P(str(dex.token_0));
  const mint1 = P(str(dex.token_1));
  const liquidity = pda(PROGRAM.liquidity, Buffer.from('liquidity'));
  const topology = {
    vaultState: state,
    liquidity,
    rateModel0: pda(PROGRAM.liquidity, Buffer.from('rate_model'), mint0.toBuffer()),
    rateModel1: pda(PROGRAM.liquidity, Buffer.from('rate_model'), mint1.toBuffer()),
    vault0: getAssociatedTokenAddressSync(mint0, liquidity, true, TOKEN_2022_PROGRAM_ID),
    vault1: getAssociatedTokenAddressSync(mint1, liquidity, true, TOKEN_PROGRAM_ID),
  };
  const deployments = {};
  for (const [name, program] of Object.entries(PROGRAM)) deployments[name] = await upgradeable(program);
  const out = clean({
    generatedAt: new Date().toISOString(), commitment: 'finalized', transport: 'read-only RPC',
    contextSlot: fetched.context.slot, vaultId: 103, deployments,
    ownership: addresses.map((address, index) => ({address, owner: fetched.value[index]?.owner || null,
      executable: fetched.value[index]?.executable || false, dataBytes: fetched.value[index]?.data.length || 0})),
    decoded: {config, vaultState, oracle, dex, supply0, supply1, reserve0, reserve1, position},
    topology,
    oracleSource: {address: V103.oracleSource, owner: oracleSourceInfo.owner,
      dataBytes: oracleSourceInfo.data.length},
  });
  fs.writeFileSync(path.join(__dirname, 'current-finalized-state.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({generatedAt: out.generatedAt, contextSlot: out.contextSlot,
    deployments: Object.fromEntries(Object.entries(out.deployments).map(([key, value]) =>
      [key, {deploySlot: value.deploySlot, upgradeAuthority: value.upgradeAuthority,
        binarySha256: value.binarySha256}])),
    vault: {config: V103.config.toBase58(), state: state.toBase58(), oracle: V103.oracle.toBase58(),
      dex: V103.dex.toBase58(), mint0: mint0.toBase58(), mint1: mint1.toBase58(),
      dexSupply0: str(supply0.amount), dexSupply1: str(supply1.amount),
      topmostTick: str(vaultState.topmost_tick), positionTick: str(position.tick),
      positionSupply: str(position.supply_amount), positionDustDebt: str(position.dust_debt_amount)},
    topology: out.topology}, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
