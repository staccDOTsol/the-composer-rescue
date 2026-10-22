#!/usr/bin/env python3
"""Summarize read-only Locp custody, vesting, mint supply, and independent market quotes."""
import collections
import json
from decimal import Decimal
from pathlib import Path

DIR = Path(__file__).resolve().parent
def read(name):
    return json.loads((DIR / name).read_text())

snapshot = read('locp-economics-snapshot.json')
census = read('mainnet-token-authority-census.raw.json')
supply = read('locp-economics-supply.json')
quotes = read('locp-economics-quote-depth.json')
yzy_quotes = read('locp-economics-quote-depth-YZY.json')
arena_quotes = read('locp-economics-quote-depth-ARENA.json')
prior_by_vault = {x['address']: x for x in census['tokenAccounts']}
supply_by_mint = {x['mint']: x for x in supply['rows']}
quotes_by_mint = {x['mint']: x for x in quotes['observations']}
quotes_by_mint.update({x['mint']: x for x in yzy_quotes['observations']})
quotes_by_mint.update({x['mint']: x for x in arena_quotes['observations']})
by_mint = {}

for entry in snapshot['entries']:
    prev = prior_by_vault[entry['vaultAddress']]
    mint = entry['mint']
    row = by_mint.setdefault(mint, dict(mint=mint, symbol=entry['symbol'],
        decimals=prev['decimals'], vaults=0, rawBalance=0, rawClaimable=0,
        censusPriceUsd=str(entry['censusPriceUsd']), censusMarkUsd=Decimal(0),
        claimableMarkUsd=Decimal(0)))
    row['vaults'] += 1
    balance = int(entry['vault']['rawAmount'])
    claimable = int(entry['claimableRaw'])
    price = Decimal(str(entry['censusPriceUsd']))
    units = Decimal(10) ** prev['decimals']
    row['rawBalance'] += balance
    row['rawClaimable'] += claimable
    row['censusMarkUsd'] += Decimal(balance) / units * price
    row['claimableMarkUsd'] += Decimal(claimable) / units * price

for mint, row in by_mint.items():
    mint_supply = supply_by_mint[mint]
    row['rawMintSupply'] = mint_supply['mintRawSupply']
    row['vaultShareOfMintSupply'] = mint_supply['vaultShareOfMintSupply']
    row['balanceTokens'] = str(Decimal(row['rawBalance']) / Decimal(10) ** row['decimals'])
    row['claimableTokens'] = str(Decimal(row['rawClaimable']) / Decimal(10) ** row['decimals'])
    row['rawBalance'] = str(row['rawBalance'])
    row['rawClaimable'] = str(row['rawClaimable'])
    row['censusMarkUsd'] = str(row['censusMarkUsd'])
    row['claimableMarkUsd'] = str(row['claimableMarkUsd'])
    row['quotes'] = quotes_by_mint.get(mint, {}).get('quotes', [])

rows = sorted(by_mint.values(), key=lambda x: Decimal(x['censusMarkUsd']), reverse=True)
mark = sum(Decimal(x['censusMarkUsd']) for x in rows)
claim = sum(Decimal(x['claimableMarkUsd']) for x in rows)
cancel_modes = collections.Counter(e['state']['cancelMode'] for e in snapshot['entries'])
self_cancel = [e for e in snapshot['entries'] if e['state']['recipient'] == e['state']['creator']
    and e['state']['cancelMode'] in (1, 2, 3)]
def current_mark_for_entry(entry):
    prior = prior_by_vault[entry['vaultAddress']]
    return Decimal(entry['vault']['rawAmount']) / Decimal(10) ** prior['decimals'] * Decimal(str(entry['censusPriceUsd']))

report = {
    'sourceSnapshotSlot': snapshot['snapshotSlot'],
    'sourceSnapshotBlockTime': snapshot['blockTime'],
    'supplyObservationSlot': supply['mintObservationSlot'],
    'count': {'escrows': len(snapshot['entries']), 'vaults': len({x['vaultAddress'] for x in snapshot['entries']}),
        'mints': len(rows), 'statesValidated': sum(x['stateValid'] for x in snapshot['entries']),
        'vaultsValidated': sum(x['vaultValid'] for x in snapshot['entries']),
        'claimableEscrows': sum(int(x['claimableRaw']) > 0 for x in snapshot['entries']),
        'cancelModes': dict(cancel_modes), 'selfCancellableEscrows': len(self_cancel)},
    'value': {'censusPriceMarkUsdOnLiveBalances': str(mark),
        'scheduledClaimableCensusPriceMarkUsd': str(claim),
        'currentlyNotScheduledClaimableCensusPriceMarkUsd': str(mark - claim),
        'selfCancellableCensusPriceMarkUsd': str(sum(current_mark_for_entry(x) for x in self_cancel))},
    'concentration': {
        'top4MarkUsd': str(sum(Decimal(x['censusMarkUsd']) for x in rows[:4])),
        'top14MarkUsd': str(sum(Decimal(x['censusMarkUsd']) for x in rows[:14])),
        'markInMintsWithVaultShareAtLeast50PctUsd': str(sum(Decimal(x['censusMarkUsd']) for x in rows
            if x['vaultShareOfMintSupply'] is not None and x['vaultShareOfMintSupply'] >= 0.5)),
    },
    'methodLimits': [
        'The census is bounded to top 20 token holders per mint in the Jupiter verified registry.',
        'USD marks use the census registry prices, not realizable liquidation prices.',
        'Scheduled claimable amounts use public reference/IDL vesting arithmetic and do not imply possession of the required recipient signatures.',
        'Cancellation is separately authorized and splits vested amount to recipient and remaining vault balance to creator.',
        'Read-only Jupiter quotes are independent single-trade estimates that may fail or go stale; they are not transactions or an aggregate liquidation plan.',
        'Token-2022 transfer fees/hooks, market responses to sales, and cross-asset/shared-pool liquidity are not fully modeled.'
    ],
    'mints': rows,
}
(DIR / 'locp-economics-summary.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: report[k] for k in ('count', 'value', 'concentration')}, indent=2))
