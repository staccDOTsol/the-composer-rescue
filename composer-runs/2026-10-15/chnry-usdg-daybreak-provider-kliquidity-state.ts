// Read-only on-chain state check for the USDG/USDC Kamino Liquidity strategy.
// RPC credentials are read locally and never written to output.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { getWhirlpoolStrategyDecoder } from './kliquidity-sdk-official/src/@codegen/kliquidity/accounts/whirlpoolStrategy';

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter(line => line.includes('='))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('RPC URL unavailable');
const strategy = 'ByPbo7yGcsfrEXet3ip3DcMKf4hwhUv71b6aAU9umBdu';
const vaultA = 'AhS8kQyHHaFbc348dmmBBUrsog842Ysn9HkyVxJpSe3u';
const vaultB = '2HtBgoVQXjRj8Aa8QcHT47oSgjWTDvv41NT4xa91Foha';
const mintA = '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH';
const mintB = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const program = '6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc';
const addresses = [strategy, vaultA, vaultB, mintA, mintB, program];
async function main() {
const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
  body: JSON.stringify({jsonrpc:'2.0', id:1, method:'getMultipleAccounts',
    params:[addresses, {encoding:'base64', commitment:'confirmed'}]})});
const body = await response.json();
if (body.error) throw new Error(`getMultipleAccounts ${body.error.code}: ${body.error.message}`);
const rows = body.result.value;
if (rows.some((row:unknown) => !row)) throw new Error('missing on-chain account');
const bytes = (index:number) => Buffer.from(rows[index].data[0], 'base64');
const state = getWhirlpoolStrategyDecoder().decode(bytes(0));
const token = (index:number) => ({ownerProgram:rows[index].owner,
  mint:bytes(index).subarray(0,32).toString('hex'),
  rawAmount:bytes(index).readBigUInt64LE(64).toString(),
  dataSha256:crypto.createHash('sha256').update(bytes(index)).digest('hex')});
const output = {observedAt:new Date().toISOString(), contextSlot:body.result.context.slot,
  source:'mainnet read-only getMultipleAccounts; official Kamino Liquidity SDK v16 decoder',
  program:{address:program, owner:rows[5].owner, executable:rows[5].executable},
  strategy:{address:strategy, owner:rows[0].owner, status:state.status.toString(),
    flashVaultSwapAllowed:state.flashVaultSwapAllowed,
    flashSwapInProgress:state.flashSwapInProgress, emergencyMode:state.emergencyMode,
    tokenAMint:state.tokenAMint, tokenBMint:state.tokenBMint,
    tokenATokenProgram:state.tokenATokenProgram, tokenBTokenProgram:state.tokenBTokenProgram,
    tokenAVault:state.tokenAVault, tokenBVault:state.tokenBVault,
    baseVaultAuthority:state.baseVaultAuthority,
    maxPriceDeviationBps:state.maxPriceDeviationBps.toString(),
    swapVaultMaxSlippageBps:state.swapVaultMaxSlippageBps,
    swapVaultMaxSlippageFromReferenceBps:state.swapVaultMaxSlippageFromReferenceBps},
  vaults:{A:{address:vaultA,...token(1)},B:{address:vaultB,...token(2)}},
  mintOwners:{A:rows[3].owner,B:rows[4].owner},
  rpcCredentialsPersisted:false, submittedTransaction:false};
fs.writeFileSync('composer-runs/2026-10-15/chnry-usdg-daybreak-provider-kliquidity-state.json',
  JSON.stringify(output,null,2));
console.log(JSON.stringify(output));
}
main().catch(error => {console.error(error.message); process.exitCode = 1});
