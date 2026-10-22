'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const modules = path.resolve(__dirname, '..', 'kliquidity-sdk-official', 'node_modules');
const { Connection, PublicKey } = require(path.join(modules, '@solana', 'web3.js'));
const { BorshAccountsCoder, utils: anchorUtils } = require(path.join(modules, '@coral-xyz', 'anchor'));
const spl = require(path.join(modules, '@solana', 'spl-token'));

const IDS = {
  vaultProgram: new PublicKey('VALT7AM76ZWfRhjVeYQRrLvNRLvqBzNs8dTsAcLW3jj'),
  guardianProgram: new PublicKey('GRAD6oot2mhagh3UmoqCmLkiW3G2cFS5bh9x6VbYEZxW'),
  usduProgram: new PublicKey('USDuuELLS5piwJ7vmMoKByqxaguyZov7CxKQHYRBvo5'),
  susduProgram: new PublicKey('SUSD2TSk8DJodCkPviKb2okzbeQ597kCBjLVjq3G7pp'),
  usduMint: new PublicKey('9ckR7pPPvyPadACDTzLwK2ZAEeUJ3qGSnzPs8bVaHrSy'),
  susduMint: new PublicKey('9iq5Q33RSiz1WcupHAQKbHBZkpn92UxBG2HfPWAZhMCa'),
};
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

function readConfiguredRpc() {
  for (const name of ['RPC_URL', 'SOLANA_RPC', 'HEAVY_RPC_URL']) {
    if (process.env[name]) return process.env[name];
  }
  const configPath = path.join(os.homedir(), '.config', 'solana', 'cli', 'config.yml');
  const config = fs.readFileSync(configPath, 'utf8');
  const match = config.match(/^json_rpc_url:\s*(.+)\s*$/m);
  if (!match) throw new Error(`No json_rpc_url in ${configPath}`);
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function pda(programId, ...seeds) {
  return PublicKey.findProgramAddressSync(seeds.map((seed) => Buffer.isBuffer(seed) ? seed : Buffer.from(seed)), programId);
}

function stringify(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value && value.constructor && value.constructor.name === 'BN') return value.toString(10);
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(stringify);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, stringify(inner)]));
  }
  return value;
}

function normalizeLegacyIdl(value) {
  if (value === 'pubkey') return 'publicKey';
  if (Array.isArray(value)) return value.map(normalizeLegacyIdl);
  if (value && typeof value === 'object') {
    if (value.defined && typeof value.defined === 'object' && value.defined.name) {
      return { defined: value.defined.name };
    }
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, normalizeLegacyIdl(inner)]));
  }
  return value;
}

function accountMeta(pubkey, info) {
  if (!info) return { address: pubkey.toBase58(), exists: false };
  return {
    address: pubkey.toBase58(),
    exists: true,
    owner: info.owner.toBase58(),
    executable: info.executable,
    lamports: info.lamports,
    dataLength: info.data.length,
    dataSha256: crypto.createHash('sha256').update(info.data).digest('hex'),
    discriminatorHex: info.data.subarray(0, 8).toString('hex'),
  };
}

function tokenAccount(pubkey, info, tokenProgram) {
  const decoded = spl.unpackAccount(pubkey, info, tokenProgram);
  return {
    ...accountMeta(pubkey, info),
    mint: decoded.mint.toBase58(),
    authority: decoded.owner.toBase58(),
    amount: decoded.amount.toString(),
    delegate: decoded.delegate ? decoded.delegate.toBase58() : null,
    delegatedAmount: decoded.delegatedAmount.toString(),
    isFrozen: decoded.isFrozen,
    isNative: decoded.isNative,
    closeAuthority: decoded.closeAuthority ? decoded.closeAuthority.toBase58() : null,
    tlvDataLength: decoded.tlvData.length,
  };
}

