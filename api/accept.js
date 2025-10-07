import { pool } from "./db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

function signToken(id, email){
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
}

export default async function handler(req, res){
  if (req.method !== "GET") return res.status(405).send("Método no permitido");
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
    if (expected !== token) return res.status(403).send("Token inválido");

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

        await transporter.sendMail({
          from: `Reservas Toro Mecánico <${fromEmail}>`,
          to: r.email,
          subject: "¡Reserva aceptada!",
          html: `
            <div style="font-family:system-ui,Segoe UI,Roboto;line-height:1.5">
              <h2>Tu reserva fue aceptada</h2>
              <p><strong>Fecha:</strong> ${r.event_date} — ${String(r.event_hour).padStart(2,"0")}:00</p>
              <p><strong>Plan:</strong> ${r.plan}</p>
              <p>Todo listo. Nos pondremos en contacto para coordinar detalles.</p>
            </div>`
        });
      }
    }catch(e){ console.error("MAIL CLIENT (accept) ERROR:", e); }

    res.setHeader("Content-Type","text/html; charset=utf-8");
    return res.end(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <div style="font-family:system-ui,Segoe UI,Roboto;padding:24px;max-width:720px;margin:0 auto">
        <h2>Reserva aceptada ✅</h2>
        <p>Se envió un email de confirmación al cliente.</p>
        <p><a href="/">Volver al sitio</a></p>
      </div>
    `);
  }catch(e){
    console.error(e);
    return res.status(500).send("Error interno");
  }
}
