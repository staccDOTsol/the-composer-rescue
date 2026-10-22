#!/usr/bin/env node
// Conservative economic upper bound from the official-SDK donation risk screen.
const fs=require('fs');const path=require('path');
const input=require('./hadron-donation-risk-screen.json');
const rows=[];
for(const pool of input.rows){
  const baseline=pool.scenarios.find(s=>s.donationFractionPpm===0).risk;
  const xUnit=10**pool.vaultX.decimals,yUnit=10**pool.vaultY.decimals;
  for(const s of pool.scenarios.filter(s=>BigInt(s.donationRaw)>0n)){
    const donationUi=Number(s.donationRaw)/(s.donationSide==='x'?xUnit:yUnit);
    const xUi=Number(pool.vaultX.raw)/xUnit+(s.donationSide==='x'?donationUi:0);
    const yUi=Number(pool.vaultY.raw)/yUnit+(s.donationSide==='y'?donationUi:0);
    const positiveFactorDelta=Math.max(0,
      s.risk.riskFactorBid-baseline.riskFactorBid,
      s.risk.riskFactorAsk-baseline.riskFactorAsk);
    // Even granting the improved factor across every unit of the larger vault is
    // more generous than a real one-shot swap, whose output is bounded by one vault.
    const factorBenefitUpperBoundUi=Math.max(xUi,yUi)*positiveFactorDelta/
      Math.min(baseline.riskFactorBid,baseline.riskFactorAsk);
    rows.push({pool:pool.pool,label:pool.label,donationSide:s.donationSide,donationFractionPpm:s.donationFractionPpm,
      donationUi,positiveFactorDelta,factorBenefitUpperBoundUi,
      netUpperBoundBeforeRouteFlashAndTxFeesUi:factorBenefitUpperBoundUi-donationUi});
  }
}
rows.sort((a,b)=>b.netUpperBoundBeforeRouteFlashAndTxFeesUi-a.netUpperBoundBeforeRouteFlashAndTxFeesUi);
const output={observedAtUtc:new Date().toISOString(),sourceObservedAtUtc:input.observedAtUtc,noTransactions:true,
  method:'Conservative upper bound: grant the maximum favorable SDK risk-factor change across the entire larger post-donation vault, subtract the irrecoverable donation, and ignore all Hadron, exit, flash, priority, and transaction fees. Negative is therefore dispositive for the sampled donation sizes.',rows};
fs.writeFileSync(path.join(__dirname,'hadron-donation-economics.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({best:rows.slice(0,8),allNegative:rows.every(r=>r.netUpperBoundBeforeRouteFlashAndTxFeesUi<0)},null,2));
