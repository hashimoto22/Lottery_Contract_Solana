// scripts/claim_prize.ts

import * as anchor from "@project-serum/anchor";
import { Connection, PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import path from "path";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load your wallet (should be the winner)
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

  // Get admin PDA
  const ADMIN_PREFIX = "admin";
  const [adminPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(ADMIN_PREFIX)],
    program.programId
  );

  console.log("🎲 Lottery PDA:", lotteryPda.toBase58());
  console.log("🔧 Admin PDA:", adminPda.toBase58());

  // Check lottery status and winner
  try {
    const lotteryAccount = await program.account.lotteryState.fetch(lotteryPda) as any;
    console.log("📊 Lottery status:");
    console.log("   - Total Prize:", lotteryAccount.totalPrize.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("   - Winner:", lotteryAccount.winner ? lotteryAccount.winner.toBase58() : "None");
    console.log("   - Status:", lotteryAccount.status);
    console.log("   - Creator:", lotteryAccount.creator.toBase58());
    
    if (!lotteryAccount.winner) {
      console.log("❌ No winner selected yet!");
      return;
    }

    if (lotteryAccount.winner.toBase58() !== provider.wallet.publicKey.toBase58()) {
      console.log("❌ You are not the winner!");
      console.log("   Winner:", lotteryAccount.winner.toBase58());
      console.log("   Your wallet:", provider.wallet.publicKey.toBase58());
      return;
    }

    console.log("🎉 You are the winner! Preparing to claim prize...");

    // Calculate prize breakdown
    const totalPrize = lotteryAccount.totalPrize.toNumber();
    const winnerPrize = totalPrize * 0.90; // 90%
    const creatorShare = totalPrize * 0.03; // 3%
    const developerShare = totalPrize * 0.03; // 3%
    const adminShare = totalPrize * 0.04; // 4%

    console.log("💰 Prize breakdown:");
    console.log(`   - Winner (90%): ${winnerPrize / LAMPORTS_PER_SOL} SOL`);
    console.log(`   - Creator (3%): ${creatorShare / LAMPORTS_PER_SOL} SOL`);
    console.log(`   - Developer (3%): ${developerShare / LAMPORTS_PER_SOL} SOL`);
    console.log(`   - Admin (4%): ${adminShare / LAMPORTS_PER_SOL} SOL`);

    // Check current balances
    const winnerBalance = await connection.getBalance(provider.wallet.publicKey);
    const creatorBalance = await connection.getBalance(lotteryAccount.creator);
    const lotteryBalance = await connection.getBalance(lotteryPda);

    console.log("\n📊 Current balances:");
    console.log(`   - Winner: ${winnerBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`   - Creator: ${creatorBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`   - Lottery PDA: ${lotteryBalance / LAMPORTS_PER_SOL} SOL`);

  } catch (err) {
    console.error("❌ Failed to fetch lottery:", err);
    return;
  }

  // You need to provide a developer account - this should be a real account
  // For demo purposes, we'll create a temporary one, but in production this should be fixed
  const developerKeypair = Keypair.generate();
  console.log("🔧 Developer account (temporary):", developerKeypair.publicKey.toBase58());

  try {
    console.log("💎 Claiming prize...");
    
    const lotteryAccount = await program.account.lotteryState.fetch(lotteryPda) as any;
    
    const txSig = await program.methods
      .claimPrize(lotteryId)
      .accounts({
        lottery: lotteryPda,
        admin: adminPda,
        player: provider.wallet.publicKey,
        creator: lotteryAccount.creator,
        developer: developerKeypair.publicKey, // In production, this should be a fixed developer wallet
        systemProgram: SystemProgram.programId,
      })
      .signers([developerKeypair]) // Developer needs to sign
      .rpc();

    console.log("✅ Prize claimed! Transaction:", txSig);

    // Check final balances
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for confirmation
    
    const finalWinnerBalance = await connection.getBalance(provider.wallet.publicKey);
    const finalCreatorBalance = await connection.getBalance(lotteryAccount.creator);
    const finalLotteryBalance = await connection.getBalance(lotteryPda);
    const finalDeveloperBalance = await connection.getBalance(developerKeypair.publicKey);

    console.log("\n🎊 Final balances:");
    console.log(`   - Winner: ${finalWinnerBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`   - Creator: ${finalCreatorBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`   - Developer: ${finalDeveloperBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`   - Lottery PDA: ${finalLotteryBalance / LAMPORTS_PER_SOL} SOL`);

    // Check lottery status
    const finalLotteryAccount = await program.account.lotteryState.fetch(lotteryPda) as any;
    console.log("\n📈 Final lottery status:", finalLotteryAccount.status);

  } catch (err) {
    console.error("❌ Failed to claim prize:", err);
    console.log("\n💡 This might fail because:");
    console.log("1. Developer account needs to be a real, funded account");
    console.log("2. All constraints need to be met");
    console.log("3. Lottery must be in WinnerSelected status");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });