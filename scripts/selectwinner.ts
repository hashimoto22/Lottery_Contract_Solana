// scripts/select_winner_with_switchboard_randomness_service.ts
// Updated to use the Switchboard Randomness Service for real randomness

import * as anchor from "@project-serum/anchor";
import { Connection, PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { RandomnessService } from "@switchboard-xyz/solana-randomness-service";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, NATIVE_MINT } from "@solana/spl-token";
import fs from "fs";
import path from "path";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load your wallet
  const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
  const keypairPath = path.resolve(homeDir, ".config/solana/id.json");
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  const wallet = new anchor.Wallet(walletKeypair);

  const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "processed",
  });
  anchor.setProvider(provider);

  // Load program
  const idlPath = path.resolve(__dirname, "../target/idl/lottery.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const PROGRAM_ID = new PublicKey("HCdwGMTkU4K6krKbHNTZhmZb2Dx8TjwdV7GWrmApxeoV");
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  const lotteryId = "lottery1234";
  const LOTTERY_PREFIX = "lottery";
  const [lotteryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(LOTTERY_PREFIX), Buffer.from(lotteryId)],
    program.programId
  );

  console.log("🎲 Lottery PDA:", lotteryPda.toBase58());

  // Check lottery status
  let lotteryAccount: any;
  try {
    lotteryAccount = await program.account.lotteryState.fetch(lotteryPda);
    console.log("📊 Pre-selection lottery status:");
    console.log("   - Total Tickets:", lotteryAccount.totalTickets);
    console.log("   - End Time:", new Date(lotteryAccount.endTime.toNumber() * 1000).toISOString());
    console.log("   - Winner:", lotteryAccount.winner ? lotteryAccount.winner.toBase58() : "None");
    
    if (lotteryAccount.totalTickets === 0) {
      console.log("❌ No participants in lottery!");
      return;
    }

    if (lotteryAccount.winner && !lotteryAccount.winner.equals(PublicKey.default)) {
      console.log("⚠️  Winner already selected!");
      return;
    }

    console.log("🎭 Current participants:");
    lotteryAccount.participants.forEach((participant: PublicKey, index: number) => {
      console.log(`   ${index + 1}. ${participant.toBase58()}`);
    });

  } catch (err) {
    console.error("❌ Failed to fetch lottery:", err);
    return;
  }

  console.log("\n🔧 Setting up Switchboard Randomness Service...");

  try {
    // Initialize the RandomnessService
    const randomnessService = await RandomnessService.fromProvider(provider as any);
    console.log("✅ Switchboard Randomness Service initialized");
    console.log("   - Program ID:", randomnessService.programId.toBase58());
    console.log("   - State Account:", randomnessService.accounts.state.toBase58());
    console.log("   - Mint:", randomnessService.accounts.mint.toBase58());

    // Create a randomness request account
    const requestKeypair = Keypair.generate();
    console.log("🎯 Created randomness request account:", requestKeypair.publicKey.toBase58());

    // Calculate the escrow token account address
    const randomnessEscrow = await getAssociatedTokenAddress(
      randomnessService.accounts.mint,
      requestKeypair.publicKey
    );
    console.log("💰 Randomness escrow account:", randomnessEscrow.toBase58());

    // Start watching for the settled event BEFORE triggering the request
    console.log("👀 Starting to watch for randomness settlement...");
    const settledRandomnessEventPromise = randomnessService.awaitSettledEvent(
      requestKeypair.publicKey
    );

    console.log("\n🎯 Step 1: Requesting randomness from Switchboard...");

    // First, we need to call your lottery program to request randomness
    // This assumes your lottery program has a method that calls the Switchboard randomness service
    try {
      const requestRandomnessTx = await program.methods
        .requestRandomness(lotteryId)
        .accounts({
          lottery: lotteryPda,
          randomnessService: randomnessService.programId,
          randomnessRequest: requestKeypair.publicKey,
          randomnessEscrow: randomnessEscrow,
          randomnessState: randomnessService.accounts.state,
          randomnessMint: randomnessService.accounts.mint,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([requestKeypair])
        .rpc();

      console.log("✅ Randomness request submitted! Transaction:", requestRandomnessTx);

    } catch (requestErr: any) {
      console.log("❌ Failed to request randomness through lottery program");
      console.log("Error:", requestErr?.message || requestErr);
      
      console.log("\n💡 This likely means your lottery program needs to be updated to support the Randomness Service");
      console.log("Your Rust code needs to:");
      console.log("1. Add 'solana-randomness-service = { version = \"1\", features = [\"cpi\"] }' to Cargo.toml");
      console.log("2. Implement a 'request_randomness' instruction that calls simple_randomness_v1");
      console.log("3. Implement a 'consume_randomness' callback instruction");
      
      console.log("\n🔧 Example Rust code needed:");
      console.log(`
use solana_randomness_service::{
    cpi::{simple_randomness_v1, accounts::SimpleRandomnessV1Request},
    program::SolanaRandomnessService,
    SimpleRandomnessV1Account, TransactionOptions, Callback,
    ID as SolanaRandomnessServiceID,
};
use switchboard_solana::utils::get_ixn_discriminator;

pub fn request_randomness(ctx: Context<RequestRandomness>, lottery_id: String) -> Result<()> {
    // Call the randomness service
    simple_randomness_v1(
        CpiContext::new(
            ctx.accounts.randomness_service.to_account_info(),
            SimpleRandomnessV1Request {
                request: ctx.accounts.randomness_request.to_account_info(),
                escrow: ctx.accounts.randomness_escrow.to_account_info(),
                state: ctx.accounts.randomness_state.to_account_info(),
                mint: ctx.accounts.randomness_mint.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            },
        ),
        8, // Request 8 bytes of randomness
        Callback {
            program_id: crate::ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.lottery.key(), false).into(),
                AccountMeta::new_readonly(ctx.accounts.randomness_request.key(), false).into(),
            ],
            ix_data: get_ixn_discriminator("consume_randomness").to_vec(),
        },
        Some(TransactionOptions {
            compute_units: Some(1_000_000),
            compute_unit_price: Some(100),
        }),
    )?;
    
    // Store the randomness request in your lottery state
    let lottery = &mut ctx.accounts.lottery;
    lottery.randomness_request = Some(ctx.accounts.randomness_request.key());
    
    Ok(())
}

pub fn consume_randomness(
    ctx: Context<ConsumeRandomness>,
    randomness_bytes: Vec<u8>,
) -> Result<()> {
    let lottery = &mut ctx.accounts.lottery;
    
    // Use the randomness to select winner
    if randomness_bytes.len() >= 8 {
        let random_value = u64::from_le_bytes(
            randomness_bytes[0..8].try_into().unwrap()
        );
        let winner_index = (random_value as usize) % lottery.participants.len();
        lottery.winner = Some(lottery.participants[winner_index]);
        lottery.status = LotteryStatus::Completed;
    }
    
    Ok(())
}
      `);
      
      return;
    }

    console.log("\n⏳ Step 2: Waiting for Switchboard oracle to fulfill the randomness...");
    console.log("This may take 10-30 seconds...");

    // Wait for the randomness to be settled
    try {
      const [settledRandomnessEvent, settledSlot] = await settledRandomnessEventPromise;
      
      console.log("🎊 Randomness settled!");
      console.log("   - Event:", settledRandomnessEvent);
      console.log("   - Slot:", settledSlot);

      // The callback should have already been invoked by the oracle
      // Let's check if the lottery winner was selected
      console.log("\n🏆 Checking lottery results...");
      
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait a bit for state updates
      
      const updatedLotteryAccount = await program.account.lotteryState.fetch(lotteryPda) as any;
      console.log("🎊 Final lottery results:");
      console.log("   - Winner:", updatedLotteryAccount.winner ? updatedLotteryAccount.winner.toBase58() : "None");
      console.log("   - Status:", updatedLotteryAccount.status);
      console.log("   - Total Prize:", updatedLotteryAccount.totalPrize.toNumber() / LAMPORTS_PER_SOL, "SOL");

      if (updatedLotteryAccount.winner && !updatedLotteryAccount.winner.equals(PublicKey.default)) {
        const winnerIndex = lotteryAccount.participants.findIndex(
          (p: PublicKey) => p.equals(updatedLotteryAccount.winner)
        );
        console.log(`🎉 Congratulations to participant #${winnerIndex + 1}!`);
      } else {
        console.log("⚠️  Winner selection may still be processing...");
      }

    } catch (settlementErr: any) {
      console.log("❌ Failed to settle randomness:");
      console.log("Error:", settlementErr?.message || settlementErr);
      
      console.log("\n🔍 This could happen if:");
      console.log("1. The callback instruction failed (check your consume_randomness implementation)");
      console.log("2. Insufficient funds in the randomness escrow");
      console.log("3. Network congestion or oracle downtime");
      console.log("4. Invalid callback instruction data");
    }

  } catch (err: any) {
    console.error("❌ Failed to initialize Switchboard Randomness Service:", err);
    
    console.log("\n💡 Troubleshooting:");
    console.log("1. Make sure you have installed the package:");
    console.log("   npm install @switchboard-xyz/solana-randomness-service");
    
    console.log("\n2. Ensure you're on devnet and have SOL:");
    console.log("   solana config set --url devnet");
    console.log("   solana airdrop 2");
    
    console.log("\n3. The Switchboard Randomness Service is only available on devnet and mainnet");
    console.log("   If you're on localnet, consider using devnet for testing");
    
    console.log("\n4. Check the Switchboard documentation:");
    console.log("   https://docs.switchboard.xyz/");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: any) => {
    console.error("❌ Script failed:", err);
    process.exit(1);
  });

// Helper function to check if your lottery program supports randomness service
async function checkLotteryProgramMethods(program: anchor.Program) {
  try {
    const methods = Object.keys(program.methods);
    console.log("📋 Available lottery program methods:", methods);
    
    const hasRequestRandomness = methods.includes('requestRandomness');
    const hasConsumeRandomness = methods.includes('consumeRandomness');
    
    if (!hasRequestRandomness) {
      console.log("⚠️  Missing 'requestRandomness' method in lottery program");
    }
    if (!hasConsumeRandomness) {
      console.log("⚠️  Missing 'consumeRandomness' method in lottery program");
    }
    
    return hasRequestRandomness && hasConsumeRandomness;
  } catch (err: any) {
    console.log("❌ Could not check program methods:", err?.message || err);
    return false;
  }
}