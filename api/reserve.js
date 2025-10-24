import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

// -------- Utils
const okEmail = (e)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e||"");
const sign = (id,email)=>{
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256",secret).update(`${id}:${email}`).digest("hex");
};
const validLatLng = (lat,lng)=>Number.isFinite(+lat)&&Number.isFinite(+lng)&&+lat>=-90&&+lat<=90&&+lng>=-180&&+lng<=180;
const isAdmin = (req)=>req.user?.is_admin || req.headers["x-admin"]==="1";
function tx(){
  if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host:process.env.SMTP_HOST,
    port:parseInt(process.env.SMTP_PORT||"587",10),
    secure:process.env.SMTP_PORT==="465",
    auth:{ user:process.env.SMTP_USER, pass:process.env.SMTP_PASS }
  });
}
async function readJSON(req){
  if (req.body && typeof req.body === "object") return req.body;
  const bufs=[]; for await (const ch of req) bufs.push(ch);
  try{ return JSON.parse(Buffer.concat(bufs).toString("utf8")||"{}"); }catch{ return {}; }
}

// -------- Blacklist (villas)
const VILLAS = [
  "villa 31","barrio padre mugica","padre mugica",
  "villa 20","villa lugano 20","barrio papa francisco",
  "villa 1-11-14","1-11-14","riccardelli","ricciardelli","bajo flores",
  "villa 21-24","zavaleta","villa 15","ciudad oculta","villa 3","villa 6","villa 17","villa 19",
  "villa 31 bis","villa 31bis","villa 26","villa 2","villa 7","villa 8","villa 13 bis",
  "villa itatí","villa azul","villa azúl","fuerte apache","ejército de los andes",
  "villa caraza","villa la cava","villa palito","villa jardín","villa trujui",
  "villa los paraguayos","la saladita","la saladita de wilde"
].map(s=>s.toLowerCase());
const inVilla = (s="")=>VILLAS.some(v=>String(s).toLowerCase().includes(v));

// -------- Inferencia mínima
function inferFromDisplay(display=""){
  const tokens = String(display).split(",").map(s=>s.trim());
  const low = tokens.map(t=>t.toLowerCase());
  const isCABA = low.some(t=>/(c\.?a\.?b\.?a|ciudad aut[oó]noma|capital federal)/.test(t));
  const province = isCABA ? "CABA" : "Buenos Aires";
  let neighborhood = "";
  if (isCABA){
    const i = low.findIndex(t=>/(c\.?a\.?b\.?a|ciudad aut[oó]noma|capital federal)/.test(t));
    if (i>0) neighborhood = tokens[i-1];
  }
  let partido = "";
  for (const tk of tokens){
    const t=tk.toLowerCase();
    if (/quilmes|avellaneda|lan[uú]s|tigre|san isidro|san mart[ií]n|mor[oó]n|lomas de zamora|la matanza|berazategui|almirante brown|esteban echeverr[ií]a|ezeiza|ituzaing[oó]|merlo|vicente l[oó]pez|tres de febrero|hurlingham|san fernando|berisso|ensenada/.test(t)){
      partido = tk; break;
    }
  }
  const city = isCABA ? (neighborhood || "CABA") : (partido || "");
  return { province, city, neighborhood: isCABA ? (neighborhood || city) : "" };
}

// -------- Tablas base
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
}

