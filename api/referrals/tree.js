import { pool } from "../lib/db.js";

export const config = { runtime: "nodejs" };

function isValidEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e||""); }

export default async function handler(req, res){
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  try{
    const url = new URL(req.url, `http://${req.headers.host}`);
    const root = (url.searchParams.get("root") || "").trim().toLowerCase();
    if (!isValidEmail(root)) return res.status(400).json({ error: "root inválido" });

    const { rows } = await pool.query(
      `
      WITH RECURSIVE tree AS (
        SELECT LOWER(referrer_email) AS referrer_email,
               LOWER(referee_email)  AS referee_email,
               1 AS depth
        FROM referral_edges
        WHERE LOWER(referrer_email) = $1
        UNION ALL
        SELECT LOWER(e.referrer_email), LOWER(e.referee_email), t.depth + 1
        FROM referral_edges e
        JOIN tree t ON LOWER(e.referrer_email) = t.referee_email
      )
      SELECT referrer_email, referee_email, depth
      FROM tree
      ORDER BY depth, referrer_email, referee_email
      `,
      [root]
    );

    const children = new Map();
    const ensure = (k)=>{ if(!children.has(k)) children.set(k, new Set()); return children.get(k); };
    for(const r of rows){
      ensure(r.referrer_email).add(r.referee_email);
      ensure(r.referee_email);
    }

    function build(email){
      const kids = Array.from(children.get(email) || []);
      return { email, children: kids.map(build) };
    }

    return res.status(200).json({ ok:true, root, tree: build(root), count_edges: rows.length });
  }catch(err){
    console.error("TREE ERROR:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}
