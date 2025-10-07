import { pool } from "./db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

function signToken(id, email){
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
}

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
    `,[id]);
    if(!rows.length) return res.status(404).json({ error: "Reserva no encontrada" });
    const r = rows[0];

    const expected = signToken(r.id, r.email);
    if(expected !== token) return res.status(403).json({ error: "Token inválido" });

    await pool.query(`UPDATE reservations SET deposit_intent_at = now() WHERE id = $1`, [r.id]);

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
          subject: "El cliente está iniciando el pago de seña",
          html: `
            <div style="font-family:system-ui,Segoe UI,Roboto;line-height:1.5">
              <h2>El cliente inició el pago de seña</h2>
              <p><strong>${r.name}</strong> (${r.email}) — Tel: ${r.phone || "-"} — CP: ${r.postal_code || "-"}</p>
              <p>Zona: ${r.zone || "-"}</p>
              <p>Fecha: <strong>${r.event_date}</strong> — ${String(r.event_hour).padStart(2,"0")}:00</p>
              <p>Plan: <strong>${r.plan}</strong></p>
              <p>Revisá el ingreso de la seña ($1 por ahora) en tu app de MP.</p>
            </div>`
        });
      }
    }catch(e){ console.error("MAIL OWNER (confirm-step) ERROR:", e); }

    const payLink = process.env.MP_LINK_1ARS || "";
    return res.status(200).json({ ok:true, payLink });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error: "Error interno" });
  }
}
