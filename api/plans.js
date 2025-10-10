// api/plans.js
import { pool } from "../lib/db.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res){
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });
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
