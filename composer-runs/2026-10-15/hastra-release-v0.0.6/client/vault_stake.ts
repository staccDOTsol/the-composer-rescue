/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/vault_stake.json`.
 */
export type VaultStake = {
  "address": "97V7JsExNC6yFWu5KjK1FLfVkNVvtMpAFL5QkLWKEGxY",
  "metadata": {
    "name": "vaultStake",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Solana Vault Stake Contract for Hastra"
  },
  "instructions": [
    {
      "name": "assetsToShares",
      "discriminator": [
        193,
        161,
        105,
        100,
        220,
        76,
        19,
        197
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultTokenAccount"
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "stakePriceConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "assets",
          "type": "u64"
        }
      ],
      "returns": "u64"
    },
    {
      "name": "deposit",
      "docs": [
        "Handles user deposits of vault tokens (e.g., wYLDS):",
        "- Transfers vault tokens to program vault account",
        "- Mints equivalent amount of stake tokens (e.g., PRIME) to user"
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stakeVaultTokenAccountConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "vaultMint",
          "writable": true
        },
        {
          "name": "mintAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "userVaultTokenAccount",
          "writable": true
        },
        {
          "name": "userMintTokenAccount",
          "writable": true
        },
        {
          "name": "stakePriceConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "exchangeRate",
      "discriminator": [
        168,
        77,
        41,
        158,
        147,
        180,
        79,
        139
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultTokenAccount"
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "stakePriceConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        }
      ],
      "args": [],
      "returns": "u64"
    },
    {
      "name": "freezeTokenAccount",
      "discriminator": [
        138,
        168,
        178,
        109,
        205,
        224,
        209,
        93
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenAccount",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "freezeAuthorityPda",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  114,
                  101,
                  101,
                  122,
                  101,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "Initializes the vault program with the required token configurations:",
        "- vault_mint: The token that users deposit (e.g., wYLDS)",
        "- stake_mint: The token users receive when staking (e.g., PRIME)"
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "docs": [
            "This PDA will be set as the owner of the vault_token_account in the config",
            "The vault token account holds the deposited vault tokens (e.g., wYLDS)",
            "and is controlled by this program via the vault_authority PDA",
            "This ensures that only this program can move tokens out of the vault",
            "and prevents unauthorized access."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "docs": [
            "The vault token account that should be owned by vault_authority"
          ],
          "writable": true
        },
        {
          "name": "stakeVaultTokenAccountConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "vaultTokenMint"
        },
        {
          "name": "mint"
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "programData"
        }
      ],
      "args": [
        {
          "name": "freezeAdministrators",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "rewardsAdministrators",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "initializeLastRewardPublication",
      "docs": [
        "Creates the LastRewardPublication PDA, seeding the id floor for publish_rewards.",
        "Must be called once before `publish_rewards` can succeed. Only callable by the program",
        "upgrade authority. Pass `start_id` at or above the highest historical publication id;",
        "subsequent publishes must use an id greater than the floor and within `MAX_GAP`."
      ],
      "discriminator": [
        159,
        116,
        254,
        55,
        197,
        2,
        193,
        45
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "lastRewardPublication",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  115,
                  116,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  112,
                  117,
                  98,
                  108,
                  105,
                  99,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "startId",
          "type": "u32"
        }
      ]
    },
    {
      "name": "initializePriceConfig",
      "docs": [
        "Creates the StakePriceConfig PDA with Chainlink program references and staleness parameters.",
        "Must be called once after deployment before deposit or redeem can proceed.",
        "Only callable by the program upgrade authority."
      ],
      "discriminator": [
        124,
        17,
        124,
        195,
        56,
        233,
        195,
        66
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stakePriceConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "chainlinkProgram",
          "type": "pubkey"
        },
        {
          "name": "chainlinkVerifierAccount",
          "type": "pubkey"
        },
        {
          "name": "chainlinkAccessController",
          "type": "pubkey"
        },
        {
          "name": "feedId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "priceScale",
          "type": "u64"
        },
        {
          "name": "priceMaxStaleness",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initializeStakeRewardConfig",
      "docs": [
        "Creates the StakeRewardConfig PDA with protocol default caps and cooldown.",
        "Must be called once before `publish_rewards` can enforce limits.",
        "Only callable by the program upgrade authority."
      ],
      "discriminator": [
        198,
        113,
        85,
        190,
        116,
        36,
        173,
        85
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stakeRewardConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "pause",
      "docs": [
        "Pauses or unpauses the protocol operations:",
        "- pause: true to pause, false to unpause"
      ],
      "discriminator": [
        211,
        22,
        221,
        251,
        74,
        121,
        193,
        47
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "pause",
          "type": "bool"
        }
      ]
    },
    {
      "name": "publishRewards",
      "docs": [
        "Publishes a reward distribution. `id` must be greater than the pool's",
        "`LastRewardPublication.id` and within `LastRewardPublication::MAX_GAP` of it."
      ],
      "discriminator": [
        200,
        232,
        166,
        158,
        160,
        127,
        250,
        43
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mintConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ],
            "program": {
              "kind": "account",
              "path": "mintProgram"
            }
          }
        },
        {
          "name": "externalMintAuthority",
          "docs": [
            "PDA that proves this call is from this staking program.",
            "Signed during the CPI to vault-mint. Only this program can produce a valid",
            "signer for this address because it is derived from crate::id()."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  116,
                  101,
                  114,
                  110,
                  97,
                  108,
                  95,
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "mintProgram"
        },
        {
          "name": "thisProgram",
          "docs": [
            "This program's own account, passed to vault-mint as the calling_program identifier",
            "so vault-mint can verify the caller against its allowed-program list."
          ]
        },
        {
          "name": "vaultMintAllowedExternalPrograms",
          "docs": [
            "The AllowedExternalMintPrograms PDA from vault-mint, passed through during the CPI to",
            "vault-mint::external_program_mint. vault-mint uses it to authorize callers beyond the",
            "legacy single-program field. This account is required here and in vault-mint, so it",
            "must already exist on-chain (typically created during vault-mint upgrade / migration",
            "via register_allowed_external_mint_program, which uses init_if_needed) before",
            "publish_rewards can succeed. Until any programs are registered, account data may be",
            "empty or too short to deserialize; vault-mint then treats the extended list as empty",
            "and only the legacy config field applies."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119,
                  101,
                  100,
                  95,
                  101,
                  120,
                  116,
                  101,
                  114,
                  110,
                  97,
                  108,
                  95,
                  109,
                  105,
                  110,
                  116,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "mintConfig"
              }
            ],
            "program": {
              "kind": "account",
              "path": "mintProgram"
            }
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "rewardsMint",
          "writable": true
        },
        {
          "name": "rewardsMintAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ],
            "program": {
              "kind": "account",
              "path": "mintProgram"
            }
          }
        },
        {
          "name": "stakeVaultTokenAccountConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "rewardRecord",
          "docs": [
            "Per-publication record. Seeds `(id, amount)` are addressing only; uniqueness of the",
            "publication id is enforced by `last_reward_publication` in the handler."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  114,
                  101,
                  99,
                  111,
                  114,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "id"
              },
              {
                "kind": "arg",
                "path": "amount"
              }
            ]
          }
        },
        {
          "name": "stakeRewardConfig",
          "docs": [
            "Reward cap config — must exist (see `initialize_stake_reward_config`)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "lastRewardPublication",
          "docs": [
            "Highest accepted reward publication id — must exist (see `initialize_last_reward_publication`).",
            "Typed and required so a missing account fails closed rather than materializing at zero."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  115,
                  116,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  112,
                  117,
                  98,
                  108,
                  105,
                  99,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u32"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "redeem",
      "docs": [
        "Redeems stake tokens (PRIME) for vault tokens (wYLDS):",
        "- Burns the specified amount of PRIME from the user's account",
        "- Transfers the proportional wYLDS from the vault to the user immediately",
        "- Optionally closes a legacy unbonding ticket (from v1) and returns rent to user"
      ],
      "discriminator": [
        184,
        12,
        86,
        149,
        70,
        196,
        97,
        225
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stakeVaultTokenAccountConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "ticket",
          "docs": [
            "Optional legacy unbonding ticket from the old two-step flow.",
            "If present (pass the ticket PDA address), it will be closed and rent returned to signer.",
            "If no ticket exists, pass the program's own ID — Anchor 0.31 treats it as None and skips all constraints."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  99,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "userVaultTokenAccount",
          "writable": true
        },
        {
          "name": "userMintTokenAccount",
          "writable": true
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "vaultMint",
          "writable": true
        },
        {
          "name": "stakePriceConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sharesToAssets",
      "discriminator": [
        32,
        122,
        191,
        143,
        148,
        101,
        162,
        142
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultTokenAccount"
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "stakePriceConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "shares",
          "type": "u64"
        }
      ],
      "returns": "u64"
    },
    {
      "name": "thawTokenAccount",
      "discriminator": [
        199,
        172,
        96,
        93,
        244,
        252,
        137,
        171
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenAccount",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "freezeAuthorityPda",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  114,
                  101,
                  101,
                  122,
                  101,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "updateFreezeAdministrators",
      "discriminator": [
        169,
        194,
        112,
        142,
        80,
        94,
        72,
        189
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "programData"
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newAdministrators",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "updateLastRewardPublication",
      "docs": [
        "Corrects the LastRewardPublication floor (upgrade authority). Recovery when start_id",
        "was seeded wrongly so the pool can publish within MAX_GAP of the next legitimate id."
      ],
      "discriminator": [
        113,
        16,
        130,
        19,
        20,
        54,
        8,
        167
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "lastRewardPublication",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  115,
                  116,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  112,
                  117,
                  98,
                  108,
                  105,
                  99,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "programData"
        }
      ],
      "args": [
        {
          "name": "newId",
          "type": "u32"
        }
      ]
    },
    {
      "name": "updateMaxPeriodRewards",
      "docs": [
        "Updates the absolute per-call rewards cap.",
        "Only callable by the program upgrade authority."
      ],
      "discriminator": [
        191,
        86,
        129,
        54,
        217,
        13,
        237,
        202
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stakeRewardConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "programData"
        }
      ],
      "args": [
        {
          "name": "newCap",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateMaxRewardBps",
      "docs": [
        "Updates the maximum reward distribution cap on an existing StakeRewardConfig.",
        "Only callable by the program upgrade authority."
      ],
      "discriminator": [
        13,
        8,
        51,
        170,
        40,
        34,
        38,
        42
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stakeRewardConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "programData"
        }
      ],
      "args": [
        {
          "name": "newBps",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateMaxTotalRewards",
      "docs": [
        "Updates the lifetime cumulative rewards cap.",
        "Only callable by the program upgrade authority."
      ],
      "discriminator": [
        142,
        41,
        28,
        28,
        206,
        111,
        74,
        150
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stakeRewardConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "programData"
        }
      ],
      "args": [
        {
          "name": "newCap",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updatePriceConfig",
      "docs": [
        "Updates Chainlink program references and staleness parameters on an existing StakePriceConfig.",
        "Does not reset the stored price or price_timestamp.",
        "Only callable by the program upgrade authority."
      ],
      "discriminator": [
        254,
        204,
        29,
        167,
        223,
        55,
        110,
        84
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stakePriceConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "programData"
        }
      ],
      "args": [
        {
          "name": "chainlinkProgram",
          "type": "pubkey"
        },
        {
          "name": "chainlinkVerifierAccount",
          "type": "pubkey"
        },
        {
          "name": "chainlinkAccessController",
          "type": "pubkey"
        },
        {
          "name": "feedId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "priceScale",
          "type": "u64"
        },
        {
          "name": "priceMaxStaleness",
          "type": "i64"
        }
      ]
    },
    {
      "name": "updateRewardPeriodSeconds",
      "docs": [
        "Updates the cooldown period in seconds between successful reward publications.",
        "Only callable by the program upgrade authority."
      ],
      "discriminator": [
        211,
        150,
        74,
        81,
        110,
        169,
        122,
        131
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stakeRewardConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "programData"
        }
      ],
      "args": [
        {
          "name": "newSeconds",
          "type": "i64"
        }
      ]
    },
    {
      "name": "updateRewardsAdministrators",
      "discriminator": [
        152,
        46,
        142,
        129,
        7,
        137,
        219,
        237
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "programData"
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newAdministrators",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "verifyPrice",
      "docs": [
        "Submits a signed Chainlink Data Streams report for on-chain verification.",
        "On success, stores the verified price and the report’s `observations_timestamp` in",
        "StakePriceConfig (requiring a strictly newer observation than any previously stored);",
        "deposit and redeem measure staleness from that observation time.",
        "Only callable by rewards administrators."
      ],
      "discriminator": [
        37,
        77,
        116,
        27,
        235,
        16,
        76,
        234
      ],
      "accounts": [
        {
          "name": "stakeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stakePriceConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "stakeConfig"
              }
            ]
          }
        },
        {
          "name": "chainlinkVerifierAccount"
        },
        {
          "name": "chainlinkAccessController"
        },
        {
          "name": "chainlinkConfigAccount"
        },
        {
          "name": "chainlinkProgram"
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "signedReport",
          "type": "bytes"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "lastRewardPublication",
      "discriminator": [
        68,
        94,
        13,
        158,
        10,
        170,
        210,
        19
      ]
    },
    {
      "name": "rewardPublicationRecord",
      "discriminator": [
        14,
        255,
        200,
        163,
        4,
        215,
        176,
        13
      ]
    },
    {
      "name": "stakeConfig",
      "discriminator": [
        238,
        151,
        43,
        3,
        11,
        151,
        63,
        176
      ]
    },
    {
      "name": "stakePriceConfig",
      "discriminator": [
        15,
        224,
        172,
        217,
        179,
        246,
        85,
        16
      ]
    },
    {
      "name": "stakeRewardConfig",
      "discriminator": [
        60,
        62,
        57,
        94,
        95,
        156,
        200,
        97
      ]
    },
    {
      "name": "stakeVaultTokenAccountConfig",
      "discriminator": [
        191,
        234,
        75,
        61,
        36,
        44,
        168,
        137
      ]
    },
    {
      "name": "unbondingTicket",
      "discriminator": [
        213,
        129,
        239,
        0,
        7,
        4,
        215,
        83
      ]
    }
  ],
  "events": [
    {
      "name": "depositEvent",
      "discriminator": [
        120,
        248,
        61,
        83,
        31,
        142,
        107,
        144
      ]
    },
    {
      "name": "lastRewardPublicationInitialized",
      "discriminator": [
        164,
        93,
        254,
        62,
        124,
        34,
        148,
        103
      ]
    },
    {
      "name": "lastRewardPublicationUpdated",
      "discriminator": [
        107,
        72,
        97,
        69,
        23,
        13,
        211,
        251
      ]
    },
    {
      "name": "maxPeriodRewardsUpdated",
      "discriminator": [
        245,
        61,
        87,
        19,
        14,
        58,
        227,
        112
      ]
    },
    {
      "name": "maxRewardBpsUpdated",
      "discriminator": [
        76,
        0,
        84,
        184,
        169,
        215,
        95,
        153
      ]
    },
    {
      "name": "maxTotalRewardsUpdated",
      "discriminator": [
        39,
        162,
        11,
        125,
        177,
        170,
        211,
        145
      ]
    },
    {
      "name": "priceInvalidated",
      "discriminator": [
        92,
        19,
        43,
        34,
        101,
        87,
        29,
        36
      ]
    },
    {
      "name": "priceVerifiedEvent",
      "discriminator": [
        128,
        255,
        236,
        58,
        89,
        102,
        99,
        234
      ]
    },
    {
      "name": "redeemEvent",
      "discriminator": [
        90,
        114,
        83,
        146,
        212,
        26,
        217,
        59
      ]
    },
    {
      "name": "rewardPeriodSecondsUpdated",
      "discriminator": [
        158,
        166,
        64,
        72,
        146,
        168,
        47,
        99
      ]
    },
    {
      "name": "rewardsPublished",
      "discriminator": [
        98,
        168,
        196,
        9,
        93,
        12,
        123,
        82
      ]
    }
  ],
  "errors": [
    {
      "code": 6001,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6002,
      "name": "invalidTokenReceived",
      "msg": "Invalid token received"
    },
    {
      "code": 6003,
      "name": "invalidVault",
      "msg": "Invalid vault"
    },
    {
      "code": 6004,
      "name": "invalidAuthority",
      "msg": "Invalid authority"
    },
    {
      "code": 6005,
      "name": "insufficientBalance",
      "msg": "Insufficient balance"
    },
    {
      "code": 6009,
      "name": "invalidMint",
      "msg": "Invalid mint provided"
    },
    {
      "code": 6010,
      "name": "invalidVaultMint",
      "msg": "Invalid vault mint provided"
    },
    {
      "code": 6012,
      "name": "invalidMintAuthority",
      "msg": "Invalid mint authority"
    },
    {
      "code": 6013,
      "name": "insufficientVaultBalance",
      "msg": "Insufficient vault balance"
    },
    {
      "code": 6014,
      "name": "invalidVaultAuthority",
      "msg": "Invalid vault authority"
    },
    {
      "code": 6015,
      "name": "invalidFreezeAuthority",
      "msg": "Invalid freeze authority"
    },
    {
      "code": 6016,
      "name": "invalidProgramData",
      "msg": "ProgramData account did not match expected PDA."
    },
    {
      "code": 6017,
      "name": "noUpgradeAuthority",
      "msg": "Program has no upgrade authority (set to None)."
    },
    {
      "code": 6018,
      "name": "invalidUpgradeAuthority",
      "msg": "Signer is not the upgrade authority."
    },
    {
      "code": 6019,
      "name": "missingSigner",
      "msg": "Signer account missing."
    },
    {
      "code": 6020,
      "name": "tooManyAdministrators",
      "msg": "Too many freeze administrators."
    },
    {
      "code": 6021,
      "name": "unauthorizedFreezeAdministrator",
      "msg": "Unauthorized freeze administrator"
    },
    {
      "code": 6025,
      "name": "invalidRewardsAdministrator",
      "msg": "Invalid rewards administrator"
    },
    {
      "code": 6026,
      "name": "vaultAndMintCannotBeSame",
      "msg": "Vault and mint cannot be the same"
    },
    {
      "code": 6027,
      "name": "protocolPaused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6029,
      "name": "invalidTokenOwner",
      "msg": "Invalid token owner"
    },
    {
      "code": 6030,
      "name": "invalidMintProgramOwner",
      "msg": "Invalid mint program owner"
    },
    {
      "code": 6031,
      "name": "depositTooSmall",
      "msg": "Deposit amount is too small - would not receive any stake tokens"
    },
    {
      "code": 6032,
      "name": "divisionByZero",
      "msg": "Division by zero error"
    },
    {
      "code": 6033,
      "name": "overflow",
      "msg": "Arithmetic overflow error"
    },
    {
      "code": 6034,
      "name": "invalidVaultTokenAccount",
      "msg": "Invalid vault token account"
    },
    {
      "code": 6035,
      "name": "priceNotInitialized",
      "msg": "Price has not been initialized; call verify_price first"
    },
    {
      "code": 6036,
      "name": "priceTooStale",
      "msg": "Stored price is too stale for deposit or redeem"
    },
    {
      "code": 6037,
      "name": "reportStale",
      "msg": "Chainlink report is outside its valid time window"
    },
    {
      "code": 6038,
      "name": "invalidFeedId",
      "msg": "Report feed ID does not match configured feed ID"
    },
    {
      "code": 6039,
      "name": "chainlinkVerifyFailed",
      "msg": "Chainlink verifier returned no report data"
    },
    {
      "code": 6040,
      "name": "futureReportValidFromTimestamp",
      "msg": "Chainlink report valid_from_timestamp is ahead of current time - retry later"
    },
    {
      "code": 6041,
      "name": "rewardExceedsMaxDelta",
      "msg": "Reward amount exceeds maximum allowed delta (max_reward_bps of total assets)"
    },
    {
      "code": 6042,
      "name": "invalidMaxRewardBps",
      "msg": "Invalid max reward BPS: must be greater than 0 and at most 10_000"
    },
    {
      "code": 6043,
      "name": "rewardCooldownNotElapsed",
      "msg": "Reward cooldown period has not elapsed"
    },
    {
      "code": 6044,
      "name": "exceedsPeriodRewardCap",
      "msg": "Reward amount exceeds maximum allowed period cap"
    },
    {
      "code": 6045,
      "name": "exceedsLifetimeRewardCap",
      "msg": "Reward amount exceeds remaining lifetime cap"
    },
    {
      "code": 6046,
      "name": "invalidRewardPeriodSeconds",
      "msg": "Invalid reward period: must be greater than 0 seconds"
    },
    {
      "code": 6047,
      "name": "invalidMaxPeriodRewards",
      "msg": "Invalid max period rewards: must be greater than 0"
    },
    {
      "code": 6048,
      "name": "invalidMaxTotalRewards",
      "msg": "Invalid max total rewards: must be greater than 0 and not below distributed total"
    },
    {
      "code": 6049,
      "name": "invalidReportTimestamps",
      "msg": "Chainlink report has invalid timestamp ordering (expected valid_from <= observations <= expires_at)"
    },
    {
      "code": 6050,
      "name": "observationTimestampNotIncreasing",
      "msg": "Report observations_timestamp must be strictly greater than the stored price_timestamp"
    },
    {
      "code": 6051,
      "name": "futureObservationTimestamp",
      "msg": "Chainlink report observations_timestamp is ahead of current time"
    },
    {
      "code": 6052,
      "name": "rewardPublicationIdNotMonotonic",
      "msg": "Reward publication id must be greater than the last published id"
    },
    {
      "code": 6053,
      "name": "rewardPublicationIdGapTooLarge",
      "msg": "Reward publication id gap from last published id exceeds MAX_GAP"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "freezeAdministrators",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "rewardsAdministrators",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "vaultAuthority",
            "type": "pubkey"
          },
          {
            "name": "redeemVault",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "allowedExternalMintProgram",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "depositEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "depositAmount",
            "type": "u64"
          },
          {
            "name": "mintedAmount",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "mintSupply",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "vaultBalance",
            "type": "u64"
          },
          {
            "name": "totalAssets",
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "totalsLastUpdateSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lastRewardPublication",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "lastRewardPublicationInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "startId",
            "type": "u32"
          },
          {
            "name": "stakeConfig",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "lastRewardPublicationUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldId",
            "type": "u32"
          },
          {
            "name": "newId",
            "type": "u32"
          },
          {
            "name": "stakeConfig",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "maxPeriodRewardsUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "oldValue",
            "type": "u64"
          },
          {
            "name": "newValue",
            "type": "u64"
          },
          {
            "name": "stakeConfig",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "maxRewardBpsUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "oldBps",
            "type": "u64"
          },
          {
            "name": "newBps",
            "type": "u64"
          },
          {
            "name": "stakeConfig",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "maxTotalRewardsUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "oldValue",
            "type": "u64"
          },
          {
            "name": "newValue",
            "type": "u64"
          },
          {
            "name": "stakeConfig",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "priceInvalidated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "priceScale",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "priceVerifiedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "i128"
          },
          {
            "name": "priceScale",
            "type": "u64"
          },
          {
            "name": "priceTimestamp",
            "docs": [
              "Report `observations_timestamp` (staleness anchor for deposit/redeem), not the verify tx time."
            ],
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "redeemEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "requestedMintAmount",
            "type": "u64"
          },
          {
            "name": "mintSupply",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "redeemedVaultAmount",
            "type": "u64"
          },
          {
            "name": "vaultBalance",
            "type": "u64"
          },
          {
            "name": "sharesBurned",
            "type": "u64"
          },
          {
            "name": "totalAssets",
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "totalsLastUpdateSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rewardPeriodSecondsUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "oldValue",
            "type": "i64"
          },
          {
            "name": "newValue",
            "type": "i64"
          },
          {
            "name": "stakeConfig",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "rewardPublicationRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u32"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "publishedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "rewardsPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mintProgram",
            "type": "pubkey"
          },
          {
            "name": "vaultTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "totalAssets",
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "totalsLastUpdateSlot",
            "type": "u64"
          },
          {
            "name": "id",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "stakeConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "unbondingPeriod",
            "type": "i64"
          },
          {
            "name": "freezeAdministrators",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "rewardsAdministrators",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "stakePriceConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "chainlinkProgram",
            "type": "pubkey"
          },
          {
            "name": "chainlinkVerifierAccount",
            "type": "pubkey"
          },
          {
            "name": "chainlinkAccessController",
            "type": "pubkey"
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "i128"
          },
          {
            "name": "priceScale",
            "type": "u64"
          },
          {
            "name": "priceTimestamp",
            "type": "i64"
          },
          {
            "name": "priceMaxStaleness",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "stakeRewardConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxRewardBps",
            "type": "u64"
          },
          {
            "name": "maxPeriodRewards",
            "type": "u64"
          },
          {
            "name": "rewardPeriodSeconds",
            "type": "i64"
          },
          {
            "name": "lastRewardDistributedAt",
            "type": "i64"
          },
          {
            "name": "maxTotalRewards",
            "type": "u64"
          },
          {
            "name": "totalRewardsDistributed",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "stakeVaultTokenAccountConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "vaultAuthority",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "unbondingTicket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "requestedAmount",
            "type": "u64"
          },
          {
            "name": "startBalance",
            "type": "u64"
          },
          {
            "name": "startTs",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
