use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, program::invoke_signed, pubkey, pubkey::Pubkey, system_program},
};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::{associated_token::AssociatedToken, token};
use switchboard_on_demand::accounts::RandomnessAccountData;

mod utils;
use utils::*;

declare_id!("DbqEyYdt1aX9oCTxXvmMgcEUYyCb15V6bVenUXg4uvri");

pub const MAX_PARTICIPANTS: u32 = 100;
pub const LOTTERY_PREFIX: &[u8] = b"lottery";
pub const ADMIN_PREFIX: &[u8] = b"admin";

pub const JUPITER_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"); //for mainnet

#[program]
pub mod lottery {
    use super::*;

    pub fn set_admin_wallet(ctx: Context<SetAdminWallet>) -> Result<()> {
        let admin = &mut ctx.accounts.admin;
        admin.authority = ctx.accounts.signer.key();
        admin.bump = ctx.bumps.admin;
        Ok(())
    }

    pub fn initialize(
        ctx: Context<Initialize>,
        lottery_id: String,
        entry_fee: u64,
        end_time: i64,
        creator_key: Pubkey,
        buy_back: bool,
    ) -> Result<()> {
        let lottery = &mut ctx.accounts.lottery;
        lottery.lottery_id = lottery_id;
        lottery.admin = ctx.accounts.admin.key();
        lottery.creator = creator_key;
        lottery.entry_fee = entry_fee;
        lottery.end_time = end_time;
        lottery.total_tickets = 0;
        lottery.winner = None;
        lottery.index = 0;
        lottery.randomness_account = None;
        lottery.participants.clear();
        lottery.update_status(LotteryStatus::Active);
        lottery.total_prize = 0;
        lottery.buy_back = buy_back;
        msg!("Lottery {} Initialized!", lottery.lottery_id);
        msg!("Setting initial status to: {:?}", lottery.status);
        Ok(())
    }

    pub fn get_status(ctx: Context<GetStatus>, lottery_id: String) -> Result<LotteryStatus> {
        let lottery = &mut ctx.accounts.lottery;

        // Verify this is the lottery we want to check
        require!(
            lottery.lottery_id == lottery_id,
            LotteryError::InvalidLotteryId
        );

        let status = lottery.get_status();
        msg!("Current status: {:?}", status);
        Ok(status)
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, lottery_id: String) -> Result<()> {
        require!(
            ctx.accounts.lottery.lottery_id == lottery_id,
            LotteryError::InvalidLotteryId
        );
        require!(
            ctx.accounts.player.key() != ctx.accounts.lottery.creator,
            LotteryError::CreatorCannotParticipate
        );

        let lottery = &mut ctx.accounts.lottery;

        // Use get_status() which will automatically update the status if needed
        let current_status = lottery.get_status();
        require!(
            matches!(current_status, LotteryStatus::Active),
            LotteryError::InvalidLotteryState
        );

        require!(
            lottery.winner.is_none(),
            LotteryError::WinnerAlreadySelected
        );
        require!(
            lottery.total_tickets < MAX_PARTICIPANTS,
            LotteryError::MaxParticipantsReached
        );

        let entry_fee = lottery.entry_fee;

        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: lottery.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, entry_fee)?;

