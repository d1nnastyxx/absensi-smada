import { db, getWibNow, genId, requireRole, getConfig, MAX_POINTS, checkTx, saveTx } from './_core.js';

// ==========================================
// STANDBY: GOOGLE DRIVE API (Aktif jika STORAGE_PROVIDER=gdrive)
// ==========================================
async function getDriveAccessToken() {
  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Konfigurasi Google Drive API (GDRIVE_*) belum diisi.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || 'Gagal mendapatkan token Google Drive');
  }
  return data.access_token;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const sess = await requireRole(req, res, ['super_admin', 'user']);
      if (!sess) return;

      const all = await db.getLogs('reports', 300);

      if (sess.role === 'super_admin' || sess.role === 'root_admin') {
        return res.status(200).json({ reports: all });
      }

      const mine = all
        .filter(r => r.reporterId === sess.id)
        .map(({ reporterId, reporterName, ...safe }) => safe);
      return res.status(200).json({ reports: mine });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const body = req.body || {};
    const action = String(body.action || 'submit');

    // 1. CEK PROVIDER UPLOAD (Default: vercel | Standby: gdrive)
    if (action === 'init_upload') {
      const sess = await requireRole(req, res, ['user', 'tatib', 'super_admin']);
      if (!sess) return;

      const provider = (process.env.STORAGE_PROVIDER || 'vercel').toLowerCase();
      if (provider !== 'gdrive') {
        return res.status(200).json({ provider: 'vercel' });
      }

      // Alur Google Drive Resumable Upload (hanya jalan jika STORAGE_PROVIDER=gdrive)
      const fileName = String(body.fileName || 'bukti').replace(/[^a-zA-Z0-9._-]/g, '_');
      const mimeType = String(body.mimeType || 'application/octet-stream');
      const folderId = process.env.GDRIVE_FOLDER_ID || '';
      const accessToken = await getDriveAccessToken();

      const metadata = { name: `${Date.now()}_${sess.id}_${fileName}` };
      if (folderId) metadata.parents = [folderId];

      const origin = req.headers.origin || `https://${req.headers.host}`;
      const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          Origin: origin
        },
        body: JSON.stringify(metadata)
      });

      const uploadUrl = initRes.headers.get('location');
      if (!initRes.ok || !uploadUrl) {
        const errText = await initRes.text();
        return res.status(500).json({ error: `Gagal inisialisasi upload Drive: ${errText}` });
      }

      return res.status(200).json({ provider: 'gdrive', uploadUrl });
    }

    // 2. UPLOAD BAWAAN VERCEL (Vercel Blob jika aktif, atau fallback Data URL untuk file kecil)
    if (action === 'upload_vercel') {
      const sess = await requireRole(req, res, ['user', 'tatib', 'super_admin']);
      if (!sess) return;

      const fileName = String(body.fileName || 'bukti').replace(/[^a-zA-Z0-9._-]/g, '_');
      const mimeType = String(body.mimeType || 'application/octet-stream');
      const dataUrl = String(body.dataUrl || '');
      if (!dataUrl.startsWith('data:')) {
        return res.status(400).json({ error: 'Format file tidak valid' });
      }

      const base64Part = dataUrl.split(',')[1] || '';
      const buffer = Buffer.from(base64Part, 'base64');

      // Jika Vercel Blob sudah dibuat di dashboard Vercel
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
      if (blobToken) {
        const blobRes = await fetch(`https://blob.vercel-storage.com/bukti/${Date.now()}_${sess.id}_${fileName}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${blobToken}`,
            'x-content-type': mimeType,
            'x-add-random-suffix': '1'
          },
          body: buffer
        });
        const blobData = await blobRes.json();
        if (!blobRes.ok || !blobData.url) {
          return res.status(500).json({ error: blobData.error?.message || 'Gagal upload ke Vercel Blob' });
        }
        return res.status(200).json({ name: fileName, type: mimeType, url: blobData.url });
      }

      // Fallback tanpa setup: simpan Data URL langsung (maks 1.5 MB)
      if (buffer.length > 1.5 * 1024 * 1024) {
        return res.status(413).json({
          error: 'Ukuran file melebihi 1,5 MB. Aktifkan Vercel Blob atau Google Drive untuk file besar.'
        });
      }
      return res.status(200).json({ name: fileName, type: mimeType, url: dataUrl });
    }

    // 3. KIRIM LAPORAN RAHASIA + BUKTI (ANTI-SPAM)
    if (action === 'submit') {
      const sess = await requireRole(req, res, ['user', 'tatib', 'super_admin']);
      if (!sess) return;
      const cachedTx = await checkTx(body.txId);
      if (cachedTx) return res.status(200).json(cachedTx);

      const now = getWibNow();
      const config = await getConfig();
      const limitKey = `rep_limit:${now.date}:${sess.id}`;
      const todayCount = Number((await db.get(limitKey)) || 0);

      if (sess.role === 'user' && todayCount >= config.maxReportsPerDay) {
        return res.status(429).json({ error: `Batas maksimal ${config.maxReportsPerDay} laporan per hari tercapai.` });
      }

      const reportedNisn = String(body.reportedNisn || '').trim();
      const reportedName = String(body.reportedName || '').trim();
      const chronology = String(body.chronology || '').trim().slice(0, 1000);
      const evidences = Array.isArray(body.evidences) ? body.evidences.slice(0, 5) : [];

      if ((!reportedNisn && !reportedName) || chronology.length < 10) {
        return res.status(400).json({ error: 'Identitas terlapor dan kronologi (minimal 10 karakter) wajib diisi.' });
      }

      const targetMember = reportedNisn ? await db.getItem('members', reportedNisn) : null;

      const report = {
        id: genId(8),
        reporterId: sess.id,
        reporterName: sess.fullName,
        reporterRole: sess.role,
        reportedNisn: targetMember?.nisn || reportedNisn,
        reportedName: targetMember?.name || reportedName,
        reportedKelas: targetMember?.kelas || String(body.reportedKelas || ''),
        chronology,
        evidences,
        status: 'pending',
        createdAt: now.full
      };

      await Promise.all([
        db.pushLog('reports', report, 500),
        db.set(limitKey, todayCount + 1, 86400)
      ]);

      const out = { ok: true, reportId: report.id };
      await saveTx(body.txId, out);
      return res.status(200).json(out);
    }

    // 4. VERIFIKASI LAPORAN (KHUSUS SUPER ADMIN)
    if (action === 'verify') {
      const sess = await requireRole(req, res, ['super_admin']);
      if (!sess) return;

      const id = String(body.id || '').trim();
      const decision = body.decision === 'valid' ? 'valid' : 'rejected';
      const reviewNote = String(body.reviewNote || '').trim().slice(0, 200);
      const ruleTitle = String(body.ruleTitle || 'Pelanggaran Terverifikasi dari Laporan').trim();
      const points = Math.max(0, Number(body.points || 0));

      const list = await db.getLogs('reports', 500);
      const idx = list.findIndex(r => r.id === id);
      if (idx < 0) return res.status(404).json({ error: 'Laporan tidak ditemukan' });

      const target = list[idx];
      if (target.status !== 'pending') return res.status(400).json({ error: 'Laporan sudah diverifikasi sebelumnya' });

      list[idx] = { ...target, status: decision, reviewNote, reviewedBy: sess.fullName, reviewedAt: getWibNow().full };

      await db.replaceLogs('reports', list);

      if (decision === 'valid' && target.reportedNisn && points > 0) {
        const member = await db.getItem('members', target.reportedNisn);
        if (member) {
          const nextPoints = Math.min(MAX_POINTS, Number(member.points || 0) + points);
          const autoViol = {
            id: genId(8),
            nisn: member.nisn,
            name: member.name,
            kelas: member.kelas || '',
            ruleTitle,
            points,
            notes: `Dari Laporan Terverifikasi #${target.id}`,
            status: 'approved',
            submittedBy: 'Laporan Rahasia (Terverifikasi)',
            reviewedBy: sess.fullName,
            createdAt: getWibNow().full
          };
          await Promise.all([
            db.setItem('members', member.nisn, { ...member, points: nextPoints }),
            db.pushLog('violations', autoViol, 1000)
          ]);
        }
      }

      return res.status(200).json({ ok: true, report: list[idx] });
    }

    return res.status(400).json({ error: 'Action tidak valid' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
