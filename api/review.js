import { pool } from "./db.js";
export const config = { runtime: "nodejs" };

export default async function handler(req, res){
  try{
    if (req.method === "POST"){
      const { name, text, stars } = req.body || {};
      const s = Math.max(1, Math.min(5, parseInt(stars||"1",10)));
      if (!name || !text) return res.status(400).json({ error: "Faltan campos" });
      await pool.query(
        `INSERT INTO reviews (name, text, stars) VALUES ($1,$2,$3)`,
        [name.trim().slice(0,60), text.trim().slice(0,140), s]
      );
      return res.status(200).json({ ok:true });
    }

    if (req.method === "GET"){
      const { rows } = await pool.query(`SELECT id, name, text, stars, created_at FROM reviews ORDER BY created_at DESC LIMIT 12`);
      return res.status(200).json({ items: rows });
    }

    return res.status(405).json({ error: "Método no permitido" });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error: "Error interno" });
  }
}
