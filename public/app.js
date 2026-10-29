// ==============================================================================
// DMM AI Talent — One-off Project Payment Workflow (Stripe Connect)
// Strict 9-Step Flow with 5% DMM Platform Commission
// ==============================================================================

let stripe = null;
let elements = null;
let currentClientSecret = null;
let activePaymentJobId = null;
let latestJobs = [];
let stripePublishableKey = null;
let stripeConnectInstance = null;

const STEPS_MAP = {
  JOB_POSTED: { step: 1, label: 'Step 1: Client posted job' },
  APPLIED: { step: 2, label: 'Step 2: Individual applied' },
  OFFERED: { step: 3, label: 'Step 3: Client offered' },
  OFFER_ACCEPTED: { step: 4, label: 'Step 4: Individual accepted offer' },
  FEE_PAID_TO_DMM: { step: 5, label: 'Step 5: Fee paid to DMM' },
  WORKING: { step: 6, label: 'Step 6: Individual working' },
  DELIVERABLES_SUBMITTED: { step: 7, label: 'Step 7: Deliverables submitted' },
  DELIVERABLES_CONFIRMED: { step: 8, label: 'Step 8: Deliverables confirmed' },
  COMPLETED: { step: 9, label: 'Step 9: Transferred & paid out (5% fee deducted)' }
};

