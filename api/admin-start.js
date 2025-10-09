import { pool } from "./db.js";
import crypto from "crypto";
import nodemailer from "nodemailer";

export const config = { runtime: "nodejs" };

function randCode(){ return String(Math.floor(100000 + Math.random()*900000)); } // 6 dígitos
function expiresIn(min=15){ const d=new Date(); d.setMinutes(d.getMinutes()+min); return d; }

export default async function handler(req, res){
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const { email } = req.body || {};
  if(!email) return res.status(400).json({ error: "Email requerido" });

  try{
    // Verificar que sea admin registrado
    const u = await pool.query(`SELECT email, phone FROM admin_users WHERE email=$1 AND is_active=true`, [email]);
    if(!u.rowCount) return res.status(403).json({ error: "No autorizado" });
    const phone = u.rows[0].phone;

    const email_code = randCode();
    const sms_code = randCode();

    const s = await pool.query(`
      INSERT INTO admin_sessions (email, email_code, sms_code, status, expires_at)
      VALUES ($1,$2,$3,'email_sent',$4)
      RETURNING id
    `, [email, email_code, sms_code, expiresIn(15)]);
    const session_id = s.rows[0].id;

    // Enviar correo
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;
      await transporter.sendMail({
        from: `Reservas Toro Mecánico <${fromEmail}>`,
        to: email,
        subject: "Código de acceso (admin)",
        text: `Tu código de verificación es: ${email_code}`
      });
    } else {
      console.log("ADMIN EMAIL CODE:", email_code);
    }

    return res.status(200).json({ ok:true, session_id, next:"verify-email", phone });
  }catch(e){
    console.error(e); return res.status(500).json({ error:"Error interno" });
  }
}
