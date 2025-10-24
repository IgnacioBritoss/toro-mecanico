import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

/* =========================
   Helpers básicos
========================= */
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
function isAdmin(req){
  // Ajustalo a tu auth real si tenés sesión.
  return req.user?.is_admin || req.headers["x-admin"] === "1";
}
async function parseJSON(req){
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  try { return JSON.parse(raw); } catch { return {}; }
}

/* =================================================================
   LISTA NEGRA de VILLAS (CABA + GBA) — bloquea por coincidencia.
   Podés extender sin tocar DB.
================================================================= */
const VILLA_BLACKLIST = [
  // CABA (alias históricos y oficiales)
  "villa 31", "barrio padre mugica", "padre mugica",
  "villa 20", "villa lugano 20", "barrio papa francisco",
  "villa 1-11-14", "1-11-14", "riccardelli", "ricciardelli", "bajo flores",
  "villa 21-24", "zavaleta", "villa 15", "ciudad oculta", "villa 3",
  "villa 6", "villa 17", "villa 19", "villa 31 bis", "villa 31bis",
  "villa 26", "villa 2", "villa 7", "villa 8", "villa 13 bis",
  // GBA destacadas
  "villa itatí", "villa azúl", "villa azul",
  "fuerte apache", "ejército de los andes",
  "villa caraza", "villa la cava", "villa palito",
  "villa jardÍn", "villa jardín", "villa trujui", "villa los paraguayos",
  "la saladita", "la saladita de wilde",
].map(s => s.toLowerCase());

function looksBlacklisted(displayName=""){
  const t = displayName.toLowerCase();
  return VILLA_BLACKLIST.some(k => t.includes(k));
}

/* ===========================================================
   Normalización mínima de provincia/ciudad/barrio
   (no rompe tu front si no mandás esos campos)
=========================================================== */
function inferProvinceCityNeighborhood({ display_name="" } = {}){
  const txt = (display_name||"").toLowerCase();

  // Provincia:
  // si aparece "ciudad autónoma de buenos aires" o "caba" => "CABA"
  // caso contrario "Buenos Aires"
  const province = /c\.?a\.?b\.?a|ciudad aut[oó]noma de buenos aires|capital federal/.test(txt)
    ? "CABA" : "Buenos Aires";

  // Ciudad / Partido (heurística simple desde display_name)
  // tomamos el primer token que parezca partido/barriada conocida
  // Si no, dejamos vacío; no bloquea reserva.
  let city = "";
  const tokens = display_name.split(",").map(s => s.trim());
  for (const tk of tokens){
    const t = tk.toLowerCase();
    // algunos partidos clásicos GBA
    if (/quilmes|avellaneda|lan[uú]s|tigre|san isidro|san mart[ií]n|mor[oó]n|lomas de zamora|la matanza|berazategui|almirante brown|esteban echeverr[ií]a|ezeiza|ituzaing[oó]|merlo|vicente l[oó]pez|san miguel|malvinas argentinas|hurlingham|tres de febrero|berisso|ensenada/.test(t)){
      city = tk; break;
    }
    if (province==="CABA" && /caba|buenos aires/.test(t)){ city = "CABA"; }
  }

  // Barrio (si figura algo estilo "Saavedra", "Palermo", etc.)
  // tomamos el primer token ANTES de "CABA".
  let neighborhood = "";
  if (province==="CABA"){
    const iCaba = tokens.findIndex(x => /caba|ciudad aut[oó]noma/.test(x.toLowerCase()));
    if (iCaba > 0) neighborhood = tokens[iCaba-1].trim();
  }

  return { province, city, neighborhood };
}