        // Store the player's index using the lottery's current index
        lottery.participants.push(ctx.accounts.player.key()); // Add participant
        lottery.total_tickets += 1; // Increment total tickets
        lottery.index += 1;
        Ok(())
    }

    pub fn select_winner(ctx: Context<SelectWinner>, lottery_id: String) -> Result<()> {
        let lottery = &mut ctx.accounts.lottery;

        msg!("Starting winner selection for lottery: {}", lottery_id);
        msg!(
            "Current lottery state - Status: {:?}, Total tickets: {}",
            lottery.status,
            lottery.total_tickets
        );

        require!(
            lottery.lottery_id == lottery_id,
            LotteryError::InvalidLotteryId
        );

        // Get and verify status
        let current_status = lottery.get_status();

        // Allow selection if status is either Active (after end time) or EndedWaitingForWinner
        require!(
            matches!(current_status, LotteryStatus::EndedWaitingForWinner)
                || (matches!(current_status, LotteryStatus::Active)
                    && Clock::get()?.unix_timestamp > lottery.end_time),
            LotteryError::InvalidLotteryState
        );

        // Calculate total prize before selecting winner
        lottery.total_prize = lottery
            .entry_fee
            .checked_mul(lottery.total_tickets as u64)
            .ok_or(LotteryError::Overflow)?;

        // Check winner hasn't been selected yet
        require!(
            lottery.winner.is_none(),
            LotteryError::WinnerAlreadySelected
        );

        // Check participants
        msg!(
            "Total tickets: {}, Participants: {}",
            lottery.total_tickets,
            lottery.participants.len()
        );
        require!(
            lottery.total_tickets > 0 && !lottery.participants.is_empty(),
            LotteryError::NoParticipants
        );

        // Store randomness account
        lottery.randomness_account = Some(ctx.accounts.randomness_account_data.key());

        // Get randomness
        let randomness_data =
            RandomnessAccountData::parse(ctx.accounts.randomness_account_data.data.borrow())
                .map_err(|_| {
                    msg!("Failed to parse randomness data");
                    LotteryError::RandomnessUnavailable
                })?;

        let clock = Clock::get()?;
        let randomness_result = randomness_data.get_value(&clock).map_err(|_| {
            msg!("Randomness not yet resolved");
            LotteryError::RandomnessNotResolved
        })?;

        // Add more detailed logging for randomness calculation
        msg!("Randomness value: {:?}", randomness_result[0]);
        msg!("Total participants: {}", lottery.participants.len());
        let winner_index = (randomness_result[0] as usize) % lottery.total_tickets as usize;
        msg!("Calculated winner index: {}", winner_index);

        require!(
            winner_index < lottery.participants.len(),
            LotteryError::InvalidWinnerIndex
        );

        let winner_pubkey = lottery.participants[winner_index];

        msg!("Selected winner pubkey: {:?}", winner_pubkey);

        // Use the set_winner method instead of direct assignment
        lottery.set_winner(winner_pubkey)?;

        // Double check the winner was set
        msg!("Verifying winner was set: {:?}", lottery.winner);
        require!(lottery.winner.is_some(), LotteryError::NoWinnerSelected);
        require!(
            lottery.winner.unwrap() == winner_pubkey,
            LotteryError::InvalidWinnerIndex
        );

        lottery.update_status(LotteryStatus::WinnerSelected);
        msg!(
            "Final lottery state - Status: {:?}, Winner: {:?}",
            lottery.status,
            lottery.winner
        );

        msg!("Winner successfully selected: {:?}", winner_pubkey);
        msg!("New lottery status: {:?}", lottery.status);
        msg!("Total prize pool: {} lamports", lottery.total_prize);
        msg!("Total participants: {}", lottery.total_tickets);

        Ok(())
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>, lottery_id: String) -> Result<()> {
        let lottery_info = ctx.accounts.lottery.to_account_info();
        let lottery = &mut ctx.accounts.lottery;

        msg!("Starting claim prize. Current winner: {:?}", lottery.winner);

        require!(
            lottery.lottery_id == lottery_id,
            LotteryError::InvalidLotteryId
        );

        require!(
            Some(ctx.accounts.player.key()) == lottery.winner,
            LotteryError::NotWinner
        );

        let total_collected = lottery.total_prize;

        // Winner gets 90% of the pool
        let prize_amount = total_collected
            .checked_mul(90)
            .ok_or(LotteryError::Overflow)?
            .checked_div(100)
            .ok_or(LotteryError::Overflow)?;

        // Creator gets 3% of the pool
        let creator_share = total_collected
            .checked_mul(3)
            .ok_or(LotteryError::Overflow)?
            .checked_div(100)
            .ok_or(LotteryError::Overflow)?;

        // Developer gets 3% of the pool
        let developer_share = total_collected
            .checked_mul(3)
            .ok_or(LotteryError::Overflow)?
            .checked_div(100)
            .ok_or(LotteryError::Overflow)?;

        // Developer gets 4% of the pool
        let admin_share = total_collected
            .checked_mul(4)
            .ok_or(LotteryError::Overflow)?
            .checked_div(100)
            .ok_or(LotteryError::Overflow)?;

        // Transfer creator's share
        **lottery_info.try_borrow_mut_lamports()? -= creator_share;
        **ctx.accounts.creator.try_borrow_mut_lamports()? += creator_share;

        // Transfer developer's share
        **lottery_info.try_borrow_mut_lamports()? -= developer_share;
        **ctx
            .accounts
            .developer
            .to_account_info()
            .try_borrow_mut_lamports()? += developer_share;

        // Transfer prize to the winner
        **lottery_info.try_borrow_mut_lamports()? -= prize_amount;
        **ctx
            .accounts
            .player
            .to_account_info()
            .try_borrow_mut_lamports()? += prize_amount;

        // Transfer admin's share

        **lottery_info.try_borrow_mut_lamports()? -= admin_share;
        **ctx
            .accounts
            .admin
            .to_account_info()
            .try_borrow_mut_lamports()? += admin_share;
        // Only update status, preserve all other state
        lottery.update_status(LotteryStatus::Completed);

        msg!(
            "Final balances - Winner: {} lamports, Creator: {} lamports, Developer: {} lamports, Pool: {} lamports",
            ctx.accounts.player.lamports(),
            ctx.accounts.creator.lamports(),
            ctx.accounts.developer.lamports(),
            ctx.accounts.lottery.to_account_info().lamports()
        );
        Ok(())
    }

    pub fn wrap_sol(ctx: Context<WrapSol>, _input: String) -> Result<()> {
        // require_keys_eq!(
        //     ctx.accounts.authority.key(),
        //     ctx.accounts.lottery.admin,
        //     LotteryError::Unauthorized
        // );
        // transfer sol to token account
        // ctx.accounts.vending_machine.sub_lamports(ctx.accounts.vending_machine.wsol_amount)?;
        // ctx.accounts.vending_machine_wsol_ata.add_lamports(ctx.accounts.vending_machine.wsol_amount)?;
        // Sync the native token to reflect the new SOL balance as wSOL
        let cpi_accounts = token::SyncNative {
            account: ctx.accounts.admin_wsol_ata.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::sync_native(cpi_ctx)?;

        Ok(())
    }

    pub fn buy_back(ctx: Context<BuyBack>, lottery_id: String, data: Vec<u8>) -> Result<()> {
        let lottery = &mut ctx.accounts.lottery;
        require!(
            lottery.lottery_id == lottery_id,
            LotteryError::InvalidLotteryId
        );

        if ctx.accounts.vault_input_token_account.amount > 100_000_000 {
            require_keys_eq!(*ctx.accounts.jupiter_program.key, JUPITER_PROGRAM_ID);

            let accounts: Vec<AccountMeta> = ctx
                .remaining_accounts
                .iter()
                .map(|acc| {
                    let is_signer = acc.key == &ctx.accounts.admin.key();
                    AccountMeta {
                        pubkey: *acc.key,
                        is_signer,
                        is_writable: acc.is_writable,
                    }
                })
                .collect();

            let accounts_infos: Vec<AccountInfo> = ctx
                .remaining_accounts
                .iter()
                .map(|acc| AccountInfo { ..acc.clone() })
                .collect();

            let signer_seeds: &[&[&[u8]]] = &[&[ADMIN_PREFIX, &[ctx.accounts.admin.bump]]];

            invoke_signed(
                &Instruction {
                    program_id: ctx.accounts.jupiter_program.key(),
                    accounts,
                    data,
                },
                &accounts_infos,
                signer_seeds,
            )?;

            if lottery.buy_back {
                transfer_from_pool_vault_to_user(
                    ctx.accounts.admin.to_account_info(),
                    ctx.accounts.vault_output_token_account.to_account_info(),
                    ctx.accounts.signer_token_account.to_account_info(),
                    ctx.accounts.output_mint.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                    ctx.accounts.vault_output_token_account.amount,
                    ctx.accounts.output_mint.decimals,
                    signer_seeds,
                )?;
            } else {
                token_burn(
                    ctx.accounts.admin.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                    ctx.accounts.output_mint.to_account_info(),
                    ctx.accounts.vault_output_token_account.to_account_info(),
                    ctx.accounts.vault_output_token_account.amount,
                    signer_seeds,
                )?;
            }
        }

        Ok(())
    }
}

