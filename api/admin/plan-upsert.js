// api/admin/plan-upsert.js
import { pool } from "../db.js";
import { requireAdmin } from "./_auth.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res){
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try{
    const { id, code, label, price_usd, active = true, sort_order = 0 } = req.body || {};
    if (!code || !label || price_usd == null) {
      return res.status(400).json({ error: "Faltan datos: code, label, price_usd" });
    }

    let q;
    if (id){
      q = await pool.query(
        `UPDATE plans
            SET code=$2, label=$3, price_usd=$4, active=$5, sort_order=$6
          WHERE id=$1
        RETURNING id, code, label, price_usd::float, active, sort_order`,
        [id, String(code).trim(), String(label).trim(), Number(price_usd), !!active, parseInt(sort_order||0,10)]
      );
    }else{
      q = await pool.query(
        `INSERT INTO plans (code, label, price_usd, active, sort_order)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (code) DO UPDATE SET
           label=EXCLUDED.label,
           price_usd=EXCLUDED.price_usd,
           active=EXCLUDED.active,
           sort_order=EXCLUDED.sort_order
         RETURNING id, code, label, price_usd::float, active, sort_order`,
        [String(code).trim(), String(label).trim(), Number(price_usd), !!active, parseInt(sort_order||0,10)]
      );
    }
    res.status(200).json({ ok:true, plan: q.rows[0] });
  }catch(e){
    console.error("admin/plan-upsert error", e);
    res.status(500).json({ error: "Error interno" });
  }
}
