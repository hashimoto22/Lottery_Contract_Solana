// scripts/select_winner.ts

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
  // const coder = new anchor.BorshCoder(idl);
  const program = new anchor.Program(idl, provider);

  const lotteryId = "lottery551234";
  const LOTTERY_PREFIX = "lottery";
  const [lotteryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(LOTTERY_PREFIX), Buffer.from(lotteryId)],
    program.programId
  );

  console.log("🎲 Lottery PDA:", lotteryPda.toBase58());

  // Check lottery status before selecting winner
  try {
    // @ts-ignore
    const lotteryAccount = await program.account.lotteryState.fetch(lotteryPda);
    console.log("📊 Pre-selection lottery status:");
    console.log("   - Total Tickets:", lotteryAccount.totalTickets);
    console.log("   - End Time:", new Date(lotteryAccount.endTime.toNumber() * 1000).toISOString());
    console.log("   - Current Time:", new Date().toISOString());
    console.log("   - Winner:", lotteryAccount.winner ? lotteryAccount.winner.toBase58() : "None");
    console.log("   - Status:", lotteryAccount.status);
    
    const currentTime = Math.floor(Date.now() / 1000);
    const endTime = lotteryAccount.endTime.toNumber();
    
    if (currentTime < endTime) {
      console.log("⚠️  Lottery hasn't ended yet! Ends in:", Math.floor((endTime - currentTime) / 60), "minutes");
      // You can still try to select winner if it's close to end time
    }
    
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

  // You need to create a randomness account first
  // For now, we'll use a placeholder - in production you'd use Switchboard
  console.log("\n⚠️  IMPORTANT: This script requires a Switchboard randomness account.");
  console.log("For testing purposes, you need to:");
  console.log("1. Create a Switchboard randomness account");
  console.log("2. Replace the randomnessAccount below with the actual account");
  console.log("\nFor now, this is a placeholder that will likely fail.\n");

  // Placeholder randomness account - replace with actual Switchboard account
  const randomnessAccount = new PublicKey("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2");

  try {
    console.log("🎯 Selecting winner...");
    
    const txSig = await program.methods
      .selectWinner(lotteryId)
      .accounts({
        lottery: lotteryPda,
        randomnessAccountData: randomnessAccount, // You need a real Switchboard randomness account here
      })
      .rpc();

    console.log("✅ Winner selected! Transaction:", txSig);

    // Check the result
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for confirmation
    // @ts-ignore
    const updatedLotteryAccount = await program.account.lotteryState.fetch(lotteryPda);
    console.log("🎊 Winner selection results:");
    console.log("   - Winner:", updatedLotteryAccount.winner ? updatedLotteryAccount.winner.toBase58() : "None");
    console.log("   - Status:", updatedLotteryAccount.status);
    console.log("   - Total Prize:", updatedLotteryAccount.totalPrize.toNumber() / LAMPORTS_PER_SOL, "SOL");

  } catch (err) {
    console.error("❌ Failed to select winner:", err);
    console.log("\n💡 This likely failed because:");
    console.log("1. You need a valid Switchboard randomness account");
    console.log("2. The randomness account needs to be resolved");
    console.log("3. The lottery time constraints need to be met");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });