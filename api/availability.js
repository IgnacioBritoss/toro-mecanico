// /api/availability.js
import { pool } from "../lib/db.js";

export const config = { runtime: "nodejs" };

/*
  Cambio clave:
  - Antes: contaba solo ('pendiente','confirmada')
  - Ahora: cuenta TODO lo que NO sea 'rechazada'
  => así bloquea tanto reservas pendientes como aceptadas, sin importar
     si el endpoint /api/accept setea 'aceptada', 'aprobada', etc.
  - Además: devolvemos la clave de día con TO_CHAR('YYYY-MM-DD') para evitar
    desfases de zona horaria al serializar fechas.
*/
export default async function handler(req, res){
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  const { start, end } = req.query || {};
  if (!start || !end) return res.status(400).json({ error: "Faltan 'start' y 'end' (YYYY-MM-DD)" });

  try{
    const q = await pool.query(`
      SELECT
        TO_CHAR(event_date::date, 'YYYY-MM-DD') AS dkey,
        COUNT(*) FILTER (WHERE COALESCE(status,'') <> 'rechazada') AS c,
        COALESCE(
          ARRAY_AGG(DISTINCT event_hour)
          FILTER (WHERE COALESCE(status,'') <> 'rechazada'),
          '{}'
        ) AS hrs
      FROM reservations
      WHERE event_date BETWEEN $1 AND $2
      GROUP BY 1
      ORDER BY 1
    `, [start, end]);

    const days = {};
    for (const row of q.rows){
      const key = row.dkey; // clave estable de día
      days[key] = {
        count: Number(row.c) || 0,
        hours: (row.hrs || []).map(n => Number(n))
      };
    }

    return res.status(200).json({ days });
  }catch(e){
    console.error("AVAILABILITY ERROR:", e);
    return res.status(500).json({ error: "Error interno" });
  }
}