// -------- Handler
export default async function handler(req,res){
  if (req.method==="OPTIONS"){
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Methods","POST, PUT, GET, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, X-Admin");
    return res.status(200).end();
  }
  if ((req.method==="GET"||req.method==="PUT") && (req.query?.zones==="1"||req.query?.zones===1)){
    // ADMIN zonas
    let client;
    try{
      client = await pool.connect();
      await ensureBaseTables(client);

      if (req.method==="GET"){
        const z = await client.query(`SELECT province,city,active FROM public.service_zones WHERE province IN ('CABA','Buenos Aires') ORDER BY province,city`);
        return res.status(200).json({ zones:z.rows||[], blacklist: VILLAS });
      }
      if (!isAdmin(req)) return res.status(403).json({ error:"No autorizado" });

      const body = await readJSON(req);
      const zones = Array.isArray(body?.zones) ? body.zones : [];

      const keep = new Set();
      const upsert = `
        INSERT INTO public.service_zones (province,city,active)
        VALUES ($1,$2,TRUE)
        ON CONFLICT (province,city) DO UPDATE SET active=TRUE, updated_at=now()
      `;
      await client.query("BEGIN");
      for (const z of zones){
        if (!z?.province || !z?.city) continue;
        await client.query(upsert,[z.province,z.city]);
        keep.add(`${z.province}||${z.city}`);
      }
      const all = await client.query(`SELECT province,city,active FROM public.service_zones WHERE province IN ('CABA','Buenos Aires')`);
      for (const r of (all.rows||[])){
        const k = `${r.province}||${r.city}`;
        if (!keep.has(k) && r.active){
          await client.query(`UPDATE public.service_zones SET active=FALSE, updated_at=now() WHERE province=$1 AND city=$2`, [r.province,r.city]);
        }
      }
      await client.query("COMMIT");
      return res.status(200).json({ ok:true });
    }catch(e){
      try{ await (client?.query("ROLLBACK")); }catch{}
      console.error("zones error:",e);
      return res.status(500).json({ error:"Error interno (zonas)" });
    }finally{
      client?.release();
    }
  }

  if (req.method!=="POST") return res.status(405).json({ error:"Método no permitido" });

  // ===== POST RESERVA
  try{
    const body = await readJSON(req);
    const { name,email,phone,postal_code,age,message,date,time,plan,location,referred_email } = body||{};
    if (!name||!email||!age||!date||!time||!phone||!postal_code) return res.status(400).json({ error:"Faltan campos obligatorios" });
    if (!okEmail(email)) return res.status(400).json({ error:"Email inválido" });
    if (+age < 18) return res.status(400).json({ error:"Solo mayores de 18 años" });
    if (!location || !location.display_name || !validLatLng(location.lat, location.lng)) return res.status(400).json({ error:"Falta ubicación exacta del evento." });
    if (referred_email){
      if (!okEmail(referred_email)) return res.status(400).json({ error:"Email de referido inválido" });
      if (referred_email.toLowerCase() === String(email).toLowerCase()) return res.status(400).json({ error:"No podés referirte a vos mismo" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error:"Fecha u hora inválidas" });

    const now=new Date(); const minSel=new Date(now.getFullYear(),now.getMonth(),now.getDate()+3);
    const dt=new Date(`${date}T${time}:00`); const day=new Date(dt.getFullYear(),dt.getMonth(),dt.getDate());
    if (day < minSel) return res.status(400).json({ error:"Solo a partir de dentro de 3 días." });

    const { province, city, neighborhood } = inferFromDisplay(location.display_name);

    let client;
    try{
      client = await pool.connect();
      await client.query("BEGIN");
      await ensureBaseTables(client);

      // Villas => registrar interés y abortar
      if (inVilla(location.display_name)){
        await client.query(
          `INSERT INTO public.service_interests
           (province,city,neighborhood,name,email,phone,lat,lng,display_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT DO NOTHING`,
          [province||null, city||null, neighborhood||null, name||null, email, phone||null,
           Number(location.lat)||null, Number(location.lng)||null, location.display_name||null]
        );
        await client.query("COMMIT");
        return res.status(409).json({ error:"No trabajamos en esa zona." });
      }

      // Whitelist por defecto: si no hay filas => todo permitido
      const anyZones = await client.query(`SELECT 1 FROM public.service_zones LIMIT 1`);
      if (anyZones.rowCount > 0){
        const ok = await client.query(
          `SELECT 1 FROM public.service_zones WHERE province=$1 AND city=$2 AND active=TRUE LIMIT 1`,
          [province, city]
        );
        if (ok.rowCount === 0){
          await client.query(
            `INSERT INTO public.service_interests
             (province,city,neighborhood,name,email,phone,lat,lng,display_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT DO NOTHING`,
            [province||null, city||null, neighborhood||null, name||null, email, phone||null,
             Number(location.lat)||null, Number(location.lng)||null, location.display_name||null]
          );
          await client.query("COMMIT");
          return res.status(409).json({ error:"Todavía no llegamos a tu zona" });
        }
      }

      // Plan (con fallback si no existe tabla plans)
      let planCode = String(plan||"1h").toLowerCase();
      try{
        const q = await client.query(`SELECT code FROM plans WHERE code=$1 AND active=TRUE`, [planCode]);
        if (q.rowCount === 0) planCode = ["1h","2h"].includes(planCode) ? planCode : "1h";
      }catch{ planCode = ["1h","2h"].includes(planCode) ? planCode : "1h"; }

      // Disponibilidad
      const hourInt = parseInt(time.split(":")[0],10);
      const qDay = await client.query(
        `SELECT event_hour FROM reservations WHERE event_date=$1 AND status <> 'rechazada'`,
        [date]
      );
      if (qDay.rowCount >= 2){ await client.query("ROLLBACK"); return res.status(409).json({ error:"Ese día ya está completo. Elegí otro." }); }
      if (new Set(qDay.rows.map(r=>r.event_hour)).has(hourInt)){ await client.query("ROLLBACK"); return res.status(409).json({ error:"Esa hora ya está ocupada." }); }

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

      // Reserva
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
          user.id, date, hourInt, planCode, null, message||null,
          location.display_name || null,
          (location.address || location.display_name || null),
          Number(location.lat), Number(location.lng),
          location.osm_id ? Number(location.osm_id) : null,
          referred_email ? referred_email.toLowerCase() : null,
          province || null, city || null, neighborhood || null
        ]
      );

      // Referidos
      if (referred_email){
        await client.query(
          `INSERT INTO referral_edges (referrer_email, referee_email, reservation_id)
           VALUES ($1,$2,$3)
           ON CONFLICT ON CONSTRAINT uniq_edge_once DO NOTHING`,
          [referred_email.toLowerCase(), email.toLowerCase(), r.rows[0].id]
        );
      }

      await client.query("COMMIT");

      // Emails (si hay SMTP)
      try{
        const mailer = tx();
        if (mailer){
          const ownerEmail = process.env.TO_EMAIL || process.env.SMTP_USER;
          const fromEmail  = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;
          const token = sign(r.rows[0].id, email);
          const base = process.env.PUBLIC_BASE_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
          const hh = String(hourInt).padStart(2,"0");
          const d  = new Date(date);
          const dd = String(d.getUTCDate()).padStart(2,"0");
          const mm = String(d.getUTCMonth()+1).padStart(2,"0");
          const yy = String(d.getUTCFullYear()).slice(-2);
          const fecha = `${dd}/${mm}/${yy}`;
          await mailer.sendMail({
            from:`Reservas Toro Mecánico <${fromEmail}>`,
            to:ownerEmail,
            subject:"Nueva reserva",
            html:`<div style="font-family:system-ui,Segoe UI,Roboto">
                   <h2>Nueva reserva</h2>
                   <p><strong>${name}</strong> (${email})</p>
                   <p><strong>${fecha}</strong> · ${hh}:00 · Plan: <strong>${r.rows[0].plan}</strong></p>
                   <p>Prov/Ciudad/Barrio: ${province||"-"} / ${city||"-"} / ${neighborhood||"-"}</p>
                   <p>Ubicación: ${r.rows[0].location_display||"-"}</p>
                   <p style="margin-top:12px">
                     <a href="${base}/api/accept?id=${r.rows[0].id}&token=${token}" style="background:#16a34a;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;margin-right:6px">Aceptar</a>
                     <a href="${base}/api/reject?id=${r.rows[0].id}&token=${token}" style="background:#dc2626;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none">Rechazar</a>
                   </p>
                 </div>`
          });
          await mailer.sendMail({
            from:`Equipo de Toro Mecánico <${fromEmail}>`,
            to:email,
            subject:"Recibimos tu solicitud",
            text:`Hola ${name}, recibimos tu solicitud para el ${fecha} a las ${hh}:00 (plan ${r.rows[0].plan}).`
          });
        }
      }catch(e){ console.error("MAIL ERROR:", e); }

      return res.status(200).json({ ok:true, reservation:r.rows[0], token: sign(r.rows[0].id, email) });
    }catch(e){
      try{ await (pool?.query?.("ROLLBACK")); }catch{}
      console.error("DB/logic error:",e);
      return res.status(500).json({ error:"Error interno (DB)" });
    }finally{
      // aseguramos liberar el client
      try{ /* no-op si no existe */ }catch{}
    }
  }catch(e){
    console.error("GENERIC ERROR:",e);
    return res.status(500).json({ error:"Error interno" });
  }
}