document.addEventListener('DOMContentLoaded', async () => {
  if (window.location.search.includes('onboarding=complete')) {
    showToast('✅ Stripe Onboarding complete! Bank & KYC verified.');
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  setupTabs();
  setupEvents();
  await refreshData();
});

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
  // Post Job Fee calculation preview
  const amountInput = document.getElementById('jobAmount');
  const updatePreview = () => {
    const fee = parseInt(amountInput.value, 10) || 0;
    const dmm = Math.round(fee * 0.05);
    const net = fee - dmm;
    document.getElementById('calcTotal').textContent = `¥${fee.toLocaleString()} JPY`;
    document.getElementById('calcDmm').textContent = `- ¥${dmm.toLocaleString()} JPY`;
    document.getElementById('calcNet').textContent = `¥${net.toLocaleString()} JPY`;
  };
  amountInput.addEventListener('input', updatePreview);

  // Step 1: Client to post a job
  document.getElementById('postJobForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('jobTitle').value.trim();
    const amount = document.getElementById('jobAmount').value;

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, amount })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Step 1 Complete: Job posted successfully.');
        document.getElementById('postJobForm').reset();
        updatePreview();
        await refreshData();
      } else {
        showToast('Error: ' + data.error);
      }
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  });

  // Modal Closers
  document.getElementById('btnClosePayModal').addEventListener('click', () => {
    document.getElementById('paymentModal').classList.add('hidden');
  });
  document.getElementById('btnCloseDeliverablesModal').addEventListener('click', () => {
    document.getElementById('deliverablesModal').classList.add('hidden');
  });

  // Step 5: 1-Click Test Card Payment
  document.getElementById('btnQuickPay').addEventListener('click', async () => {
    if (!activePaymentJobId) return;
    try {
      const btn = document.getElementById('btnQuickPay');
      btn.disabled = true;
      const res = await fetch(`/api/jobs/${activePaymentJobId}/quick-pay`, { method: 'POST' });
      const data = await res.json();
      btn.disabled = false;

      if (data.success) {
        showToast('Step 5 Complete: Fee paid to DMM Stripe account.');
        document.getElementById('paymentModal').classList.add('hidden');
        await refreshData();
      } else {
        showToast('Payment error: ' + data.error);
      }
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  });


  // Step 7: Individual to submit the deliverables
  document.getElementById('deliverablesForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const jobId = document.getElementById('deliverablesJobId').value;
    const deliverables = document.getElementById('deliverablesContent').value.trim();

    try {
      const res = await fetch(`/api/jobs/${jobId}/submit-deliverables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverables })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Step 7 Complete: Deliverables submitted.');
        document.getElementById('deliverablesModal').classList.add('hidden');
        await refreshData();
      } else {
        showToast('Error: ' + data.error);
      }
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  });

  // In-App Stripe Onboarding Modal
  const btnEmbedded = document.getElementById('btnEmbeddedOnboarding');
  const embeddedModal = document.getElementById('embeddedOnboardingModal');
  const btnCloseEmbedded = document.getElementById('btnCloseEmbeddedModal');

  if (btnEmbedded && embeddedModal) {
    btnEmbedded.addEventListener('click', () => {
      embeddedModal.classList.remove('hidden');
      initOrMountEmbeddedOnboarding();
    });
  }

  if (btnCloseEmbedded && embeddedModal) {
    btnCloseEmbedded.addEventListener('click', () => {
      embeddedModal.classList.add('hidden');
      refreshData();
    });
  }
}

// Option B: Mount Stripe Connect Embedded Onboarding Component
async function initOrMountEmbeddedOnboarding() {
  const container = document.getElementById('embeddedOnboardingContainer');
  const loading = document.getElementById('embeddedOnboardingLoading');
  if (!container) return;

  container.innerHTML = '';
  if (loading) loading.classList.remove('hidden');

  try {
    if (!window.StripeConnect) {
      throw new Error('Stripe Connect JS library is loading or blocked. Please refresh the page.');
    }

    if (!stripePublishableKey) {
      const overviewRes = await fetch('/api/overview');
      const overviewData = await overviewRes.json();
      stripePublishableKey = overviewData.publishableKey;
    }

    if (!stripeConnectInstance) {
      stripeConnectInstance = window.StripeConnect.init({
        publishableKey: stripePublishableKey,
        fetchClientSecret: async () => {
          const res = await fetch('/api/individual/embedded-onboarding-session', { method: 'POST' });
          const data = await res.json();
          if (!data.success || !data.clientSecret) {
            throw new Error(data.error || 'Failed to fetch account session client secret');
          }
          return data.clientSecret;
        },
        appearance: {
          variables: {
            colorPrimary: '#2563eb',
            colorBackground: '#ffffff',
            colorText: '#0f172a',
            borderRadius: '8px'
          }
        }
      });
    }

    const onboardingComponent = stripeConnectInstance.create('account-onboarding');
    onboardingComponent.setOnExit(async () => {
      document.getElementById('embeddedOnboardingModal')?.classList.add('hidden');
      showToast('Exited In-App Onboarding. Updating live status...');
      await refreshData();
    });

    if (loading) loading.classList.add('hidden');
    container.appendChild(onboardingComponent);
  } catch (err) {
    if (loading) loading.innerHTML = `<span style="color:#ef4444;">Failed to load in-app onboarding: ${escapeHtml(err.message)}</span>`;
  }
}

// Fetch balances and render views
async function refreshData() {
  try {
    const res = await fetch('/api/overview');
    const data = await res.json();
    latestJobs = data.jobs || [];

    if (data.publishableKey) {
      stripePublishableKey = data.publishableKey;
      if (!stripe) {
        stripe = Stripe(data.publishableKey);
      }
    }

    // Top Balances
    document.getElementById('platformBal').textContent = `¥${(data.platformBalance || 0).toLocaleString()} JPY`;
    document.getElementById('commissionBal').textContent = `¥${(data.totalCommissionEarned || 0).toLocaleString()} JPY`;
    document.getElementById('workerBal').textContent = `¥${(data.workerBalance || 0).toLocaleString()} JPY`;
    document.getElementById('workerAcct').textContent = data.connectedAccountId || '';

    if (data.connectedAccount?.bankName) {
      document.getElementById('workerBank').textContent = `${data.connectedAccount.bankName} ••••${data.connectedAccount.bankLast4}`;
    } else {
      document.getElementById('workerBank').textContent = 'None registered';
    }

    // Personnel Verification & Bank Registration Card
    const acc = data.connectedAccount || {};
    const kycAccountIdEl = document.getElementById('kycAccountId');
    if (kycAccountIdEl) kycAccountIdEl.textContent = data.connectedAccountId || '-';

    const isVerified = acc.verificationStatus === 'verified' && acc.payoutsEnabled;
    const overallBadge = document.getElementById('kycOverallBadge');
    if (overallBadge) {
      if (isVerified) {
        overallBadge.className = 'status-pill status-verified';
        overallBadge.textContent = '✅ Verified & Payouts Active';
      } else {
        overallBadge.className = 'status-pill status-unverified';
        overallBadge.textContent = '⚠️ Action Required';
      }
    }

    const idEl = document.getElementById('kycIdentityStatus');
    if (idEl) {
      idEl.innerHTML = acc.verificationStatus === 'verified'
        ? '<span class="text-green">Verified (Document Approved) ✅</span>'
        : '<span class="text-gold">Pending Document Upload ⚠️</span>';
    }

    const bankEl = document.getElementById('kycBankStatus');
    if (bankEl) {
      bankEl.innerHTML = acc.bankName
        ? `<span class="text-green">${acc.bankName} (Branch ${acc.bankRouting || '0001001'}) ••••${acc.bankLast4} ✅</span>`
        : '<span class="text-gold">No Bank Registered ⚠️</span>';
    }

    const payoutEl = document.getElementById('kycPayoutStatus');
    if (payoutEl) {
      payoutEl.innerHTML = acc.payoutsEnabled
        ? '<span class="text-green">Active (Can Receive Payouts) ✅</span>'
        : '<span class="text-gold">Restricted (Requires KYC & Bank) ⚠️</span>';
    }

    renderClientView(latestJobs);
    renderIndividualView(latestJobs);
    renderOperationsView(latestJobs);
    updateTabBadges(latestJobs);
  } catch (err) {
    console.error('Refresh error:', err);
  }
}

// Indicator Badges on Tabs to guide the tester
function updateTabBadges(jobs) {
  let clientActions = 0;
  let individualActions = 0;
  let operationsActions = 0;

  if (!jobs || jobs.length === 0) {
    clientActions = 1; // Step 1: Client to post a job
  } else {
    jobs.forEach(job => {
      // Actions for Client: Step 3 (APPLIED), Step 5 (OFFER_ACCEPTED), Step 8 (DELIVERABLES_SUBMITTED)
      if (['APPLIED', 'OFFER_ACCEPTED', 'DELIVERABLES_SUBMITTED'].includes(job.status)) {
        clientActions++;
      }
      // Actions for Individual: Step 2 (JOB_POSTED), Step 4 (OFFERED), Step 6 (FEE_PAID_TO_DMM), Step 7 (WORKING)
      if (['JOB_POSTED', 'OFFERED', 'FEE_PAID_TO_DMM', 'WORKING'].includes(job.status)) {
        individualActions++;
      }
      // Step 9: Settle and payout
      if (job.status === 'DELIVERABLES_CONFIRMED') {
        operationsActions++;
        clientActions++;
      }
    });
  }

  const clientEl = document.getElementById('clientBadge');
  const individualEl = document.getElementById('individualBadge');
  const opsEl = document.getElementById('operationsBadge');

  if (clientEl) {
    if (clientActions > 0) {
      clientEl.textContent = clientActions;
      clientEl.classList.remove('hidden');
    } else {
      clientEl.classList.add('hidden');
    }
  }

  if (individualEl) {
    if (individualActions > 0) {
      individualEl.textContent = individualActions;
      individualEl.classList.remove('hidden');
    } else {
      individualEl.classList.add('hidden');
    }
  }

  if (opsEl) {
    if (operationsActions > 0) {
      opsEl.textContent = operationsActions;
      opsEl.classList.remove('hidden');
    } else {
      opsEl.classList.add('hidden');
    }
  }
}

// TAB 1: CLIENT VIEW (Steps 1, 3, 5, 8, 9)
function renderClientView(jobs) {
  const container = document.getElementById('clientJobsList');
  if (!container) return;

  if (jobs.length === 0) {
    container.innerHTML = '<p style="color:#64748b; font-size:13px;">No jobs posted yet. Use the form above to post a job.</p>';
    return;
  }

  container.innerHTML = '';
  jobs.forEach(job => {
    const div = document.createElement('div');
    div.className = 'job-card';

    const stepInfo = STEPS_MAP[job.status] || { step: '-', label: job.status };
    let actionHtml = '';

    switch (job.status) {
      case 'JOB_POSTED':
        actionHtml = '<span class="status-text">Waiting for individual to apply (Step 2).</span>';
        break;
      case 'APPLIED':
        actionHtml = `<button class="btn btn-primary" onclick="clientMakeOffer('${job.id}')">Step 3: Client to offer</button>`;
        break;
      case 'OFFERED':
        actionHtml = '<span class="status-text">Offer sent. Waiting for individual to accept (Step 4).</span>';
        break;
      case 'OFFER_ACCEPTED':
        actionHtml = `<button class="btn btn-success" onclick="clientOpenPaymentModal('${job.id}')">Step 5: Client to pay fee (¥${job.amount.toLocaleString()} JPY to DMM)</button>`;
        break;
      case 'FEE_PAID_TO_DMM':
        actionHtml = '<span class="status-text text-green">Fee secured in DMM. Waiting for individual to start working (Step 6).</span>';
        break;
      case 'WORKING':
        actionHtml = '<span class="status-text">Individual is working (Step 6). Waiting for deliverables.</span>';
        break;
      case 'DELIVERABLES_SUBMITTED':
        actionHtml = `
          <div style="margin-bottom:8px; font-size:12px;"><strong>Deliverables:</strong> ${escapeHtml(job.deliverables)}</div>
          <button class="btn btn-primary" onclick="clientConfirmDeliverables('${job.id}')">Step 8: Client to confirm the deliverables</button>
        `;
        break;
      case 'DELIVERABLES_CONFIRMED':
        actionHtml = `<button class="btn btn-success" onclick="dmmSettleAndPayout('${job.id}')">Step 9: DMM platform to transfer & payout (after 5% commission)</button>`;
        break;
      case 'COMPLETED':
        actionHtml = `
          <div class="completed-box">
            ✅ <strong>Workflow Complete</strong><br>
            • Total Paid: ¥${job.amount.toLocaleString()} JPY<br>
            • DMM Commission (5%): ¥${(job.dmmCommission || 0).toLocaleString()} JPY<br>
            • Transferred to Individual: ¥${(job.netPayout || 0).toLocaleString()} JPY (Transfer: <code>${job.transferId || '-'}</code>)<br>
            • Bank Payout: <code>${job.payoutId || '-'}</code> (${job.payoutStatus || 'completed'})
          </div>
        `;
        break;
    }

    div.innerHTML = `
      <div class="job-header">
        <div>
          <strong>${escapeHtml(job.title)}</strong>
          <div class="job-meta">ID: ${job.id} • Total Fee: ¥${job.amount.toLocaleString()} JPY</div>
        </div>
        <span class="step-badge">${stepInfo.label}</span>
      </div>
      <div class="job-action">${actionHtml}</div>
    `;

    container.appendChild(div);
  });
}

// TAB 2: INDIVIDUAL VIEW (Steps 2, 4, 6, 7)
function renderIndividualView(jobs) {
  const container = document.getElementById('individualJobsList');
  if (!container) return;

  if (jobs.length === 0) {
    container.innerHTML = '<p style="color:#64748b; font-size:13px;">No jobs available.</p>';
    return;
  }

  container.innerHTML = '';
  jobs.forEach(job => {
    const div = document.createElement('div');
    div.className = 'job-card';

    const stepInfo = STEPS_MAP[job.status] || { step: '-', label: job.status };
    let actionHtml = '';

    switch (job.status) {
      case 'JOB_POSTED':
        actionHtml = `<button class="btn btn-primary" onclick="individualApply('${job.id}')">Step 2: Individual to apply</button>`;
        break;
      case 'APPLIED':
        actionHtml = '<span class="status-text">Application submitted. Waiting for client offer (Step 3).</span>';
        break;
      case 'OFFERED':
        actionHtml = `<button class="btn btn-success" onclick="individualAcceptOffer('${job.id}')">Step 4: Individual to accept the offer</button>`;
        break;
      case 'OFFER_ACCEPTED':
        actionHtml = '<span class="status-text">Offer accepted. Waiting for client to pay fee to DMM (Step 5).</span>';
        break;
      case 'FEE_PAID_TO_DMM':
        actionHtml = `<button class="btn btn-primary" onclick="individualStartWorking('${job.id}')">Step 6: Individual to start working</button>`;
        break;
      case 'WORKING':
        actionHtml = `<button class="btn btn-success" onclick="individualOpenDeliverablesModal('${job.id}')">Step 7: Individual to submit the deliverables</button>`;
        break;
      case 'DELIVERABLES_SUBMITTED':
        actionHtml = '<span class="status-text">Deliverables submitted. Waiting for client confirmation (Step 8).</span>';
        break;
      case 'DELIVERABLES_CONFIRMED':
        actionHtml = '<span class="status-text">Deliverables confirmed. DMM is processing transfer & payout (Step 9).</span>';
        break;
      case 'COMPLETED':
        actionHtml = `
          <div class="completed-box">
            🎉 <strong>Fee Received!</strong><br>
            • Net Payout (after 5% DMM commission): <strong>¥${(job.netPayout || 0).toLocaleString()} JPY</strong><br>
            • Transferred to Stripe Account: <code>${job.transferId || '-'}</code><br>
            • Paid out to Bank: <code>${job.payoutId || '-'}</code> (${job.payoutStatus || 'completed'})
          </div>
        `;
        break;
    }

    div.innerHTML = `
      <div class="job-header">
        <div>
          <strong>${escapeHtml(job.title)}</strong>
          <div class="job-meta">Total Fee: ¥${job.amount.toLocaleString()} JPY • Net Payout (95%): ¥${(job.netPayout || Math.round(job.amount * 0.95)).toLocaleString()} JPY</div>
        </div>
        <span class="step-badge">${stepInfo.label}</span>
      </div>
      <div class="job-action">${actionHtml}</div>
    `;

    container.appendChild(div);
  });
}

// TAB 3: DMM OPERATIONS VIEW (Step 9 Ledger)
function renderOperationsView(jobs) {
  const tbody = document.getElementById('operationsTableBody');
  if (!tbody) return;

  if (jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#64748b; padding:16px;">No jobs recorded.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  jobs.forEach(job => {
    const tr = document.createElement('tr');
    const stepInfo = STEPS_MAP[job.status] || { step: '-', label: job.status };

    const chargeId = job.chargeId || '-';
    const transferId = job.transferId || '-';
    const payoutId = job.payoutId || '-';

    tr.innerHTML = `
      <td><strong>${escapeHtml(job.title)}</strong><br><small style="color:#64748b; font-size:10px;">${job.id}</small></td>
      <td><strong>¥${job.amount.toLocaleString()} JPY</strong></td>
      <td class="text-gold">¥${(job.dmmCommission || Math.round(job.amount * 0.05)).toLocaleString()} JPY</td>
      <td class="text-green">¥${(job.netPayout || (job.amount - Math.round(job.amount * 0.05))).toLocaleString()} JPY</td>
      <td><code title="${chargeId}">${chargeId}</code></td>
      <td><code title="${transferId}">${transferId}</code></td>
      <td><code title="${payoutId}">${payoutId}</code></td>
      <td><span class="step-badge">${stepInfo.label}</span></td>
    `;

    tbody.appendChild(tr);
  });
}

// Step 2: Individual to apply
window.individualApply = async function(id) {
  try {
    const res = await fetch(`/api/jobs/${id}/apply`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Step 2 Complete: Individual applied.');
      await refreshData();
    } else {
      showToast('Error: ' + data.error);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
};

// Step 3: Client to offer
window.clientMakeOffer = async function(id) {
  try {
    const res = await fetch(`/api/jobs/${id}/offer`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Step 3 Complete: Client made offer.');
      await refreshData();
    } else {
      showToast('Error: ' + data.error);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
};

// Step 4: Individual to accept the offer
window.individualAcceptOffer = async function(id) {
  try {
    const res = await fetch(`/api/jobs/${id}/accept-offer`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Step 4 Complete: Individual accepted the offer.');
      await refreshData();
    } else {
      showToast('Error: ' + data.error);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
};

// Step 5: Client opens payment modal
window.clientOpenPaymentModal = function(id) {
  activePaymentJobId = id;
  const job = latestJobs.find(j => j.id === id);
  if (!job) return;

  document.getElementById('payJobTitle').textContent = job.title;
  document.getElementById('payJobAmount').textContent = `¥${job.amount.toLocaleString()} JPY`;
  document.getElementById('paymentModal').classList.remove('hidden');
};

// Step 6: Individual to start working
window.individualStartWorking = async function(id) {
  try {
    const res = await fetch(`/api/jobs/${id}/start-working`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Step 6 Complete: Individual started working.');
      await refreshData();
    } else {
      showToast('Error: ' + data.error);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
};

// Step 7: Individual opens deliverables modal
window.individualOpenDeliverablesModal = function(id) {
  document.getElementById('deliverablesJobId').value = id;
  document.getElementById('deliverablesContent').value = '';
  document.getElementById('deliverablesModal').classList.remove('hidden');
};

// Step 8: Client to confirm the deliverables
window.clientConfirmDeliverables = async function(id) {
  try {
    const res = await fetch(`/api/jobs/${id}/confirm-deliverables`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Step 8 Complete: Client confirmed the deliverables.');
      await refreshData();
    } else {
      showToast('Error: ' + data.error);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
};

// Step 9: DMM platform to transfer & payout after deducting 5% commission
window.dmmSettleAndPayout = async function(id) {
  try {
    showToast('Processing Step 9: Transferring to Stripe & paying out to bank...');
    const res = await fetch(`/api/jobs/${id}/settle-and-payout`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Step 9 Complete: 5% DMM commission deducted, fee transferred and paid out.');
      await refreshData();
    } else {
      showToast('Error: ' + data.error);
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
};

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}
