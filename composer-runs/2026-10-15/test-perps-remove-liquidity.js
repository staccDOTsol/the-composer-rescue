/* Read-only current-binary Jupiter Perps removeLiquidity2 controls and mutations. */
const fs = require('fs');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram} = require(modules + '/@solana/web3.js');
const {BorshInstructionCoder} = require(modules + '/@project-serum/anchor');
const BN = require(modules + '/bn.js');
const idl = require('/Users/stacc/Documents/Codex/2026-10-15/jupiter-perps-current-audit/community-idl-2026-03.json');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split('\n').filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const connection = new Connection(env.RPC_URL, 'confirmed');
const pk = value => new PublicKey(value);

const addresses = {
  program: pk('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu'),
  payer: pk('LUREhy7Qt73jrTHyNEGWdjTbthYerGqHfv4bnyHq2DD'),
  owner: pk('7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z'),
  ownerUsdc: pk('BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB'),
  ownerJlp: pk('EJ6CLvJPJErjkUnPQicVahzw4Q4NHLfpDV9knoP7iqfK'),
  victimJlp: pk('CHcHknV6KujiUVqVsQfJrqUcsifgJmWBzhUWyYibt1ss'),
  victimOwner: pk('B9spsrMK6pJicYtukaZzDyzsUQLgc3jbx5gHVwdDxb6y'),
  otherUsdc: pk('D12ipGhZgkpWqRH8m8UJoqADi4V1SgZ4egKrtYhw5s2j'),
  transferAuthority: pk('AVzP2GeRmqGphJsMxWoqjpUifPpCret7LqWhD8NWQK49'),
  perpetuals: pk('H4ND9aYttUVLFmNypZqLjZ52FYiGvdEB45GmwNoKEjTj'),
  pool: pk('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq'),
  usdcCustody: pk('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
  usdcVault: pk('WzWUoCmtVv7eqAbU3BfKPU3fhLP6CXR8NCJH78UK9VS'),
  lpMint: pk('27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4'),
  tokenProgram: pk('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  usdcOracle: pk('6Jp2xZUTWdDD2ZyUPRzeMdc6AFQ5K3pFgZxk2EijfjnM'),
  wrongOracle: pk('hUqAT1KQ7eW1i6Csp9CXYtpPfSAvi835V7wKi5fRfmC'),
};
addresses.eventAuthority = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], addresses.program)[0];

// Exact current AUM tail recovered from successful AddLiquidity2 and RemoveLiquidity2 transactions.
const aumTail = [
  '7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz',
  'AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn',
  '5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm',
  'G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa',
  '4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk',
  'DdwY1ELc9rRK7xNL3hTXabSFBmVrTPpfsUZSv2Y3LL1U',
  'FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh',
  'AFZnHPzy4mvVCffrVwhewHbFc93uTHvDSFrVH7GtfXF1',
  'hUqAT1KQ7eW1i6Csp9CXYtpPfSAvi835V7wKi5fRfmC',
  '6Jp2xZUTWdDD2ZyUPRzeMdc6AFQ5K3pFgZxk2EijfjnM',
  'Fgc93D641F8N2d1xLjQ4jmShuD3GE3BsCXA56KBQbF5u',
  '9DRrwc4hSMQouw3ptpHXtQXVNHoqwyqLaK6NWztWTDin',
].map(pk);

const coder = new BorshInstructionCoder(idl);
const definition = idl.instructions.find(ix => ix.name === 'removeLiquidity2');
function instruction({owner = addresses.owner, receiving = addresses.ownerUsdc, lp = addresses.ownerJlp, amount = 1_000_000n, selectedOracle = addresses.usdcOracle, tail = aumTail} = {}) {
  const accounts = {
    owner,
    receivingAccount: receiving,
    lpTokenAccount: lp,
    transferAuthority: addresses.transferAuthority,
    perpetuals: addresses.perpetuals,
    pool: addresses.pool,
    custody: addresses.usdcCustody,
    custodyDovesPriceAccount: selectedOracle,
    custodyPythnetPriceAccount: selectedOracle,
    custodyTokenAccount: addresses.usdcVault,
    lpTokenMint: addresses.lpMint,
    tokenProgram: addresses.tokenProgram,
    eventAuthority: addresses.eventAuthority,
    program: addresses.program,
  };
  const keys = definition.accounts.map(meta => ({pubkey: accounts[meta.name], isSigner: meta.isSigner, isWritable: meta.isMut}));
  keys.push(...tail.map(pubkey => ({pubkey, isSigner: false, isWritable: false})));
  return new TransactionInstruction({
    programId: addresses.program,
    keys,
    data: coder.encode('removeLiquidity2', {params: {lpAmountIn: new BN(amount.toString()), minAmountOut: new BN(0)}}),
  });
}

