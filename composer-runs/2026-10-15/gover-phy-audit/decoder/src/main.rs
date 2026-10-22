use std::{collections::BTreeMap, fs, path::PathBuf};

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use borsh::BorshDeserialize;
use serde::Deserialize;
use serde_json::{json, Value};
use spl_governance::{
    state::{
        enums::GovernanceAccountType,
        governance::GovernanceV2,
        proposal::ProposalV2,
        proposal_transaction::ProposalTransactionV2,
        proposal_versioned_transaction::ProposalVersionedTransaction,
        realm::RealmV2,
        realm_config::RealmConfigAccount,
        token_owner_record::TokenOwnerRecordV2,
    },
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcAccount {
    data: (String, String),
    owner: String,
    executable: bool,
    lamports: u64,
    #[serde(default)]
    space: Option<u64>,
}

#[derive(Deserialize)]
struct Record {
    pubkey: String,
    account: RpcAccount,
}

fn decode<T: BorshDeserialize>(account: &RpcAccount) -> Result<T> {
    let bytes = STANDARD.decode(&account.data.0)?;
    let mut view = bytes.as_slice();
    T::deserialize(&mut view).map_err(Into::into)
}

fn account_type(account: &RpcAccount) -> Result<GovernanceAccountType> {
    let bytes = STANDARD.decode(&account.data.0)?;
    let mut view = bytes.as_slice();
    GovernanceAccountType::deserialize(&mut view).map_err(Into::into)
}

fn option_i64(value: Option<i64>) -> Value {
    value.map_or(Value::Null, |item| json!(item))
}

fn option_u64(value: Option<u64>) -> Value {
    value.map_or(Value::Null, |item| json!(item.to_string()))
}

fn decode_governance(address: &str, account: &RpcAccount) -> Result<Value> {
    let data: GovernanceV2 = decode(account)?;
    Ok(json!({
        "address": address,
        "owner": account.owner,
        "executable": account.executable,
        "lamports": account.lamports,
        "space": account.space,
        "accountType": format!("{:?}", data.account_type),
        "realm": data.realm.to_string(),
        "governedAccount": data.governed_account.to_string(),
        "config": {
            "communityVoteThreshold": format!("{:?}", data.config.community_vote_threshold),
            "minCommunityWeightToCreateProposal": data.config.min_community_weight_to_create_proposal.to_string(),
            "minTransactionHoldUpTime": data.config.min_transaction_hold_up_time,
            "votingBaseTime": data.config.voting_base_time,
            "communityVoteTipping": format!("{:?}", data.config.community_vote_tipping),
            "councilVoteThreshold": format!("{:?}", data.config.council_vote_threshold),
            "councilVetoVoteThreshold": format!("{:?}", data.config.council_veto_vote_threshold),
            "minCouncilWeightToCreateProposal": data.config.min_council_weight_to_create_proposal.to_string(),
            "councilVoteTipping": format!("{:?}", data.config.council_vote_tipping),
            "communityVetoVoteThreshold": format!("{:?}", data.config.community_veto_vote_threshold),
            "votingCoolOffTime": data.config.voting_cool_off_time,
            "depositExemptProposalCount": data.config.deposit_exempt_proposal_count,
        },
        "requiredSignatoriesCount": data.required_signatories_count,
        "activeProposalCount": data.active_proposal_count.to_string(),
    }))
}

fn decode_realm(address: &str, account: &RpcAccount) -> Result<Value> {
    let data: RealmV2 = decode(account)?;
    Ok(json!({
        "address": address,
        "owner": account.owner,
        "lamports": account.lamports,
        "space": account.space,
        "accountType": format!("{:?}", data.account_type),
        "communityMint": data.community_mint.to_string(),
        "config": {
            "legacy1": data.config.legacy1,
            "legacy2": data.config.legacy2,
            "minCommunityWeightToCreateGovernance": data.config.min_community_weight_to_create_governance.to_string(),
            "communityMintMaxVoterWeightSource": format!("{:?}", data.config.community_mint_max_voter_weight_source),
            "councilMint": data.config.council_mint.map(|key| key.to_string()),
        },
        "authority": data.authority.map(|key| key.to_string()),
        "name": data.name,
    }))
}

fn token_config_json(data: &spl_governance::state::realm_config::GoverningTokenConfig) -> Value {
    json!({
        "voterWeightAddin": data.voter_weight_addin.map(|key| key.to_string()),
        "maxVoterWeightAddin": data.max_voter_weight_addin.map(|key| key.to_string()),
        "tokenType": format!("{:?}", data.token_type),
    })
}

fn decode_realm_config(address: &str, account: &RpcAccount) -> Result<Value> {
    let data: RealmConfigAccount = decode(account)?;
    Ok(json!({
        "address": address,
        "owner": account.owner,
        "lamports": account.lamports,
        "space": account.space,
        "accountType": format!("{:?}", data.account_type),
        "realm": data.realm.to_string(),
        "communityTokenConfig": token_config_json(&data.community_token_config),
        "councilTokenConfig": token_config_json(&data.council_token_config),
    }))
}

fn decode_token_owner_record(record: &Record) -> Result<Value> {
    let data: TokenOwnerRecordV2 = decode(&record.account)?;
    Ok(json!({
        "address": record.pubkey,
        "owner": record.account.owner,
        "space": record.account.space,
        "accountType": format!("{:?}", data.account_type),
        "realm": data.realm.to_string(),
        "governingTokenMint": data.governing_token_mint.to_string(),
        "governingTokenOwner": data.governing_token_owner.to_string(),
        "governingTokenDepositAmount": data.governing_token_deposit_amount.to_string(),
        "unrelinquishedVotesCount": data.unrelinquished_votes_count.to_string(),
        "outstandingProposalCount": data.outstanding_proposal_count,
        "version": data.version,
        "governanceDelegate": data.governance_delegate.map(|key| key.to_string()),
    }))
}

fn decode_proposal(record: &Record, governance: &str) -> Result<Value> {
    let data: ProposalV2 = decode(&record.account)?;
    Ok(json!({
        "address": record.pubkey,
        "owner": record.account.owner,
        "space": record.account.space,
        "accountType": format!("{:?}", data.account_type),
        "expectedGovernance": governance,
        "governance": data.governance.to_string(),
        "governingTokenMint": data.governing_token_mint.to_string(),
        "state": format!("{:?}", data.state),
        "tokenOwnerRecord": data.token_owner_record.to_string(),
        "signatoriesCount": data.signatories_count,
        "signatoriesSignedOffCount": data.signatories_signed_off_count,
        "voteType": format!("{:?}", data.vote_type),
        "options": data.options.iter().map(|option| json!({
            "label": option.label,
            "voteWeight": option.vote_weight.to_string(),
            "voteResult": format!("{:?}", option.vote_result),
            "transactionsExecutedCount": option.transactions_executed_count,
            "transactionsCount": option.transactions_count,
            "transactionsNextIndex": option.transactions_next_index,
        })).collect::<Vec<_>>(),
        "denyVoteWeight": option_u64(data.deny_vote_weight),
        "abstainVoteWeight": option_u64(data.abstain_vote_weight),
        "startVotingAt": option_i64(data.start_voting_at),
        "draftAt": data.draft_at,
        "signingOffAt": option_i64(data.signing_off_at),
        "votingAt": option_i64(data.voting_at),
        "votingAtSlot": option_u64(data.voting_at_slot),
        "votingCompletedAt": option_i64(data.voting_completed_at),
        "executingAt": option_i64(data.executing_at),
        "closedAt": option_i64(data.closed_at),
        "executionFlags": format!("{:?}", data.execution_flags),
        "maxVoteWeight": option_u64(data.max_vote_weight),
        "maxVotingTime": data.max_voting_time,
        "voteThreshold": data.vote_threshold.map(|value| format!("{:?}", value)),
        "name": data.name,
        "descriptionLink": data.description_link,
        "vetoVoteWeight": data.veto_vote_weight.to_string(),
    }))
}

fn decode_legacy_transaction(record: &Record) -> Result<Value> {
    let data: ProposalTransactionV2 = decode(&record.account)?;
    Ok(json!({
        "address": record.pubkey,
        "accountType": format!("{:?}", data.account_type),
        "proposal": data.proposal.to_string(),
        "optionIndex": data.option_index,
        "transactionIndex": data.transaction_index,
        "holdUpTime": data.hold_up_time,
        "executedAt": option_i64(data.executed_at),
        "executionStatus": format!("{:?}", data.execution_status),
        "instructions": data.instructions.iter().map(|instruction| json!({
            "programId": instruction.program_id.to_string(),
            "accounts": instruction.accounts.iter().map(|meta| json!({
                "pubkey": meta.pubkey.to_string(),
                "isSigner": meta.is_signer,
                "isWritable": meta.is_writable,
            })).collect::<Vec<_>>(),
            "dataBase64": STANDARD.encode(&instruction.data),
            "dataHex": hex_string(&instruction.data),
        })).collect::<Vec<_>>(),
    }))
}

fn decode_versioned_transaction(record: &Record) -> Result<Value> {
    let data: ProposalVersionedTransaction = decode(&record.account)?;
    Ok(json!({
        "address": record.pubkey,
        "accountType": format!("{:?}", data.account_type),
        "proposal": data.proposal.to_string(),
        "optionIndex": data.option_index,
        "transactionIndex": data.transaction_index,
        "executionIndex": data.execution_index,
        "executedAt": option_i64(data.executed_at),
        "executionStatus": format!("{:?}", data.execution_status),
        "ephemeralSignerBumps": data.ephemeral_signer_bumps,
        "message": {
            "numSigners": data.message.num_signers,
            "numWritableSigners": data.message.num_writable_signers,
            "numWritableNonSigners": data.message.num_writable_non_signers,
            "accountKeys": data.message.account_keys.iter().map(ToString::to_string).collect::<Vec<_>>(),
            "instructions": data.message.instructions.iter().map(|instruction| json!({
                "programIdIndex": instruction.program_id_index,
                "accountIndexes": instruction.account_indexes,
                "dataBase64": STANDARD.encode(&instruction.data),
                "dataHex": hex_string(&instruction.data),
            })).collect::<Vec<_>>(),
            "addressTableLookups": data.message.address_table_lookups.iter().map(|lookup| json!({
                "accountKey": lookup.account_key.to_string(),
                "writableIndexes": lookup.writable_indexes,
                "readonlyIndexes": lookup.readonly_indexes,
            })).collect::<Vec<_>>(),
        },
    }))
}

fn hex_string(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0xf) as usize] as char);
    }
    output
}

