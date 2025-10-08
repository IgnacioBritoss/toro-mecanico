import { pool } from "./db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

export const config = { runtime: "nodejs" };

/* ========== Helpers ========== */
function signToken(id, email){
  const secret = process.env.RESERVATION_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${id}:${email}`).digest("hex");
}
function pad2(n){ return String(n).padStart(2, "0"); }
function safe(v){ return (v ?? "").toString().trim(); }
function htmlEscape(str=""){
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function formatFechaAR(dateStr){
  const d = new Date(`${dateStr}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short", day: "2-digit", month: "long", year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires"
  }).format(d);
}
function pageWrap({ title, bodyHtml, backHref="/" }){
  return `
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Noto Sans';padding:24px;max-width:720px;margin:0 auto">
    <h2 style="margin:0 0 10px">${htmlEscape(title)}</h2>
    ${bodyHtml}
    <div style="margin-top:14px">
      <a href="${backHref}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px">Volver al sitio</a>
    </div>
  </div>`;
}
/* ============================= */

export default async function handler(req, res){
  if (req.method === "GET") {
    const { id, token } = req.query || {};
    if(!id || !token) return res.status(400).send("Link inválido");
    res.setHeader("Content-Type","text/html; charset=utf-8");
    return res.end(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Noto Sans';padding:24px;max-width:720px;margin:0 auto">
        <h2>Rechazar reserva</h2>
        <form method="POST" action="/api/reject">
          <input type="hidden" name="id" value="${Number(id)}" />
          <input type="hidden" name="token" value="${htmlEscape(token)}" />
          <label>Motivo (se enviará al cliente):<br/>
            <textarea name="reason" rows="4" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:10px" required></textarea>
          </label>
          <div style="margin-top:12px">
            <button type="submit" style="background:#dc2626;color:#fff;padding:10px 14px;border:none;border-radius:10px">Enviar rechazo</button>
          </div>
        </form>
      </div>
    `);
  }

  if (req.method === "POST") {
    const chunks=[]; for await (const c of req) chunks.push(c);
    const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    const id = params.get("id");
    const token = params.get("token");
    const reason = (params.get("reason") || "").trim();
    if(!id || !token || !reason) return res.status(400).send("Datos incompletos");

    try{
      const { rows } = await pool.query(`
        SELECT r.id, r.event_date, r.event_hour, r.plan, r.status,
               u.name, u.email
          FROM reservations r
          JOIN users u ON u.id = r.user_id
         WHERE r.id = $1
      `,[id]);
      if(!rows.length) return res.status(404).send("Reserva no encontrada");
      const r = rows[0];

      const expected = signToken(r.id, r.email);
      if (expected !== token) return res.status(403).send("Token inválido");

      await pool.query(`UPDATE reservations SET status='rechazada', reject_reason=$2 WHERE id=$1`, [r.id, reason]);

      // -------- Email al cliente (formal, es-AR, sin emojis/UTC) --------
      try{
        if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || "587", 10),
            secure: process.env.SMTP_PORT === "465",
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          });
          const ownerEmail = process.env.TO_EMAIL || process.env.SMTP_USER;
          const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || ownerEmail;

          const fecha = formatFechaAR(r.event_date);
          const hora  = `${pad2(r.event_hour)}:00`;
          const plan  = r.plan === "2h" ? "2 horas" : "1 hora";

          await transporter.sendMail({
            from: `Reservas Toro Mecánico <${fromEmail}>`,
            to: r.email,
            subject: "Su reserva fue rechazada",
            html: `
              <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Noto Sans';color:#0f172a;line-height:1.55">
                <div style="max-width:720px;margin:0 auto;padding:24px 16px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px">
                  <h1 style="margin:0 0 12px;font-size:22px">Su reserva fue rechazada</h1>
                  <p>Estimado/a ${htmlEscape(safe(r.name))},</p>
                  <p>Le informamos que su reserva solicitada para el <strong>${fecha}</strong> a las <strong>${hora} hs</strong> (Plan <strong>${plan}</strong>) ha sido rechazada.</p>
                  <p><strong>Motivo:</strong> ${htmlEscape(reason)}</p>
                  <p>Quedamos a disposición por cualquier consulta.</p>
                </div>
                <p style="max-width:720px;margin:10px auto 0;color:#64748b;font-size:12px">Este correo fue enviado automáticamente por el sistema de reservas.</p>
              </div>`
          });
        }
      }catch(e){ console.error("MAIL CLIENT (reject) ERROR:", e); }

      res.setHeader("Content-Type","text/html; charset=utf-8");
      return res.end(pageWrap({
        title: "Rechazo enviado",
        bodyHtml: `<p>Se notificó al cliente con el motivo indicado.</p>`
      }));
    }catch(e){
      console.error(e);
      return res.status(500).send("Error interno");
    }
  }

  return res.status(405).send("Método no permitido");
}
