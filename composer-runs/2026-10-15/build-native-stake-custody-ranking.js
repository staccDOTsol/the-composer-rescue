#!/usr/bin/env node
// Build the priced ranking and exact off-curve Stake-authority reconciliation
// from the retained read-only census artifacts.

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
const census = read('native-stake-offcurve-census.json');
const standard = read('standard-spl-stake-pools-current.json');
const sp12 = read('sanctum-spl-live-stake-custody-complete.json');
const spmb = read('sanctum-spl-multi-live-stake-custody-complete.json');
const secondary = read('native-stake-secondary-controllers.json');
const prestaking = read('prestaking-solana-custody.json');
const bnsol = read('bnsol-unstake-custody.json');
const squadsInitial = read('native-stake-squads-classification.json');
const residualTriage = read('native-stake-residual-triage.json');
const priceEvidence = read('5uums-surface-sol-price.json');

const OUT = process.argv[2] || path.join(DIR, 'native-stake-custody-ranking.json');
const SOL_PRICE = priceEvidence.response.So11111111111111111111111111111111111111112.usdPrice;
const toUsd = (sol) => sol * SOL_PRICE;
const lamportsToSolExact = (value) => {
  const lamports = BigInt(value);
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0');
  return `${whole}.${fraction}`;
};

const categoryByAuthority = new Map();
function assign(category, authorities) {
  for (const authority of authorities) {
    const old = categoryByAuthority.get(authority);
    if (old && old !== category) throw new Error(`authority ${authority} overlaps ${old} and ${category}`);
    categoryByAuthority.set(authority, category);
  }
}

assign('known_standard_spl_stake_pool', standard.pools.map((x) => x.withdrawAuthority));
assign('sanctum_sp12_custom_spl', sp12.pools.map((x) => x.withdrawAuthority));
assign('sanctum_spmb_custom_spl', spmb.pools.map((x) => x.withdrawAuthority));
assign('spl_single_validator_pool', secondary.singlePool.pools.map((x) => x.stakeAuthority.address));
assign('the_vault_liquid_unstaker', secondary.vaultLiquidUnstaker.pools.map((x) => x.pool));
assign('sanctum_unstake_pool', secondary.sanctumUnstake.pools.map((x) => x.reservePda.address));
assign('marinade_validator_bonds', secondary.validatorBonds.configs.map((x) => x.bondsWithdrawerAuthorityPda.address));
assign('prestaking_solana', [prestaking.custody.stakeAccounts.authority]);
assign('bnsol_pending_unstake', [bnsol.custody.stakeAccounts.authority]);
assign('known_marinade_native_stake', ['9eG63CdHjsfhHmobHgLtESGC8GabbmRcaSpHAZrtmhco']);
assign('known_jupiter_perps_native_stake', ['AVzP2GeRmqGphJsMxWoqjpUifPpCret7LqWhD8NWQK49']);
assign('squads_user_or_org_vault', squadsInitial.results.map((x) => x.authority));
assign('squads_user_or_org_vault', residualTriage.results.filter((x) => x.squadsVaultProof).map((x) => x.authority));

const reconciliation = new Map();
let offCurveLamports = 0n;
for (const group of census.retainedWithdrawerGroups) {
  const category = categoryByAuthority.get(group.authority) || 'unattributed_offcurve_long_tail';
  const old = reconciliation.get(category) || { authorityGroupCount: 0, stakeAccountCount: 0, stakeLamports: 0n };
  old.authorityGroupCount += 1;
  old.stakeAccountCount += group.accountCount;
  old.stakeLamports += BigInt(group.lamports);
  reconciliation.set(category, old);
  offCurveLamports += BigInt(group.lamports);
}

const reconciliationRows = [...reconciliation].map(([category, x]) => ({
  category,
  authorityGroupCount: x.authorityGroupCount,
  stakeAccountCount: x.stakeAccountCount,
  stakeLamports: x.stakeLamports.toString(),
  stakeSolExact: lamportsToSolExact(x.stakeLamports),
  stakeSol: Number(x.stakeLamports) / 1e9,
})).sort((a, b) => BigInt(b.stakeLamports) > BigInt(a.stakeLamports) ? 1 : -1);

const unknownGroups = census.retainedWithdrawerGroups
  .filter((x) => !categoryByAuthority.has(x.authority))
  .map((x) => ({ authority: x.authority, stakeAccountCount: x.accountCount, stakeLamports: x.lamports, stakeSolExact: lamportsToSolExact(x.lamports), stakeSol: x.sol }))
  .sort((a, b) => BigInt(b.stakeLamports) > BigInt(a.stakeLamports) ? 1 : -1);
const bucketDefs = [
  { label: 'gte_10000_sol', min: 10_000, max: Infinity },
  { label: 'gte_1000_lt_10000_sol', min: 1_000, max: 10_000 },
  { label: 'gte_100_lt_1000_sol', min: 100, max: 1_000 },
  { label: 'lt_100_sol', min: 0, max: 100 },
];
const unknownBuckets = bucketDefs.map(({ label, min, max }) => {
  const rows = unknownGroups.filter((x) => x.stakeSol >= min && x.stakeSol < max);
  const lamports = rows.reduce((sum, x) => sum + BigInt(x.stakeLamports), 0n);
  return { label, authorityGroupCount: rows.length, stakeLamports: lamports.toString(), stakeSolExact: lamportsToSolExact(lamports), stakeSol: Number(lamports) / 1e9 };
});

