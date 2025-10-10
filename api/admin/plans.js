import { pool } from "../db.js";
import { ensureAdmin } from "./_auth.js";

export const config = { runtime: "nodejs" };

// Helper básico
function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return !!v;
}

export default async function handler(req, res) {
  // Autenticación admin (cookie admin_session=ok, etc.)
  if (!ensureAdmin(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    if (req.method === "GET") {
      // LISTAR
      const { rows } = await pool.query(
        `SELECT id, code, label, price_usd, active, sort_order
           FROM plans
          ORDER BY sort_order NULLS LAST, id ASC`
      );
      return res.status(200).json({ ok: true, plans: rows });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const action = (body.action || "").trim().toLowerCase();

      if (action === "upsert") {
        // Crear/editar
        const id = body.id ? Number(body.id) : null;
        const code = (body.code || "").trim();
        const label = (body.label || "").trim();
        const price = Number(body.price_usd);
        const active = toBool(body.active ?? true);
        const sortOrder =
          body.sort_order === null || body.sort_order === undefined
            ? null
            : Number(body.sort_order);

        if (!code || !label || !Number.isFinite(price)) {
          return res
            .status(400)
            .json({ ok: false, error: "Faltan code, label o price_usd válido" });
        }

        if (id) {
          // UPDATE por id
          const q = await pool.query(
            `UPDATE plans
                SET code=$2, label=$3, price_usd=$4, active=$5, sort_order=$6, updated_at=now()
              WHERE id=$1
            RETURNING id, code, label, price_usd, active, sort_order`,
            [id, code, label, price, active, sortOrder]
          );
          if (!q.rowCount) {
            return res.status(404).json({ ok: false, error: "Plan no encontrado" });
          }
          return res.status(200).json({ ok: true, plan: q.rows[0] });
        } else {
          // INSERT (code único)
          const q = await pool.query(
            `INSERT INTO plans (code, label, price_usd, active, sort_order)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (code) DO UPDATE SET
               label=EXCLUDED.label,
               price_usd=EXCLUDED.price_usd,
               active=EXCLUDED.active,
               sort_order=EXCLUDED.sort_order,
               updated_at=now()
             RETURNING id, code, label, price_usd, active, sort_order`,
            [code, label, price, active, sortOrder]
          );
          return res.status(200).json({ ok: true, plan: q.rows[0] });
        }
      }

      if (action === "delete") {
        const id = Number(body.id);
        if (!id) return res.status(400).json({ ok: false, error: "id requerido" });
        const q = await pool.query(`DELETE FROM plans WHERE id=$1`, [id]);
        if (!q.rowCount) {
          return res.status(404).json({ ok: false, error: "Plan no encontrado" });
        }
        return res.status(200).json({ ok: true, deleted: id });
      }

      return res.status(400).json({ ok: false, error: "Action inválida" });
    }

    return res.status(405).json({ ok: false, error: "Método no permitido" });
  } catch (e) {
    console.error("ADMIN plans error:", e);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}
