// api/admin/plans.js
import { pool } from "../../lib/db.js"; // <- así con DOS niveles hacia arriba

export const config = { runtime: "nodejs" };

function isAdmin(req) {
  const cookie = req.headers.cookie || "";
  return /(?:^|;\s*)admin_session=ok(?:;|$)/.test(cookie);
}

export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ ok:false, error:"Unauthorized" });

  try {
    if (req.method === "GET") {
      const q = await pool.query(
        "SELECT id, code, label, price_usd FROM plans WHERE active=true ORDER BY order_index NULLS LAST, id"
      );
      return res.status(200).json({ ok:true, plans:q.rows });
    }

    if (req.method === "POST") {
      const { action, id, code, label, price_usd } = req.body || {};
      if (action !== "update") return res.status(400).json({ ok:false, error:"Acción inválida" });

      const price = Number(price_usd);
      if (Number.isNaN(price)) return res.status(400).json({ ok:false, error:"Precio inválido" });

      if (id) {
        const q = await pool.query("UPDATE plans SET price_usd=$2, updated_at=NOW() WHERE id=$1 RETURNING id", [id, price]);
        if (!q.rowCount) return res.status(404).json({ ok:false, error:"Plan no encontrado" });
        return res.status(200).json({ ok:true, id });
      } else if (code) {
        const sel = await pool.query("SELECT id FROM plans WHERE code=$1", [code]);
        if (sel.rowCount) {
          const pid = sel.rows[0].id;
          await pool.query("UPDATE plans SET price_usd=$2, updated_at=NOW() WHERE id=$1", [pid, price]);
          return res.status(200).json({ ok:true, id: pid });
        } else {
          const ins = await pool.query(
            "INSERT INTO plans (code,label,price_usd,active) VALUES ($1,$2,$3,true) RETURNING id",
            [code, label || code, price]
          );
          return res.status(200).json({ ok:true, id: ins.rows[0].id });
        }
      } else {
        return res.status(400).json({ ok:false, error:"Falta id o code" });
      }
    }

    return res.status(405).json({ ok:false, error:"Método no permitido" });
  } catch (e) {
    console.error("ADMIN plans error:", e);
    return res.status(500).json({ ok:false, error:"Error interno" });
  }
}
