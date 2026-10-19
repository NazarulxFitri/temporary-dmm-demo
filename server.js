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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory store
const db = {
  // One connected professional account for testing
  professional: {
    name: 'AI Freelancer',
    stripeAccountId: 'acct_1UQ7GV8sOqKSzA4J'
  },
  jobs: []
};

// 1. Get Config & Overview
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
    if (isKeyConfigured) {
      try {
        const wb = await stripe.balance.retrieve({}, { stripeAccount: db.professional.stripeAccountId });
        workerAvail = wb.available.find(x => x.currency === 'jpy')?.amount || 0;
        workerPend = wb.pending?.find(x => x.currency === 'jpy')?.amount || 0;
        workerBalance = workerAvail + workerPend;
      } catch (e) {
        console.warn('Worker balance retrieve error:', e.message);
      }
    }

    res.json({
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      isConfigured: isKeyConfigured,
      professional: db.professional,
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

// 2. Company creates job & PaymentIntent (The "Charge" part)
app.post('/api/jobs/create-charge', async (req, res) => {
  try {
    if (!isKeyConfigured) {
      return res.status(400).json({ error: 'Stripe API keys are not configured. Please add your test keys in .env' });
    }

    const { title, amount } = req.body;
    const chargeAmount = parseInt(amount, 10) || 10000;
    const jobId = 'job_' + Date.now();

    // In Separate Charges: The customer pays DMM directly into DMM's platform account
    const pi = await stripe.paymentIntents.create({
      amount: chargeAmount,
      currency: 'jpy',
      automatic_payment_methods: { enabled: true },
      transfer_group: jobId,
      metadata: { jobId, title }
    });

    const job = {
      id: jobId,
      title: title || 'AI Application Project',
      amount: chargeAmount,
      status: 'AWAITING_PAYMENT',
      paymentIntentId: pi.id,
      chargeId: null,
      transferId: null,
      createdAt: new Date().toLocaleTimeString()
    };

    db.jobs.unshift(job);

    res.json({
      clientSecret: pi.client_secret,
      job
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Confirm card payment succeeded on DMM platform
app.post('/api/jobs/:id/paid', async (req, res) => {
  try {
    if (!isKeyConfigured) {
      return res.status(400).json({ error: 'Stripe API keys are not configured. Please add your test keys in .env' });
    }

    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const pi = await stripe.paymentIntents.retrieve(job.paymentIntentId);
    if (pi.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed.' });
    }

    job.status = 'PAID_TO_PLATFORM'; // Money is now in DMM's platform account
    job.chargeId = pi.latest_charge;

    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Quick Test Payment (One-click simulated payment for testing)
app.post('/api/jobs/:id/quick-pay', async (req, res) => {
  try {
    if (!isKeyConfigured) {
      return res.status(400).json({ error: 'Stripe API keys are not configured. Please add your test keys in .env' });
    }

    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const confirmed = await stripe.paymentIntents.confirm(job.paymentIntentId, {
      payment_method: 'pm_card_visa',
      return_url: 'https://ai-talent.dmm.com/return'
    });

    job.status = 'PAID_TO_PLATFORM';
    job.chargeId = confirmed.latest_charge;

    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Professional agrees & receives payment (The "Transfer" part)
app.post('/api/jobs/:id/transfer-to-professional', async (req, res) => {
  try {
    if (!isKeyConfigured) {
      return res.status(400).json({ error: 'Stripe API keys are not configured. Please add your test keys in .env' });
    }

    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status !== 'PAID_TO_PLATFORM') {
      return res.status(400).json({ error: 'Company must pay the platform first.' });
    }

    // Now DMM transfers the money from DMM platform account to the professional
    const transfer = await stripe.transfers.create({
      amount: job.amount,
      currency: 'jpy',
      destination: db.professional.stripeAccountId,
      source_transaction: job.chargeId || undefined,
      transfer_group: job.id
    });

    job.status = 'PAID_TO_PROFESSIONAL';
    job.transferId = transfer.id;

    res.json({ success: true, job, transfer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`\n🚀 Simple Separate Charges demo running at http://localhost:${port}`);
  if (!isKeyConfigured) {
    console.log(`⚠️  Notice: Stripe keys not yet configured in .env.`);
    console.log(`   To enable live Stripe charges & transfers, update STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY in .env.\n`);
  }
});
