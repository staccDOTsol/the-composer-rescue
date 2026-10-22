use std::{fs, path::PathBuf, str::FromStr};

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use borsh::{BorshDeserialize, BorshSerialize};
use serde_json::{json, Value};
use spl_governance::state::{
    enums::{ProposalState, TransactionExecutionStatus},
    proposal::{OptionVoteResult, ProposalV2},
    proposal_transaction::{AccountMetaData, InstructionData, ProposalTransactionV2},
};
use solana_program::pubkey::Pubkey;

fn decode<T: BorshDeserialize>(base64: &str) -> Result<T> {
    let bytes = STANDARD.decode(base64)?;
    let mut view = bytes.as_slice();
    T::deserialize(&mut view).map_err(Into::into)
}

fn padded<T: BorshSerialize>(value: &T, original_len: usize) -> Result<Vec<u8>> {
    let encoded = borsh::to_vec(value)?;
    if encoded.len() > original_len {
        bail!("mutated serialization {} exceeds account allocation {}", encoded.len(), original_len);
    }
    let mut output = vec![0u8; original_len];
    output[..encoded.len()].copy_from_slice(&encoded);
    Ok(output)
}

fn main() -> Result<()> {
    let args = std::env::args().collect::<Vec<_>>();
    let destination = Pubkey::from_str(args.get(1).context("destination pubkey argument missing")?)?;
    let amount = args.get(2).context("amount argument missing")?.parse::<u64>()?;
    let audit_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
    let raw: Value = serde_json::from_str(&fs::read_to_string(audit_dir.join("governance-graph-raw.json"))?)?;
    let proposal_address = args.get(3).map(String::as_str).unwrap_or("G5zTYYmtjMuossZZ2QUUKX11sMXXBJYLoJpYsDGKYvo7");
    let transaction_address = args.get(4).map(String::as_str).unwrap_or("2yh3srnymhEnfJt2aQ8FCuSBgpPzpq3BgnwEX3ZKSGdG");
    let governance = Pubkey::from_str(args.get(5).map(String::as_str).unwrap_or("6Va7K51FRbnPcYZTUwkoFfoYtnfh8qyJaZqT4W1GGxVi"))?;
    let vault = Pubkey::from_str(args.get(6).map(String::as_str).unwrap_or("C2KKuAq4UaUFYtm3zcxZMSDUuSEfPSk4yLcq5XaBr4wM"))?;
    let token_program = Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")?;

    let proposal_row = raw["proposals"].as_array().context("proposals missing")?.iter()
        .find(|row| row["pubkey"] == proposal_address).context("fixture proposal missing")?;
    let proposal_base64 = proposal_row["account"]["data"][0].as_str().context("proposal data missing")?;
    let proposal_original = STANDARD.decode(proposal_base64)?;
    let mut proposal: ProposalV2 = decode(proposal_base64)?;
    proposal.state = ProposalState::Succeeded;
    proposal.executing_at = None;
    proposal.closed_at = None;
    let option = proposal.options.get_mut(0).context("fixture proposal has no option")?;
    option.vote_result = OptionVoteResult::Succeeded;
    option.transactions_count = 1;
    option.transactions_executed_count = 0;
    option.transactions_next_index = option.transactions_next_index.max(1);

    let transaction_row = raw["proposalChildren"].as_array().context("proposalChildren missing")?.iter()
        .flat_map(|group| group["records"].as_array().into_iter().flatten())
        .find(|row| row["pubkey"] == transaction_address).context("fixture transaction missing")?;
    let transaction_base64 = transaction_row["account"]["data"][0].as_str().context("transaction data missing")?;
    let transaction_original = STANDARD.decode(transaction_base64)?;
    let mut transaction: ProposalTransactionV2 = decode(transaction_base64)?;
    transaction.executed_at = None;
    transaction.execution_status = TransactionExecutionStatus::None;
    transaction.hold_up_time = 0;
    let mut transfer_data = vec![3u8];
    transfer_data.extend_from_slice(&amount.to_le_bytes());
    transaction.instructions = vec![InstructionData {
        program_id: token_program,
        accounts: vec![
            AccountMetaData {pubkey: vault, is_signer: false, is_writable: true},
            AccountMetaData {pubkey: destination, is_signer: false, is_writable: true},
            AccountMetaData {pubkey: governance, is_signer: true, is_writable: false},
        ],
        data: transfer_data,
    }];

    let proposal_patched = padded(&proposal, proposal_original.len())?;
    let transaction_patched = padded(&transaction, transaction_original.len())?;
    let output = json!({
        "proposal": {
            "address": proposal_address,
            "originalLength": proposal_original.len(),
            "patchedSerializedLength": borsh::to_vec(&proposal)?.len(),
            "dataBase64": STANDARD.encode(proposal_patched),
        },
        "proposalTransaction": {
            "address": transaction_address,
            "originalLength": transaction_original.len(),
            "patchedSerializedLength": borsh::to_vec(&transaction)?.len(),
            "dataBase64": STANDARD.encode(transaction_patched),
        },
        "storedTransfer": {
            "programId": token_program.to_string(),
            "source": vault.to_string(),
            "destination": destination.to_string(),
            "authority": governance.to_string(),
            "authorityRequiredAsSigner": true,
            "amountRaw": amount.to_string(),
        },
        "disclosure": "Synthetic Surfpool-only proposal and proposal-transaction state used as a positive control for the exact current deployed binary; not a live authorization claim."
    });
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
