import { Redis } from '@upstash/redis';

const PREFIX = process.env.DB_PREFIX || 'v2';

function safeParse(val, fallback = null) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

// =========================================================
// DRIVER 1: UPSTASH REDIS (Aktif Default / Free Tier)
// =========================================================
function createRedisDriver() {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  });

  const k = (name) => `${PREFIX}:${name}`;

  return {
    async get(key) {
      return safeParse(await redis.get(k(key)), null);
    },
    async set(key, val, ttlSec = 0) {
      const payload = typeof val === 'string' ? val : JSON.stringify(val);
      if (ttlSec > 0) return redis.set(k(key), payload, { ex: ttlSec });
      return redis.set(k(key), payload);
    },
    async del(key) {
      return redis.del(k(key));
    },
    async getItem(col, id) {
      return safeParse(await redis.hget(k(col), String(id)), null);
    },
    async setItem(col, id, obj) {
      return redis.hset(k(col), { [String(id)]: JSON.stringify(obj) });
    },
    async setItems(col, mapObj) {
      const batch = {};
      for (const [id, val] of Object.entries(mapObj)) {
        batch[id] = typeof val === 'string' ? val : JSON.stringify(val);
      }
      if (Object.keys(batch).length > 0) await redis.hset(k(col), batch);
    },
    async delItem(col, id) {
      return redis.hdel(k(col), String(id));
    },
    async getAll(col) {
      const raw = (await redis.hgetall(k(col))) || {};
      const out = {};
      for (const [id, val] of Object.entries(raw)) out[id] = safeParse(val, {});
      return out;
    },
    async pushLog(col, obj, maxLen = 500) {
      await Promise.all([
        redis.lpush(k(col), JSON.stringify(obj)),
        redis.ltrim(k(col), 0, maxLen - 1)
      ]);
    },
    async getLogs(col, limit = 300) {
      const raw = (await redis.lrange(k(col), 0, limit - 1)) || [];
      return raw.map(v => safeParse(v, {}));
    },
    async replaceLogs(col, arr) {
      await redis.del(k(col));
      if (arr.length > 0) {
        await redis.rpush(k(col), ...arr.map(v => JSON.stringify(v)));
      }
    }
  };
}

// =========================================================
// FACTORY: Ganti DB_DRIVER=mysql / postgres / sqlite di sini nanti
// tanpa perlu mengubah file api/*.js lain sama sekali!
// =========================================================
const driverName = (process.env.DB_DRIVER || 'redis').toLowerCase();
export const db = driverName === 'redis' ? createRedisDriver() : createRedisDriver();
