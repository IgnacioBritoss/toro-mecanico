// api/reserve.js
import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

/* =========================
   Helpers
========================= */
function isValidEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e||""); }
function signToken(id, email){
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
}
function isValidLatLng(lat, lng){
  const la = Number(lat), ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && la>=-90 && la<=90 && ln>=-180 && ln<=180;
}
function createTransporter(){
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT="587" } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10),
    secure: SMTP_PORT === "465",
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}
function isAdmin(req){
  // Si usás otra auth, adaptalo.
  return req.user?.is_admin || req.headers["x-admin"] === "1";
}
async function readJSON(req){
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { return {}; }
}

/* =========================
   Villas / Lugares peligrosos
   (se bloquean por coincidencia parcial en display_name)
========================= */
const VILLA_BLACKLIST = [
  // CABA
  "villa 31","barrio padre mugica","padre mugica",
  "villa 20","barrio papa francisco",
  "villa 1-11-14","1-11-14","riccardelli","ricciardelli","bajo flores",
  "villa 21-24","zavaleta","villa 15","ciudad oculta","villa 3",
  "villa 6","villa 17","villa 19","villa 31 bis","villa 31bis","villa 26",
  "villa 2","villa 7","villa 8","villa 13 bis",
  // GBA
  "villa itatí","villa azul","villa azúl",
  "fuerte apache","ejército de los andes",
  "villa caraza","villa la cava","villa palito",
  "villa jardín","villa trujui","villa los paraguayos",
  "la saladita","la saladita de wilde"
].map(s => s.toLowerCase());

function inVilla(display=""){
  const t = (display||"").toLowerCase();
  return VILLA_BLACKLIST.some(k => t.includes(k));
}

/* =========================
   Provincia/Ciudad/Barrio heurísticos
========================= */
function inferFromDisplay(display_name=""){
  const txt = (display_name||"").toLowerCase();
  const province = /c\.?a\.?b\.?a|ciudad aut[oó]noma de buenos aires|capital federal/.test(txt)
    ? "CABA" : "Buenos Aires";

  const tokens = display_name.split(",").map(s => s.trim());
  let city = "";
  for (const tk of tokens){
    const t = tk.toLowerCase();
    if (/quilmes|avellaneda|lan[uú]s|tigre|san isidro|san mart[ií]n|mor[oó]n|lomas de zamora|la matanza|berazategui|almirante brown|esteban echeverr[ií]a|ezeiza|ituzaing[oó]|merlo|vicente l[oó]pez|hurlingham|tres de febrero|san miguel|malvinas argentinas|berisso|ensenada/.test(t)){
      city = tk; break;
    }
    if (province==="CABA" && /caba|buenos aires/.test(t)) city = "CABA";
  }

  let neighborhood = "";
  if (province==="CABA"){
    const iCaba = tokens.findIndex(x => /caba|ciudad aut[oó]noma/.test(x.toLowerCase()));
    if (iCaba > 0) neighborhood = tokens[iCaba-1].trim();
  }
  return { province, city, neighborhood };
}

/* =========================
   Tablas mínimas que usa este handler
========================= */
async function ensureBaseTables(client){
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.service_zones(
      province   text NOT NULL,
      city       text NOT NULL,
      active     boolean NOT NULL DEFAULT true,
      updated_at timestamptz DEFAULT now(),
      PRIMARY KEY (province, city)
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.service_interests(
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
    )`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.referral_edges(
      referrer_email text NOT NULL,
      referee_email  text NOT NULL,
      reservation_id integer,
      created_at timestamptz DEFAULT now(),
      CONSTRAINT uniq_edge_once UNIQUE (referrer_email, referee_email)
    )`);
}

