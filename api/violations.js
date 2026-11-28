import { db, getWibNow, genId, requireRole, getConfig, MAX_POINTS, checkTx, saveTx } from './_core.js';

const OFFICIAL_RULES = [
  // A. SIKAP PERILAKU (33)
  { id: 'A01', category: 'Sikap Perilaku', title: 'Tidak membawa buku sesuai jadwal', points: 10 },
  { id: 'A02', category: 'Sikap Perilaku', title: 'Membuat kegaduhan di kelas atau di sekolah', points: 10 },
  { id: 'A03', category: 'Sikap Perilaku', title: 'Mencoret-coret / mengotori dinding, pintu, meja, kursi, pagar', points: 10 },
  { id: 'A04', category: 'Sikap Perilaku', title: 'Membawa atau bermain kartu remi / domino di sekolah', points: 10 },
  { id: 'A05', category: 'Sikap Perilaku', title: 'Memarkir sepeda/motor tidak pada tempatnya', points: 10 },
  { id: 'A06', category: 'Sikap Perilaku', title: 'Bermain bola di koridor dan di dalam kelas', points: 10 },
  { id: 'A07', category: 'Sikap Perilaku', title: 'Menyontek', points: 10 },
  { id: 'A08', category: 'Sikap Perilaku', title: 'Melindungi teman yang bersalah', points: 15 },
  { id: 'A09', category: 'Sikap Perilaku', title: 'Menghidupkan handphone waktu KBM', points: 20 },
  { id: 'A10', category: 'Sikap Perilaku', title: 'Berpacaran di sekolah', points: 20 },
  { id: 'A11', category: 'Sikap Perilaku', title: 'Berperilaku jorok atau asusila di dalam maupun di luar sekolah', points: 20 },
  { id: 'A12', category: 'Sikap Perilaku', title: 'Merayakan ulang tahun berlebihan', points: 20 },
  { id: 'A13', category: 'Sikap Perilaku', title: 'Menyalahgunakan uang SPP atau uang sekolah', points: 25 },
  { id: 'A14', category: 'Sikap Perilaku', title: 'Membawa atau membunyikan petasan', points: 30 },
  { id: 'A15', category: 'Sikap Perilaku', title: 'Membuat surat izin palsu', points: 40 },
  { id: 'A16', category: 'Sikap Perilaku', title: 'Meloncat jendela dan pagar sekolah', points: 40 },
  { id: 'A17', category: 'Sikap Perilaku', title: 'Merusak sarana dan prasarana sekolah', points: 40 },
  { id: 'A18', category: 'Sikap Perilaku', title: 'Bertindak tidak sopan / melecehkan Kepala Sekolah, guru, karyawan', points: 50 },
  { id: 'A19', category: 'Sikap Perilaku', title: 'Mengancam / mengintimidasi teman sekelas / teman sekolah', points: 75 },
  { id: 'A20', category: 'Sikap Perilaku', title: 'Mengancam / mengintimidasi Kepala Sekolah, guru, karyawan', points: 100 },
  { id: 'A21', category: 'Sikap Perilaku', title: 'Membawa / merokok saat masih mengenakan seragam sekolah', points: 100 },
  { id: 'A22', category: 'Sikap Perilaku', title: 'Berjudi dalam bentuk apapun di sekolah (Tingkat I)', points: 100 },
  { id: 'A23', category: 'Sikap Perilaku', title: 'Berjudi dalam bentuk apapun di sekolah (Berulang / Berat)', points: 150 },
  { id: 'A24', category: 'Sikap Perilaku', title: 'Membawa senjata tajam / senjata api di sekolah', points: 150 },
  { id: 'A25', category: 'Sikap Perilaku', title: 'Mengikuti aliran/geng terlarang, komunitas LGBT, radikalisme', points: 150 },
  { id: 'A26', category: 'Sikap Perilaku', title: 'Perkelahian / tawuran di sekolah maupun di luar sekolah', points: 150 },
  { id: 'A27', category: 'Sikap Perilaku', title: 'Membawa, menggunakan, atau mengedarkan miras dan narkoba', points: 250 },
  { id: 'A28', category: 'Sikap Perilaku', title: 'Membawa/membuat media pornografi atau pornoaksi', points: 250 },
  { id: 'A29', category: 'Sikap Perilaku', title: 'Mencuri di sekolah dan di luar sekolah', points: 200 },
  { id: 'A30', category: 'Sikap Perilaku', title: 'Memalsukan stempel, edaran, atau tanda tangan sekolah/guru', points: 250 },
  { id: 'A31', category: 'Sikap Perilaku', title: 'Terlibat tindakan kriminal / mencemarkan nama baik sekolah', points: 250 },
  { id: 'A32', category: 'Sikap Perilaku', title: 'Terbukti hamil atau menghamili', points: 250 },
  { id: 'A33', category: 'Sikap Perilaku', title: 'Terbukti menikah', points: 250 },

  // B. KERAJINAN (17)
  { id: 'B01', category: 'Kerajinan', title: 'Datang terlambat', points: 10 },
  { id: 'B02', category: 'Kerajinan', title: 'Tidak mengikuti pelajaran tanpa izin', points: 10 },
  { id: 'B03', category: 'Kerajinan', title: 'Meninggalkan kelas tanpa izin', points: 10 },
  { id: 'B04', category: 'Kerajinan', title: 'Di kantin saat jam pelajaran', points: 10 },
  { id: 'B05', category: 'Kerajinan', title: 'Tidak mengikuti dan melaksanakan piket 7K', points: 10 },
  { id: 'B06', category: 'Kerajinan', title: 'Tidur di kelas saat pelajaran berlangsung', points: 10 },
  { id: 'B07', category: 'Kerajinan', title: 'Tidak membawa buku yang berkaitan dengan pelajaran', points: 10 },
  { id: 'B08', category: 'Kerajinan', title: 'Pulang sebelum waktunya tanpa izin dari sekolah', points: 20 },
  { id: 'B09', category: 'Kerajinan', title: 'Tidak masuk sekolah tanpa keterangan (Alfa)', points: 20 },
  { id: 'B10', category: 'Kerajinan', title: 'Tidak mengikuti upacara', points: 20 },
  { id: 'B11', category: 'Kerajinan', title: 'Tidak mengikuti kegiatan sekolah', points: 20 },
  { id: 'B12', category: 'Kerajinan', title: 'Tidak mengikuti kegiatan ekstrakurikuler', points: 20 },
  { id: 'B13', category: 'Kerajinan', title: 'Ijin 2 (dua) hari', points: 20 },
  { id: 'B14', category: 'Kerajinan', title: 'Ijin 3 (tiga) hari', points: 30 },
  { id: 'B15', category: 'Kerajinan', title: 'Ijin 4 (empat) hari', points: 40 },
  { id: 'B16', category: 'Kerajinan', title: 'Ijin 5 (lima) hari', points: 50 },
  { id: 'B17', category: 'Kerajinan', title: 'Ijin diatas 5 (lima) hari', points: 100 },

  // C. KERAPIAN (13)
  { id: 'C01', category: 'Kerapian', title: 'Tidak berseragam sesuai ketentuan', points: 10 },
  { id: 'C02', category: 'Kerapian', title: 'Tidak memasukkan baju', points: 10 },
  { id: 'C03', category: 'Kerapian', title: 'Melipat lengan baju / baju tidak dikancingkan', points: 10 },
  { id: 'C04', category: 'Kerapian', title: 'Seragam yang dicoret-coret', points: 10 },
  { id: 'C05', category: 'Kerapian', title: 'Celana atau rok bawah tidak dikelim', points: 10 },
  { id: 'C06', category: 'Kerapian', title: 'Celana atau rok sobek', points: 10 },
  { id: 'C07', category: 'Kerapian', title: 'Tidak memakai kaos kaki', points: 10 },
  { id: 'C08', category: 'Kerapian', title: 'Kaos kaki tidak sesuai ketentuan (Senin-Kamis putih, Jumat hitam)', points: 10 },
  { id: 'C09', category: 'Kerapian', title: 'Tidak memakai ikat pinggang', points: 10 },
  { id: 'C10', category: 'Kerapian', title: 'Ikat pinggang tidak sesuai ketentuan (hitam)', points: 10 },
  { id: 'C11', category: 'Kerapian', title: 'Seragam atribut tidak lengkap', points: 10 },
  { id: 'C12', category: 'Kerapian', title: 'Tidak memakai sepatu hitam (selain olahraga)', points: 10 },
  { id: 'C13', category: 'Kerapian', title: 'Berambut panjang terurai (peserta didik putri)', points: 10 }
];