function rankedRow({ name, programId, stakeLamports, linkedNativeLamports = '0', economicClass, overlap, status, proof }) {
  const stake = BigInt(stakeLamports);
  const linked = BigInt(linkedNativeLamports);
  const gross = stake + linked;
  const sol = Number(gross) / 1e9;
  return {
    name,
    programId,
    economicClass,
    overlap,
    status,
    stakeLamports: stake.toString(),
    stakeSolExact: lamportsToSolExact(stake),
    linkedNativeLamports: linked.toString(),
    linkedNativeSolExact: lamportsToSolExact(linked),
    grossNativeLamports: gross.toString(),
    grossNativeSolExact: lamportsToSolExact(gross),
    grossNativeSol: sol,
    usdAtObservedSolPrice: toUsd(sol),
    proof,
  };
}

const ranking = [
  rankedRow({
    name: 'Sanctum SPL Stake Pool custom fork',
    programId: sp12.programId,
    stakeLamports: sp12.liveStakeLamports,
    economicClass: 'LST backing',
    overlap: 'Do not add to holdings of the corresponding LST mints or aggregators that hold those LSTs.',
    status: 'new controller family beyond the standard SPL Stake Pool program',
    proof: '1,553 decoded pool states; 1,553 canonical [stake_pool,"withdraw"] PDAs verified; live Stake accounts are primary.',
  }),
  rankedRow({
    name: 'Sanctum SPL Multi Stake Pool custom fork',
    programId: spmb.programId,
    stakeLamports: spmb.liveStakeLamports,
    economicClass: 'LST backing',
    overlap: 'Do not add to holdings of JupSOL or the other corresponding pool tokens.',
    status: 'new controller family beyond the standard SPL Stake Pool program',
    proof: '56 decoded pool states; 56 canonical [stake_pool,"withdraw"] PDAs verified; live Stake accounts are primary.',
  }),
  rankedRow({
    name: 'prestaking-solana controller (public product identity unresolved)',
    programId: prestaking.programId,
    stakeLamports: prestaking.custody.stakeAccounts.lamports,
    economicClass: 'program-operated validator stake; claimant class not established',
    overlap: 'No LST mint/backing relationship established.',
    status: 'new material controller',
    proof: 'Program-owned StakeAuthority state links the off-curve authority; successful DelegateStake/MergeStake calls show live signed Stake CPI. Exact seed preimage remains unresolved.',
  }),
  rankedRow({
    name: 'Sanctum unstake.it liquidity pool',
    programId: secondary.sanctumUnstake.programId,
    stakeLamports: secondary.sanctumUnstake.stakeLamports,
    linkedNativeLamports: secondary.sanctumUnstake.reserveLamports,
    economicClass: 'LP-backed liquid-unstake inventory',
    overlap: 'The purchased stake and SOL reserve back the unstake-pool LP token; they are not current backing of the LSTs previously sold into the pool.',
    status: 'new native reserve plus Stake inventory',
    proof: 'Pool state plus reserve/stake-authority PDA [pool_pubkey], with live reserve and complete Stake-authority census.',
  }),
  rankedRow({
    name: 'BNSOL pending unstake controller',
    programId: bnsol.programId,
    stakeLamports: bnsol.custody.stakeAccounts.lamports,
    linkedNativeLamports: bnsol.custody.systemSolLamports,
    economicClass: 'pending redemption / cooldown inventory',
    overlap: 'Distinct from the current BNSOL standard-pool backing because sampled flow burns/transfers BNSOL before split stake is reauthorized into this queue.',
    status: 'new controller downstream of a known standard Stake Pool',
    proof: 'Canonical ["sol_wallet"] PDA plus live WithdrawStakeFromPool and WithdrawSolFromStakeAccount CPI traces.',
  }),
  rankedRow({
    name: 'The Vault Liquid Unstaker',
    programId: secondary.vaultLiquidUnstaker.programId,
    stakeLamports: secondary.vaultLiquidUnstaker.stakeLamports,
    linkedNativeLamports: secondary.vaultLiquidUnstaker.solVaultLamports,
    economicClass: 'LP-backed liquid-unstake inventory',
    overlap: 'Native inventory backs its LP mint; token inventory held by the same pool is outside this native-only ranking.',
    status: 'new controller',
    proof: 'Pool PDA ["pool",authority], SOL-vault PDA ["sol_vault",pool], state links, and successful authorize/deactivate Stake CPI.',
  }),
  rankedRow({
    name: 'SPL Single-Validator Stake Pool',
    programId: secondary.singlePool.programId,
    stakeLamports: secondary.singlePool.stakeLamports,
    linkedNativeLamports: secondary.singlePool.onrampLamports,
    economicClass: 'LST backing',
    overlap: 'Underlying backs each canonical single-pool token and must not be added to those token holdings.',
    status: 'new controller family beyond the standard multi-validator SPL Stake Pool program',
    proof: '57 canonical ["pool",vote] states; ["stake_authority",pool] and ["onramp",pool] PDAs derived and joined to live accounts.',
  }),
].sort((a, b) => BigInt(b.grossNativeLamports) > BigInt(a.grossNativeLamports) ? 1 : -1);

