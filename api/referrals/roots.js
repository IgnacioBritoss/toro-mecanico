import { pool } from "../lib/db.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res){
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  try{
    const { rows } = await pool.query(`
      WITH emails AS (
        SELECT LOWER(email) AS email FROM users
        UNION
        SELECT LOWER(referrer_email) FROM referral_edges
        UNION
        SELECT LOWER(referee_email)  FROM referral_edges
      ),
      roots AS (
        SELECT e.email
        FROM emails e
        WHERE NOT EXISTS (
          SELECT 1 FROM referral_edges x WHERE LOWER(x.referee_email) = e.email
        )
      )
      SELECT email
      FROM roots
      WHERE email IS NOT NULL AND email <> ''
      ORDER BY email
    `);

    return res.status(200).json({ ok:true, roots: rows.map(r => r.email) });
  }catch(err){
    console.error("ROOTS ERROR:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}
