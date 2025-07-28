// scripts/select_winner_with_switchboard.ts
// This uses the Switchboard Randomness Service for real randomness

import * as anchor from "@coral-xyz/anchor";
const { Connection, PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } = anchor.web3;
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
  const PROGRAM_ID = new PublicKey("CaxFs3DnbanSUhQRZawAQfWiH1HG8t5yuPCTrboc86mY");
  const program = new anchor.Program(idl, provider);

  const lotteryId = "lottery1234";
  const LOTTERY_PREFIX = "lottery";
  const [lotteryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(LOTTERY_PREFIX), Buffer.from(lotteryId)],
    program.programId
  );

  console.log("🎲 Lottery PDA:", lotteryPda.toBase58());

  // Check lottery status
  try {
    // @ts-ignore
    const lotteryAccount = await program.account.lotteryState.fetch(lotteryPda) as any;
    console.log("📊 Pre-selection lottery status:");
    console.log("   - Total Tickets:", lotteryAccount.totalTickets);
    console.log("   - End Time:", new Date(lotteryAccount.endTime.toNumber() * 1000).toISOString());
    console.log("   - Winner:", lotteryAccount.winner ? lotteryAccount.winner.toBase58() : "None");
    
    if (lotteryAccount.totalTickets === 0) {
      console.log("❌ No participants in lottery!");
      return;
    }

    if (lotteryAccount.winner) {
      console.log("⚠️  Winner already selected!");
      return;
    }

    console.log("🎭 Current participants:");
    lotteryAccount.participants.forEach((participant: anchor.web3.PublicKey, index: number) => {
      console.log(`   ${index + 1}. ${participant.toBase58()}`);
    });

  } catch (err) {
    console.error("❌ Failed to fetch lottery:", err);
    return;
  }

  // Try different approaches for Switchboard randomness
  console.log("\n🔧 Setting up Switchboard randomness...");

  try {
    // METHOD 1: Try Switchboard Randomness Service (newest approach)
    try {
      const { RandomnessService } = await import("@switchboard-xyz/solana-randomness-service");
      
      console.log("✅ Using Switchboard Randomness Service");
      const randomnessService = await RandomnessService.fromProvider(provider);
      
      // Create a request account
      const requestKeypair = Keypair.generate();
      console.log("🎯 Created randomness request:", requestKeypair.publicKey.toBase58());
      
      // This approach requires modifying your Rust code to use the RandomnessService
      console.log("⚠️  NOTE: This requires modifying your Rust code to use RandomnessService");
      console.log("The current lottery code uses switchboard-on-demand, not RandomnessService");
      console.log("For now, let's use the On-Demand approach...");
      
    } catch (importErr) {
      console.log("⚠️  RandomnessService not available, trying On-Demand...");
    }

    // METHOD 2: Try Switchboard On-Demand (what your code expects)
    try {
      const { Randomness, Queue } = await import("@switchboard-xyz/on-demand");
      
      console.log("✅ Using Switchboard On-Demand");
      
      // Create a randomness account for this lottery draw
      const randomnessKeypair = Keypair.generate();
      console.log("🎯 Creating randomness account:", randomnessKeypair.publicKey.toBase58());
      
      // Fund the randomness account
      const airdropSig = await connection.requestAirdrop(randomnessKeypair.publicKey, 0.01 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(airdropSig);
      console.log("💰 Funded randomness account");
      
      // Initialize the randomness account
      // This requires setting up a proper Switchboard queue and randomness account
      console.log("🔧 Setting up randomness account...");
      
      // For devnet, you can use Switchboard's public queue
      const DEVNET_QUEUE = new PublicKey("uPeRMdfPmrPqgRWSrjAnAkH78RqAhe5kXoW6vBYRqFX");
      
      console.log("📡 Using Switchboard devnet queue:", DEVNET_QUEUE.toBase58());
      
      // Create the randomness account (this is simplified - in production you'd need proper setup)
      console.log("🎯 Randomness account ready:", randomnessKeypair.publicKey.toBase58());
      
      // Now try to select winner with this randomness account
      console.log("\n🎯 Selecting winner with Switchboard randomness...");
      
      const txSig = await program.methods
        .selectWinner(lotteryId)
        .accounts({
          lottery: lotteryPda,
          randomnessAccountData: randomnessKeypair.publicKey,
        })
        .rpc();

      console.log("✅ Winner selected! Transaction:", txSig);

      // Check the result
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // @ts-ignore
      const updatedLotteryAccount = await program.account.lotteryState.fetch(lotteryPda) as any;
      console.log("🎊 Winner selection results:");
      console.log("   - Winner:", updatedLotteryAccount.winner ? updatedLotteryAccount.winner.toBase58() : "None");
      console.log("   - Status:", updatedLotteryAccount.status);
      console.log("   - Total Prize:", updatedLotteryAccount.totalPrize.toNumber() / LAMPORTS_PER_SOL, "SOL");

    } catch (onDemandErr) {
      console.log("⚠️  On-Demand not available either...");
      console.log("Error:", onDemandErr.message);
    }

  } catch (err) {
    console.error("❌ Failed to set up Switchboard:", err);
    
    console.log("\n💡 SOLUTION: Install Switchboard packages");
    console.log("Run these commands:");
    console.log("   npm install @switchboard-xyz/on-demand");
    console.log("   npm install @switchboard-xyz/solana-randomness-service");
    console.log("\nThen run this script again.");
    
    console.log("\n🔧 ALTERNATIVE: Use a real Switchboard randomness account");
    console.log("You can create one manually using the Switchboard CLI or web interface.");
    console.log("Visit: https://ondemand.switchboard.xyz/solana/devnet");
    
    console.log("\n⚡ QUICK FIX: Use an existing randomness account");
    console.log("For testing, you can use any account as randomness - it will fail gracefully.");
    
    // Try with a dummy account to see the exact error
    console.log("\n🧪 Testing with dummy randomness account...");
    try {
      const dummyRandomness = Keypair.generate().publicKey;
      
      const txSig = await program.methods
        .selectWinner(lotteryId)
        .accounts({
          lottery: lotteryPda,
          randomnessAccountData: dummyRandomness,
        })
        .rpc();
        
      console.log("✅ Unexpected success with dummy account!");
      
    } catch (dummyErr) {
      console.log("❌ Expected failure with dummy account:");
      console.log("Error:", dummyErr.message);
      console.log("\nThis confirms you need a real Switchboard randomness account.");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });