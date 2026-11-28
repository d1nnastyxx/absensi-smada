import { db, getWibNow, genId, isDevice, requireRole, getConfig, MAX_POINTS, checkTx, saveTx } from './_core.js';

function diffMinutes(hhmmA, hhmmB) {
  const [h1, m1] = String(hhmmA || '00:00').split(':').map(Number);
  const [h2, m2] = String(hhmmB || '00:00').split(':').map(Number);
  return (h1 * 60 + m1) - (h2 * 60 + m2);
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET' && isDevice(req)) {
      const now = getWibNow();
      return res.status(200).json({ ok: true, date: now.date, time: now.time });
    }

    if (req.method === 'GET') {
      const sess = await requireRole(req, res, ['super_admin', 'tatib', 'viewer', 'user']);
      if (!sess) return;

      const now = getWibNow();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.date) ? req.query.date : now.date;
      const filterKelas = String(req.query?.kelas || '').trim().toUpperCase();

      if (sess.role === 'user') {
        const history = await db.getLogs(`att_user:${sess.id}`, 60);
        return res.status(200).json({ date, history });
      }

      const [attObj, membersMap] = await Promise.all([db.getAll(`att:${date}`), db.getAll('members')]);
      const members = Object.values(membersMap)
        .filter(m => m.type !== 'guru')
        .filter(m => !filterKelas || m.kelas === filterKelas)
        .sort((a, b) => `${a.kelas}${a.name}`.localeCompare(`${b.kelas}${b.name}`));

      const records = members.map(m => {
        const rec = attObj[m.nisn] || null;
        return {
          nisn: m.nisn, name: m.name, kelas: m.kelas || '-',
          status: rec?.status || 'BELUM_TAP', checkIn: rec?.checkIn || '-',
          checkOut: rec?.checkOut || '-', lateMinutes: Number(rec?.lateMinutes || 0), notes: rec?.notes || ''
        };
      });

      if (req.query?.format === 'csv') {
        let csv = 'Tanggal,NISN,Nama,Kelas,Status,Masuk,Pulang,Telat(Menit),Keterangan\r\n';
        for (const r of records) {
          csv += `"${date}","${r.nisn}","${r.name.replace(/"/g, '""')}","${r.kelas}","${r.status}","${r.checkIn}","${r.checkOut}",${r.lateMinutes},"${r.notes.replace(/"/g, '""')}"\r\n`;
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=rekap-${date}${filterKelas ? '-' + filterKelas : ''}.csv`);
        return res.status(200).send(csv);
      }

      return res.status(200).json({ date, records });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const body = req.body || {};
    const action = String(body.action || 'tap');

    if (action === 'tap') {
      if (!isDevice(req)) {
        const sess = await requireRole(req, res, ['super_admin', 'tatib']);
        if (!sess) return;
      }

      const cachedTx = await checkTx(body.txId);
      if (cachedTx) return res.status(200).json(cachedTx);
      const uid = String(body.uid || '').trim().toUpperCase();
      const deviceId = String(body.deviceId || 'ESP32').trim().toUpperCase();

      // Cek apakah Admin sedang mengaktifkan Mode Scan Daftar Kartu
      if (uid) {
        const regMode = await db.get('reg_mode');
        if (regMode && regMode.active) {
          await Promise.all([
            db.set('pending_uid', { uid, deviceId, time: getWibNow().full }, 120),
            db.del('reg_mode')
          ]);
          return res.status(200).json({ status: 'REG_CAPTURE', uid });
        }
      }
      let nisn = String(body.nisn || '').trim();
      if (!nisn && uid) nisn = String((await db.getItem('rfid_map', uid)) || '');
      if (!nisn) {
        if (uid) await db.pushLog('unknown_logs', { uid, deviceId, time: getWibNow().full }, 200);
        return res.status(200).json({ status: 'UNKNOWN', uid });
      }

      const member = await db.getItem('members', nisn);
      if (!member) return res.status(200).json({ status: 'UNKNOWN', uid });

      const now = getWibNow();
      const offlineTime = String(body.offlineTime || '').trim();
      const isValidOffline = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(offlineTime);
      const date = isValidOffline ? offlineTime.substring(0, 10) : now.date;
      const time = isValidOffline ? offlineTime.substring(11, 19) : now.time;
      const hhmm = time.substring(0, 5);

      const config = await getConfig();
      const existing = await db.getItem(`att:${date}`, nisn);

      if (!existing) {
        const lateMinutes = Math.max(0, diffMinutes(hhmm, config.lateLimit));
        const isLate = lateMinutes > 0;
        const record = {
          date, nisn, name: member.name, kelas: member.kelas || '',
          status: isLate ? 'TERLAMBAT' : 'HADIR', checkIn: time, checkOut: '',
          lateMinutes, method: uid ? 'RFID' : 'QR', notes: isLate ? `Terlambat ${lateMinutes} menit` : ''
        };

        const tasks = [
          db.setItem(`att:${date}`, nisn, record),
          db.pushLog(`att_user:${nisn}`, record, 90)
        ];

        if (isLate && config.latePoints > 0) {
          const nextPoints = Math.min(MAX_POINTS, Number(member.points || 0) + config.latePoints);
          tasks.push(
            db.setItem('members', nisn, { ...member, points: nextPoints }),
            db.pushLog('violations', {
              id: genId(8), type: 'violation', nisn, name: member.name, kelas: member.kelas || '',
              ruleTitle: `Datang terlambat (${lateMinutes} menit)`, points: config.latePoints,
              notes: `Otomatis dari absensi ${date} ${time}`, status: 'approved',
              submittedBy: 'Sistem Absensi', reviewedBy: 'Sistem Otomatis', createdAt: `${date} ${time}`
            }, 1000)
          );
        }

        await Promise.all(tasks);
        const out = { status: 'OK', type: 'IN', name: member.name, time, late: isLate, lateMinutes };
        await saveTx(body.txId, out);
        return res.status(200).json(out);
      }

      if (existing.checkOut) return res.status(200).json({ status: 'DUP', name: member.name, message: 'Sudah absen masuk & pulang' });
      if (Math.abs(diffMinutes(hhmm, existing.checkIn.substring(0, 5))) < config.duplicateGapMin) {
        return res.status(200).json({ status: 'DUP', name: member.name, message: 'Tap duplikat diabaikan' });
      }
      if (diffMinutes(hhmm, config.checkoutStart) >= 0) {
        await db.setItem(`att:${date}`, nisn, { ...existing, checkOut: time });
        const out = { status: 'OK', type: 'OUT', name: member.name, time };
        await saveTx(body.txId, out);
        return res.status(200).json(out);
      }
      return res.status(200).json({ status: 'DUP', name: member.name, message: `Belum jam pulang (${config.checkoutStart})` });
    }

    if (action === 'manual') {
      const sess = await requireRole(req, res, ['super_admin', 'tatib']);
      if (!sess) return;
      const nisn = String(body.nisn || '').trim();
      const status = String(body.status || '').toUpperCase();
      const notes = String(body.notes || '').trim().slice(0, 200);
      const now = getWibNow();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : now.date;
      if (!['HADIR', 'TERLAMBAT', 'SAKIT', 'IZIN', 'ALFA'].includes(status)) return res.status(400).json({ error: 'Status tidak valid' });

      const member = await db.getItem('members', nisn);
      if (!member) return res.status(404).json({ error: 'Siswa tidak ditemukan' });

      const record = {
        date, nisn, name: member.name, kelas: member.kelas || '', status,
        checkIn: status === 'HADIR' || status === 'TERLAMBAT' ? now.time : '-', checkOut: '-',
        lateMinutes: 0, method: 'MANUAL', notes: notes || `Diinput oleh ${sess.fullName}`
      };
      await Promise.all([db.setItem(`att:${date}`, nisn, record), db.pushLog(`att_user:${nisn}`, record, 90)]);
      return res.status(200).json({ ok: true, record });
    }

    return res.status(400).json({ error: 'Action tidak valid' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
