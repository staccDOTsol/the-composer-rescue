#!/usr/bin/env node
// Read-only Solana RPC snapshot of the canonical SKR staking configuration.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const PROGRAM = 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';
const CONFIG = '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw';
const VAULT = '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8';
const GUARDIAN = 'DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr';
const MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const PROGRAM_DATA = '7f1KoiGPFFouvAafZtVmtdpgGJuADprihB9Pdzut3gaJ';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter(line => line.includes('=')).map(line => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
if (!endpoint) throw Error('RPC_URL absent');

async function rpc(method, params) {
  const response = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const output = await response.json();
  if (output.error) throw Error(`${method}: ${JSON.stringify(output.error)}`);
  return output.result;
}
const pk = data => new PublicKey(data).toBase58();
const u64 = (data, at) => data.readBigUInt64LE(at).toString();
const u128 = (data, at) => (data.readBigUInt64LE(at) + (data.readBigUInt64LE(at+8) << 64n)).toString();
const bytes = row => Buffer.from(row.data[0], 'base64');
function config(data) {
  let at = 8;
  const bump = data[at++];
  const authority = pk(data.subarray(at, at+=32));
  const mint = pk(data.subarray(at, at+=32));
  const stakeVault = pk(data.subarray(at, at+=32));
  const minStakeAmount = u64(data, at); at+=8;
  const cooldownSeconds = u64(data, at); at+=8;
  const totalShares = u128(data, at); at+=16;
  const sharePrice = u128(data, at); at+=16;
  const commissionWeightSum = u128(data, at); at+=16;
  const cumulativeCommissionPerShare = u128(data, at); at+=16;
  const lastVaultAmount = u64(data, at); at+=8;
  return {discriminatorHex:data.subarray(0,8).toString('hex'), length:data.length, decodedLength:at,
    bump, authority, mint, stakeVault, minStakeAmount, cooldownSeconds, totalShares,
    sharePrice, commissionWeightSum, cumulativeCommissionPerShare, lastVaultAmount};
}
function guardian(data) {
  let at=8;
  const stakeConfig=pk(data.subarray(at,at+=32));
  const guardian=pk(data.subarray(at,at+=32));
  const authority=pk(data.subarray(at,at+=32));
  const totalShares=u128(data,at);at+=16;
  const cumulativeCommissionPerShare=u128(data,at);at+=16;
  const lastSharePrice=u128(data,at);at+=16;
  const accruedCommission=u128(data,at);at+=16;
  const commissionBps=data.readUInt16LE(at);at+=2;
  const bump=data[at++]; const active=!!data[at++];
  const deregisteredSharePrice=u128(data,at);at+=16;
  return {discriminatorHex:data.subarray(0,8).toString('hex'),length:data.length,decodedLength:at,
    stakeConfig,guardian,authority,totalShares,cumulativeCommissionPerShare,lastSharePrice,
    accruedCommission,commissionBps,bump,active,deregisteredSharePrice};
}
function token(data) {
  return {length:data.length,mint:pk(data.subarray(0,32)),authority:pk(data.subarray(32,64)),amount:u64(data,64)};
}
async function main() {
  const addresses=[PROGRAM, PROGRAM_DATA, CONFIG, VAULT, GUARDIAN, MINT];
  const result=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed'}]);
  const entries=Object.fromEntries(addresses.map((address,i)=>[address,result.value[i]]));
  if (addresses.some(address=>!entries[address])) throw Error('One or more selected accounts missing');
  const c=config(bytes(entries[CONFIG]));
  const v=token(bytes(entries[VAULT]));
  const g=guardian(bytes(entries[GUARDIAN]));
  const pd=bytes(entries[PROGRAM_DATA]);
  const price=BigInt(c.sharePrice), shares=BigInt(c.totalShares), scale=1000000000n;
  const computedShareClaimsFloor=shares*price/scale;
  const out={timestamp:new Date().toISOString(),rpcCommitment:'confirmed',slot:result.context.slot,
    noTransactionsSubmitted:true,program:{address:PROGRAM,executable:entries[PROGRAM].executable,
      owner:entries[PROGRAM].owner,programData:PROGRAM_DATA,upgradeSlot:pd.readBigUInt64LE(4).toString(),
      currentBinarySha256:crypto.createHash('sha256').update(pd.subarray(45)).digest('hex')},
    config:{address:CONFIG,owner:entries[CONFIG].owner,...c},
    vault:{address:VAULT,owner:entries[VAULT].owner,...v},
    sampleGuardian:{address:GUARDIAN,owner:entries[GUARDIAN].owner,...g},
    accounting:{sharePriceScale:scale.toString(),computedShareClaimsFloor:computedShareClaimsFloor.toString(),
      vaultMinusShareClaims:(BigInt(v.amount)-computedShareClaimsFloor).toString(),
      vaultMinusLastRecorded:(BigInt(v.amount)-BigInt(c.lastVaultAmount)).toString(),
      vaultMatchesConfig:v.mint===c.mint&&v.authority===CONFIG&&c.stakeVault===VAULT,
      guardianMatchesConfig:g.stakeConfig===CONFIG,
      note:'Share claims omit pending unstake liabilities and guardian accrued commissions; difference is not free value.'}};
  fs.writeFileSync(path.join(DIR,'live-accounting.json'),JSON.stringify(out,null,2)+'\n');
  process.stdout.write(JSON.stringify(out,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
