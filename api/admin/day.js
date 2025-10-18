// api/admin/day.js
import { pool } from "../../lib/db.js";
// === NUEVO: wrapper con sesión + CSRF ===
import { withAdmin } from "./_auth.js";

export const config = { runtime: "nodejs" };

function isAdminFromCookie(req){
  const ck = String(req.headers.cookie || "");
  return /(?:^|;\s*)admin_session=ok(?:;|$)/.test(ck);
}
function isoDay(s){
  // yyyy-mm-dd simple
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s||"")) ? s : null;
}

// === NUEVO: rate limit simple por IP ===
const RL = new Map();
function rateLimit(req, res, { windowMs=60_000, max=180 } = {}){
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const now = Date.now();
  const bucket = `${ip}:${Math.floor(now / windowMs)}`;
  const n = (RL.get(bucket) || 0) + 1;
  RL.set(bucket, n);
  if (n > max){
    return res.status(429).json({ ok:false, error:"Too many requests" });
  }
  return true;
}

export default withAdmin(async function handler(req, res){
  if (!isAdminFromCookie(req)) {
    return res.status(401).json({ ok:false, error:"Unauthorized" });
  }
  if (req.method !== "GET") {
    return res.status(405).json({ ok:false, error:"Método no permitido" });
  }

  // NUEVO: rate limit
  if (!rateLimit(req, res)) return;

  const day = isoDay(req.query.date);
  if (!day) return res.status(400).json({ ok:false, error:"Fecha inválida" });

  try{
    const q = await pool.query(
      `SELECT r.id,
              r.event_date::date AS event_date,
              r.event_hour AS hour,
              r.plan,
              r.status,
              u.name, u.email, u.phone,
              r.location_display,
              r.location_lat::float AS lat,
              r.location_lng::float AS lng
         FROM reservations r
         JOIN users u ON u.id = r.user_id
        WHERE r.event_date = $1
          AND r.status <> 'rechazada'
        ORDER BY r.event_hour ASC`,
      [day]
    );

    const list = q.rows.map(row => ({
      id: row.id,
      date: row.event_date,
      time: String(row.hour).padStart(2,"0") + ":00",
      plan: row.plan,
      status: row.status,
      name: row.name,
      email: row.email,
      phone: row.phone || "-",
      location: {
        display_name: row.location_display || "",
        lat: row.lat,
        lng: row.lng
      }
    }));

    return res.status(200).json({ ok:true, reservations: list });
  }catch(e){
    console.error("admin/day error:", e);
    return res.status(500).json({ ok:false, error:"Error interno" });
  }
});
