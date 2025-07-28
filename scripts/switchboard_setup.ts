// scripts/simple_setup.ts
// Simplified Switchboard setup that avoids version conflicts

import * as anchor from "@project-serum/anchor";
import { Connection, PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import path from "path";

async function main() {
  console.log("🔧 Simple Switchboard Setup for Your Lottery");
  console.log("==========================================\n");
  
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load your wallet
  const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
  const keypairPath = path.resolve(homeDir, ".config/solana/id.json");
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  const wallet = new anchor.Wallet(walletKeypair);

  console.log("👤 Your wallet:", walletKeypair.publicKey.toBase58());
  
  // Check if Switchboard packages are installed
  let hasOnDemand = false;
  let hasRandomnessService = false;
  
  try {
    require.resolve("@switchboard-xyz/on-demand");
    hasOnDemand = true;
    console.log("✅ @switchboard-xyz/on-demand is installed");
  } catch (e) {
    console.log("❌ @switchboard-xyz/on-demand NOT installed");
  }

  try {
    require.resolve("@switchboard-xyz/solana-randomness-service");
    hasRandomnessService = true;
    console.log("✅ @switchboard-xyz/solana-randomness-service is installed");
  } catch (e) {
    console.log("❌ @switchboard-xyz/solana-randomness-service NOT installed");
  }

  if (!hasOnDemand && !hasRandomnessService) {
    console.log("\n🚨 NO SWITCHBOARD PACKAGES FOUND!");
    console.log("\nTo fix this, run ONE of these commands:");
    console.log("   npm install @switchboard-xyz/on-demand");
    console.log("   npm install @switchboard-xyz/solana-randomness-service");
    console.log("\nRecommended: Use on-demand (matches your Rust code):");
    console.log("   npm install @switchboard-xyz/on-demand");
    console.log("\nThen run this script again.");
    return;
  }

  // Check your lottery status
  const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "processed",
  });
  anchor.setProvider(provider);

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

  console.log("\n🎲 Checking your lottery...");
  console.log("Lottery PDA:", lotteryPda.toBase58());

  try {
    const lotteryAccount = await program.account.lotteryState.fetch(lotteryPda) as any;
    console.log("📊 Lottery Status:");
    console.log("   - Total Tickets:", lotteryAccount.totalTickets);
    console.log("   - Winner:", lotteryAccount.winner ? "Selected" : "None");
    console.log("   - End Time:", new Date(lotteryAccount.endTime.toNumber() * 1000).toISOString());
    
    if (lotteryAccount.winner) {
      console.log("\n✅ Winner already selected! No randomness needed.");
      console.log("Winner:", lotteryAccount.winner.toBase58());
      return;
    }
    
    if (lotteryAccount.totalTickets === 0) {
      console.log("\n⚠️  No participants yet! Buy tickets first:");
      console.log("   npx ts-node scripts/buy_ticket.ts");
      console.log("   npx ts-node scripts/buy_multiple_tickets.ts");
      return;
    }

    console.log("\n✅ Lottery ready for winner selection!");
    console.log("Participants:", lotteryAccount.totalTickets);

  } catch (err) {
    console.error("❌ Failed to fetch lottery:", err.message);
    console.log("\nMake sure you've initialized the lottery first:");
    console.log("   npx ts-node scripts/initialize.ts");
    return;
  }

  // Provide clear next steps
  console.log("\n🎯 NEXT STEPS:");
  console.log("=============");

  if (hasOnDemand) {
    console.log("\n✅ You have @switchboard-xyz/on-demand installed!");
    console.log("\nOption 1: Use Switchboard CLI to create randomness account:");
    console.log("   npm install -g @switchboard-xyz/cli");
    console.log("   sb config set rpc https://api.devnet.solana.com");
    console.log("   sb config set keypair ~/.config/solana/id.json");
    console.log("   sb randomness create");
    console.log("\nOption 2: Use an existing devnet randomness account:");
    console.log("   Visit: https://ondemand.switchboard.xyz/solana/devnet");
    console.log("   Find an existing randomness account to use");
    
    console.log("\n📝 Once you have a randomness account address:");
    console.log("   1. Edit scripts/select_winner.ts");
    console.log("   2. Replace the placeholder randomness account:");
    console.log("      const randomnessAccount = new PublicKey('YOUR_REAL_RANDOMNESS_ACCOUNT');");
    console.log("   3. Run: npx ts-node scripts/select_winner.ts");
  }

  if (hasRandomnessService) {
    console.log("\n✅ You have @switchboard-xyz/solana-randomness-service installed!");
    console.log("This requires modifying your Rust code to use RandomnessService instead of on-demand.");
    console.log("For now, use the on-demand approach above.");
  }

  console.log("\n🔧 TEMPORARY TESTING SOLUTION:");
  console.log("If you want to test without setting up Switchboard:");
  console.log("   1. Add the test function to your lib.rs (see artifacts)");
  console.log("   2. Rebuild: anchor build && anchor deploy");
  console.log("   3. Run: npx ts-node scripts/use_test_select_winner.ts");

  console.log("\n🌐 USEFUL LINKS:");
  console.log("   Switchboard Devnet App: https://ondemand.switchboard.xyz/solana/devnet");
  console.log("   Switchboard Docs: https://docs.switchboard.xyz");
  console.log("   Your Lottery Explorer: https://explorer.solana.com/address/" + lotteryPda.toBase58() + "?cluster=devnet");

  console.log("\n🎉 You're ready to select a winner with real randomness!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });