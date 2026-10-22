#!/usr/bin/env node
'use strict';

// Read-only mainnet-beta custody and receipt gate for the two sampled JupLend AMM pools.
// Never signs, simulates, or broadcasts a transaction.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {PublicKey} = require('../2026-10-15/jup6qf-sdk/node_modules/@solana/web3.js');
const {BorshAccountsCoder} = require('../2026-10-15/jup6qf-sdk/node_modules/@coral-xyz/anchor');
const bs58 = require('../2026-10-15/jup6qf-sdk/node_modules/bs58');

const envPath = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
if ((fs.statSync(envPath).mode & 0o777) !== 0o600) throw Error('RPC env permissions must be 0600');
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  .filter(s => s && !s.startsWith('#')).map(s => s.replace(/^export\s+/, '')
    .split(/=(.*)/s).slice(0, 2).map((v, i) => i ? v.replace(/^['"]|['"]$/g, '') : v)));
const endpoint = env.SOLANA_RPC_URL || env.RPC || env.FLUX_RPC_A;
if (!endpoint) throw Error('RPC endpoint unavailable');

const GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const DEX = 'jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd';
const LIQUIDITY = 'jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC';
const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const P = x => new PublicKey(x);
const liquidityAuthority = PublicKey.findProgramAddressSync([Buffer.from('liquidity')], P(LIQUIDITY))[0].toBase58();
const idlDir = path.resolve(__dirname, '../2026-10-15/jup6qf-source/target/idl');
const dexCoder = new BorshAccountsCoder(JSON.parse(fs.readFileSync(path.join(idlDir, 'dex.json'))));
const liquidityCoder = new BorshAccountsCoder(JSON.parse(fs.readFileSync(path.join(idlDir, 'liquidity.json'))));
const targets = [
  {pair:'USDC/USDT', pool:'FfEJYz4hLLFe4KyNyKYCjvfhMfbtpLH3CXpcPe8nhmfy',
    positions:['4NB8MfVbDzZEEKAda5kxChxPSqJJ2vjTb7hRFZyJ5EWr',
      '37PKKRw8Jv6sXUWi16hjj4TsCmXGugZejsRpWmGzf2PZ'],
    reserves:['94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu',
      'Enao27EWUV2fv3rUqwknJ1eRaM5aAeN5ijeCrM9tayRX'],
    receipt:'5GBqn6wZ5sEimAmm8uaBzhKePxpz8kAo4T7RhyDBVMrsGx8HR9tpKdk68GzRWr1bnr1jxRh8wmfQv3PqtKqGABnK'},
  {pair:'USDC/USDG', pool:'AH9SPk4p2BJJA4WdgJsagpd1D4sAnwL2Tj2gUSM5rYqy',
    positions:['5nWhfcZipZ6acCn3JjnkYyLM1ZwfvkLNcMFrxJNX13bq',
      'J8WWASwhyLzEwRjJjrTwtnJLv6PQw1r9cvMGskqV8Gcn'],
    reserves:['G4KAenCBfybnZLtVe4LdNrmEtQoW3x93oTowFJUPSvx6',
      '94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu'],
    receipt:'jsemUWepbqFJxBjaANRNBZQn1mLvVRHNQ5y5LiShW38wtnm2ZuEzX8VqgkUMr4shsKnjuYCwWYQTLbroiUnPCzz'},
];
let rpcId = 0;
async function rpc(method, params=[]) {
  for (let retry=0; retry<4; retry++) {
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
    const result=await response.json();
    if(response.ok && !result.error) return result.result;
    const error=result.error||{code:response.status,message:response.statusText};
    if(retry<3 && [429,-32005,-32429].includes(error.code)) {
      await new Promise(resolve=>setTimeout(resolve,750*(retry+1))); continue;
    }
    throw Error(`${method}: ${JSON.stringify(error)}`);
  }
}
function meta(key,account,slot) {
  return {key,slot,exists:!!account,owner:account?.owner||null,
    executable:account?.executable||false,dataLength:account?.data?.[0]
      ?Buffer.from(account.data[0],'base64').length:null};
}
function decoded(coder,name,account) {
  if(!account) return null;
  const value=coder.decode(name,Buffer.from(account.data[0],'base64'));
  return Object.fromEntries(Object.entries(value).map(([k,v])=>
    [k,v && typeof v.toBase58==='function' ? v.toBase58() :
      v && typeof v.toString==='function' && typeof v==='object' && !Array.isArray(v)
        ? v.toString() : v]));
}
async function account(key) {
  const result=await rpc('getAccountInfo',[key,{encoding:'base64',commitment:'confirmed'}]);
  return {meta:meta(key,result.value,result.context.slot),value:result.value};
}
async function tokenAccount(key) {
  const result=await rpc('getAccountInfo',[key,{encoding:'jsonParsed',commitment:'confirmed'}]);
  const info=result.value?.data?.parsed?.info||null;
  return {key,slot:result.context.slot,exists:!!result.value,
    tokenProgram:result.value?.owner||null,mint:info?.mint||null,
    authority:info?.owner||null,amount:info?.tokenAmount?.amount||null,
    decimals:info?.tokenAmount?.decimals??null,
    uiAmount:info?.tokenAmount?.uiAmountString||null};
}
async function program(key) {
  const first=await account(key),raw=Buffer.from(first.value?.data?.[0]||'','base64');
  const output={...first.meta,stateTag:raw.length>=4?raw.readUInt32LE(0):null};
  if(raw.length!==36 || output.stateTag!==2 || !output.executable) return output;
  const programDataKey=bs58.encode(raw.subarray(4,36));
  const second=await rpc('getAccountInfo',[programDataKey,{encoding:'base64',
    commitment:'confirmed'}]);
  const head=Buffer.from(second.value?.data?.[0]||'','base64');
  const authorityTag=head.length>=13?head[12]:null;
  const binaryOffset=authorityTag===1?45:13;
  output.programData={...meta(programDataKey,second.value,second.context.slot),
    stateTag:head.length>=4?head.readUInt32LE(0):null,
    lastDeploySlot:head.length>=12?Number(head.readBigUInt64LE(4)):null,
    upgradeAuthority:authorityTag===1&&head.length>=45?bs58.encode(head.subarray(13,45)):null,
    binarySha256:head.length>binaryOffset
      ?crypto.createHash('sha256').update(head.subarray(binaryOffset)).digest('hex'):null};
  return output;
}
async function receipt(signature,vaultKeys,lastDeploySlot) {
  const tx=await rpc('getTransaction',[signature,{encoding:'jsonParsed',
    maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
  if(!tx) return {signature,exists:false};
  const keys=tx.transaction.message.accountKeys;
  const outerSignerSet=new Set(keys.filter(x=>x.signer).map(x=>x.pubkey));
  const groups=(tx.meta?.innerInstructions||[]).map(group=>{
    const stack={1:tx.transaction.message.instructions[group.index]?.programId};
    return {outerIndex:group.index,outerProgram:stack[1],calls:group.instructions.map(ix=>{
      const h=ix.stackHeight??null,parent=h?stack[h-1]||null:null;
      if(h) {stack[h]=ix.programId;for(const old of Object.keys(stack))if(+old>h)delete stack[old];}
      return {program:ix.programId,stackHeight:h,parent,type:ix.parsed?.type||null,
        source:ix.parsed?.info?.source||null,
        destination:ix.parsed?.info?.destination||null,
        authority:ix.parsed?.info?.authority||null,
        mint:ix.parsed?.info?.mint||null,
        amount:ix.parsed?.info?.amount||ix.parsed?.info?.tokenAmount?.amount||null,
        sourceIsSharedLiquidityVault:vaultKeys.includes(ix.parsed?.info?.source),
        authorityOuterSigner:outerSignerSet.has(ix.parsed?.info?.authority)};
    })};
  });
  const transfers=groups.flatMap(g=>g.calls.filter(c=>TOKEN_PROGRAMS.includes(c.program)
    && ['transfer','transferChecked'].includes(c.type))
    .map(c=>({outerIndex:g.outerIndex,outerProgram:g.outerProgram,...c})));
  return {signature,exists:true,slot:tx.slot,postDeploy:tx.slot>lastDeploySlot,
    error:tx.meta?.err||null,outerSignerKeys:[...outerSignerSet],
    directDexTokenCpis:transfers.filter(x=>x.parent===DEX&&x.stackHeight===3),
    sharedVaultOutflows:transfers.filter(x=>x.sourceIsSharedLiquidityVault),
    transfers};
}
async function main() {
  const genesis=await rpc('getGenesisHash');if(genesis!==GENESIS)throw Error('Not mainnet-beta');
  const programs={dex:await program(DEX),liquidity:await program(LIQUIDITY)};
  const rows=[];
  for(const t of targets) {
    const pool=await account(t.pool),state=decoded(dexCoder,'Dex',pool.value);
    const positions=[];
    for(const key of t.positions) {
      const a=await account(key);
      let type,value;
      for(const candidate of ['UserSupplyPosition','UserBorrowPosition']) {
        try {value=decoded(liquidityCoder,candidate,a.value);type=candidate;break;} catch {}
      }
      positions.push({account:a.meta,type,value});
    }
    const reserves=[];
    for(const key of t.reserves) {
      const a=await account(key),value=decoded(liquidityCoder,'TokenReserve',a.value);
      reserves.push({account:a.meta,mint:value?.mint||null,vault:value?.vault||null,
        totalSupplyWithInterest:value?.total_supply_with_interest||null,
        totalBorrowWithInterest:value?.total_borrow_with_interest||null,
        vaultToken:value?.vault?await tokenAccount(value.vault):null});
    }
    const poolKeyTokenAccounts=[],poolKeyTokenAccountQueries=[];
    for(const tokenProgram of TOKEN_PROGRAMS) {
      const found=await rpc('getTokenAccountsByOwner',[t.pool,{programId:tokenProgram},
        {encoding:'jsonParsed',commitment:'confirmed'}]);
      poolKeyTokenAccountQueries.push({tokenProgram,contextSlot:found.context.slot,
        accountCount:found.value.length});
      poolKeyTokenAccounts.push(...found.value.map(x=>x.pubkey));
    }
    const proof=await receipt(t.receipt,reserves.map(r=>r.vault),programs.dex.programData?.lastDeploySlot||Infinity);
    rows.push({pair:t.pair,pool:pool.meta,
      dex:{token0:state?.token_0||null,token1:state?.token_1||null,
        smartCollateralEnabled:state?.is_smart_collateral_enabled||null,
        smartDebtEnabled:state?.is_smart_debt_enabled||null,
        totalSupplyShares:state?.total_supply_shares||null,
        totalBorrowShares:state?.total_borrow_shares||null},
      poolKeyTokenAccounts,poolKeyTokenAccountQueries,positions,reserves,receipt:proof});
  }
  const output={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',genesis,
    readOnly:true,routeSource:'volume-route-discovery.json',
    liquidityAuthority,programs,rows,
    caveat:'Liquidity vault balances are shared across protocols and DEX pools; they are not per-pool custody balances.'};
  const outPath=path.join(__dirname,'juplend-amm-target-gate.json');
  fs.writeFileSync(outPath,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({output:outPath,observedAtUtc:output.observedAtUtc,
    programs:Object.fromEntries(Object.entries(programs).map(([k,v])=>[k,{executable:v.executable,
      lastDeploySlot:v.programData?.lastDeploySlot||null}])),
    rows:rows.map(x=>({pool:x.pool.key,pair:x.pair,owner:x.pool.owner,
      poolKeyTokenAccounts:x.poolKeyTokenAccounts.length,
      vaults:x.reserves.map(r=>({mint:r.mint,vault:r.vault,authority:r.vaultToken?.authority,
        uiAmount:r.vaultToken?.uiAmount})),
      receiptSlot:x.receipt.slot,directDexTokenCpis:x.receipt.directDexTokenCpis.length,
      directDexVaultOutflows:x.receipt.directDexTokenCpis.filter(y=>y.sourceIsSharedLiquidityVault).length}))},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
