const fs = require('fs');
const crypto = require('crypto');
const {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');

const PROGRAM = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const PROTOCOL_FEE_AUTHORITY = new PublicKey('FkU5rQCWQM131skHCpcEbK8P1JrQGsBgqXe55w525SSF');
const PROTOCOL_FEE_POOL = new PublicKey('hcE7QZYBJq63GgM6zXzGwY5S7NPPC8yvbw5k6YKuM34');
const OUT = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/damm-v2-current-simulations.json';
const RPC = process.env.RPC_URL;
if (!RPC) throw new Error('RPC_URL is required');

const SOURCE_SIGNATURES = {
  swap: 'q67fGy9BUc8SDdHzSp9Ff1fmcsjQXfVwu3nu7mveefrRmRmHdW45TgZDUdztrVifpbsHFgfR866jBe3ZCjsVda5',
  remove_liquidity: '5nxKdFq9KgufSfnkwmjuDzPPRSu6d8QxVYvCCwWMAfeJtNgaDgyvzKgpo9HBp1uELDEyiRrzBmHtkFMgZ8n1Nef9',
  claim_position_fee: '3oZMSnBYwgAbMEhY4MyCJc1KsDbNr77N7qveckdynghTXxRx6UxbmPoRSrHexqN6wcDSP4FgYK55pWnTKwvdpRsT',
  add_liquidity: '3Ffif3K277BveQxbUy6GcniP8YiWbS3nKFSG4Ndp9feMReqPdF6atpn5CuQwZmLqtQ3ypau6u3YKmrudxNNXMRft',
};

const SPECS = {
  swap: {
    discriminator: 'f8c69e91e17587c8',
    names: ['pool_authority', 'pool', 'input_token_account', 'output_token_account', 'token_a_vault', 'token_b_vault', 'token_a_mint', 'token_b_mint', 'payer', 'token_a_program', 'token_b_program', 'referral_token_account', 'event_authority', 'program'],
    writable: new Set(['pool', 'input_token_account', 'output_token_account', 'token_a_vault', 'token_b_vault', 'referral_token_account']),
    signers: new Set(['payer']),
  },
  remove_liquidity: {
    discriminator: '5055d14818ceb16c',
    names: ['pool_authority', 'pool', 'position', 'token_a_account', 'token_b_account', 'token_a_vault', 'token_b_vault', 'token_a_mint', 'token_b_mint', 'position_nft_account', 'signer', 'token_a_program', 'token_b_program', 'event_authority', 'program'],
    writable: new Set(['pool', 'position', 'token_a_account', 'token_b_account', 'token_a_vault', 'token_b_vault']),
    signers: new Set(['signer']),
  },
  claim_position_fee: {
    discriminator: 'b4269a118521a2d3',
    names: ['pool_authority', 'pool', 'position', 'token_a_account', 'token_b_account', 'token_a_vault', 'token_b_vault', 'token_a_mint', 'token_b_mint', 'position_nft_account', 'signer', 'token_a_program', 'token_b_program', 'event_authority', 'program'],
    writable: new Set(['position', 'token_a_account', 'token_b_account', 'token_a_vault', 'token_b_vault']),
    signers: new Set(['signer']),
  },
  add_liquidity: {
    discriminator: 'b59d59438fb63448',
    names: ['pool', 'position', 'token_a_account', 'token_b_account', 'token_a_vault', 'token_b_vault', 'token_a_mint', 'token_b_mint', 'position_nft_account', 'signer', 'token_a_program', 'token_b_program', 'event_authority', 'program'],
    writable: new Set(['pool', 'position', 'token_a_account', 'token_b_account', 'token_a_vault', 'token_b_vault']),
    signers: new Set(['signer']),
  },
};

function accountKeys(tx) {
  const message = tx.transaction.message;
  if (message.accountKeys) return message.accountKeys.map(String);
  return [
    ...message.staticAccountKeys,
    ...(tx.meta?.loadedAddresses?.writable || []),
    ...(tx.meta?.loadedAddresses?.readonly || []),
  ].map(String);
}

function instructions(tx) {
  const top = tx.transaction.message.instructions || tx.transaction.message.compiledInstructions || [];
  const inner = (tx.meta?.innerInstructions || []).flatMap((group) => group.instructions || []);
  return [...top, ...inner];
}

function originalWritable(tx, accountIndex) {
  const message = tx.transaction.message;
  if (typeof message.isAccountWritable === 'function') return message.isAccountWritable(accountIndex);
  const header = message.header;
  const staticLength = message.accountKeys?.length || message.staticAccountKeys.length;
  if (accountIndex < header.numRequiredSignatures) {
    return accountIndex < header.numRequiredSignatures - header.numReadonlySignedAccounts;
  }
  if (accountIndex < staticLength) {
    return accountIndex < staticLength - header.numReadonlyUnsignedAccounts;
  }
  return accountIndex < staticLength + (tx.meta?.loadedAddresses?.writable || []).length;
}

async function extract(connection, name, signature) {
  const spec = SPECS[name];
  const tx = await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 1,
  });
  if (!tx || tx.meta?.err) throw new Error(`${name}: unavailable or failed source transaction`);
  const keys = accountKeys(tx);
  const match = instructions(tx).find((ix) => {
    if (keys[ix.programIdIndex] !== PROGRAM.toBase58() || !ix.data) return false;
    try { return Buffer.from(bs58.decode(ix.data)).subarray(0, 8).toString('hex') === spec.discriminator; }
    catch { return false; }
  });
  if (!match) throw new Error(`${name}: program instruction not found in ${signature}`);
  const data = Buffer.from(bs58.decode(match.data));
  const accounts = match.accounts.map((accountIndex, i) => {
    const accountName = spec.names[i] || `remaining_${i - spec.names.length}`;
    return {
      name: accountName,
      pubkey: new PublicKey(keys[accountIndex]),
      isSigner: spec.signers.has(accountName),
      isWritable: i < spec.names.length ? spec.writable.has(accountName) : originalWritable(tx, accountIndex),
    };
  });
  return {
    name,
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    feePayer: new PublicKey(keys[0]),
    data,
    accounts,
    originalTokenDeltas: tokenDeltasFromTransaction(tx),
  };
}