function mintAccount(pubkey, info, tokenProgram) {
  const decoded = spl.unpackMint(pubkey, info, tokenProgram);
  let extensionTypes = [];
  try { extensionTypes = spl.getExtensionTypes(decoded.tlvData); } catch (_) {}
  let permanentDelegate = null;
  let metadataPointer = null;
  try {
    const extension = spl.getPermanentDelegate(decoded);
    permanentDelegate = extension?.delegate?.toBase58() || null;
  } catch (_) {}
  try {
    const extension = spl.getMetadataPointerState(decoded);
    metadataPointer = extension ? {
      authority: extension.authority?.toBase58() || null,
      metadataAddress: extension.metadataAddress?.toBase58() || null,
    } : null;
  } catch (_) {}
  return {
    ...accountMeta(pubkey, info),
    mintAuthority: decoded.mintAuthority ? decoded.mintAuthority.toBase58() : null,
    supply: decoded.supply.toString(),
    decimals: decoded.decimals,
    isInitialized: decoded.isInitialized,
    freezeAuthority: decoded.freezeAuthority ? decoded.freezeAuthority.toBase58() : null,
    tlvDataLength: decoded.tlvData.length,
    extensionTypes,
    permanentDelegate,
    metadataPointer,
  };
}

async function main() {
  const idlBytes = fs.readFileSync(path.join(__dirname, 'unitas-idl-source', 'vault', 'vault.json'));
  const idl = JSON.parse(idlBytes.toString('utf8'));
  const coderIdl = normalizeLegacyIdl(JSON.parse(JSON.stringify(idl)));
  coderIdl.accounts = coderIdl.accounts.map((account) => ({
    ...account,
    type: coderIdl.types.find((type) => type.name === account.name)?.type,
  }));
  const coder = new BorshAccountsCoder(coderIdl);
  const connection = new Connection(readConfiguredRpc(), 'confirmed');

  const derived = {
    vaultConfig: pda(IDS.vaultProgram, 'vault-config'),
    vaultState: pda(IDS.vaultProgram, 'vault-state'),
    vaultUsdu: pda(IDS.vaultProgram, 'vault-usdu-approval'),
    vaultSusdu: pda(IDS.vaultProgram, 'vault-susdu-token-approval'),
    vaultStakePoolUsdu: pda(IDS.vaultProgram, 'vault-stake-pool-usdu'),
    vaultSiloUsdu: pda(IDS.vaultProgram, 'vault-silo-usdu'),
    accessRegistry: pda(IDS.guardianProgram, 'access-registry'),
    usduConfig: pda(IDS.usduProgram, 'usdu-config'),
    susduConfig: pda(IDS.susduProgram, 'susdu-config'),
  };

  const names = Object.keys(derived);
  const keys = [
    IDS.vaultProgram,
    ...Object.values(derived).map(([key]) => key),
    IDS.usduMint,
    IDS.susduMint,
  ];
  const snapshot = await connection.getMultipleAccountsInfoAndContext(keys, 'confirmed');
  const infos = new Map(keys.map((key, index) => [key.toBase58(), snapshot.value[index]]));

  const programInfo = infos.get(IDS.vaultProgram.toBase58());
  const programDataAddress = programInfo && programInfo.data.length >= 36
    ? new PublicKey(programInfo.data.subarray(4, 36))
    : null;
  const programDataInfo = programDataAddress ? await connection.getAccountInfo(programDataAddress, 'confirmed') : null;

  const getInfo = (pubkey) => infos.get(pubkey.toBase58());
  const vaultConfigKey = derived.vaultConfig[0];
  const vaultStateKey = derived.vaultState[0];
  const accessRegistryKey = derived.accessRegistry[0];
  const usduConfigKey = derived.usduConfig[0];
  const susduConfigKey = derived.susduConfig[0];
  const vaultConfig = coder.decode('VaultConfig', getInfo(vaultConfigKey).data);
  const vaultState = coder.decode('VaultState', getInfo(vaultStateKey).data);
  const accessRegistry = coder.decode('AccessRegistry', getInfo(accessRegistryKey).data);
  const usduConfig = coder.decode('UsduConfig', getInfo(usduConfigKey).data);
  const susduConfig = coder.decode('SusduConfig', getInfo(susduConfigKey).data);

  const roleDiscriminator = Buffer.from(idl.accounts.find((entry) => entry.name === 'AccessRole').discriminator);
  const roleAccounts = await connection.getProgramAccounts(IDS.guardianProgram, {
    commitment: 'confirmed',
    filters: [{ memcmp: { offset: 0, bytes: anchorUtils.bytes.bs58.encode(roleDiscriminator) } }],
  });
  const decodedRoles = roleAccounts.map(({ pubkey, account }) => ({
    address: pubkey.toBase58(),
    ...stringify(coder.decode('AccessRole', account.data)),
  })).sort((a, b) => a.address.localeCompare(b.address));

  const usduMintInfo = getInfo(IDS.usduMint);
  const susduMintInfo = getInfo(IDS.susduMint);
  const usduTokenProgram = usduMintInfo.owner;
  const susduTokenProgram = susduMintInfo.owner;
  const vaultTokenAccounts = {};
  for (const name of ['vaultUsdu', 'vaultSusdu', 'vaultStakePoolUsdu', 'vaultSiloUsdu']) {
    const key = derived[name][0];
    const info = getInfo(key);
    const tokenProgram = name === 'vaultSusdu' ? susduTokenProgram : usduTokenProgram;
    vaultTokenAccounts[name] = tokenAccount(key, info, tokenProgram);
  }

  const programData = programDataInfo && programDataInfo.data.length >= 45 ? {
    ...accountMeta(programDataAddress, programDataInfo),
    lastDeploySlot: programDataInfo.data.readBigUInt64LE(4).toString(),
    upgradeAuthority: programDataInfo.data[12] === 1
      ? new PublicKey(programDataInfo.data.subarray(13, 45)).toBase58()
      : null,
    executablePayloadSha256: crypto.createHash('sha256').update(programDataInfo.data.subarray(45)).digest('hex'),
  } : null;

  const binary = fs.readFileSync(path.join(__dirname, 'valt-current.so'));
  const literalInstructionDiscriminatorByteOccurrencesInElf = Object.fromEntries(idl.instructions.map((ix) => {
    const needle = Buffer.from(ix.discriminator);
    let matches = 0;
    for (let offset = 0; offset <= binary.length - needle.length; offset += 1) {
      if (binary.subarray(offset, offset + needle.length).equals(needle)) matches += 1;
    }
    return [ix.name, matches];
  }));

  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    submittedTransactions: 0,
    commitment: 'confirmed',
    observationSlot: snapshot.context.slot,
    ids: Object.fromEntries(Object.entries(IDS).map(([name, key]) => [name, key.toBase58()])),
    derived: Object.fromEntries(names.map((name) => [name, {
      address: derived[name][0].toBase58(),
      bump: derived[name][1],
    }])),
    program: {
      ...accountMeta(IDS.vaultProgram, programInfo),
      loaderIsUpgradeable: programInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID),
      programData,
      localDumpSha256: crypto.createHash('sha256').update(binary).digest('hex'),
      localDumpBytes: binary.length,
      officialIdlCommit: '17ed34217eb5b280c13a0e80b1727bc681070b3c',
      officialIdlSha256: crypto.createHash('sha256').update(idlBytes).digest('hex'),
      literalInstructionDiscriminatorByteOccurrencesInElf,
      literalDiscriminatorSearchCaveat: 'A zero count is not an instruction mismatch: optimized SBF code need not retain the eight-byte discriminators contiguously. Runtime transactions and instruction log strings provide the executable-surface evidence.',
    },
    accounts: {
      vaultConfig: { ...accountMeta(vaultConfigKey, getInfo(vaultConfigKey)), decoded: stringify(vaultConfig) },
      vaultState: { ...accountMeta(vaultStateKey, getInfo(vaultStateKey)), decoded: stringify(vaultState) },
      accessRegistry: { ...accountMeta(accessRegistryKey, getInfo(accessRegistryKey)), decoded: stringify(accessRegistry) },
      usduConfig: { ...accountMeta(usduConfigKey, getInfo(usduConfigKey)), decoded: stringify(usduConfig) },
      susduConfig: { ...accountMeta(susduConfigKey, getInfo(susduConfigKey)), decoded: stringify(susduConfig) },
      usduMint: mintAccount(IDS.usduMint, usduMintInfo, usduTokenProgram),
      susduMint: mintAccount(IDS.susduMint, susduMintInfo, susduTokenProgram),
      ...vaultTokenAccounts,
    },
    guardianRoles: decodedRoles,
  };

  fs.writeFileSync(path.join(__dirname, 'current-state-snapshot.json'), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
