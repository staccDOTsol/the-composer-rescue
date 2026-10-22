#!/usr/bin/env python3
"""Join read-only current-state censuses into one deduplicated surface artifact."""
import datetime as dt
from decimal import Decimal, getcontext
import json
import pathlib

getcontext().prec = 70
DIR = pathlib.Path(__file__).resolve().parent


def read(name):
    return json.loads((DIR / name).read_text())


def main():
    programs = read('5uums-surface-programdata.json')
    program_states = read('5uums-surface-program-owned-state.json')
    tokens = read('5uums-surface-token-census.json')
    prices = read('5uums-surface-prices.json')
    quotes = read('5uums-surface-quotes.json')
    native = read('5uums-surface-native.json')
    sol_price = read('5uums-surface-sol-price.json')
    mint_control = read('5uums-surface-programdata-third-mint.json')
    price_by_account = {x['address']: x for x in prices['rows']}
    quote_by_account = {x['address']: x for x in quotes['tokens']}
    owner_addresses = {x['address'] for x in tokens['tokenAccounts']}
    if len(owner_addresses) != tokens['summary']['uniqueTokenAccounts']:
        raise ValueError('Token account duplicate or summary count mismatch')
    if len({x['programDataAddress'] for x in programs['programs']}) != programs['programDataCount']:
        raise ValueError('ProgramData duplicate or summary mismatch')
    rows = []
    for a in tokens['tokenAccounts']:
        p = price_by_account.get(a['address'], {})
        q = quote_by_account.get(a['address'], {})
        fq = q.get('fullVault', {})
        supply = Decimal(a['mintSupplyRaw']) if a.get('mintSupplyRaw') else None
        row = {
            'address': a['address'], 'authority': a['authority'],
            'tokenProgram': a['tokenProgram'], 'mint': a['mint'],
            'amountRaw': a['amountRaw'], 'decimals': a['decimals'],
            'uiAmountExact': a['uiAmountExact'],
            'mintSupplyRaw': a.get('mintSupplyRaw'),
            'shareOfMintSupplyPct': str(Decimal(a['amountRaw']) / supply * 100) if supply else None,
            'state': a['state'], 'canonicalAta': a.get('canonicalAta'),
            'delegate': a['delegate'], 'closeAuthority': a['closeAuthority'],
            'mintAuthority': a.get('mintAuthority'), 'freezeAuthority': a.get('freezeAuthority'),
            'symbol': p.get('symbol'), 'priceUsd': p.get('price', {}).get('usdPrice') if p.get('price') else None,
            'priceBlockId': p.get('price', {}).get('blockId') if p.get('price') else None,
            'reportedLiquidityUsd': p.get('price', {}).get('liquidity') if p.get('price') else None,
            'arithmeticSpotMarkUsd': p.get('markUsd'),
            'fullVaultUsdcQuote': fq.get('outUSDC'),
            'fullVaultQuoteContextSlot': fq.get('contextSlot'),
            'fullVaultQuotePriceImpactPct': fq.get('priceImpactPct'),
            'fullVaultQuoteHttpStatus': fq.get('httpStatus'),
            'fullVaultQuoteError': fq.get('error'),
        }
        rows.append(row)
    if set(price_by_account) != owner_addresses or set(quote_by_account) != owner_addresses:
        raise ValueError('Price or quote set does not match current token owner set')
    by_authority = {}
    for label, address in tokens['authorities'].items():
        subset = [x for x in rows if x['authority'] == address]
        by_authority[label] = {'address': address, 'tokenAccounts': len(subset),
                               'distinctMints': len({x['mint'] for x in subset}),
                               'token2022Accounts': sum(x['tokenProgram'].startswith('Tokenz') for x in subset),
                               'positiveTokenAccounts': sum(int(x['amountRaw']) > 0 for x in subset)}
    program_rent = sum(int(x['rentLamports']) for x in programs['programs'])
    buffer_scans = [x for x in native['nativeAuthorityScans'] if x['className'] == 'upgradeableLoaderBuffer']
    buffers = [a for scan in buffer_scans if scan['accounts'] for a in scan['accounts']]
    if len(buffers) != 1:
        raise ValueError('Expected one verified loader buffer')
    pda_lamports = native['directAccounts'][tokens['authorities']['wrapperPda']]['lamports']
    buffer_lamports = buffers[0]['lamports']
    native_total = pda_lamports + buffer_lamports + program_rent
    sol_price_row = sol_price['response']['So11111111111111111111111111111111111111112']
    priced_rows = [x for x in rows if x['arithmeticSpotMarkUsd'] is not None]
    full_routes = [x for x in rows if x['fullVaultUsdcQuote'] is not None]
    out = {
        'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'subject': 'current one-operator-key conditional control surface of 3LWzk wrapper multisig PDA',
        'precondition': 'possession of one of three existing authorized operator keys; no permissionless outsider exit established',
        'transport': 'get* and simulateTransaction(sigVerify:false) only; no signatures or live transaction submission',
        'pdaAuthorities': tokens['authorities'],
        'counts': {
            'upgradeableProgramData': programs['programDataCount'],
            'linkedExecutablePrograms': programs['executableLinkedProgramCount'],
            'currentProgramOwnedStateAccounts': sum(x['count'] for x in program_states['programs']),
            'directOwnerTokenAccounts': len(rows),
            'splTokenOwnerAccounts': sum(x['tokenProgram'].startswith('Tokenkeg') for x in rows),
            'token2022OwnerAccounts': sum(x['tokenProgram'].startswith('Tokenz') for x in rows),
            'distinctMintsInOwnedAccounts': len({x['mint'] for x in rows}),
            'additionalSelfAuthorizedMintPdAs': 1,
            'stakeAccountsStakerOrWithdrawer': native['uniqueStakeCount'],
            'voteAccountsAuthorizedWithdrawer': sum(x['count'] for x in native['nativeAuthorityScans'] if x['className'] == 'voteWithdrawer'),
            'loaderBuffersWithAuthority': len(buffers),
        },
        'programData': programs['programs'],
        'programOwnedStates': program_states['programs'],
        'tokenOwnerByAuthority': by_authority,
        'tokenAccounts': rows,
        'separateMintPower': {
            'mint': mint_control['mint'], 'program': mint_control['program'],
            'pda': mint_control['derivedMintPda'],
            'mintAuthority': mint_control['mint'], 'freezeAuthority': mint_control['mint'],
            'decimals': mint_control['alias']['chainBefore'][0]['decimals'],
            'supplyRaw': mint_control['alias']['chainBefore'][0]['rawAmount'],
            'oneKeyMintToSimulationSucceeded': mint_control['alias']['err'] is None,
            'existingTokenAccountOwnerReachability': 'unproven; existing ATA owner is off-curve and is excluded from directly transferable custody',
        },
        'nativeSol': {
            'wrapperPdaLamports': pda_lamports,
            'loaderBufferAddress': buffers[0]['address'], 'loaderBufferLamports': buffer_lamports,
            'closableProgramDataLamports': program_rent,
            'conditionalIndependentCaseTotalLamports': native_total,
            'conditionalIndependentCaseTotalSol': str(Decimal(native_total) / Decimal(1_000_000_000)),
            'conditionalIndependentCaseSolPriceUsd': sol_price_row['usdPrice'],
            'conditionalIndependentCaseSpotUsd': str(Decimal(native_total) / Decimal(1_000_000_000) * Decimal(str(sol_price_row['usdPrice']))),
            'solPriceBlockId': sol_price_row['blockId'],
            'fullMultiCloseSequenceSimulated': False,
            'bridgeStateLamportsExcluded': [native['directAccounts'][tokens['authorities'][k]]['lamports'] for k in ('bridgePda', 'secondBridgePda')],
        },
        'market': {
            'priceSource': 'Jupiter Price v3 and Tokens v2; price blocks can be stale; marks are arithmetic, not liquid proceeds',
            'pricedTokenAccounts': len(priced_rows),
            'pricedDistinctMints': len({x['mint'] for x in priced_rows}),
            'unpricedTokenAccounts': len(rows) - len(priced_rows),
            'arithmeticPartialSpotMarkUsd': str(sum(Decimal(x['arithmeticSpotMarkUsd']) for x in priced_rows)),
            'fullVaultUsdcQuoteSource': 'Jupiter Metis exact-in read-only individual quotes at 50 bps setting',
            'fullVaultQuoteSuccessAccounts': len(full_routes),
            'fullVaultQuoteSuccessDistinctMints': len({x['mint'] for x in full_routes}),
            'fullVaultQuoteNaiveSumUsdcNotPortfolioExecutable': str(sum(Decimal(x['fullVaultUsdcQuote']) for x in full_routes)),
            'failedOrUnresolvedQuoteAccounts': len(rows) - len(full_routes),
            'reasonNaiveSumInvalid': 'independent route snapshots share pools and liquidity; no simultaneous portfolio execution was quoted or simulated',
        },
        'completeness': {
            'exactAtObservedSlots': ['ProgramData authority and executable reverse links', 'all three programs current owned state',
                                     'direct SPL Token and Token-2022 account owner sets for three verified PDAs',
                                     'Stake staker/withdrawer fields', 'Vote authorized-withdrawer field',
                                     'loader Buffer authority field'],
            'boundedOrUnknown': ['global SPL/Token-2022 closeAuthority and mint/freeze authority scans: Helius standard GPA rejects large program and V2 cursors remain nonterminal after bounded scan',
                                 'delegate index returned zero but context slot lagged current owner census by thousands of slots',
                                 'System durable nonce authority: standard GPA rejected; V2 pagination nonterminal after sampled pages',
                                 'new signer seeds in arbitrary post-upgrade code and third-party protocols using the PDA are not an enumerable current-state denominator',
                                 'route quotes cover Jupiter Metis USDC snapshots, not every venue or sequential execution'],
            'globalAuthorityScansComplete': tokens['summary']['allGlobalAuthorityScansComplete'],
            'directOwnerScansComplete': tokens['summary']['directOwnerScansComplete'],
        },
        'sourceFiles': ['5uums-surface-programdata.json', '5uums-surface-programdata-close.json',
                        '5uums-surface-programdata-third-mint.json', '5uums-surface-program-owned-state.json',
                        '5uums-surface-token-census.json', '5uums-surface-native.json',
                        '5uums-surface-native-buffer-close.json', '5uums-surface-prices.json',
                        '5uums-surface-quotes.json', '5uums-surface-sol-price.json'],
    }
    target = DIR / '5uums-surface-count.json'
    target.write_text(json.dumps(out, indent=2) + '\n')
    print(json.dumps({'counts': out['counts'], 'nativeSol': out['nativeSol'],
                      'market': out['market']}, indent=2))


if __name__ == '__main__':
    main()
