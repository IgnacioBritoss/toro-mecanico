// api/reserve.js
import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

/* ============= Helpers básicos ============= */
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
function createTransporter(){
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
async function parseJSON(req){
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  try { return JSON.parse(raw); } catch { return {}; }
}
function isAdmin(req){
  return req.headers["x-admin"] === "1" || req.user?.is_admin === true;
}

/* ============= CABA: barrios ============= */
const CABA_BARRIOS = [
  "Agronomía","Almagro","Balvanera","Barracas","Belgrano","Boedo","Caballito",
  "Chacarita","Coghlan","Colegiales","Constitución","Flores","Floresta",
  "La Boca","La Paternal","Liniers","Mataderos","Monte Castro","Monserrat",
  "Nueva Pompeya","Núñez","Palermo","Parque Avellaneda","Parque Chacabuco",
  "Parque Chas","Parque Patricios","Puerto Madero","Recoleta","Retiro",
  "Saavedra","San Cristóbal","San Nicolás","San Telmo","Versalles",
  "Villa Crespo","Villa del Parque","Villa Devoto","Villa General Mitre",
  "Villa Lugano","Villa Luro","Villa Ortúzar","Villa Pueyrredón","Villa Real",
  "Villa Riachuelo","Villa Santa Rita","Villa Soldati","Villa Urquiza"
];
const BARRIOS_REGEX = CABA_BARRIOS.map(b => ({
  name: b,
  re: new RegExp(`\\b${b.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i")
}));

/* ============= Blacklist de villas ============= */
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

function isVilla(displayName=""){
  const t = (displayName || "").toLowerCase();
  return VILLA_BLACKLIST.some(k => t.includes(k));
}

/* ============= Inferencia provincia/ciudad (barrio) ============= */
function inferProvinceCity(display_name=""){
  const low = (display_name || "").toLowerCase();
  const isCABA = /c\.?a\.?b\.?a|ciudad aut[oó]noma de buenos aires|capital federal|caba\b/.test(low);
  const province = isCABA ? "CABA" : "Buenos Aires";

  if (province === "CABA"){
    for (const {name, re} of BARRIOS_REGEX){
      if (re.test(display_name || "")) return { province, city: name };
    }
    return { province, city: "CABA" }; // fallback
  }

  // Provincia (partidos frecuentes)
  const tokens = (display_name || "").split(",").map(s => s.trim());
  for (const tk of tokens){
    const t = tk.toLowerCase();
    if (/quilmes|avellaneda|lan[uú]s|tigre|san isidro|san mart[ií]n|mor[oó]n|lomas de zamora|la matanza|berazategui|almirante brown|esteban echeverr[ií]a|ezeiza|ituzaing[oó]|merlo|vicente l[oó]pez|hurlingham|tres de febrero|berisso|ensenada|malvinas argentinas|san miguel|florencio varela|merlo/.test(t)){
      return { province, city: tk };
    }
  }
  return { province, city: "" };
}

/* ============= ¿zona deshabilitada? ============= */
async function isDisabledCity(province, city){
  try{
    const exist = await pool.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='service_zones'
    `);
    if (exist.rowCount === 0) return false;

    const any = await pool.query(`SELECT 1 FROM public.service_zones LIMIT 1`);
    if (any.rowCount === 0) return false;

    const q = await pool.query(
      `SELECT 1 FROM public.service_zones
       WHERE province=$1 AND city=$2 AND active=FALSE LIMIT 1`,
      [province || "Buenos Aires", city || "CABA"]
    );
    return q.rowCount > 0;
  }catch{
    return false;
  }
}

/* ============= handleInterest (avisame) ============= */
async function handleInterest(req, res){
  try{
    const body = await parseJSON(req);
    const email = (body?.email || "").trim().toLowerCase();
    const province = (body?.province || "").trim();
    const city = (body?.city || "").trim();
    const display_name = (body?.display_name || "").trim();

    if (!isValidEmail(email) || !province || !city){
      return res.status(400).json({ error:"Datos inválidos" });
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.service_interests(
        email        text NOT NULL,
        province     text NOT NULL,
        city         text NOT NULL,
        display_name text,
        created_at   timestamptz DEFAULT now(),
        notified_at  timestamptz,
        PRIMARY KEY (email, province, city)
      )
    `);

    await pool.query(
      `INSERT INTO public.service_interests(email, province, city, display_name)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (email, province, city) DO NOTHING`,
      [email, province, city, display_name]
    );

    return res.status(200).json({ ok:true });
  } catch(e){
    console.error("interest handler:", e);
    return res.status(500).json({
      error: "Error interno (interest)",
      detail: e?.message || e?.code || String(e)
    });
  }
}

/* ============= GET/PUT zonas (panel) + notificación “Llegamos” ============= */
async function handleZones(req, res){
  try{
    if (req.method === "GET"){
      try{
        const { rows } = await pool.query(
          `SELECT province, city, active
             FROM public.service_zones
            WHERE province IN ('CABA','Buenos Aires')
            ORDER BY province, city`
        );
        return res.status(200).json({ zones: rows });
      }catch(e){
        if (e.code === "42P01") return res.status(200).json({ zones: [] });
        throw e;
      }
    }

    if (req.method === "PUT"){
      if (!isAdmin(req)) return res.status(403).json({ error:"No autorizado" });

      const body = await parseJSON(req);
      const zones = Array.isArray(body?.zones) ? body.zones : [];

      const client = await pool.connect();
      try{
        await client.query("BEGIN");

        await client.query(`
          CREATE TABLE IF NOT EXISTS public.service_zones(
            province   text NOT NULL,
            city       text NOT NULL,
            active     boolean NOT NULL DEFAULT true,
            updated_at timestamptz DEFAULT now(),
            PRIMARY KEY (province, city)
          )
        `);

        // Snapshot de lo que estaba antes
        const prev = await client.query(`SELECT province, city, active FROM public.service_zones`);
        const prevMap = new Map(prev.rows.map(r => [`${r.province}||${r.city}`, r.active]));

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

        // Detectar cambios false->true para enviar “Llegamos”
        const nowRows = await client.query(`SELECT province, city, active FROM public.service_zones`);
        const enabledNow = nowRows.rows.filter(r => {
          const k = `${r.province}||${r.city}`;
          const before = prevMap.get(k);
          return before === false && r.active === true;
        });

        // Intereses y mails
        if (enabledNow.length){
          await client.query(`
            CREATE TABLE IF NOT EXISTS public.service_interests(
              email        text NOT NULL,
              province     text NOT NULL,
              city         text NOT NULL,
              display_name text,
              created_at   timestamptz DEFAULT now(),
              notified_at  timestamptz,
              PRIMARY KEY (email, province, city)
            )
          `);
          const transporter = createTransporter();
          if (transporter){
            for (const z of enabledNow){
              const subs = await client.query(
                `SELECT email FROM public.service_interests
                 WHERE province=$1 AND city=$2 AND notified_at IS NULL`,
                [z.province, z.city]
              );
              for (const row of subs.rows){
                try{
                  await transporter.sendMail({
                    from: `Equipo Toro Mecánico <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
                    to: row.email,
                    subject: "¡Llegamos a tu zona!",
                    text: `Ya estamos operando en ${z.province} / ${z.city}. Podés reservar desde el sitio.`,
                  });
                  await client.query(
                    `UPDATE public.service_interests
                       SET notified_at = now()
                     WHERE email=$1 AND province=$2 AND city=$3`,
                    [row.email, z.province, z.city]
                  );
                }catch(e){ console.error("MAIL LLEGAMOS:", e); }
              }
            }
          }
        }

        await client.query("COMMIT");
      }catch(e){
        await client.query("ROLLBACK");
        throw e;
      }finally{
        client.release();
      }
      return res.status(200).json({ ok:true });
    }

    return res.status(405).json({ error:"Método no permitido" });
  }catch(e){
    console.error("zones handler:", e);
    return res.status(500).json({ error:"Error interno (zonas)" });
  }
}

