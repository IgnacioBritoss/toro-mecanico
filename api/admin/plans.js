// api/admin/plans.js
import { pool } from "../../lib/db.js";
import { requireAdmin } from "./_auth.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res){
  try {
    if (req.method === "GET"){
      // Podés dejar GET público, pero lo hacemos admin para el editor
      if (!requireAdmin(req, res)) return;
      const q = await pool.query(
        "SELECT id, code, label, price_usd FROM plans ORDER BY id"
      );
      return res.status(200).json({ ok:true, plans:q.rows });
    }

    if (req.method === "POST"){
      if (!requireAdmin(req, res)) return;

      const { id, price_usd } = req.body || {};
      const pid = parseInt(id, 10);
      const p   = Number(price_usd);

      if (!pid || !Number.isFinite(p) || p <= 0){
        return res.status(400).json({ ok:false, error:"Datos inválidos" });
      }

      const up = await pool.query(
        "UPDATE plans SET price_usd=$1 WHERE id=$2 RETURNING id, code, label, price_usd",
        [p, pid]
      );
      if (!up.rowCount){
        return res.status(404).json({ ok:false, error:"Plan no encontrado" });
      }
      return res.status(200).json({ ok:true, plan:up.rows[0] });
    }

    return res.status(405).json({ ok:false, error:"Método no permitido" });
  } catch (e){
    console.error("ADMIN plans error:", e);
    return res.status(500).json({ ok:false, error:"Error interno" });
  }
}
