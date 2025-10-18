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
   - durante "start": { email, code, exp, totp_secret?, tries_email, tries_totp }
   - tras verify_email (si hay TOTP): seguimos usando el MISMO session_id
   - si hay intento fallido, devolvemos un NUEVO session_id con tries_*+1
*/
const ADMIN_AUTH_SECRET = process.env.ADMIN_AUTH_SECRET || "dev-admin-secret";

function makeSession(payload){
  const raw = JSON.stringify(payload);
  const body = b64url(raw);
  const sig  = hmac(body, ADMIN_AUTH_SECRET);
  return `${body}.${sig}`;
}
function parseSession(session_id){
  if (typeof session_id !== "string" || !session_id.includes(".")) return null;
  const [body, sig] = session_id.split(".");
  const expect = hmac(body, ADMIN_AUTH_SECRET);
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
function setAdminCookie(res){
  const parts = [
    "admin_session=ok",
    "Path=/",
    "Max-Age=86400",
    "HttpOnly",
    "SameSite=Lax",
    "Secure"
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}
function clearAdminCookie(res){
  res.setHeader("Set-Cookie", "admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
}

/* ===================== NUEVO: BLOQUEO 1h ===================== */
const LOCK_COOKIE = "admin_lock";
// Valor: "<expMs>.<sig>". Firmamos exp para evitar manipulación.
function makeLockValue(expMs){
  const body = String(expMs);
  const sig = hmac(body, ADMIN_AUTH_SECRET);
  return `${body}.${sig}`;
}
function parseLockValue(v){
  if (!v || typeof v!=="string" || !v.includes(".")) return null;
  const [body, sig] = v.split(".");
  if (sig !== hmac(body, ADMIN_AUTH_SECRET)) return null;
  const exp = Number(body);
  if (!Number.isFinite(exp)) return null;
  return exp;
}
function readCookie(req, name){
  const ck = req.headers.cookie || "";
  const m = ck.match(new RegExp("(?:^|;\\s*)"+name+"=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : "";
}
function isLocked(req){
  const v = readCookie(req, LOCK_COOKIE);
  const exp = parseLockValue(v);
  if (!exp) return { locked:false };
  const now = Date.now();
  if (now < exp) return { locked:true, until: exp };
  return { locked:false };
}
function setLock(res, minutes=60){
  const exp = Date.now() + minutes*60*1000;
  res.setHeader("Set-Cookie",
    `${LOCK_COOKIE}=${makeLockValue(exp)}; Path=/; Max-Age=${minutes*60}; HttpOnly; SameSite=Lax; Secure`);
  return exp;
}
function clearLock(res){
  res.setHeader("Set-Cookie", `${LOCK_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
}

/* ======================================================
   HANDLER UNIFICADO
   Acciones:
   - GET/POST ?action=status           (NUEVO: chequea bloqueo)
   - POST ?action=start
   - POST ?action=verify_email
   - POST ?action=verify_totp
   - POST/GET ?action=logout
   ====================================================== */
export default async function handler(req, res){
  const action = (req.query.action || "").toString();

  try{
    // -------- status (GET/POST) NUEVO
    if (action === "status"){
      const lock = isLocked(req);
      return json(res, 200, { ok:true, ...lock });
    }

    // Antes de cualquier acción sensible, ¿está bloqueado?
    if (["start","verify_email","verify_totp"].includes(action)){
      const lock = isLocked(req);
      if (lock.locked){
        res.setHeader("Retry-After", "3600");
        return json(res, 429, { ok:false, locked:true, until: lock.until, error:"Demasiados intentos. Bloqueado 1h." });
      }
    }

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
        tries_email: 0,  // NUEVO
        tries_totp: 0,   // NUEVO
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

      // ¿vencido?
      if (Date.now() > Number(payload.exp || 0)) return json(res, 400, { ok:false, error:"El código expiró" });

      const ok = String(code).replace(/\D/g,"") === String(payload.code);

      if (!ok){
        // incrementar intentos de email
        const tries = Number(payload.tries_email || 0) + 1;
        const newPayload = { ...payload, tries_email: tries };
        const newSession = makeSession(newPayload);

        // ¿superó 3 intentos?
        if (tries >= 3){
          const until = setLock(res, 60); // 1h
          res.setHeader("Retry-After", "3600");
          return json(res, 429, { ok:false, locked:true, until, session_id:newSession, error:"Demasiados intentos. Bloqueado 1h." });
        }
        return json(res, 400, { ok:false, session_id:newSession, error:"Código incorrecto" });
      }

      // Reset tries_email en éxito
      payload.tries_email = 0;

      // ¿TOTP activo?
      const base32Secret = FIXED_TOTP_BASE32 || payload.totp_secret || "";
      if (!base32Secret){
        setAdminCookie(res);
        clearLock(res); // por las dudas
        const finalSession = makeSession(payload);
        return json(res, 200, { ok:true, done:true, session:"ok", totpDisabled:true, session_id: finalSession });
      }

      const otpauth = buildOtpauthUri(payload.email, base32Secret);
      const qrDataUrl = otpauth
        ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauth)}`
        : null;

      const nextSession = makeSession(payload);

      return json(res, 200, {
        ok: true,
        totpRequired: true,
        otpauth,
        qrDataUrl,
        session_id: nextSession
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
      const ok = validSet.has(String(code).replace(/\D/g,""));

      if (!ok){
        // Un solo intento de TOTP
        const tries = Number(payload.tries_totp || 0) + 1;
        const newPayload = { ...payload, tries_totp: tries };
        const newSession = makeSession(newPayload);

        // a la primera mala: bloqueo 1h
        const until = setLock(res, 60);
        res.setHeader("Retry-After", "3600");
        return json(res, 429, { ok:false, locked:true, until, session_id:newSession, error:"Código inválido. Bloqueado 1h." });
      }

      // éxito: limpiar lock si lo hubiera
      setAdminCookie(res);
      clearLock(res);
      payload.tries_totp = 0;
      const finalSession = makeSession(payload);
      return json(res, 200, { ok:true, done:true, session:"ok", session_id: finalSession });
    }

    return json(res, 405, { ok:false, error:"Acción o método no permitido" });
  }catch(e){
    console.error("ADMIN AUTH ERROR:", e);
    return json(res, 500, { ok:false, error:"Error interno" });
  }
}