/* ===========================================================
   Rutas auxiliares de administración de ZONAS/BARRIOS
=========================================================== */
/*
  GET /api/reserve?zones=1
      -> { zones:[{province,city,active}], blocks:[{province,city,neighborhood,active:false}], blacklist:[...] }
  PUT /api/reserve?zones=1   (admin)
      body: { zones:[...], blocks:[...] }
*/
export default async function handler(req, res){
  // CORS/health
  if (req.method === "OPTIONS"){
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, PUT, GET, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin");
    return res.status(200).end();
  }
  if (req.method === "HEAD"){ return res.status(200).end(); }

  // ========== ADMIN ZONES ==========
  if ((req.method === "GET" || req.method === "PUT") &&
      (req.query?.zones === "1" || req.query?.zones === 1)) {
    try{
      if (req.method === "GET"){
        try{
          const { rows: zones } = await pool.query(
            `SELECT province, city, active
               FROM public.service_zones
              WHERE province IN ('CABA','Buenos Aires')
              ORDER BY province, city`
          );
          let blocks = [];
          try{
            const q = await pool.query(
              `SELECT province, city, neighborhood, active
                 FROM public.service_blocks
                WHERE province IN ('CABA','Buenos Aires')
                ORDER BY province, city, neighborhood`
            );
            blocks = q.rows || [];
          }catch(e2){
            if (e2.code !== "42P01") throw e2; // tabla no existe => ignoramos
          }
          return res.status(200).json({ zones, blocks, blacklist: VILLA_BLACKLIST });
        }catch(e){
          if (e.code === "42P01"){ // ninguna tabla creada
            return res.status(200).json({ setup_needed:true, zones:[], blocks:[], blacklist: VILLA_BLACKLIST });
          }
          throw e;
        }
      }

      // PUT
      if (!isAdmin(req)) return res.status(403).json({ error:"No autorizado" });
      const body = await parseJSON(req);
      const zones = Array.isArray(body?.zones) ? body.zones : [];
      const blocks = Array.isArray(body?.blocks) ? body.blocks : [];

      const client = await pool.connect();
      try{
        await client.query("BEGIN");

        // Upsert zonas (ciudades/partidos)
        await client.query(`
          CREATE TABLE IF NOT EXISTS public.service_zones(
            province text NOT NULL,
            city     text NOT NULL,
            active   boolean NOT NULL DEFAULT true,
            updated_at timestamp with time zone DEFAULT now(),
            PRIMARY KEY (province, city)
          )`);
        const upsertZone = `
          INSERT INTO public.service_zones (province, city, active)
          VALUES ($1,$2,$3)
          ON CONFLICT (province, city)
          DO UPDATE SET active=EXCLUDED.active, updated_at=now()
        `;
        const keepZones = new Set();
        for (const z of zones){
          if (!z?.province || !z?.city) continue;
          const act = z.active === false ? false : true;
          await client.query(upsertZone, [z.province, z.city, act]);
          keepZones.add(`${z.province}||${z.city}`);
        }
        // Desactivar lo que no mandaron
        const { rows: allZones } = await client.query(
          `SELECT province, city, active FROM public.service_zones WHERE province IN ('CABA','Buenos Aires')`
        );
        for (const r of allZones){
          const k = `${r.province}||${r.city}`;
          if (!keepZones.has(k) && r.active){
            await client.query(`UPDATE public.service_zones SET active=false, updated_at=now()
                                 WHERE province=$1 AND city=$2`, [r.province, r.city]);
          }
        }

        // Upsert BLOQUEOS de barrios
        await client.query(`
          CREATE TABLE IF NOT EXISTS public.service_blocks(
            province     text NOT NULL,
            city         text NOT NULL,
            neighborhood text NOT NULL,
            active       boolean NOT NULL DEFAULT false, -- false= bloqueado
            updated_at   timestamp with time zone DEFAULT now(),
            PRIMARY KEY (province, city, neighborhood)
          )`);
        const upsertBlock = `
          INSERT INTO public.service_blocks (province, city, neighborhood, active)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (province, city, neighborhood)
          DO UPDATE SET active=EXCLUDED.active, updated_at=now()
        `;
        const keepBlocks = new Set();
        for (const b of blocks){
          if (!b?.province || !b?.city || !b?.neighborhood) continue;
          const act = b.active === false ? false : false; // siempre false == bloqueado
          await client.query(upsertBlock, [b.province, b.city, b.neighborhood, act]);
          keepBlocks.add(`${b.province}||${b.city}||${b.neighborhood}`);
        }
        // Eliminar bloqueos que no mandaron (opcional). Preferimos NO borrar.
        // Si quisieras borrar, descomentá:
        // await client.query(`DELETE FROM public.service_blocks WHERE ...not in keepBlocks`)

        await client.query("COMMIT");
      }catch(e){
        await client.query("ROLLBACK");
        console.error("PUT /zones error:", e);
        return res.status(500).json({ error:"Error guardando zonas/bloqueos" });
      }finally{
        client.release();
      }

      return res.status(200).json({ ok:true });
    }catch(e){
      console.error(e);
      return res.status(500).json({ error:"Error interno (zonas)" });
    }
  }

  // ========== POST RESERVA ==========
  if (req.method !== "POST"){
    return res.status(405).json({ error:"Método no permitido" });
  }

  try{
    const {
      name, email, phone, postal_code, age, message, date, time, plan,
      location, referred_email,
      province: provinceIn, city: cityIn, neighborhood: neighIn
    } = req.body || {};

    // Requisitos base (igual que antes)
    if (!name || !email || !age || !date || !time || !phone || !postal_code){
      return res.status(400).json({ error:"Faltan campos obligatorios" });
    }
    if (!isValidEmail(email))  return res.status(400).json({ error:"Email inválido" });
    if (parseInt(age,10) < 18) return res.status(400).json({ error:"Solo mayores de 18 años" });
    if (!location || !location.display_name || !isValidLatLng(location.lat, location.lng)){
      return res.status(400).json({ error:"Falta ubicación exacta del evento." });
    }

    // REFERIDO (opcional)
    const referred = (referred_email || "").trim();
    if (referred){
      if (!isValidEmail(referred))               return res.status(400).json({ error:"Email de referido inválido" });
      if (referred.toLowerCase() === email.toLowerCase()) return res.status(400).json({ error:"No podés referirte a vos mismo" });
    }

    // Bloqueo de short-notice (hoy + 3 días)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)){
      return res.status(400).json({ error:"Fecha u hora inválidas" });
    }
    const now = new Date();
    const minSel = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
    const reqDateTime = new Date(`${date}T${time}:00`);
    const reqDay = new Date(reqDateTime.getFullYear(), reqDateTime.getMonth(), reqDateTime.getDate());
    if (reqDay < minSel){
      return res.status(400).json({ error:"Solo se aceptan reservas a partir de dentro de 3 días." });
    }

    // === Provincia/Ciudad/Barrio: inferencia si no viene del front
    const inferred = inferProvinceCityNeighborhood({ display_name: location.display_name });
    const province = (provinceIn || inferred.province || "").trim();
    const city     = (cityIn || inferred.city || "").trim();
    const neighborhood = (neighIn || inferred.neighborhood || "").trim();

    // === LISTA NEGRA AUTOMÁTICA (Villas)
    if (looksBlacklisted(location.display_name)) {
      // Guardar interés para posible aviso (marca barrio rechazado)
      await pool.query(`
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
          created_at timestamp with time zone DEFAULT now(),
          notified_at timestamp with time zone
        )`);
      await pool.query(
        `INSERT INTO public.service_interests
           (province, city, neighborhood, name, email, phone, lat, lng, display_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT DO NOTHING`,
        [province||null, city||null, neighborhood||null, name||null, email, phone||null,
         Number(location.lat)||null, Number(location.lng)||null, location.display_name||null]
      );
      return res.status(409).json({ error:"No trabajamos en esa zona." });
    }

    // === Validación por CIUDAD habilitada (admin controla esto)
    let cityAllowed = true;
    try{
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.service_zones(
          province text NOT NULL,
          city     text NOT NULL,
          active   boolean NOT NULL DEFAULT true,
          updated_at timestamp with time zone DEFAULT now(),
          PRIMARY KEY (province, city)
        )`);
      const q = await pool.query(
        `SELECT 1 FROM public.service_zones
          WHERE province=$1 AND city=$2 AND active=TRUE LIMIT 1`,
        [province || "Buenos Aires", city || "CABA"]
      );
      cityAllowed = q.rowCount > 0;
    }catch{}

    // === Bloqueo puntual de BARRIO por admin
    let neighborhoodBlocked = false;
    if (neighborhood){
      try{
        await pool.query(`
          CREATE TABLE IF NOT EXISTS public.service_blocks(
            province     text NOT NULL,
            city         text NOT NULL,
            neighborhood text NOT NULL,
            active       boolean NOT NULL DEFAULT false,
            updated_at   timestamp with time zone DEFAULT now(),
            PRIMARY KEY (province, city, neighborhood)
          )`);
        const qb = await pool.query(
          `SELECT 1 FROM public.service_blocks
            WHERE province=$1 AND city=$2 AND neighborhood=$3 AND active=FALSE LIMIT 1`,
          [province || "Buenos Aires", city || "CABA", neighborhood]
        );
        neighborhoodBlocked = qb.rowCount > 0;
      }catch{}
    }

    if (!cityAllowed || neighborhoodBlocked){
      // Guardar interés y rechazar
      await pool.query(`
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
          created_at timestamp with time zone DEFAULT now(),
          notified_at timestamp with time zone
        )`);
      await pool.query(
        `INSERT INTO public.service_interests
           (province, city, neighborhood, name, email, phone, lat, lng, display_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT DO NOTHING`,
        [province||null, city||null, neighborhood||null, name||null, email, phone||null,
         Number(location.lat)||null, Number(location.lng)||null, location.display_name||null]
      );
      return res.status(409).json({ error:"Todavía no llegamos a tu zona" });
    }

    // === Plan válido
    const planKey = (plan || "1h").toLowerCase();
    const qPlan = await pool.query(
      `SELECT code, label, price_usd::float FROM plans WHERE code=$1 AND active=TRUE`,
      [planKey]
    );
    if (qPlan.rowCount === 0) return res.status(400).json({ error:"Plan inválido o no disponible" });
    const planRow = qPlan.rows[0];

    // === Disponibilidad
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

      // Insert reserva (guardamos provincia/ciudad/barrio inferidos)
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
      if (referred){
        await client.query(
          `INSERT INTO referral_edges (referrer_email, referee_email, reservation_id)
           VALUES ($1,$2,$3)
           ON CONFLICT ON CONSTRAINT uniq_edge_once DO NOTHING`,
          [referred.toLowerCase(), email.toLowerCase(), reservation.id]
        );
      }

      await client.query("COMMIT");
    }catch(e){
      await client.query("ROLLBACK");
      if (e.code === "23505") return res.status(409).json({ error:"Ese horario ya está reservado." });
      console.error("DB ERROR:", e);
      return res.status(500).json({ error:"Error interno (DB)" });
    }finally{
      client.release();
    }

    // Emails (propietario + cliente) – igual que antes (simplificado)
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
              <p>Prov/Ciudad/Barrio: ${reservation.province||"-"} / ${reservation.city||"-"} / ${reservation.neighborhood||"-"}</p>
              <p>Ubicación: ${reservation.location_display||"-"}</p>
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
