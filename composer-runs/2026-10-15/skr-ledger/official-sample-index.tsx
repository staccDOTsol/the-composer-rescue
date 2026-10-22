import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useMobileWallet } from '@wallet-ui/react-native-kit';

import {
  address,
  createSolanaRpc,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
  type TransactionSigner,
} from '@solana/kit';

// Codama-generated client
import {
  fetchMaybeStakeConfig,
  fetchMaybeUserStake,
} from '../generated/staking/accounts';

import {
  getStakeInstructionAsync,
  getUnstakeInstructionAsync,
  getWithdrawInstructionAsync,
  getCancelUnstakeInstructionAsync,
} from '../generated/staking/instructions';

import { STAKING_PROGRAM_ADDRESS } from '../generated/staking/programs';

// ---------------------------------------------------------------------------
// Constants & Enums
// ---------------------------------------------------------------------------

enum ActionType {
  CONNECTING = 'connecting',
  STAKING = 'staking',
  UNSTAKING = 'unstaking',
  CANCELING = 'canceling',
  WITHDRAWING = 'withdrawing',
}

const RPC_URL = process.env.EXPO_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';

const SKR_MINT = address(
  'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
);

const TOKEN_PROGRAM_ID = address(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

const ASSOCIATED_TOKEN_PROGRAM_ID = address(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

// SKR uses 9 decimals
const SKR_DECIMALS = 6;
const SHARE_PRICE_SCALE = BigInt(1_000_000_000); // 1e9

// Known on-chain addresses
const STAKE_CONFIG_ADDRESS = address(
  '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw',
);
const STAKE_VAULT_ADDRESS = address(
  '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8',
);

const GUARDIAN_POOL_ADDRESS = address(
  'DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr',
);

// ---------------------------------------------------------------------------
// PDA derivation helpers
// ---------------------------------------------------------------------------

async function deriveUserStake(
  stakeConfig: Address,
  user: Address,
  guardianPool: Address,
): Promise<Address> {
  const addrEnc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: STAKING_PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode('user_stake'),
      addrEnc.encode(stakeConfig),
      addrEnc.encode(user),
      addrEnc.encode(guardianPool),
    ],
  });
  return pda;
}

async function findAssociatedTokenAddress(owner: Address,
  mint: Address,
): Promise<Address> {
  const addrEnc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [
      addrEnc.encode(owner),
      addrEnc.encode(address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')),
      addrEnc.encode(mint),
    ],
  });
  return pda;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function skrToRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** SKR_DECIMALS));
}

function rawToSkr(raw: bigint): number {
  return Number(raw) / 10 ** SKR_DECIMALS;
}

function sharesToTokens(shares: bigint, sharePrice: bigint): number {
  if (sharePrice === 0n) return 0;
  const rawTokens = (shares * sharePrice) / SHARE_PRICE_SCALE;
  return rawToSkr(rawTokens);
}

function tokensToShares(tokenAmount: number, sharePrice: bigint): bigint {
  const raw = skrToRaw(tokenAmount);
  return (raw * SHARE_PRICE_SCALE) / sharePrice;
}

// ---------------------------------------------------------------------------
// Instruction helpers
// ---------------------------------------------------------------------------

// Dummy TransactionSigner for Codama - MWA signs externally
function makeDummySigner(addr: Address): TransactionSigner {
  return {
    address: addr,
    signTransactions: async (txs: any) => txs,
  } as unknown as TransactionSigner;
}

