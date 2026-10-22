// Read-only token-account ownership check for ClaimRewards account substitution.
const fs=require('fs');
const {Connection,PublicKey}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n')
  .filter(Boolean).map(line=>line.split(/=(.*)/s).slice(0,2)));
const connection=new Connection(env.HEAVY_RPC_URL||env.RPC_URL,'confirmed');
const keys=['7FZRSVR4Wf8p26cuNX86zy3FJA86xni1pXokbueuww5J',
  '771Wxey6HRVC6drKg4pHiH8EMQ8EjGvmB79ZBERaT8q1',
  'cCLjaRdDtbVjx2rSzEbmjQ68mAboHq5ywRbmL3bnAi8',
  '4YxvN7qeK9Mk32TzjjKNF72yPBAM4zx5kvV3dQeyMyvF'];
(async()=>{const result=await connection.getMultipleAccountsInfoAndContext(keys.map(x=>new PublicKey(x)),'confirmed');
  const rows=keys.map((key,i)=>{const a=result.value[i];return {key,exists:!!a,program:a?.owner.toBase58(),
    mint:a?.data.length>=32?new PublicKey(a.data.subarray(0,32)).toBase58():null,
    authority:a?.data.length>=64?new PublicKey(a.data.subarray(32,64)).toBase58():null,
    rawAmount:a?.data.length>=72?a.data.readBigUInt64LE(64).toString():null};});
  const output={slot:result.context.slot,rows};
  fs.writeFileSync('composer-runs/2026-10-15/flashloan-grass-claim-accounts.json',JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(output,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