// === LotteryState Struct Definition ===
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Debug)]
#[repr(u8)]
pub enum LotteryStatus {
    Active = 0,
    EndedWaitingForWinner = 1,
    WinnerSelected = 2,
    Completed = 3,
}

impl Default for LotteryStatus {
    fn default() -> Self {
        LotteryStatus::Active
    }
}

#[account]
#[derive(Default)]
pub struct LotteryState {
    pub lottery_id: String,
    pub admin: Pubkey,
    pub creator: Pubkey,
    pub entry_fee: u64,
    pub total_tickets: u32,
    pub participants: Vec<Pubkey>,
    pub end_time: i64,
    pub winner: Option<Pubkey>,
    pub randomness_account: Option<Pubkey>,
    pub index: u32,
    pub status: LotteryStatus,
    pub total_prize: u64,
    pub buy_back: bool,
}

impl LotteryState {
    pub fn update_status(&mut self, new_status: LotteryStatus) {
        msg!("Updating status from {:?} to {:?}", self.status, new_status);
        self.status = new_status;
    }

    pub fn get_status(&mut self) -> LotteryStatus {
        let current_time = Clock::get().unwrap().unix_timestamp;

        // If lottery has ended but status is still Active, update it
        if current_time > self.end_time && matches!(self.status, LotteryStatus::Active) {
            self.update_status(LotteryStatus::EndedWaitingForWinner);
        }

        self.status
    }

