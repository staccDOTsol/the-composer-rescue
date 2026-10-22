/* Read-only current-binary liquidation constraint and alias tests. */
const fs = require('fs');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram} = require(modules + '/@solana/web3.js');
const {BorshInstructionCoder} = require(modules + '/@project-serum/anchor');
const idl = require('/Users/stacc/Documents/Codex/2026-10-15/jupiter-perps-current-audit/community-idl-2026-03.json');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split('\n').filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const connection = new Connection(env.RPC_URL, 'confirmed');
const pk = value => new PublicKey(value);
const a = {
  program: pk('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu'),
  signer: pk('LUREhy7Qt73jrTHyNEGWdjTbthYerGqHfv4bnyHq2DD'),
  knownKeeper: pk('DKu1jCcDj6cBJ7eVFgXg9LodP4MhGzHAeCVu25j5Bibp'),
  operator: pk('HVSZJ2juJnMxd6yCNarTL56YmgUqzfUiwM7y7LtTXKHR'),
  admin: pk('CvQZZ23qYDWF2RUpxYJ8y9K4skmuvYEEjH7fK58jtipQ'),
  receiverOwner: pk('7JQeyNK55fkUPUmEotupBFpiBGpgEQYLe8Ht1VdSfxcP'),
  perpsKeeperCandidate: pk('perpSnt3NivMdD5DRFc7VmW6x7PuvQJGNyDTL74mEYx'),
  liveKeeper: pk('DFZcDnmEYNUK1khquZzx5dQYiEyjJ3N5STqaDVLZ88ZU'),
  perpetuals: pk('H4ND9aYttUVLFmNypZqLjZ52FYiGvdEB45GmwNoKEjTj'),
  pool: pk('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq'),
  custody: pk('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
  wrongCustody: pk('AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn'),
  transferAuthority: pk('AVzP2GeRmqGphJsMxWoqjpUifPpCret7LqWhD8NWQK49'),
  borrowPosition: pk('B2sxySx3hJbCU1MZQzEfUv3TjSuXFSXhhwYAjnbGeMQY'),
  collateralVault: pk('2XYPHGFrEZxwhZQxtUETT6zEcWwBWv5yPBoAuDJf4i7w'),
  attackerJlp: pk('EJ6CLvJPJErjkUnPQicVahzw4Q4NHLfpDV9knoP7iqfK'),
  lpMint: pk('27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4'),
  tokenProgram: pk('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
};
a.eventAuthority = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], a.program)[0];
const coder = new BorshInstructionCoder(idl);
const aumTail = [
  '7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz','AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn','5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm','G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa','4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk','DdwY1ELc9rRK7xNL3hTXabSFBmVrTPpfsUZSv2Y3LL1U','FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh','AFZnHPzy4mvVCffrVwhewHbFc93uTHvDSFrVH7GtfXF1','hUqAT1KQ7eW1i6Csp9CXYtpPfSAvi835V7wKi5fRfmC','6Jp2xZUTWdDD2ZyUPRzeMdc6AFQ5K3pFgZxk2EijfjnM','Fgc93D641F8N2d1xLjQ4jmShuD3GE3BsCXA56KBQbF5u','9DRrwc4hSMQouw3ptpHXtQXVNHoqwyqLaK6NWztWTDin',
].map(pk);

function instruction(name, changes = {}) {
  const definition = idl.instructions.find(ix => ix.name === name);
  const accounts = {
    signer: a.signer,
    perpetuals: a.perpetuals,
    pool: a.pool,
    custody: a.custody,
    transferAuthority: a.transferAuthority,
    borrowPosition: a.borrowPosition,
    collateralTokenAccount: a.collateralVault,
    lpTokenMint: a.lpMint,
    tokenProgram: a.tokenProgram,
    eventAuthority: a.eventAuthority,
    program: a.program,
    ...changes,
  };
  const keys = definition.accounts.map(meta => ({pubkey:accounts[meta.name], isSigner:meta.isSigner, isWritable:meta.isMut}));
  keys.push(...aumTail.map(pubkey => ({pubkey,isSigner:false,isWritable:false})));
  return new TransactionInstruction({programId:a.program, keys, data:coder.encode(name, {params:{}})});
}

async function run(name, ix) {
  const {blockhash} = await connection.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({payerKey:a.signer, recentBlockhash:blockhash, instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:400_000}), ix]}).compileToV0Message());
  const sim = await connection.simulateTransaction(tx, {sigVerify:false, replaceRecentBlockhash:true, commitment:'confirmed'});
  return {name, error:sim.value.err, unitsConsumed:sim.value.unitsConsumed, logs:sim.value.logs};
}

(async()=>{
  const variants = [];
  for (const [label, ix] of [
    ['full_current_position', instruction('liquidateBorrowPosition')],
    ['partial_current_position', instruction('partialLiquidateBorrowPosition')],
    ['known_keeper_full_current_position', instruction('liquidateBorrowPosition', {signer:a.knownKeeper})],
    ['known_keeper_partial_current_position', instruction('partialLiquidateBorrowPosition', {signer:a.knownKeeper})],
    ['operator_full_current_position', instruction('liquidateBorrowPosition', {signer:a.operator})],
    ['admin_full_current_position', instruction('liquidateBorrowPosition', {signer:a.admin})],
    ['receiver_owner_full_current_position', instruction('liquidateBorrowPosition', {signer:a.receiverOwner})],
    ['perps_keeper_candidate_full_current_position', instruction('liquidateBorrowPosition', {signer:a.perpsKeeperCandidate})],
    ['live_keeper_full_current_position', instruction('liquidateBorrowPosition', {signer:a.liveKeeper})],
    ['live_keeper_partial_current_position', instruction('partialLiquidateBorrowPosition', {signer:a.liveKeeper})],
    ['full_attacker_collateral_alias', instruction('liquidateBorrowPosition', {collateralTokenAccount:a.attackerJlp})],
    ['partial_attacker_collateral_alias', instruction('partialLiquidateBorrowPosition', {collateralTokenAccount:a.attackerJlp})],
    ['full_wrong_custody', instruction('liquidateBorrowPosition', {custody:a.wrongCustody})],
    ['full_position_account_aliased_to_custody', instruction('liquidateBorrowPosition', {borrowPosition:a.custody})],
  ]) {
    const result = await run(label, ix); variants.push(result);
    console.log(JSON.stringify({name:label,error:result.error,units:result.unitsConsumed,tail:result.logs?.slice(-8)}));
  }
  fs.writeFileSync(__dirname + '/perps-borrow-liquidation-deep-simulation.json', JSON.stringify({observedAt:new Date().toISOString(), simulationOnly:true, transactionNeverSubmitted:true, sigVerifyFalseCaveat:'Signer substitution does not establish external signability.', variants}, null, 2));
})().catch(error=>{console.error(error.stack||error.message);process.exitCode=1});
