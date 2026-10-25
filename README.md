# DMM AI Talent Platform — One-off Project Payment Workflow

A prototype demonstrating **Stripe Connect Separate Charges and Transfers** with **5% DMM Commission Deduction** matching the official *22 October 2026 Payment Workflow*.

---

## 📋 The 9-Step Project Payment Workflow

1. **Client to post a job**: Client company defines project scope, acceptance criteria, and budget. Status: `POSTED`.
2. **Individual to apply**: Registered AI talent (with verified Stripe Connect & bank details) applies for the project. Status: `APPLIED`.
3. **Client to offer**: Client reviews applicants and presents formal terms (scope, fee, deadline). Status: `OFFERED`.
4. **Individual to accept the offer**: Individual accepts the terms; contract is formed. Status: `OFFER_ACCEPTED`.
5. **Client to pay for the fee (goes to DMM Stripe account)**: Client pays the total fee in advance via card (`PaymentIntent`). Funds are held in escrow in DMM's Stripe platform balance. Status: `PAID_TO_PLATFORM`.
6. **Individual to start working**: Individual is notified that payment is secured in escrow and begins development. Status: `IN_PROGRESS`.
7. **Individual to submit the deliverables**: Individual finishes work and submits deliverable links and handover notes. Status: `DELIVERED`.
8. **Client to confirm the deliverables**: Client reviews deliverables and approves acceptance. Status: `ACCEPTED`.
9. **DMM platform to transfer the fee & payout to bank after deducting 5% commission**:
   - DMM calculates:
     - **Client Total Paid**: e.g., `¥10,000 JPY` (100%)
     - **DMM Commission**: `¥500 JPY` (5%)
     - **Net to Individual**: `¥9,500 JPY` (95%)
   - Settlement transfer (`stripe.transfers.create`) transfers `¥9,500 JPY` to the individual's connected account (`acct_1UQ7GV8sOqKSzA4J`).
   - Payout initiated to individual's registered bank account (**みずほ銀行 ••••1234**).
   - Status: `COMPLETED`.

---

## 🏛️ Architecture & Views

- **🏢 1. Client Company View**: Post jobs, review applications, send offers, pay advance escrow via Stripe Elements or 1-click test card, and confirm deliverable acceptance.
- **🧑‍💻 2. Individual Talent View**: Talent profile (Yamada Taro), browse open jobs, apply, accept offers, start working, submit deliverables, and track net payouts.
- **🛠️ 3. DMM Operations & Ledger View**: Real-time financial ledger tracking total fees, 5% DMM commissions, net payouts, Stripe Charge IDs, Transfer IDs, Bank Payout IDs, and chronological sequence audit logs.

---

## 🚀 Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables in `.env`:
   ```env
   PORT=4000
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   STRIPE_SECRET_KEY=sk_test_...
   DMM_COMMISSION_PERCENTAGE=5
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open [http://localhost:4000](http://localhost:4000) in your browser.
