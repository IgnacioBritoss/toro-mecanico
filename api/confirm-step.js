// api/confirm-step.js
import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

// firma simple para validar que el link pertenece a la reserva
function signToken(id, email){
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
}

// === NUEVO: safe compare para tokens
function safeEq(a, b){
  try{
    const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  }catch{ return false; }
}

// === NUEVO: formateo de fecha corta en UTC => "Mon 06/10/25"
function formatFechaCortaUTC(dateLike){
  const d = new Date(dateLike);
  const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }); // "Mon"
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${weekday} ${dd}/${mm}/${yy}`;
}

// === NUEVO: rate limit
const RL = new Map();
function rateLimit(req, res, { windowMs=60_000, max=40 } = {}){
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const now = Date.now();
  const k = `${ip}:${Math.floor(now/windowMs)}`;
  const n = (RL.get(k) || 0) + 1;
  RL.set(k, n);
  if (n > max){
    return res.status(429).json({ error: "Too many requests" });
  }
  return true;
}

export default async function handler(req, res){
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  // NUEVO: RL
  if (!rateLimit(req, res)) return;

  const { id, token } = req.body || {};
  if(!id || !token) return res.status(400).json({ error: "Faltan parámetros" });

  try{
    // leemos la reserva + usuario
    const { rows } = await pool.query(`
      SELECT r.id, r.event_date, r.event_hour, r.plan, r.status,
             u.name, u.email, u.phone, u.postal_code, u.zone
        FROM reservations r
        JOIN users u ON u.id = r.user_id
       WHERE r.id = $1
    `, [id]);
    if(!rows.length) return res.status(404).json({ error: "Reserva no encontrada" });
    const r = rows[0];

    // validamos token
    const expected = signToken(r.id, r.email);
    if(!safeEq(expected, token)) return res.status(403).json({ error: "Token inválido" });

    // marcamos intención de seña (solo informativo)
    await pool.query(`UPDATE reservations SET deposit_intent_at = now() WHERE id = $1`, [r.id]);

    // === NUEVO: fecha/hora formateadas para el mail al owner
    const fechaCorta = formatFechaCortaUTC(r.event_date);
    const horaStr = String(r.event_hour).padStart(2, "0");

    // mail al owner para avisar que el cliente va a tratar de señar
    try{
      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587", 10),
          secure: process.env.SMTP_PORT === "465",
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
        const ownerEmail = process.env.TO_EMAIL || process.env.SMTP_USER;
        const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;

        await transporter.sendMail({
          from: `Reservas Toro Mecánico <${fromEmail}>`,
          to: ownerEmail,
          subject: "El cliente inicio el pago de la seña",
          html: `
            <div style="font-family:system-ui,Segoe UI,Roboto;line-height:1.5">
              <h2>El cliente inició el pago de seña</h2>
              <p><strong>${r.name}</strong> (${r.email}) — Tel: ${r.phone || "-"} — CP: ${r.postal_code || "-"}</p>
              <p>Fecha: <strong>${fechaCorta}</strong> — ${horaStr}</p>
              <p>Plan: <strong>${r.plan}</strong></p>
              <p>Revisá el ingreso de la seña Mercado Pago.</p>
            </div>`
        });
      }
    }catch(e){ console.error("MAIL OWNER (confirm-step) ERROR:", e); }

    // devolvemos SIEMPRE algo para que el front muestre el botón
    const mpPreferenceId = process.env.MP_PREFERENCE_ID || "";
    const payLink = process.env.MP_LINK_1ARS || ""; // tu mpago.li

    return res.status(200).json({ ok:true, mpPreferenceId, payLink });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error: "Error interno" });
  }
}
