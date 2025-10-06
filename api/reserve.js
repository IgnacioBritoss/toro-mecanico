import { pool } from "./db.js";
import nodemailer from "nodemailer";

export const config = {
  runtime: "nodejs18.x"
};

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }
  try {
    const { name, email, age, zone, message, date, time, plan } = req.body || {};

    if (!name || !email || !age || !date || !time) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Email inválido" });
    }
    if (parseInt(age, 10) < 18) {
      return res.status(400).json({ error: "Solo mayores de 18 años" });
    }
    const planNorm = (plan || "hora").toLowerCase();
    if (!["hora","medio","completo"].includes(planNorm)) {
      return res.status(400).json({ error: "Plan inválido" });
    }

    // Transacción simple
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Upsert de usuario por email
      const upsertUser = `
        INSERT INTO users (name, email, age, zone)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (email) DO UPDATE SET
          name = EXCLUDED.name,
          age = EXCLUDED.age,
          zone = EXCLUDED.zone,
          updated_at = now()
        RETURNING id, email, name, age, zone;
      `;
      const ures = await client.query(upsertUser, [name, email, age, zone || null]);
      const user = ures.rows[0];

      // Evitar doble booking por fecha+hora
      const insertRes = `
        INSERT INTO reservations (user_id, event_date, event_hour, plan, zone, message)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, event_date, event_hour, plan, zone, message, created_at;
      `;
      const rres = await client.query(insertRes, [
        user.id,
        date,                         // YYYY-MM-DD
        parseInt(time.split(":")[0], 10), // HH
        planNorm,
        zone || null,
        message || null
      ]);

      await client.query("COMMIT");
      const reservation = rres.rows[0];

      // Enviar email al propietario
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      const ownerEmail = process.env.TO_EMAIL || "britosignacio106@gmail.com";
      const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;

      const textBody = [
        "Nueva reserva Toro Mecánico",
        "",
        "Datos del usuario:",
        `Nombre: ${user.name}`,
        `Email: ${user.email}`,
        `Edad: ${user.age}`,
        `Zona: ${user.zone || "-"}`,
        "",
        "Datos de la reserva:",
        `Fecha: ${reservation.event_date}`,
        `Hora: ${String(reservation.event_hour).padStart(2,"0")}:00`,
        `Plan: ${reservation.plan}`,
        `Mensaje: ${reservation.message || "-"}`,
        "",
        "Recordatorio: confirmar disponibilidad y coordinar seña."
      ].join("\n");

      await transporter.sendMail({
        from: `Reservas Toro Mecánico <${fromEmail}>`,
        to: ownerEmail,
        subject: "Nueva reserva — Toro Mecánico",
        text: textBody
      });

      // (Opcional) email de confirmación al usuario
      if (process.env.SEND_USER_MAIL === "true") {
        await transporter.sendMail({
          from: `Reservas Toro Mecánico <${fromEmail}>`,
          to: user.email,
          subject: "Recibimos tu solicitud de reserva",
          text: `Hola ${user.name}, recibimos tu solicitud para el ${reservation.event_date} a las ${String(reservation.event_hour).padStart(2,"0")}:00, plan ${reservation.plan}. Te contactaremos para confirmar.`
        });
      }

      return res.status(200).json({ ok: true, reservation });
    } catch (e) {
      await client.query("ROLLBACK");
      if (e.code === "23505") {
        // Violación de UNIQUE (fecha+hora)
        return res.status(409).json({ error: "Ese horario ya está reservado. Elegí otro." });
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  }
}
