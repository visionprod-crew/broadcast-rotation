// SLS 방송팀 관리 시스템 — 웹 푸시 발송 서버 (Vercel Serverless Function)
// 팀장·부팀장·관리자가 보낸 요청만 처리하고, 아이폰(Safari)·갤럭시(Chrome) 웹 푸시로 전달합니다.
// 외부 패키지 없이 Node 기본 crypto로 VAPID 서명(RFC 8292)과 페이로드 암호화(RFC 8291, aes128gcm)를 합니다.
const crypto = require('crypto');

const PROJECT = process.env.FIREBASE_PROJECT || 'broadcast-rotation-5f7bb';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'admin@vfc-rotation.app';
const SUBJECT = process.env.VAPID_SUBJECT || 'https://visionprod-crew.github.io/broadcast-rotation/';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(s, 'base64url');

function decodeJwt(t) {
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); } catch { return null; }
}
async function fsGet(path, idToken) {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${idToken}` } });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json(), f = j.fields || {}, o = {};
  for (const [k, v] of Object.entries(f)) o[k] = v.stringValue ?? v.integerValue ?? v.booleanValue ?? v.nullValue ?? null;
  return { ok: true, data: o };
}

// ── VAPID (ES256 JWT)
function vapidHeader(endpoint, vapid) {
  const pub = unb64u(vapid.publicKey);
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// ── 페이로드 암호화 (aes128gcm)
function encrypt(sub, payload) {
  const uaPublic = unb64u(sub.keys.p256dh), authSecret = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}

async function sendOne(sub, payload, vapid) {
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidHeader(sub.endpoint, vapid) },
      body: encrypt(sub, JSON.stringify(payload)),
    });
    return { endpoint: sub.endpoint, status: r.status, ok: r.status >= 200 && r.status < 300, gone: r.status === 404 || r.status === 410, detail: r.ok ? '' : (await r.text()).slice(0, 200) };
  } catch (e) { return { endpoint: sub.endpoint, status: 0, ok: false, detail: String(e.message || e) }; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'sls-push' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const idToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const claims = decodeJwt(idToken);
  if (!claims || claims.aud !== PROJECT || !claims.user_id) return res.status(401).json({ error: '로그인이 필요해요' });

  // 토큰 검증 + 권한 확인: 호출자의 토큰으로 Firestore를 읽어서 확인 (위조 토큰은 Firestore가 거부)
  const me = await fsGet(`users/${claims.user_id}`, idToken);
  if (!me.ok) return res.status(403).json({ error: `권한 확인 실패 (${me.status})` });
  const isOwner = claims.email === OWNER_EMAIL || me.data.role === 'owner';
  if (!isOwner && !['leader', 'subleader'].includes(me.data.role)) return res.status(403).json({ error: '팀장·부팀장만 알림을 보낼 수 있어요' });

  const v = await fsGet('secrets/vapid', idToken);
  if (!v.ok || !v.data.privateKey) return res.status(500).json({ error: '알림 키가 설정되지 않았어요' });

  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
  const results = await Promise.all(items.filter(i => i?.sub?.endpoint && i.sub.keys).map(i => sendOne(i.sub, i.payload || {}, v.data)));
  res.status(200).json({ sent: results.filter(r => r.ok).length, results });
};
