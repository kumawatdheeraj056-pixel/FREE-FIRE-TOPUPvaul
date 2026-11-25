/**
 * DiamondVault — checkout interactions + motion systems.
 *
 * Everything here is progressive enhancement. Prices, policies, contact routes
 * and trust copy all live in the HTML; this file adds validation, motion and
 * the checkout flow on top. If it fails to load, the page still reads.
 *
 * Motion systems (embers, parallax, tilt, magnetic buttons, cursor glow) all
 * gate on `prefers-reduced-motion` and pointer capability, animate transform/
 * opacity only, and stop their rAF loops the moment they are not needed.
 */

/* ==========================================================================
   Configuration — the only block you need to touch to go live.
   ========================================================================== */
const CONFIG = {
  brand: 'DiamondVault',
  currency: 'INR',
  locale: 'en-IN',

  /**
   * Listed prices are GST-INCLUSIVE. The summary works backwards from the
   * listed price so the number on the package card is the number charged —
   * no surprise at the end of checkout.
   */
  gstRate: 0.18,
  packages: {
    100: { id: 'ff-100', label: '100 Diamonds', diamonds: 100, bonus: 0, price: 38 },
    310: { id: 'ff-310', label: '310 Diamonds', diamonds: 310, bonus: 0, price: 118 },
    520: { id: 'ff-520', label: '520 Diamonds', diamonds: 520, bonus: 0, price: 198 },
    1060: { id: 'ff-1060', label: '1060 Diamonds', diamonds: 1060, bonus: 0, price: 404 },
  },

  uid: { minLength: 8, maxLength: 12 },

  /**
   * Gateway-free UPI flow. The buyer scans the amount-specific QR, pays, and submits
   * the 12-digit UTR from their receipt. server.mjs validates it, pushes the
   * order to the owner's Telegram for one-tap Approve/Reject, and this page
   * polls /api/order/:id until the decision lands. If the server or Telegram
   * is unreachable, the flow falls back to a pre-filled WhatsApp message.
   */
  api: { payConfig: '/api/pay-config', order: '/api/order' },
  pollMs: 4000,

  support: {
    whatsapp: 'https://wa.me/910000000000',
    discord: 'https://discord.gg/example',
    email: 'support@diamondvault.com',
  },
};

/* ==========================================================================
   Small helpers
   ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const prefersReduced = () => reduceMotion.matches;
const finePointer = window.matchMedia('(pointer: fine)');

const money = new Intl.NumberFormat(CONFIG.locale, {
  style: 'currency',
  currency: CONFIG.currency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money0 = new Intl.NumberFormat(CONFIG.locale, {
  style: 'currency',
  currency: CONFIG.currency,
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat(CONFIG.locale);

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Splits a tax-inclusive price so the parts always add back to the whole. */
function taxBreakdown(inclusivePrice) {
  const subtotal = round2(inclusivePrice / (1 + CONFIG.gstRate));
  return { subtotal, tax: round2(inclusivePrice - subtotal), total: inclusivePrice };
}

/* ==========================================================================
   Loader — dismissed on load, capped at 1.4s, skipped for return visits.
   A CSS keyframe kills it at 2.8s even if this code never runs.
   ========================================================================== */
(() => {
  const loader = $('#loader');
  if (!loader) return;

  const dismiss = () => loader.setAttribute('data-done', '');

  let seen = false;
  try {
    seen = sessionStorage.getItem('dv-loaded') === '1';
    sessionStorage.setItem('dv-loaded', '1');
  } catch {
    /* storage blocked — treat as first visit */
  }

  if (seen || prefersReduced() || document.readyState === 'complete') {
    dismiss();
    return;
  }

  window.addEventListener('load', dismiss, { once: true });
  setTimeout(dismiss, 1400); // never hold the page hostage
})();

/* ==========================================================================
   Toasts
   ========================================================================== */
const toastHost = $('#toasts');

const TOAST_ICON = {
  success: { icon: '#i-check', tone: 'text-ok' },
  error: { icon: '#i-alert', tone: 'text-err' },
  info: { icon: '#i-info', tone: 'text-gold' },
};

function toast(message, { type = 'info', duration = 5000, title } = {}) {
  if (!toastHost) return;
  const { icon, tone } = TOAST_ICON[type] ?? TOAST_ICON.info;

  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `
    <svg class="mt-0.5 h-[18px] w-[18px] shrink-0 ${tone}" aria-hidden="true"><use href="${icon}" /></svg>
    <div class="min-w-0 flex-1">
      ${title ? `<p class="font-semibold">${title}</p>` : ''}
      <p class="${title ? 'mt-0.5 text-ink-muted' : ''}">${message}</p>
    </div>
    <button type="button" class="-m-1 shrink-0 rounded p-1 text-ink-faint transition-colors hover:text-ink" aria-label="Dismiss">
      <svg class="h-4 w-4" aria-hidden="true"><use href="#i-close" /></svg>
    </button>`;

  const remove = () => {
    if (el.dataset.leaving) return;
    el.dataset.leaving = 'true';
    el.addEventListener('animationend', () => el.remove(), { once: true });
    // Belt and braces: reduced-motion collapses the animation to ~0ms, and a
    // detached listener would otherwise leave the node behind.
    setTimeout(() => el.remove(), 400);
  };

  $('button', el).addEventListener('click', remove);
  toastHost.append(el);
  setTimeout(remove, duration);
  return el;
}

/* ==========================================================================
   Order state
   ========================================================================== */
const state = {
  pkg: null,
  uid: '',
  uidValid: false,
  region: 'India',
  nickname: '',
  uidLookup: 'idle',
  payment: null,
  placed: false,
};

