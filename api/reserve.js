// api/reserve.js
import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

/* ------------------- helpers ------------------- */
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || "");
const sign = (id, email) => {
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
};
const validLatLng = (lat, lng) => {
  const la = Number(lat), ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
};
const mailer = () => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
};
async function bodyJSON(req){
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
const isAdmin = (req) => req.user?.is_admin || req.headers["x-admin"] === "1";

/* --------- villas de emergencia (coincidencia por nombre) --------- */
const VILLA_BLACKLIST = [
  // CABA
  "villa 31","barrio padre mugica","padre mugica","villa 20","villa lugano 20","barrio papa francisco",
  "villa 1-11-14","1-11-14","riccardelli","ricciardelli","bajo flores","villa 21-24","zavaleta",
  "villa 15","ciudad oculta","villa 3","villa 6","villa 17","villa 19","villa 31 bis","villa 31bis",
  "villa 26","villa 2","villa 7","villa 8","villa 13 bis",
  // GBA
  "villa itatí","villa azul","villa azúl","fuerte apache","ejército de los andes","villa caraza",
  "villa la cava","villa palito","villa jardín","villa trujui","villa los paraguayos","la saladita","la saladita de wilde"
].map(s => s.toLowerCase());
const looksBlacklisted = (name = "") => {
  const t = (name || "").toLowerCase();
  return VILLA_BLACKLIST.some(k => t.includes(k));
};

/* ------------- provincia/ciudad/barrio heurístico ------------- */
function inferPCB(display_name = ""){
  const txt = (display_name || "");
  const tokens = txt.split(",").map(s => s.trim());
  const low = txt.toLowerCase();

  const province = /c\.?a\.?b\.?a|ciudad aut[oó]noma de buenos aires|capital federal/.test(low)
    ? "CABA" : "Buenos Aires";

  let city = "";
  for (const tk of tokens){
    const t = tk.toLowerCase();
    if (/quilmes|avellaneda|lan[uú]s|tigre|san isidro|san mart[ií]n|mor[oó]n|lomas de zamora|la matanza|berazategui|almirante brown|esteban echeverr[ií]a|ezeiza|ituzaing[oó]|merlo|vicente l[oó]pez|hurlingham|tres de febrero|berisso|ensenada|malvinas argentinas|san miguel/.test(t)){
      city = tk; break;
    }
  }
  if (!city && province === "CABA") city = "CABA";

  let neighborhood = "";
  if (province === "CABA"){
    const i = tokens.findIndex(x => /caba|ciudad aut[oó]noma/.test(x.toLowerCase()));
    if (i > 0) neighborhood = tokens[i-1];
  }
  return { province, city, neighborhood };
}

/* ----------------- schema: crear si falta ----------------- */
async function ensureSchema(client){
  // usuarios
  await client.query(`
    CREATE TABLE IF NOT EXISTS users(
      id serial PRIMARY KEY,
      name text,
      email text UNIQUE NOT NULL,
      age integer,
      zone text,
      phone text,
      postal_code text,
      updated_at timestamptz DEFAULT now()
    )`);
  // planes
  await client.query(`
    CREATE TABLE IF NOT EXISTS plans(
      code text PRIMARY KEY,
      label text NOT NULL,
      price_usd numeric NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT true
    )`);
  // reservas
  await client.query(`
    CREATE TABLE IF NOT EXISTS reservations(
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_date date NOT NULL,
      event_hour integer NOT NULL,
      plan text NOT NULL REFERENCES plans(code),
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
    )`);
  // referidos
  await client.query(`
    CREATE TABLE IF NOT EXISTS referral_edges(
      id serial PRIMARY KEY,
      referrer_email text NOT NULL,
      referee_email  text NOT NULL,
      reservation_id integer REFERENCES reservations(id) ON DELETE SET NULL
    )`);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname='uniq_edge_once_idx'
      ) THEN
        CREATE UNIQUE INDEX uniq_edge_once_idx ON referral_edges(referrer_email, referee_email, reservation_id);
      END IF;
    END $$;
  `);

  // zonas habilitadas (ciudades/partidos)
  await client.query(`
    CREATE TABLE IF NOT EXISTS service_zones(
      province text NOT NULL,
      city     text NOT NULL,
      active   boolean NOT NULL DEFAULT true,
      updated_at timestamptz DEFAULT now(),
      PRIMARY KEY (province, city)
    )`);
  // bloqueos por barrio
  await client.query(`
    CREATE TABLE IF NOT EXISTS service_blocks(
      province     text NOT NULL,
      city         text NOT NULL,
      neighborhood text NOT NULL,
      active       boolean NOT NULL DEFAULT false, -- false=bloqueado
      updated_at   timestamptz DEFAULT now(),
      PRIMARY KEY (province, city, neighborhood)
    )`);
  // interesados (para avisos cuando habilites una zona)
  await client.query(`
    CREATE TABLE IF NOT EXISTS service_interests(
      id serial PRIMARY KEY,
      province text, city text, neighborhood text,
      name text, email text NOT NULL, phone text,
      lat double precision, lng double precision,
      display_name text,
      created_at timestamptz DEFAULT now(),
      notified_at timestamptz
    )`);
}

/* seed de planes por defecto */
async function seedDefaultPlans(client){
  const r = await client.query(`SELECT COUNT(*)::int AS n FROM plans`);
  if (r.rows[0].n === 0){
    await client.query(
      `INSERT INTO plans(code,label,price_usd,active) VALUES
       ('1h','1 hora',250,true),
       ('2h','2 horas',500,true)
       ON CONFLICT (code) DO NOTHING`
    );
  }
}

/* ------------------ handler ------------------ */
export default async function handler(req, res){
  // CORS básico
  if (req.method === "OPTIONS"){
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, PUT, GET, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin");
    return res.status(200).end();
  }
  if (req.method === "HEAD"){ return res.status(200).end(); }

  /* ===== ZONAS (admin) =====
     GET /api/reserve?zones=1   -> { zones:[...], blacklist:[...] }
     PUT /api/reserve?zones=1   body:{ zones:[{province,city,active}] }
     Por defecto: si no hay filas en service_zones, se considera TODO habilitado.
  */
  if ((req.method === "GET" || req.method === "PUT") &&
      (req.query?.zones === "1" || req.query?.zones === 1)) {
    try{
      if (req.method === "GET"){
        const c = await pool.connect();
        try{
          await ensureSchema(c);
          const { rows: zones } = await c.query(
            `SELECT province, city, active FROM service_zones
             WHERE province IN ('CABA','Buenos Aires')
             ORDER BY province, city`
          );
          return res.status(200).json({
            zones,
            blacklist: VILLA_BLACKLIST
          });
        } finally { c.release(); }
      } else {
        if (!isAdmin(req)) return res.status(403).json({ error:"No autorizado" });
        const body = await bodyJSON(req);
        const zones = Array.isArray(body?.zones) ? body.zones : [];
        const c = await pool.connect();
        try{
          await ensureSchema(c);
          await c.query("BEGIN");
          const up = `
            INSERT INTO service_zones(province, city, active)
            VALUES ($1,$2,$3)
            ON CONFLICT (province, city)
            DO UPDATE SET active=EXCLUDED.active, updated_at=now()
          `;
          const keep = new Set();
          for (const z of zones){
            if (!z?.province || !z?.city) continue;
            const active = z.active === false ? false : true;
            await c.query(up, [z.province, z.city, active]);
            keep.add(`${z.province}||${z.city}`);
          }
          // Desactivar las que no vinieron (solo de CABA y BA)
          const cur = await c.query(`SELECT province, city, active FROM service_zones WHERE province IN ('CABA','Buenos Aires')`);
          for (const r of cur.rows){
            const k = `${r.province}||${r.city}`;
            if (!keep.has(k) && r.active){
              await c.query(`UPDATE service_zones SET active=false, updated_at=now() WHERE province=$1 AND city=$2`, [r.province, r.city]);
            }
          }
          await c.query("COMMIT");
          return res.status(200).json({ ok:true });
        } catch(e){
          try{ await pool.query("ROLLBACK"); }catch{}
          console.error("PUT zones error:", e);
          return res.status(500).json({ error:"Error guardando zonas" });
        } finally { c.release(); }
      }
    }catch(e){
      console.error("zones route error:", e);
      return res.status(500).json({ error:"Error interno (zonas)" });
    }
  }

  /* ===== RESERVA ===== */
  if (req.method !== "POST") return res.status(405).json({ error:"Método no permitido" });

  try{
    const {
      name, email, phone, postal_code, age, message, date, time, plan,
      location, referred_email, province:provIn, city:cityIn, neighborhood:neighIn
    } = await bodyJSON(req);

    // validaciones base
    if (!name || !email || !age || !date || !time || !phone || !postal_code)
      return res.status(400).json({ error:"Faltan campos obligatorios" });
    if (!okEmail(email)) return res.status(400).json({ error:"Email inválido" });
    if (parseInt(age,10) < 18) return res.status(400).json({ error:"Solo mayores de 18 años" });
    if (!location || !location.display_name || !validLatLng(location.lat, location.lng))
      return res.status(400).json({ error:"Falta ubicación exacta del evento." });

    const referred = (referred_email || "").trim();
    if (referred){
      if (!okEmail(referred)) return res.status(400).json({ error:"Email de referido inválido" });
      if (referred.toLowerCase() === String(email).toLowerCase())
        return res.status(400).json({ error:"No podés referirte a vos mismo" });
    }

    // ventana mínima (hoy + 3 días)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
      return res.status(400).json({ error:"Fecha u hora inválidas" });
    const today = new Date(); today.setHours(0,0,0,0);
    const minDay = new Date(today); minDay.setDate(minDay.getDate()+3);
    const reqDay = new Date(`${date}T00:00:00`);
    if (reqDay < minDay) return res.status(400).json({ error:"Solo reservas con 3 días de anticipación." });

    // inferir provincia/ciudad/barrio
    const inf = inferPCB(location.display_name);
    const province = (provIn || inf.province || "").trim();
    const city = (cityIn || inf.city || "").trim();
    const neighborhood = (neighIn || inf.neighborhood || "").trim();

    // blacklist automática (villas)
    if (looksBlacklisted(location.display_name)){
      await pool.query(`
        INSERT INTO service_interests(province,city,neighborhood,name,email,phone,lat,lng,display_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT DO NOTHING
      `, [province||null, city||null, neighborhood||null, name||null, email, phone||null,
          Number(location.lat)||null, Number(location.lng)||null, location.display_name||null]);
      return res.status(409).json({ error:"No trabajamos en esa zona." });
    }

    // verificar zonas (si no hay filas, interpretamos TODO habilitado por defecto)
    let cityAllowed = true;
    try{
      const z = await pool.query(`SELECT 1 FROM service_zones LIMIT 1`);
      if (z.rowCount > 0){
        const q = await pool.query(
          `SELECT 1 FROM service_zones WHERE province=$1 AND city=$2 AND active=TRUE LIMIT 1`,
          [province || "Buenos Aires", city || "CABA"]
        );
        cityAllowed = q.rowCount > 0;
      } // sin filas => no se configuró nada aún => todo permitido
    }catch{
      // tabla aún no creada → todo permitido
      cityAllowed = true;
    }

    if (!cityAllowed){
      await pool.query(`
        INSERT INTO service_interests(province,city,neighborhood,name,email,phone,lat,lng,display_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT DO NOTHING
      `, [province||null, city||null, neighborhood||null, name||null, email, phone||null,
          Number(location.lat)||null, Number(location.lng)||null, location.display_name||null]);
      return res.status(409).json({ error:"Todavía no llegamos a tu zona" });
    }

    // transacción
    const client = await pool.connect();
    let reservation, user;
    try{
      await ensureSchema(client);
      await seedDefaultPlans(client);

      // plan
      const planCode = String(plan || "1h").toLowerCase();
      const qPlan = await client.query(`SELECT code FROM plans WHERE code=$1 AND active=TRUE`, [planCode]);
      if (qPlan.rowCount === 0) return res.status(400).json({ error:"Plan inválido o no disponible" });

      await client.query("BEGIN");

      // upsert usuario (UNIQUE email)
      const u = await client.query(
        `INSERT INTO users(name,email,age,zone,phone,postal_code)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (email) DO UPDATE SET
           name=EXCLUDED.name, age=EXCLUDED.age, zone=EXCLUDED.zone,
           phone=EXCLUDED.phone, postal_code=EXCLUDED.postal_code, updated_at=now()
         RETURNING id, name, email, age, zone, phone, postal_code`,
        [name, email, parseInt(age,10), null, phone || null, postal_code || null]
      );
      user = u.rows[0];

      // disponibilidad (máx 2 por día y sin choques de hora)
      const qDay = await client.query(
        `SELECT event_hour FROM reservations WHERE event_date=$1 AND status <> 'rechazada'`,
        [date]
      );
      if (qDay.rowCount >= 2){
        await client.query("ROLLBACK");
        return res.status(409).json({ error:"Ese día ya está completo. Elegí otro." });
      }
      const taken = new Set(qDay.rows.map(r => r.event_hour));
      const hourInt = parseInt(String(time).split(":")[0], 10);
      if (taken.has(hourInt)){
        await client.query("ROLLBACK");
        return res.status(409).json({ error:"Esa hora ya está ocupada." });
      }

      // insert reserva
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
          user.id, date, hourInt, planCode, null, message || null,
          location.display_name || null,
          (location.address || location.display_name || null),
          Number(location.lat), Number(location.lng),
          location.osm_id ? Number(location.osm_id) : null,
          referred ? referred.toLowerCase() : null,
          province || null, city || null, neighborhood || null
        ]
      );
      reservation = r.rows[0];

      // referidos (único por reserva)
      if (referred){
        await client.query(
          `INSERT INTO referral_edges(referrer_email, referee_email, reservation_id)
           VALUES ($1,$2,$3)
           ON CONFLICT ON CONSTRAINT referral_edges_referrer_email_referee_email_reservation_id_key DO NOTHING`,
          [referred.toLowerCase(), email.toLowerCase(), reservation.id]
        ).catch(async () => {
          // si el nombre de la constraint no coincide, nos cubrimos con el índice único creado arriba
          await client.query(
            `INSERT INTO referral_edges(referrer_email, referee_email, reservation_id)
             VALUES ($1,$2,$3)
             ON CONFLICT DO NOTHING`,
            [referred.toLowerCase(), email.toLowerCase(), reservation.id]
          );
        });
      }

      await client.query("COMMIT");
    }catch(e){
      await client.query("ROLLBACK");
      console.error("DB ERROR:", e);
      return res.status(500).json({ error:"Error interno (DB)" });
    }finally{
      client.release();
    }

    // emails (si hay SMTP, sino continúa igual)
    const tx = mailer();
    if (tx){
      try{
        const ownerEmail = process.env.TO_EMAIL || process.env.SMTP_USER;
        const fromEmail  = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;

        const token = sign(reservation.id, user.email);
        const base =
          process.env.PUBLIC_BASE_URL?.trim() ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
        const acceptUrl = `${base}/api/accept?id=${reservation.id}&token=${token}`;
        const rejectUrl = `${base}/api/reject?id=${reservation.id}&token=${token}`;

        const hh = String(reservation.event_hour).padStart(2, "0");
        const d  = new Date(reservation.event_date);
        const dd = String(d.getUTCDate()).padStart(2,"0");
        const mm = String(d.getUTCMonth()+1).padStart(2,"0");
        const yy = String(d.getUTCFullYear()).slice(-2);
        const fecha = `${dd}/${mm}/${yy}`;

        await tx.sendMail({
          from: `Reservas Toro Mecánico <${fromEmail}>`,
          to: ownerEmail,
          subject: "Nueva reserva",
          html: `
            <div style="font-family:system-ui,Segoe UI,Roboto">
              <h2>Nueva reserva</h2>
              <p><strong>${user.name}</strong> (${user.email}) — ${user.age} años</p>
              <p>Tel: ${user.phone||"-"} — CP: ${user.postal_code||"-"}</p>
              <p><strong>${fecha}</strong> · ${hh}:00 — Plan: <strong>${reservation.plan}</strong></p>
              <p>Prov/Ciudad/Barrio: ${reservation.province||"-"} / ${reservation.city||"-"} / ${reservation.neighborhood||"-"}</p>
              <p>Ubicación: ${reservation.location_display||"-"}</p>
              ${reservation.referred_email ? `<p><strong>Referido por:</strong> ${reservation.referred_email}</p>` : ""}
              <p style="margin-top:12px">
                <a href="${acceptUrl}" style="background:#16a34a;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;margin-right:6px">Aceptar</a>
                <a href="${rejectUrl}" style="background:#dc2626;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none">Rechazar</a>
              </p>
            </div>`
        });

        await tx.sendMail({
          from: `Equipo de Toro Mecánico <${fromEmail}>`,
          to: user.email,
          subject: "Recibimos tu solicitud",
          text: `Hola ${user.name}, recibimos tu solicitud para el ${fecha} a las ${hh}:00 (plan ${reservation.plan}).`
        });
      }catch(e){ console.error("MAIL ERROR:", e); }
    }

    const token = sign(reservation.id, user.email);
    return res.status(200).json({ ok:true, reservation, token });

  }catch(e){
    console.error("GENERIC ERROR:", e);
    return res.status(500).json({ error:"Error interno" });
  }
}
