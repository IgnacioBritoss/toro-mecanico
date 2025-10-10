// api/admin/plans-list.js
import { pool } from "../db.js";
import { requireAdmin } from "./_auth.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res){
  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  try{
    const { rows } = await pool.query(
      `SELECT id, code, label, price_usd::float, active, sort_order
         FROM plans
        ORDER BY sort_order, code`
    );
    res.status(200).json({ ok:true, plans: rows });
  }catch(e){
    console.error("admin/plans-list error", e);
    res.status(500).json({ error: "Error interno" });
  }
}