const form = $('#orderForm');
const uidInput = $('#uid');
const uidWrap = $('#uidWrap');
const uidHint = $('#uidHint');
const uidHintText = uidHint?.querySelector('span');
const uidRetry = $('#uidRetry');
const uidIcon = $('#uidIcon');
const regionSelect = $('#region');
const nicknameInput = $('#nickname');

const summaryEmpty = $('#summaryEmpty');
const summaryBody = $('#summaryBody');
const checkoutBtn = $('#checkoutBtn');
const mobileCheckoutBtn = $('#mobileCheckoutBtn');
const blockersEl = $('#checkoutBlockers');
const detailsStep = $('#detailsStep');
const detailsLock = $('#detailsLock');
const detailsFields = $('#detailsFields');
const mobileBar = $('#mobileBar');

/** Writes a value into every mirror of a summary field (rail, mobile bar, modal). */
function setSummary(key, value) {
  $$(`[data-sum="${key}"]`).forEach((el) => {
    el.textContent = value;
  });
}

/* --- Animated total ------------------------------------------------------ */
let totalAnim = null;
let lastTotal = 0;

function renderTotal(to) {
  const targets = $$('[data-sum="total"]');
  if (prefersReduced() || lastTotal === to) {
    targets.forEach((el) => (el.textContent = money0.format(to)));
    lastTotal = to;
    return;
  }

  cancelAnimationFrame(totalAnim);
  const from = lastTotal;
  const start = performance.now();
  const duration = 450;

  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
    const value = Math.round(from + (to - from) * eased);
    targets.forEach((el) => (el.textContent = money0.format(value)));
    if (t < 1) totalAnim = requestAnimationFrame(tick);
    else lastTotal = to;
  };
  totalAnim = requestAnimationFrame(tick);
}

/* --- Summary ------------------------------------------------------------- */
let summaryPrimed = false;

function renderSummary() {
  const pkg = state.pkg;

  if (!pkg) {
    summaryEmpty?.classList.remove('hidden');
    summaryBody?.classList.add('hidden');
    return;
  }

  summaryEmpty?.classList.add('hidden');
  summaryBody?.classList.remove('hidden');

  const { subtotal, tax, total } = taxBreakdown(pkg.price);
  const diamonds = pkg.bonus
    ? `${num.format(pkg.diamonds)} + ${num.format(pkg.bonus)} bonus`
    : num.format(pkg.diamonds);

  setSummary('package', pkg.label);
  setSummary('diamonds', diamonds);
  setSummary('uid', state.uid || '—');
  setSummary('region', state.region);
  setSummary('nickname', state.nickname || '—');
  setSummary('payment', state.payment ?? 'Not selected');
  setSummary('subtotal', money.format(subtotal));
  setSummary('tax', money.format(tax));
  renderTotal(total);

  const nickRow = $('[data-nick-row]');
  if (nickRow) nickRow.hidden = !state.nickname;
}

/**
 * Skeleton is shown once — the first time the summary goes from empty to
 * populated, which is the only moment a real implementation would be waiting
 * on a pricing call. Flashing it on every keystroke would be theatre.
 */
function primeSummary() {
  if (summaryPrimed || !summaryBody) return renderSummary();
  summaryPrimed = true;

  summaryEmpty?.classList.add('hidden');
  summaryBody.classList.remove('hidden');
  const values = $$('#summaryBody [data-sum]');
  values.forEach((el) => {
    el.innerHTML = '<span class="skel inline-block h-[1em] w-20 align-middle"></span>';
  });

  setTimeout(() => {
    values.forEach((el) => (el.innerHTML = ''));
    renderSummary();
  }, prefersReduced() ? 0 : 320);
}

/* --- Gating -------------------------------------------------------------- */
function blockers() {
  const missing = [];
  if (!state.pkg) missing.push('pick a package');
  if (!state.uidValid) missing.push('enter a valid UID');
  else if (state.uidLookup === 'invalid') missing.push('enter a UID confirmed to exist');
  return missing;
}

function renderGate() {
  const missing = blockers();
  const ready = missing.length === 0;

  [checkoutBtn, mobileCheckoutBtn].forEach((btn) => {
    if (!btn) return;
    btn.disabled = !ready || state.placed;
    const label = $('[data-btn-label]', btn);
    if (!label) return;
    if (state.placed === 'pending') label.textContent = 'Verification pending…';
    else if (state.placed) label.textContent = 'Order placed';
    else if (!state.pkg) label.textContent = 'Select a package';
    else if (!state.uidValid) label.textContent = 'Enter your UID';
    else if (state.uidLookup === 'invalid') label.textContent = 'Check your UID';
    else label.textContent = `Pay ${money0.format(state.pkg.price)}`;
  });

  if (blockersEl && !state.placed) {
    blockersEl.textContent = ready
      ? state.payment
        ? `Paying with ${state.payment}. You can still change anything above.`
        : 'No payment method picked — we’ll ask on the next screen.'
      : `To continue, ${missing.join(' and ')}.`;
  }

  // Step badges tick over as each step completes.
  const badge = (n) => $(`[data-step-badge="${n}"]`);
  badge(1)?.setAttribute('data-done', String(Boolean(state.pkg)));
  badge(2)?.setAttribute('data-done', String(state.uidValid));
  badge(3)?.setAttribute('data-done', String(Boolean(state.payment)));
}

/* --- Details step lock --------------------------------------------------- */
function setDetailsLocked(locked) {
  if (!detailsStep) return;
  detailsStep.dataset.locked = String(locked);
  detailsStep.classList.toggle('opacity-60', locked);
  if (detailsLock) {
    // The `hidden` attribute loses to the `flex` display utility, so toggle
    // the class as well.
    detailsLock.hidden = !locked;
    detailsLock.classList.toggle('hidden', !locked);
  }
  if (detailsFields) {
    detailsFields.classList.toggle('pointer-events-none', locked);
    $$('input, select', detailsFields).forEach((el) => {
      el.disabled = locked;
    });
  }
}

/* ==========================================================================
   Package selection — with a spark burst on the picked card.
   ========================================================================== */
let uidAutoFocused = false;

function fireBurst(label) {
  if (prefersReduced()) return;
  const burst = $('.burst', label);
  if (!burst) return;

  $$('i', burst).forEach((spark) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 44 + Math.random() * 72;
    spark.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    spark.style.setProperty('--dy', `${Math.sin(angle) * dist - 24}px`);
  });

  burst.classList.remove('go');
  void burst.offsetWidth; // restart the animation
  burst.classList.add('go');
}

$$('input[name="package"]').forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    state.pkg = CONFIG.packages[input.value];
    state.placed = false;

    fireBurst(input.nextElementSibling);
    setDetailsLocked(false);
    primeSummary();
    renderGate();
    showMobileBar(true);

    // Auto-focus the UID field, but only on the very first selection —
    // re-opening the keyboard every time someone compares packages is hostile.
    if (!uidAutoFocused && uidInput) {
      uidAutoFocused = true;
      detailsStep?.scrollIntoView({
        behavior: prefersReduced() ? 'auto' : 'smooth',
        block: 'start',
      });
      setTimeout(() => uidInput.focus({ preventScroll: true }), prefersReduced() ? 0 : 420);
    }
  });
});

/* ==========================================================================
   UID validation
   ========================================================================== */
function setUidState(status, message) {
  if (!uidInput) return;
  if (status) uidInput.dataset.state = status;
  else delete uidInput.dataset.state;

  uidInput.setAttribute('aria-invalid', status === 'invalid' ? 'true' : 'false');

  if (uidHint) {
    if (status) uidHint.dataset.state = status;
    else delete uidHint.dataset.state;
    const iconUse = $('use', uidHint);
    iconUse?.setAttribute(
      'href',
      status === 'valid' ? '#i-check' : status === 'invalid' ? '#i-alert' : '#i-info',
    );
    if (uidHintText) uidHintText.textContent = message;
  }
  if (uidRetry) uidRetry.classList.toggle('hidden', !/temporarily|busy|retry/i.test(message));

  if (uidIcon) uidIcon.classList.toggle('hidden', status !== 'valid');
  if (uidIcon) uidIcon.classList.toggle('text-ok', status === 'valid');
}

let uidLookupTimer;
let uidLookupRequest = 0;
async function lookupUid(uid) {
  const request = ++uidLookupRequest;
  clearTimeout(uidLookupTimer);
  if (!/^\d{8,12}$/.test(uid)) {
    state.uidLookup = 'idle';
    return;
  }
  uidLookupTimer = setTimeout(async () => {
    state.uidLookup = 'checking';
    setUidState(null, 'Checking UID…');
    try {
      const response = await fetch(`/api/player-info?region=ind&uid=${encodeURIComponent(uid)}`);
      const result = await response.json().catch(() => ({}));
      if (request !== uidLookupRequest || state.uid !== uid) return;
      if (result.status === 'VALID') {
        state.uidLookup = 'valid';
        const nickname = result.nickname || result.username;
        if (nickname) {
          state.nickname = nickname;
          if (nicknameInput) nicknameInput.value = nickname;
        }
        const regionNames = {
          IND: 'India', India: 'India',
          SG: 'Singapore', Singapore: 'Singapore',
          BR: 'Brazil', Brazil: 'Brazil',
          ID: 'Indonesia', Indonesia: 'Indonesia',
          ME: 'Middle East', 'Middle East': 'Middle East',
        };
        const detectedRegion = regionNames[String(result.region || '').trim()];
        if (detectedRegion && regionSelect) {
          state.region = detectedRegion;
          regionSelect.value = detectedRegion;
        }
        setUidState('valid', nickname ? `UID found — ${nickname}` : 'UID verified — player found.');
        renderSummary();
      } else if (result.status === 'INVALID') {
        state.uidLookup = 'invalid';
        setUidState('invalid', 'This UID was not found for the selected region.');
      } else {
        state.uidLookup = 'unknown';
        setUidState(null, 'UID format is valid, but account lookup is temporarily unavailable.');
      }
    } catch {
      if (request === uidLookupRequest && state.uid === uid) {
        state.uidLookup = 'unknown';
        setUidState(null, 'UID format is valid, but account lookup is temporarily unavailable.');
      }
    }
  }, 350);
}

function shakeUid() {
  if (!uidWrap || prefersReduced()) return;
  uidWrap.classList.remove('shake');
  void uidWrap.offsetWidth;
  uidWrap.classList.add('shake');
  uidWrap.addEventListener('animationend', () => uidWrap.classList.remove('shake'), {
    once: true,
  });
}

const UID_DEFAULT_HINT = `${CONFIG.uid.minLength}–${CONFIG.uid.maxLength} digits. Find it under your profile picture in-game.`;

function validateUid({ strict = false } = {}) {
  if (!uidInput) return;
  const raw = uidInput.value;
  const digits = raw.replace(/\D/g, '').slice(0, CONFIG.uid.maxLength);

  if (digits !== raw) {
    const pos = uidInput.selectionStart;
    uidInput.value = digits;
    // Keep the caret where the user left it after stripping stray characters.
    if (pos != null) uidInput.setSelectionRange(pos - 1, pos - 1);
  }

  state.uid = digits;
  state.uidValid = digits.length >= CONFIG.uid.minLength;
  if (!state.uidValid) state.uidLookup = 'idle';

  if (!digits) {
    setUidState(strict ? 'invalid' : null, strict ? 'Your Free Fire UID is required.' : UID_DEFAULT_HINT);
  } else if (state.uidValid) {
    setUidState('valid', `Looks right — ${digits.length} digits.`);
  } else if (strict) {
    setUidState('invalid', `Too short. A Free Fire UID is ${CONFIG.uid.minLength}–${CONFIG.uid.maxLength} digits.`);
  } else {
    // Mid-typing: report progress rather than scolding.
    setUidState(null, `${digits.length} of ${CONFIG.uid.minLength} digits minimum.`);
  }

  renderSummary();
  renderGate();
  if (state.uidValid) lookupUid(digits);
}

uidInput?.addEventListener('input', () => validateUid());
uidInput?.addEventListener('blur', () => validateUid({ strict: true }));
uidRetry?.addEventListener('click', () => lookupUid(state.uid));

regionSelect?.addEventListener('change', () => {
  state.region = regionSelect.value;
  renderSummary();
});

nicknameInput?.addEventListener('input', () => {
  state.nickname = nicknameInput.value.trim();
  renderSummary();
});

/* ==========================================================================
   Payment selection
   ========================================================================== */
$$('input[name="payment"]').forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    state.payment = input.value;
    const appLabel = $('[data-selected-upi-app]');
    if (appLabel) appLabel.textContent = input.value === 'UPI' ? 'UPI app' : input.value;
    renderSummary();
    renderGate();
  });
});

/* ==========================================================================
   Checkout
   ========================================================================== */
const confirmModal = $('#confirmModal');
const confirmPayBtn = $('#confirmPay');

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (state.placed) return;

  const missing = blockers();
  if (missing.length) {
    toast(`Almost there — ${missing.join(' and ')}.`, { type: 'error' });
    if (!state.pkg) {
      $('#packages')?.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth' });
    } else {
      validateUid({ strict: true });
      shakeUid();
      uidInput?.focus();
    }
    return;
  }

  renderSummary();
  openDialog(confirmModal);
});

$$('[data-confirm-cancel]').forEach((btn) =>
  btn.addEventListener('click', () => closeDialog(confirmModal)),
);

/* ==========================================================================
   Scan & Pay — gateway-free UPI verification.
   scan → wait → done / fail, with a WhatsApp fallback when the
   verification service is unreachable.
   ========================================================================== */
const payModal = $('#payModal');
const utrInput = $('#utr');
const utrWrap = $('#utrWrap');
const utrHint = $('#utrHint');
const utrHintText = utrHint?.querySelector('span');
const paySubmit = $('#paySubmit');
const paySubmitLabel = $('[data-pay-submit-label]');

const UTR_DEFAULT_HINT =
  'After paying, open the transaction in your UPI app — the UTR (or "UPI Ref ID") is on the receipt.';

const payCfg = { verification: false, upiId: null };
let payPoll = null;
let activeOrderId = null;

fetch(CONFIG.api.payConfig)
  .then((r) => r.json())
  .then((d) => {
    if (!d?.ok) return;
    payCfg.verification = Boolean(d.verification);
    payCfg.upiId = d.upiId;
    const row = $('[data-pay-upirow]');
    if (payCfg.upiId && row) {
      const code = $('[data-pay-upi]');
      if (code) code.textContent = payCfg.upiId;
      row.classList.remove('hidden');
      row.classList.add('flex');
    }
  })
  .catch(() => {});

$('[data-copy-upi]')?.addEventListener('click', async (event) => {
  try {
    await navigator.clipboard.writeText(payCfg.upiId ?? '');
    event.target.textContent = 'Copied!';
    setTimeout(() => (event.target.textContent = 'Copy'), 1600);
  } catch {
    /* clipboard blocked — the id is visible to copy by hand */
  }
});

// Open the buyer's selected UPI app with the exact package amount pre-filled.
// The QR remains available as a fallback on devices/browsers that block intents.
const UPI_APP_PACKAGES = {
  'PhonePe': 'com.phonepe.app',
  'Google Pay': 'com.google.android.apps.nbu.paisa.user',
  'Paytm': 'net.one97.paytm',
};

function openSelectedUpiApp() {
  if (!payCfg.upiId) {
    toast('UPI ID is not configured yet. Please scan the QR code instead.', { type: 'info' });
    return;
  }
  if (!state.pkg) return;

  const params = new URLSearchParams({
    pa: payCfg.upiId,
    pn: payCfg.payeeName || CONFIG.brand,
    am: state.pkg.price.toFixed(2),
    cu: 'INR',
    tn: `DiamondVault ${state.pkg.label} — UID ${state.uid}`,
  });
  const query = params.toString();
  const packageName = UPI_APP_PACKAGES[state.payment];
  const paymentUrl = packageName
    ? `intent://pay?${query}#Intent;scheme=upi;package=${packageName};end`
    : `upi://pay?${query}`;

  window.location.href = paymentUrl;
}

$('[data-open-upi-app]').forEach((button) => {
  button.addEventListener('click', openSelectedUpiApp);
});

function setStage(stage) {
  $$('[data-stage-panel]', payModal).forEach((panel) => {
    panel.hidden = panel.dataset.stagePanel !== stage;
  });
}

function shakeEl(el) {
  if (!el || prefersReduced()) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
}

function setUtrState(status, message) {
  if (!utrInput) return;
  if (status) utrInput.dataset.state = status;
  else delete utrInput.dataset.state;
  utrInput.setAttribute('aria-invalid', status === 'invalid' ? 'true' : 'false');
  if (utrHint) {
    if (status) utrHint.dataset.state = status;
    else delete utrHint.dataset.state;
    const iconUse = $('use', utrHint);
    iconUse?.setAttribute(
      'href',
      status === 'valid' ? '#i-check' : status === 'invalid' ? '#i-alert' : '#i-info',
    );
    if (utrHintText) utrHintText.textContent = message;
  }
}

function validateUtr() {
  if (!utrInput) return '';
  const digits = utrInput.value.replace(/\D/g, '').slice(0, 12);
  if (digits !== utrInput.value) utrInput.value = digits;
  const complete = digits.length === 12;
  if (paySubmit) paySubmit.disabled = !complete;
  if (paySubmitLabel) {
    paySubmitLabel.textContent = complete
      ? `Verify payment of ${money0.format(state.pkg?.price ?? 0)}`
      : digits
        ? `${digits.length} of 12 digits`
        : 'Enter the UTR to verify';
  }
  if (complete) setUtrState('valid', 'Looks right — verify once the money has left your app.');
  else setUtrState(null, UTR_DEFAULT_HINT);
  return digits;
}

utrInput?.addEventListener('input', validateUtr);

confirmPayBtn?.addEventListener('click', () => {
  closeDialog(confirmModal);
  renderSummary();
  if (utrInput) utrInput.value = '';
  setUtrState(null, UTR_DEFAULT_HINT);
  validateUtr();

  const prepStatus = $('#prepStatus');
  if (prepStatus) prepStatus.textContent = `Connecting for UID ${state.uid}...`;
  
  const upiQrCode = $('#upiQrCode');
  if (upiQrCode && state.pkg) {
    const amount = state.pkg.price;
    const qrMap = {
      38: '/assets/38rs.png',
      118: '/assets/118rs.png',
      198: '/assets/198rs.png',
      404: '/assets/404rs.png'
    };
    upiQrCode.src = qrMap[amount] || '/assets/38rs.png';
  }

  setStage('prep');
  openDialog(payModal);

  setTimeout(() => {
    if (prepStatus) prepStatus.textContent = `Reserving ${state.pkg?.diamonds ?? ''} Diamonds for UID ${state.uid}...`;
  }, 600);

  setTimeout(() => {
    setStage('scan');
  }, 1500);
});

function waFallbackLink() {
  const pack = state.pkg;
  const text = [
    'NEW ORDER — DiamondVault',
    `Pack: ${pack.label} (₹${pack.price})`,
    `UID: ${state.uid} (${state.region})`,
    state.nickname ? `Nick: ${state.nickname}` : null,
    `Via: ${state.payment ?? 'UPI'}`,
    `UTR: ${utrInput?.value ?? ''}`,
  ]
    .filter(Boolean)
    .join('\n');
  return `${CONFIG.support.whatsapp}?text=${encodeURIComponent(text)}`;
}

function resetPaySubmit() {
  if (paySubmit) paySubmit.disabled = false;
  validateUtr();
}

function goOffline() {
  const link = $('#payWaLink');
  if (link) link.href = waFallbackLink();
  setStage('offline');
}

async function submitOrder() {
  const utr = validateUtr();
  if (utr.length !== 12) {
    shakeEl(utrWrap);
    return;
  }
  paySubmit.disabled = true;
  if (paySubmitLabel) {
    paySubmitLabel.innerHTML =
      '<span class="spinner h-4 w-4 align-[-2px]"></span> <span class="ml-2">Sending…</span>';
  }

  try {
    const res = await fetch(CONFIG.api.order, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageId: state.pkg.id,
        uid: state.uid,
        region: state.region,
        nickname: state.nickname || '',
        paymentMethod: state.payment ?? 'UPI',
        utr,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 201 && data.ok) {
      activeOrderId = data.orderId;
      try {
        localStorage.setItem('dv-order', activeOrderId);
      } catch {
        /* storage blocked — polling still works this session */
      }
      $$('[data-pay-orderid]').forEach((el) => (el.textContent = activeOrderId));
      state.placed = 'pending';
      renderGate();
      if (blockersEl) {
        blockersEl.textContent = `Order ${activeOrderId} sent — awaiting payment verification.`;
      }
      setStage('wait');
      startPolling(activeOrderId);
    } else if (data.field === 'utr') {
      // Editing the field re-validates and re-enables the button.
      setUtrState('invalid', data.message ?? 'This UTR was not accepted.');
      shakeEl(utrWrap);
      if (paySubmitLabel) paySubmitLabel.textContent = 'Enter a different UTR';
      if (paySubmit) paySubmit.disabled = true;
    } else if (res.status === 429) {
      toast(data.message ?? 'Too many attempts — wait a few minutes.', { type: 'error' });
      resetPaySubmit();
    } else {
      goOffline();
    }
  } catch {
    goOffline();
  }
}

paySubmit?.addEventListener('click', submitOrder);

function startPolling(orderId) {
  clearInterval(payPoll);
  payPoll = setInterval(async () => {
    try {
      const res = await fetch(`${CONFIG.api.order}?id=${orderId}`);
      if (res.status === 404) {
        clearInterval(payPoll);
        try {
          localStorage.removeItem('dv-order');
        } catch {}
        return;
      }
      const data = await res.json();
      if (data.status === 'approved') {
        clearInterval(payPoll);
        onVerified(orderId);
      } else if (data.status === 'rejected') {
        clearInterval(payPoll);
        onRejected(orderId);
      }
    } catch {
      /* transient network hiccup — keep polling */
    }
  }, CONFIG.pollMs);
}

function onVerified(orderId) {
  try {
    localStorage.removeItem('dv-order');
  } catch {}
  state.placed = true;
  renderGate();
  if (blockersEl) {
    blockersEl.innerHTML = `Order <strong class="tnum font-semibold text-ink">${orderId}</strong> confirmed — diamonds arrive in 1–5 minutes.`;
  }
  $$('[data-pay-orderid]').forEach((el) => (el.textContent = orderId));
  const receipt = $('[data-pay-receipt]');
  if (receipt) {
    receipt.href = `${CONFIG.support.whatsapp}?text=${encodeURIComponent(
      `Hi! Please send my receipt for order ${orderId}.`,
    )}`;
  }
  setStage('done');
  if (payModal && !payModal.open) openDialog(payModal);
  toast(`Payment for order ${orderId} verified — diamonds are on the way!`, {
    type: 'success',
    title: 'Payment confirmed',
    duration: 9000,
  });
}

function onRejected(orderId) {
  try {
    localStorage.removeItem('dv-order');
  } catch {}
  state.placed = false;
  renderGate();
  $$('[data-pay-orderid]').forEach((el) => (el.textContent = orderId));
  setStage('fail');
  if (payModal && !payModal.open) openDialog(payModal);
}

$$('[data-pay-cancel], [data-pay-close]', payModal ?? undefined).forEach((btn) =>
  btn.addEventListener('click', () => closeDialog(payModal)),
);
payModal?.addEventListener('click', (event) => {
  if (event.target === payModal) closeDialog(payModal);
});

// Resume a pending order across reloads — the buyer may close the tab while
// we verify, and their confirmation should still land.
(() => {
  let saved = null;
  try {
    saved = localStorage.getItem('dv-order');
  } catch {}
  if (!saved) return;
  activeOrderId = saved;
  $$('[data-pay-orderid]').forEach((el) => (el.textContent = saved));
  state.placed = 'pending';
  renderGate();
  if (blockersEl) blockersEl.textContent = `Order ${saved} awaiting payment verification.`;
  toast(`Order ${saved} is still being verified — this page updates automatically.`, {
    type: 'info',
    duration: 7000,
  });
  startPolling(saved);
})();

/* ==========================================================================
   Live chat modal
   ========================================================================== */
const chatModal = $('#chatModal');
$$('[data-open-chat]').forEach((btn) =>
  btn.addEventListener('click', () => openDialog(chatModal)),
);
$$('[data-chat-close]').forEach((btn) =>
  btn.addEventListener('click', () => closeDialog(chatModal)),
);

// Click on the backdrop (outside the panel) closes either dialog.
[confirmModal, chatModal].forEach((dialog) => {
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
});

/* ==========================================================================
   Navigation
   ========================================================================== */
const navToggle = $('#navToggle');
const navMenu = $('#navMenu');
const navBg = $('[data-nav-bg]');

function setNavOpen(open) {
  if (!navMenu || !navToggle) return;
  navMenu.classList.toggle('hidden', !open);
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  $('[data-nav-open]', navToggle)?.classList.toggle('hidden', open);
  $('[data-nav-close]', navToggle)?.classList.toggle('hidden', !open);
}

navToggle?.addEventListener('click', () =>
  setNavOpen(navToggle.getAttribute('aria-expanded') !== 'true'),
);
$$('#navMenu a').forEach((a) => a.addEventListener('click', () => setNavOpen(false)));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setNavOpen(false);
});

/* ==========================================================================
   FAQ accordion
   ========================================================================== */
$$('.acc').forEach((acc) => {
  const btn = $('button', acc);
  btn?.addEventListener('click', () => {
    const open = acc.dataset.open !== 'true';
    acc.dataset.open = String(open);
    btn.setAttribute('aria-expanded', String(open));
  });
});

/* ==========================================================================
   Mobile total bar
   ========================================================================== */
const mobileBarToggle = $('#mobileBarToggle');
const mobileBarDetail = $('#mobileBarDetail');
const floatStack = $('#floatStack');
const desktop = window.matchMedia('(min-width: 1024px)');
let barVisible = false;

function syncFloatStack() {
  if (!floatStack || !mobileBar) return;
  const lifted = barVisible && !desktop.matches;
  floatStack.style.bottom = lifted ? `${mobileBar.offsetHeight + 16}px` : '';
}

function showMobileBar(show) {
  if (!mobileBar) return;
  barVisible = show;
  mobileBar.classList.toggle('translate-y-full', !show);
  syncFloatStack();
}

mobileBarToggle?.addEventListener('click', () => {
  const open = mobileBarDetail?.classList.contains('hidden');
  mobileBarDetail?.classList.toggle('hidden', !open);
  mobileBarToggle.setAttribute('aria-expanded', String(open));
  $('[data-mobile-chev]', mobileBarToggle)?.style.setProperty(
    'transform',
    open ? 'rotate(180deg)' : 'none',
  );
  syncFloatStack();
});

desktop.addEventListener('change', syncFloatStack);
window.addEventListener('resize', syncFloatStack, { passive: true });

/* ==========================================================================
   Scroll effects — back-to-top + navbar shadow, one rAF-throttled listener.
   ========================================================================== */
const backToTop = $('#backToTop');

backToTop?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: prefersReduced() ? 'auto' : 'smooth' });
});

let ticking = false;
window.addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const show = y > 640;
      backToTop?.classList.toggle('opacity-0', !show);
      backToTop?.classList.toggle('translate-y-2', !show);
      backToTop?.classList.toggle('pointer-events-none', !show);
      navBg?.classList.toggle('shadow-soft', y > 12);
      ticking = false;
    });
  },
  { passive: true },
);

/* ==========================================================================
   Scroll reveals
   ========================================================================== */
(() => {
  const items = $$('.reveal');
  const revealAll = () => items.forEach((el) => el.classList.add('in'));

  if (prefersReduced() || !('IntersectionObserver' in window)) return revealAll();

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  );

  items.forEach((el) => io.observe(el));

  // Failsafe: if anything goes wrong with the observer, nothing stays hidden.
  setTimeout(revealAll, 2000);
})();

/* ==========================================================================
   Timeline — the connecting line draws once the section is on screen.
   ========================================================================== */
(() => {
  const tl = $('#howTl');
  if (!tl) return;

  if (prefersReduced() || !('IntersectionObserver' in window)) {
    tl.dataset.in = 'true';
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      tl.dataset.in = 'true';
      io.disconnect();
    },
    { threshold: 0.25 },
  );
  io.observe(tl);
})();

/* ==========================================================================
   Count-up metrics
   ========================================================================== */
(() => {
  const counters = $$('[data-count]');
  if (!counters.length) return;

  const render = (el, value, decimals, suffix) => {
    el.textContent =
      new Intl.NumberFormat(CONFIG.locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value) + suffix;
  };

  const animate = (el) => {
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals ?? '0', 10);
    const suffix = el.dataset.suffix ?? '';
    if (Number.isNaN(target)) return;

    if (prefersReduced()) return render(el, target, decimals, suffix);

    const start = performance.now();
    const duration = 1300;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      render(el, target * eased, decimals, suffix);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  if (!('IntersectionObserver' in window)) {
    counters.forEach((el) =>
      render(el, parseFloat(el.dataset.count), parseInt(el.dataset.decimals ?? '0', 10), el.dataset.suffix ?? ''),
    );
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animate(entry.target);
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.4 },
  );
  counters.forEach((el) => io.observe(el));
})();

/* ==========================================================================
   Hero embers — sparks rising off an unseen fire. Pre-rendered glow sprites,
   DPR capped at 2, paused when the hero is off-screen or the tab is hidden.
   ========================================================================== */
(() => {
  const canvas = $('#particles');
  if (!canvas || prefersReduced()) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const COLORS = ['#F7B500', '#FF7A00', '#FFD269', '#3EC9FF'];
  const WEIGHTS = [0.34, 0.34, 0.2, 0.12]; // mostly fire, a little diamond blue
  let sprites = [];
  let particles = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = null;
  let onScreen = true;

  function pickSprite() {
    const r = Math.random();
    let acc = 0;
    for (let i = 0; i < WEIGHTS.length; i += 1) {
      acc += WEIGHTS[i];
      if (r <= acc) return sprites[i];
    }
    return sprites[0];
  }

  /** Pre-rendered glow sprites: far cheaper than shadowBlur per particle. */
  function buildSprites() {
    sprites = COLORS.map((color) => {
      const size = 32;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, color);
      grad.addColorStop(0.35, `${color}66`);
      grad.addColorStop(1, `${color}00`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      g.fill();
      return c;
    });
  }

  function makeParticle(spawnAnywhere) {
    return {
      x: Math.random() * width,
      y: spawnAnywhere ? Math.random() * height : height + 10 + Math.random() * 30,
      r: 0.9 + Math.random() * 2.6,
      vy: -(0.22 + Math.random() * 0.5),
      sway: 0.3 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
      freq: 0.4 + Math.random() * 0.8,
      a: 0.25 + Math.random() * 0.55,
      flick: 2 + Math.random() * 3,
      s: pickSprite(),
    };
  }

  function seed() {
    const count = Math.min(85, Math.max(22, Math.round(width / 18)));
    particles = Array.from({ length: count }, () => makeParticle(true));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function frame(now) {
    const t = now / 1000;
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.y += p.vy;
      p.x += Math.sin(t * p.freq + p.phase) * p.sway * 0.4;

      if (p.y < -24) {
        particles[i] = makeParticle(false);
        continue;
      }
      if (p.x < -24) p.x = width + 12;
      else if (p.x > width + 24) p.x = -12;

      // Embers flicker and dim as they climb.
      const climb = 1 - Math.max(0, Math.min(1, 1 - p.y / height));
      const flicker = 0.78 + 0.22 * Math.sin(t * p.flick + p.phase);
      const d = p.r * 6;
      ctx.globalAlpha = p.a * flicker * (0.35 + 0.65 * climb);
      ctx.drawImage(p.s, p.x - d / 2, p.y - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (raf == null && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function pause() {
    if (raf != null) cancelAnimationFrame(raf);
    raf = null;
  }

  buildSprites();
  resize();
  play();

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // Stop burning frames once the hero scrolls away or the tab is hidden —
  // and pause the hero's CSS ambience (smoke, float, shine) with it.
  const hero = $('#hero');
  new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    if (hero) hero.dataset.idle = String(!onScreen);
    onScreen ? play() : pause();
  }).observe(canvas);

  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  reduceMotion.addEventListener('change', (e) => {
    if (e.matches) {
      pause();
      ctx.clearRect(0, 0, width, height);
    } else play();
  });
})();

/* ==========================================================================
   Hero parallax — layers drift against pointer movement at their own depth.
   Fine pointers only; the loop runs only while settling.
   ========================================================================== */
(() => {
  const hero = $('#hero');
  const layers = $$('[data-plx]', hero ?? document);
  if (!hero || !layers.length || !finePointer.matches || prefersReduced()) return;

  const items = layers.map((el) => ({ el, depth: parseFloat(el.dataset.plx) || 0, x: 0, y: 0 }));
  let tx = 0;
  let ty = 0;
  let raf = null;

  function loop() {
    let settled = true;
    for (const it of items) {
      const gx = tx * it.depth;
      const gy = ty * it.depth * 0.7;
      it.x += (gx - it.x) * 0.07;
      it.y += (gy - it.y) * 0.07;
      if (Math.abs(gx - it.x) > 0.05 || Math.abs(gy - it.y) > 0.05) settled = false;
      it.el.style.transform = `translate3d(${it.x.toFixed(2)}px, ${it.y.toFixed(2)}px, 0)`;
    }
    raf = settled ? null : requestAnimationFrame(loop);
  }

  function wake() {
    if (raf == null) raf = requestAnimationFrame(loop);
  }

  hero.addEventListener(
    'pointermove',
    (event) => {
      const rect = hero.getBoundingClientRect();
      tx = (event.clientX - rect.left) / rect.width - 0.5;
      ty = (event.clientY - rect.top) / rect.height - 0.5;
      wake();
    },
    { passive: true },
  );

  hero.addEventListener('pointerleave', () => {
    tx = 0;
    ty = 0;
    wake();
  });
})();

/* ==========================================================================
   Package card tilt — a shallow 3D lean toward the pointer.
   ========================================================================== */
(() => {
  if (!finePointer.matches || prefersReduced()) return;

  $$('[data-tilt]').forEach((card) => {
    let raf = null;

    card.addEventListener(
      'pointermove',
      (event) => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          const rect = card.getBoundingClientRect();
          const px = (event.clientX - rect.left) / rect.width - 0.5;
          const py = (event.clientY - rect.top) / rect.height - 0.5;
          card.style.transform =
            `perspective(900px) rotateX(${(-py * 7).toFixed(2)}deg) ` +
            `rotateY(${(px * 9).toFixed(2)}deg) translateY(-4px)`;
        });
      },
      { passive: true },
    );

    card.addEventListener('pointerleave', () => {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      card.style.transform = '';
    });
  });
})();

/* ==========================================================================
   Magnetic CTAs — primary buttons lean a few pixels toward the pointer.
   ========================================================================== */
(() => {
  if (!finePointer.matches || prefersReduced()) return;

  $$('[data-mag]').forEach((btn) => {
    const strength = 10;

    btn.addEventListener(
      'pointermove',
      (event) => {
        const rect = btn.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width - 0.5;
        const py = (event.clientY - rect.top) / rect.height - 0.5;
        btn.style.transform = `translate(${(px * strength).toFixed(1)}px, ${(py * strength).toFixed(1)}px)`;
      },
      { passive: true },
    );

    btn.addEventListener('pointerleave', () => {
      btn.style.transform = '';
    });
  });
})();

/* ==========================================================================
   Cursor glow — a warm light trailing the pointer. The loop stops as soon as
   the glow catches up.
   ========================================================================== */
(() => {
  const glow = $('#cursorGlow');
  if (!glow || !finePointer.matches || prefersReduced()) return;

  let tx = -280;
  let ty = -280;
  let cx = tx;
  let cy = ty;
  let raf = null;
  let shown = false;

  function loop() {
    cx += (tx - cx) * 0.14;
    cy += (ty - cy) * 0.14;
    glow.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
    raf = Math.abs(tx - cx) > 0.4 || Math.abs(ty - cy) > 0.4 ? requestAnimationFrame(loop) : null;
  }

  window.addEventListener(
    'pointermove',
    (event) => {
      tx = event.clientX;
      ty = event.clientY;
      if (!shown) {
        shown = true;
        cx = tx;
        cy = ty;
        glow.style.opacity = '1';
      }
      if (raf == null) raf = requestAnimationFrame(loop);
    },
    { passive: true },
  );

  document.documentElement.addEventListener('pointerleave', () => {
    glow.style.opacity = '0';
    shown = false;
  });
})();

/* ==========================================================================
   Promo tiles — "Claim best value" pre-selects the 1000 pack on its way to
   the checkout anchor.
   ========================================================================== */
$$('[data-select-pkg]').forEach((tile) => {
  tile.addEventListener('click', () => {
    const radio = $(`#pkg-${tile.dataset.selectPkg}`);
    if (radio && !radio.checked) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change'));
    }
  });
});

/* ==========================================================================
   Live stats — the one genuinely async number on the page.
   Replace with a real endpoint; the skeleton is already wired.
   ========================================================================== */
(async () => {
  const el = $('#deliveredToday');
  if (!el) return;
  await new Promise((r) => setTimeout(r, 700));
  const base = 820 + Math.floor(Math.random() * 180);
  el.textContent = num.format(base);
})();

/* ==========================================================================
   Boot
   ========================================================================== */
$$('[data-contact="whatsapp"]').forEach((a) => (a.href = CONFIG.support.whatsapp));
$$('[data-contact="discord"]').forEach((a) => (a.href = CONFIG.support.discord));
$$('[data-contact="email"]').forEach((a) => (a.href = `mailto:${CONFIG.support.email}`));

// The details step starts locked; without JS it is simply always available.
setDetailsLocked(true);
if (regionSelect) state.region = regionSelect.value;
renderSummary();
renderGate();

// Restore state on a bfcache back-navigation, where inputs keep their values
// but our in-memory state object does not.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  const checkedPkg = $('input[name="package"]:checked');
  if (checkedPkg) {
    state.pkg = CONFIG.packages[checkedPkg.value];
    setDetailsLocked(false);
    showMobileBar(true);
  }
  const checkedPay = $('input[name="payment"]:checked');
  state.payment = checkedPay ? checkedPay.value : null;
  if (uidInput) validateUid();
  renderSummary();
  renderGate();
});
