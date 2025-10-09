import { pool } from "./db.js";
import twilio from "twilio";

export const config = { runtime: "nodejs" };

export default async function handler(req, res){
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const { session_id, code } = req.body || {};
  if(!session_id || !code) return res.status(400).json({ error:"Datos incompletos" });

  try{
    const s = await pool.query(`
      SELECT a.id, a.email, a.email_code, a.sms_code, a.status, a.expires_at, u.phone
        FROM admin_sessions a
        JOIN admin_users u ON u.email = a.email
       WHERE a.id=$1
    `,[session_id]);
    if(!s.rowCount) return res.status(404).json({ error:"Sesión no encontrada" });

    const row = s.rows[0];
    if (new Date(row.expires_at) < new Date()) return res.status(410).json({ error:"Sesión expirada" });
    if (row.status !== "email_sent") return res.status(409).json({ error:"Estado inválido" });
    if (String(code) !== String(row.email_code)) return res.status(401).json({ error:"Código incorrecto" });

    // Transición de estado
    await pool.query(`UPDATE admin_sessions SET status='email_ok' WHERE id=$1`, [session_id]);

    // Enviar SMS
    if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM) {
      const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
      await client.messages.create({
        body: `Código SMS admin: ${row.sms_code}`,
        from: process.env.TWILIO_FROM,
        to: row.phone
      });
    } else {
      console.log("ADMIN SMS CODE:", row.sms_code, " to:", row.phone);
    }

    return res.status(200).json({ ok:true, next:"verify-sms" });
  }catch(e){
    console.error(e); return res.status(500).json({ error:"Error interno" });
  }
}
