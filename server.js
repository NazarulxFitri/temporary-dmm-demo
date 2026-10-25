require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Stripe = require('stripe');

const app = express();
const port = process.env.PORT || 4000;

const isKeyConfigured = Boolean(
  process.env.STRIPE_SECRET_KEY &&
  !process.env.STRIPE_SECRET_KEY.includes('...') &&
  process.env.STRIPE_SECRET_KEY.startsWith('sk_')
);

const stripe = Stripe(isKeyConfigured ? process.env.STRIPE_SECRET_KEY : 'sk_test_placeholder');
const CONNECTED_ACCOUNT_ID = process.env.STRIPE_CONNECTED_ACCOUNT_ID || 'acct_1UQ7GV8sOqKSzA4J';
const COMMISSION_RATE = parseFloat(process.env.DMM_COMMISSION_PERCENTAGE || '5') / 100;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store for jobs (no hardcoded seed data)
const db = {
  jobs: []
};

// Overview API: Live balances, connected account info, and job list
app.get('/api/overview', async (req, res) => {
  try {
    let platformBalance = 0;
    if (isKeyConfigured) {
      try {
        const b = await stripe.balance.retrieve();
        const pAvail = b.available.find(x => x.currency === 'jpy')?.amount || 0;
        const pPend = b.pending?.find(x => x.currency === 'jpy')?.amount || 0;
        platformBalance = pAvail + pPend;
      } catch (e) {
        console.warn('Platform balance retrieve error:', e.message);
      }
    }

    let workerBalance = 0;
    let workerAvail = 0;
    let workerPend = 0;
    let connectedAccount = {
      id: CONNECTED_ACCOUNT_ID,
      bankName: '',
      bankLast4: '',
      bankRouting: ''
    };

    if (isKeyConfigured) {
      try {
        const wb = await stripe.balance.retrieve({}, { stripeAccount: CONNECTED_ACCOUNT_ID });
        workerAvail = wb.available.find(x => x.currency === 'jpy')?.amount || 0;
        workerPend = wb.pending?.find(x => x.currency === 'jpy')?.amount || 0;
        workerBalance = workerAvail + workerPend;

        const acc = await stripe.accounts.retrieve(CONNECTED_ACCOUNT_ID);
        const bank = acc.external_accounts?.data?.[0];
        if (bank) {
          connectedAccount.bankName = bank.bank_name || '';
          connectedAccount.bankLast4 = bank.last4 || '';
          connectedAccount.bankRouting = bank.routing_number || '';
        }
      } catch (e) {
        console.warn('Connected account retrieve error:', e.message);
      }
    }

    // Cumulative DMM 5% commission from completed jobs
    const totalCommissionEarned = db.jobs
      .filter(j => j.status === 'COMPLETED')
      .reduce((sum, j) => sum + (j.dmmCommission || 0), 0);

    res.json({
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      isConfigured: isKeyConfigured,
      connectedAccountId: CONNECTED_ACCOUNT_ID,
      connectedAccount,
      commissionPercentage: COMMISSION_RATE * 100,
      totalCommissionEarned,
      platformBalance,
      workerBalance,
      workerAvail,
      workerPend,
      jobs: db.jobs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 1: Client to post a job
app.post('/api/jobs', async (req, res) => {
  try {
    const { title, amount } = req.body;
    const totalFee = parseInt(amount, 10);
    if (!title || !totalFee || totalFee <= 0) {
      return res.status(400).json({ error: 'Please enter a job title and valid positive amount.' });
    }

    const dmmCommission = Math.round(totalFee * COMMISSION_RATE); // 5%
    const netPayout = totalFee - dmmCommission; // 95%
    const jobId = 'job_' + Date.now();

    const job = {
      id: jobId,
      title: title.trim(),
      amount: totalFee,
      dmmCommission,
      netPayout,
      status: 'JOB_POSTED',
      applicantId: null,
      paymentIntentId: null,
      chargeId: null,
      deliverables: null,
      transferId: null,
      payoutId: null,
      payoutStatus: null,
      createdAt: new Date().toLocaleTimeString()
    };

    db.jobs.unshift(job);
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 2: Individual to apply
app.post('/api/jobs/:id/apply', async (req, res) => {
  try {
    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'JOB_POSTED') {
      return res.status(400).json({ error: `Cannot apply: current status is ${job.status}` });
    }

    job.applicantId = CONNECTED_ACCOUNT_ID;
    job.status = 'APPLIED';
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 3: Client to offer
app.post('/api/jobs/:id/offer', async (req, res) => {
  try {
    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'APPLIED') {
      return res.status(400).json({ error: `Cannot make offer: current status is ${job.status}` });
    }

    job.status = 'OFFERED';
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 4: Individual to accept the offer
app.post('/api/jobs/:id/accept-offer', async (req, res) => {
  try {
    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'OFFERED') {
      return res.status(400).json({ error: `Cannot accept offer: current status is ${job.status}` });
    }

    job.status = 'OFFER_ACCEPTED';
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 5: Client to pay for the fee (goes to DMM stripe account)
// 5a. Create PaymentIntent on DMM Platform Account
app.post('/api/jobs/:id/create-payment-intent', async (req, res) => {
  try {
    if (!isKeyConfigured) return res.status(400).json({ error: 'Stripe keys not configured' });
    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'OFFER_ACCEPTED') {
      return res.status(400).json({ error: `Cannot pay: current status is ${job.status}. Offer must be accepted first.` });
    }

    const pi = await stripe.paymentIntents.create({
      amount: job.amount,
      currency: 'jpy',
      automatic_payment_methods: { enabled: true },
      transfer_group: job.id,
      metadata: {
        jobId: job.id,
        title: job.title,
        totalFee: job.amount,
        dmmCommission: job.dmmCommission,
        netPayout: job.netPayout
      }
    });

    job.paymentIntentId = pi.id;
    res.json({ clientSecret: pi.client_secret, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5b. Confirm card payment succeeded on DMM platform
app.post('/api/jobs/:id/confirm-payment', async (req, res) => {
  try {
    if (!isKeyConfigured) return res.status(400).json({ error: 'Stripe keys not configured' });
    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const pi = await stripe.paymentIntents.retrieve(job.paymentIntentId);
    if (pi.status !== 'succeeded') {
      return res.status(400).json({ error: `Payment not completed. Status: ${pi.status}` });
    }

    job.status = 'FEE_PAID_TO_DMM';
    job.chargeId = pi.latest_charge;
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5b-alt. 1-Click test card payment directly on DMM platform
app.post('/api/jobs/:id/quick-pay', async (req, res) => {
  try {
    if (!isKeyConfigured) return res.status(400).json({ error: 'Stripe keys not configured' });
    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'OFFER_ACCEPTED') {
      return res.status(400).json({ error: `Cannot pay: current status is ${job.status}` });
    }

    let pi;
    if (job.paymentIntentId) {
      pi = await stripe.paymentIntents.confirm(job.paymentIntentId, {
        payment_method: 'pm_card_visa',
        return_url: 'https://localhost:4000/return'
      });
    } else {
      pi = await stripe.paymentIntents.create({
        amount: job.amount,
        currency: 'jpy',
        payment_method: 'pm_card_visa',
        confirm: true,
        return_url: 'https://localhost:4000/return',
        transfer_group: job.id,
        metadata: {
          jobId: job.id,
          title: job.title,
          totalFee: job.amount,
          dmmCommission: job.dmmCommission,
          netPayout: job.netPayout
        }
      });
      job.paymentIntentId = pi.id;
    }

    job.status = 'FEE_PAID_TO_DMM';
    job.chargeId = pi.latest_charge;
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 6: Individual to start working
app.post('/api/jobs/:id/start-working', async (req, res) => {
  try {
    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'FEE_PAID_TO_DMM') {
      return res.status(400).json({ error: `Cannot start work: Client has not paid the fee yet (status: ${job.status})` });
    }

    job.status = 'WORKING';
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 7: Individual to submit the deliverables
app.post('/api/jobs/:id/submit-deliverables', async (req, res) => {
  try {
    const { deliverables } = req.body;
    if (!deliverables || !deliverables.trim()) {
      return res.status(400).json({ error: 'Deliverables description or link is required.' });
    }

    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'WORKING') {
      return res.status(400).json({ error: `Cannot submit deliverables: current status is ${job.status}` });
    }

    job.deliverables = deliverables.trim();
    job.status = 'DELIVERABLES_SUBMITTED';
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 8: Client to confirm the deliverables
app.post('/api/jobs/:id/confirm-deliverables', async (req, res) => {
  try {
    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'DELIVERABLES_SUBMITTED') {
      return res.status(400).json({ error: `Cannot confirm deliverables: current status is ${job.status}` });
    }

    job.status = 'DELIVERABLES_CONFIRMED';
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 9: DMM platform to transfer the fee to the individual stripe account and payout to the individual bank account after deduct DMM commission
app.post('/api/jobs/:id/settle-and-payout', async (req, res) => {
  try {
    if (!isKeyConfigured) return res.status(400).json({ error: 'Stripe keys not configured' });
    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'DELIVERABLES_CONFIRMED') {
      return res.status(400).json({ error: `Cannot settle: Deliverables must be confirmed first (status: ${job.status})` });
    }

    // Deduct 5% DMM commission
    const totalFee = job.amount;
    const dmmCommission = Math.round(totalFee * COMMISSION_RATE); // 5%
    const netTransfer = totalFee - dmmCommission; // 95%
    job.dmmCommission = dmmCommission;
    job.netPayout = netTransfer;

    // 1. Transfer net fee from DMM platform account to individual Stripe account
    const transfer = await stripe.transfers.create({
      amount: netTransfer,
      currency: 'jpy',
      destination: CONNECTED_ACCOUNT_ID,
      source_transaction: job.chargeId || undefined,
      transfer_group: job.id,
      metadata: {
        jobId: job.id,
        totalFee: totalFee,
        dmmCommission: dmmCommission,
        netTransfer: netTransfer
      }
    });
    job.transferId = transfer.id;

    // 2. Payout to individual bank account via connected account
    let payoutResult = null;
    try {
      payoutResult = await stripe.payouts.create(
        {
          amount: netTransfer,
          currency: 'jpy'
        },
        { stripeAccount: CONNECTED_ACCOUNT_ID }
      );
      job.payoutId = payoutResult.id;
      job.payoutStatus = payoutResult.status;
    } catch (payoutErr) {
      job.payoutId = 'pending_settlement';
      job.payoutStatus = payoutErr.message;
    }

    job.status = 'COMPLETED';
    res.json({
      success: true,
      job,
      transfer,
      payout: payoutResult
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`\n🚀 DMM Stripe 9-Step Payment Workflow running at http://localhost:${port}`);
  console.log(`   DMM Commission Rate: ${COMMISSION_RATE * 100}%`);
  console.log(`   Stripe Connected Account: ${CONNECTED_ACCOUNT_ID}`);
});
