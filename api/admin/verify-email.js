// api/admin/verify-email.js
import { pool } from "../../lib/db.js";
import { authenticator } from "otplib";
import QRCode from "qrcode";

export const config = { runtime: "nodejs" };

export default async function handler(req, res){
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const { session_id, code } = req.body || {};
  if(!session_id || !code) return res.status(400).json({ error:"Datos incompletos" });

  try{
    const s = await pool.query(`
      SELECT a.id, a.email, a.email_code, a.status, a.expires_at, u.totp_secret, u.totp_enabled
        FROM admin_sessions a
        JOIN admin_users   u ON u.email = a.email
       WHERE a.id = $1
    `,[session_id]);
    if(!s.rowCount) return res.status(404).json({ error:"Sesión no encontrada" });

    const row = s.rows[0];
    if (new Date(row.expires_at) < new Date())   return res.status(410).json({ error:"Sesión expirada" });
    if (row.status !== "email_sent")              return res.status(409).json({ error:"Estado inválido" });
    if (String(code) !== String(row.email_code))  return res.status(401).json({ error:"Código incorrecto" });

    // Marcar email ok
    await pool.query(`UPDATE admin_sessions SET status='email_ok' WHERE id=$1`, [session_id]);

    // Si TOTP está deshabilitado (por alguna razón), dejar pasar sin 2do factor
    if (row.totp_enabled === false) {
      return res.status(200).json({ ok:true, next:"verify-totp", totpDisabled:true });
    }

    // Asegurar secreto TOTP (si no existe, crearlo y guardarlo)
    let secret = row.totp_secret;
    if (!secret) {
      secret = authenticator.generateSecret();
      await pool.query(`UPDATE admin_users SET totp_secret=$2 WHERE email=$1`, [row.email, secret]);
    }

    // Armar otpauth URI y QR (para que lo escanees 1 sola vez)
    const issuer = "Toro Mecanico Admin";
    const otpauth = authenticator.keyuri(row.email, issuer, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    // Devolver datos para el paso TOTP
    return res.status(200).json({ ok:true, next:"verify-totp", otpauth, qrDataUrl });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:"Error interno" });
  }
}
