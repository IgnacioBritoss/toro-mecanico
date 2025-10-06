// controllers/pagos.js
import { query } from "../db.js";
import fetch from "node-fetch";
import nodemailer from "nodemailer";

const MP_API = "https://api.mercadopago.com/checkout/preferences";
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;

export const CreatePreference = async (req, res) => {
  try {
    const { reservaId } = req.body;
    if (!reservaId) return res.status(400).json({ ok:false, error:'reserva_id_required' });

    // buscar reserva
    const r = await query('SELECT * FROM reservas WHERE id=$1', [reservaId]);
    if (r.rows.length === 0) return res.status(404).json({ ok:false, error:'reserva_not_found' });
    const reserva = r.rows[0];

    const items = [{
      title: `Seña Reserva #${reserva.id}`,
      quantity: 1,
      currency_id: "ARS",
      unit_price: Number(reserva.deposit_amount)
    }];

    const body = {
      items,
      back_urls: {
        success: process.env.MP_BACK_URL_SUCCESS || process.env.APP_URL || 'http://localhost:3000',
        failure: process.env.MP_BACK_URL_FAILURE || process.env.APP_URL || 'http://localhost:3000'
      },
      notification_url: (process.env.MP_NOTIFICATION_URL || (process.env.APP_URL || 'http://localhost:3000') + '/pagos/webhook')
    };

    const mpRes = await fetch(MP_API, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${MP_TOKEN}` },
      body: JSON.stringify(body)
    });

    const mpData = await mpRes.json();
    if (!mpRes.ok) {
      console.error('MP create pref error', mpData);
      return res.status(500).json({ ok:false, error:'mp_error', detail: mpData });
    }

    await query('UPDATE reservas SET mp_preference_id=$1, mp_init_point=$2 WHERE id=$3', [mpData.id, mpData.init_point, reserva.id]);

    // enviar email con link de pago (opcional)
    await sendEmail({
      to: reserva.email,
      subject: `Completar seña - Reserva #${reserva.id}`,
      text: `Hola ${reserva.name}, pagá la seña aquí: ${mpData.init_point}`
    });

    return res.json({ ok:true, mp: mpData, init_point: mpData.init_point });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false });
  }
};

export const MPWebhook = async (req, res) => {
  try {
    const body = req.body;
    // Mercado Pago puede enviar distintos payloads. Lo correcto en producción:
    // 1) Obtener el payment id / topic del body.
    // 2) Llamar a la API de MP para chequear el payment y su status (approved).
    // Aquí simplificamos: si recibimos preference_id lo usamos.
    const pref = body.preference_id || body.id || (body.data && body.data.id) || null;

    if (!pref) {
      console.log('Webhook sin preference id', body);
      return res.status(200).send('ok');
    }

    // consultar pagos en MP para confirmar (recomendado)
    const detailRes = await fetch(`https://api.mercadopago.com/checkout/preferences/${pref}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` }
    });
    const detail = await detailRes.json();

    // Nota: la preferencia no indica si hay pago aprobado; lo más seguro es consultar /v1/payments/:payment_id
    // Para demo: buscamos booking por pref id
    const r = await query('SELECT * FROM reservas WHERE mp_preference_id=$1', [pref]);
    if (r.rows.length === 0) return res.status(200).send('no booking');

    const reserva = r.rows[0];

    // Marca: aquí deberías verificar que el pago fue aprobado antes de setear paid_deposit true.
    // Simplificamos y marcamos paid_deposit = true si llegamos acá (AJUSTAR para producción).
    await query('UPDATE reservas SET paid_deposit = true WHERE id=$1', [reserva.id]);

    // notificar por email
    await sendEmail({
      to: reserva.email,
      subject: `Seña recibida - Reserva #${reserva.id}`,
      text: `Hemos recibido la seña. Gracias!`
    });
    await sendEmail({
      to: process.env.OWNER_EMAIL,
      subject: `Seña pagada - Reserva #${reserva.id}`,
      text: `Reserva #${reserva.id} pagó la seña.`
    });

    return res.status(200).send('ok');
  } catch (err) {
    console.error(err);
    return res.status(500).send('error');
  }
};

async function sendEmail({ to, subject, text }) {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to, subject, text
    });
  } catch (e) {
    console.error('email error', e);
  }
}
