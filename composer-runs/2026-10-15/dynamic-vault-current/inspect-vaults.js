const { Connection, PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const { BorshAccountsCoder } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@project-serum/anchor');
const { IDL } = require('./package/dist/cjs/src/vault/idl.js');
const fs = require('fs');

const conn = new Connection(process.env.RPC_URL, 'confirmed');
const pid = new PublicKey('24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi');
const base = new PublicKey('HWzXGcGHy4tcpYfaRDCyLNzXqBTv3E6BttpCH2vJxArv');
const mints = [
  ['USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
  ['USDT', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'],
  ['WSOL', 'So11111111111111111111111111111111111111112'],
];
const coder = new BorshAccountsCoder(IDL);
function pdas(mint, b) {
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), mint.toBuffer(), b.toBuffer()], pid);
  const [tokenVault] = PublicKey.findProgramAddressSync([Buffer.from('token_vault'), vault.toBuffer()], pid);
  const [lpMint] = PublicKey.findProgramAddressSync([Buffer.from('lp_mint'), vault.toBuffer()], pid);
  return {vault, tokenVault, lpMint};
}
(async()=>{
  const rows=[];
  for(const [symbol, mintText] of mints) for(const [kind,b] of [['rebalance',base],['idle',new PublicKey('11111111111111111111111111111111')]]) {
    const mint=new PublicKey(mintText), p=pdas(mint,b);
    const [vaultInfo, tokenInfo, mintInfo] = await conn.getMultipleAccountsInfo([p.vault,p.tokenVault,p.lpMint]);
    const row={symbol,kind,mint:mintText,vault:p.vault.toBase58(),tokenVault:p.tokenVault.toBase58(),lpMint:p.lpMint.toBase58(),vaultExists:!!vaultInfo,tokenVaultExists:!!tokenInfo,lpMintExists:!!mintInfo};
    if(vaultInfo) {
      row.vaultDataLength=vaultInfo.data.length;
      try {
        const v=coder.decode('vault',vaultInfo.data);
        row.state={enabled:v.enabled,totalAmount:v.totalAmount.toString(),totalLpSupply:v.totalLpSupply.toString(),tokenVault:v.tokenVault.toBase58(),feeVault:v.feeVault.toBase58(),tokenMint:v.tokenMint.toBase58(),lpMint:v.lpMint.toBase58(),base:v.base.toBase58(),admin:v.admin.toBase58(),operator:v.operator.toBase58(),strategies:v.strategies.filter(x=>!x.equals(PublicKey.default)).map(x=>x.toBase58()),version:v.version,lockedProfitTracker:v.lockedProfitTracker};
        row.state.lockedProfitTracker=JSON.parse(JSON.stringify(row.state.lockedProfitTracker,(k,x)=>x?.toBase58?.()??x?.toString?.()??x));
      } catch(e){row.decodeError=String(e)}
    }
    if(tokenInfo) row.tokenAmount=tokenInfo.data.readBigUInt64LE(64).toString();
    if(mintInfo) row.lpSupply=mintInfo.data.readBigUInt64LE(36).toString();
    rows.push(row);
  }
  fs.writeFileSync(__dirname+'/vault-samples.json',JSON.stringify(rows,null,2));
  console.log(JSON.stringify(rows,null,2));
})().catch(e=>{console.error(String(e));process.exitCode=1});
