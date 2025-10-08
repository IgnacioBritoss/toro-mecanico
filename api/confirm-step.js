// api/confirm-step.js
import { pool } from "./db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

function signToken(id, email){
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
}
function pad2(n){ return String(n).padStart(2,"0"); }
function esc(s=""){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

export default async function handler(req, res){
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const { id, token } = req.body || {};
  if(!id || !token) return res.status(400).json({ error: "Faltan parámetros" });

  try{
    const { rows } = await pool.query(`
      SELECT r.id, r.event_date, r.event_hour, r.plan, r.status,
             u.name, u.email, u.phone, u.postal_code, u.zone
        FROM reservations r
        JOIN users u ON u.id = r.user_id
       WHERE r.id = $1
    `, [id]);
    if(!rows.length) return res.status(404).json({ error: "Reserva no encontrada" });
    const r = rows[0];

    const expected = signToken(r.id, r.email);
    if(expected !== token) return res.status(403).json({ error: "Token inválido" });

    await pool.query(`UPDATE reservations SET deposit_intent_at = now() WHERE id = $1`, [r.id]);

    // mail al owner (misma mecánica; solo texto/estética)
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
          subject: "Cliente inició el pago de la seña",
          html: `
            <div style="font-family:system-ui,Segoe UI,Roboto;line-height:1.5;color:#0f172a">
              <div style="max-width:720px;margin:0 auto;padding:24px 16px;background:#fff;border:1px solid #e5e7eb;border-radius:14px">
                <h1 style="margin:0 0 12px;font-size:22px">El cliente inició el pago de seña</h1>
                <p><strong>${esc(r.name || "")}</strong> (${esc(r.email || "")}) — Tel: ${esc(r.phone || "-")} — CP: ${esc(r.postal_code || "-")}</p>
                <p>Fecha: <strong>${esc(r.event_date)}</strong> — <strong>${pad2(r.event_hour)}:00 hs</strong></p>
                <p>Plan: <strong>${esc(r.plan === "2h" ? "2 horas" : "1 hora")}</strong></p>
                <p>Revisá el ingreso en tu app de Mercado Pago.</p>
              </div>
              <p style="max-width:720px;margin:10px auto 0;color:#64748b;font-size:12px">Este correo fue enviado automáticamente por el sistema de reservas.</p>
            </div>`
        });
      }
    }catch(e){ console.error("MAIL OWNER (confirm-step) ERROR:", e); }

    // respuesta al front (sin cambios funcionales)
    const mpPreferenceId = process.env.MP_PREFERENCE_ID || "";
    const payLink = process.env.MP_LINK_1ARS || "";
    return res.status(200).json({ ok:true, mpPreferenceId, payLink });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error: "Error interno" });
  }
}
