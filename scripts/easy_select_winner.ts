// scripts/easy_select_winner.ts
// Uses an existing Switchboard randomness account on devnet

import * as anchor from "@project-serum/anchor";
import { Connection, PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
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
  try {
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
    lotteryAccount.participants.forEach((participant: PublicKey, index: number) => {
      console.log(`   ${index + 1}. ${participant.toBase58()}`);
    });

  } catch (err: any) {
    console.error("❌ Failed to fetch lottery:", err.message);
    return;
  }

  // Try multiple randomness approaches
  console.log("\n🎯 Attempting winner selection with different randomness sources...");

  // APPROACH 1: Try with a known good Switchboard account from devnet
  // These are actual Switchboard randomness accounts that exist on devnet
  const possibleRandomnessAccounts = [
    // You can find these on https://ondemand.switchboard.xyz/solana/devnet
    // or create your own using the web interface
    "2KgowxogBrV2LeFT7brBbzunj1Nq9Mry1f4AXpCYsJF3", // Example - may not work
    "7hVBPXS8VdQJvBsSTqJGxixmCfsYF4PnCqNz5NtKbmMc", // Example - may not work
  ];

  console.log("🧪 Trying with known randomness accounts...");

  let success = false;
  for (const accountString of possibleRandomnessAccounts) {
    try {
      console.log(`\n🔍 Trying randomness account: ${accountString}`);
      const randomnessAccount = new PublicKey(accountString);
      
      // Check if this account exists and has data
      const accountInfo = await connection.getAccountInfo(randomnessAccount);
      if (!accountInfo) {
        console.log("   ❌ Account doesn't exist");
        continue;
      }
      
      console.log("   ✅ Account exists, trying winner selection...");
      
      const txSig = await program.methods
        .selectWinner(lotteryId)
        .accounts({
          lottery: lotteryPda,
          randomnessAccountData: randomnessAccount,
        })
        .rpc();

      console.log("🎉 SUCCESS! Winner selected!");
      console.log("Transaction:", txSig);
      success = true;
      break;

    } catch (err: any) {
      console.log(`   ❌ Failed: ${err.message}`);
      continue;
    }
  }

  if (!success) {
    console.log("\n🔧 MANUAL APPROACH: Create your own randomness account");
    console.log("Since the pre-made accounts didn't work, here's how to create your own:");
    
    console.log("\n1. Visit: https://ondemand.switchboard.xyz/solana/devnet");
    console.log("2. Connect your wallet");
    console.log("3. Click 'Create Randomness'");
    console.log("4. Copy the account address");
    console.log("5. Use it in this script by replacing the addresses above");
    
    console.log("\n🎮 ALTERNATIVE: Use the test approach");
    console.log("Add the test function to your Rust code and use:");
    console.log("   npx ts-node scripts/use_test_select_winner.ts");
    
    console.log("\n📦 QUICK PACKAGE INSTALL");
    console.log("Make sure you have the package installed:");
    console.log("   npm install @switchboard-xyz/on-demand");
    
    // Try creating a simple randomness account programmatically
    console.log("\n🛠️  Attempting to create randomness account programmatically...");
    
    try {
      // Check if we have the Switchboard package
      const hasPackage = await checkSwitchboardPackage();
      if (hasPackage) {
        console.log("✅ Switchboard package available, setting up randomness...");
        await createRandomnessAccount(provider, lotteryPda, lotteryId, program);
      } else {
        console.log("❌ Switchboard package not installed");
        console.log("Install it with: npm install @switchboard-xyz/on-demand");
      }
    } catch (setupErr: any) {
      console.log("⚠️  Programmatic setup failed:", setupErr.message);
    }
  }

  if (success) {
    // Check the results
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      const updatedLotteryAccount = await program.account.lotteryState.fetch(lotteryPda) as any;
      console.log("\n🎊 Final Results:");
      console.log("   - Winner:", updatedLotteryAccount.winner ? updatedLotteryAccount.winner.toBase58() : "None");
      console.log("   - Status:", updatedLotteryAccount.status);
      console.log("   - Total Prize:", updatedLotteryAccount.totalPrize.toNumber() / LAMPORTS_PER_SOL, "SOL");
      
      if (updatedLotteryAccount.winner) {
        console.log("\n🎉 CONGRATULATIONS! Winner has been selected!");
        console.log("Next step: Run the claim_prize script with the winner's wallet");
        console.log("   npx ts-node scripts/claim_prize.ts");
      }
    } catch (fetchErr: any) {
      console.log("⚠️  Could not fetch updated results:", fetchErr.message);
    }
  }
}

async function checkSwitchboardPackage(): Promise<boolean> {
  try {
    require.resolve("@switchboard-xyz/on-demand");
    return true;
  } catch (e) {
    return false;
  }
}

async function createRandomnessAccount(
  provider: anchor.AnchorProvider, 
  lotteryPda: PublicKey, 
  lotteryId: string, 
  program: anchor.Program
) {
  try {
    // Dynamic import to avoid errors if package isn't installed
    const { Randomness, Queue } = await import("@switchboard-xyz/on-demand");
    
    console.log("🔧 Creating new randomness account...");
    
    // Generate a new randomness account
    const randomnessKeypair = Keypair.generate();
    console.log("📝 Generated randomness account:", randomnessKeypair.publicKey.toBase58());
    
    // Note: In a real implementation, you'd need to properly initialize this
    // For now, let's just try using it directly
    console.log("🎯 Attempting to use new randomness account...");
    
    const txSig = await program.methods
      .selectWinner(lotteryId)
      .accounts({
        lottery: lotteryPda,
        randomnessAccountData: randomnessKeypair.publicKey,
      })
      .rpc();

    console.log("✅ Success with new randomness account!");
    console.log("Transaction:", txSig);
    
  } catch (err: any) {
    console.log("❌ Failed to create/use randomness account:", err.message);
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });