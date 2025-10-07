import { pool } from "./db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

const PRICE_USD = { "1h": 300, "2h": 500 };

function signToken(id, email){
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
}

export default async function handler(req, res){
  if (req.method !== "GET") return res.status(405).json({ error:"Método no permitido" });

  const { id, token } = req.query || {};
  if (!id || !token) return res.status(400).send("Link inválido");

  try{
    const { rows } = await pool.query(`
      SELECT r.id, r.event_date, r.event_hour, r.plan, r.status, u.name, u.email
      FROM reservations r
      JOIN users u ON u.id = r.user_id
      WHERE r.id = $1
    `,[id]);
    if (!rows.length) return res.status(404).send("Reserva no encontrada");

    const r = rows[0];
    const expected = signToken(r.id, r.email);
    if (expected !== token) return res.status(403).send("Token inválido");

    // marcar aceptada si aún no lo estaba
    if (r.status !== "aceptada"){
      await pool.query(`UPDATE reservations SET status='aceptada' WHERE id=$1`, [r.id]);
    }

    const price = PRICE_USD[r.plan] || 0;
    const deposit = Math.round(price * 0.10);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_PORT === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    const ownerEmail = process.env.TO_EMAIL || "britos.toro.147@gmail.com";
    const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;

    // Email al cliente con instrucciones de seña
    await transporter.sendMail({
      from: `Reservas Toro Mecánico <${fromEmail}>`,
      to: r.email,
      subject: "Reserva aceptada — Señá el 10%",
      text: [
        `Hola ${r.name}, ¡tu reserva fue aceptada!`,
        `Fecha: ${r.event_date} — ${String(r.event_hour).padStart(2,"0")}:00`,
        `Plan: ${r.plan} — USD ${price}`,
        ``,
        `Para confirmar, debés señar el 10%: USD ${deposit}.`,
        `Te contactaremos con el link de pago o Mercado Pago cuando esté listo.`,
      ].join("\n")
    });

    // Landing simple
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <div style="font-family:system-ui,Segoe UI,Roboto;padding:24px;max-width:720px;margin:0 auto">
        <h2>Reserva aceptada ✅</h2>
        <p>Enviamos un email al cliente con las instrucciones para señar el 10%.</p>
        <p><strong>Fecha:</strong> ${r.event_date} — ${String(r.event_hour).padStart(2,"0")}:00</p>
        <p><strong>Plan:</strong> ${r.plan} — USD ${price}</p>
        <p><a href="/">Volver al sitio</a></p>
      </div>
    `);
  }catch(e){
    console.error(e);
    return res.status(500).send("Error interno");
  }
}
