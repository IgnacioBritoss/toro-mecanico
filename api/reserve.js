import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

// ---------- helpers base ----------
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

// fecha corta "Mon 06/10/25" en UTC
function formatFechaCortaUTC(dateLike){
  const d = new Date(dateLike);
  const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${weekday} ${dd}/${mm}/${yy}`;
}

// ---------- admin/min helpers ----------
function isAdmin(req){
  return req.user?.is_admin || req.headers["x-admin"] === "1";
}
async function parseJSON(req){
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  try { return JSON.parse(raw); } catch { return {}; }
}
function createTransporter(){
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// ---------- tablas mínimas (evita 500) ----------
async function ensureTables(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.service_zones (
      id BIGSERIAL PRIMARY KEY,
      province TEXT NOT NULL,
      city     TEXT NOT NULL,
      active   BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (province, city)
    );

    CREATE TABLE IF NOT EXISTS public.service_interests (
      id BIGSERIAL PRIMARY KEY,
      province TEXT NOT NULL,
      city     TEXT NOT NULL,
      name     TEXT,
      email    TEXT NOT NULL,
      phone    TEXT,
      notified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (email, province, city)
    );
  `);
}

// ---------- lista negra (seguridad) ----------
const RESTRICTED = [
  { province: "CABA",         city: "Barrio Padre Mugica" },       // Villa 31
  { province: "CABA",         city: "Barrio Padre Ricciardelli" }, // 1-11-14
  { province: "CABA",         city: "Barrio 20" },
  { province: "CABA",         city: "Villa 21-24" },
  { province: "Buenos Aires", city: "Villa Itatí" },
  { province: "Buenos Aires", city: "Villa Azul" },
  { province: "Buenos Aires", city: "La Cava" }
];
function isRestrictedZone(p,c){
  const n = s => String(s||"").trim().toLowerCase();
  return RESTRICTED.some(z => n(z.province)===n(p) && n(z.city)===n(c));
}

