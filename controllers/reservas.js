// controllers/reservas.js
import { query } from "../db.js";
import fetch from "node-fetch";

export const Crear = async (req, res) => {
  try {
    // Datos de reserva del frontend
    const {
      user_id, name, email, phone,
      event_type, date, time, address,
      neighborhood, duration
    } = req.body;

    // Validación básica
    if (!date || !time || !email || !name) return res.status(400).json({ ok:false, error:'missing_fields' });

    // calcular monto - ejemplo
    const pricePerHour = Number(process.env.PRICE_PER_HOUR || 25000);
    const total = pricePerHour * (Number(duration || 4));
    const deposit = Math.round(total * 0.3);

    const q = `INSERT INTO reservas
      (user_id, name, email, phone, event_type, date, time, address, neighborhood, duration, deposit_amount)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`;
    const vals = [user_id || null, name, email, phone || null, event_type || null, date, time, address || null, neighborhood || null, duration || 4, deposit];
    const r = await query(q, vals);
    const reserva = r.rows[0];

    // opcional: crear preferencia MP aquí o desde /pagos/preference
    return res.json({ ok:true, reserva });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false, error:'db_error' });
  }
};

export const Listar = async (req, res) => {
  try {
    const r = await query('SELECT * FROM reservas ORDER BY created_at DESC');
    return res.json({ ok:true, reservas: r.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false });
  }
};

export const ListarPorUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const r = await query('SELECT * FROM reservas WHERE user_id=$1 ORDER BY created_at DESC', [id]);
    return res.json({ ok:true, reservas: r.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false });
  }
};

export const Obtener = async (req, res) => {
  try {
    const { id } = req.params;
    const r = await query('SELECT * FROM reservas WHERE id=$1', [id]);
    if (r.rows.length === 0) return res.status(404).json({ ok:false, error:'not_found' });
    return res.json({ ok:true, reserva: r.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false });
  }
};

export const Cancelar = async (req, res) => {
  try {
    const { id } = req.params;
    await query('UPDATE reservas SET cancelled = true WHERE id=$1', [id]);
    return res.json({ ok:true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false });
  }
};
