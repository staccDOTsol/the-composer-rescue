#!/usr/bin/env node
// Fetch bounded live accounts named by observed GRASS instructions; no writes.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const DIR=__dirname,PROGRAM='EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const names=['GlobalConfig','RewardPool','StakingPool','UserStakeInfo','MultisigVault',
  'ScaledRewardPool','ScaledStakingPool','ScaledUserStaked','Withdrawal','UnstakeRequest'];
const discriminators=Object.fromEntries(names.map(n=>[n,crypto.createHash('sha256').update('account:'+n).digest('hex').slice(0,16)]));
async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();
  if(!r.ok||j.error)throw new Error(JSON.stringify(j.error));return j.result;}
async function main(){
  const history=JSON.parse(fs.readFileSync(path.join(DIR,'paths-grass-history.json')));
  const keys=[...new Set(history.samples.flatMap(x=>x.accounts.map(a=>a.key)))];
  const result={program:PROGRAM,observedAt:new Date().toISOString(),discriminators,accounts:[]};
  for(let i=0;i<keys.length;i+=50){const group=keys.slice(i,i+50),res=await rpc('getMultipleAccounts',
    [group,{encoding:'base64',commitment:'confirmed'}]);
    for(let j=0;j<group.length;j++){
      const a=res.value[j],data=a?Buffer.from(a.data[0],'base64'):null;
      result.accounts.push({key:group[j],slot:res.context.slot,owner:a?.owner||null,lamports:a?.lamports||null,
        executable:a?.executable||false,dataLength:data?.length||null,
        discriminator:data?.subarray(0,8).toString('hex')||null,
        accountType:data?Object.entries(discriminators).find(([_,v])=>v===data.subarray(0,8).toString('hex'))?.[0]||null:null,
        dataBase64:a?.data?.[0]||null});
    }
  }
  fs.writeFileSync(path.join(DIR,'paths-grass-accounts.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify({discriminators,accounts:result.accounts.filter(x=>x.owner===PROGRAM)
    .map(({key,slot,dataLength,discriminator,accountType})=>({key,slot,dataLength,discriminator,accountType}))},null,2)+'\n');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
