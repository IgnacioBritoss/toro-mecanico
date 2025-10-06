// controllers/usuarios.js
import { query } from "../db.js";
import jwt from "jsonwebtoken";

export const Crear = async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ ok:false, error:"Email requerido" });
    const q = `INSERT INTO users (email, name) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING *`;
    const r = await query(q, [email, name || null]);
    return res.json({ ok:true, user: r.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false, error: 'db_error' });
  }
};

export const Listar = async (req, res) => {
  try {
    const r = await query('SELECT id, email, name, created_at FROM users ORDER BY created_at DESC');
    return res.json({ ok:true, users: r.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false });
  }
};

export const Obtener = async (req, res) => {
  try {
    const { id } = req.params;
    const r = await query('SELECT id, email, name, created_at FROM users WHERE id=$1', [id]);
    if (r.rows.length === 0) return res.status(404).json({ ok:false, error:'not_found' });
    return res.json({ ok:true, user: r.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false });
  }
};

// Login simple: por email devuelve/crea usuario y da token (si querés)
export const Login = async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ ok:false, error: 'email_required' });
    const r = await query(`INSERT INTO users (email, name) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING *`, [email, name||null]);
    const user = r.rows[0];
    // Generate token (opcional)
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET || 'devsecret', { expiresIn: '30d' });
    return res.json({ ok:true, user, token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false });
  }
};
