// /api/referrals/tree.js
import { pool } from "../../lib/db.js";
export const config = { runtime: "nodejs" };
// === NUEVO: proteger como admin (usa la misma sesión/csrf) ===
import { withAdmin } from "../admin/_auth.js";

function isValidEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e||""); }

// === NUEVO: rate limit simple por IP ===
const RL = new Map();
function rateLimit(req, res, { windowMs=60_000, max=150 } = {}){
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const now = Date.now();
  const bucket = `${ip}:${Math.floor(now / windowMs)}`;
  const n = (RL.get(bucket) || 0) + 1;
  RL.set(bucket, n);
  if (n > max){
    return res.status(429).json({ error:"Too many requests" });
  }
  return true;
}

export default withAdmin(async function handler(req, res){
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  // NUEVO: rate limit
  if (!rateLimit(req, res)) return;

  try{
    // validar tabla también aquí por si no existe
    const chk = await pool.query(`SELECT to_regclass('public.referral_edges') AS t`);
    if (!chk.rows?.[0]?.t) {
      return res.status(200).json({ ok:true, root:null, tree:null });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const root = (url.searchParams.get("root") || "").trim().toLowerCase();
    if (!isValidEmail(root)) return res.status(400).json({ error: "root inválido" });

    const { rows } = await pool.query(`
      WITH RECURSIVE tree AS (
        SELECT LOWER(referrer_email) AS referrer_email,
               LOWER(referee_email)  AS referee_email
        FROM referral_edges
        WHERE LOWER(referrer_email) = $1
        UNION ALL
        SELECT LOWER(e.referrer_email), LOWER(e.referee_email)
        FROM referral_edges e
        JOIN tree t ON LOWER(e.referrer_email) = t.referee_email
      )
      SELECT referrer_email, referee_email FROM tree
    `, [root]);

    const emailsSet = new Set([root]);
    const children = new Map();
    const ensure = (k)=>{ if(!children.has(k)) children.set(k, new Set()); return children.get(k); };
    for(const r of rows){
      emailsSet.add(r.referrer_email);
      emailsSet.add(r.referee_email);
      ensure(r.referrer_email).add(r.referee_email);
      ensure(r.referee_email);
    }

    const emailsArr = Array.from(emailsSet);
    let nameMap = new Map();
    if (emailsArr.length){
      const { rows: names } = await pool.query(`
        SELECT LOWER(email) AS email, COALESCE(NULLIF(TRIM(name), ''), email) AS name
        FROM users
        WHERE LOWER(email) = ANY($1)
      `, [emailsArr]);
      nameMap = new Map(names.map(r => [r.email, r.name]));
    }

    function build(email){
      const kids = Array.from(children.get(email) || []);
      return { email, name: nameMap.get(email) || email, children: kids.map(build) };
    }

    return res.status(200).json({ ok: true, root, tree: build(root) });
  }catch(err){
    console.error("TREE ERROR:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});
