import { db, hashSecret, genId, getWibNow, requireRole, getSanction } from './_core.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET' && req.query?.invite) {
      const code = String(req.query.invite).trim().toUpperCase();
      const inv = await db.getItem('invites', code);
      if (!inv || !inv.active) return res.status(404).json({ error: 'Link pendaftaran tidak valid atau sudah dicabut.' });
      if (Date.now() > Number(inv.expiresAt)) return res.status(410).json({ error: 'Masa aktif link pendaftaran sudah habis.' });
      if (Number(inv.used || 0) >= Number(inv.quota || 0)) return res.status(410).json({ error: 'Kuota pendaftaran kelas ini sudah penuh.' });
      return res.status(200).json({ code: inv.code, kelas: inv.kelas, remaining: inv.quota - inv.used, expiresAt: inv.expiresAt });
    }

    if (req.method === 'GET') {
      const sess = await requireRole(req, res, ['super_admin', 'tatib', 'viewer', 'user']);
      if (!sess) return;

      if (sess.role === 'user') {
        const me = await db.getItem('members', sess.id);
        if (!me) return res.status(404).json({ error: 'Profil tidak ditemukan' });
        const pts = Number(me.points || 0);
        return res.status(200).json({
          me: { nisn: me.nisn, name: me.name, kelas: me.kelas, type: me.type, uid: me.uid, points: pts, sanction: getSanction(pts) }
        });
      }

      const [memMap, pendMap, invMap] = await Promise.all([
        db.getAll('members'), db.getAll('pending_members'), db.getAll('invites')
      ]);

      const members = Object.values(memMap).map(m => {
        const pts = Number(m.points || 0);
        return { nisn: m.nisn, name: m.name, kelas: m.kelas || '', type: m.type || 'siswa', uid: m.uid || '', points: pts, sanction: getSanction(pts) };
      }).sort((a, b) => `${a.kelas}${a.name}`.localeCompare(`${b.kelas}${b.name}`));

      const pending = Object.values(pendMap);
      const invites = Object.values(invMap).sort((a, b) => b.createdAtMs - a.createdAtMs);
      return res.status(200).json({ members, pending, invites });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const body = req.body || {};
    const action = String(body.action || 'save');

    if (action === 'self_register') {
      const code = String(body.code || '').trim().toUpperCase();
      const nisn = String(body.nisn || '').trim();
      const name = String(body.name || '').trim().slice(0, 80);
      const pin = String(body.pin || '').trim();

      if (!/^\d{10}$/.test(nisn)) return res.status(400).json({ error: 'NISN harus tepat 10 digit angka.' });
      if (name.length < 3) return res.status(400).json({ error: 'Nama lengkap minimal 3 karakter.' });
      if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN harus berupa 4 sampai 6 digit angka.' });

      const inv = await db.getItem('invites', code);
      if (!inv || !inv.active) return res.status(403).json({ error: 'Link pendaftaran tidak valid atau sudah ditutup.' });
      if (Date.now() > Number(inv.expiresAt)) return res.status(403).json({ error: 'Masa aktif link pendaftaran telah berakhir.' });
      if (Number(inv.used || 0) >= Number(inv.quota || 0)) return res.status(403).json({ error: 'Kuota pendaftaran kelas ini sudah penuh.' });

      const [existsMember, existsPending] = await Promise.all([db.getItem('members', nisn), db.getItem('pending_members', nisn)]);
      if (existsMember) return res.status(409).json({ error: 'NISN ini sudah terdaftar aktif di sistem.' });
      if (existsPending) return res.status(409).json({ error: 'NISN ini sudah mendaftar dan menunggu verifikasi.' });

      const record = {
        nisn, name, kelas: inv.kelas, type: 'siswa', uid: '',
        pinHash: hashSecret(pin), points: 0, inviteCode: code, registeredAt: getWibNow().full
      };

      await Promise.all([
        db.setItem('pending_members', nisn, record),
        db.setItem('invites', code, { ...inv, used: Number(inv.used || 0) + 1 })
      ]);
      return res.status(200).json({ ok: true, message: 'Pendaftaran berhasil! Tunggu verifikasi Waka Kesiswaan/Tatib.' });
    }

    const sess = await requireRole(req, res, ['super_admin', 'tatib']);
    if (!sess) return;

    if (action === 'create_invite') {
      const kelas = String(body.kelas || '').trim().toUpperCase();
      const quota = Math.min(100, Math.max(1, Number(body.quota || 36)));
      const hours = Math.min(168, Math.max(1, Number(body.hours || 24)));
      if (!kelas) return res.status(400).json({ error: 'Nama kelas wajib diisi.' });
      const code = `${kelas.replace(/[^A-Z0-9]/g, '').slice(0, 5)}-${genId(2).toUpperCase()}`;
      const inv = { code, kelas, quota, used: 0, active: true, createdAtMs: Date.now(), expiresAt: Date.now() + hours * 3600 * 1000, createdBy: sess.fullName };
      await db.setItem('invites', code, inv);
      return res.status(200).json({ ok: true, invite: inv });
    }

    if (action === 'revoke_invite') {
      const code = String(body.code || '').trim().toUpperCase();
      const inv = await db.getItem('invites', code);
      if (inv) await db.setItem('invites', code, { ...inv, active: false });
      return res.status(200).json({ ok: true });
    }

    if (action === 'approve_pending') {
      const nisn = String(body.nisn || '').trim();
      const pend = await db.getItem('pending_members', nisn);
      if (!pend) return res.status(404).json({ error: 'Data antrean tidak ditemukan' });
      await Promise.all([db.setItem('members', nisn, pend), db.delItem('pending_members', nisn)]);
      return res.status(200).json({ ok: true });
    }

    if (action === 'approve_all_pending') {
      const pendMap = await db.getAll('pending_members');
      const count = Object.keys(pendMap).length;
      if (count > 0) await Promise.all([db.setItems('members', pendMap), db.del('pending_members')]);
      return res.status(200).json({ ok: true, count });
    }

    if (action === 'reject_pending') {
      await db.delItem('pending_members', String(body.nisn || '').trim());
      return res.status(200).json({ ok: true });
    }

    if (action === 'save') {
      const nisn = String(body.nisn || '').trim();
      const name = String(body.name || '').trim();
      const kelas = String(body.kelas || '').trim().toUpperCase();
      const type = body.type === 'guru' ? 'guru' : 'siswa';
      const uid = String(body.uid || '').trim().toUpperCase();
      const pin = String(body.pin || '').trim();

      if (!nisn || !name) return res.status(400).json({ error: 'NISN/NIP dan Nama wajib diisi.' });
      if (!/^\d{1,18}$/.test(nisn)) return res.status(400).json({ error: 'NISN/NIP hanya boleh berisi angka.' });
      if (pin && !/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN harus berupa 4 sampai 6 digit angka.' });

      if (uid) {
        const allMembers = await db.getAll('members');
        const dup = Object.values(allMembers).find(m => m.uid === uid && m.nisn !== nisn);
        if (dup) return res.status(409).json({ error: `UID ${uid} sudah terdaftar pada ${dup.name} (NISN: ${dup.nisn}).` });
      }

      const existing = await db.getItem('members', nisn);
      if (existing?.uid && existing.uid !== uid) await db.delItem('rfid_map', existing.uid);

      const record = {
        nisn, name, kelas, type, uid,
        pinHash: pin ? hashSecret(pin) : (existing?.pinHash || hashSecret(nisn.slice(-6))),
        points: Number(existing?.points || 0)
      };
      const tasks = [db.setItem('members', nisn, record)];
      // Simpan sebagai objek { nisn } agar Upstash Redis tidak menghapus angka 0 di depan
      if (uid) tasks.push(db.setItem('rfid_map', uid, { nisn }));
      await Promise.all(tasks);
      return res.status(200).json({ ok: true });
    }

    if (action === 'bulk_import') {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const memberBatch = {};
      const rfidBatch = {};
      let imported = 0;
      for (const r of rows) {
        const nisn = String(r.nisn || '').trim();
        const name = String(r.name || '').trim();
        if (!nisn || !name) continue;
        const uid = String(r.uid || '').trim().toUpperCase();
        const pin = String(r.pin || nisn.slice(-6)).trim();
        memberBatch[nisn] = { nisn, name, kelas: String(r.kelas || '').trim().toUpperCase(), type: r.type === 'guru' ? 'guru' : 'siswa', uid, pinHash: hashSecret(pin), points: 0 };
        if (uid) rfidBatch[uid] = { nisn };
        imported++;
      }
      if (imported > 0) {
        await db.setItems('members', memberBatch);
        if (Object.keys(rfidBatch).length > 0) await db.setItems('rfid_map', rfidBatch);
      }
      return res.status(200).json({ ok: true, imported });
    }

    if (action === 'delete') {
      const nisn = String(body.nisn || '').trim();
      const existing = await db.getItem('members', nisn);
      if (existing?.uid) await db.delItem('rfid_map', existing.uid);
      await db.delItem('members', nisn);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action tidak valid' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
