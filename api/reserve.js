import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

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

// === NUEVO: formateo de fecha corta en UTC => "Mon 06/10/25"
function formatFechaCortaUTC(dateLike){
  const d = new Date(dateLike);
  const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }); // "Mon"
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${weekday} ${dd}/${mm}/${yy}`;
}

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

    // ===== NUEVO: bloqueo de fechas (pasado, hoy y próximos 3 días)
    function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)){
      return res.status(400).json({ error: "Fecha u hora inválidas" });
    }

    const now = new Date();
    const minSel = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3); // hoy + 3 días 00:00

    // Interpretación local del server; si querés UTC: new Date(`${date}T${time}:00Z`)
    const reqDateTime = new Date(`${date}T${time}:00`);
    const reqDay = startOfDay(reqDateTime);

    if (reqDay < minSel){
      return res.status(400).json({ error: "Solo se aceptan reservas a partir de dentro de 3 días." });
    }
    // ===== FIN BLOQUE NUEVO =====

    const planKey = (plan || "1h").toLowerCase();

    // === NUEVO: buscar plan y precio en DB
    const qPlan = await pool.query(
      `SELECT code, label, price_usd::float
         FROM plans
        WHERE code = $1 AND active = TRUE`,
      [planKey]
    );
    if (qPlan.rowCount === 0){
      return res.status(400).json({ error: "Plan inválido o no disponible" });
    }
    const planRow = qPlan.rows[0];

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
      const qDay = await client.query(`SELECT event_hour FROM reservations WHERE event_date=$1 AND status <> 'rechazada'`, [date]);
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
          user.id, date, hourInt, planRow.code, zone || null, message || null,
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

    // === NUEVO: formateos reutilizables para los emails
    const fechaCorta = formatFechaCortaUTC(reservation.event_date);
    const horaStr = String(reservation.event_hour).padStart(2, "0");

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
        const price = planRow.price_usd;

        const locHtml = `
          <div style="margin-top:12px;padding:12px;border:1px solid #e5e7eb;border-radius:10px">
            <div><strong>Ubicación exacta</strong></div>
            <div>${reservation.location_display || "-"}</div>
            <div>Lat: ${reservation.location_lat} &nbsp; Lng: ${reservation.location_lng}
                &nbsp; (OSM ${reservation.location_osm_id || "-"})</div>
            <div style="margin-top:8px">
              <a href="https://www.google.com/maps?q=${encodeURIComponent(reservation.location_lat)},${encodeURIComponent(reservation.location_lng)}"
                 target="_blank" rel="noreferrer"
                 style="display:inline-block;background:#0ea5e9;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none">
                Abrir en Google Maps
              </a>
            </div>
          </div>`;

        // Mail al OWNER
        await transporter.sendMail({
          from: `Reservas Toro Mecánico <${fromEmail}>`,
          to: ownerEmail,
          subject: "Nueva reserva — Toro Mecánico",
          html: `
          <div style="font-family:system-ui,Segoe UI,Roboto;line-height:1.5">
            <h2>Nueva reserva</h2>
            <p>Datos del usuario: <strong>${user.name}</strong> (${user.email}) — ${user.age} años</p>
            <p>Tel: ${user.phone || "-"} — CP: ${user.postal_code || "-"}</p>
            <p><strong>${fechaCorta}</strong> — la hora del evento: ${horaStr}</p>
            <p>Plan: <strong>${reservation.plan}</strong> — USD ${price}</p>
            ${message ? `<p style="white-space:pre-wrap"> el mensaje del usuario sobre el evento es ${message}</p>` : ""}
            ${locHtml}
            <p style="margin-top:16px">
              <a href="${acceptUrl}" style="background:#16a34a;color:#fff;padding:10px 14px;border-radius:10px;text-decoration:none;margin-right:8px">Aceptar</a>
              <a href="${rejectUrl}" style="background:#dc2626;color:#fff;padding:10px 14px;border-radius:10px;text-decoration:none">Rechazar</a>
            </p>
          </div>`
        });

        // Mail al CLIENTE
        await transporter.sendMail({
          from: `Desde el equipo de Reservas Toro Mecánico <${fromEmail}>`,
          to: user.email,
          subject: "Recibimos tu solicitud de reserva",
          text:
`Hola ${user.name} este mersaje es para confirmarte que:

Recibimos tu solicitud para el ${fechaCorta} a las ${horaStr} (plan ${reservation.plan}).
Ubicación: ${reservation.location_display}
Mapa: https://www.google.com/maps?q=${encodeURIComponent(reservation.location_lat)},${encodeURIComponent(reservation.location_lng)}

Te pedimos que pages la seña en caso de querer confirmar nuestra precencia en el gran evento.  Saludos cordiales`
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
