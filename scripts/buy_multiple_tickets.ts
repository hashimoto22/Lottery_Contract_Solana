// scripts/buy_multiple_tickets.ts

import * as anchor from "@project-serum/anchor";
import { Connection, PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import path from "path";

async function airdropIfNeeded(connection: Connection, publicKey: PublicKey, minBalance: number = 1 * LAMPORTS_PER_SOL) {
  const balance = await connection.getBalance(publicKey);
  if (balance < minBalance) {
    console.log(`🪂 Airdropping SOL to ${publicKey.toBase58().slice(0, 8)}...`);
    try {
      const signature = await connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature);
      console.log("✅ Airdrop completed");
    } catch (err) {
      console.log("⚠️  Airdrop failed (might be rate limited):", err);
    }
  }
}

async function buyTicketForWallet(
  program: anchor.Program, 
  lotteryPda: PublicKey, 
  lotteryId: string, 
  wallet: Keypair,
  connection: Connection
) {
  try {
    // Ensure wallet has enough SOL
    await airdropIfNeeded(connection, wallet.publicKey);
    
    const provider = new anchor.AnchorProvider(
      connection, 
      new anchor.Wallet(wallet), 
      { preflightCommitment: "processed" }
    );
    
    const programWithWallet = new anchor.Program(program.idl, program.programId, provider);
    
    console.log(`🎫 Buying ticket for wallet: ${wallet.publicKey.toBase58().slice(0, 8)}...`);
    
    const txSig = await programWithWallet.methods
      .buyTicket(lotteryId)
      .accounts({
        lottery: lotteryPda,
        player: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Ticket purchased by ${wallet.publicKey.toBase58().slice(0, 8)}: ${txSig}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to buy ticket for ${wallet.publicKey.toBase58().slice(0, 8)}:`, err);
    return false;
  }
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load your main wallet
  const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
  const keypairPath = path.resolve(homeDir, ".config/solana/id.json");
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  const mainWallet = Keypair.fromSecretKey(Uint8Array.from(secret));

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(mainWallet), {
    preflightCommitment: "processed",
  });
  anchor.setProvider(provider);

  // Load program
  const idlPath = path.resolve(__dirname, "../target/idl/lottery.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const PROGRAM_ID = new PublicKey("HCdwGMTkU4K6krKbHNTZhmZb2Dx8TjwdV7GWrmApxeoV");
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  const lotteryId = "lottery551234";
  const LOTTERY_PREFIX = "lottery";
  const [lotteryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(LOTTERY_PREFIX), Buffer.from(lotteryId)],
    program.programId
  );

  console.log("🎲 Lottery PDA:", lotteryPda.toBase58());

  // Check lottery status
  try {
    const lotteryAccount = await program.account.lotteryState.fetch(lotteryPda) as any;
    console.log("📊 Current lottery status:");
    console.log("   - Total Tickets:", lotteryAccount.totalTickets);
    console.log("   - Entry Fee:", lotteryAccount.entryFee.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("   - End Time:", new Date(lotteryAccount.endTime.toNumber() * 1000).toISOString());
    
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime > lotteryAccount.endTime.toNumber()) {
      console.log("⚠️  This lottery has already ended!");
      return;
    }
  } catch (err) {
    console.error("❌ Failed to fetch lottery:", err);
    return;
  }

  // Create multiple test wallets
  const numberOfParticipants = 5; // You can adjust this
  const testWallets: Keypair[] = [];
  
  console.log(`\n🏭 Creating ${numberOfParticipants} test wallets...`);
  for (let i = 0; i < numberOfParticipants; i++) {
    testWallets.push(Keypair.generate());
  }

  // Buy tickets for each wallet
  console.log("\n🎫 Starting ticket purchases...");
  let successfulPurchases = 0;
  
  for (let i = 0; i < testWallets.length; i++) {
    const wallet = testWallets[i];
    console.log(`\n--- Participant ${i + 1}/${testWallets.length} ---`);
    
    const success = await buyTicketForWallet(program, lotteryPda, lotteryId, wallet, connection);
    if (success) {
      successfulPurchases++;
    }
    
    // Small delay between purchases
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Final status
  console.log("\n📈 Final lottery status:");
  try {
    const finalLotteryAccount = await program.account.lotteryState.fetch(lotteryPda) as any;
    console.log("   - Total Tickets:", finalLotteryAccount.totalTickets);
    console.log("   - Successful Purchases:", successfulPurchases);
    console.log("   - Total Prize Pool:", 
      (finalLotteryAccount.entryFee.toNumber() * finalLotteryAccount.totalTickets) / LAMPORTS_PER_SOL, 
      "SOL"
    );
    
    // List all participants
    console.log("🎭 Participants:");
    finalLotteryAccount.participants.forEach((participant: PublicKey, index: number) => {
      console.log(`   ${index + 1}. ${participant.toBase58()}`);
    });
    
  } catch (err) {
    console.error("❌ Failed to fetch final status:", err);
  }

  console.log("\n🎉 Ticket buying complete!");
  console.log("💡 Next step: Wait for the lottery to end, then run the select_winner script!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });