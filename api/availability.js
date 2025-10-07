import { pool } from "./db.js";
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  const { start, end } = req.query || {};
  if (!start || !end) return res.status(400).json({ error: "Parámetros start y end requeridos (YYYY-MM-DD)" });

  try {
    const sql = `
      SELECT event_date, event_hour, COUNT(*)::int AS c
      FROM reservations
      WHERE event_date BETWEEN $1 AND $2
      GROUP BY event_date, event_hour
      ORDER BY event_date, event_hour
    `;
    const { rows } = await pool.query(sql, [start, end]);

    const days = {};
    for (const r of rows) {
      const key = r.event_date.toISOString().slice(0,10);
      if (!days[key]) days[key] = { count: 0, hours: [] };
      days[key].count += r.c;
      days[key].hours.push(r.event_hour);
    }
    return res.status(200).json({ days });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error interno" });
  }
}
