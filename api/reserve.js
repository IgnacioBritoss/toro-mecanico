import { pool } from "./db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

const PRICE_USD = { "1h": 300, "2h": 500 };

/* ========== Helpers ========== */
function isValidEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e||""); }
function signToken(id, email){
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
}
function isValidLatLng(lat, lng){
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  return la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}
function pad2(n){ return String(n).padStart(2, "0"); }
function safe(v){ return (v ?? "").toString().trim(); }
function htmlEscape(str=""){
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function formatFechaAR(dateStr){
  const d = new Date(`${dateStr}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short", day: "2-digit", month: "long", year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires"
  }).format(d);
}
function datosUsuarioHTML(u){
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr><td style="padding:8px 0;font-weight:700">Datos del usuario</td></tr>
    <tr><td style="padding:4px 0">Nombre: <strong>${htmlEscape(safe(u.name))}</strong></td></tr>
    <tr><td style="padding:4px 0">Edad: <strong>${htmlEscape(safe(u.age))}</strong></td></tr>
    <tr><td style="padding:4px 0">Email: <strong>${htmlEscape(safe(u.email))}</strong></td></tr>
    <tr><td style="padding:4px 0">Teléfono: <strong>${htmlEscape(safe(u.phone)) || "-"}</strong></td></tr>
    <tr><td style="padding:4px 0">Código postal: <strong>${htmlEscape(safe(u.postal_code)) || "-"}</strong></td></tr>
  </table>`;
}
function ubicacionHTML(r){
  const addr = safe(r.location_display);
  const lat  = String(r.location_lat ?? "");
  const lng  = String(r.location_lng ?? "");
  const osm  = r.location_osm_id ? String(r.location_osm_id) : "";
  const gmaps = (lat && lng) ? `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}` : "";
  return `
  <div style="margin-top:12px;padding:12px;border:1px solid #e5e7eb;border-radius:10px">
    <div><strong>Ubicación exacta</strong></div>
    <div>${htmlEscape(addr || "-")}</div>
    <div>Lat: ${htmlEscape(lat || "-")} &nbsp; Lng: ${htmlEscape(lng || "-")}${osm ? ` &nbsp; (OSM ${htmlEscape(osm)})` : ""}</div>
    ${gmaps ? `<div style="margin-top:8px">
      <a href="${gmaps}" target="_blank" rel="noreferrer"
         style="display:inline-block;background:#0f172a;color:#fff;padding:10px 12px;border-radius:10px;text-decoration:none">
        Abrir en Google Maps
      </a>
    </div>` : ``}
  </div>`;
}
/* ============================================== */

export default async function handler(req, res){
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try{
    const {
      name, email, phone, postal_code, age, zone, message, date, time, plan,
      location
    } = req.body || {};

    // ⚠️ zone YA NO ES REQUERIDO
    if (!name || !email || !age || !date || !time || !phone || !postal_code){
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    if (!isValidEmail(email))        return res.status(400).json({ error: "Email inválido" });
    if (parseInt(age,10) < 18)       return res.status(400).json({ error: "Solo mayores de 18 años" });
    if (!location || !location.display_name || !isValidLatLng(location.lat, location.lng)){
      return res.status(400).json({ error: "Falta ubicación exacta del evento." });
    }

    const planKey = (plan || "1h").toLowerCase();
    if (!["1h","2h"].includes(planKey)) return res.status(400).json({ error: "Plan inválido" });

    const hourInt = parseInt(String(time).split(":")[0], 10);

    const client = await pool.connect();
    let reservation, user;
    try{
      await client.query("BEGIN");

      // Upsert user (zone opcional)
      const u = await client.query(
        `INSERT INTO users (name, email, age, zone, phone, postal_code)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (email) DO UPDATE SET
           name=EXCLUDED.name, age=EXCLUDED.age, zone=EXCLUDED.zone,
           phone=EXCLUDED.phone, postal_code=EXCLUDED.postal_code, updated_at=now()
         RETURNING id, name, email, age, zone, phone, postal_code`,
        [name, email, age, zone || null, phone || null, postal_code || null]
      );
      user = u.rows[0];

      // Disponibilidad
      const qDay = await client.query(`SELECT event_hour FROM reservations WHERE event_date=$1`, [date]);
      if (qDay.rowCount >= 2){
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Ese día ya está completo. Elegí otro." });
      }
      if (new Set(qDay.rows.map(r=>r.event_hour)).has(hourInt)){
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Esa hora ya está ocupada." });
      }

      // Insert con ubicación
      const r = await client.query(
        `INSERT INTO reservations
           (user_id, event_date, event_hour, plan, zone, message, status,
            location_display, location_address, location_lat, location_lng, location_osm_id)
         VALUES
           ($1,$2,$3,$4,$5,$6,'pendiente',
            $7,$8,$9,$10,$11)
         RETURNING id, event_date, event_hour, plan, zone, message, created_at,
                   location_display, location_address, location_lat, location_lng, location_osm_id`,
        [
          user.id, date, hourInt, planKey, zone || null, message || null,
          location.display_name || null,
          (location.address || location.display_name || null),
          Number(location.lat),
          Number(location.lng),
          location.osm_id ? Number(location.osm_id) : null
        ]
      );
      reservation = r.rows[0];

      await client.query("COMMIT");
    }catch(e){
      await client.query("ROLLBACK");
      if (e.code === "23505") return res.status(409).json({ error: "Ese horario ya está reservado." });
      console.error("DB ERROR:", e);
      return res.status(500).json({ error: "Error interno (DB)" });
    }finally{
      client.release();
    }

    // ---- Emails ----
    let mailError = null;
    try {
      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587", 10),
          secure: process.env.SMTP_PORT === "465",
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });

        const ownerEmail = process.env.TO_EMAIL || process.env.SMTP_USER;
        const fromEmail  = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;

        const token = signToken(reservation.id, user.email);
        const baseUrl =
          process.env.PUBLIC_BASE_URL?.trim() ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

        const acceptUrl = `${baseUrl}/api/accept?id=${reservation.id}&token=${token}`;
        const rejectUrl = `${baseUrl}/api/reject?id=${reservation.id}&token=${token}`;
        const price = PRICE_USD[reservation.plan];

        const fecha = formatFechaAR(reservation.event_date);
        const hora  = `${pad2(reservation.event_hour)}:00`;
        const planLabel = reservation.plan === "2h" ? "2 horas" : "1 hora";

        // Mail al OWNER (formal, con datos + ubicación + comentario, botones)
        await transporter.sendMail({
          from: `Reservas Toro Mecánico <${fromEmail}>`,
          to: ownerEmail,
          subject: "Nueva reserva — Toro Mecánico",
          html: `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Noto Sans';color:#0f172a;line-height:1.55">
            <div style="max-width:720px;margin:0 auto;padding:24px 16px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px">
              <h1 style="margin:0 0 12px;font-size:22px">Nueva reserva</h1>

              ${datosUsuarioHTML(user)}

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:12px">
                <tr><td style="padding:4px 0">Fecha: <strong>${fecha}</strong> — <strong>${hora} hs</strong></td></tr>
                <tr><td style="padding:4px 0">Plan: <strong>${planLabel}</strong> — USD ${price}</td></tr>
                ${safe(message) ? `<tr><td style="padding:4px 0">Comentario: <strong>${htmlEscape(safe(message))}</strong></td></tr>` : ``}
              </table>

              ${ubicacionHTML(reservation)}

              <p style="margin-top:16px">
                <a href="${acceptUrl}" style="background:#16a34a;color:#fff;padding:10px 14px;border-radius:10px;text-decoration:none;margin-right:8px">Aceptar</a>
                <a href="${rejectUrl}" style="background:#dc2626;color:#fff;padding:10px 14px;border-radius:10px;text-decoration:none">Rechazar</a>
              </p>
            </div>
            <p style="max-width:720px;margin:10px auto 0;color:#64748b;font-size:12px">Este correo fue enviado automáticamente por el sistema de reservas.</p>
          </div>`
        });

        // Mail al CLIENTE (formal, sin GMT/UTC, con ubicación y comentario)
        await transporter.sendMail({
          from: `Reservas Toro Mecánico <${fromEmail}>`,
          to: user.email,
          subject: "Hemos recibido su solicitud de reserva",
          html: `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Noto Sans';color:#0f172a;line-height:1.55">
            <div style="max-width:720px;margin:0 auto;padding:24px 16px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px">
              <h1 style="margin:0 0 12px;font-size:22px">Hemos recibido su solicitud</h1>
              <p>Estimado/a ${htmlEscape(safe(user.name))},</p>
              <p>Recibimos su solicitud de reserva para el <strong>${fecha}</strong> a las <strong>${hora} hs</strong> (plan <strong>${planLabel}</strong>).</p>
              ${ubicacionHTML(reservation)}
              ${safe(message) ? `<p style="margin-top:14px"><strong>Comentario:</strong> ${htmlEscape(safe(message))}</p>` : ``}
              <p style="margin-top:16px">En el siguiente paso podrá confirmar la seña. Nos comunicaremos a la brevedad de ser necesario.</p>
            </div>
            <p style="max-width:720px;margin:10px auto 0;color:#64748b;font-size:12px">Este correo fue enviado automáticamente por el sistema de reservas.</p>
          </div>`
        });
      }
    } catch (e) {
      console.error("MAIL ERROR:", e);
      mailError = e.message || "email failed";
    }

    const token = signToken(reservation.id, user.email);
    return res.status(200).json({ ok: true, reservation, token, mailError });

  }catch(err){
    console.error("GENERIC ERROR:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}