function tokenDeltasFromTransaction(tx) {
  const keys = accountKeys(tx);
  const pre = new Map((tx.meta?.preTokenBalances || []).map((row) => [row.accountIndex, row]));
  return (tx.meta?.postTokenBalances || []).map((post) => {
    const before = BigInt(pre.get(post.accountIndex)?.uiTokenAmount?.amount || 0);
    const after = BigInt(post.uiTokenAmount.amount);
    return {
      account: keys[post.accountIndex],
      mint: post.mint,
      owner: post.owner || pre.get(post.accountIndex)?.owner || null,
      delta: (after - before).toString(),
    };
  }).filter((row) => row.delta !== '0');
}

function mapAccounts(control) {
  return Object.fromEntries(control.accounts.map((account) => [account.name, account]));
}

function cloneAccounts(accounts) {
  return accounts.map((account) => ({ ...account, pubkey: new PublicKey(account.pubkey) }));
}

function instruction(control, mutate) {
  const accounts = cloneAccounts(control.accounts);
  if (mutate) mutate(Object.fromEntries(accounts.map((account) => [account.name, account])), accounts);
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: accounts.map(({ pubkey, isSigner, isWritable }) => ({ pubkey, isSigner, isWritable })),
    data: Buffer.from(control.data),
  });
}

function protocolFeeInstruction(swap, mutate) {
  const a = mapAccounts(swap);
  const data = Buffer.alloc(16);
  Buffer.from('ebc23645410aec70', 'hex').copy(data);
  data.writeBigUInt64LE(0xffffffffffffffffn, 8);
  const accounts = [
    { name: 'receiver_token_account', pubkey: a.output_token_account.pubkey, isSigner: false, isWritable: true },
    { name: 'token_a_mint', pubkey: a.token_a_mint.pubkey, isSigner: false, isWritable: false },
    { name: 'token_b_mint', pubkey: a.token_b_mint.pubkey, isSigner: false, isWritable: false },
    { name: 'token_a_program', pubkey: a.token_a_program.pubkey, isSigner: false, isWritable: false },
    { name: 'token_b_program', pubkey: a.token_b_program.pubkey, isSigner: false, isWritable: false },
    { name: 'pool', pubkey: a.pool.pubkey, isSigner: false, isWritable: true },
    { name: 'token_a_vault', pubkey: a.token_a_vault.pubkey, isSigner: false, isWritable: true },
    { name: 'token_b_vault', pubkey: a.token_b_vault.pubkey, isSigner: false, isWritable: true },
    { name: 'pool_authority', pubkey: a.pool_authority.pubkey, isSigner: false, isWritable: false },
    { name: 'signer', pubkey: PROTOCOL_FEE_AUTHORITY, isSigner: true, isWritable: false },
  ];
  if (mutate) mutate(Object.fromEntries(accounts.map((account) => [account.name, account])), accounts, a);
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: accounts.map(({ pubkey, isSigner, isWritable }) => ({ pubkey, isSigner, isWritable })),
    data,
  });
}

