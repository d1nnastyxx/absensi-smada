import { db, hashSecret, genId, getWibNow, getSession, requireRole, getConfig } from './_core.js';

async function verifyCallerPassword(sess, confirmPassword) {
  const pass = String(confirmPassword || '');
  if (!pass) return false;
  const adminPass = process.env.ADMIN_PASS || process.env.admin_pass || 'admin123';
  if (sess.role === 'root_admin' && sess.id === 'admin') return pass === adminPass;
  const st = await db.getItem('staff', sess.id);
  return Boolean(st && st.active !== false && st.passHash === hashSecret(pass));
}

async function writeAudit(actor, action, target, detail = '') {
  await db.pushLog('audit_staff', {
    time: getWibNow().full,
    actor: `${actor.fullName} (${actor.id})`,
    role: actor.role,
    action,
    target,
    detail
  }, 200);
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const sess = await getSession(req);
      if (!sess) return res.status(401).json({ error: 'Belum login' });
      const config = await getConfig();
      let staff = [];
      let auditLogs = [];

      if (sess.role === 'root_admin' || sess.role === 'super_admin') {
        const [map, logs] = await Promise.all([db.getAll('staff'), db.getLogs('audit_staff', 50)]);
        staff = Object.entries(map).map(([username, u]) => ({
          username, fullName: u.fullName, role: u.role, active: u.active !== false
        })).sort((a, b) => a.username.localeCompare(b.username));
        auditLogs = logs;
      }

      return res.status(200).json({ user: sess, config, staff, auditLogs });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const body = req.body || {};
    const action = String(body.action || 'login');

    if (action === 'login') {
      const identifier = String(body.identifier || '').trim();
      const secret = String(body.secret || '');
      if (!identifier || !secret) return res.status(400).json({ error: 'ID dan Password/PIN wajib diisi' });

      const adminPass = process.env.ADMIN_PASS || process.env.admin_pass || 'admin123';
      let userObj = null;

      if (identifier.toLowerCase() === 'admin' && secret === adminPass) {
        userObj = { id: 'admin', fullName: 'Root Admin (Induk)', role: 'root_admin' };
      }
      if (!userObj) {
        const st = await db.getItem('staff', identifier.toLowerCase());
        if (st && st.active !== false && st.passHash === hashSecret(secret)) {
          userObj = { id: identifier.toLowerCase(), fullName: st.fullName, role: st.role };
        }
      }
      if (!userObj) {
        const m = await db.getItem('members', identifier);
        if (m && m.pinHash === hashSecret(secret)) {
          userObj = { id: m.nisn, fullName: m.name, kelas: m.kelas || '', type: m.type || 'siswa', role: 'user' };
        }
      }

      if (!userObj) return res.status(401).json({ error: 'Username/NISN atau Password/PIN salah' });

      const token = genId(24);
      await db.set(`sess:${token}`, userObj, 86400);
      return res.status(200).json({ token, user: userObj });
    }

    if (action === 'logout') {
      const token = req.headers['x-auth-token'];
      if (token) await db.del(`sess:${token}`);
      return res.status(200).json({ ok: true });
    }

    if (['save_staff', 'reset_staff_password', 'toggle_staff', 'delete_staff'].includes(action)) {
      const sess = await requireRole(req, res, ['super_admin']);
      if (!sess) return;
      if (!(await verifyCallerPassword(sess, body.confirmPassword))) {
        return res.status(403).json({ error: 'Konfirmasi password Anda salah.' });
      }

      const username = String(body.username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      if (!username || username === 'admin') return res.status(400).json({ error: 'Username tidak valid' });
      const existing = await db.getItem('staff', username);

      if (action === 'save_staff') {
        const fullName = String(body.fullName || '').trim();
        const role = String(body.role || 'tatib');
        const password = String(body.password || '');
        if (!fullName || !['super_admin', 'tatib', 'viewer'].includes(role)) return res.status(400).json({ error: 'Data staff tidak valid' });
        if (sess.role !== 'root_admin' && (role === 'super_admin' || existing?.role === 'super_admin')) {
          return res.status(403).json({ error: 'Hanya Root Admin yang dapat mengelola akun Super Admin.' });
        }
        if (!existing && password.length < 4) return res.status(400).json({ error: 'Password minimal 4 karakter' });

        await db.setItem('staff', username, {
          fullName, role, active: existing ? existing.active !== false : true,
          passHash: password ? hashSecret(password) : existing.passHash
        });
        await writeAudit(sess, existing ? 'EDIT_STAFF' : 'CREATE_STAFF', username, `Role: ${role}`);
        return res.status(200).json({ ok: true });
      }

      if (!existing) return res.status(404).json({ error: 'Akun staff tidak ditemukan' });
      if (sess.role !== 'root_admin' && existing.role === 'super_admin') {
        return res.status(403).json({ error: 'Hanya Root Admin yang dapat mengubah akun Super Admin.' });
      }

      if (action === 'reset_staff_password') {
        const newPassword = String(body.newPassword || '');
        if (newPassword.length < 4) return res.status(400).json({ error: 'Password baru minimal 4 karakter' });
        await db.setItem('staff', username, { ...existing, passHash: hashSecret(newPassword) });
        await writeAudit(sess, 'RESET_PASSWORD', username, `Role: ${existing.role}`);
      } else if (action === 'toggle_staff') {
        const nextActive = !(existing.active !== false);
        await db.setItem('staff', username, { ...existing, active: nextActive });
        await writeAudit(sess, nextActive ? 'ENABLE_STAFF' : 'DISABLE_STAFF', username, `Role: ${existing.role}`);
      } else if (action === 'delete_staff') {
        await db.delItem('staff', username);
        await writeAudit(sess, 'DELETE_STAFF', username, `Role: ${existing.role}`);
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'save_config') {
      const sess = await requireRole(req, res, ['super_admin']);
      if (!sess) return;
      const cur = await getConfig();
      const next = {
        ...cur,
        lateLimit: /^\d{2}:\d{2}$/.test(body.lateLimit) ? body.lateLimit : cur.lateLimit,
        checkoutStart: /^\d{2}:\d{2}$/.test(body.checkoutStart) ? body.checkoutStart : cur.checkoutStart,
        latePoints: Number.isFinite(Number(body.latePoints)) ? Number(body.latePoints) : cur.latePoints,
        maxReportsPerDay: Number.isFinite(Number(body.maxReportsPerDay)) ? Number(body.maxReportsPerDay) : cur.maxReportsPerDay
      };
      await db.set('config', next);
      return res.status(200).json({ ok: true, config: next });
    }

    if (action === 'clear_critical_log') {
      const sess = await requireRole(req, res, ['root_admin']);
      if (!sess) return;
      if (!(await verifyCallerPassword(sess, body.confirmPassword))) {
        return res.status(403).json({ error: 'Konfirmasi password Root Admin salah.' });
      }
      const target = String(body.target || '');
      const date = String(body.date || getWibNow().date);
      if (target === 'attendance') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Format tanggal salah' });
        await db.del(`att:${date}`);
        await writeAudit(sess, 'CLEAR_LOG', `att:${date}`, 'Hapus log absensi harian');
      } else if (target === 'violations') {
        await db.del('violations');
        await writeAudit(sess, 'CLEAR_LOG', 'violations', 'Hapus seluruh log pelanggaran');
      } else if (target === 'reports') {
        await db.del('reports');
        await writeAudit(sess, 'CLEAR_LOG', 'reports', 'Hapus seluruh log laporan rahasia');
      } else if (target === 'audit_staff') {
        await db.del('audit_staff');
        await writeAudit(sess, 'CLEAR_LOG', 'audit_staff', 'Audit log dibersihkan oleh Root Admin');
      } else {
        return res.status(400).json({ error: 'Target log tidak valid' });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action tidak dikenal' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
