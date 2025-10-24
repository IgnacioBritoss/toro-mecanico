import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

/* ============ Helpers ============ */
const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (e) => emailRx.test(String(e || "").trim());

function signToken(id, email) {
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
}
function isValidLatLng(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}
function createTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: (process.env.SMTP_PORT || "") === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
function isAdmin(req) {
  // Ajustalo a tu auth real; esto te permite editar zonas desde el panel.
  return req.user?.is_admin || req.headers["x-admin"] === "1";
}
async function parseJSON(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

/* ===== Blacklist de villas (CABA + GBA) ===== */
const VILLA_BLACKLIST = [
  // CABA
  "villa 31","barrio padre mugica","padre mugica","villa 20","villa lugano 20","barrio papa francisco",
  "villa 1-11-14","1-11-14","riccardelli","ricciardelli","bajo flores","villa 21-24","zavaleta",
  "villa 15","ciudad oculta","villa 3","villa 6","villa 17","villa 19","villa 31 bis","villa 31bis",
  "villa 26","villa 2","villa 7","villa 8","villa 13 bis",
  // GBA
  "villa itatí","villa azul","fuerte apache","ejército de los andes","villa caraza","villa la cava",
  "villa palito","villa jardín","villa trujui","villa los paraguayos","la saladita","la saladita de wilde"
].map(s => s.toLowerCase());

const looksBlacklisted = (displayName = "") => {
  const t = displayName.toLowerCase();
  return VILLA_BLACKLIST.some(k => t.includes(k));
};

/* ===== Inferencia simple de provincia/ciudad/barrio desde display_name ===== */
function inferProvinceCityNeighborhood({ display_name = "" } = {}) {
  const txt = (display_name || "").toLowerCase();
  const province = /c\.?a\.?b\.?a|ciudad aut[oó]noma de buenos aires|capital federal/.test(txt)
    ? "CABA"
    : "Buenos Aires";

  const tokens = display_name.split(",").map(s => s.trim());
  let city = "";
  for (const tk of tokens) {
    const t = tk.toLowerCase();
    if (/quilmes|avellaneda|lan[uú]s|tigre|san isidro|san mart[ií]n|mor[oó]n|lomas de zamora|la matanza|berazategui|almirante brown|esteban echeverr[ií]a|ezeiza|ituzaing[oó]|merlo|vicente l[oó]pez|hurlingham|tres de febrero|malvinas argentinas|san miguel|berisso|ensenada/.test(t)) {
      city = tk; break;
    }
    if (province === "CABA" && /caba|buenos aires/.test(t)) { city = "CABA"; }
  }

  let neighborhood = "";
  if (province === "CABA") {
    const iCaba = tokens.findIndex(x => /caba|ciudad aut[oó]noma/.test(x.toLowerCase()));
    if (iCaba > 0) neighborhood = tokens[iCaba - 1].trim();
  }
  return { province, city, neighborhood };
}

/* ===== Auto-migraciones mínimas ===== */
async function ensureCoreTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users(
      id serial PRIMARY KEY,
      name text,
      email text UNIQUE NOT NULL,
      age int,
      zone text,
      phone text,
      postal_code text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS reservations(
      id serial PRIMARY KEY,
      user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_date date NOT NULL,
      event_hour int NOT NULL,
      plan text NOT NULL,
      zone text,
      message text,
      status text NOT NULL DEFAULT 'pendiente',
      location_display text,
      location_address text,
      location_lat double precision,
      location_lng double precision,
      location_osm_id bigint,
      referred_email text,
      province text,
      city text,
      neighborhood text,
      created_at timestamptz DEFAULT now()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS referral_edges(
      referrer_email text NOT NULL,
      referee_email  text NOT NULL,
      reservation_id int REFERENCES reservations(id) ON DELETE CASCADE
    );
  `);
  // Constraint única (si no existe)
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uniq_edge_once'
      ) THEN
        ALTER TABLE referral_edges
        ADD CONSTRAINT uniq_edge_once UNIQUE (referrer_email, referee_email, reservation_id);
      END IF;
    END$$;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS service_zones(
      province text NOT NULL,
      city     text NOT NULL,
      active   boolean NOT NULL DEFAULT true,
      updated_at timestamptz DEFAULT now(),
      PRIMARY KEY (province, city)
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS service_blocks(
      province     text NOT NULL,
      city         text NOT NULL,
      neighborhood text NOT NULL,
      active       boolean NOT NULL DEFAULT false,
      updated_at   timestamptz DEFAULT now(),
      PRIMARY KEY (province, city, neighborhood)
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS service_interests(
      id serial PRIMARY KEY,
      province text,
      city text,
      neighborhood text,
      name text,
      email text NOT NULL,
      phone text,
      lat double precision,
      lng double precision,
      display_name text,
      created_at timestamptz DEFAULT now(),
      notified_at timestamptz
    );
  `);
}

/* ====== RUTA PRINCIPAL ====== */
export default async function handler(req, res) {
  // CORS/health
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, PUT, GET, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin");
    return res.status(200).end();
  }
  if (req.method === "HEAD") return res.status(200).end();

  /* === Admin: zonas === */
  if ((req.method === "GET" || req.method === "PUT") &&
      (req.query?.zones === "1" || req.query?.zones === 1)) {
    try {
      if (req.method === "GET") {
        try {
          const { rows: zones } = await pool.query(
            `SELECT province, city, active
               FROM service_zones
              WHERE province IN ('CABA','Buenos Aires')
              ORDER BY province, city`
          );
          let blocks = [];
          try {
            const qb = await pool.query(
              `SELECT province, city, neighborhood, active
                 FROM service_blocks
                WHERE province IN ('CABA','Buenos Aires')
                ORDER BY province, city, neighborhood`
            );
            blocks = qb.rows || [];
          } catch (e2) {
            if (e2.code !== "42P01") throw e2;
          }
          return res.status(200).json({ zones, blocks, blacklist: VILLA_BLACKLIST });
        } catch (e) {
          if (e.code === "42P01") {
            return res.status(200).json({ setup_needed: true, zones: [], blocks: [], blacklist: VILLA_BLACKLIST });
          }
          throw e;
        }
      }
      // PUT
      if (!isAdmin(req)) return res.status(403).json({ error: "No autorizado" });
      const body = await parseJSON(req);
      const zones = Array.isArray(body?.zones) ? body.zones : [];

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await ensureCoreTables(client);

        // upsert zonas
        const upsertZone = `
          INSERT INTO service_zones (province, city, active)
          VALUES ($1,$2,$3)
          ON CONFLICT (province, city)
          DO UPDATE SET active=EXCLUDED.active, updated_at=now()
        `;
        const keep = new Set();
        for (const z of zones) {
          if (!z?.province || !z?.city) continue;
          const act = z.active === false ? false : true;
          await client.query(upsertZone, [z.province, z.city, act]);
          keep.add(`${z.province}||${z.city}`);
        }
        // Desactivar las que no mandaste
        const { rows: all } = await client.query(
          `SELECT province, city, active FROM service_zones WHERE province IN ('CABA','Buenos Aires')`
        );
        for (const r of all) {
          const k = `${r.province}||${r.city}`;
          if (!keep.has(k) && r.active) {
            await client.query(`UPDATE service_zones SET active=false, updated_at=now()
                                 WHERE province=$1 AND city=$2`, [r.province, r.city]);
          }
        }

        await client.query("COMMIT");
        return res.status(200).json({ ok: true });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("PUT /api/reserve?zones=1 error:", e);
        return res.status(500).json({ error: "Error guardando zonas" });
      } finally {
        client.release();
      }
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error interno (zonas)" });
    }
  }

  /* === POST reserva === */
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const {
      name, email, phone, postal_code, age, message, date, time, plan,
      location, referred_email, province: provinceIn, city: cityIn, neighborhood: neighIn
    } = req.body || {};

    // Requisitos base
    if (!name || !email || !age || !date || !time || !phone || !postal_code)
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    if (!isValidEmail(email))  return res.status(400).json({ error: "Email inválido" });
    if (parseInt(age, 10) < 18) return res.status(400).json({ error: "Solo mayores de 18 años" });
    if (!location || !location.display_name || !isValidLatLng(location.lat, location.lng))
      return res.status(400).json({ error: "Falta ubicación exacta del evento." });

    // Referido opcional
    const referred = (referred_email || "").trim();
    if (referred) {
      if (!isValidEmail(referred)) return res.status(400).json({ error: "Email de referido inválido" });
      if (referred.toLowerCase() === String(email).toLowerCase())
        return res.status(400).json({ error: "No podés referirte a vos mismo" });
    }

    // Fecha/hora válidas y lead time (hoy+3)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
      return res.status(400).json({ error: "Fecha u hora inválidas" });
    const now = new Date();
    const minSel = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
    const reqDt = new Date(`${date}T${time}:00`);
    const reqDay = new Date(reqDt.getFullYear(), reqDt.getMonth(), reqDt.getDate());
    if (reqDay < minSel) return res.status(400).json({ error: "Solo se aceptan reservas a partir de dentro de 3 días." });

    // Provincia/Ciudad/Barrio
    const inferred = inferProvinceCityNeighborhood({ display_name: location.display_name });
    const province = (provinceIn || inferred.province || "").trim();
    const city = (cityIn || inferred.city || "").trim();
    const neighborhood = (neighIn || inferred.neighborhood || "").trim();

    // Villas bloqueadas automáticamente
    if (looksBlacklisted(location.display_name)) {
      await pool.query(`
        INSERT INTO service_interests (province, city, neighborhood, name, email, phone, lat, lng, display_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT DO NOTHING
      `, [province || null, city || null, neighborhood || null, name || null, email, phone || null,
          Number(location.lat) || null, Number(location.lng) || null, location.display_name || null]);
      return res.status(409).json({ error: "No trabajamos en esa zona." });
    }

    // Validación de ciudad habilitada (si no hay registros, por defecto permitimos)
    let cityAllowed = true;
    try {
      const q = await pool.query(
        `SELECT 1 FROM service_zones WHERE province=$1 AND city=$2 AND active=TRUE LIMIT 1`,
        [province || "Buenos Aires", city || "CABA"]
      );
      // Si hay al menos una zona configurada en la tabla y no está activa esta ciudad, bloqueamos.
      const anyZones = (await pool.query(`SELECT 1 FROM service_zones LIMIT 1`)).rowCount > 0;
      cityAllowed = anyZones ? (q.rowCount > 0) : true;
    } catch (e) {
      if (e.code !== "42P01") throw e; // si no existe la tabla, permitimos
      cityAllowed = true;
    }

    // Bloqueo puntual de barrio
    let neighborhoodBlocked = false;
    if (neighborhood) {
      try {
        const qb = await pool.query(
          `SELECT 1 FROM service_blocks
            WHERE province=$1 AND city=$2 AND neighborhood=$3 AND active=FALSE LIMIT 1`,
          [province || "Buenos Aires", city || "CABA", neighborhood]
        );
        neighborhoodBlocked = qb.rowCount > 0;
      } catch (e) {
        if (e.code !== "42P01") throw e;
      }
    }

    if (!cityAllowed || neighborhoodBlocked) {
      await pool.query(`
        INSERT INTO service_interests (province, city, neighborhood, name, email, phone, lat, lng, display_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT DO NOTHING
      `, [province || null, city || null, neighborhood || null, name || null, email, phone || null,
          Number(location.lat) || null, Number(location.lng) || null, location.display_name || null]);
      return res.status(409).json({ error: "Todavía no llegamos a tu zona" });
    }

    // Plan válido (si no hay tabla plans, usamos defaults)
    let planRow = null;
    const planKey = String(plan || "1h").toLowerCase();
    try {
      const qPlan = await pool.query(
        `SELECT code, label, price_usd::float FROM plans WHERE code=$1 AND active=TRUE`,
        [planKey]
      );
      if (qPlan.rowCount > 0) planRow = qPlan.rows[0];
    } catch (e) {
      if (e.code !== "42P01") throw e;
    }
    if (!planRow) {
      // fallback
      const defaults = {
        "1h": { code: "1h", label: "1 hora", price_usd: 250 },
        "2h": { code: "2h", label: "2 horas", price_usd: 500 }
      };
      planRow = defaults[planKey];
      if (!planRow) return res.status(400).json({ error: "Plan inválido o no disponible" });
    }

    // Disponibilidad + creación
    const hourInt = parseInt(String(time).split(":")[0], 10);
    const client = await pool.connect();
    let reservation, user;
    try {
      await client.query("BEGIN");
      await ensureCoreTables(client);

      // Upsert usuario
      const u = await client.query(
        `INSERT INTO users (name, email, age, zone, phone, postal_code)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (email) DO UPDATE SET
           name=EXCLUDED.name, age=EXCLUDED.age, zone=EXCLUDED.zone,
           phone=EXCLUDED.phone, postal_code=EXCLUDED.postal_code, updated_at=now()
         RETURNING id, name, email, age, zone, phone, postal_code`,
        [name, email, parseInt(age, 10), null, phone || null, postal_code || null]
      );
      user = u.rows[0];

      // Chequear día/hora
      const qDay = await client.query(
        `SELECT event_hour FROM reservations
          WHERE event_date=$1 AND status <> 'rechazada'`,
        [date]
      );
      if (qDay.rowCount >= 2) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Ese día ya está completo. Elegí otro." });
      }
      if (new Set(qDay.rows.map(r => r.event_hour)).has(hourInt)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Esa hora ya está ocupada." });
      }

      // Insert reserva
      const r = await client.query(
        `INSERT INTO reservations
           (user_id, event_date, event_hour, plan, zone, message, status,
            location_display, location_address, location_lat, location_lng, location_osm_id,
            referred_email, province, city, neighborhood)
         VALUES
           ($1,$2,$3,$4,$5,$6,'pendiente',
            $7,$8,$9,$10,$11,
            $12,$13,$14,$15)
         RETURNING id, event_date, event_hour, plan, zone, message, created_at,
                   location_display, location_address, location_lat, location_lng, location_osm_id,
                   referred_email, province, city, neighborhood`,
        [
          user.id, date, hourInt, planRow.code, null, message || null,
          location.display_name || null,
          (location.address || location.display_name || null),
          Number(location.lat), Number(location.lng),
          location.osm_id ? Number(location.osm_id) : null,
          referred ? referred.toLowerCase() : null,
          province || null, city || null, neighborhood || null
        ]
      );
      reservation = r.rows[0];

      // Arista de referidos
      if (referred) {
        await client.query(
          `INSERT INTO referral_edges (referrer_email, referee_email, reservation_id)
           VALUES ($1,$2,$3)
           ON CONFLICT ON CONSTRAINT uniq_edge_once DO NOTHING`,
          [referred.toLowerCase(), email.toLowerCase(), reservation.id]
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      if (e.code === "23505") return res.status(409).json({ error: "Ese horario ya está reservado." });
      console.error("DB ERROR:", e);
      return res.status(500).json({ error: "Error interno (DB)" });
    } finally {
      client.release();
    }

    // Emails (opcional)
    try {
      const transporter = createTransporter();
      if (transporter) {
        const ownerEmail = process.env.TO_EMAIL || process.env.SMTP_USER;
        const fromEmail  = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;

        const token = signToken(reservation.id, user.email);
        const baseUrl =
          process.env.PUBLIC_BASE_URL?.trim() ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
        const acceptUrl = `${baseUrl}/api/accept?id=${reservation.id}&token=${token}`;
        const rejectUrl = `${baseUrl}/api/reject?id=${reservation.id}&token=${token}`;

        const hh = String(reservation.event_hour).padStart(2, "0");
        const d = new Date(reservation.event_date);
        const dd = String(d.getUTCDate()).padStart(2, "0");
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const yy = String(d.getUTCFullYear()).slice(-2);
        const fechaCorta = `${dd}/${mm}/${yy}`;

        await transporter.sendMail({
          from: `Reservas Toro Mecánico <${fromEmail}>`,
          to: ownerEmail,
          subject: "Nueva reserva",
          html: `
            <div style="font-family:system-ui,Segoe UI,Roboto">
              <h2>Nueva reserva</h2>
              <p><strong>${user.name}</strong> (${user.email}) — ${user.age} años</p>
              <p>Tel: ${user.phone || "-"} — CP: ${user.postal_code || "-"}</p>
              <p><strong>${fechaCorta}</strong> · ${hh}:00 — Plan: <strong>${reservation.plan}</strong></p>
              <p>Prov/Ciudad/Barrio: ${reservation.province || "-"} / ${reservation.city || "-"} / ${reservation.neighborhood || "-"}</p>
              <p>Ubicación: ${reservation.location_display || "-"}</p>
              ${reservation.referred_email ? `<p><strong>Referido por:</strong> ${reservation.referred_email}</p>` : ""}
              <p style="margin-top:12px">
                <a href="${acceptUrl}" style="background:#16a34a;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;margin-right:6px">Aceptar</a>
                <a href="${rejectUrl}" style="background:#dc2626;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none">Rechazar</a>
              </p>
            </div>`
        });

        await transporter.sendMail({
          from: `Equipo de Toro Mecánico <${fromEmail}>`,
          to: user.email,
          subject: "Recibimos tu solicitud",
          text: `Hola ${user.name}, recibimos tu solicitud para el ${fechaCorta} a las ${hh}:00 (plan ${reservation.plan}).`
        });
      }
    } catch (e) {
      console.error("MAIL ERROR:", e);
    }

    const token = signToken(reservation.id, email);
    return res.status(200).json({ ok: true, reservation, token });
  } catch (err) {
    console.error("GENERIC ERROR:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}
