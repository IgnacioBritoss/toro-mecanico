// api/reserve.js
import { pool } from "../lib/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

// ---------- utils ----------
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || "");
const sign = (id, email) => {
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
};
const validLatLng = (lat, lng) => {
  const la = Number(lat), ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
};
async function readBody(req){
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
const mailer = () => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
};

// ---------- blacklist villas ----------
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
const looksBlacklisted = (s="") => VILLA_BLACKLIST.some(k => (s||"").toLowerCase().includes(k));

// ---------- heurística prov/ciudad/barrio (sin romper si no hay) ----------
function inferPCB(display_name=""){
  const tokens = (display_name||"").split(",").map(s => s.trim());
  const low = (display_name||"").toLowerCase();
  const province = /c\.?a\.?b\.?a|ciudad aut[oó]noma de buenos aires|capital federal/.test(low) ? "CABA" : "Buenos Aires";
  let city = province === "CABA" ? "CABA" : "";
  for (const tk of tokens){
    const t = tk.toLowerCase();
    if (/quilmes|avellaneda|lan[uú]s|tigre|san isidro|san mart[ií]n|mor[oó]n|lomas de zamora|la matanza|berazategui|almirante brown|esteban echeverr[ií]a|ezeiza|ituzaing[oó]|merlo|vicente l[oó]pez|hurlingham|tres de febrero|berisso|ensenada|malvinas argentinas|san miguel/.test(t)){
      city = tk; break;
    }
  }
  let neighborhood = "";
  if (province === "CABA"){
    const i = tokens.findIndex(x => /caba|ciudad aut[oó]noma/.test(x.toLowerCase()));
    if (i > 0) neighborhood = tokens[i-1];
  }
  return { province, city, neighborhood };
}

// ---------- helper: ¿zona habilitada? ----------
// Regla: si la tabla service_zones NO existe o está vacía → TODO habilitado.
// Si existe y tiene filas → se requiere (province, city, active=true).
async function isCityEnabled(province, city){
  try{
    const exist = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='service_zones'`);
    if (exist.rowCount === 0) return true; // no configurado => todo habilitado

    const any = await pool.query(`SELECT 1 FROM service_zones LIMIT 1`);
    if (any.rowCount === 0) return true;   // vacía => todo habilitado

    const q = await pool.query(
      `SELECT 1 FROM service_zones WHERE province=$1 AND city=$2 AND active=TRUE LIMIT 1`,
      [province || "Buenos Aires", city || "CABA"]
    );
    return q.rowCount > 0;
  }catch{ return true; } // cualquier error => no bloqueamos
}

export default async function handler(req, res){
  // CORS básico
  if (req.method === "OPTIONS"){
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(200).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error:"Método no permitido" });

  try{
    const body = await readBody(req);
    const {
      name, email, phone, postal_code, age, message, date, time, plan,
      location, referred_email
    } = body || {};

    // validaciones base (igual que antes)
    if (!name || !email || !age || !date || !time || !phone || !postal_code)
      return res.status(400).json({ error:"Faltan campos obligatorios" });
    if (!okEmail(email)) return res.status(400).json({ error:"Email inválido" });
    if (parseInt(age,10) < 18) return res.status(400).json({ error:"Solo mayores de 18 años" });
    if (!location || !location.display_name || !validLatLng(location.lat, location.lng))
      return res.status(400).json({ error:"Falta ubicación exacta del evento." });

    const referred = (referred_email || "").trim();
    if (referred){
      if (!okEmail(referred)) return res.status(400).json({ error:"Email de referido inválido" });
      if (referred.toLowerCase() === email.toLowerCase()) return res.status(400).json({ error:"No podés referirte a vos mismo" });
    }

    // ventana mínima (hoy + 3 días)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
      return res.status(400).json({ error:"Fecha u hora inválidas" });
    const today = new Date(); today.setHours(0,0,0,0);
    const minDay = new Date(today); minDay.setDate(minDay.getDate()+3);
    const reqDay = new Date(`${date}T00:00:00`);
    if (reqDay < minDay) return res.status(400).json({ error:"Solo reservas con 3 días de anticipación." });

    // infiere provincia/ciudad/barrio
    const { province, city, neighborhood } = inferPCB(location.display_name);

    // villas → rechazamos
    if (looksBlacklisted(location.display_name)){
      return res.status(409).json({ error:"No trabajamos en esa zona." });
    }

    // ¿ciudad habilitada? (si no hay config, todo habilitado)
    const allowed = await isCityEnabled(province, city);
    if (!allowed){
      return res.status(409).json({ error:"Todavía no llegamos a tu zona" });
    }

    // ---- DB (sin crear tablas nuevas) ----
    const client = await pool.connect();
    try{
      await client.query("BEGIN");

      // plan válido (si falta la fila exacta, devolvemos 400)
      const planCode = String(plan || "1h").toLowerCase();
      const qPlan = await client.query(`SELECT code FROM plans WHERE code=$1 AND active=TRUE`, [planCode]);
      if (qPlan.rowCount === 0){
        await client.query("ROLLBACK");
        return res.status(400).json({ error:"Plan inválido o no disponible" });
      }

      // upsert usuario por email
      const u = await client.query(
        `INSERT INTO users (name, email, age, zone, phone, postal_code)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (email) DO UPDATE SET
           name=EXCLUDED.name, age=EXCLUDED.age, zone=EXCLUDED.zone,
           phone=EXCLUDED.phone, postal_code=EXCLUDED.postal_code, updated_at=now()
         RETURNING id, name, email, age, zone, phone, postal_code`,
        [name, email, parseInt(age,10), null, phone || null, postal_code || null]
      );
      const user = u.rows[0];

      // disponibilidad (máx 2 por día, sin choque de hora)
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
      const reservation = r.rows[0];

      // referidos (si falla por constraint, ignoramos)
      if (referred){
        try{
          await client.query(
            `INSERT INTO referral_edges (referrer_email, referee_email, reservation_id)
             VALUES ($1,$2,$3)
             ON CONFLICT DO NOTHING`,
            [referred.toLowerCase(), email.toLowerCase(), reservation.id]
          );
        }catch{/* ignorar */}
      }

      await client.query("COMMIT");

      // emails (opcional)
      const tx = mailer();
      if (tx){
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
      }

      const token = sign(reservation.id, user.email);
      return res.status(200).json({ ok:true, reservation, token });
    }catch(e){
      try{ await pool.query("ROLLBACK"); }catch{}
      console.error("DB ERROR /api/reserve:", e);
      return res.status(500).json({ error:"Error interno (DB)" });
    }
  }catch(e){
    console.error("GENERIC ERROR /api/reserve:", e);
    return res.status(500).json({ error:"Error interno" });
  }
}
