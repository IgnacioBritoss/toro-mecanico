import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

// ---------- Utils ----------
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const okEmail = (e) => emailRe.test(e||"");
const sign = (id, email) => {
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
};
function validLatLng(lat,lng){
  const a=Number(lat), b=Number(lng);
  return Number.isFinite(a)&&Number.isFinite(b)&&a>=-90&&a<=90&&b>=-180&&b<=180;
}
function tx(){
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT||"587",10),
    secure: process.env.SMTP_PORT==="465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
const isAdmin = (req) => req.user?.is_admin || req.headers["x-admin"]==="1";

async function readJSON(req){
  if (req.body && typeof req.body === "object") return req.body;
  const bufs=[]; for await (const ch of req) bufs.push(ch);
  try{ return JSON.parse(Buffer.concat(bufs).toString("utf8")||"{}"); }catch{ return {}; }
}

// ---------- Villas (blacklist) ----------
const VILLAS = [
  "villa 31","barrio padre mugica","padre mugica",
  "villa 20","villa lugano 20","barrio papa francisco",
  "villa 1-11-14","1-11-14","riccardelli","ricciardelli","bajo flores",
  "villa 21-24","zavaleta","villa 15","ciudad oculta","villa 3",
  "villa 6","villa 17","villa 19","villa 31 bis","villa 31bis",
  "villa 26","villa 2","villa 7","villa 8","villa 13 bis",
  "villa itatí","villa azul","villa azúl",
  "fuerte apache","ejército de los andes",
  "villa caraza","villa la cava","villa palito",
  "villa jardín","villa trujui","villa los paraguayos",
  "la saladita","la saladita de wilde"
].map(s=>s.toLowerCase());
const inVilla = (display="") => VILLAS.some(k => String(display).toLowerCase().includes(k));

// ---------- Inferencia provincia/ciudad/barrio ----------
function inferFromDisplay(display=""){
  const tokens = String(display).split(",").map(s=>s.trim());
  const low = tokens.map(t=>t.toLowerCase());

  const isCABA = low.some(t => /(c\.?a\.?b\.?a|ciudad aut[oó]noma|capital federal)/.test(t));
  const province = isCABA ? "CABA" : "Buenos Aires";

  // Para CABA tomamos el token previo a "CABA" como barrio si lo hay
  let neighborhood = "";
  if (isCABA){
    const i = low.findIndex(t => /(c\.?a\.?b\.?a|ciudad aut[oó]noma|capital federal)/.test(t));
    if (i>0) neighborhood = tokens[i-1];
  }
  // Para GBA detectamos partido por patrones comunes
  let partido = "";
  for (const tk of tokens){
    const t = tk.toLowerCase();
    if (/quilmes|avellaneda|lan[uú]s|tigre|san isidro|san mart[ií]n|mor[oó]n|lomas de zamora|la matanza|berazategui|almirante brown|esteban echeverr[ií]a|ezeiza|ituzaing[oó]|merlo|vicente l[oó]pez|tres de febrero|hurlingham|san fernando|berisso|ensenada/.test(t)){
      partido = tk; break;
    }
  }

  // city = barrio (en CABA) o partido (en BA)
  const city = isCABA ? (neighborhood || "CABA") : (partido || "");
  return { province, city, neighborhood: isCABA ? (neighborhood || city) : "" };
}

// ---------- Tablas base (si faltan) ----------
async function ensureBaseTables(client){
  await client.query(`
    CREATE TABLE IF NOT EXISTS users(
      id serial PRIMARY KEY,
      name text NOT NULL,
      email text UNIQUE NOT NULL,
      age integer,
      zone text,
      phone text,
      postal_code text,
      updated_at timestamptz DEFAULT now()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS reservations(
      id serial PRIMARY KEY,
      user_id integer REFERENCES users(id),
      event_date date NOT NULL,
      event_hour integer NOT NULL,
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
      id serial PRIMARY KEY,
      referrer_email text NOT NULL,
      referee_email  text NOT NULL,
      reservation_id integer REFERENCES reservations(id),
      CONSTRAINT uniq_edge_once UNIQUE (referrer_email, referee_email)
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.service_zones(
      province text NOT NULL,
      city     text NOT NULL,
      active   boolean NOT NULL DEFAULT true,
      updated_at timestamptz DEFAULT now(),
      PRIMARY KEY (province, city)
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.service_blocks(
      province     text NOT NULL,
      city         text NOT NULL,
      neighborhood text NOT NULL,
      active       boolean NOT NULL DEFAULT false,
      updated_at   timestamptz DEFAULT now(),
      PRIMARY KEY (province, city, neighborhood)
    );
  `);
}

