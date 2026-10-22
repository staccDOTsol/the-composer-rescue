use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (target_program, target_accounts) =
        accounts.split_first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let metas = target_accounts
        .iter()
        .map(|account| {
            if account.is_writable {
                AccountMeta::new(*account.key, account.is_signer)
            } else {
                AccountMeta::new_readonly(*account.key, account.is_signer)
            }
        })
        .collect();
    invoke(
        &Instruction {
            program_id: *target_program.key,
            accounts: metas,
            data: instruction_data.to_vec(),
        },
        target_accounts,
    )
}
