// api/plans.js
import { pool } from "../lib/db.js";

export const config = { runtime: "nodejs" };

// === NUEVO: rate limit para GET público
const RL = new Map();
function rateLimit(req, res, { windowMs=60_000, max=240 } = {}){
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const now = Date.now();
  const k = `${ip}:${Math.floor(now/windowMs)}`;
  const n = (RL.get(k) || 0) + 1;
  RL.set(k, n);
  if (n > max){
    return res.status(429).json({ error: "Too many requests" });
  }
  return true;
}

export default async function handler(req, res){
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  // NUEVO: RL
  if (!rateLimit(req, res)) return;

  try{
    const { rows } = await pool.query(
      `SELECT code, label, price_usd::float, sort_order
         FROM plans
        WHERE active = TRUE
        ORDER BY sort_order, price_usd, label`
    );
    return res.status(200).json({ ok: true, plans: rows });
  }catch(e){
    console.error("plans GET error", e);
    return res.status(500).json({ error: "Error interno" });
  }
}
