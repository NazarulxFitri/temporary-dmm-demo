// ==========================================================
// Simple Separate Charges Demo App
// 1. Company: Post Job & Pay
// 2. Professional: Agree & Get Paid (Separate Transfer)
// 3. DMM Operations: See the Data
// ==========================================================

let stripeInstance = null;
let elementsInstance = null;
let currentClientSecret = null;
let currentJobId = null;

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  await initStripe();
  await refreshData();
  setupEvents();
});

async function initStripe() {
  try {
    const res = await fetch('/api/overview');
    const data = await res.json();
    if (data.publishableKey) {
      stripeInstance = Stripe(data.publishableKey);
    }
  } catch (err) {
    console.error('Stripe init error:', err);
  }
}

async function refreshData() {
  try {
    const res = await fetch('/api/overview');
    const data = await res.json();

    // Balances
    document.getElementById('platformBal').textContent = `¥${(data.platformBalance || 0).toLocaleString()} JPY`;
    document.getElementById('workerBal').textContent = `¥${(data.workerBalance || 0).toLocaleString()} JPY`;

    renderProfessionalView(data.jobs);
    renderOperationsView(data.jobs);
  } catch (err) {
    console.error('Refresh error:', err);
  }
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(`view-${btn.getAttribute('data-tab')}`);
      if (target) target.classList.add('active');
    });
  });
}

function setupEvents() {
  // 1. Company creates job
  const form = document.getElementById('postJobForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('jobTitle').value;
    const amount = document.getElementById('jobAmount').value;

    try {
      const res = await fetch('/api/jobs/create-charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, amount })
      });
      const data = await res.json();

      if (data.job) {
        currentJobId = data.job.id;
        currentClientSecret = data.clientSecret;

        // Show payment box
        document.getElementById('payingJobTitle').textContent = data.job.title;
        document.getElementById('payingJobAmount').textContent = Number(data.job.amount).toLocaleString();
        document.getElementById('paymentBox').classList.remove('hidden');

        // Mount Stripe Elements
        elementsInstance = stripeInstance.elements({ clientSecret: currentClientSecret });
        const paymentElement = elementsInstance.create('payment');
        const mount = document.getElementById('payment-element');
        mount.innerHTML = '';
        paymentElement.mount('#payment-element');

        showToast('Job created! Please submit payment.');
        await refreshData();
      }
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  });

  // 1-Click Test Payment Button
  document.getElementById('btnQuickPay').addEventListener('click', async () => {
    if (!currentJobId) return;
    try {
      const res = await fetch(`/api/jobs/${currentJobId}/quick-pay`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('🟢 Paid to DMM Platform Account! Money is now held by DMM.');
        document.getElementById('paymentBox').classList.add('hidden');
        document.getElementById('postJobForm').reset();
        await refreshData();
      }
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  });

  // Standard Card Submit
  document.getElementById('btnStripePay').addEventListener('click', async () => {
    if (!stripeInstance || !elementsInstance || !currentJobId) return;
    try {
      const { error, paymentIntent } = await stripeInstance.confirmPayment({
        elements: elementsInstance,
        redirect: 'if_required'
      });

      if (error) {
        showToast('Payment failed: ' + error.message);
        return;
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        await fetch(`/api/jobs/${currentJobId}/paid`, { method: 'POST' });
        showToast('🟢 Paid to DMM Platform Account! Money is held by DMM.');
        document.getElementById('paymentBox').classList.add('hidden');
        document.getElementById('postJobForm').reset();
        await refreshData();
      }
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  });
}

// 2. Professional View
function renderProfessionalView(jobs) {
  const container = document.getElementById('professionalJobsList');
  if (!container) return;

  if (!jobs || jobs.length === 0) {
    container.innerHTML = '<p style="color:#64748b; font-size:13px;">No jobs posted yet. Go to Company View to post a job.</p>';
    return;
  }

  container.innerHTML = '';
  jobs.forEach(job => {
    const div = document.createElement('div');
    div.className = 'job-card';

    let actionHtml = '';
    if (job.status === 'PAID_TO_PLATFORM') {
      actionHtml = `
        <button class="btn btn-success" onclick="transferToProfessional('${job.id}')">
          🤝 Agree & Get Paid (Receive ¥${job.amount.toLocaleString()})
        </button>
      `;
    } else if (job.status === 'PAID_TO_PROFESSIONAL') {
      actionHtml = `<span style="color:#16a34a; font-weight:700;">✅ Received ¥${job.amount.toLocaleString()}</span>`;
    } else {
      actionHtml = `<span style="color:#94a3b8; font-size:12px;">Waiting for Company Payment</span>`;
    }

    div.innerHTML = `
      <div>
        <strong style="font-size:15px;">${job.title}</strong>
        <div style="font-size:13px; color:#64748b; margin-top:4px;">
          Amount: <strong>¥${job.amount.toLocaleString()} JPY</strong> | Status: <span class="status-badge ${job.status}">${job.status}</span>
        </div>
      </div>
      <div>${actionHtml}</div>
    `;
    container.appendChild(div);
  });
}

// Action: Professional gets paid (The Separate Transfer)
window.transferToProfessional = async function(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}/transfer-to-professional`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('🎉 Separate Transfer Succeeded! Money sent to Professional.');
      await refreshData();
    } else {
      showToast('Error: ' + data.error);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
};

// 3. DMM Operations View
function renderOperationsView(jobs) {
  const tbody = document.getElementById('operationsTableBody');
  if (!tbody) return;

  if (!jobs || jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b; padding:16px;">No transactions yet.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  jobs.forEach(job => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong>${job.title}</strong><br>
        <small style="color:#64748b;">${job.id}</small>
      </td>
      <td><strong>¥${job.amount.toLocaleString()} JPY</strong></td>
      <td><span class="status-badge ${job.status}">${job.status}</span></td>
      <td><code>${job.chargeId || (job.status === 'AWAITING_PAYMENT' ? 'Pending Payment' : 'Card Paid')}</code></td>
      <td><code>${job.transferId || (job.status === 'PAID_TO_PLATFORM' ? 'Held in DMM (Not Transferred)' : (job.status === 'AWAITING_PAYMENT' ? '-' : 'Transferred'))}</code></td>
    `;
    tbody.appendChild(tr);
  });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 4000);
}