const OFFICIAL_REWARDS = [
  { id: 'P01', group: 'Prestasi', title: 'Kejuaraan / Kompetisi Tingkat Nasional', points: 100, minPoints: 0 },
  { id: 'P02', group: 'Prestasi', title: 'Kejuaraan / Kompetisi Tingkat Provinsi', points: 75, minPoints: 0 },
  { id: 'P03', group: 'Prestasi', title: 'Kejuaraan / Kompetisi Tingkat Kota/Kabupaten', points: 50, minPoints: 0 },
  { id: 'P04', group: 'Prestasi', title: 'Kejuaraan / Kompetisi Tingkat Kecamatan', points: 25, minPoints: 0 },
  { id: 'P05', group: 'Prestasi', title: 'Mengikuti lomba sebagai peserta (tidak juara)', points: 15, minPoints: 0 },
  { id: 'P06', group: 'Prestasi', title: 'Mengikuti pelatihan LDKMS', points: 10, minPoints: 0 },
  { id: 'P07', group: 'Prestasi', title: 'Diangkat menjadi Ketua OSIS', points: 25, minPoints: 0 },
  { id: 'P08', group: 'Prestasi', title: 'Diangkat menjadi Pengurus OSIS', points: 20, minPoints: 0 },
  { id: 'N01', group: 'Pembinaan (>75 pt)', title: 'Tidak pernah alpa (khusus poin > 75)', points: 25, minPoints: 76 },
  { id: 'N02', group: 'Pembinaan (>75 pt)', title: 'Tidak pernah terlambat 1 bulan berturut-turut (khusus poin > 75)', points: 15, minPoints: 76 },
  { id: 'N03', group: 'Pembinaan (>75 pt)', title: 'Menunjukkan catatan pelajaran lengkap tepat waktu (khusus poin > 75)', points: 30, minPoints: 76 }
];

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const sess = await requireRole(req, res, ['super_admin', 'tatib', 'viewer', 'user']);
      if (!sess) return;

      const violationsRaw = await db.getLogs('violations', 500);
      let violations = violationsRaw;
      const config = await getConfig();

      if (sess.role === 'user') {
        violations = violations.filter(v => v.nisn === sess.id && v.status === 'approved');
        return res.status(200).json({ violations, sanctions: config.sanctions, maxPoints: MAX_POINTS });
      }

      return res.status(200).json({
        rules: OFFICIAL_RULES,
        rewards: OFFICIAL_REWARDS,
        violations,
        sanctions: config.sanctions,
        maxPoints: MAX_POINTS
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const body = req.body || {};
    const action = String(body.action || '');

    // 1. AJUKAN / CATAT PELANGGARAN
    if (action === 'submit') {
      const sess = await requireRole(req, res, ['super_admin', 'tatib']);
      if (!sess) return;
      const cachedTx = await checkTx(body.txId);
      if (cachedTx) return res.status(200).json(cachedTx);

      const nisn = String(body.nisn || '').trim();
      const ruleTitle = String(body.ruleTitle || '').trim();
      const points = Math.max(1, Number(body.points || 10));
      const notes = String(body.notes || '').trim().slice(0, 300);

      if (!nisn || !ruleTitle) return res.status(400).json({ error: 'Siswa dan pelanggaran wajib diisi' });
      const member = await db.getItem('members', nisn);
      if (!member) return res.status(404).json({ error: 'Siswa tidak ditemukan' });

      const autoApprove = sess.role === 'super_admin' || sess.role === 'root_admin';
      const entry = {
        id: genId(8),
        type: 'violation',
        nisn,
        name: member.name,
        kelas: member.kelas || '',
        ruleTitle,
        points,
        notes,
        status: autoApprove ? 'approved' : 'pending',
        submittedBy: sess.fullName,
        reviewedBy: autoApprove ? sess.fullName : '',
        createdAt: getWibNow().full
      };

      const tasks = [
        db.pushLog('violations', entry, 1000)
      ];

      if (autoApprove) {
        const nextPoints = Math.min(MAX_POINTS, Number(member.points || 0) + points);
        tasks.push(db.setItem('members', nisn, { ...member, points: nextPoints }));
      }

      await Promise.all(tasks);
      const out = { ok: true, violation: entry };
      await saveTx(body.txId, out);
      return res.status(200).json(out);
    }

    // 2. BERI PENGHARGAAN / PENGURANGAN POIN (KHUSUS SUPER ADMIN)
    if (action === 'add_reward') {
      const sess = await requireRole(req, res, ['super_admin']);
      if (!sess) return;
      const cachedTx = await checkTx(body.txId);
      if (cachedTx) return res.status(200).json(cachedTx);

      const nisn = String(body.nisn || '').trim();
      const rewardId = String(body.rewardId || '').trim();
      const notes = String(body.notes || '').trim().slice(0, 200);
      const reward = OFFICIAL_REWARDS.find(r => r.id === rewardId);
      if (!reward) return res.status(400).json({ error: 'Jenis penghargaan tidak valid' });

      const member = await db.getItem('members', nisn);
      if (!member) return res.status(404).json({ error: 'Siswa tidak ditemukan' });

      const currentPts = Number(member.points || 0);
      if (reward.minPoints > 0 && currentPts < reward.minPoints) {
        return res.status(400).json({ error: `Pengurangan ini hanya untuk siswa dengan poin di atas 75 (poin saat ini: ${currentPts}).` });
      }

      const nextPoints = Math.max(0, currentPts - reward.points);
      const entry = {
        id: genId(8),
        type: 'reward',
        nisn,
        name: member.name,
        kelas: member.kelas || '',
        ruleTitle: `[PENGHARGAAN] ${reward.title}`,
        points: -reward.points,
        notes,
        status: 'approved',
        submittedBy: sess.fullName,
        reviewedBy: sess.fullName,
        createdAt: getWibNow().full
      };

      await Promise.all([
        db.setItem('members', nisn, { ...member, points: nextPoints }),
        db.pushLog('violations', entry, 1000)
      ]);
      const out = { ok: true, nextPoints };
      await saveTx(body.txId, out);
      return res.status(200).json(out);
    }

    // 3. ACC / TOLAK PENGAJUAN TATIB
    if (action === 'review') {
      const sess = await requireRole(req, res, ['super_admin']);
      if (!sess) return;

      const id = String(body.id || '').trim();
      const decision = body.decision === 'approved' ? 'approved' : 'rejected';

      const list = await db.getLogs('violations', 1000);
      const idx = list.findIndex(v => v.id === id);
      if (idx < 0) return res.status(404).json({ error: 'Data tidak ditemukan' });

      const target = list[idx];
      if (target.status !== 'pending') return res.status(400).json({ error: 'Sudah ditinjau sebelumnya' });

      list[idx] = { ...target, status: decision, reviewedBy: sess.fullName, reviewedAt: getWibNow().full };

      await db.replaceLogs('violations', list);

      if (decision === 'approved') {
        const member = await db.getItem('members', target.nisn);
        if (member) {
          const nextPoints = Math.min(MAX_POINTS, Number(member.points || 0) + Number(target.points || 0));
          await db.setItem('members', target.nisn, { ...member, points: nextPoints });
        }
      }

      return res.status(200).json({ ok: true });
    }

    // 4. RESET POIN KENAIKAN KELAS
    if (action === 'reset_year') {
      const sess = await requireRole(req, res, ['super_admin']);
      if (!sess) return;

      const map = await db.getAll('members');
      const updatedBatch = {};
      for (const [nisn, raw] of Object.entries(map)) {
        const m = raw;
        updatedBatch[nisn] = { ...m, points: 0 };
      }
      if (Object.keys(updatedBatch).length > 0) await db.setItems('members', updatedBatch);
      return res.status(200).json({ ok: true, resetCount: Object.keys(updatedBatch).length });
    }

    return res.status(400).json({ error: 'Action tidak valid' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
