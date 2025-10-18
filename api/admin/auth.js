// api/admin/auth.js
import crypto from "crypto";
import nodemailer from "nodemailer";

export const config = { runtime: "nodejs" };

/* -------------------- helpers genéricos -------------------- */
function isValidEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e||""); }
function b64url(buf){ return Buffer.from(buf).toString("base64url"); }
function hmac(data, secret){
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}
function json(res, code, body){ res.status(code).json(body); }

/* ======= SESIÓN SIN ESTADO (session_id firmado) =======
   payload se guarda en el token:
   - durante "start": { email, code, exp, totp_secret? }
   - tras verify_email (si hay TOTP): seguimos usando el MISMO session_id
*/
function makeSession(payload){
  const raw = JSON.stringify(payload);
  const body = b64url(raw);
  const secret = process.env.ADMIN_AUTH_SECRET || "dev-admin-secret";
  const sig = hmac(body, secret);
  return `${body}.${sig}`;
}
function parseSession(session_id){
  const secret = process.env.ADMIN_AUTH_SECRET || "dev-admin-secret";
  if (typeof session_id !== "string" || !session_id.includes(".")) return null;
  const [body, sig] = session_id.split(".");
  const expect = hmac(body, secret);
  if (sig !== expect) return null;
  try{
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload;
  }catch{ return null; }
}

/* -------------------- envío de email (si hay SMTP) -------------------- */
async function sendEmailCode(to, code){
  const hasSMTP = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  if (!hasSMTP){
    console.log("[ADMIN DEV] code for %s -> %s", to, code);
    return { sent:false, dev:true };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;

  await transporter.sendMail({
    from: `Acceso Admin Toro Mecánico <${fromEmail}>`,
    to,
    subject: "Tu código para acceder como admin",
    text: `Tu código es: ${code}\nVence en 10 minutos.`,
    html: `<p>Tu código es:</p>
           <p style="font-size:24px;font-weight:700;letter-spacing:.25em">${code}</p>
           <p style="color:#475569">Vence en 10 minutos.</p>`
  });
  return { sent:true, dev:false };
}

/* -------------------- TOTP (con fijo u on-the-fly) -------------------- */
const FIXED_TOTP_BASE32 = (process.env.ADMIN_TOTP_BASE32 || "").replace(/\s+/g, "");
const TOTP_ISSUER = encodeURIComponent(process.env.TOTP_ISSUER || "Toro Mecánico");
const TOTP_LABEL_PREFIX = encodeURIComponent(process.env.TOTP_LABEL || "Admin");
const BASE32_ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf){
  let bits = "";
  for (const b of buf){ bits += b.toString(2).padStart(8,"0"); }
  let out = "";
  for (let i=0; i<bits.length; i+=5){
    const chunk = bits.slice(i, i+5);
    if (chunk.length < 5) out += BASE32_ALPH[parseInt(chunk.padEnd(5, "0"), 2)];
    else out += BASE32_ALPH[parseInt(chunk, 2)];
  }
  return out.replace(/=+$/,"");
}
function base32Decode(b32){
  let bits = "";
  for (const c of b32.toUpperCase()){
    const val = BASE32_ALPH.indexOf(c);
    if (val >= 0) bits += val.toString(2).padStart(5, "0");
  }
  const out = [];
  for (let i=0; i+8<=bits.length; i+=8){
    out.push(parseInt(bits.slice(i,i+8), 2));
  }
  return Buffer.from(out);
}
function hotp(keyBuf, counter, digits=6){
  const buf = Buffer.alloc(8);
  for (let i=7; i>=0; i--){ buf[i] = counter & 0xff; counter = counter >> 8; }
  const h = crypto.createHmac("sha1", keyBuf).update(buf).digest();
  const off = h[19] & 0x0f;
  const bin = ((h[off] & 0x7f)<<24) | ((h[off+1]&0xff)<<16) | ((h[off+2]&0xff)<<8) | (h[off+3]&0xff);
  return String(bin % (10**digits)).padStart(digits, "0");
}
function totpNowFromBase32(base32Secret, step=30, digits=6){
  const key = base32Decode(base32Secret);
  const counter = Math.floor(Date.now()/1000/step);
  return new Set([hotp(key,counter-1,digits), hotp(key,counter,digits), hotp(key,counter+1,digits)]);
}
function buildOtpauthUri(email, base32Secret){
  const label = `${TOTP_LABEL_PREFIX}:${encodeURIComponent(email)}`;
  return `otpauth://totp/${label}?secret=${base32Secret}&issuer=${TOTP_ISSUER}&digits=6&period=30`;
}

/* -------------------- cookie admin -------------------- */
// NUEVO: también seteo una cookie de CSRF (no HttpOnly) y devuelvo el token
function setAdminCookie(res){
  const parts = [
    "admin_session=ok",
    "Path=/",
    "Max-Age=86400",
    "HttpOnly",
    "SameSite=Lax",
    "Secure"
  ];
  // CSRF token aleatorio para el cliente (lo mandará en x-csrf-token)
  const csrfToken = crypto.randomBytes(16).toString("base64url");
  const csrfCookie = [
    `adm_csrf=${csrfToken}`,
    "Path=/",
    "Max-Age=86400",
    "SameSite=Lax",
    "Secure"
  ];
  res.setHeader("Set-Cookie", [parts.join("; "), csrfCookie.join("; ")]);
  return csrfToken;
}
function clearAdminCookie(res){
  res.setHeader("Set-Cookie", [
    "admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
    "adm_csrf=; Path=/; Max-Age=0; SameSite=Lax; Secure"
  ]);
}

