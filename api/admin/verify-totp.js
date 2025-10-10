// api/admin/verify-totp.js
import { pool } from "../../lib/db.js";
import { authenticator } from "otplib";

export const config = { runtime: "nodejs" };

export default async function handler(req, res){
  if (req.method !== "POST"){
    return res.status(405).json({ ok:false, error:"Método no permitido" });
  }

  const { session_id, code } = req.body || {};
  if (!session_id || !code){
    return res.status(400).json({ ok:false, error:"Datos incompletos" });
  }

  try{
    const q = await pool.query(`
      SELECT a.id, a.email, a.status, a.expires_at,
             u.totp_secret, u.totp_enabled
        FROM admin_sessions a
        JOIN admin_users   u ON u.email = a.email
       WHERE a.id = $1
    `,[session_id]);

    if (!q.rowCount) return res.status(404).json({ ok:false, error:"Sesión no encontrada" });

    const row = q.rows[0];
    if (new Date(row.expires_at) < new Date())    return res.status(410).json({ ok:false, error:"Sesión expirada" });
    if (row.status !== "email_ok")                 return res.status(409).json({ ok:false, error:"Estado inválido" });
    if (row.totp_enabled === false) {
      // Si no usa TOTP, logueamos igual
      res.setHeader("Set-Cookie", [
        "admin_session=ok; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure"
      ]);
      return res.status(200).json({ ok:true, session:"ok" });
    }

    const ok = authenticator.check(String(code), row.totp_secret);
    if (!ok) return res.status(401).json({ ok:false, error:"Código TOTP incorrecto" });

    // Marcá la sesión como completa si querés:
    await pool.query(`UPDATE admin_sessions SET status='totp_ok' WHERE id=$1`, [session_id]);

    // <<< COOKIE DE SESIÓN ADMIN >>>
    res.setHeader("Set-Cookie", [
      "admin_session=ok; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure"
    ]);

    return res.status(200).json({ ok:true, session:"ok" });
  }catch(e){
    console.error("verify-totp error:", e);
    return res.status(500).json({ ok:false, error:"Error interno" });
  }
}