/* =========================
   Handler
========================= */
export default async function handler(req, res){
  // CORS / health
  if (req.method === "OPTIONS"){
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,PUT,GET,OPTIONS,HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Admin");
    return res.status(200).end();
  }
  if (req.method === "HEAD") return res.status(200).end();

  /* -------- ZONAS (admin) --------
     GET  /api/reserve?zones=1  -> { zones:[{province,city,active}], dangerous:[...] }
     PUT  /api/reserve?zones=1  -> body { zones:[{province,city,active}] }  (admin)
  ---------------------------------- */
  if ((req.method === "GET" || req.method === "PUT") && (req.query?.zones === "1" || req.query?.zones === 1)){
    let client;
    try{
      client = await pool.connect();
      await ensureBaseTables(client);

      if (req.method === "GET"){
        const { rows: zones } = await client.query(
          `SELECT province, city, active FROM public.service_zones
           WHERE province IN ('CABA','Buenos Aires')
           ORDER BY province, city`
        );
        return res.status(200).json({ zones, dangerous: VILLA_BLACKLIST });
      }

      // PUT
      if (!isAdmin(req)) return res.status(403).json({ error:"No autorizado" });
      const body = await readJSON(req);
      const zones = Array.isArray(body?.zones) ? body.zones : [];

      await client.query("BEGIN");
      const upsert = `
        INSERT INTO public.service_zones (province, city, active)
        VALUES ($1,$2,$3)
        ON CONFLICT (province, city)
        DO UPDATE SET active=EXCLUDED.active, updated_at=now()
      `;
      for (const z of zones){
        if (!z?.province || !z?.city) continue;
        const act = z.active === false ? false : true;
        await client.query(upsert, [z.province, z.city, act]);
      }
      await client.query("COMMIT");
      return res.status(200).json({ ok:true });

    }catch(e){
      try{ await client?.query("ROLLBACK"); }catch{}
      console.error("zones error:", e);
      return res.status(500).json({ error:"Error interno (zonas)" });
    }finally{
      try{ client?.release(); }catch{}
    }
  }

  /* -------- RESERVA -------- */
  if (req.method !== "POST") return res.status(405).json({ error:"Método no permitido" });

  // Validaciones & lógica
  try{
    const body = await readJSON(req);
    const {
      name, email, phone, postal_code, age, message,
      date, time, plan, location, referred_email
    } = body || {};

    // Requisitos base
    if (!name || !email || !age || !date || !time || !phone || !postal_code)
      return res.status(400).json({ error:"Faltan campos obligatorios" });
    if (!isValidEmail(email)) return res.status(400).json({ error:"Email inválido" });
    if (parseInt(age,10) < 18) return res.status(400).json({ error:"Solo mayores de 18 años" });
    if (!location || !location.display_name || !isValidLatLng(location.lat, location.lng))
      return res.status(400).json({ error:"Falta ubicación exacta del evento." });

    const referred = (referred_email||"").trim();
    if (referred){
      if (!isValidEmail(referred)) return res.status(400).json({ error:"Email de referido inválido" });
      if (referred.toLowerCase() === email.toLowerCase()) return res.status(400).json({ error:"No podés referirte a vos mismo" });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
      return res.status(400).json({ error:"Fecha u hora inválidas" });
    const now = new Date();
    const minSel = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
    const reqDay = new Date(`${date}T${time}:00`);
    const floor = new Date(reqDay.getFullYear(), reqDay.getMonth(), reqDay.getDate());
    if (floor < minSel) return res.status(400).json({ error:"Solo reservas a partir de dentro de 3 días." });

    const { province, city, neighborhood } = inferFromDisplay(location.display_name);

    // 1) Bloqueo automático por villa
    if (inVilla(location.display_name)) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.service_interests(
          id serial PRIMARY KEY,
          province text, city text, neighborhood text,
          name text, email text NOT NULL, phone text,
          lat double precision, lng double precision,
          display_name text, created_at timestamptz DEFAULT now(), notified_at timestamptz
        )`);
      await pool.query(
        `INSERT INTO public.service_interests
         (province,city,neighborhood,name,email,phone,lat,lng,display_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT DO NOTHING`,
        [province||null, city||null, neighborhood||null, name||null, email, phone||null,
         Number(location.lat)||null, Number(location.lng)||null, location.display_name||null]
      );
      return res.status(409).json({ error:"No trabajamos en esa zona." });
    }

    // 2) Política de zonas:
    //    - si service_zones está VACÍA => TODO habilitado
    //    - si hay active=TRUE => whitelist (solo esas)
    //    - si no hay TRUE y sí hay FALSE => blacklist (todo salvo esas)
    let cityAllowed = true;
    {
      const client = await pool.connect();
      try{
        await ensureBaseTables(client);
        const c = await client.query(`SELECT active FROM public.service_zones WHERE province IN ('CABA','Buenos Aires')`);
        if (c.rowCount > 0){
          const hasTrue  = c.rows.some(r => r.active === true);
          const hasFalse = c.rows.some(r => r.active === false);
          if (hasTrue){
            const ok = await client.query(
              `SELECT 1 FROM public.service_zones WHERE province=$1 AND city=$2 AND active=TRUE LIMIT 1`,
              [province, city]
            );
            cityAllowed = ok.rowCount > 0;
          } else if (hasFalse){
            const bad = await client.query(
              `SELECT 1 FROM public.service_zones WHERE province=$1 AND city=$2 AND active=FALSE LIMIT 1`,
              [province, city]
            );
            cityAllowed = bad.rowCount === 0;
          }
        }
      }finally{
        try{ client.release(); }catch{}
      }
    }

    if (!cityAllowed){
      await pool.query(
        `INSERT INTO public.service_interests
         (province,city,neighborhood,name,email,phone,lat,lng,display_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT DO NOTHING`,
        [province||null, city||null, neighborhood||null, name||null, email, phone||null,
         Number(location.lat)||null, Number(location.lng)||null, location.display_name||null]
      );
      return res.status(409).json({ error:"Todavía no llegamos a tu zona" });
    }

    // 3) Plan válido
    const planKey = (plan || "1h").toLowerCase();
    const qPlan = await pool.query(
      `SELECT code, label, price_usd::float FROM plans WHERE code=$1 AND active=TRUE`,
      [planKey]
    );
    if (qPlan.rowCount === 0) return res.status(400).json({ error:"Plan inválido o no disponible" });

    // 4) Disponibilidad + reserva (con transacción correcta)
    let client;
    try{
      client = await pool.connect();
      await client.query("BEGIN");

      // Usuario
      const u = await client.query(
        `INSERT INTO users (name,email,age,zone,phone,postal_code)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (email) DO UPDATE SET
           name=EXCLUDED.name, age=EXCLUDED.age, zone=EXCLUDED.zone,
           phone=EXCLUDED.phone, postal_code=EXCLUDED.postal_code, updated_at=now()
         RETURNING id, name, email`,
        [name, email, age, null, phone||null, postal_code||null]
      );
      const user = u.rows[0];

      // Día completo / hora ocupada
      const hourInt = parseInt(String(time).split(":")[0], 10);
      const qDay = await client.query(
        `SELECT event_hour FROM reservations WHERE event_date=$1 AND status <> 'rechazada'`,
        [date]
      );
      if (qDay.rowCount >= 2){
        await client.query("ROLLBACK");
        return res.status(409).json({ error:"Ese día ya está completo. Elegí otro." });
      }
      if (new Set(qDay.rows.map(r=>r.event_hour)).has(hourInt)){
        await client.query("ROLLBACK");
        return res.status(409).json({ error:"Esa hora ya está ocupada." });
      }

      // Insert reserva
      const r = await client.query(
        `INSERT INTO reservations
           (user_id, event_date, event_hour, plan, zone, message, status,
            location_display, location_address, location_lat, location_lng, location_osm_id,
            referred_email, province, city, neighborhood)
         VALUES
           ($1,$2,$3,$4,$5,$6,'pendiente',
            $7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id, event_date, event_hour, plan, zone, message,
                   location_display, location_address, location_lat, location_lng, location_osm_id,
                   referred_email, province, city, neighborhood`,
        [
          user.id, date, hourInt, qPlan.rows[0].code, null, message || null,
          location.display_name || null,
          (location.address || location.display_name || null),
          Number(location.lat), Number(location.lng),
          location.osm_id ? Number(location.osm_id) : null,
          referred ? referred.toLowerCase() : null,
          province || null, city || null, neighborhood || null
        ]
      );
      const reservation = r.rows[0];

      // Referidos
      if (referred){
        await client.query(
          `INSERT INTO referral_edges (referrer_email, referee_email, reservation_id)
           VALUES ($1,$2,$3)
           ON CONFLICT ON CONSTRAINT uniq_edge_once DO NOTHING`,
          [referred.toLowerCase(), email.toLowerCase(), reservation.id]
        );
      }

      await client.query("COMMIT");

      // 5) Emails (si SMTP está configurado)
      try{
        const tx = createTransporter();
        if (tx){
          const ownerEmail = process.env.TO_EMAIL || process.env.SMTP_USER;
          const fromEmail  = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;

          const token = signToken(reservation.id, email);
          const baseUrl =
            process.env.PUBLIC_BASE_URL?.trim() ||
            (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
          const acceptUrl = `${baseUrl}/api/accept?id=${reservation.id}&token=${token}`;
          const rejectUrl = `${baseUrl}/api/reject?id=${reservation.id}&token=${token}`;

          const hh = String(reservation.event_hour).padStart(2,"0");
          const d = new Date(reservation.event_date);
          const dd = String(d.getUTCDate()).padStart(2,"0");
          const mm = String(d.getUTCMonth()+1).padStart(2,"0");
          const yy = String(d.getUTCFullYear()).slice(-2);
          const fechaCorta = `${dd}/${mm}/${yy}`;

          await tx.sendMail({
            from: `Reservas Toro Mecánico <${fromEmail}>`,
            to: ownerEmail,
            subject: "Nueva reserva",
            html: `
              <div style="font-family:system-ui,Segoe UI,Roboto">
                <h2>Nueva reserva</h2>
                <p><strong>${name}</strong> (${email}) — ${age} años</p>
                <p>Tel: ${phone||"-"} — CP: ${postal_code||"-"}</p>
                <p><strong>${fechaCorta}</strong> · ${hh}:00 — Plan: <strong>${reservation.plan}</strong></p>
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
            to: email,
            subject: "Recibimos tu solicitud",
            text: `Hola ${name}, recibimos tu solicitud para el ${fechaCorta} a las ${hh}:00 (plan ${reservation.plan}).`
          });
        }
      }catch(e){ console.error("MAIL ERROR:", e); }

      // 6) Respuesta ok
      const token = signToken(reservation.id, email);
      return res.status(200).json({ ok:true, reservation, token });

    }catch(e){
      try{ await client?.query("ROLLBACK"); }catch{}
      console.error("DB ERROR:", e);
      return res.status(500).json({ error:"Error interno (DB)" });
    }finally{
      try{ client?.release(); }catch{}
    }

  }catch(e){
    console.error("GENERIC ERROR:", e);
    return res.status(500).json({ error:"Error interno" });
  }
}