/* ============= Handler principal ============= */
export default async function handler(req, res){
  // CORS/health
  if (req.method === "OPTIONS"){
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, PUT, GET, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin");
    return res.status(200).end();
  }
  if (req.method === "HEAD"){ return res.status(200).end(); }

  // interés “avisame”
  if (req.method === "POST" && (req.query?.interest === "1" || req.query?.interest === 1)){
    return handleInterest(req, res);
  }

  // panel zonas
  if ((req.method === "GET" || req.method === "PUT") &&
      (req.query?.zones === "1" || req.query?.zones === 1)){
    return handleZones(req, res);
  }

  // Solo POST para crear reserva
  if (req.method !== "POST"){
    return res.status(405).json({ error:"Método no permitido" });
  }

  try{
    const body = await parseJSON(req);
    const {
      name, email, phone, postal_code, age, message, date, time, plan,
      location, referred_email
    } = body || {};

    // Requisitos base (exactos a tu front)
    if (!name || !email || !age || !date || !time || !phone || !postal_code){
      return res.status(400).json({ error:"Faltan campos obligatorios" });
    }
    if (!isValidEmail(email))  return res.status(400).json({ error:"Email inválido" });
    if (parseInt(age,10) < 18) return res.status(400).json({ error:"Solo mayores de 18 años" });

    // Ubicación requerida
    if (!location || !location.display_name || !isValidLatLng(location.lat, location.lng)){
      return res.status(400).json({ error:"Falta ubicación exacta del evento." });
    }

    // REFERIDO opcional
    const referred = (referred_email || "").trim();
    if (referred){
      if (!isValidEmail(referred)) return res.status(400).json({ error:"Email de referido inválido" });
      if (referred.toLowerCase() === email.toLowerCase()) return res.status(400).json({ error:"No podés referirte a vos mismo" });
    }

    // Fechas válidas
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)){
      return res.status(400).json({ error:"Fecha u hora inválidas" });
    }

    // 1) Villas (bloqueo sin suscripción)
    if (isVilla(location.display_name)) {
      return res.status(409).json({ error:"No trabajamos en esa zona." });
    }

    // 2) Zona deshabilitada => permitir “avisame”
    const { province, city } = inferProvinceCity(location.display_name);
    if (await isDisabledCity(province, city)){
      return res.status(409).json({
        error: "Todavía no llegamos a tu zona",
        can_subscribe: true,
        province, city,
        display_name: location.display_name || ""
      });
    }

    // Plan válido
    const planKey = (plan || "1h").toLowerCase();
    const qPlan = await pool.query(
      `SELECT code, label, price_usd::float FROM plans WHERE code=$1 AND active=TRUE`,
      [planKey]
    );
    if (qPlan.rowCount === 0) return res.status(400).json({ error:"Plan inválido o no disponible" });

    // Disponibilidad (máx 2 por día y hora única)
    const hourInt = parseInt(String(time).split(":")[0], 10);

    const client = await pool.connect();
    let reservation, user;
    try{
      await client.query("BEGIN");

      // Upsert usuario
      const u = await client.query(
        `INSERT INTO users (name, email, age, zone, phone, postal_code)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (email) DO UPDATE SET
           name=EXCLUDED.name, age=EXCLUDED.age, zone=EXCLUDED.zone,
           phone=EXCLUDED.phone, postal_code=EXCLUDED.postal_code, updated_at=now()
         RETURNING id, name, email, age, zone, phone, postal_code`,
        [name, email, age, null, phone || null, postal_code || null]
      );
      user = u.rows[0];

      // Chequear día/hora
      const qDay = await client.query(
        `SELECT event_hour FROM reservations
          WHERE event_date=$1 AND status <> 'rechazada'`, [date]
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
            referred_email, province, city)
         VALUES
           ($1,$2,$3,$4,$5,$6,'pendiente',
            $7,$8,$9,$10,$11,
            $12,$13,$14)
         RETURNING id, event_date, event_hour, plan, zone, message, created_at,
                   location_display, location_address, location_lat, location_lng, location_osm_id,
                   referred_email, province, city`,
        [
          user.id, date, hourInt, qPlan.rows[0].code, null, message || null,
          location.display_name || null,
          (location.address || location.display_name || null),
          Number(location.lat), Number(location.lng),
          location.osm_id ? Number(location.osm_id) : null,
          referred ? referred.toLowerCase() : null,
          province || null, city || null
        ]
      );
      reservation = r.rows[0];

      await client.query("COMMIT");
    }catch(e){
      await client.query("ROLLBACK");
      if (e.code === "23505") return res.status(409).json({ error:"Ese horario ya está reservado." });
      console.error("DB ERROR:", e);
      return res.status(500).json({ error:"Error interno (DB)" });
    }finally{
      client.release();
    }

    // Emails (propietario + cliente) – opcional
    const transporter = createTransporter();
    try{
      if (transporter){
        const ownerEmail = process.env.TO_EMAIL || process.env.SMTP_USER;
        const fromEmail  = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;

        const token = signToken(reservation.id, user.email);
        const baseUrl =
          process.env.PUBLIC_BASE_URL?.trim() ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
        const acceptUrl = `${baseUrl}/api/accept?id=${reservation.id}&token=${token}`;
        const rejectUrl = `${baseUrl}/api/reject?id=${reservation.id}&token=${token}`;

        const mapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(reservation.location_lat)},${encodeURIComponent(reservation.location_lng)}`;

        const hh = String(reservation.event_hour).padStart(2,"0");
        const d = new Date(reservation.event_date);
        const dd = String(d.getUTCDate()).padStart(2,"0");
        const mm = String(d.getUTCMonth()+1).padStart(2,"0");
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
              <p>Tel: ${user.phone||"-"} — CP: ${user.postal_code||"-"}</p>
              <p><strong>${fechaCorta}</strong> · ${hh}:00 — Plan: <strong>${reservation.plan}</strong></p>
              <p>Prov/Ciudad: ${reservation.province||"-"} / ${reservation.city||"-"}</p>
              <p>Ubicación: ${reservation.location_display||"-"}</p>
              <p style="margin:.75rem 0">
                <a href="${mapsUrl}" target="_blank" rel="noreferrer"
                   style="background:#0ea5e9;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none">
                  Abrir en Google Maps
                </a>
              </p>
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
    }catch(e){ console.error("MAIL ERROR:", e); }

    const token = signToken(reservation.id, user.email);
    return res.status(200).json({ ok:true, reservation, token });

  }catch(err){
    console.error("GENERIC ERROR:", err);
    return res.status(500).json({ error:"Error interno" });
  }
}