function tokenAmount(account) {
  if (!account?.data) return null;
  const raw = Buffer.from(Array.isArray(account.data) ? account.data[0] : account.data, 'base64');
  return raw.length >= 72 ? raw.readBigUInt64LE(64).toString() : null;
}

async function simulate(name, instructions) {
  const {blockhash} = await connection.getLatestBlockhash('confirmed');
  const allInstructions = [ComputeBudgetProgram.setComputeUnitLimit({units: 800_000}), ...instructions];
  const transaction = new VersionedTransaction(new TransactionMessage({payerKey: addresses.payer, recentBlockhash: blockhash, instructions: allInstructions}).compileToV0Message());
  const tracked = [addresses.ownerJlp, addresses.victimJlp, addresses.ownerUsdc, addresses.usdcVault, addresses.lpMint];
  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
    accounts: {encoding: 'base64', addresses: tracked.map(x => x.toBase58())},
  });
  return {
    name,
    error: simulation.value.err,
    unitsConsumed: simulation.value.unitsConsumed,
    postTokenAmounts: simulation.value.accounts?.slice(0, 4).map(tokenAmount) || null,
    postMintSupply: simulation.value.accounts?.[4]?.data ? Buffer.from(simulation.value.accounts[4].data[0], 'base64').readBigUInt64LE(36).toString() : null,
    logs: simulation.value.logs,
  };
}

(async () => {
  const pre = await connection.getMultipleAccountsInfo([addresses.ownerJlp, addresses.victimJlp, addresses.ownerUsdc, addresses.usdcVault, addresses.lpMint], 'confirmed');
  const badTail = [...aumTail];
  badTail[9] = addresses.wrongOracle;
  const cases = [
    ['holder_positive_control', [instruction()]],
    ['victim_source_attacker_signer_and_destination', [instruction({lp: addresses.victimJlp})]],
    ['holder_redirect_to_other_owner', [instruction({receiving: addresses.otherUsdc})]],
    ['wrong_selected_oracle', [instruction({selectedOracle: addresses.wrongOracle})]],
    ['aliased_usdc_oracle_in_aum_tail', [instruction({tail: badTail})]],
    ['overburn_max_u64', [instruction({amount: 18_446_744_073_709_551_615n})]],
    ['two_removals_atomic_control', [instruction(), instruction()]],
    ['valid_then_overburn_atomic_revert', [instruction(), instruction({amount: 18_446_744_073_709_551_615n})]],
  ];
  const output = {
    observedAt: new Date().toISOString(),
    simulationOnly: true,
    transactionNeverSubmitted: true,
    sigVerifyFalseCaveat: 'Signer substitution is authorization-path testing only and does not establish external signability.',
    trackedAccounts: [addresses.ownerJlp, addresses.victimJlp, addresses.ownerUsdc, addresses.usdcVault, addresses.lpMint].map(x => x.toBase58()),
    preTokenAmounts: pre.slice(0, 4).map(account => account?.data?.length >= 72 ? account.data.readBigUInt64LE(64).toString() : null),
    preMintSupply: pre[4]?.data?.length >= 44 ? pre[4].data.readBigUInt64LE(36).toString() : null,
    variants: [],
  };
  for (const [name, instructions] of cases) {
    const result = await simulate(name, instructions);
    output.variants.push(result);
    console.log(JSON.stringify({name, error: result.error, units: result.unitsConsumed, postTokenAmounts: result.postTokenAmounts, postMintSupply: result.postMintSupply, tail: result.logs?.slice(-6)}));
  }
  fs.writeFileSync(__dirname + '/perps-remove-liquidity-deep-simulation.json', JSON.stringify(output, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
