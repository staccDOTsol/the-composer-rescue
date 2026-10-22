#!/usr/bin/env node
// Read-only full Hadron config/ATA census. Never signs or submits transactions.
const fs=require('fs');
const path=require('path');
const {Connection,PublicKey}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {getAssociatedTokenAddressSync}=require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const {decodeConfig,getConfigAddress,CONFIG_SIZE,PoolState,HADRON_PROGRAM_ID}=require('./hadron-sdk/package/dist/index.js');
const envFile='/Users/stacc/.config/stacc-ladder/rpc.env';
const row=fs.readFileSync(envFile,'utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if(!row)throw Error('SOLANA_RPC missing');
const rpcUrl=row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const connection=new Connection(rpcUrl,'confirmed');
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
function parseVault(address,account,expectedMint,expectedAuthority,expectedTokenProgram){
  if(!account)return{address,exists:false,raw:'0',valid:false};
  const data=account.data;
  const mint=new PublicKey(data.subarray(0,32)).toBase58();
  const authority=new PublicKey(data.subarray(32,64)).toBase58();
  const raw=data.readBigUInt64LE(64).toString();
  const tokenProgram=account.owner.toBase58();
  return{address,exists:true,raw,mint,authority,tokenProgram,
    valid:mint===expectedMint&&authority===expectedAuthority&&tokenProgram===expectedTokenProgram};
}
async function main(){
  const genesis=await connection.getGenesisHash();
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('wrong cluster');
  const startSlot=await connection.getSlot('confirmed');
  const rows=await connection.getProgramAccounts(HADRON_PROGRAM_ID,{filters:[{dataSize:CONFIG_SIZE}],commitment:'confirmed'});
  const configs=[];
  for(const row of rows){
    try{
      const data=decodeConfig(row.account.data);
      const id=row.pubkey.toBase58();
      const expected=getConfigAddress(data.seed,data.mintX,data.mintY)[0].toBase58();
      const x=getAssociatedTokenAddressSync(data.mintX,row.pubkey,true,data.tokenProgramX).toBase58();
      const y=getAssociatedTokenAddressSync(data.mintY,row.pubkey,true,data.tokenProgramY).toBase58();
      configs.push({id,state:data.state,seed:data.seed.toString(),mintX:data.mintX.toBase58(),mintY:data.mintY.toBase58(),
        tokenProgramX:data.tokenProgramX.toBase58(),tokenProgramY:data.tokenProgramY.toBase58(),
        configPdaMatches:id===expected,vaultX:x,vaultY:y});
    }catch(error){configs.push({id:row.pubkey.toBase58(),error:error.message});}
  }
  const addresses=configs.filter(c=>!c.error).flatMap(c=>[c.vaultX,c.vaultY]);
  const accountMap=new Map();
  for(let i=0;i<addresses.length;i+=100){
    const slice=addresses.slice(i,i+100);
    const accountRows=await connection.getMultipleAccountsInfo(slice.map(x=>new PublicKey(x)),'confirmed');
    slice.forEach((address,j)=>accountMap.set(address,accountRows[j]));
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  const pools=configs.map(c=>{
    if(c.error)return c;
    const x=parseVault(c.vaultX,accountMap.get(c.vaultX),c.mintX,c.id,c.tokenProgramX);
    const y=parseVault(c.vaultY,accountMap.get(c.vaultY),c.mintY,c.id,c.tokenProgramY);
    return {...c,balances:{x,y},usdcRaw:
      ((c.mintX===USDC?BigInt(x.raw):0n)+(c.mintY===USDC?BigInt(y.raw):0n)).toString()};
  });
  const endSlot=await connection.getSlot('confirmed');
  const good=pools.filter(p=>p.balances);
  const nonzero=good.filter(p=>BigInt(p.balances.x.raw)>0n||BigInt(p.balances.y.raw)>0n);
  const stateCounts=Object.fromEntries([...new Set(good.map(p=>p.state))].map(s=>[String(s),good.filter(p=>p.state===s).length]));
  const output={observedAtUtc:new Date().toISOString(),genesis,startSlot,endSlot,
    program:HADRON_PROGRAM_ID.toBase58(),deploySlot:JSON.parse(fs.readFileSync(path.join(__dirname,'hadron-current-program.json'))).lastDeploySlot,
    binarySha256:'d08a1a5993212f5b858a371460a8b804896d139d47b6bb57f3755fb53a1d977a',
    sdkVersion:'0.1.9',noTransactions:true,
    summary:{configAccounts:rows.length,decoded:good.length,decodeFailures:rows.length-good.length,
      matchedConfigPdas:good.filter(p=>p.configPdaMatches).length,
      validVaults:good.reduce((n,p)=>n+Number(p.balances.x.valid)+Number(p.balances.y.valid),0),
      nonzeroPools:nonzero.length,stateCounts,
      observedUsdcRaw:good.reduce((n,p)=>n+BigInt(p.usdcRaw),0n).toString()},
    pools};
  fs.writeFileSync(path.join(__dirname,'hadron-current-census.json'),JSON.stringify(output,null,2)+'\n');
  const top=nonzero.sort((a,b)=>BigInt(a.usdcRaw)===BigInt(b.usdcRaw)?0:BigInt(a.usdcRaw)>BigInt(b.usdcRaw)?-1:1).slice(0,15);
  console.log(JSON.stringify({startSlot,endSlot,summary:output.summary,top:top.map(p=>({id:p.id,state:p.state,mintX:p.mintX,mintY:p.mintY,x:p.balances.x.raw,y:p.balances.y.raw,usdcRaw:p.usdcRaw}))}));
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1});
