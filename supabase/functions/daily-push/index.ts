// 아침 영어 뉴스 클럽: 매일 알림 발송 함수 (Supabase Edge Function, 이름: daily-push)
//
// Supabase가 매분 알림 시간을 확인하고, 보낼 알림이 있을 때만 이 함수를 부릅니다(update-2-push.sql).
// 이 함수는 비밀값(x-cron-secret)으로 보낼 목록과 VAPID 키를 받아, 표준 Web Push(RFC 8291, RFC 8292)로
// 각 휴대폰에 알림을 보내고 결과를 기록합니다. 이 파일에는 비밀값이 없습니다.
// 대시보드에서 이 함수의 "Enforce JWT verification"(JWT 확인)을 꺼야 Supabase 예약 작업이 부를 수 있습니다.

const SUPABASE_URL = "https://idceljjzibugxpgnxtxv.supabase.co";
const PUBLIC_KEY = "sb_publishable_u-4Q1vaO0gO1Kroek0Wt7w_2mcP5s_U"; // 공개용 키(앱 config.js와 같음)
const SITE = "https://arismint-youneecon.github.io/Yanadoo_Daily-news-listening/";
const TITLE = "아침 영어 뉴스 클럽";

const enc = new TextEncoder();

function b64u(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

// RFC 8291: 알림 내용을 그 기기만 열 수 있게 암호화 (aes128gcm)
export async function encryptPayload(p256dh, authSecret, plaintext) {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concat(enc.encode(plaintext), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, padded));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

// RFC 8292: 이 클럽이 보낸 알림임을 증명하는 서명(VAPID JWT, ES256)
export async function vapidHeader(endpoint, vapid) {
  const key = await crypto.subtle.importKey("jwk",
    { kty: "EC", crv: "P-256", x: vapid.x, y: vapid.y, d: vapid.d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapid.subject || SITE,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body)));
  return "vapid t=" + head + "." + body + "." + b64u(sig) + ", k=" + vapid.public;
}

export async function sendPush(sub, message, vapid) {
  const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(message));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization": await vapidHeader(sub.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "21600",
      "Urgency": "normal",
      "Topic": message.tag || "daily",
    },
    body,
  });
  return res.status;
}

function kstToday() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

async function rpc(fn, args) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: PUBLIC_KEY },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(fn + " " + r.status + " " + t);
  return t ? JSON.parse(t) : null;
}

export function buildMessage(kind, notifyTime, today) {
  if (kind === "test") {
    return { title: TITLE, body: "시험 알림이에요. 매일 " + notifyTime + "에 이렇게 알려 드려요.", url: "./#/", tag: "test" };
  }
  if (today) {
    const n = today.items.length;
    const first = today.items[0] && today.items[0].ko;
    return { title: "오늘의 영어 뉴스 " + n + "개가 올라왔어요", body: first ? first + (n > 1 ? " 외 " + (n - 1) + "개" : "") : "눌러서 들어 보세요.", url: "./#/", tag: "daily" };
  }
  return { title: TITLE, body: "영어 뉴스 들을 시간이에요. 눌러서 열어 보세요.", url: "./#/", tag: "daily" };
}

export async function handler(req) {
  const secret = req.headers.get("x-cron-secret") || "";
  if (!secret) return new Response("forbidden", { status: 403 });

  // 오늘 뉴스가 올라왔는지 확인 (아직이면 알림 시간 뒤 최대 60분까지 기다립니다)
  let today = null;
  try {
    const r = await fetch(SITE + "data/index.json?t=" + Date.now(), { headers: { "Cache-Control": "no-cache" } });
    const idx = await r.json();
    if (idx.days && idx.days[0] && idx.days[0].date === kstToday()) today = idx.days[0];
  } catch (_) { /* 뉴스 목록을 못 읽으면 일반 문구로 보냅니다 */ }

  let due;
  try { due = await rpc("club_push_due", { p_secret: secret, p_ready: !!today }); }
  catch (e) { return new Response(String(e.message || e), { status: 403 }); }

  const results = [];
  for (const it of due.items || []) {
    let status = 0;
    try { status = await sendPush(it, buildMessage(it.kind, it.notify_time, today), due.vapid); }
    catch (_) { status = 0; }
    results.push({ endpoint: it.endpoint, status, kind: it.kind });
  }
  if (results.length) await rpc("club_push_report", { p_secret: secret, p_results: results });
  return new Response(JSON.stringify({ sent: results.length, ok: results.filter((r) => r.status >= 200 && r.status < 300).length, ready: !!today }),
    { headers: { "Content-Type": "application/json" } });
}

if (typeof Deno !== "undefined") Deno.serve(handler);
