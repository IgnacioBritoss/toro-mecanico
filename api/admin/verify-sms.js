import { pool } from "../db.js";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

function signToken(email, sid){
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${email}:${sid}`).digest("hex");
}

export default async function handler(req, res){
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const { session_id, code } = req.body || {};
  if(!session_id || !code) return res.status(400).json({ error:"Datos incompletos" });

  try{
    const s = await pool.query(`SELECT id, email, sms_code, status, expires_at FROM admin_sessions WHERE id=$1`, [session_id]);
    if(!s.rowCount) return res.status(404).json({ error:"Sesión no encontrada" });
    const row = s.rows[0];

    if (new Date(row.expires_at) < new Date()) return res.status(410).json({ error:"Sesión expirada" });
    if (row.status !== "email_ok") return res.status(409).json({ error:"Estado inválido" });
    if (String(code) !== String(row.sms_code)) return res.status(401).json({ error:"Código incorrecto" });

    await pool.query(`UPDATE admin_sessions SET status='ok' WHERE id=$1`, [session_id]);

    // Seteamos cookie de sesión admin
    const token = signToken(row.email, row.id);
    const cookie = [
      `ADMIN_TOKEN=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=86400" // 1 día
    ].join("; ");
    res.setHeader("Set-Cookie", cookie);

    return res.status(200).json({ ok:true });
  }catch(e){
    console.error(e); return res.status(500).json({ error:"Error interno" });
  }
}