// Create Idempotent ATA instruction (manual — not in staking IDL)
function createIdempotentATAInstruction(
  payer: Address,
  owner: Address,
  mint: Address,
  ata: Address,
) {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [
      { address: payer, role: 3 /* WRITABLE_SIGNER */ },
      { address: ata, role: 1 /* WRITABLE */ },
      { address: owner, role: 0 /* READONLY */ },
      { address: mint, role: 0 /* READONLY */ },
      { address: address('11111111111111111111111111111111'), role: 0 },
      { address: TOKEN_PROGRAM_ID, role: 0 },
    ],
    data: new Uint8Array([1]), // CreateIdempotent = instruction index 1
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// Format balance with K/M/B suffixes
function formatBalance(n: number): string {
  if (n >= 1_000_000_000) {
    return (n / 1_000_000_000).toFixed(2) + 'B';
  }
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(2) + 'M';
  }
  if (n >= 10_000) {
    return (n / 1_000).toFixed(2) + 'K';
  }
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Format cooldown time remaining (e.g., "47h 32m 15s" or "2h 15m")
function formatCooldownTime(seconds: number): string {
  if (seconds <= 0) return 'Ready!';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

// UNUSED FUNCTIONS - Commented out (see index.backup.tsx for restoration)
// function stripSigners(instruction: any) { ... }
// async function getUserStakePDA(user: Address, guardianPool: Address): Promise<Address> { ... }

// ---------------------------------------------------------------------------
// Screen Component
// ---------------------------------------------------------------------------

export default function SKRStakingScreen() {
  // Wallet hook
  const { connect, disconnect, sendTransaction, account } =
    useMobileWallet();

  const connectedWalletAddress: Address | null = account?.address ?? null;

  // Query state - for checking any address
  const [queryAddress, setQueryAddress] = useState('');
  const [queriedAddress, setQueriedAddress] = useState<Address | null>(null);

  // Queried address balances
  const [queriedWalletBalance, setQueriedWalletBalance] = useState(0);
  const [queriedStakedBalance, setQueriedStakedBalance] = useState(0);
  const [queriedUnstakingAmount, setQueriedUnstakingAmount] = useState(0);
  const [queriedUnstakingReady, setQueriedUnstakingReady] = useState(false);
  const [queriedUnstakeTimestamp, setQueriedUnstakeTimestamp] = useState<bigint | null>(null);
  const [queriedCooldownRemaining, setQueriedCooldownRemaining] = useState(0);

  // Connected wallet balances
  const [walletBalance, setWalletBalance] = useState(0);
  const [stakedBalance, setStakedBalance] = useState(0);
  const [unstakingAmount, setUnstakingAmount] = useState(0);
  const [unstakingReady, setUnstakingReady] = useState(false);
  const [unstakeTimestamp, setUnstakeTimestamp] = useState<bigint | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Shared config (same for all addresses)
  const [sharePrice, setSharePrice] = useState(0n);
  const [cooldownSecs, setCooldownSecs] = useState(172_800);

  // Inputs
  const [stakeInput, setStakeInput] = useState('');
  const [unstakeInput, setUnstakeInput] = useState('');

  // Loading states
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<ActionType | null>(null);

  const rpc = useRef(createSolanaRpc(RPC_URL)).current;

  // -----------------------------------------------------------------------
  // Wallet connect / disconnect via useMobileWallet hook
  // -----------------------------------------------------------------------

  const connectWallet = useCallback(async () => {
    setLoadingAction(ActionType.CONNECTING);
    try {
      await connect();
    } catch (err: any) {
      Alert.alert('Connection failed', err?.message ?? 'Unknown error');
    } finally {
      setLoadingAction(null);
    }
  }, [connect]);

  const disconnectWallet = useCallback(async () => {
    try {
      await disconnect();
    } catch {
      // ignore
    }
    setWalletBalance(0);
    setStakedBalance(0);
    setUnstakingAmount(0);
    setUnstakingReady(false);
  }, [disconnect]);

  // -----------------------------------------------------------------------
  // Fetch config (shared between all addresses)
  // -----------------------------------------------------------------------

  const fetchConfig = useCallback(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const configAcct = await fetchMaybeStakeConfig(rpc, STAKE_CONFIG_ADDRESS);
        if (configAcct.exists) {
          const config = configAcct.data;
          setSharePrice(config.sharePrice);
          setCooldownSecs(Number(config.cooldownSeconds));
          return { sharePrice: config.sharePrice, cooldown: Number(config.cooldownSeconds) };
        }
      } catch (e) {
        console.warn(`Failed to fetch StakeConfig (attempt ${attempt + 1}/3)`, e);
      }
    }
    return { sharePrice: SHARE_PRICE_SCALE, cooldown: 172_800 };
  }, [rpc]);

  // -----------------------------------------------------------------------
  // Fetch balances for queried address (read-only)
  // -----------------------------------------------------------------------

  const fetchQueriedBalances = useCallback(async (targetAddress: Address) => {
    setIsLoading(true);

    try {
      const { sharePrice: currentSharePrice, cooldown } = await fetchConfig();

      // 1. SKR token balance in wallet
      try {
        const ata = await findAssociatedTokenAddress(targetAddress, SKR_MINT);
        const tokenBal = await rpc
          .getTokenAccountBalance(ata, { commitment: 'confirmed' })
          .send();
        setQueriedWalletBalance(Number(tokenBal.value.uiAmount ?? 0));
      } catch (e) {
        setQueriedWalletBalance(0);
      }

      // 2. UserStake PDA
      const userStakePda = await deriveUserStake(
        STAKE_CONFIG_ADDRESS,
        targetAddress,
        GUARDIAN_POOL_ADDRESS,
      );
      try {
        const userAcct = await fetchMaybeUserStake(rpc, userStakePda);
        if (userAcct.exists) {
          const data = userAcct.data;
          setQueriedStakedBalance(sharesToTokens(data.shares, currentSharePrice));
          const unstaking = rawToSkr(data.unstakingAmount);
          setQueriedUnstakingAmount(unstaking);
          if (data.unstakingAmount > 0n) {
            const now = BigInt(Math.floor(Date.now() / 1000));
            setQueriedUnstakeTimestamp(data.unstakeTimestamp);
            setQueriedUnstakingReady(
              now >= data.unstakeTimestamp + BigInt(cooldown),
            );
          } else {
            setQueriedUnstakeTimestamp(null);
            setQueriedUnstakingReady(false);
          }
        } else {
          setQueriedStakedBalance(0);
          setQueriedUnstakingAmount(0);
          setQueriedUnstakingReady(false);
          setQueriedUnstakeTimestamp(null);
        }
      } catch {
        setQueriedStakedBalance(0);
        setQueriedUnstakingAmount(0);
        setQueriedUnstakingReady(false);
        setQueriedUnstakeTimestamp(null);
      }
    } catch (err) {
      console.warn('Error fetching queried balances:', err);
    } finally {
      setIsLoading(false);
    }
  }, [rpc, fetchConfig]);

  // -----------------------------------------------------------------------
  // Fetch balances for connected wallet
  // -----------------------------------------------------------------------

  const fetchConnectedBalances = useCallback(async (targetAddress: Address) => {
    try {
      const { sharePrice: currentSharePrice, cooldown } = await fetchConfig();

      // 1. SKR token balance in wallet
      try {
        const ata = await findAssociatedTokenAddress(targetAddress, SKR_MINT);
        const tokenBal = await rpc
          .getTokenAccountBalance(ata, { commitment: 'confirmed' })
          .send();
        setWalletBalance(Number(tokenBal.value.uiAmount ?? 0));
      } catch (e) {
        setWalletBalance(0);
      }

      // 2. UserStake PDA
      const userStakePda = await deriveUserStake(
        STAKE_CONFIG_ADDRESS,
        targetAddress,
        GUARDIAN_POOL_ADDRESS,
      );
      try {
        const userAcct = await fetchMaybeUserStake(rpc, userStakePda);
        if (userAcct.exists) {
          const data = userAcct.data;
          const computed = sharesToTokens(data.shares, currentSharePrice);
          setStakedBalance(computed);
          const unstaking = rawToSkr(data.unstakingAmount);
          setUnstakingAmount(unstaking);
          if (data.unstakingAmount > 0n) {
            const now = BigInt(Math.floor(Date.now() / 1000));
            setUnstakeTimestamp(data.unstakeTimestamp);
            setUnstakingReady(
              now >= data.unstakeTimestamp + BigInt(cooldown),
            );
          } else {
            setUnstakeTimestamp(null);
            setUnstakingReady(false);
          }
        } else {
          setStakedBalance(0);
          setUnstakingAmount(0);
          setUnstakingReady(false);
          setUnstakeTimestamp(null);
        }
      } catch {
        setStakedBalance(0);
        setUnstakingAmount(0);
        setUnstakingReady(false);
        setUnstakeTimestamp(null);
      }
    } catch (err) {
      console.warn('Error fetching connected balances:', err);
    }
  }, [rpc, fetchConfig]);

  // Auto-fetch when connected wallet changes
  useEffect(() => {
    if (connectedWalletAddress) {
      fetchConnectedBalances(connectedWalletAddress);
    }
  }, [connectedWalletAddress, fetchConnectedBalances]);

  // -----------------------------------------------------------------------
  // Query balance for any address
  // -----------------------------------------------------------------------

  const handleQueryAddress = useCallback(async () => {
    const trimmed = queryAddress.trim();
    if (!trimmed) {
      Alert.alert('Invalid address', 'Please enter a wallet address.');
      return;
    }

    try {
      const addr = address(trimmed);
      setQueriedAddress(addr);
      await fetchQueriedBalances(addr);
    } catch (err) {
      Alert.alert('Invalid address', 'Please enter a valid Solana address.');
    }
  }, [queryAddress, fetchQueriedBalances]);

  // -----------------------------------------------------------------------
  // Cooldown timer - updates every second
  // -----------------------------------------------------------------------

  // Cooldown timer for connected wallet
  useEffect(() => {
    if (!unstakeTimestamp || unstakingAmount === 0) {
      setCooldownRemaining(0);
      return;
    }

    const updateCooldown = () => {
      const now = BigInt(Math.floor(Date.now() / 1000));
      const cooldownEnd = unstakeTimestamp + BigInt(cooldownSecs);
      const remaining = Number(cooldownEnd - now);
      setCooldownRemaining(Math.max(0, remaining));
    };

    updateCooldown();
    const interval = setInterval(updateCooldown, 1000);
    return () => clearInterval(interval);
  }, [unstakeTimestamp, cooldownSecs, unstakingAmount]);

  // Cooldown timer for queried address
  useEffect(() => {
    if (!queriedUnstakeTimestamp || queriedUnstakingAmount === 0) {
      setQueriedCooldownRemaining(0);
      return;
    }

    const updateCooldown = () => {
      const now = BigInt(Math.floor(Date.now() / 1000));
      const cooldownEnd = queriedUnstakeTimestamp + BigInt(cooldownSecs);
      const remaining = Number(cooldownEnd - now);
      setQueriedCooldownRemaining(Math.max(0, remaining));
    };

    updateCooldown();
    const interval = setInterval(updateCooldown, 1000);
    return () => clearInterval(interval);
  }, [queriedUnstakeTimestamp, cooldownSecs, queriedUnstakingAmount]);

  // -----------------------------------------------------------------------
  // Transaction builder: Build instructions → MWA sign+send
  // -----------------------------------------------------------------------

  const buildAndSend = useCallback(
    async (
      buildInstructions: (user: Address) => Promise<import('@solana/kit').Instruction[]>,
      actionType: ActionType,
    ) => {
      if (!connectedWalletAddress) throw new Error('Wallet not connected');
      setLoadingAction(actionType);

      try {
        const rawInstructions = await buildInstructions(connectedWalletAddress);

        // Strip signer metadata - MWA adds its own signer
        const instructions = rawInstructions.map(ix => ({
          ...ix,
          accounts: ix.accounts?.map(acc => ({
            address: acc.address,
            role: acc.role,
          })),
        }));

        const signature = await sendTransaction(instructions);

        // Poll for confirmation
        let confirmed = false;
        for (let i = 0; i < 30 && !confirmed; i++) {
          await sleep(1000);
          try {
            const { value: statuses } = await rpc
              .getSignatureStatuses([signature as any])
              .send();
            if (statuses?.[0]?.confirmationStatus) {
              confirmed = true;
              break;
            }
          } catch {
            // Ignore polling errors, continue trying
          }
        }

        const sigStr = String(signature);
        Alert.alert(
          'Success',
          `Transaction ${confirmed ? 'confirmed' : 'sent'}!\n${sigStr.slice(0, 20)}…`,
        );

        // Refresh balances for connected wallet
        if (connectedWalletAddress) {
          await fetchConnectedBalances(connectedWalletAddress);
        }
      } catch (err: any) {
        console.error('Transaction failed:', err);

        // Extract program error code if available
        if (err?.message?.includes('custom program error')) {
          const errorMatch = err.message.match(/custom program error: 0x([0-9a-f]+)/i);
          if (errorMatch) {
            const errorCode = parseInt(errorMatch[1], 16);
            console.error('Program error code:', errorCode);
          }
        }

        Alert.alert(
          'Transaction failed',
          err?.message ?? 'Unknown error',
        );
      } finally {
        setLoadingAction(null);
      }
    },
    [connectedWalletAddress, sendTransaction, rpc, fetchConnectedBalances],
  );


  // -----------------------------------------------------------------------
  // Actions — using Codama-generated instruction builders
  // -----------------------------------------------------------------------

  const handleStake = useCallback(async () => {
    const amount = parseFloat(stakeInput);
    if (!amount || amount < 1) {
      Alert.alert('Invalid amount', 'Minimum stake amount is 1 SKR.');
      return;
    }
    if (amount > walletBalance) {
      Alert.alert('Insufficient balance', 'You do not have enough SKR.');
      return;
    }

    await buildAndSend(async userAddress => {
      const rawAmount = skrToRaw(amount);
      const userATA = await findAssociatedTokenAddress(userAddress, SKR_MINT);
      const dummySigner = makeDummySigner(userAddress);

      const ix = await getStakeInstructionAsync({
        stakeConfig: STAKE_CONFIG_ADDRESS,
        guardianPool: GUARDIAN_POOL_ADDRESS,
        payer: dummySigner,
        user: userAddress,
        userTokenAccount: userATA,
        stakeVault: STAKE_VAULT_ADDRESS,
        mint: SKR_MINT,
        program: STAKING_PROGRAM_ADDRESS,
        amount: rawAmount,
      });

      return [ix];
    }, ActionType.STAKING);

    setStakeInput('');
  }, [stakeInput, walletBalance, buildAndSend]);
  
  const handleUnstake = useCallback(async () => {
    const amount = parseFloat(unstakeInput);

    // These checks should be caught by disabled button, but keep for safety
    if (amount > stakedBalance) {
      Alert.alert('Exceeds staked', 'Cannot unstake more than staked.');
      return;
    }
    if (sharePrice === 0n) {
      Alert.alert('Loading', 'Share price not loaded yet. Try again.');
      return;
    }

    await buildAndSend(async userAddress => {
      const shares = tokensToShares(amount, sharePrice);
      const userStakePda = await deriveUserStake(
        STAKE_CONFIG_ADDRESS,
        userAddress,
        GUARDIAN_POOL_ADDRESS,
      );
      const dummySigner = makeDummySigner(userAddress);

      const ix = await getUnstakeInstructionAsync({
        userStake: userStakePda,
        stakeConfig: STAKE_CONFIG_ADDRESS,
        guardianPool: GUARDIAN_POOL_ADDRESS,
        user: dummySigner,
        stakeVault: STAKE_VAULT_ADDRESS,
        mint: SKR_MINT,
        program: STAKING_PROGRAM_ADDRESS,
        shares,
      });

      return [ix];
    }, ActionType.UNSTAKING);

    setUnstakeInput('');
  }, [unstakeInput, stakedBalance, sharePrice, buildAndSend]);

  const handleCancelUnstake = useCallback(async () => {
    await buildAndSend(async userAddress => {
      const userStakePda = await deriveUserStake(
        STAKE_CONFIG_ADDRESS,
        userAddress,
        GUARDIAN_POOL_ADDRESS,
      );
      const dummySigner = makeDummySigner(userAddress);

      const ix = await getCancelUnstakeInstructionAsync({
        userStake: userStakePda,
        stakeConfig: STAKE_CONFIG_ADDRESS,
        guardianPool: GUARDIAN_POOL_ADDRESS,
        user: dummySigner,
        stakeVault: STAKE_VAULT_ADDRESS,
        program: STAKING_PROGRAM_ADDRESS,
      });

      return [ix];
    }, ActionType.CANCELING);
  }, [buildAndSend]);

  const handleWithdraw = useCallback(async () => {
    if (unstakingAmount <= 0) {
      Alert.alert('Nothing to withdraw', 'No unstaked SKR to withdraw.');
      return;
    }
    if (!unstakingReady) {
      Alert.alert(
        'Cooldown active',
        `Unstaked SKR is still in the ${Math.ceil(cooldownSecs / 3600)}h cooldown.`,
      );
      return;
    }

    await buildAndSend(async user => {
      const userATA = await findAssociatedTokenAddress(user, SKR_MINT);
      const userStakePda = await deriveUserStake(
        STAKE_CONFIG_ADDRESS,
        user,
        GUARDIAN_POOL_ADDRESS,
      );

      // Ensure ATA exists
      const createATAIx = createIdempotentATAInstruction(
        user,
        user,
        SKR_MINT,
        userATA,
      );

      const withdrawIx = await getWithdrawInstructionAsync({
        userStake: userStakePda,
        user: user,
        stakeVault: STAKE_VAULT_ADDRESS,
        userTokenAccount: userATA,
        program: STAKING_PROGRAM_ADDRESS,
      });
      return [createATAIx, withdrawIx];
    }, ActionType.WITHDRAWING);
  }, [unstakingAmount, unstakingReady, cooldownSecs, buildAndSend]);

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>SKR Staking</Text>
        </View>

        {/* Check Balance - Primary Action */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Check Balance</Text>
          <Text style={s.hint}>
            Enter any wallet address to view staking balance
          </Text>
          <View style={s.inputRow}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              placeholder="Wallet Address"
              placeholderTextColor="#888"
              value={queryAddress}
              onChangeText={setQueryAddress}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={({ pressed }) => [
                s.pasteBtn,
                pressed && { opacity: 0.7 },
              ]}
              onPress={async () => {
                const text = await Clipboard.getString();
                if (text) setQueryAddress(text);
              }}>
              <Text style={s.pasteBtnText}>📋</Text>
            </Pressable>
          </View>
          <Pressable
            style={({ pressed }) => [
              s.primaryBtn,
              isLoading && s.disabledBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={handleQueryAddress}
            disabled={isLoading}>
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.primaryBtnText}>Check Balance</Text>
            )}
          </Pressable>
        </View>

        {/* Queried Address Balance Cards */}
        {queriedAddress && (
          <>
            <Text style={s.addressLabel}>
              Address: {String(queriedAddress).slice(0, 8)}...{String(queriedAddress).slice(-8)}
            </Text>

            <View style={s.card}>
              <Text style={s.cardLabel}>Wallet Balance</Text>
              <Text style={s.cardValue}>{formatBalance(queriedWalletBalance)} SKR</Text>
            </View>

            <View style={s.card}>
              <Text style={s.cardLabel}>Staked</Text>
              <Text style={[s.cardValue, { color: '#22c55e' }]}>
                {formatBalance(queriedStakedBalance)} SKR
              </Text>
            </View>

            {queriedUnstakingAmount > 0 && (
              <View style={s.card}>
                <Text style={s.cardLabel}>
                  Unstaking {queriedUnstakingReady ? '(ready!)' : '(cooling down…)'}
                </Text>
                <Text style={[s.cardValue, { color: '#f59e0b' }]}>
                  {formatBalance(queriedUnstakingAmount)} SKR
                </Text>
                {!queriedUnstakingReady && queriedCooldownRemaining > 0 && (
                  <Text style={s.cooldownTimer}>
                    Cooldown: {formatCooldownTime(queriedCooldownRemaining)}
                  </Text>
                )}
                {queriedUnstakingReady && (
                  <Text style={[s.cooldownTimer, { color: '#22c55e' }]}>
                    Ready to withdraw!
                  </Text>
                )}
              </View>
            )}
          </>
        )}

        {/* Connect Wallet Section */}
        {!connectedWalletAddress && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Connect Wallet</Text>
            <Text style={s.hint}>
              Connect your wallet to stake, unstake, or withdraw SKR
            </Text>
            <Pressable
              style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.7 }]}
              onPress={connectWallet}
              disabled={loadingAction === ActionType.CONNECTING}>
              {loadingAction === ActionType.CONNECTING ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.primaryBtnText}>Connect Wallet</Text>
              )}
            </Pressable>
          </View>
        )}

        {/* Connected Wallet Balance Cards and Actions */}
        {connectedWalletAddress && (
          <>
            <View style={s.walletHeader}>
              <Text style={s.sectionTitle}>Your Wallet</Text>
              <Pressable
                style={({ pressed }) => [
                  s.disconnectBtn,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={disconnectWallet}>
                <Text style={s.disconnectText}>
                  {String(connectedWalletAddress).slice(0, 6)}...{String(connectedWalletAddress).slice(-6)}
                </Text>
                <Text style={s.disconnectIcon}> ✕</Text>
              </Pressable>
            </View>

            <View style={s.card}>
              <Text style={s.cardLabel}>Wallet Balance</Text>
              <Text style={s.cardValue}>{formatBalance(walletBalance)} SKR</Text>
            </View>

            <View style={s.card}>
              <Text style={s.cardLabel}>Staked</Text>
              <Text style={[s.cardValue, { color: '#22c55e' }]}>
                {formatBalance(stakedBalance)} SKR
              </Text>
            </View>

            {unstakingAmount > 0 && (
              <View style={s.card}>
                <Text style={s.cardLabel}>
                  Unstaking {unstakingReady ? '(ready!)' : '(cooling down…)'}
                </Text>
                <Text style={[s.cardValue, { color: '#f59e0b' }]}>
                  {formatBalance(unstakingAmount)} SKR
                </Text>
                {!unstakingReady && cooldownRemaining > 0 && (
                  <Text style={s.cooldownTimer}>
                    Cooldown: {formatCooldownTime(cooldownRemaining)}
                  </Text>
                )}
                {unstakingReady && (
                  <Text style={[s.cooldownTimer, { color: '#22c55e' }]}>
                    Ready to withdraw!
                  </Text>
                )}
              </View>
            )}
          </>
        )}

        {/* Stake */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Stake SKR</Text>
          {!connectedWalletAddress && (
            <Text style={s.hint}>Connect your wallet above to stake SKR</Text>
          )}
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              placeholder="Amount"
              placeholderTextColor="#888"
              keyboardType="decimal-pad"
              value={stakeInput}
              onChangeText={setStakeInput}
              editable={!!connectedWalletAddress}
            />
            <Pressable
              style={({ pressed }) => [
                s.maxBtn,
                !connectedWalletAddress && s.disabledBtn,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setStakeInput(String(walletBalance))}
              disabled={!connectedWalletAddress}>
              <Text style={s.maxBtnText}>MAX</Text>
            </Pressable>
          </View>
          <Pressable
            style={({ pressed }) => [
              s.primaryBtn,
              (!connectedWalletAddress || loadingAction !== null || walletBalance === 0) && s.disabledBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={handleStake}
            disabled={!connectedWalletAddress || loadingAction !== null || walletBalance === 0}>
            {loadingAction === ActionType.STAKING ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.primaryBtnText}>Stake</Text>
            )}
          </Pressable>
          {connectedWalletAddress && walletBalance === 0 && (
            <Text style={s.hint}>No SKR balance available to stake</Text>
          )}
        </View>

        {/* Unstake */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Unstake SKR</Text>
          <Text style={s.hint}>
            {connectedWalletAddress
              ? `Starts a ${cooldownSecs / 3600}h cooldown. After that, withdraw.`
              : 'Connect your wallet above to unstake SKR'}
          </Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              placeholder="Amount"
              placeholderTextColor="#888"
              keyboardType="decimal-pad"
              value={unstakeInput}
              onChangeText={setUnstakeInput}
              editable={!!connectedWalletAddress}
            />
            <Pressable
              style={({ pressed }) => [
                s.maxBtn,
                !connectedWalletAddress && s.disabledBtn,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setUnstakeInput(String(stakedBalance))}
              disabled={!connectedWalletAddress && !unstakeInput}>
              <Text style={s.maxBtnText}>MAX</Text>
            </Pressable>
          </View>
          <Pressable
            style={({ pressed }) => [
              s.secondaryBtn,
              (!connectedWalletAddress ||
               loadingAction !== null ||
               !unstakeInput ||
               parseFloat(unstakeInput) <= 0 ||
               stakedBalance === 0) && s.disabledBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={handleUnstake}
            disabled={
              !connectedWalletAddress ||
              loadingAction !== null ||
              !unstakeInput ||
              parseFloat(unstakeInput) <= 0 ||
              stakedBalance === 0
            }>
            {loadingAction === ActionType.UNSTAKING ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.secondaryBtnText}>Unstake</Text>
            )}
          </Pressable>
        </View>

        {/* Cancel Unstake */}
        {unstakingAmount > 0 && !unstakingReady && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Cancel Unstake</Text>
            <Text style={s.hint}>
              {connectedWalletAddress
                ? 'Restore your shares and cancel the cooldown.'
                : 'Connect your wallet above to cancel unstake'}
            </Text>
            <Pressable
              style={({ pressed }) => [
                s.secondaryBtn,
                (!connectedWalletAddress ||
                 loadingAction !== null ||
                 unstakingAmount === 0) && s.disabledBtn,
                pressed && { opacity: 0.7 },
              ]}
              onPress={handleCancelUnstake}
              disabled={
                !connectedWalletAddress ||
                loadingAction !== null ||
                unstakingAmount === 0
              }>
              {loadingAction === ActionType.CANCELING ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.secondaryBtnText}>Cancel Unstake</Text>
              )}
            </Pressable>
          </View>
        )}

        {/* Withdraw */}
        {unstakingAmount > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Withdraw</Text>
            <Text style={s.hint}>
              {!connectedWalletAddress
                ? 'Connect your wallet above to withdraw'
                : unstakingReady
                ? `${formatBalance(unstakingAmount)} SKR is ready to withdraw.`
                : `Cooldown remaining: ${formatCooldownTime(cooldownRemaining)}`}
            </Text>
            <Pressable
              style={({ pressed }) => [
                s.primaryBtn,
                (!connectedWalletAddress || !unstakingReady || loadingAction !== null) && s.disabledBtn,
                pressed && { opacity: 0.7 },
              ]}
              onPress={handleWithdraw}
              disabled={!connectedWalletAddress || !unstakingReady || loadingAction !== null}>
              {loadingAction === ActionType.WITHDRAWING ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.primaryBtnText}>Withdraw SKR</Text>
              )}
            </Pressable>
          </View>
        )}

        {/* Refresh buttons */}
          {connectedWalletAddress && (
            <Pressable
              style={({ pressed }) => [s.refreshBtn, pressed && { opacity: 0.7 }]}
              onPress={() => fetchConnectedBalances(connectedWalletAddress)}
              disabled={isLoading}>
              <Text style={s.refreshText}>↻ Refresh Wallet</Text>
            </Pressable>
          )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f14' },
  scroll: { padding: 20, paddingBottom: 60 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 32,
  },
  disconnectBtn: {
    backgroundColor: '#1a1a24',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  disconnectText: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  disconnectIcon: {
    color: '#f87171',
    fontSize: 14,
    fontWeight: '600',
  },

  addressLabel: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 12,
    fontFamily: 'monospace',
  },

  queriedAddress: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 12,
    fontFamily: 'monospace',
  },

  card: {
    backgroundColor: '#1a1a24',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardLabel: { color: '#888', fontSize: 13, marginBottom: 4 },
  cardValue: { color: '#fff', fontSize: 22, fontWeight: '600' },
  cooldownTimer: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
  },

  section: {
    backgroundColor: '#1a1a24',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  hint: { color: '#888', fontSize: 13, marginBottom: 12 },

  walletHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 12,
  },

  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  input: {
    flex: 1,
    backgroundColor: '#0f0f14',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  maxBtn: {
    marginLeft: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2a2a3a',
  },
  pasteBtn: {
    marginLeft: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2a2a3a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pasteBtnText: {
    fontSize: 18,
  },
  maxBtnText: { color: '#aaa', fontSize: 13, fontWeight: '600' },

  primaryBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingVertical: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    backgroundColor: '#374151',
    borderRadius: 10,
    paddingVertical: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabledBtn: { opacity: 0.5 },
  refreshBtn: {
    alignSelf: 'center',
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  refreshText: { color: '#7c3aed', fontSize: 15, fontWeight: '500' },
});