// api/admin/plans.js
import { pool } from "../../lib/db.js";

export const config = { runtime: "nodejs" };

// Lee la cookie "admin_session=ok"
function isAdminFromCookie(req){
  const ck = String(req.headers.cookie || "");
  return /(?:^|;\s*)admin_session=ok(?:;|$)/.test(ck);
}

export default async function handler(req, res){
  // PROTECCIÓN
  if (!isAdminFromCookie(req)) {
    return res.status(401).json({ ok:false, error: "Unauthorized" });
  }

  try {
    if (req.method === "GET") {
      const q = await pool.query(
        `SELECT id, code, label, price_usd::float, active
           FROM plans
          ORDER BY id ASC`
      );
      return res.status(200).json({ ok:true, plans: q.rows });

    } else if (req.method === "POST") {
      const { action, id, price_usd } = req.body || {};
      if (action !== "update" || !id || !Number.isFinite(Number(price_usd))) {
        return res.status(400).json({ ok:false, error:"Parámetros inválidos" });
      }
      const q = await pool.query(
        `UPDATE plans SET price_usd = $2, updated_at = now()
          WHERE id = $1
          RETURNING id, code, label, price_usd::float`,
        [id, Number(price_usd)]
      );
      if (q.rowCount === 0) {
        return res.status(404).json({ ok:false, error:"Plan no encontrado" });
      }
      return res.status(200).json({ ok:true, plan: q.rows[0] });

    } else {
      return res.status(405).json({ ok:false, error:"Método no permitido" });
    }
  } catch (e) {
    console.error("admin/plans error:", e);
    return res.status(500).json({ ok:false, error:"Error interno" });
  }
}
