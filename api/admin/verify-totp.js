// api/admin/verify-totp.js
import { pool } from "../../lib/db.js";
import crypto from "crypto";
import { authenticator } from "otplib";

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
    // Traer sesión + secreto TOTP del usuario
    const r = await pool.query(`
      SELECT a.id, a.email, a.status, a.expires_at, u.totp_secret, u.totp_enabled
        FROM admin_sessions a
        JOIN admin_users   u ON u.email = a.email
       WHERE a.id = $1
    `,[session_id]);
    if(!r.rowCount) return res.status(404).json({ error:"Sesión no encontrada" });

    const row = r.rows[0];
    if (new Date(row.expires_at) < new Date()) return res.status(410).json({ error:"Sesión expirada" });
    if (row.status !== "email_ok")              return res.status(409).json({ error:"Estado inválido" });

    if (row.totp_enabled === false) {
      // Si lo deshabilitaste explícitamente, dejá pasar sin TOTP
    } else {
      if (!row.totp_secret) return res.status(409).json({ error:"TOTP no configurado aún" });
      const ok = authenticator.verify({ token: String(code), secret: row.totp_secret });
      if (!ok) return res.status(401).json({ error:"Código TOTP inválido" });
    }

    // Marcar sesión completa (opcional)
    await pool.query(`UPDATE admin_sessions SET status='ok' WHERE id=$1`, [session_id]);

    // Setear cookie admin
    const token = signToken(row.email, row.id);
    const cookie = [
      `ADMIN_TOKEN=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=86400",
      "Secure"              // estás en Vercel (HTTPS)
    ].join("; ");
    res.setHeader("Set-Cookie", cookie);

    return res.status(200).json({ ok:true });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:"Error interno" });
  }
}
