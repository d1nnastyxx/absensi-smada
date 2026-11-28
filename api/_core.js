import crypto from 'crypto';
export { db } from './_db.js';
import { db } from './_db.js';

export const SCHOOL_NAME = process.env.SCHOOL_NAME || 'SMA Negeri 2 Pare';
export const MAX_POINTS = Number(process.env.MAX_POINTS || 250);

export const OFFICIAL_SANCTIONS = [
  { min: 10,  max: 35,  level: 'Ringan', label: 'Pembinaan Ketertiban' },
  { min: 36,  max: 75,  level: 'Sedang', label: 'Panggilan Orang Tua ke-I (Wali Kelas)' },
  { min: 76,  max: 95,  level: 'Sedang', label: 'Panggilan Orang Tua ke-II (Guru BK)' },
  { min: 96,  max: 150, level: 'Sedang', label: 'Panggilan Orang Tua ke-III (Koord. BK)' },
  { min: 151, max: 249, level: 'Berat',  label: 'Skorsing (Wakasek Kesiswaan)' },
  { min: 250, max: 999, level: 'Berat',  label: 'Dikembalikan ke Orang Tua (Kepala Sekolah)' }
];

export function getSanction(points) {
  const p = Number(points || 0);
  if (p < 10) return { level: 'Aman', label: 'Tertib' };
  return OFFICIAL_SANCTIONS.find(s => p >= s.min && p <= s.max) || OFFICIAL_SANCTIONS[OFFICIAL_SANCTIONS.length - 1];
}

export function getWibNow() {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const iso = now.toISOString();
  return {
    full: iso.replace('T', ' ').substring(0, 19),
    date: iso.substring(0, 10),
    time: iso.substring(11, 19),
    hhmm: iso.substring(11, 16)
  };
}

export function hashSecret(str) {
  const salt = process.env.AUTH_SALT || 'smada-kesiswaan-v2';
  return crypto.createHash('sha256').update(`${salt}:${String(str)}`).digest('hex');
}

export function genId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function isDevice(req) {
  const key = req.headers['x-device-key'];
  const expected = process.env.DEVICE_KEY || process.env.device_key || 'dinn-esp32';
  return Boolean(key && key === expected);
}

export async function getSession(req) {
  const token = req.headers['x-auth-token'];
  if (!token) return null;
  const sess = await db.get(`sess:${token}`);
  return sess ? { ...sess, token } : null;
}

export async function requireRole(req, res, roles = ['super_admin']) {
  const sess = await getSession(req);
  if (!sess) {
    res.status(401).json({ error: 'Sesi tidak valid. Silakan login.' });
    return null;
  }
  const effectiveAllowed = roles.includes('super_admin') ? [...roles, 'root_admin'] : roles;
  if (!effectiveAllowed.includes(sess.role)) {
    res.status(403).json({ error: `Akses ditolak untuk peran: ${sess.role}` });
    return null;
  }
  return sess;
}

export async function getConfig() {
  const c = (await db.get('config')) || {};
  return {
    schoolName: SCHOOL_NAME,
    lateLimit: c.lateLimit || '07:00',
    checkoutStart: c.checkoutStart || '14:00',
    duplicateGapMin: Number(c.duplicateGapMin ?? 5),
    latePoints: Number(c.latePoints ?? 10),
    maxReportsPerDay: Number(c.maxReportsPerDay ?? 3),
    sanctions: OFFICIAL_SANCTIONS
  };
}

export async function checkTx(txId) {
  if (!txId || typeof txId !== 'string') return null;
  return db.get(`tx:${txId.slice(0, 64)}`);
}

export async function saveTx(txId, payload) {
  if (!txId || typeof txId !== 'string') return;
  await db.set(`tx:${txId.slice(0, 64)}`, payload, 86400);
}