// ---------- Handler ----------
export default async function handler(req,res){
  if (req.method==="OPTIONS"){
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Methods","POST, PUT, GET, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, X-Admin");
    return res.status(200).end();
  }
  if (req.method==="HEAD") return res.status(200).end();

  // ===== Admin ZONAS =====
  if ((req.method==="GET" || req.method==="PUT") && (req.query?.zones==="1" || req.query?.zones===1)){
    try{
      const client = await pool.connect();
      try{
        await ensureBaseTables(client);

        if (req.method==="GET"){
          const z = await client.query(`SELECT province,city,active FROM public.service_zones WHERE province IN ('CABA','Buenos Aires') ORDER BY province,city`);
          const b = await client.query(`SELECT province,city,neighborhood,active FROM public.service_blocks WHERE province IN ('CABA','Buenos Aires') ORDER BY province,city,neighborhood`);
          return res.status(200).json({ zones: z.rows||[], blocks: b.rows||[], blacklist: VILLAS });
        }

        if (!isAdmin(req)) return res.status(403).json({ error:"No autorizado" });
        const body = await readJSON(req);
        const zones = Array.isArray(body?.zones) ? body.zones : [];

        // Sin borrar masivo: upsert de lo que mandás y desactivar el resto.
        const keep = new Set();
        const upsert = `
          INSERT INTO public.service_zones (province,city,active)
          VALUES ($1,$2,TRUE)
          ON CONFLICT (province,city) DO UPDATE SET active=TRUE, updated_at=now()
        `;
        for (const z of zones){
          if (!z?.province || !z?.city) continue;
          await client.query(upsert, [z.province, z.city]);
          keep.add(`${z.province}||${z.city}`);
        }
        // Desactivar lo no enviado
        const all = await client.query(`SELECT province,city,active FROM public.service_zones WHERE province IN ('CABA','Buenos Aires')`);
        for (const r of (all.rows||[])){
          const k = `${r.province}||${r.city}`;
          if (!keep.has(k) && r.active){
            await client.query(`UPDATE public.service_zones SET active=FALSE, updated_at=now() WHERE province=$1 AND city=$2`, [r.province, r.city]);
          }
        }
        return res.status(200).json({ ok:true });
      }finally{
        client.release();
      }
    }catch(e){
      console.error("zones error:", e);
      return res.status(500).json({ error:"Error interno (zonas)" });
    }
  }

  // ===== POST RESERVA =====
  if (req.method!=="POST") return res.status(405).json({ error:"Método no permitido" });

  try{
    const body = await readJSON(req);
    const {
      name, email, phone, postal_code, age, message, date, time, plan,
      location, referred_email
    } = body || {};

    if (!name||!email||!age||!date||!time||!phone||!postal_code) return res.status(400).json({ error:"Faltan campos obligatorios" });
    if (!okEmail(email)) return res.status(400).json({ error:"Email inválido" });
    if (parseInt(age,10) < 18) return res.status(400).json({ error:"Solo mayores de 18 años" });
    if (!location || !location.display_name || !validLatLng(location.lat, location.lng)) return res.status(400).json({ error:"Falta ubicación exacta del evento." });

    if (referred_email){
      if (!okEmail(referred_email)) return res.status(400).json({ error:"Email de referido inválido" });
      if (referred_email.toLowerCase() === email.toLowerCase()) return res.status(400).json({ error:"No podés referirte a vos mismo" });
    }

    // Fecha/hora formato
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error:"Fecha u hora inválidas" });
    const now = new Date(); const minSel = new Date(now.getFullYear(), now.getMonth(), now.getDate()+3);
    const reqDT = new Date(`${date}T${time}:00`);
    const reqDay = new Date(reqDT.getFullYear(), reqDT.getMonth(), reqDT.getDate());
    if (reqDay < minSel) return res.status(400).json({ error:"Solo a partir de dentro de 3 días." });

    // Inferir provincia/ciudad/barrio
    const inferred = inferFromDisplay(location.display_name);
    const province = inferred.province;
    const city     = inferred.city;
    const neighborhood = inferred.neighborhood;

    // Villas
    if (inVilla(location.display_name)){
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.service_interests(
          id serial PRIMARY KEY,
          province text, city text, neighborhood text,
          name text, email text NOT NULL, phone text,
          lat double precision, lng double precision,
          display_name text,
          created_at timestamptz DEFAULT now(),
          notified_at timestamptz
        );
      `);
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

    // DB + tablas
    const client = await pool.connect();
    try{
      await client.query("BEGIN");
      await ensureBaseTables(client);

      // ===== Whitelist por defecto =====
      // Si NO hay filas en service_zones => todo permitido (salvo villas)
      const anyZones = await client.query(`SELECT 1 FROM public.service_zones LIMIT 1`);
      let cityAllowed = true;
      if (anyZones.rowCount > 0){
        const q = await client.query(
          `SELECT 1 FROM public.service_zones WHERE province=$1 AND city=$2 AND active=TRUE LIMIT 1`,
          [province, city]
        );
        cityAllowed = q.rowCount > 0;
      }
      if (!cityAllowed){
        await client.query(`
          CREATE TABLE IF NOT EXISTS public.service_interests(
            id serial PRIMARY KEY,
            province text, city text, neighborhood text,
            name text, email text NOT NULL, phone text,
            lat double precision, lng double precision,
            display_name text,
            created_at timestamptz DEFAULT now(),
            notified_at timestamptz
          );
        `);
        await client.query(
          `INSERT INTO public.service_interests
           (province,city,neighborhood,name,email,phone,lat,lng,display_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT DO NOTHING`,
          [province||null, city||null, neighborhood||null, name||null, email, phone||null,
           Number(location.lat)||null, Number(location.lng)||null, location.display_name||null]
        );
        await client.query("ROLLBACK");
        return res.status(409).json({ error:"Todavía no llegamos a tu zona" });
      }

      // ===== Plan (con fallback si no existe tabla) =====
      let planRow = { code: (String(plan||"1h")).toLowerCase(), label: "", price_usd: 0 };
      try{
        const qPlan = await client.query(
          `SELECT code, label, price_usd::float FROM plans WHERE code=$1 AND active=TRUE`,
          [planRow.code]
        );
        if (qPlan.rowCount > 0) planRow = qPlan.rows[0];
      }catch{
        // sin tabla plans => permitimos igualmente
        if (!["1h","2h"].includes(planRow.code)) planRow.code = "1h";
      }

      // ===== Disponibilidad día/hora =====
      const hourInt = parseInt(time.split(":")[0],10);
      const qDay = await client.query(
        `SELECT event_hour FROM reservations WHERE event_date=$1 AND status <> 'rechazada'`,
        [date]
      );
      if (qDay.rowCount >= 2){ await client.query("ROLLBACK"); return res.status(409).json({ error:"Ese día ya está completo. Elegí otro." }); }
      if (new Set(qDay.rows.map(r=>r.event_hour)).has(hourInt)){ await client.query("ROLLBACK"); return res.status(409).json({ error:"Esa hora ya está ocupada." }); }

      // ===== Upsert usuario
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

      // ===== Inserción reserva
      const r = await client.query(
        `INSERT INTO reservations
           (user_id, event_date, event_hour, plan, zone, message, status,
            location_display, location_address, location_lat, location_lng, location_osm_id,
            referred_email, province, city, neighborhood)
         VALUES
           ($1,$2,$3,$4,$5,$6,'pendiente',
            $7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          user.id, date, hourInt, planRow.code, null, message||null,
          location.display_name || null,
          (location.address || location.display_name || null),
          Number(location.lat), Number(location.lng),
          location.osm_id ? Number(location.osm_id) : null,
          referred_email ? referred_email.toLowerCase() : null,
          province || null, city || null, neighborhood || null
        ]
      );
      const reservation = r.rows[0];

      // referidos (opcional)
      if (referred_email){
        await client.query(
          `INSERT INTO referral_edges (referrer_email, referee_email, reservation_id)
           VALUES ($1,$2,$3)
           ON CONFLICT (referrer_email, referee_email) DO NOTHING`,
          [referred_email.toLowerCase(), email.toLowerCase(), reservation.id]
        );
      }

      await client.query("COMMIT");

      // ===== Emails (si hay SMTP) =====
      try{
        const mailer = tx();
        if (mailer){
          const ownerEmail = process.env.TO_EMAIL || process.env.SMTP_USER;
          const fromEmail  = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;

          const token = sign(reservation.id, user.email);
          const base =
            process.env.PUBLIC_BASE_URL?.trim() ||
            (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
          const acceptUrl = `${base}/api/accept?id=${reservation.id}&token=${token}`;
          const rejectUrl = `${base}/api/reject?id=${reservation.id}&token=${token}`;

          const hh = String(reservation.event_hour).padStart(2,"0");
          const d  = new Date(reservation.event_date);
          const dd = String(d.getUTCDate()).padStart(2,"0");
          const mm = String(d.getUTCMonth()+1).padStart(2,"0");
          const yy = String(d.getUTCFullYear()).slice(-2);
          const fecha = `${dd}/${mm}/${yy}`;

          await mailer.sendMail({
            from: `Reservas Toro Mecánico <${fromEmail}>`,
            to: ownerEmail,
            subject: "Nueva reserva",
            html: `
              <div style="font-family:system-ui,Segoe UI,Roboto">
                <h2>Nueva reserva</h2>
                <p><strong>${name}</strong> (${email})</p>
                <p><strong>${fecha}</strong> · ${hh}:00 · Plan: <strong>${reservation.plan}</strong></p>
                <p>Prov/Ciudad/Barrio: ${province||"-"} / ${city||"-"} / ${neighborhood||"-"}</p>
                <p>Ubicación: ${reservation.location_display||"-"}</p>
                <p style="margin-top:12px">
                  <a href="${acceptUrl}" style="background:#16a34a;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;margin-right:6px">Aceptar</a>
                  <a href="${rejectUrl}" style="background:#dc2626;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none">Rechazar</a>
                </p>
              </div>`
          });

          await mailer.sendMail({
            from: `Equipo de Toro Mecánico <${fromEmail}>`,
            to: email,
            subject: "Recibimos tu solicitud",
            text: `Hola ${name}, recibimos tu solicitud para el ${fecha} a las ${hh}:00 (plan ${reservation.plan}).`
          });
        }
      }catch(e){ console.error("MAIL ERROR:", e); }

      const token = sign(reservation.id, email);
      return res.status(200).json({ ok:true, reservation, token });
    }catch(e){
      console.error("DB/logic error:", e);
      return res.status(500).json({ error:"Error interno (DB)" });
    }finally{
      // client release arriba
    }
  }catch(e){
    console.error("GENERIC ERROR:", e);
    return res.status(500).json({ error:"Error interno" });
  }
}
