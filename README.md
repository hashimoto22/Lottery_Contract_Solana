# Solana Lottery Smart Contract

## Overview
This project is a **Solana-based lottery smart contract** implemented using the Anchor framework. The contract allows participants to buy tickets, draw a winner randomly, and distribute the prize pool securely and transparently on the Solana blockchain.

---

## Features
- Users can buy tickets by sending SOL to the contract.
- The contract tracks ticket ownership.
- An authorized operator can trigger a random draw.
- The winner receives the entire prize pool.
- Transparent and tamper-proof process leveraging Solana's security.

---

## How It Works

1. **Ticket Purchase:** Participants send SOL to purchase one or more tickets.
2. **Draw Winner:** At a designated time, an authorized account triggers the draw.
3. **Select Random Winner:** The contract selects a winner using a randomness source (or pseudorandomness).
4. **Prize Distribution:** The winner automatically receives the accumulated SOL.

---

## Prerequisites

- Rust and Solana CLI installed
- Anchor CLI installed
- A local or test Solana network (devnet/testnet)
- Wallet with SOL for testing

---

## Getting Started

### Clone the repository

```bash  
git clone https://github.com/yourusername/solana-lottery.git  
cd solana-lottery

### Configure environment

```bash
# Set the network (localnet, devnet, testnet, mainnet)
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
```

## Build and Deploy

```bash
anchor build
anchor deploy
```
Note: Make sure your wallet has enough SOL for deployment.
