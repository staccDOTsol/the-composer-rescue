// Read-only DAMM v1 / Dynamic Vault binding and custody scan.
// Uses getMultipleAccountsInfo and public price reads only; never submits transactions.
const fs = require('fs');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const { Connection, PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const root = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/';
const apiPath = root + 'damm-v1-top100-resume-api.json';
const idlPath = root + 'damm-v1-sdk-2.0.0-resume.idl.json';
const outputPath = root + 'damm-v1-integration-census-resume.json';
const dammProgram = new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');
const vaultProgram = new PublicKey('24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi');
const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const zero = new PublicKey('11111111111111111111111111111111');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pk = value => value.toBase58();
const bigintString = value => BigInt(value.toString());
const toNumber = value => Number(value);
const ratioAmount = (share, numerator, denominator) => denominator === 0n ? 0n : share * numerator / denominator;

function parseToken(info) {
  if (!info || !info.owner.equals(tokenProgram) || info.data.length < 72) return null;
  return {
    ownerProgram: pk(info.owner),
    mint: pk(new PublicKey(info.data.subarray(0, 32))),
    authority: pk(new PublicKey(info.data.subarray(32, 64))),
    amount: info.data.readBigUInt64LE(64).toString(),
  };
}

function parseMint(info) {
  if (!info || !info.owner.equals(tokenProgram) || info.data.length < 82) return null;
  const mintAuthorityOption = info.data.readUInt32LE(0);
  const freezeAuthorityOption = info.data.readUInt32LE(46);
  return {
    ownerProgram: pk(info.owner),
    mintAuthorityOption,
    mintAuthority: mintAuthorityOption ? pk(new PublicKey(info.data.subarray(4, 36))) : null,
    supply: info.data.readBigUInt64LE(36).toString(),
    decimals: info.data[44],
    freezeAuthorityOption,
    freezeAuthority: freezeAuthorityOption ? pk(new PublicKey(info.data.subarray(50, 82))) : null,
  };
}

async function fetchMap(connection, addresses, slotRanges) {
  const unique = [...new Set(addresses)];
  const result = new Map();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const response = await connection.getMultipleAccountsInfoAndContext(chunk.map(x => new PublicKey(x)), 'confirmed');
    slotRanges.push(response.context.slot);
    chunk.forEach((address, index) => result.set(address, response.value[index]));
    if (i + 100 < unique.length) await pause(90);
  }
  return result;
}

async function fetchPrices(mints) {
  const prices = {};
  for (let i = 0; i < mints.length; i += 80) {
    const chunk = mints.slice(i, i + 80);
    const url = 'https://coins.llama.fi/prices/current/' + chunk.map(mint => 'solana:' + mint).join(',');
    const response = await fetch(url);
    if (response.ok) Object.assign(prices, (await response.json()).coins || {});
    if (i + 80 < mints.length) await pause(150);
  }
  return prices;
}

async function main() {
  if (!process.env.RPC_URL) throw new Error('RPC_URL is required');
  const connection = new Connection(process.env.RPC_URL, 'confirmed');
  const api = JSON.parse(fs.readFileSync(apiPath));
  const idl = JSON.parse(fs.readFileSync(idlPath));
  const coder = new anchor.BorshAccountsCoder(idl);
  const pools = api.data;
  const slots = [];

  const poolInfos = await fetchMap(connection, pools.map(row => row.pool_address), slots);
  const decoded = [];
  for (const row of pools) {
    const info = poolInfos.get(row.pool_address);
    let state = null;
    let decodeError = null;
    try { state = coder.decode('Pool', info.data); } catch (error) { decodeError = error.message; }
    decoded.push({ row, info, state, decodeError });
  }

  const vaultAddresses = [...new Set(decoded.flatMap(x => x.state ? [pk(x.state.a_vault), pk(x.state.b_vault)] : []))];
  const vaultInfos = await fetchMap(connection, vaultAddresses, slots);
  const vaultStates = new Map();
  for (const address of vaultAddresses) {
    const info = vaultInfos.get(address);
    let state = null;
    let decodeError = null;
    try { state = coder.decode('Vault', info.data); } catch (error) { decodeError = error.message; }
    vaultStates.set(address, { info, state, decodeError });
  }

  const linkedAddresses = [];
  for (const { state } of decoded) {
    if (!state) continue;
    linkedAddresses.push(
      pk(state.a_vault_lp), pk(state.b_vault_lp),
      pk(state.protocol_token_a_fee), pk(state.protocol_token_b_fee), pk(state.lp_mint),
    );
  }
  for (const { state } of vaultStates.values()) {
    if (!state) continue;
    linkedAddresses.push(pk(state.token_vault), pk(state.lp_mint), pk(state.token_mint));
  }
  const linkedInfos = await fetchMap(connection, linkedAddresses, slots);

  const mints = [...new Set([...vaultStates.values()].filter(x => x.state).map(x => pk(x.state.token_mint)))];
  const prices = await fetchPrices(mints);
  const rows = [];
  let pricedPoolClaimUsd = 0;
  let pricedDirectProtocolFeeUsd = 0;
  let pricedPoolLegs = 0;
  let unpricedPoolLegs = 0;

  for (const { row, info, state, decodeError } of decoded) {
    if (!state) {
      rows.push({ pool: row.pool_address, decodeError, programOwned: info ? info.owner.equals(dammProgram) : false });
      continue;
    }
    const pool = new PublicKey(row.pool_address);
    const aVault = pk(state.a_vault), bVault = pk(state.b_vault);
    const aVaultLp = pk(state.a_vault_lp), bVaultLp = pk(state.b_vault_lp);
    const aMint = pk(state.token_a_mint), bMint = pk(state.token_b_mint);
    const aProtocol = pk(state.protocol_token_a_fee), bProtocol = pk(state.protocol_token_b_fee);
    const lpMint = pk(state.lp_mint);
    const expectedAVaultLp = pk(PublicKey.findProgramAddressSync([new PublicKey(aVault).toBuffer(), pool.toBuffer()], dammProgram)[0]);
    const expectedBVaultLp = pk(PublicKey.findProgramAddressSync([new PublicKey(bVault).toBuffer(), pool.toBuffer()], dammProgram)[0]);
    const expectedProtocolA = pk(PublicKey.findProgramAddressSync([Buffer.from('fee'), new PublicKey(aMint).toBuffer(), pool.toBuffer()], dammProgram)[0]);
    const expectedProtocolB = pk(PublicKey.findProgramAddressSync([Buffer.from('fee'), new PublicKey(bMint).toBuffer(), pool.toBuffer()], dammProgram)[0]);
    const expectedLpMint = pk(PublicKey.findProgramAddressSync([Buffer.from('lp_mint'), pool.toBuffer()], dammProgram)[0]);
    const masterAuthority = aVaultLp;
    const poolLpMint = parseMint(linkedInfos.get(lpMint));

    const legs = [];
    for (const leg of [
      { side: 'a', mint: aMint, vault: aVault, vaultLp: aVaultLp, protocolFee: aProtocol, apiIndex: 0 },
      { side: 'b', mint: bMint, vault: bVault, vaultLp: bVaultLp, protocolFee: bProtocol, apiIndex: 1 },
    ]) {
      const vault = vaultStates.get(leg.vault);
      const vaultState = vault && vault.state;
      const vaultLpAccount = parseToken(linkedInfos.get(leg.vaultLp));
      const protocolFeeAccount = parseToken(linkedInfos.get(leg.protocolFee));
      const vaultTokenAccount = vaultState ? parseToken(linkedInfos.get(pk(vaultState.token_vault))) : null;
      const vaultLpMint = vaultState ? parseMint(linkedInfos.get(pk(vaultState.lp_mint))) : null;
      const tokenMint = vaultState ? parseMint(linkedInfos.get(pk(vaultState.token_mint))) : null;
      const expectedVault = vaultState ? pk(PublicKey.findProgramAddressSync([Buffer.from('vault'), new PublicKey(leg.mint).toBuffer(), vaultState.base.toBuffer()], vaultProgram)[0]) : null;
      const expectedTokenVault = vaultState ? pk(PublicKey.findProgramAddressSync([Buffer.from('token_vault'), new PublicKey(leg.vault).toBuffer()], vaultProgram)[0]) : null;
      const expectedVaultLpMint = vaultState ? pk(PublicKey.findProgramAddressSync([Buffer.from('lp_mint'), new PublicKey(leg.vault).toBuffer()], vaultProgram)[0]) : null;
      const vaultTotal = vaultState ? bigintString(vaultState.total_amount) : 0n;
      const vaultLpSupply = vaultState ? bigintString(vaultState.total_lp_supply) : 0n;
      const heldVaultLp = vaultLpAccount ? BigInt(vaultLpAccount.amount) : 0n;
      const attributableAmount = ratioAmount(heldVaultLp, vaultTotal, vaultLpSupply);
      const price = prices['solana:' + leg.mint];
      const decimals = price ? price.decimals : tokenMint ? tokenMint.decimals : null;
      const attributableUsd = price && decimals !== null ? toNumber(attributableAmount) / 10 ** decimals * price.price : null;
      const protocolFeeUsd = price && decimals !== null && protocolFeeAccount ? toNumber(protocolFeeAccount.amount) / 10 ** decimals * price.price : null;
      if (attributableUsd === null) unpricedPoolLegs++; else { pricedPoolLegs++; pricedPoolClaimUsd += attributableUsd; }
      if (protocolFeeUsd !== null) pricedDirectProtocolFeeUsd += protocolFeeUsd;
      legs.push({
        side: leg.side,
        mint: leg.mint,
        vault: leg.vault,
        vaultLp: leg.vaultLp,
        protocolFee: leg.protocolFee,
        stateBindings: {
          apiMintMatches: row.pool_token_mints[leg.apiIndex] === leg.mint,
          apiVaultMatches: row.vaults[leg.apiIndex] === leg.vault,
          apiVaultLpMatches: row.vault_lps[leg.apiIndex] === leg.vaultLp,
          vaultOwnedByProgram: vault ? vault.info.owner.equals(vaultProgram) : false,
          vaultPdaMatches: expectedVault === leg.vault,
          tokenVaultPdaMatches: vaultState ? expectedTokenVault === pk(vaultState.token_vault) : false,
          vaultLpMintPdaMatches: vaultState ? expectedVaultLpMint === pk(vaultState.lp_mint) : false,
          vaultMintMatchesPool: vaultState ? pk(vaultState.token_mint) === leg.mint : false,
          vaultTokenMintMatches: vaultTokenAccount && vaultTokenAccount.mint === leg.mint,
          vaultTokenAuthorityMatches: vaultTokenAccount && vaultTokenAccount.authority === leg.vault,
          vaultLpAccountMintMatches: vaultLpAccount && vaultState ? vaultLpAccount.mint === pk(vaultState.lp_mint) : false,
          vaultLpAccountAuthorityMatches: vaultLpAccount && vaultLpAccount.authority === masterAuthority,
          protocolFeeMintMatches: protocolFeeAccount && protocolFeeAccount.mint === leg.mint,
          protocolFeeAuthorityMatches: protocolFeeAccount && protocolFeeAccount.authority === masterAuthority,
        },
        vaultState: vaultState ? {
          tokenVault: pk(vaultState.token_vault),
          lpMint: pk(vaultState.lp_mint),
          totalAmount: vaultState.total_amount.toString(),
          totalLpSupply: vaultState.total_lp_supply.toString(),
          nonDefaultStrategies: vaultState.strategies.filter(x => !x.equals(zero)).map(pk),
        } : null,
        balances: {
          idleUnderlyingRaw: vaultTokenAccount ? vaultTokenAccount.amount : null,
          poolHeldVaultLpRaw: vaultLpAccount ? vaultLpAccount.amount : null,
          poolAttributableUnderlyingRaw: attributableAmount.toString(),
          protocolFeeRaw: protocolFeeAccount ? protocolFeeAccount.amount : null,
        },
        valuation: price ? {
          source: 'DefiLlama coins.llama.fi current', symbol: price.symbol, decimals: price.decimals,
          usdPrice: price.price, timestamp: price.timestamp,
          poolAttributableUnderlyingUsd: attributableUsd,
          directProtocolFeeUsd: protocolFeeUsd,
        } : null,
      });
    }

    rows.push({
      pool: row.pool_address,
      programOwned: info.owner.equals(dammProgram),
      enabled: state.enabled,
      lpMint,
      stateMatchesApiLpMint: lpMint === row.lp_mint,
      pdaBindings: {
        aVaultLpMatches: aVaultLp === expectedAVaultLp,
        bVaultLpMatches: bVaultLp === expectedBVaultLp,
        protocolFeeAMatches: aProtocol === expectedProtocolA,
        protocolFeeBMatches: bProtocol === expectedProtocolB,
        lpMintMatches: lpMint === expectedLpMint,
      },
      lpMintControls: poolLpMint ? {
        mintAuthorityMatchesMaster: poolLpMint.mintAuthority === masterAuthority,
        freezeAuthorityAbsent: poolLpMint.freezeAuthorityOption === 0,
        actualSupply: poolLpMint.supply,
        trackedSupply: state.lp_mint_supply.toString(),
        supplyMatchesTracked: poolLpMint.supply === state.lp_mint_supply.toString(),
      } : null,
      apiPoolTvlUsd: Number(row.pool_tvl),
      legs,
    });
  }

  const uniqueVaultRows = [];
  let pricedSharedIdleUsd = 0;
  let pricedSharedTotalUsd = 0;
  let pricedVaults = 0;
  let unpricedVaults = 0;
  for (const address of vaultAddresses) {
    const entry = vaultStates.get(address);
    if (!entry.state) continue;
    const state = entry.state;
    const tokenAccount = parseToken(linkedInfos.get(pk(state.token_vault)));
    const mintInfo = parseMint(linkedInfos.get(pk(state.token_mint)));
    const price = prices['solana:' + pk(state.token_mint)];
    const idleAmount = tokenAccount ? BigInt(tokenAccount.amount) : 0n;
    const totalAmount = bigintString(state.total_amount);
    let valuation = null;
    if (price) {
      const idleUsd = toNumber(idleAmount) / 10 ** price.decimals * price.price;
      const totalUsd = toNumber(totalAmount) / 10 ** price.decimals * price.price;
      valuation = { source: 'DefiLlama coins.llama.fi current', symbol: price.symbol, decimals: price.decimals, usdPrice: price.price, timestamp: price.timestamp, idleUsd, totalUsd };
      pricedSharedIdleUsd += idleUsd;
      pricedSharedTotalUsd += totalUsd;
      pricedVaults++;
    } else unpricedVaults++;
    uniqueVaultRows.push({
      vault: address,
      tokenMint: pk(state.token_mint),
      tokenVault: pk(state.token_vault),
      lpMint: pk(state.lp_mint),
      idleUnderlyingRaw: idleAmount.toString(),
      totalUnderlyingRaw: totalAmount.toString(),
      lpSupplyRaw: state.total_lp_supply.toString(),
      tokenDecimals: mintInfo ? mintInfo.decimals : null,
      linkedSamplePools: rows.filter(row => row.legs && row.legs.some(leg => leg.vault === address)).length,
      nonDefaultStrategies: state.strategies.filter(x => !x.equals(zero)).map(pk),
      valuation,
    });
  }

  const allBindingChecks = [];
  const variantDerivationObservations = [];
  for (const row of rows) {
    if (!row.legs) continue;
    // Permissioned DAMM pools may use an arbitrary signer LP mint, and legacy Dynamic
    // Vaults may store a non-canonical LP mint. Those derivation observations are not
    // authorization failures: the state-bound mint/account/authority checks below are.
    allBindingChecks.push(
      row.programOwned,
      row.stateMatchesApiLpMint,
      row.pdaBindings.aVaultLpMatches,
      row.pdaBindings.bVaultLpMatches,
      row.pdaBindings.protocolFeeAMatches,
      row.pdaBindings.protocolFeeBMatches,
    );
    variantDerivationObservations.push(row.pdaBindings.lpMintMatches);
    if (row.lpMintControls) allBindingChecks.push(...Object.values(row.lpMintControls).filter(x => typeof x === 'boolean'));
    for (const leg of row.legs) {
      const { vaultLpMintPdaMatches, ...requiredBindings } = leg.stateBindings;
      allBindingChecks.push(...Object.values(requiredBindings));
      variantDerivationObservations.push(vaultLpMintPdaMatches);
    }
  }
  const output = {
    timestamp: new Date().toISOString(),
    rpcObservationSlots: { min: Math.min(...slots), max: Math.max(...slots), calls: slots.length },
    programs: { dammV1: pk(dammProgram), dynamicVault: pk(vaultProgram), tokenProgram: pk(tokenProgram) },
    sample: {
      apiEndpoint: 'https://damm-api.meteora.ag/pools/search?page=1&size=100&sort_key=tvl&order_by=desc',
      apiPage: api.page,
      sampledPools: pools.length,
      apiTotalPools: api.total_count,
      coverageFraction: pools.length / api.total_count,
      apiReportedPoolTvlUsd: pools.reduce((sum, row) => sum + Number(row.pool_tvl), 0),
    },
    summary: {
      decodedProgramOwnedPools: rows.filter(row => row.programOwned && row.legs).length,
      enabledPools: rows.filter(row => row.enabled).length,
      distinctDynamicVaults: uniqueVaultRows.length,
      bindingChecks: allBindingChecks.length,
      failedBindingChecks: allBindingChecks.filter(Boolean).length === allBindingChecks.length ? 0 : allBindingChecks.filter(x => !x).length,
      canonicalMintDerivationsMatched: variantDerivationObservations.filter(Boolean).length,
      canonicalMintDerivationsNotMatched: variantDerivationObservations.filter(x => !x).length,
      pricedPoolLegs,
      unpricedPoolLegs,
      pricedPoolAttributableDynamicVaultClaimsUsd: pricedPoolClaimUsd,
      pricedDirectProtocolFeeTokenCustodyUsd: pricedDirectProtocolFeeUsd,
      pricedDistinctSharedDynamicVaultIdleCustodyUsd: pricedSharedIdleUsd,
      pricedDistinctSharedDynamicVaultTotalAccountingUsd: pricedSharedTotalUsd,
      pricedDistinctVaults: pricedVaults,
      unpricedDistinctVaults: unpricedVaults,
      distinctVaultsWithStrategies: uniqueVaultRows.filter(row => row.nonDefaultStrategies.length).length,
    },
    uniqueDynamicVaults: uniqueVaultRows,
    pools: rows,
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ outputPath, ...output.sample, ...output.summary, slots: output.rpcObservationSlots }, null, 2));
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
