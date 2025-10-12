// /api/referrals/roots.js
import { pool } from "../lib/db.js";
export const config = { runtime: "nodejs" };

/*
  Manejo defensivo:
  - Si la tabla referral_edges NO existe en el deploy, devolvemos roots: []
    en vez de 500, así la UI no queda en "Error (500)".
*/
export default async function handler(req, res){
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  try{
    // ¿existe la tabla?
    const chk = await pool.query(`SELECT to_regclass('public.referral_edges') AS t`);
    if (!chk.rows?.[0]?.t) {
      return res.status(200).json({ ok:true, roots: [] });
    }

    const { rows } = await pool.query(`
      WITH emails AS (
        SELECT LOWER(email) AS email FROM users
        UNION SELECT LOWER(referrer_email) FROM referral_edges
        UNION SELECT LOWER(referee_email)  FROM referral_edges
      ),
      roots AS (
        SELECT e.email
        FROM emails e
        WHERE NOT EXISTS (
          SELECT 1 FROM referral_edges x WHERE LOWER(x.referee_email) = e.email
        )
      )
      SELECT r.email, COALESCE(NULLIF(TRIM(u.name),''), r.email) AS name
      FROM roots r
      LEFT JOIN users u ON LOWER(u.email) = r.email
      WHERE r.email IS NOT NULL AND r.email <> ''
      ORDER BY name
    `);

    return res.status(200).json({
      ok:true,
      roots: rows.map(r => ({ email: r.email, name: r.name || r.email }))
    });
  }catch(err){
    console.error("ROOTS ERROR:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}