fn main() -> Result<()> {
    let audit_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
    let args = std::env::args().collect::<Vec<_>>();
    let raw_name = args.get(1).map(String::as_str).unwrap_or("governance-graph-raw.json");
    let output_name = args.get(2).map(String::as_str).unwrap_or("governance-graph-decoded.json");
    let raw: Value = serde_json::from_str(&fs::read_to_string(audit_dir.join(raw_name))?)?;
    let target_accounts: BTreeMap<String, RpcAccount> =
        serde_json::from_value(raw["governanceFetch"]["accounts"].clone())?;

    let governances = target_accounts
        .iter()
        .map(|(address, account)| decode_governance(address, account))
        .collect::<Result<Vec<_>>>()?;

    let realm_accounts: BTreeMap<String, RpcAccount> = serde_json::from_value(raw["realmFetch"]["accounts"].clone())?;
    let realms = realm_accounts
        .iter()
        .map(|(address, account)| decode_realm(address, account))
        .collect::<Result<Vec<_>>>()?;

    let related_accounts: BTreeMap<String, RpcAccount> = serde_json::from_value(raw["relatedFetch"]["accounts"].clone())?;
    let mut realm_configs = vec![];
    for (address, account) in &related_accounts {
        if let Ok(GovernanceAccountType::RealmConfig) = account_type(account) {
            realm_configs.push(decode_realm_config(address, account)?);
        }
    }

    let proposal_rows = raw["proposals"].as_array().context("proposals missing")?;
    let proposals = proposal_rows
        .iter()
        .map(|row| {
            let record: Record = serde_json::from_value(row.clone())?;
            decode_proposal(&record, row["governance"].as_str().unwrap())
        })
        .collect::<Result<Vec<_>>>()?;

    let token_owner_records = raw["tokenOwnerRecords"]
        .as_array()
        .context("tokenOwnerRecords missing")?
        .iter()
        .map(|row| {
            let record: Record = serde_json::from_value(row.clone())?;
            decode_token_owner_record(&record)
        })
        .collect::<Result<Vec<_>>>()?;

    let mut children = vec![];
    for group in raw["proposalChildren"].as_array().context("proposalChildren missing")? {
        let proposal = group["proposal"].as_str().unwrap();
        for row in group["records"].as_array().context("records missing")? {
            let record: Record = serde_json::from_value(row.clone())?;
            let kind = account_type(&record.account)?;
            let details = match kind {
                GovernanceAccountType::ProposalTransactionV2 => decode_legacy_transaction(&record)?,
                GovernanceAccountType::ProposalVersionedTransaction => decode_versioned_transaction(&record)?,
                _ => json!({
                    "address": record.pubkey,
                    "accountType": format!("{:?}", kind),
                    "owner": record.account.owner,
                    "lamports": record.account.lamports,
                    "space": record.account.space,
                }),
            };
            children.push(json!({ "proposalSearchKey": proposal, "details": details }));
        }
    }

    for governance in &governances {
        if governance["accountType"] != "GovernanceV2" {
            bail!("target is not GovernanceV2");
        }
    }

    let output = json!({
        "generatedAt": raw["generatedAt"],
        "minimumContextSlot": raw["minimumContextSlot"],
        "noTransactionsSubmitted": true,
        "decoderSource": "Mythic-Project/spl-governance-v3.1.3 commit 00fa982b1555abc80f7ce1a22dbd14c4d3d0fe8d",
        "governances": governances,
        "realms": realms,
        "realmConfigs": realm_configs,
        "proposals": proposals,
        "tokenOwnerRecords": token_owner_records,
        "proposalChildren": children,
    });
    let output_path = audit_dir.join(output_name);
    fs::write(&output_path, format!("{}\n", serde_json::to_string_pretty(&output)?))?;

    let summary = json!({
        "output": output_path,
        "governances": output["governances"],
        "realms": output["realms"],
        "realmConfigs": output["realmConfigs"],
        "proposals": output["proposals"],
        "executableChildren": output["proposalChildren"].as_array().unwrap().iter().filter(|item| {
            matches!(item["details"]["accountType"].as_str(), Some("ProposalTransactionV2" | "ProposalVersionedTransaction"))
        }).cloned().collect::<Vec<_>>(),
    });
    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}
