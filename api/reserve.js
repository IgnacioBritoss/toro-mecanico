import { pool } from "./db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

const PRICE_USD = { "1h": 300, "2h": 500 };

function isValidEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e||""); }
function signToken(id, email){
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
}

export default async function handler(req, res){
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try{
    const { name, email, age, zone, message, date, time, plan } = req.body || {};
    if (!name || !email || !age || !date || !time || !zone)
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    if (!isValidEmail(email)) return res.status(400).json({ error: "Email inválido" });
    if (parseInt(age,10) < 18) return res.status(400).json({ error: "Solo mayores de 18 años" });

    const planKey = (plan || "1h").toLowerCase();
    if (!["1h","2h"].includes(planKey)) return res.status(400).json({ error: "Plan inválido" });

    const hourInt = parseInt(time.split(":")[0], 10);

    const client = await pool.connect();
    try{
      await client.query("BEGIN");

      // Upsert user
      const u = await client.query(
        `INSERT INTO users (name, email, age, zone)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO UPDATE SET
           name=EXCLUDED.name, age=EXCLUDED.age, zone=EXCLUDED.zone, updated_at=now()
         RETURNING id, name, email, age, zone`,
        [name, email, age, zone || null]
      );
      const user = u.rows[0];

      // reglas: máximo 2 por día / no duplicar hora
      const qDay = await client.query(`SELECT event_hour FROM reservations WHERE event_date=$1`, [date]);
      if (qDay.rowCount >= 2){ await client.query("ROLLBACK"); return res.status(409).json({ error: "Ese día ya está completo. Elegí otro." }); }
      if (new Set(qDay.rows.map(r=>r.event_hour)).has(hourInt)){
        await client.query("ROLLBACK"); return res.status(409).json({ error: "Esa hora ya está ocupada." });
      }

      // Insert reservation
      const r = await client.query(
        `INSERT INTO reservations (user_id, event_date, event_hour, plan, zone, message, status)
         VALUES ($1,$2,$3,$4,$5,$6,'pendiente')
         RETURNING id, event_date, event_hour, plan, zone, message, created_at`,
        [user.id, date, hourInt, planKey, zone || null, message || null]
      );
      await client.query("COMMIT");
      const reservation = r.rows[0];

      // Email setup
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });

      const ownerEmail = process.env.TO_EMAIL || "britos.toro.147@gmail.com";
      const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;

      // Botón "Aceptar reserva"
      const token = signToken(reservation.id, user.email);
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : ""; // si no está, usamos link relativo
      const acceptUrl = `${baseUrl}/api/accept?id=${reservation.id}&token=${token}`;

      const price = PRICE_USD[planKey];
      const deposit = Math.round(price * 0.10);

      // Email al dueño
      const ownerText = [
        "Nueva reserva Toro Mecánico",
        "",
        "Datos del usuario:",
        `Nombre: ${user.name}`,
        `Email: ${user.email}`,
        `Edad: ${user.age}`,
        `Localidad: ${user.zone || "-"}`,
        "",
        "Datos de la reserva:",
        `Fecha: ${reservation.event_date}`,
        `Hora: ${String(reservation.event_hour).padStart(2,"0")}:00`,
        `Plan: ${reservation.plan} (USD ${price})`,
        `Mensaje: ${reservation.message || "-"}`,
        "",
        `Aceptar: ${acceptUrl}`,
      ].join("\n");

      const ownerHtml = `
        <div style="font-family:system-ui,Segoe UI,Roboto;line-height:1.5">
          <h2>Nueva reserva</h2>
          <p><strong>${user.name}</strong> (${user.email}) — ${user.age} años</p>
          <p>Localidad: ${user.zone || "-"}</p>
          <p><strong>${reservation.event_date}</strong> — ${String(reservation.event_hour).padStart(2,"0")}:00</p>
          <p>Plan: <strong>${reservation.plan}</strong> — USD ${price}</p>
          <p>${reservation.message || ""}</p>
          <p style="margin-top:16px">
            <a href="${acceptUrl}" style="background:#0f172a;color:#fff;padding:10px 14px;border-radius:10px;text-decoration:none">Aceptar reserva</a>
          </p>
        </div>
      `;

      await transporter.sendMail({
        from: `Reservas Toro Mecánico <${fromEmail}>`,
        to: ownerEmail,
        subject: "Nueva reserva — Toro Mecánico",
        text: ownerText,
        html: ownerHtml
      });

      // Email al cliente (recibo de solicitud)
      await transporter.sendMail({
        from: `Reservas Toro Mecánico <${fromEmail}>`,
        to: user.email,
        subject: "Recibimos tu solicitud de reserva",
        text: `Hola ${user.name}, recibimos tu solicitud para el ${reservation.event_date} a las ${String(reservation.event_hour).padStart(2,"0")}:00 (plan ${reservation.plan} — USD ${price}). Te enviaremos otro mail cuando confirmemos disponibilidad.`,
      });

      return res.status(200).json({ ok:true, reservation });
    }catch(e){
      await client.query("ROLLBACK");
      if (e.code === "23505") return res.status(409).json({ error: "Ese horario ya está reservado." });
      console.error(e); return res.status(500).json({ error: "Error interno" });
    }finally{ client.release(); }
  }catch(err){ console.error(err); return res.status(500).json({ error: "Error interno" }); }
}
