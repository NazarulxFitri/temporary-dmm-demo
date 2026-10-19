# DMM AI Talent Platform — Stripe Connect Prototype

A feasibility prototype demonstrating **Stripe Connect Separate Charges and Transfers** across three integrated views:
1. **🏢 Company View**: Client creates a job and pays DMM directly (`PaymentIntent` with `transfer_group`).
2. **🧑‍💻 Professional View**: The talent reviews terms, agrees, and receives a decoupled transfer (`stripe.transfers.create`) into their connected account (`acct_...`).
3. **🛠️ DMM Operations View**: Real-time ledger showing live balances, platform charges, and transfers.

## Architecture

- **Payment Model**: Separate Charges and Transfers (`transfer_group`)
- **Backend**: Node.js / Express
- **Frontend**: Vanilla HTML / CSS / JS with Stripe Elements v3
- **Stripe APIs Used**:
  - `stripe.paymentIntents.create` with `transfer_group`
  - `stripe.transfers.create` with `source_transaction` & `transfer_group`
  - `stripe.balance.retrieve` (Platform & Connected Account)

## Setup & Running

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables in `.env`:
   ```bash
   cp .env.example .env
   # Add your Stripe test keys
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Open `http://localhost:4000` in your browser.
# temporary-dmm-demo