/* -------------------- NUEVO: rate limit simple por IP -------------------- */
const RL = new Map(); // key: ip:window -> count
function rateLimit(req, res, { windowMs=60_000, max=20 } = {}){
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const now = Date.now();
  const bucket = `${ip}:${Math.floor(now / windowMs)}`;
  const n = (RL.get(bucket) || 0) + 1;
  RL.set(bucket, n);
  if (n > max){
    json(res, 429, { ok:false, error:"Too many requests" });
    return false;
  }
  return true;
}

/* ======================================================
   HANDLER UNIFICADO
   Acciones:
   - POST ?action=start
   - POST ?action=verify_email
   - POST ?action=verify_totp
   - POST/GET ?action=logout
   ====================================================== */
export default async function handler(req, res){
  const action = (req.query.action || "").toString();

  try{
    // Rate limit básico por seguridad (cada llamada)
    if (!rateLimit(req, res, { windowMs: 60_000, max: 30 })) return;

    // -------- logout (GET o POST)
    if (action === "logout"){
      clearAdminCookie(res);
      return json(res, 200, { ok:true });
    }

    // -------- start (POST): envía código, guarda totp_secret (si no hay fijo)
    if (action === "start" && req.method === "POST"){
      const { email } = req.body || {};
      if (!email || !isValidEmail(email)) return json(res, 400, { ok:false, error:"Email inválido" });

      // allowlist opcional
      if (process.env.ADMIN_EMAILS){
        const allow = process.env.ADMIN_EMAILS.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
        if (!allow.includes(String(email).toLowerCase())){
          return json(res, 403, { ok:false, error:"No autorizado" });
        }
      }

      const code = String(Math.floor(100000 + Math.random()*900000)); // 6 dígitos

      // si NO hay un secreto TOTP fijo, generamos uno por sesión (para QR)
      let perSessionTotpBase32 = "";
      if (!FIXED_TOTP_BASE32){
        const rand = crypto.randomBytes(20);
        perSessionTotpBase32 = base32Encode(rand);
      }

      const payload = {
        email: String(email).toLowerCase(),
        code,
        exp: Date.now() + 10*60*1000,
        // guardamos el secreto por sesión sólo si no hay fijo
        ...(perSessionTotpBase32 ? { totp_secret: perSessionTotpBase32 } : {})
      };
      const session_id = makeSession(payload);

      const result = await sendEmailCode(email, code);
      return json(res, 200, {
        ok:true,
        session_id,
        ...(result.dev ? { dev_code: code } : {})
      });
    }

    // -------- verify_email (POST): valida código; si hay TOTP => devuelve otpauth + qr
    if (action === "verify_email" && req.method === "POST"){
      const { session_id, code } = req.body || {};
      if (!session_id || !code) return json(res, 400, { ok:false, error:"Faltan datos" });

      const payload = parseSession(session_id);
      if (!payload) return json(res, 400, { ok:false, error:"Sesión inválida" });
      if (Date.now() > Number(payload.exp || 0)) return json(res, 400, { ok:false, error:"El código expiró" });

      const ok = String(code).replace(/\D/g,"") === String(payload.code);
      if (!ok) return json(res, 400, { ok:false, error:"Código incorrecto" });

      // ¿TOTP activo?
      const base32Secret = FIXED_TOTP_BASE32 || payload.totp_secret || "";
      if (!base32Secret){
        // Sin TOTP => logueo directo (como antes cuando no exigías 2FA)
        const csrfToken = setAdminCookie(res);
        return json(res, 200, { ok:true, done:true, session:"ok", totpDisabled:true, csrfToken });
      }

      // Con TOTP => devolvemos otpauth y QR. Front ya sabe mostrarlo.
      const otpauth = buildOtpauthUri(payload.email, base32Secret);
      const qrDataUrl = otpauth
        ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauth)}`
        : null;

      return json(res, 200, {
        ok: true,
        totpRequired: true,
        otpauth,
        qrDataUrl
        // usamos el MISMO session_id: el front no tiene que cambiar nada
      });
    }

    // -------- verify_totp (POST): valida TOTP (fijo o por sesión) y loguea
    if (action === "verify_totp" && req.method === "POST"){
      const { session_id, code } = req.body || {};
      if (!session_id || !code) return json(res, 400, { ok:false, error:"Faltan datos" });

      const payload = parseSession(session_id);
      if (!payload) return json(res, 400, { ok:false, error:"Sesión inválida" });

      const base32Secret = FIXED_TOTP_BASE32 || payload.totp_secret || "";
      if (!base32Secret) return json(res, 400, { ok:false, error:"TOTP no configurado" });

      const validSet = totpNowFromBase32(base32Secret, 30, 6);
      if (!validSet.has(String(code).replace(/\D/g,""))){
        return json(res, 400, { ok:false, error:"Código inválido" });
      }

      const csrfToken = setAdminCookie(res);
      return json(res, 200, { ok:true, done:true, session:"ok", csrfToken });
    }

    return json(res, 405, { ok:false, error:"Acción o método no permitido" });
  }catch(e){
    console.error("ADMIN AUTH ERROR:", e);
    return json(res, 500, { ok:false, error:"Error interno" });
  }
}