const separateCollateral = rankedRow({
  name: 'Marinade Validator Bonds (standard + institutional)',
  programId: secondary.validatorBonds.programId,
  stakeLamports: secondary.validatorBonds.stakeLamports,
  economicClass: 'validator-owned bond collateral / self-stake',
  overlap: 'Not LST backing or depositor custody; shown separately from the application-custody ranking.',
  status: 'classified residual, excluded from primary protocol-custody sum',
  proof: 'Config-derived ["bonds_authority",config] PDAs for both live configurations and current Stake accounts.',
});

const primaryLamports = ranking.reduce((sum, x) => sum + BigInt(x.grossNativeLamports), 0n);
const output = {
  generatedAt: new Date().toISOString(),
  pricing: {
    asset: 'native SOL / lamports only',
    usdPerSol: SOL_PRICE,
    retrievedAt: priceEvidence.retrievedAt,
    source: priceEvidence.url,
    sourceBlockId: priceEvidence.response.So11111111111111111111111111111111111111112.blockId,
    pricedNativeLamports: primaryLamports.toString(),
    unpricedNativeLamports: '0',
    pricedCoveragePercent: 100,
  },
  primaryRanking: ranking,
  primaryGrossNativeLamports: primaryLamports.toString(),
  primaryGrossNativeSolExact: lamportsToSolExact(primaryLamports),
  primaryGrossNativeSol: Number(primaryLamports) / 1e9,
  primaryGrossUsdAtObservedSolPrice: toUsd(Number(primaryLamports) / 1e9),
  separateCollateral,
  knownParentContext: [
    { name: 'standard SPL Stake Pool program', programId: standard.programId, stakeLamports: standard.liveStakeLamports, stakeSol: standard.liveStakeSol },
    { name: 'Marinade native-stake authority', authority: '9eG63CdHjsfhHmobHgLtESGC8GabbmRcaSpHAZrtmhco', ...(() => { const x = census.retainedWithdrawerGroups.find((g) => g.authority === '9eG63CdHjsfhHmobHgLtESGC8GabbmRcaSpHAZrtmhco'); return { stakeLamports: x.lamports, stakeSol: x.sol }; })() },
    { name: 'Jupiter Perps transfer authority', authority: 'AVzP2GeRmqGphJsMxWoqjpUifPpCret7LqWhD8NWQK49', ...(() => { const x = census.retainedWithdrawerGroups.find((g) => g.authority === 'AVzP2GeRmqGphJsMxWoqjpUifPpCret7LqWhD8NWQK49'); return { stakeLamports: x.lamports, stakeSol: x.sol }; })() },
  ],
  exactStakeAuthorityReconciliation: {
    censusContextSlotMin: census.contextSlotMin,
    censusContextSlotMax: census.contextSlotMax,
    returnedInitializedStakeAccountCount: census.initializedOrDelegatedAccountCount,
    allInitializedStakeLamports: census.initializedOrDelegatedLamports,
    offCurveAuthorityGroupCount: census.retainedWithdrawerGroups.length,
    offCurveStakeLamports: offCurveLamports.toString(),
    offCurveStakeSolExact: lamportsToSolExact(offCurveLamports),
    offCurveStakeSol: Number(offCurveLamports) / 1e9,
    categories: reconciliationRows,
    unattributedBuckets: unknownBuckets,
    unattributedAbove10000Sol: unknownGroups.filter((x) => x.stakeSol >= 10_000),
    allUnattributedGroups: unknownGroups,
  },
  caveats: [
    'The 256 RPC shards are exhaustive by withdraw-authority prefix but were observed across a slot range, not at one atomic bank snapshot.',
    'The Stake program records an authority address, not the parent program or PDA seed. Attribution is exact only where live state, published seeds, or successful program-signed Stake CPI supplies the link.',
    'System-owned native-SOL PDAs have no global reverse-PDA registry. Linked reserves are included for discovered controllers, but the Stake-account census does not prove exhaustive coverage of every unrelated system PDA holding SOL.',
  ],
};

fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUT,
  primaryGrossNativeSol: output.primaryGrossNativeSol,
  primaryGrossUsdAtObservedSolPrice: output.primaryGrossUsdAtObservedSolPrice,
  offCurveStakeSol: output.exactStakeAuthorityReconciliation.offCurveStakeSol,
  unattributedAbove10000Sol: output.exactStakeAuthorityReconciliation.unattributedAbove10000Sol,
  unattributedBuckets: output.exactStakeAuthorityReconciliation.unattributedBuckets,
}, null, 2));
