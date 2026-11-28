import { db, getWibNow, isDevice, requireRole, getConfig } from './_core.js';

export default async function handler(req, res) {
  try {
    // 1. ENDPOINT KHUSUS ESP32: SYNC CONFIG, MULTI-WIFI, JAM & CACHE RINGAN (HEMAT RAM)
    if (req.method === 'GET' && isDevice(req)) {
      const deviceId = String(req.query?.deviceId || 'ESP32-1').trim().toUpperCase();
      const [config, wifiCfg, membersMap] = await Promise.all([
        getConfig(),
        db.get('device_wifi'),
        db.getAll('members')
      ]);

      const now = getWibNow();
      const existingDev = (await db.getItem('devices', deviceId)) || {};
      await db.setItem('devices', deviceId, {
        ...existingDev,
        deviceId,
        lastSeen: now.full,
        ip: String(req.query?.ip || existingDev.ip || ''),
        bufferCount: Number(req.query?.buf ?? existingDev.bufferCount ?? 0)
      });

      const w = wifiCfg || {};
      const lines = [
        `EPOCH=${Math.floor(Date.now() / 1000)}`,
        `LATE=${config.lateLimit}`,
        `OUT=${config.checkoutStart}`
      ];

      // 2 WiFi Prioritas + 3 WiFi Cadangan
      if (w.p1_ssid) lines.push(`WP1=${w.p1_ssid}\t${w.p1_pass || ''}`);
      if (w.p2_ssid) lines.push(`WP2=${w.p2_ssid}\t${w.p2_pass || ''}`);
      if (w.b1_ssid) lines.push(`WB1=${w.b1_ssid}\t${w.b1_pass || ''}`);
      if (w.b2_ssid) lines.push(`WB2=${w.b2_ssid}\t${w.b2_pass || ''}`);
      if (w.b3_ssid) lines.push(`WB3=${w.b3_ssid}\t${w.b3_pass || ''}`);

      // Cache ringan UID -> Nama untuk mode offline total
      for (const m of Object.values(membersMap)) {
        if (m.uid) lines.push(`U=${m.uid}\t${String(m.name || '').replace(/[\r\n\t]/g, ' ').slice(0, 24)}`);
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(lines.join('\n'));
    }

    // 2. ENDPOINT WEB ADMIN: LIHAT DAFTAR ALAT & SETTING MULTI-WIFI
    if (req.method === 'GET') {
      const sess = await requireRole(req, res, ['super_admin']);
      if (!sess) return;
      if (req.query?.action === 'poll_uid') {
        const pending = await db.get('pending_uid');
        if (pending) await db.del('pending_uid');
        return res.status(200).json({ pending: pending || null });
      }
      const [devicesMap, wifiCfg, unknownLogs, regMode] = await Promise.all([
        db.getAll('devices'), db.get('device_wifi'), db.getLogs('unknown_logs', 100), db.get('reg_mode')
      ]);
      return res.status(200).json({
        devices: Object.values(devicesMap),
        wifi: wifiCfg || {},
        unknownLogs,
        regModeActive: Boolean(regMode && regMode.active)
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const body = req.body || {};
    const action = String(body.action || '');

    // 3. ESP32 LAPOR STATUS / PAIRING KARTU BARU
    if (action === 'heartbeat' && isDevice(req)) {
      const deviceId = String(body.deviceId || 'ESP32-1').trim().toUpperCase();
      const existing = (await db.getItem('devices', deviceId)) || {};
      await db.setItem('devices', deviceId, {
        ...existing,
        deviceId,
        ip: String(body.ip || existing.ip || ''),
        bufferCount: Number(body.bufferCount ?? existing.bufferCount ?? 0),
        lastUid: String(body.lastUid || existing.lastUid || ''),
        lastSeen: getWibNow().full
      });
      return res.status(200).json({ ok: true });
    }

    // 4. SIMPAN MULTI-WIFI (KHUSUS ROOT ADMIN)
    if (action === 'save_wifi') {
      const sess = await requireRole(req, res, ['root_admin']);
      if (!sess) return;
      const wifiData = {
        p1_ssid: String(body.p1_ssid || '').trim(), p1_pass: String(body.p1_pass || ''),
        p2_ssid: String(body.p2_ssid || '').trim(), p2_pass: String(body.p2_pass || ''),
        b1_ssid: String(body.b1_ssid || '').trim(), b1_pass: String(body.b1_pass || ''),
        b2_ssid: String(body.b2_ssid || '').trim(), b2_pass: String(body.b2_pass || ''),
        b3_ssid: String(body.b3_ssid || '').trim(), b3_pass: String(body.b3_pass || '')
      };
      await db.set('device_wifi', wifiData);
      return res.status(200).json({ ok: true, wifi: wifiData });
    }

    // 5. AKTIFKAN / MATIKAN MODE SCAN KARTU BARU (TTL 2 MENIT)
    if (action === 'set_reg_mode') {
      const sess = await requireRole(req, res, ['super_admin', 'tatib']);
      if (!sess) return;
      if (body.enabled) {
        await Promise.all([
          db.set('reg_mode', { active: true, by: sess.id }, 120),
          db.del('pending_uid')
        ]);
      } else {
        await Promise.all([db.del('reg_mode'), db.del('pending_uid')]);
      }
      return res.status(200).json({ ok: true, enabled: Boolean(body.enabled) });
    }

    // 6. HAPUS LOG KARTU TIDAK DIKENAL (NON-KRITIS, LANGSUNG HAPUS)
    if (action === 'clear_unknown') {
      const sess = await requireRole(req, res, ['super_admin']);
      if (!sess) return;
      await db.del('unknown_logs');
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action tidak valid' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