// ===================================================================
// Handler
// ===================================================================
export default async function handler(req, res){
  // CORS/preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, PUT, GET, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin");
    return res.status(200).end();
  }
  if (req.method === "HEAD") return res.status(200).end();

  // ===============================
  // Gestión de ZONAS por la MISMA ruta
  // GET/PUT /api/reserve?zones=1
  // ===============================
  if ((req.method === "GET" || req.method === "PUT") && (req.query?.zones === "1" || req.query?.zones === 1)) {
    try {
      // crea tablas si faltan (evita 42P01/500)
      await ensureTables();

      if (req.method === "GET") {
        const { rows } = await pool.query(
          `SELECT id, province, city, active
             FROM public.service_zones
            WHERE province IN ('CABA','Buenos Aires')
            ORDER BY province, city`
        );
        return res.status(200).json(rows);
      }

      // PUT: upsert zonas + desactivar no incluidas + no permitir restringidas
      if (!isAdmin(req)) return res.status(403).json({ error: "No autorizado" });
      const body = await parseJSON(req);
      const zones = Array.isArray(body?.zones) ? body.zones : null;
      if (!zones) return res.status(400).json({ error: "Formato inválido (se espera { zones: [...] })" });

      // filtrar restringidas (no se guardan activas)
      const denied = [];
      const clean = [];
      for (const z of zones){
        if (!z?.province || !z?.city) continue;
        const active = z.active !== false;
        if (active && isRestrictedZone(z.province, z.city)){
          denied.push({ province:z.province, city:z.city });
          continue;
        }
        clean.push({ province:z.province, city:z.city, active });
      }

      const client = await pool.connect();
      const newlyActivated = []; // [{province,city}]
      try {
        await client.query("BEGIN");

        const { rows: before } = await client.query(
          `SELECT province, city, active
             FROM public.service_zones
            WHERE province IN ('CABA','Buenos Aires')`
        );
        const beforeMap = new Map(before.map(r => [`${r.province}||${r.city}`, !!r.active]));

        const upsertText = `
          INSERT INTO public.service_zones (province, city, active)
          VALUES ($1,$2,$3)
          ON CONFLICT (province, city)
          DO UPDATE SET active = EXCLUDED.active, updated_at = now()
          RETURNING province, city, active
        `;
        const keepSet = new Set();
        for (const z of clean) {
          const { rows } = await client.query(upsertText, [z.province, z.city, z.active]);
          const k = `${rows[0].province}||${rows[0].city}`;
          keepSet.add(k);
        }

        const { rows: all } = await client.query(
          `SELECT province, city, active
             FROM public.service_zones
            WHERE province IN ('CABA','Buenos Aires')`
        );
        for (const r of all) {
          const k = `${r.province}||${r.city}`;
          if (!keepSet.has(k) && r.active) {
            await client.query(
              `UPDATE public.service_zones
                  SET active = FALSE, updated_at = now()
                WHERE province = $1 AND city = $2`,
              [r.province, r.city]
            );
          }
        }

        const { rows: after } = await client.query(
          `SELECT province, city, active
             FROM public.service_zones
            WHERE province IN ('CABA','Buenos Aires')`
        );
        for (const r of after) {
          const k = `${r.province}||${r.city}`;
          const wasActive = beforeMap.get(k) || false;
          if (!wasActive && r.active) newlyActivated.push({ province: r.province, city: r.city });
        }

        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(e);
        return res.status(500).json({ error: "Error guardando zonas" });
      } finally {
        client.release();
      }

      // (opcional) notificar interesados al activar nuevas zonas
      const transporter = createTransporter();
      const fromName = process.env.MAIL_FROM_NAME || "Toro Mecánico";
      const fromAddr = process.env.MAIL_FROM_ADDR || process.env.SMTP_USER || "no-reply@tu-dominio.com";

      for (const z of newlyActivated) {
        const { rows: interested } = await pool.query(
          `SELECT id, email
             FROM public.service_interests
            WHERE province = $1 AND city = $2 AND notified_at IS NULL`,
          [z.province, z.city]
        );

        for (const u of interested) {
          try {
            if (transporter) {
              await transporter.sendMail({
                from: `${fromName} <${fromAddr}>`,
                to: u.email,
                subject: "¡Llegamos a tu zona!",
                text:
`Buenas,

¡Tenemos novedades! Ya estamos trabajando en ${z.city} (${z.province}).
Si querés reservar, podés hacerlo desde nuestra web.

Gracias por tu interés.
— Equipo Toro Mecánico`
              });
            }
            await pool.query(
              `UPDATE public.service_interests SET notified_at = now() WHERE id = $1`,
              [u.id]
            );
          } catch (mailErr) {
            console.error("Email error:", mailErr);
          }
        }
      }

      return res.status(200).json({ ok: true, newlyActivated, denied });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error interno (zonas)" });
    }
  }

  // ===============================
  // Flujo normal de reserva (POST)
  // ===============================
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try{
    const {
      name, email, phone, postal_code, age, zone, message, date, time, plan,
      location,
      referred_email,
      province, city
    } = req.body || {};

    if (!name || !email || !age || !date || !time || !phone || !postal_code){
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    if (!isValidEmail(email))        return res.status(400).json({ error: "Email inválido" });
    if (parseInt(age,10) < 18)       return res.status(400).json({ error: "Solo mayores de 18 años" });
    if (!location || !location.display_name || !isValidLatLng(location.lat, location.lng)){
      return res.status(400).json({ error: "Falta ubicación exacta del evento." });
    }

    // referido (opcional)
    const referred = (referred_email || "").trim();
    if (referred) {
      if (!isValidEmail(referred)) {
        return res.status(400).json({ error: "Email de referido inválido" });
      }
      if (referred.toLowerCase() === (email||"").toLowerCase()) {
        return res.status(400).json({ error: "No podés referirte a vos mismo" });
      }
    }

    // validar provincia/ciudad
    const provinceNorm = (province || "").trim();
    const cityNorm     = (city || "").trim();
    if (!provinceNorm || !cityNorm) {
      return res.status(400).json({ error: "Falta provincia o ciudad/partido" });
    }
    // bloquear zonas restringidas
    if (isRestrictedZone(provinceNorm, cityNorm)) {
      return res.status(409).json({ error: "No operamos en esa zona por seguridad." });
    }

    // ¿Zona habilitada?
    await ensureTables(); // por si es la primera vez
    const { rows: allowed } = await pool.query(
      `SELECT 1 FROM public.service_zones
        WHERE province = $1 AND city = $2 AND active = TRUE
        LIMIT 1`,
      [provinceNorm, cityNorm]
    );

    if (allowed.length === 0) {
      // Guardar interés para avisarle cuando se habilite (sin índices raros)
      await pool.query(
        `INSERT INTO public.service_interests (province, city, name, email, phone)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email, province, city) DO NOTHING`,
        [provinceNorm, cityNorm, name || null, email, phone || null]
      );
      return res.status(409).json({ error: "Todavía no llegamos a tu zona" });
    }

    // bloqueo fechas (pasado, hoy y próximos 3 días)
    function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)){
      return res.status(400).json({ error: "Fecha u hora inválidas" });
    }
    const now = new Date();
    const minSel = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
    const reqDateTime = new Date(`${date}T${time}:00`);
    const reqDay = startOfDay(reqDateTime);
    if (reqDay < minSel){
      return res.status(400).json({ error: "Solo se aceptan reservas a partir de dentro de 3 días." });
    }

    const planKey = (plan || "1h").toLowerCase();
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

      // Upsert user
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
      const qDay = await client.query(
        `SELECT event_hour FROM reservations WHERE event_date=$1 AND status <> 'rechazada'`,
        [date]
      );
      if (qDay.rowCount >= 2){
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Ese día ya está completo. Elegí otro." });
      }
      if (new Set(qDay.rows.map(r=>r.event_hour)).has(hourInt)){
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Esa hora ya está ocupada." });
      }

      // Insert reserva con ubicación + referido + provincia/ciudad
      const r = await client.query(
        `INSERT INTO reservations
           (user_id, event_date, event_hour, plan, zone, message, status,
            location_display, location_address, location_lat, location_lng, location_osm_id,
            referred_email, province, city)
         VALUES
           ($1,$2,$3,$4,$5,$6,'pendiente',
            $7,$8,$9,$10,$11,
            $12, $13, $14)
         RETURNING id, event_date, event_hour, plan, zone, message, created_at,
                   location_display, location_address, location_lat, location_lng, location_osm_id,
                   referred_email, province, city`,
        [
          user.id, date, hourInt, planRow.code, zone || null, message || null,
          location.display_name || null,
          (location.address || location.display_name || null),
          Number(location.lat),
          Number(location.lng),
          location.osm_id ? Number(location.osm_id) : null,
          referred ? referred.toLowerCase() : null,
          provinceNorm, cityNorm
        ]
      );
      reservation = r.rows[0];

      // arista de referido (si aplica)
      if (referred) {
        await client.query(
          `INSERT INTO referral_edges (referrer_email, referee_email, reservation_id)
           VALUES ($1, $2, $3)
           ON CONFLICT ON CONSTRAINT uniq_edge_once DO NOTHING`,
          [referred.toLowerCase(), email.toLowerCase(), reservation.id]
        );
      }

      await client.query("COMMIT");
    }catch(e){
      await client.query("ROLLBACK");
      if (e.code === "23505") return res.status(409).json({ error: "Ese horario ya está reservado." });
      console.error("DB ERROR:", e);
      return res.status(500).json({ error: "Error interno (DB)" });
    }finally{
      client.release();
    }

    // emails
    const fechaCorta = formatFechaCortaUTC(reservation.event_date);
    const horaStr = String(reservation.event_hour).padStart(2, "0");

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

        // al dueño
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
            ${reservation.referred_email ? `<p><strong>Referido por:</strong> ${reservation.referred_email}</p>` : ""}
            ${message ? `<p style="white-space:pre-wrap"> el mensaje del usuario sobre el evento es ${message}</p>` : ""}
            ${locHtml}
            <p style="margin-top:16px">
              <a href="${acceptUrl}" style="background:#16a34a;color:#fff;padding:10px 14px;border-radius:10px;text-decoration:none;margin-right:8px">Aceptar</a>
              <a href="${rejectUrl}" style="background:#dc2626;color:#fff;padding:10px 14px;border-radius:10px;text-decoration:none">Rechazar</a>
            </p>
          </div>`
        });

        // al cliente
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
