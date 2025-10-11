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

/* ======= SESIÓN SIN ESTADO (session_id firmado) ======= */
/** payload = { email, code, exp }  -> base64url + HMAC */
function makeSession(email, code, ttlMs=10*60*1000){
  const payload = { email, code, exp: Date.now()+ttlMs };
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
    // modo dev: log y devolvemos el code en la respuesta del start
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

/* -------------------- TOTP opcional (sin dependencias) -------------------- */
/* Si definís ADMIN_TOTP_BASE32 en .env, se exigirá TOTP después del email */
const TOTP_SECRET_BASE32 = (process.env.ADMIN_TOTP_BASE32 || "").replace(/\s+/g, "");
const TOTP_ISSUER = encodeURIComponent(process.env.TOTP_ISSUER || "Toro Mecánico");
const TOTP_LABEL_PREFIX = encodeURIComponent(process.env.TOTP_LABEL || "Admin");

const BASE32_ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
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
function totpNow(base32Secret, step=30, digits=6){
  const key = base32Decode(base32Secret);
  const counter = Math.floor(Date.now()/1000/step);
  // tolerancia ±1 step
  const codes = new Set([hotp(key,counter-1,digits), hotp(key,counter,digits), hotp(key,counter+1,digits)]);
  return codes;
}
function buildOtpauthUri(email){
  if (!TOTP_SECRET_BASE32) return null;
  const label = `${TOTP_LABEL_PREFIX}:${encodeURIComponent(email)}`;
  return `otpauth://totp/${label}?secret=${TOTP_SECRET_BASE32}&issuer=${TOTP_ISSUER}&digits=6&period=30`;
}

/* -------------------- cookie admin -------------------- */
function setAdminCookie(res){
  const parts = [
    "admin_session=ok",
    "Path=/",
    "Max-Age=86400",          // 1 día
    "HttpOnly",
    "SameSite=Lax",
    "Secure"
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}
function clearAdminCookie(res){
  res.setHeader("Set-Cookie", "admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
}
function hasAdminCookie(req){
  const c = req.headers.cookie || "";
  return /(?:^|;\s*)admin_session=ok(?:;|$)/.test(c);
}

/* ======================================================
   HANDLER UNIFICADO
   Acciones:
   - POST ?action=start          -> envía código por email, responde session_id
   - POST ?action=verify_email   -> valida código email; si no hay TOTP, loguea; si hay TOTP, pide TOTP
   - POST ?action=verify_totp    -> valida TOTP y loguea (set cookie)
   - POST/GET ?action=logout     -> borra cookie
   ====================================================== */
export default async function handler(req, res){
  const action = (req.query.action || "").toString();

  try{
    // -------- logout (GET o POST)
    if (action === "logout"){
      clearAdminCookie(res);
      return json(res, 200, { ok:true });
    }

    // -------- start (POST): envía código por email
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
      const session_id = makeSession(String(email).toLowerCase(), code);

      const result = await sendEmailCode(email, code);
      return json(res, 200, { ok:true, session_id, ...(result.dev ? { dev_code: code } : {}) });
    }

    // -------- verify_email (POST): valida código del email
    if (action === "verify_email" && req.method === "POST"){
      const { session_id, code } = req.body || {};
      if (!session_id || !code) return json(res, 400, { ok:false, error:"Faltan datos" });

      const payload = parseSession(session_id);
      if (!payload) return json(res, 400, { ok:false, error:"Sesión inválida" });
      if (Date.now() > Number(payload.exp || 0)) return json(res, 400, { ok:false, error:"El código expiró" });

      const ok = String(code).replace(/\D/g,"") === String(payload.code);
      if (!ok) return json(res, 400, { ok:false, error:"Código incorrecto" });

      // Si no hay TOTP, logueamos acá mismo.
      if (!TOTP_SECRET_BASE32){
        setAdminCookie(res);
        return json(res, 200, { ok:true, done:true, session:"ok", totpDisabled:true });
      }

      // Si hay TOTP, devolvemos datos para mostrar QR y pedir el código de la app.
      const otpauth = buildOtpauthUri(payload.email);
      return json(res, 200, { ok:true, totpRequired:true, otpauth, qrDataUrl:null });
    }

    // -------- verify_totp (POST): valida TOTP y loguea
    if (action === "verify_totp" && req.method === "POST"){
      if (!TOTP_SECRET_BASE32){
        // si no hay TOTP en server, lo tratamos como deshabilitado (éxito)
        setAdminCookie(res);
        return json(res, 200, { ok:true, done:true, session:"ok" });
      }
      const { session_id, code } = req.body || {};
      if (!session_id || !code) return json(res, 400, { ok:false, error:"Faltan datos" });

      const payload = parseSession(session_id);
      if (!payload) return json(res, 400, { ok:false, error:"Sesión inválida" });

      const validSet = totpNow(TOTP_SECRET_BASE32, 30, 6);
      if (!validSet.has(String(code).replace(/\D/g,""))){
        return json(res, 400, { ok:false, error:"Código inválido" });
      }

      setAdminCookie(res);
      return json(res, 200, { ok:true, done:true, session:"ok" });
    }

    // Acción desconocida o método inválido
    return json(res, 405, { ok:false, error:"Acción o método no permitido" });
  }catch(e){
    console.error("ADMIN AUTH ERROR:", e);
    return json(res, 500, { ok:false, error:"Error interno" });
  }
}
