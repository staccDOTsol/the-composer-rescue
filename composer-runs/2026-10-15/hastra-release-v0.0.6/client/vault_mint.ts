/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/vault_mint.json`.
 */
export type VaultMint = {
  "address": "9WUyNREiPDMgwMh5Gt81Fd3JpiCKxpjZ5Dpq9Bo1RhMV",
  "metadata": {
    "name": "vaultMint",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Solana Vault Mint Contract for Hastra"
  },
  "instructions": [
    {
      "name": "cancelRedeem",
      "docs": [
        "Lets a user withdraw their own pending redemption request:",
        "- Clears the burn delegate granted by `request_redeem`, if still set to that authority",
        "- Closes the request account, refunding its rent to the user",
        "",
        "Needed because `complete_redeem` requires the full requested amount to still be held, so a",
        "user who moved their mint tokens after requesting can clear the stale request and submit a",
        "new one."
      ],
      "discriminator": [
        111,
        76,
        232,
        50,
        39,
        175,
        48,
        242
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "userMintTokenAccount",
          "writable": true
        },
        {
          "name": "redemptionRequest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
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
          "name": "redeemVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  101,
                  109,
                  95,
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
          "name": "config",
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
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "claimRewards",
      "docs": [
        "This is the classic “airdrop/claim per epoch” design",
        "High-level idea:",
        "1.\tOff-chain (admin does this each epoch):",
        "•\tCalculate each user’s reward for this epoch.",
        "•\tBuild a Merkle tree of (user, amount, epoch_index).",
        "•\tPublish the Merkle root on-chain with the create_rewards_epoch function above.",
        "",
        "2.\tOn-chain:",
        "•\tStore each epoch’s Merkle root in a PDA.",
        "•\tWhen a user claims, they present (amount, proof) for their pubkey.",
        "•\tThe program verifies the Merkle proof against the root.",
        "•\tIf valid, mint reward tokens (wYLDS) to the user's mint token account.",
        "•\tMark the claim as redeemed so they can’t double-claim.",
        "•   Epochs with `index >= first_capped_epoch` also enforce the aggregate claim cap."
      ],
      "discriminator": [
        4,
        144,
        132,
        71,
        116,
        23,
        151,
        80
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "epoch",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "rewardsEpoch"
              }
            ]
          }
        },
        {
          "name": "epochCapsConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  99,
                  97,
                  112,
                  115,
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
          "name": "epochClaimed",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  99,
                  108,
                  97,
                  105,
                  109,
                  101,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "epoch.index",
                "account": "rewardsEpoch"
              }
            ]
          }
        },
        {
          "name": "claimRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "epoch"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "mint",
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
          "name": "userMintTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        }
      ]
    },
    {
      "name": "completeRedeem",
      "docs": [
        "Settles a pending redemption request, burning the user's mint tokens and paying out the",
        "corresponding vault tokens. Only callable by a rewards administrator.",
        "",
        "`expected_amount` must equal the amount recorded on the request, failing with",
        "`RedemptionAmountMismatch` otherwise. The request PDA is keyed on the user alone, so a user",
        "can cancel a reviewed request and open a replacement for a different amount at the same",
        "address; restating the approved amount keeps an already-signed completion bound to the",
        "request that was reviewed."
      ],
      "discriminator": [
        234,
        40,
        26,
        254,
        202,
        90,
        42,
        209
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "user",
          "docs": [
            "The original user (to validate and to receive close rent)",
            "(Not required to be a signer here.)",
            "must be writeable to close the account = user will transfer rent to user"
          ],
          "writable": true
        },
        {
          "name": "redemptionRequest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "userMintTokenAccount",
          "writable": true
        },
        {
          "name": "userVaultTokenAccount",
          "writable": true
        },
        {
          "name": "redeemVaultTokenAccount",
          "writable": true
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "redeemVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  101,
                  109,
                  95,
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
          "name": "config",
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
          "name": "expectedAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createRewardsEpoch",
      "discriminator": [
        64,
        195,
        84,
        28,
        247,
        167,
        132,
        46
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "epochCapsConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  99,
                  97,
                  112,
                  115,
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
          "name": "lastRewardsEpoch",
          "docs": [
            "Contiguous-index counter — the only account create is allowed to mutate for succession."
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
                  115,
                  95,
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        },
        {
          "name": "epochClaimed",
          "docs": [
            "Cumulative claim counter for this epoch."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  99,
                  108,
                  97,
                  105,
                  109,
                  101,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u64"
        },
        {
          "name": "merkleRoot",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "total",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "Handles user deposits of vault tokens (e.g., USDC):",
        "- Transfers vault tokens to program vault account",
        "- Mints equivalent amount of mint tokens (e.g., wYLDS) to user"
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
          "name": "config",
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
            ]
          }
        },
        {
          "name": "vaultTokenAccountConfig",
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
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "mint",
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
      "name": "externalProgramMint",
      "docs": [
        "Allows an external authorized program to mint tokens to a specified account.",
        "The calling_program account identifies the CPI caller; it must match either",
        "config.allowed_external_mint_program (legacy) or be listed in the",
        "allowed_external_mint_programs PDA (registered via register_allowed_external_mint_program)."
      ],
      "discriminator": [
        97,
        91,
        212,
        77,
        203,
        242,
        83,
        216
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "callingProgram",
          "docs": [
            "The program making this CPI call. Must be authorized via config.allowed_external_mint_program",
            "(legacy single-program field) or registered in the allowed_external_mint_programs PDA.",
            "Passing the caller's program as an explicit account allows the seeds constraint on",
            "external_mint_authority below to bind to it, cryptographically proving CPI origin."
          ]
        },
        {
          "name": "externalMintAuthority",
          "docs": [
            "PDA from the calling program that proves CPI origin. Anchor verifies that this",
            "account's address is derived from [b\"external_mint_authority\"] under calling_program's",
            "program id. Only calling_program can produce a valid signer for this PDA, so a valid",
            "signature here proves the CPI came from calling_program and not an impersonator."
          ],
          "signer": true,
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
            ],
            "program": {
              "kind": "account",
              "path": "callingProgram"
            }
          }
        },
        {
          "name": "mint",
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
          "name": "admin",
          "docs": [
            "The rewards administrator who authorized this mint operation.",
            "Must sign the outer transaction; that signer status is preserved across CPI so",
            "vault-mint can independently verify authorization (not just list membership).",
            "The calling program's `external_mint_authority` PDA remains the CPI program signer."
          ],
          "signer": true
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "allowedExternalMintPrograms",
          "docs": [
            "Additional allowed programs PDA. When calling_program does not match the legacy",
            "config.allowed_external_mint_program field, the processor checks this account.",
            "This account is required in the instruction, so it must already exist on-chain",
            "(e.g. created during program upgrade / migration via",
            "register_allowed_external_mint_program, which uses init_if_needed) before callers",
            "invoke external_program_mint. Until any programs are registered, account data may",
            "be empty or too short to deserialize; the processor then treats the extended list",
            "as empty and authorization falls through to the legacy field only."
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
                "path": "config"
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
          "name": "config",
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
        "- vault_mint: The token that users deposit (e.g., USDC)",
        "- mint: The token users receive when deposit received (e.g., wYLDS)",
        "- freeze_administrators: List of pubkeys authorized to freeze/thaw token accounts",
        "- rewards_administrators: List of pubkeys authorized to create rewards epochs",
        "- allowed_external_mint_program: An external program authorized to mint tokens"
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
          "name": "config",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "vaultTokenAccountConfig",
          "writable": true,
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
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount"
        },
        {
          "name": "redeemVaultAuthority",
          "docs": [
            "This PDA will be set as the owner of the redeem_vault_token_account in the config",
            "The redeem vault token account holds the deposited vault tokens (e.g., USDC)",
            "and is controlled by this program via the redeem_vault_authority PDA",
            "This ensures that only this program can move tokens out of the redeem vault",
            "and prevents unauthorized access."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  101,
                  109,
                  95,
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
          "name": "redeemVaultTokenAccount",
          "writable": true
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
        },
        {
          "name": "allowedExternalMintProgram"
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
      "name": "initializeEpochCaps",
      "docs": [
        "One-shot: enables epoch caps (upgrade authority).",
        "Must be executed after program upgrade before create/claim rewards.",
        "Sets `first_capped_epoch` and `max_epoch_cap`. Epochs already created below that",
        "index stay uncapped; new epochs cannot be created there. Contiguous create indices",
        "are enforced separately by `LastRewardsEpoch` (see `initialize_last_rewards_epoch`)."
      ],
      "discriminator": [
        228,
        215,
        109,
        123,
        201,
        178,
        71,
        102
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "epochCapsConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  99,
                  97,
                  112,
                  115,
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
          "name": "firstCappedEpoch",
          "type": "u64"
        },
        {
          "name": "maxEpochCap",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeLastRewardsEpoch",
      "docs": [
        "Creates the LastRewardsEpoch PDA, seeding the index floor for create_rewards_epoch.",
        "Must be called once before create can succeed. Only callable by the program upgrade",
        "authority. Requires epoch caps already initialized; rejects a floor that would deadlock",
        "create (`start_index + 1 < first_capped_epoch`). Subsequent creates must use exact",
        "succession (`start_index + 1`, then contiguous)."
      ],
      "discriminator": [
        62,
        183,
        49,
        237,
        62,
        251,
        132,
        128
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "epochCapsConfig",
          "docs": [
            "Cap boundary used to reject a start_index that would brick create_rewards_epoch."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  99,
                  97,
                  112,
                  115,
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
          "name": "lastRewardsEpoch",
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
                  115,
                  95,
                  101,
                  112,
                  111,
                  99,
                  104
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
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "startIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "pause",
      "docs": [
        "Pauses or unpauses the program, disabling or enabling deposit and redeem functions."
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
          "name": "config",
          "writable": true,
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
      "name": "registerAllowedExternalMintProgram",
      "docs": [
        "Registers an additional external program as authorized to call external_program_mint.",
        "Creates the AllowedExternalMintPrograms PDA on first call (init_if_needed).",
        "Idempotent: calling with an already-registered program is a no-op.",
        "The active cap is controlled via update_external_mint_programs_limit.",
        "Only callable by the program upgrade authority."
      ],
      "discriminator": [
        70,
        2,
        197,
        60,
        140,
        188,
        178,
        182
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "allowedExternalMintPrograms",
          "writable": true,
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
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "externalMintProgramsLimitConfig",
          "writable": true,
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
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  115,
                  95,
                  108,
                  105,
                  109,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "externalProgram"
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
      "name": "requestRedeem",
      "docs": [
        "The redeem function allows users to withdraw their original vault tokens:",
        "- Transfers vault tokens from a program vault account to user",
        "- Burns the corresponding amount of mint tokens (e.g., wYLDS) from user"
      ],
      "discriminator": [
        105,
        49,
        44,
        38,
        207,
        241,
        33,
        173
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "userMintTokenAccount",
          "writable": true
        },
        {
          "name": "redemptionRequest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
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
          "name": "redeemVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  101,
                  109,
                  95,
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
          "name": "mint"
        },
        {
          "name": "config",
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
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sweepRedeemVaultFunds",
      "discriminator": [
        69,
        225,
        49,
        108,
        45,
        78,
        232,
        22
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "vaultTokenAccountConfig",
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
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "redeemVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  101,
                  109,
                  95,
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
          "name": "redeemVaultTokenAccount",
          "writable": true
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
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
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
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
          "name": "config",
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
      "name": "updateExternalMintProgramsLimit",
      "docs": [
        "Updates the cap enforced by register_allowed_external_mint_program.",
        "Only callable by the program upgrade authority."
      ],
      "discriminator": [
        185,
        146,
        147,
        89,
        233,
        76,
        134,
        111
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "externalMintProgramsLimitConfig",
          "writable": true,
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
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  115,
                  95,
                  108,
                  105,
                  109,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "config"
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
          "name": "maxPrograms",
          "type": "u8"
        }
      ]
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
          "name": "config",
          "writable": true,
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
      "name": "updateLastRewardsEpoch",
      "docs": [
        "Corrects the LastRewardsEpoch floor (upgrade authority). Recovery when start_index was",
        "seeded wrongly; enforces the same first_capped_epoch check as init."
      ],
      "discriminator": [
        145,
        199,
        138,
        121,
        29,
        190,
        254,
        23
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "epochCapsConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  99,
                  97,
                  112,
                  115,
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
          "name": "lastRewardsEpoch",
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
                  115,
                  95,
                  101,
                  112,
                  111,
                  99,
                  104
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
          "name": "programData"
        }
      ],
      "args": [
        {
          "name": "newIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateMaxEpochCap",
      "docs": [
        "Updates the global max epoch cap (upgrade authority). Affects future creates only."
      ],
      "discriminator": [
        20,
        227,
        178,
        49,
        65,
        222,
        35,
        97
      ],
      "accounts": [
        {
          "name": "config",
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
            ]
          }
        },
        {
          "name": "epochCapsConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  99,
                  97,
                  112,
                  115,
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
      "name": "updateRedeemVault",
      "docs": [
        "Sets `config.redeem_vault` to a PDA-owned vault-mint token account.",
        "Call once after upgrade on deployments initialized before this field was written."
      ],
      "discriminator": [
        148,
        163,
        195,
        24,
        176,
        24,
        101,
        228
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "redeemVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  101,
                  109,
                  95,
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
          "name": "redeemVaultTokenAccount"
        },
        {
          "name": "programData"
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
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
          "name": "config",
          "writable": true,
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
      "name": "updateVaultTokenAccount",
      "discriminator": [
        6,
        235,
        60,
        188,
        135,
        20,
        190,
        42
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
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
            ]
          }
        },
        {
          "name": "vaultTokenAccountConfig",
          "writable": true,
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
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "programData"
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "allowedExternalMintPrograms",
      "discriminator": [
        192,
        42,
        202,
        248,
        190,
        36,
        104,
        127
      ]
    },
    {
      "name": "claimRecord",
      "discriminator": [
        57,
        229,
        0,
        9,
        65,
        62,
        96,
        7
      ]
    },
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
      "name": "epochCapsConfig",
      "discriminator": [
        235,
        193,
        228,
        33,
        206,
        113,
        182,
        93
      ]
    },
    {
      "name": "epochClaimedAmount",
      "discriminator": [
        103,
        100,
        251,
        230,
        115,
        109,
        29,
        33
      ]
    },
    {
      "name": "externalMintProgramsLimitConfig",
      "discriminator": [
        1,
        51,
        9,
        234,
        170,
        165,
        103,
        222
      ]
    },
    {
      "name": "lastRewardsEpoch",
      "discriminator": [
        15,
        25,
        115,
        99,
        184,
        179,
        162,
        235
      ]
    },
    {
      "name": "redemptionRequest",
      "discriminator": [
        117,
        157,
        214,
        214,
        64,
        160,
        31,
        58
      ]
    },
    {
      "name": "rewardsEpoch",
      "discriminator": [
        19,
        164,
        140,
        222,
        83,
        245,
        249,
        74
      ]
    },
    {
      "name": "vaultTokenAccountConfig",
      "discriminator": [
        135,
        236,
        42,
        15,
        53,
        240,
        115,
        173
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
      "name": "externalProgramMintEvent",
      "discriminator": [
        203,
        36,
        160,
        37,
        198,
        195,
        30,
        139
      ]
    },
    {
      "name": "firstCappedEpochSet",
      "discriminator": [
        82,
        107,
        159,
        136,
        2,
        176,
        190,
        214
      ]
    },
    {
      "name": "lastRewardsEpochInitialized",
      "discriminator": [
        189,
        34,
        84,
        252,
        20,
        173,
        68,
        180
      ]
    },
    {
      "name": "lastRewardsEpochUpdated",
      "discriminator": [
        46,
        184,
        163,
        113,
        161,
        5,
        238,
        203
      ]
    },
    {
      "name": "maxEpochCapUpdated",
      "discriminator": [
        169,
        249,
        144,
        166,
        137,
        247,
        153,
        105
      ]
    },
    {
      "name": "redeemCompleted",
      "discriminator": [
        28,
        209,
        89,
        218,
        229,
        197,
        84,
        47
      ]
    },
    {
      "name": "redemptionCancelled",
      "discriminator": [
        22,
        106,
        118,
        26,
        83,
        110,
        71,
        174
      ]
    },
    {
      "name": "redemptionRequested",
      "discriminator": [
        245,
        155,
        98,
        131,
        210,
        25,
        137,
        146
      ]
    },
    {
      "name": "rewardsClaimed",
      "discriminator": [
        75,
        98,
        88,
        18,
        219,
        112,
        88,
        121
      ]
    },
    {
      "name": "rewardsEpochCreated",
      "discriminator": [
        169,
        9,
        209,
        76,
        187,
        249,
        236,
        27
      ]
    },
    {
      "name": "sweepRedeemVaultEvent",
      "discriminator": [
        159,
        7,
        91,
        162,
        250,
        119,
        71,
        176
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
      "name": "invalidAuthority",
      "msg": "Invalid authority"
    },
    {
      "code": 6003,
      "name": "insufficientBalance",
      "msg": "Insufficient balance"
    },
    {
      "code": 6004,
      "name": "invalidMint",
      "msg": "Invalid mint provided"
    },
    {
      "code": 6005,
      "name": "invalidVaultMint",
      "msg": "Invalid vault mint provided"
    },
    {
      "code": 6006,
      "name": "invalidMintAuthority",
      "msg": "Invalid mint authority"
    },
    {
      "code": 6007,
      "name": "insufficientVaultBalance",
      "msg": "Insufficient vault balance"
    },
    {
      "code": 6008,
      "name": "invalidVaultAuthority",
      "msg": "Invalid vault authority"
    },
    {
      "code": 6009,
      "name": "invalidFreezeAuthority",
      "msg": "Invalid freeze authority"
    },
    {
      "code": 6010,
      "name": "invalidProgramData",
      "msg": "ProgramData account did not match expected PDA."
    },
    {
      "code": 6011,
      "name": "noUpgradeAuthority",
      "msg": "Program has no upgrade authority (set to None)."
    },
    {
      "code": 6012,
      "name": "invalidUpgradeAuthority",
      "msg": "Signer is not the upgrade authority."
    },
    {
      "code": 6013,
      "name": "missingSigner",
      "msg": "Signer account missing."
    },
    {
      "code": 6014,
      "name": "tooManyAdministrators",
      "msg": "Too many freeze administrators."
    },
    {
      "code": 6015,
      "name": "unauthorizedFreezeAdministrator",
      "msg": "Unauthorized freeze administrator"
    },
    {
      "code": 6016,
      "name": "invalidRewardsEpoch",
      "msg": "Invalid rewards epoch"
    },
    {
      "code": 6017,
      "name": "invalidMerkleProof",
      "msg": "Invalid merkle proof"
    },
    {
      "code": 6018,
      "name": "rewardsAlreadyClaimed",
      "msg": "Rewards already claimed for this epoch"
    },
    {
      "code": 6019,
      "name": "invalidRewardsAdministrator",
      "msg": "Invalid rewards administrator"
    },
    {
      "code": 6020,
      "name": "invalidTokenOwner",
      "msg": "Invalid token owner"
    },
    {
      "code": 6021,
      "name": "alreadyFulfilled",
      "msg": "Redemption request already fulfilled"
    },
    {
      "code": 6022,
      "name": "requestNotFound",
      "msg": "Redemption request not found"
    },
    {
      "code": 6023,
      "name": "insufficientRedeemVaultFunds",
      "msg": "Insufficient lamport funds in redeem vault"
    },
    {
      "code": 6024,
      "name": "requestAlreadyExists",
      "msg": "Redeem request already exists"
    },
    {
      "code": 6025,
      "name": "vaultAndMintCannotBeSame",
      "msg": "Vault and mint cannot be the same"
    },
    {
      "code": 6026,
      "name": "protocolPaused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6027,
      "name": "invalidMintProgramCaller",
      "msg": "Invalid program calling mint"
    },
    {
      "code": 6028,
      "name": "insufficientRedemptionBalance",
      "msg": "Insufficient mint token balance to cover redemption request"
    },
    {
      "code": 6034,
      "name": "invalidVaultTokenAccount",
      "msg": "Invalid vault token account"
    },
    {
      "code": 6029,
      "name": "tooManyAllowedExternalMintPrograms",
      "msg": "Too many allowed external mint programs."
    },
    {
      "code": 6035,
      "name": "invalidAllowedExternalMintProgramsLimit",
      "msg": "Invalid allowed external mint programs limit."
    },
    {
      "code": 6036,
      "name": "epochCapExceeded",
      "msg": "Claim would exceed the epoch's aggregate reward cap"
    },
    {
      "code": 6037,
      "name": "emptyAdministrators",
      "msg": "Administrator list must not be empty"
    },
    {
      "code": 6038,
      "name": "duplicateAdministrators",
      "msg": "Administrator list contains duplicate keys"
    },
    {
      "code": 6039,
      "name": "depositSelfTransfer",
      "msg": "Deposit source and vault token accounts must differ"
    },
    {
      "code": 6040,
      "name": "epochCapAboveGlobal",
      "msg": "Declared epoch total exceeds the global max epoch cap"
    },
    {
      "code": 6041,
      "name": "invalidGlobalCap",
      "msg": "Global epoch cap must be non-zero"
    },
    {
      "code": 6043,
      "name": "capsNotInitialized",
      "msg": "Epoch caps have not been initialized"
    },
    {
      "code": 6044,
      "name": "epochClaimedRequired",
      "msg": "Epoch claimed account required for capped epoch claim"
    },
    {
      "code": 6045,
      "name": "epochIndexBelowFirstCapped",
      "msg": "Epoch index is below first_capped_epoch and reserved for pre-upgrade epochs"
    },
    {
      "code": 6046,
      "name": "redemptionAmountMismatch",
      "msg": "Redemption request amount does not match the amount the administrator approved"
    },
    {
      "code": 6047,
      "name": "epochIndexNotContiguous",
      "msg": "Epoch index must equal last accepted index + 1"
    },
    {
      "code": 6048,
      "name": "invalidRedeemVault",
      "msg": "Redeem vault token account does not match config.redeem_vault"
    }
  ],
  "types": [
    {
      "name": "allowedExternalMintPrograms",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "programs",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "claimRecord",
      "type": {
        "kind": "struct",
        "fields": []
      }
    },
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
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "epochCapsConfig",
      "docs": [
        "Global configuration for rewards epoch caps."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxEpochCap",
            "docs": [
              "Ceiling on `create_rewards_epoch.total` for future epochs."
            ],
            "type": "u64"
          },
          {
            "name": "firstCappedEpoch",
            "docs": [
              "Epochs with `index >= first_capped_epoch` enforce aggregate claim caps.",
              "Lower indices only require a valid Merkle proof and `ClaimRecord`, and are",
              "reserved for epochs created before the caps upgrade: `create_rewards_epoch`",
              "rejects any index below this boundary."
            ],
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
      "name": "epochClaimedAmount",
      "docs": [
        "Tracks cumulative wYLDS minted via `claim_rewards` for one epoch."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "claimedTotal",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "externalMintProgramsLimitConfig",
      "docs": [
        "Stores the active registration cap for allowed external mint programs.",
        "Kept in a separate PDA to avoid reallocating the legacy Config account."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxPrograms",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "externalProgramMintEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "firstCappedEpochSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epochIndex",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lastRewardsEpoch",
      "docs": [
        "Singleton tracking the highest rewards-epoch index accepted so far.",
        "Separated from `EpochCapsConfig` so create cannot mutate cap fields — only this counter.",
        "Must be initialized before `create_rewards_epoch`; each create requires `index == last + 1`.",
        "Init and `update_last_rewards_epoch` both require `index + 1 >= first_capped_epoch` so the",
        "succession counter cannot deadlock against the cap boundary."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "docs": [
              "Highest accepted epoch index so far (floor for the next create)."
            ],
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
      "name": "lastRewardsEpochInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "startIndex",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lastRewardsEpochUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldIndex",
            "type": "u64"
          },
          {
            "name": "newIndex",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "maxEpochCapUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldCap",
            "type": "u64"
          },
          {
            "name": "newCap",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "proofNode",
      "docs": [
        "One Merkle proof element."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sibling",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "isLeft",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "redeemCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "redemptionCancelled",
      "docs": [
        "Emitted when a user withdraws their own pending redemption request before it is completed."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "docs": [
              "Amount the cancelled request had reserved for burning."
            ],
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "redemptionRequest",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mint",
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
      "name": "redemptionRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "vaultTokenMint",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "rewardsClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "rewardsEpoch",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "merkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "total",
            "docs": [
              "Declared epoch reward budget. Binding for epochs at or after `first_capped_epoch`."
            ],
            "type": "u64"
          },
          {
            "name": "createdTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rewardsEpochCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "merkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "total",
            "type": "u64"
          },
          {
            "name": "createdTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "sweepRedeemVaultEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "vaultTokenAccountConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