function compactAccount(info) {
  if (!info) return null;
  const data = Buffer.isBuffer(info.data) ? info.data : Buffer.from(info.data[0], 'base64');
  const owner = info.owner.toString();
  const result = {
    owner,
    lamports: info.lamports,
    dataLength: data.length,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
  if ((owner === TOKEN || owner === TOKEN_2022) && data.length >= 72) {
    result.tokenAmount = data.readBigUInt64LE(64).toString();
    result.tokenMint = new PublicKey(data.subarray(0, 32)).toBase58();
    result.tokenAuthority = new PublicKey(data.subarray(32, 64)).toBase58();
  }
  return result;
}

async function simulate(connection, recentBlockhash, name, ixs, payer) {
  const writable = [];
  for (const ix of ixs) {
    for (const key of ix.keys) {
      if (key.isWritable && !writable.some((value) => value.equals(key.pubkey))) writable.push(key.pubkey);
    }
  }
  const beforeInfos = await connection.getMultipleAccountsInfo(writable, 'confirmed');
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash, instructions: ixs }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  let response;
  try {
    response = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'confirmed',
      accounts: { encoding: 'base64', addresses: writable.map(String) },
    });
  } catch (error) {
    return { name, transportError: String(error?.message || error), writable: writable.map(String) };
  }
  const afterInfos = response.value.accounts || [];
  const changes = writable.map((pubkey, index) => {
    const before = compactAccount(beforeInfos[index]);
    const after = compactAccount(afterInfos[index]);
    const row = { account: pubkey.toBase58(), before, after };
    if (before?.tokenAmount != null && after?.tokenAmount != null) {
      row.tokenDelta = (BigInt(after.tokenAmount) - BigInt(before.tokenAmount)).toString();
    } else if (!before && after?.tokenAmount != null) {
      row.tokenDelta = after.tokenAmount;
    }
    row.created = !before && !!after;
    row.changed = before && after
      ? before.dataSha256 !== after.dataSha256 || before.lamports !== after.lamports
      : null;
    return row;
  }).filter((row) => row.created || row.changed === true || row.tokenDelta !== undefined);
  return {
    name,
    contextSlot: response.context.slot,
    err: response.value.err,
    unitsConsumed: response.value.unitsConsumed,
    changes,
    logTail: (response.value.logs || []).slice(-12),
  };
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const controls = {};
  for (const [name, signature] of Object.entries(SOURCE_SIGNATURES)) {
    controls[name] = await extract(connection, name, signature);
  }
  const recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const swap = controls.swap;
  const remove = controls.remove_liquidity;
  const claim = controls.claim_position_fee;
  const added = controls.add_liquidity;
  const swapAccounts = mapAccounts(swap);
  const removeAccounts = mapAccounts(remove);
  const claimAccounts = mapAccounts(claim);
  const addedAccounts = mapAccounts(added);
  const unrelatedSigner = [swap.feePayer, remove.feePayer, claim.feePayer]
    .find((key) => !key.equals(removeAccounts.signer.pubkey)) || SystemProgram.programId;
  const unrelatedSwapSigner = [remove.feePayer, claim.feePayer, removeAccounts.signer.pubkey]
    .find((key) => !key.equals(swapAccounts.payer.pubkey)) || SystemProgram.programId;
  const unrelatedClaimSigner = [swap.feePayer, remove.feePayer]
    .find((key) => !key.equals(claimAccounts.signer.pubkey)) || SystemProgram.programId;

  const swapBase = instruction(swap);
  const swapBadSigner = instruction(swap, (a) => { a.payer.pubkey = unrelatedSwapSigner; });
  const swapBadDestination = instruction(swap, (a) => { a.output_token_account.pubkey = a.input_token_account.pubkey; });
  const swapBadVault = instruction(swap, (a) => { a.token_a_vault.pubkey = a.token_b_vault.pubkey; });
  const swapBadProgram = instruction(swap, (a) => { a.token_a_program.pubkey = SystemProgram.programId; });

  const removeBase = instruction(remove);
  const removeBadSigner = instruction(remove, (a) => { a.signer.pubkey = unrelatedSigner; });
  const removeBadDestination = instruction(remove, (a) => { a.token_a_account.pubkey = a.token_a_vault.pubkey; });
  const removeBadVault = instruction(remove, (a) => { a.token_a_vault.pubkey = a.token_b_vault.pubkey; });
  const removeBadPosition = instruction(remove, (a) => { a.position.pubkey = a.pool.pubkey; });
  const removeBadProgram = instruction(remove, (a) => { a.token_a_program.pubkey = SystemProgram.programId; });

  const claimBase = instruction(claim);
  const claimBadSigner = instruction(claim, (a) => { a.signer.pubkey = unrelatedClaimSigner; });
  const claimBadDestination = instruction(claim, (a) => { a.token_a_account.pubkey = a.token_a_vault.pubkey; });
  const claimBadVault = instruction(claim, (a) => { a.token_a_vault.pubkey = a.token_b_vault.pubkey; });
  const claimBadPosition = instruction(claim, (a) => { a.position.pubkey = a.pool.pubkey; });
  const claimBadProgram = instruction(claim, (a) => { a.token_a_program.pubkey = SystemProgram.programId; });

  const feePoolInfo = await connection.getAccountInfo(PROTOCOL_FEE_POOL, 'confirmed');
  if (!feePoolInfo || feePoolInfo.data.length !== 1112) throw new Error('protocol-fee pool unavailable');
  const poolData = feePoolInfo.data;
  const readPubkey = (offset) => new PublicKey(poolData.subarray(offset, offset + 32));
  const feeTokenAMint = readPubkey(168);
  const feeTokenBMint = readPubkey(200);
  const feeTokenAVault = readPubkey(232);
  const feeTokenBVault = readPubkey(264);
  const feeMintAInfo = await connection.getAccountInfo(feeTokenAMint, 'confirmed');
  const feeMintBInfo = await connection.getAccountInfo(feeTokenBMint, 'confirmed');
  if (!feeMintAInfo || !feeMintBInfo) throw new Error('protocol-fee mint discovery failed');
  const receiverOwner = swap.feePayer;
  const receiverA = getAssociatedTokenAddressSync(feeTokenAMint, receiverOwner, false, feeMintAInfo.owner);
  const receiverB = getAssociatedTokenAddressSync(feeTokenBMint, receiverOwner, false, feeMintBInfo.owner);
  const createReceiverA = createAssociatedTokenAccountIdempotentInstruction(
    swap.feePayer, receiverA, receiverOwner, feeTokenAMint, feeMintAInfo.owner,
  );
  const createReceiverB = createAssociatedTokenAccountIdempotentInstruction(
    swap.feePayer, receiverB, receiverOwner, feeTokenBMint, feeMintBInfo.owner,
  );
  const unrelatedMint = swapAccounts.token_a_mint.pubkey;
  const unrelatedMintInfo = await connection.getAccountInfo(unrelatedMint, 'confirmed');
  if (!unrelatedMintInfo) throw new Error('unrelated mint unavailable');
  const receiverUnrelated = getAssociatedTokenAddressSync(unrelatedMint, receiverOwner, false, unrelatedMintInfo.owner);
  const createReceiverUnrelated = createAssociatedTokenAccountIdempotentInstruction(
    swap.feePayer, receiverUnrelated, receiverOwner, unrelatedMint, unrelatedMintInfo.owner,
  );
  const protocolSource = {
    signature: 'constructed-current-state-control',
    accounts: [
      { name: 'output_token_account', pubkey: receiverA },
      { name: 'input_token_account', pubkey: receiverUnrelated },
      { name: 'token_a_mint', pubkey: feeTokenAMint },
      { name: 'token_b_mint', pubkey: feeTokenBMint },
      { name: 'token_a_program', pubkey: feeMintAInfo.owner },
      { name: 'token_b_program', pubkey: feeMintBInfo.owner },
      { name: 'pool', pubkey: PROTOCOL_FEE_POOL },
      { name: 'token_a_vault', pubkey: feeTokenAVault },
      { name: 'token_b_vault', pubkey: feeTokenBVault },
      { name: 'pool_authority', pubkey: new PublicKey('HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC') },
    ].map((account) => ({ ...account, isSigner: false, isWritable: false })),
  };
  const outputMint = feeTokenAMint.toBase58();
  const protocolVaultName = 'token_a_vault';
  const protocolBase = protocolFeeInstruction(protocolSource);
  const protocolBadSigner = protocolFeeInstruction(protocolSource, (a) => { a.signer.pubkey = unrelatedSigner; });
  const protocolBadDestination = protocolFeeInstruction(protocolSource, (a, _all, source) => { a.receiver_token_account.pubkey = source[protocolVaultName].pubkey; });
  const protocolWrongMintDestination = protocolFeeInstruction(protocolSource, (a, _all, source) => { a.receiver_token_account.pubkey = source.input_token_account.pubkey; });
  const protocolBadVault = protocolFeeInstruction(protocolSource, (a) => { a.token_a_vault.pubkey = a.token_b_vault.pubkey; });
  const protocolBadProgram = protocolFeeInstruction(protocolSource, (a) => { a.token_a_program.pubkey = SystemProgram.programId; });

  const currentSwapData = Buffer.alloc(24);
  Buffer.from(SPECS.swap.discriminator, 'hex').copy(currentSwapData);
  currentSwapData.writeBigUInt64LE(1_000_000n, 8);
  currentSwapData.writeBigUInt64LE(0n, 16);
  const currentSwapMintA = swapAccounts.token_a_mint.pubkey;
  const currentSwapMintB = swapAccounts.token_b_mint.pubkey;
  const currentSwapMintAInfo = unrelatedMintInfo;
  const currentSwapMintBInfo = await connection.getAccountInfo(currentSwapMintB, 'confirmed');
  if (!currentSwapMintBInfo) throw new Error('current swap token B mint unavailable');
  const currentSwapReceiverA = receiverUnrelated;
  const currentSwapReceiverB = getAssociatedTokenAddressSync(
    currentSwapMintB, receiverOwner, false, currentSwapMintBInfo.owner,
  );
  const createCurrentSwapReceiverB = createAssociatedTokenAccountIdempotentInstruction(
    swap.feePayer, currentSwapReceiverB, receiverOwner, currentSwapMintB, currentSwapMintBInfo.owner,
  );
  const currentSwap = {
    data: currentSwapData,
    accounts: [
      { name: 'pool_authority', pubkey: swapAccounts.pool_authority.pubkey, isSigner: false, isWritable: false },
      { name: 'pool', pubkey: swapAccounts.pool.pubkey, isSigner: false, isWritable: true },
      { name: 'input_token_account', pubkey: currentSwapReceiverB, isSigner: false, isWritable: true },
      { name: 'output_token_account', pubkey: currentSwapReceiverA, isSigner: false, isWritable: true },
      { name: 'token_a_vault', pubkey: swapAccounts.token_a_vault.pubkey, isSigner: false, isWritable: true },
      { name: 'token_b_vault', pubkey: swapAccounts.token_b_vault.pubkey, isSigner: false, isWritable: true },
      { name: 'token_a_mint', pubkey: currentSwapMintA, isSigner: false, isWritable: false },
      { name: 'token_b_mint', pubkey: currentSwapMintB, isSigner: false, isWritable: false },
      { name: 'payer', pubkey: swap.feePayer, isSigner: true, isWritable: false },
      { name: 'token_a_program', pubkey: currentSwapMintAInfo.owner, isSigner: false, isWritable: false },
      { name: 'token_b_program', pubkey: currentSwapMintBInfo.owner, isSigner: false, isWritable: false },
      { name: 'referral_token_account', pubkey: PROGRAM, isSigner: false, isWritable: false },
      { name: 'event_authority', pubkey: new PublicKey('3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet'), isSigner: false, isWritable: false },
      { name: 'program', pubkey: PROGRAM, isSigner: false, isWritable: false },
    ],
  };
  const currentSwapBase = instruction(currentSwap);
  const currentSwapBadSigner = instruction(currentSwap, (a) => { a.payer.pubkey = unrelatedSwapSigner; });
  const currentSwapBadDestination = instruction(currentSwap, (a) => { a.output_token_account.pubkey = a.token_a_vault.pubkey; });
  const currentSwapBadVault = instruction(currentSwap, (a) => { a.token_a_vault.pubkey = a.token_b_vault.pubkey; });
  const currentSwapBadProgram = instruction(currentSwap, (a) => { a.token_a_program.pubkey = SystemProgram.programId; });
  const fundWrappedSol = SystemProgram.transfer({ fromPubkey: swap.feePayer, toPubkey: currentSwapReceiverB, lamports: 2_000_000 });
  const syncWrappedSol = createSyncNativeInstruction(currentSwapReceiverB, currentSwapMintBInfo.owner);
  const currentSwapSetup = [createReceiverUnrelated, createCurrentSwapReceiverB, fundWrappedSol, syncWrappedSol];

  const addedPositionInfo = await connection.getAccountInfo(addedAccounts.position.pubkey, 'confirmed');
  if (!addedPositionInfo || addedPositionInfo.data.length !== 408) throw new Error('added position unavailable');
  const unlockedLiquidity = addedPositionInfo.data.readBigUInt64LE(152)
    + (addedPositionInfo.data.readBigUInt64LE(160) << 64n);
  if (unlockedLiquidity === 0n) throw new Error('added position has no unlocked liquidity');
  const removalDelta = unlockedLiquidity / 100n || 1n;
  const addedMintAInfo = await connection.getAccountInfo(addedAccounts.token_a_mint.pubkey, 'confirmed');
  const addedMintBInfo = await connection.getAccountInfo(addedAccounts.token_b_mint.pubkey, 'confirmed');
  if (!addedMintAInfo || !addedMintBInfo) throw new Error('added position mints unavailable');
  const positionDestinationA = getAssociatedTokenAddressSync(
    addedAccounts.token_a_mint.pubkey, addedAccounts.signer.pubkey, false, addedMintAInfo.owner,
  );
  const positionDestinationB = getAssociatedTokenAddressSync(
    addedAccounts.token_b_mint.pubkey, addedAccounts.signer.pubkey, false, addedMintBInfo.owner,
  );
  const createPositionDestinationA = createAssociatedTokenAccountIdempotentInstruction(
    swap.feePayer, positionDestinationA, addedAccounts.signer.pubkey, addedAccounts.token_a_mint.pubkey, addedMintAInfo.owner,
  );
  const createPositionDestinationB = createAssociatedTokenAccountIdempotentInstruction(
    swap.feePayer, positionDestinationB, addedAccounts.signer.pubkey, addedAccounts.token_b_mint.pubkey, addedMintBInfo.owner,
  );
  const currentPositionSetup = [createPositionDestinationA, createPositionDestinationB];
  const currentPositionAccounts = [
    { name: 'pool_authority', pubkey: swapAccounts.pool_authority.pubkey, isSigner: false, isWritable: false },
    ...added.accounts.map((account) => account.name === 'token_a_account'
      ? { ...account, pubkey: positionDestinationA }
      : account.name === 'token_b_account'
        ? { ...account, pubkey: positionDestinationB }
        : account),
  ];
  const currentRemoveData = Buffer.alloc(40);
  Buffer.from(SPECS.remove_liquidity.discriminator, 'hex').copy(currentRemoveData);
  currentRemoveData.writeBigUInt64LE(removalDelta & 0xffffffffffffffffn, 8);
  currentRemoveData.writeBigUInt64LE(removalDelta >> 64n, 16);
  currentRemoveData.writeBigUInt64LE(0n, 24);
  currentRemoveData.writeBigUInt64LE(0n, 32);
  const currentRemove = { data: currentRemoveData, accounts: currentPositionAccounts };
  const activeUnrelatedSigner = [swap.feePayer, remove.feePayer, claim.feePayer]
    .find((key) => !key.equals(addedAccounts.signer.pubkey)) || SystemProgram.programId;
  const currentRemoveBase = instruction(currentRemove);
  const currentRemoveBadSigner = instruction(currentRemove, (a) => { a.signer.pubkey = activeUnrelatedSigner; });
  const currentRemoveBadDestination = instruction(currentRemove, (a) => { a.token_a_account.pubkey = a.token_a_vault.pubkey; });
  const currentRemoveBadVault = instruction(currentRemove, (a) => { a.token_a_vault.pubkey = a.token_b_vault.pubkey; });
  const currentRemoveBadPosition = instruction(currentRemove, (a) => { a.position.pubkey = a.pool.pubkey; });
  const currentRemoveBadProgram = instruction(currentRemove, (a) => { a.token_a_program.pubkey = SystemProgram.programId; });
  const currentClaim = { data: Buffer.from(SPECS.claim_position_fee.discriminator, 'hex'), accounts: currentPositionAccounts };
  const currentClaimBase = instruction(currentClaim);
  const currentClaimBadSigner = instruction(currentClaim, (a) => { a.signer.pubkey = activeUnrelatedSigner; });
  const currentClaimBadDestination = instruction(currentClaim, (a) => { a.token_a_account.pubkey = a.token_a_vault.pubkey; });
  const currentClaimBadVault = instruction(currentClaim, (a) => { a.token_a_vault.pubkey = a.token_b_vault.pubkey; });
  const currentClaimBadPosition = instruction(currentClaim, (a) => { a.position.pubkey = a.pool.pubkey; });
  const currentClaimBadProgram = instruction(currentClaim, (a) => { a.token_a_program.pubkey = SystemProgram.programId; });

  const cases = [
    ['swap_baseline', [swapBase], swap.feePayer],
    ['swap_authority_mutated', [swapBadSigner], swap.feePayer],
    ['swap_destination_aliased_to_input', [swapBadDestination], swap.feePayer],
    ['swap_vault_binding_mutated', [swapBadVault], swap.feePayer],
    ['swap_cpi_program_mutated', [swapBadProgram], swap.feePayer],
    ['swap_duplicated_same_transaction', [swapBase, swapBase], swap.feePayer],
    ['swap_current_baseline', [...currentSwapSetup, currentSwapBase], swap.feePayer],
    ['swap_current_authority_mutated', [...currentSwapSetup, currentSwapBadSigner], swap.feePayer],
    ['swap_current_destination_aliased_to_vault', [...currentSwapSetup, currentSwapBadDestination], swap.feePayer],
    ['swap_current_vault_binding_mutated', [...currentSwapSetup, currentSwapBadVault], swap.feePayer],
    ['swap_current_cpi_program_mutated', [...currentSwapSetup, currentSwapBadProgram], swap.feePayer],
    ['swap_current_duplicated_same_transaction', [...currentSwapSetup, currentSwapBase, currentSwapBase], swap.feePayer],
    ['swap_current_valid_then_invalid_authority_atomicity', [...currentSwapSetup, currentSwapBase, currentSwapBadSigner], swap.feePayer],
    ['remove_baseline', [removeBase], remove.feePayer],
    ['remove_authority_mutated', [removeBadSigner], remove.feePayer],
    ['remove_destination_aliased_to_vault', [removeBadDestination], remove.feePayer],
    ['remove_vault_binding_mutated', [removeBadVault], remove.feePayer],
    ['remove_position_binding_mutated', [removeBadPosition], remove.feePayer],
    ['remove_cpi_program_mutated', [removeBadProgram], remove.feePayer],
    ['remove_duplicated_same_transaction', [removeBase, removeBase], remove.feePayer],
    ['remove_valid_then_invalid_authority_atomicity', [removeBase, removeBadSigner], remove.feePayer],
    ['remove_current_baseline', [...currentPositionSetup, currentRemoveBase], swap.feePayer],
    ['remove_current_authority_mutated', [...currentPositionSetup, currentRemoveBadSigner], swap.feePayer],
    ['remove_current_destination_aliased_to_vault', [...currentPositionSetup, currentRemoveBadDestination], swap.feePayer],
    ['remove_current_vault_binding_mutated', [...currentPositionSetup, currentRemoveBadVault], swap.feePayer],
    ['remove_current_position_binding_mutated', [...currentPositionSetup, currentRemoveBadPosition], swap.feePayer],
    ['remove_current_cpi_program_mutated', [...currentPositionSetup, currentRemoveBadProgram], swap.feePayer],
    ['remove_current_duplicated_same_transaction', [...currentPositionSetup, currentRemoveBase, currentRemoveBase], swap.feePayer],
    ['remove_current_valid_then_invalid_authority_atomicity', [...currentPositionSetup, currentRemoveBase, currentRemoveBadSigner], swap.feePayer],
    ['claim_fee_baseline', [claimBase], claim.feePayer],
    ['claim_fee_authority_mutated', [claimBadSigner], claim.feePayer],
    ['claim_fee_destination_aliased_to_vault', [claimBadDestination], claim.feePayer],
    ['claim_fee_vault_binding_mutated', [claimBadVault], claim.feePayer],
    ['claim_fee_position_binding_mutated', [claimBadPosition], claim.feePayer],
    ['claim_fee_cpi_program_mutated', [claimBadProgram], claim.feePayer],
    ['claim_fee_duplicated_same_transaction', [claimBase, claimBase], claim.feePayer],
    ['claim_fee_valid_then_invalid_authority_atomicity', [claimBase, claimBadSigner], claim.feePayer],
    ['claim_fee_current_baseline', [...currentPositionSetup, currentClaimBase], swap.feePayer],
    ['claim_fee_current_authority_mutated', [...currentPositionSetup, currentClaimBadSigner], swap.feePayer],
    ['claim_fee_current_destination_aliased_to_vault', [...currentPositionSetup, currentClaimBadDestination], swap.feePayer],
    ['claim_fee_current_vault_binding_mutated', [...currentPositionSetup, currentClaimBadVault], swap.feePayer],
    ['claim_fee_current_position_binding_mutated', [...currentPositionSetup, currentClaimBadPosition], swap.feePayer],
    ['claim_fee_current_cpi_program_mutated', [...currentPositionSetup, currentClaimBadProgram], swap.feePayer],
    ['claim_fee_current_duplicated_same_transaction', [...currentPositionSetup, currentClaimBase, currentClaimBase], swap.feePayer],
    ['claim_fee_current_valid_then_invalid_authority_atomicity', [...currentPositionSetup, currentClaimBase, currentClaimBadSigner], swap.feePayer],
    ['protocol_fee_baseline_with_simulated_pda_signer', [createReceiverA, protocolBase], swap.feePayer],
    ['protocol_fee_authority_mutated', [createReceiverA, protocolBadSigner], swap.feePayer],
    ['protocol_fee_destination_aliased_to_vault', [protocolBadDestination], swap.feePayer],
    ['protocol_fee_unrelated_mint_destination', [createReceiverUnrelated, protocolWrongMintDestination], swap.feePayer],
    ['protocol_fee_vault_binding_mutated', [createReceiverA, protocolBadVault], swap.feePayer],
    ['protocol_fee_cpi_program_mutated', [createReceiverA, protocolBadProgram], swap.feePayer],
    ['protocol_fee_duplicated_same_transaction', [createReceiverA, protocolBase, protocolBase], swap.feePayer],
    ['protocol_fee_valid_then_invalid_authority_atomicity', [createReceiverA, protocolBase, protocolBadSigner], swap.feePayer],
    ['claim_then_remove_order', [claimBase, removeBase], claim.feePayer],
    ['remove_then_claim_order', [removeBase, claimBase], remove.feePayer],
    ['claim_then_remove_current_order', [...currentPositionSetup, currentClaimBase, currentRemoveBase], swap.feePayer],
    ['remove_then_claim_current_order', [...currentPositionSetup, currentRemoveBase, currentClaimBase], swap.feePayer],
  ];

  const results = [];
  for (const [name, ixs, payer] of cases) {
    const result = await simulate(connection, recentBlockhash, name, ixs, payer);
    results.push(result);
    process.stderr.write(`${JSON.stringify({ name, err: result.err || result.transportError || null, changes: result.changes?.map((row) => ({ account: row.account, tokenDelta: row.tokenDelta, changed: row.changed })) })}\n`);
  }

  const output = {
    observedAt: new Date().toISOString(),
    rpcMode: 'simulateTransaction(sigVerify=false, replaceRecentBlockhash=true); no sendTransaction calls',
    program: PROGRAM.toBase58(),
    sources: Object.fromEntries(Object.entries(controls).map(([name, control]) => [name, {
      signature: control.signature,
      slot: control.slot,
      blockTime: control.blockTime,
      feePayer: control.feePayer.toBase58(),
      dataHex: control.data.toString('hex'),
      accounts: control.accounts.map(({ name: accountName, pubkey, isSigner, isWritable }) => ({ name: accountName, pubkey: pubkey.toBase58(), isSigner, isWritable })),
      originalTokenDeltas: control.originalTokenDeltas,
    }])),
    protocolFeeConstruction: {
      sourcePool: PROTOCOL_FEE_POOL.toBase58(),
      protocolAFeeBefore: poolData.readBigUInt64LE(392).toString(),
      protocolBFeeBefore: poolData.readBigUInt64LE(400).toString(),
      receiverTokenAccount: receiverA.toBase58(),
      receiverOwner: receiverOwner.toBase58(),
      simulatedRequiredSigner: PROTOCOL_FEE_AUTHORITY.toBase58(),
      receiverOutputMint: outputMint,
      matchingPoolVault: protocolVaultName,
      limitation: 'The positive protocol-fee control bypasses signature verification only inside simulation; the live PDA signer remains unforgeable without the pFee3... caller.',
    },
    currentPositionConstruction: {
      sourceAddLiquiditySignature: added.signature,
      position: addedAccounts.position.pubkey.toBase58(),
      unlockedLiquidityBefore: unlockedLiquidity.toString(),
      removalDelta: removalDelta.toString(),
      destinationTokenA: positionDestinationA.toBase58(),
      destinationTokenB: positionDestinationB.toBase58(),
    },
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ observedAt: output.observedAt, results: results.map(({ name, err, transportError, changes }) => ({ name, err: err || transportError || null, changes: changes?.map(({ account, tokenDelta, changed }) => ({ account, tokenDelta, changed })) })) }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