    const LEN: usize = 4
        + 32
        + 32
        + 32
        + 8
        + 4
        + (4 * MAX_PARTICIPANTS as usize)
        + 8
        + 1
        + 32
        + 1
        + 32
        + 4
        + 1
        + 8
        + 1;

    pub fn set_winner(&mut self, winner: Pubkey) -> Result<()> {
        msg!("Attempting to set winner: {:?}", winner);
        // Check if winner is already set
        require!(self.winner.is_none(), LotteryError::WinnerAlreadySelected);
        require!(
            self.participants.contains(&winner),
            LotteryError::InvalidWinnerIndex
        );

        msg!("All validations passed, setting winner");
        self.winner = Some(winner);
        msg!("Winner has been set to: {:?}", self.winner);
        Ok(())
    }
}

#[account]
#[derive(Default)]
pub struct AdminState {
    pub bump: u8,
    pub authority: Pubkey,
}

impl AdminState {
    const LEN: usize = 4 + 1 + 32;
}

// === Context Structs ===
#[derive(Accounts)]
pub struct SetAdminWallet<'info> {
    #[account(
        init,
        payer = signer,
        seeds = [
            ADMIN_PREFIX,
        ],
        space = 8 + AdminState::LEN,
        bump
    )]
    pub admin: Account<'info, AdminState>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        seeds = [
            LOTTERY_PREFIX,
            lottery_id.as_bytes(),
        ],
        space = 8 + LotteryState::LEN,
        bump
    )]
    pub lottery: Account<'info, LotteryState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct BuyTicket<'info> {
    #[account(
        mut,
        seeds = [LOTTERY_PREFIX, lottery_id.as_bytes()],
        bump
    )]
    pub lottery: Account<'info, LotteryState>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct SelectWinner<'info> {
    #[account(
        mut,
        seeds = [LOTTERY_PREFIX, lottery_id.as_bytes()],
        bump,
        constraint = lottery.winner.is_none() @ LotteryError::WinnerAlreadySelected,
        // Remove or modify this constraint since it might be too strict
        // constraint = matches!(lottery.status, LotteryStatus::EndedWaitingForWinner) @ LotteryError::InvalidLotteryState
    )]
    pub lottery: Account<'info, LotteryState>,
    /// CHECK: This account is validated manually within the handler.
    pub randomness_account_data: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct ClaimPrize<'info> {
    #[account(
        mut,
        seeds = [LOTTERY_PREFIX, lottery_id.as_bytes()],
        bump,
        constraint = lottery.winner.is_some() @ LotteryError::NoWinnerSelected,
        constraint = lottery.winner.unwrap() == player.key() @ LotteryError::NotWinner,
        constraint = matches!(lottery.status, LotteryStatus::WinnerSelected) @ LotteryError::InvalidLotteryState
    )]
    pub lottery: Account<'info, LotteryState>,

    #[account(
        mut,
        seeds = [ADMIN_PREFIX],
        bump = admin.bump
    )]
    pub admin: Account<'info, AdminState>,

    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: Creator account that receives 5% of the prize
    #[account(mut, constraint = lottery.creator == creator.key())]
    pub creator: AccountInfo<'info>,
    #[account(mut)]
    pub developer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct GetStatus<'info> {
    #[account(
        seeds = [LOTTERY_PREFIX, lottery_id.as_bytes()],
        bump
    )]
    pub lottery: Account<'info, LotteryState>,
}

