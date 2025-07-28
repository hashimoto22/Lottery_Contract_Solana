// scripts/initialize.ts

import * as anchor from "@project-serum/anchor";
import { Connection, PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";

async function main() {
  // ───────────────────────────────────────────────────────
  // 1️⃣ Connect to Devnet
  // ───────────────────────────────────────────────────────
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // ───────────────────────────────────────────────────────
  // 2️⃣ Load your local wallet keypair from ~/.config/solana/id.json
  // ───────────────────────────────────────────────────────
  const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
  const keypairPath = path.resolve(homeDir, ".config/solana/id.json");
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  const wallet = new anchor.Wallet(walletKeypair);

  // ───────────────────────────────────────────────────────
  // 3️⃣ Build the Anchor provider manually (Devnet + your wallet)
  // ───────────────────────────────────────────────────────
  const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "processed",
  });
  anchor.setProvider(provider);

  // ───────────────────────────────────────────────────────
  // 4️⃣ Load the IDL (after you run `anchor build`)
  // ───────────────────────────────────────────────────────
  const idlPath = path.resolve(__dirname, "../target/idl/lottery.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

  // ───────────────────────────────────────────────────────
  // 5️⃣ Use your deployed Program ID (must match on‐chain exactly)
  // ───────────────────────────────────────────────────────
  const PROGRAM_ID = new PublicKey(
    "HCdwGMTkU4K6krKbHNTZhmZb2Dx8TjwdV7GWrmApxeoV"
  );
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  // ───────────────────────────────────────────────────────
  // 6️⃣ Prepare the five arguments your Rust `initialize` expects
  // ───────────────────────────────────────────────────────
  const lotteryId = "lottery551234";                    // ← your unique on‐chain ID
  const entryFee = new anchor.BN(100_000_000);         // ← 0.1 SOL in lamports (u64)
  const nowSeconds = Math.floor(Date.now() / 1000);
  const endTime = new anchor.BN(nowSeconds + 3600);    // ← one hour from now (i64)
  const creatorKey = provider.wallet.publicKey;        // ← your wallet Pubkey
  const buyBack = false;                                // ← boolean flag

  // ───────────────────────────────────────────────────────
  // 7️⃣ Derive the "lottery" PDA - FIXED VERSION
  //
  //    In your `lib.rs`, the Initialize struct uses exactly:
  //
  //      seeds = [
  //        LOTTERY_PREFIX,            // b"lottery"
  //        lottery_id.as_bytes(),     // UTF-8 bytes of the passed String
  //      ],
  //      bump
  //
  //    So we use only TWO seeds, not three:
  //      1) Buffer.from("lottery")         (LOTTERY_PREFIX)
  //      2) Buffer.from(lotteryId)         (lottery_id.as_bytes())
  //
  // ───────────────────────────────────────────────────────
  const LOTTERY_PREFIX = "lottery";

  const [lotteryPda, lotteryBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(LOTTERY_PREFIX),       // b"lottery"
      Buffer.from(lotteryId),            // UTF-8 bytes of "lottery1234"
    ],
    program.programId
  );

  console.log("▶ Lottery PDA:", lotteryPda.toBase58());
  console.log("▶ Lottery Bump:", lotteryBump);

  // ───────────────────────────────────────────────────────
  // 8️⃣ Check if admin account exists first
  // ───────────────────────────────────────────────────────
  const ADMIN_PREFIX = "admin";
  const [adminPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(ADMIN_PREFIX)],
    program.programId
  );

  try {
    const adminAccount = await program.account.adminState.fetch(adminPda);
    console.log("✅ Admin account already exists:", adminPda.toBase58());
  } catch (err) {
    console.log("⚠️  Admin account doesn't exist. You need to call set_admin_wallet first.");
    console.log("Admin PDA would be:", adminPda.toBase58());
    
    // Optionally, you could call set_admin_wallet here:
    try {
      console.log("🔧 Setting up admin wallet...");
      const adminTx = await program.methods
        .setAdminWallet()
        .accounts({
          admin: adminPda,
          signer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("✅ Admin wallet setup tx:", adminTx);
    } catch (adminErr) {
      console.error("❌ Failed to setup admin wallet:", adminErr);
      return;
    }
  }

  // ───────────────────────────────────────────────────────
  // 9️⃣ Invoke `initialize(...)` on‐chain
  // ───────────────────────────────────────────────────────
  try {
    const txSig = await program.methods
      .initialize(
        lotteryId,     // 1️⃣ String
        entryFee,      // 2️⃣ BN → u64
        endTime,       // 3️⃣ BN → i64
        creatorKey,    // 4️⃣ Pubkey
        buyBack        // 5️⃣ bool
      )
      .accounts({
        lottery: lotteryPda,
        admin: provider.wallet.publicKey,  // This should be the signer, not the admin PDA
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ initialize tx signature:", txSig);
    console.log("✅ Lottery state account:", lotteryPda.toBase58());
    
  } catch (err) {
    console.error("❌ initialize() failed:", err);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });