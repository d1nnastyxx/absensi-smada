export const $ = (id) => document.getElementById(id);

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function getToken() { return localStorage.getItem('v2_token') || ''; }
export function getUser() {
  try { return JSON.parse(localStorage.getItem('v2_user') || 'null'); } catch { return null; }
}
export function setAuth(token, user) {
  localStorage.setItem('v2_token', token);
  localStorage.setItem('v2_user', JSON.stringify(user));
}
export function clearAuth() {
  localStorage.removeItem('v2_token');
  localStorage.removeItem('v2_user');
}

export function requireRole(allowed) {
  const u = getUser();
  if (!getToken() || !u) {
    location.replace('/index.html');
    return null;
  }
  const eff = allowed.includes('super_admin') ? [...allowed, 'root_admin'] : allowed;
  if (!eff.includes(u.role)) {
    const dest = u.role === 'user' ? '/portal.html' : (u.role === 'tatib' ? '/tatib.html' : '/admin.html');
    location.replace(dest);
    return null;
  }
  return u;
}

// ==========================================
// OFFLINE QUEUE & AUTO-SYNC ENGINE
// ==========================================
const QUEUE_KEY = 'v2_offline_queue';
const QUEUEABLE_ACTIONS = new Set(['tap', 'manual', 'submit', 'add_reward']);
let isSyncing = false;

function getWibTimestamp() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);
}

function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}

function saveQueue(arr) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(arr));
  renderNetPill();
}

function renderNetPill(customText = '') {
  let pill = document.getElementById('v2NetPill');
  if (!pill && document.body) {
    pill = document.createElement('div');
    pill.id = 'v2NetPill';
    pill.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9999;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:600;background:#1e2430;color:#e9ecf1;border:1px solid #3c4454;box-shadow:0 4px 12px rgba(0,0,0,0.4);display:none;';
    document.body.appendChild(pill);
  }
  if (!pill) return;

  const count = getQueue().length;
  if (customText) {
    pill.textContent = customText;
    pill.style.display = 'block';
    return;
  }
  if (!navigator.onLine) {
    pill.textContent = count > 0 ? `Offline • ${count} data antre sync` : 'Mode Offline';
    pill.style.display = 'block';
  } else if (count > 0) {
    pill.textContent = `Menyinkronkan ${count} data...`;
    pill.style.display = 'block';
  } else {
    pill.style.display = 'none';
  }
}

export async function syncOfflineQueue() {
  if (isSyncing || !navigator.onLine) return;
  const q = getQueue();
  if (q.length === 0) return;

  isSyncing = true;
  renderNetPill(`Menyinkronkan ${q.length} data...`);

  const remaining = [];
  let synced = 0;

  for (let i = 0; i < q.length; i++) {
    const item = q[i];
    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = getToken();
      if (token) headers['x-auth-token'] = token;

      const res = await fetch(item.url, { method: 'POST', headers, body: JSON.stringify(item.body) });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429)) {
        synced++;
      } else {
        remaining.push(item, ...q.slice(i + 1));
        break;
      }
    } catch {
      remaining.push(item, ...q.slice(i + 1));
      break;
    }
  }

  saveQueue(remaining);
  isSyncing = false;

  if (synced > 0 && remaining.length === 0) {
    renderNetPill(`Sync selesai (${synced} data tersimpan)`);
    setTimeout(() => renderNetPill(), 3000);
  }
}

export async function api(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers['x-auth-token'] = token;

  let rawObj = null;
  if (opts.body && typeof opts.body === 'object') {
    rawObj = { ...opts.body };
    const isQueueable = (opts.method === 'POST') && QUEUEABLE_ACTIONS.has(String(rawObj.action || ''));
    if (isQueueable) {
      if (!rawObj.txId) rawObj.txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (!rawObj.offlineTime) rawObj.offlineTime = getWibTimestamp();
    }
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(rawObj);
  }

  try {
    const res = await fetch(url, { ...opts, headers });
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    if (!res.ok) {
      if (res.status === 401) { clearAuth(); location.replace('/index.html'); }
      throw new Error(data?.error || text || `HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    const isNetworkErr = !navigator.onLine || err instanceof TypeError;
    if (isNetworkErr && rawObj && opts.method === 'POST' && QUEUEABLE_ACTIONS.has(String(rawObj.action || ''))) {
      const q = getQueue();
      q.push({ url, body: rawObj, queuedAt: Date.now() });
      saveQueue(q);
      return { ok: true, offlineQueued: true, status: 'QUEUED', message: 'Offline: data disimpan lokal & akan otomatis sync saat online.' };
    }
    throw err;
  }
}

export async function logout() {
  try { await api('/api/auth', { method: 'POST', body: { action: 'logout' } }); } catch {}
  clearAuth();
  location.replace('/index.html');
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Gagal membaca file ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function uploadEvidence(file) {
  const init = await api('/api/reports', {
    method: 'POST',
    body: { action: 'init_upload', fileName: file.name, mimeType: file.type || 'application/octet-stream' }
  });

  if (init.provider === 'gdrive' && init.uploadUrl) {
    const putRes = await fetch(init.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    });
    if (!putRes.ok) throw new Error(`Gagal upload ${file.name} ke Google Drive`);
    const driveFile = await putRes.json();
    return {
      name: file.name,
      type: file.type || 'file',
      driveId: driveFile.id,
      url: `https://drive.google.com/file/d/${driveFile.id}/view`
    };
  }

  const dataUrl = await fileToDataUrl(file);
  return api('/api/reports', {
    method: 'POST',
    body: {
      action: 'upload_vercel',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      dataUrl
    }
  });
}

export const uploadEvidenceToDrive = uploadEvidence;

// Daftarkan Service Worker & Listener Auto-Sync
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    renderNetPill();
    syncOfflineQueue();
  });
}
window.addEventListener('online', () => { renderNetPill(); syncOfflineQueue(); });
window.addEventListener('offline', () => renderNetPill());

// Auto-tutup keyboard mobile saat submit form, tap di luar input, atau tekan Enter di filter
document.addEventListener('submit', () => {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}, true);

document.addEventListener('pointerdown', (e) => {
  const el = document.activeElement;
  if (!el || !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
  if (!e.target.closest('input, textarea, select, label')) {
    el.blur();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.target.closest('form')) {
    e.target.blur();
  }
});
