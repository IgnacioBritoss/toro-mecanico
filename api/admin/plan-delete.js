// api/admin/plan-delete.js
import { pool } from "../db.js";
import { requireAdmin } from "./_auth.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res){
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try{
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Falta id" });

    await pool.query(`DELETE FROM plans WHERE id=$1`, [id]);
    res.status(200).json({ ok:true });
  }catch(e){
    console.error("admin/plan-delete error", e);
    res.status(500).json({ error: "Error interno" });
  }
}
