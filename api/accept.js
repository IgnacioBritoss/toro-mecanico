import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

function signToken(id, email){
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
}

// === NUEVO: safe compare
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

// === NUEVO: rate limit (evita link-hammering)
const RL = new Map();
function rateLimit(req, res, { windowMs=60_000, max=60 } = {}){
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const now = Date.now();
  const k = `${ip}:${Math.floor(now/windowMs)}`;
  const n = (RL.get(k) || 0) + 1;
  RL.set(k, n);
  if (n > max){
    res.setHeader("Content-Type","text/plain; charset=utf-8");
    return res.status(429).send("Too many requests");
  }
  return true;
}

export default async function handler(req, res){
  if (req.method !== "GET") return res.status(405).send("Método no permitido");
  // NUEVO: RL
  if (!rateLimit(req, res)) return;

  const { id, token } = req.query || {};
  if (!id || !token) return res.status(400).send("Link inválido");

  try{
    const { rows } = await pool.query(`
      SELECT r.id, r.event_date, r.event_hour, r.plan, r.status,
             u.name, u.email
        FROM reservations r
        JOIN users u ON u.id = r.user_id
       WHERE r.id = $1
    `,[id]);
    if (!rows.length) return res.status(404).send("Reserva no encontrada");
    const r = rows[0];

    const expected = signToken(r.id, r.email);
    if (!safeEq(expected, token)) return res.status(403).send("Token inválido");

    if (r.status !== "aceptada"){
      await pool.query(`UPDATE reservations SET status='aceptada' WHERE id=$1`, [r.id]);
    }

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

        // === NUEVO: fecha/hora formateadas
        const fechaCorta = formatFechaCortaUTC(r.event_date);
        const horaStr = String(r.event_hour).padStart(2, "0");

        await transporter.sendMail({
          from: `Desde el equipo de Reserva del Toro Mecánico <${fromEmail}>`,
          to: r.email,
          subject: "¡Tu Reserva fue aceptada!",
          html: `
            <div style="font-family:system-ui,Segoe UI,Roboto;line-height:1.5">
              <h2>Tu reserva fue aceptada  te recordamos:</h2>
              <p><strong>Fecha:</strong> ${fechaCorta} — a las ${horaStr}</p>
              <p><strong>con el plan de </strong> ${r.plan}</p>
              <p> Nos pondremos en contacto para coordinar detalles. Saludos y gracias por confiar en nosotros.</p>
            </div>`
        });
      }
    }catch(e){ console.error("MAIL CLIENT (accept) ERROR:", e); }

    res.setHeader("Content-Type","text/html; charset=utf-8");
    return res.end(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <div style="font-family:system-ui,Segoe UI,Roboto;padding:24px;max-width:720px;margin:0 auto">
        <h2>Reserva aceptada</h2>
        <p>Se envió un email de confirmación al cliente.</p>
        <p><button type="button" onclick="window.location.href='/'">Volver al sitio</button></p>
      </div>
    `);
  }catch(e){
    console.error(e);
    return res.status(500).send("Error interno");
  }
}
