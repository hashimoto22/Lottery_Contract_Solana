// scripts/buy_ticket.ts

import * as anchor from "@coral-xyz/anchor";
const { Connection, PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } = anchor.web3;
import fs from "fs";
import path from "path";

async function main() {
  // ───────────────────────────────────────────────────────
  // 1️⃣ Connect to Devnet
  // ───────────────────────────────────────────────────────
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // ───────────────────────────────────────────────────────
  // 2️⃣ Load your local wallet keypair
  // ───────────────────────────────────────────────────────
  const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
  console.log("---------------------- this is the home Dir", homeDir);
  const keypairPath = path.resolve(homeDir, ".config/solana/id.json");
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  const wallet = new anchor.Wallet(walletKeypair);

  // ───────────────────────────────────────────────────────
  // 3️⃣ Build the Anchor provider
  // ───────────────────────────────────────────────────────
  const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "processed",
  });
  anchor.setProvider(provider);

  // ───────────────────────────────────────────────────────
  // 4️⃣ Load the IDL and create program instance
  // ───────────────────────────────────────────────────────
  const idlPath = path.resolve(__dirname, "../target/idl/lottery.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const PROGRAM_ID = new PublicKey("CaxFs3DnbanSUhQRZawAQfWiH1HG8t5yuPCTrboc86mY");
  const program = new anchor.Program(idl, provider);

  // ───────────────────────────────────────────────────────
  // 5️⃣ Set lottery parameters (must match your initialize script)
  // ───────────────────────────────────────────────────────
  const lotteryId = "lottery551234"; // Same as in initialize.ts

  // ───────────────────────────────────────────────────────
  // 6️⃣ Derive the lottery PDA (same logic as initialize)
  // ───────────────────────────────────────────────────────
  const LOTTERY_PREFIX = "lottery";
  const [lotteryPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(LOTTERY_PREFIX),
      Buffer.from(lotteryId),
    ],
    program.programId
  );

  console.log("🎲 Lottery PDA:", lotteryPda.toBase58());

  // ───────────────────────────────────────────────────────
  // 7️⃣ Check current wallet balance
  // ───────────────────────────────────────────────────────
  const balance = await connection.getBalance(provider.wallet.publicKey);
  console.log("💰 Current wallet balance:", balance / LAMPORTS_PER_SOL, "SOL");

  // ───────────────────────────────────────────────────────
  // 8️⃣ Check lottery status and details
  // ───────────────────────────────────────────────────────
  try {
    // @ts-ignore
    const lotteryAccount = await program.account.lotteryState.fetch(lotteryPda);
    console.log("📊 Lottery Status:");
    console.log("   - ID:", lotteryAccount.lotteryId);
    console.log("   - Entry Fee:", lotteryAccount.entryFee.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("   - Current Tickets:", lotteryAccount.totalTickets);
    console.log("   - End Time:", new Date(lotteryAccount.endTime.toNumber() * 1000).toISOString());
    console.log("   - Status:", lotteryAccount.status);
    
    // Check if lottery is still active
    const currentTime = Math.floor(Date.now() / 1000);
    const endTime = lotteryAccount.endTime.toNumber();
    
    if (currentTime > endTime) {
      console.log("⚠️  This lottery has already ended!");
      return;
    }
    
    // Check if user has enough balance
    const entryFee = lotteryAccount.entryFee.toNumber();
    if (balance < entryFee) {
      console.log("❌ Insufficient balance to buy ticket");
      console.log(`   Need: ${entryFee / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Have: ${balance / LAMPORTS_PER_SOL} SOL`);
      return;
    }

    console.log(`✅ Ready to buy ticket for ${entryFee / LAMPORTS_PER_SOL} SOL`);

  } catch (err) {
    console.error("❌ Failed to fetch lottery account:", err);
    return;
  }

  // ───────────────────────────────────────────────────────
  // 9️⃣ Buy a ticket
  // ───────────────────────────────────────────────────────
  try {
    console.log("🎫 Buying lottery ticket...");
    
    const txSig = await program.methods
      .buyTicket(lotteryId)
      .accounts({
        lottery: lotteryPda,
        player: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Ticket purchased! Transaction:", txSig);

    // ───────────────────────────────────────────────────────
    // 🔟 Verify the purchase
    // ───────────────────────────────────────────────────────
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for confirmation
    
    // @ts-ignore
    const updatedLotteryAccount = await program.account.lotteryState.fetch(lotteryPda);
    console.log("📈 Updated lottery stats:");
    console.log("   - Total Tickets:", updatedLotteryAccount.totalTickets);
    console.log("   - Total Prize Pool:", 
      (updatedLotteryAccount.entryFee.toNumber() * updatedLotteryAccount.totalTickets) / LAMPORTS_PER_SOL, 
      "SOL"
    );
    
    // Check new balance
    const newBalance = await connection.getBalance(provider.wallet.publicKey);
    console.log("💰 New wallet balance:", newBalance / LAMPORTS_PER_SOL, "SOL");
    console.log("💸 Spent:", (balance - newBalance) / LAMPORTS_PER_SOL, "SOL");

  } catch (err) {
    console.error("❌ Failed to buy ticket:", err);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });