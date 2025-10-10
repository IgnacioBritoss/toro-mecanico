// api/admin/verify-email.js
import { pool } from "../../lib/db.js";
import { authenticator } from "otplib";
import QRCode from "qrcode";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // Métodos permitidos y headers básicos (útil también para preflight)
  const ALLOW = "POST,OPTIONS";
  res.setHeader("Access-Control-Allow-Methods", ALLOW);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // Si lo necesitás para pruebas desde otro origen:
  // res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    // Preflight OK
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ALLOW);
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  // --- cuerpo de la request ---
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { /* ignore */ }
  }
  const { session_id, code } = body || {};
  if (!session_id || !code) {
    return res.status(400).json({ ok: false, error: "Datos incompletos" });
  }

  try {
    const s = await pool.query(
      `
      SELECT a.id, a.email, a.email_code, a.status, a.expires_at,
             u.totp_secret, u.totp_enabled
        FROM admin_sessions a
        JOIN admin_users   u ON u.email = a.email
       WHERE a.id = $1
    `,
      [session_id]
    );

    if (!s.rowCount) {
      return res.status(404).json({ ok: false, error: "Sesión no encontrada" });
    }

    const row = s.rows[0];

    if (new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ ok: false, error: "Sesión expirada" });
    }
    if (row.status !== "email_sent") {
      return res.status(409).json({ ok: false, error: "Estado inválido" });
    }
    if (String(code) !== String(row.email_code)) {
      return res.status(401).json({ ok: false, error: "Código incorrecto" });
    }

    // Marcar email OK
    await pool.query(`UPDATE admin_sessions SET status='email_ok' WHERE id=$1`, [session_id]);

    // Si TOTP está deshabilitado, dejar pasar sin 2do factor
    if (row.totp_enabled === false) {
      return res.status(200).json({ ok: true, next: "verify-totp", totpDisabled: true });
    }

    // Asegurar secreto TOTP (si no existe, crear y guardar)
    let secret = row.totp_secret;
    if (!secret) {
      secret = authenticator.generateSecret();
      await pool.query(`UPDATE admin_users SET totp_secret=$2 WHERE email=$1`, [row.email, secret]);
    }

    // Generar otpauth URI y QR
    const issuer = "Toro Mecanico Admin";
    const otpauth = authenticator.keyuri(row.email, issuer, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    return res.status(200).json({
      ok: true,
      next: "verify-totp",
      otpauth,
      qrDataUrl
    });
  } catch (e) {
    console.error("ADMIN verify-email error:", e);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}
 