#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct  BuyBack<'info> {
    #[account(mut, seeds = [LOTTERY_PREFIX, lottery_id.as_bytes()], bump)]
    pub lottery: Account<'info, LotteryState>,
    #[account(mut)]
    pub signer: Signer<'info>,

    pub input_mint: InterfaceAccount<'info, Mint>,
    pub input_mint_program: Interface<'info, TokenInterface>,
    pub output_mint: InterfaceAccount<'info, Mint>,
    pub output_mint_program: Interface<'info, TokenInterface>,

    #[account(
      mut,
      seeds=[ADMIN_PREFIX],
      bump=admin.bump
    )]
    pub admin: Account<'info, AdminState>,

    #[account(
        mut,
        associated_token::mint=input_mint,
        associated_token::authority=admin,
        associated_token::token_program=input_mint_program,
      )]
    pub vault_input_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint=output_mint,
        associated_token::authority=admin,
        associated_token::token_program=output_mint_program,
      )]
    pub vault_output_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint=output_mint,
        associated_token::authority=signer,
      )]
    pub signer_token_account: InterfaceAccount<'info, TokenAccount>,

    ///CHECK:safe
    pub jupiter_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct WrapSol<'info> {
    #[account(mut, seeds = [LOTTERY_PREFIX, lottery_id.as_bytes()], bump)]
    pub lottery: Account<'info, LotteryState>,
    #[account(mut, seeds = [ADMIN_PREFIX], bump = admin.bump)]
    pub admin: Account<'info, AdminState>,
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = wsol_mint,
        associated_token::authority = admin,
    )]
    pub admin_wsol_ata: InterfaceAccount<'info, TokenAccount>,

    pub wsol_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
}

// === Errors ===
#[error_code]
pub enum LotteryError {
    #[msg("The lottery has already ended.")]
    LotteryClosed,
    #[msg("The lottery has not ended yet.")]
    LotteryNotEnded,
    #[msg("A winner has already been selected.")]
    WinnerAlreadySelected,
    #[msg("You are not the winner.")]
    NotWinner,
    #[msg("Arithmetic overflow occurred.")]
    Overflow,
    #[msg("No participants in the lottery.")]
    NoParticipants,
    #[msg("Maximum participants reached.")]
    MaxParticipantsReached,
    #[msg("No winner selected.")]
    NoWinnerSelected,
    #[msg("Randomness data is unavailable.")]
    RandomnessUnavailable,
    #[msg("Randomness not resolved.")]
    RandomnessNotResolved,
    #[msg("Invalid winner index.")]
    InvalidWinnerIndex,
    #[msg("Invalid lottery ID")]
    InvalidLotteryId,
    #[msg("Lottery creator cannot participate in their own lottery")]
    CreatorCannotParticipate,
    #[msg("Invalid lottery state for this operation")]
    InvalidLotteryState,
}
