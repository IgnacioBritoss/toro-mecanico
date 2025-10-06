// db.js
// Helper de conexión a Postgres (estilo Pool)
// Usa variables de entorno para no versionar credenciales.
// Si quieres usar tu string de Neon tal cual puedes setear:
// DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT

import pkg from "pg";
const { Pool } = pkg;

// Si tenés un DATABASE_URL (p. ej. proveedor), se usa primero.
// Si no, se arma desde variables individuales.
const connectionString = process.env.DATABASE_URL || null;

const pool = connectionString ? new Pool({
  connectionString,
  // Neon requiere SSL; si usás otro proveedor activá o quitá SSL según corresponda
  ssl: { rejectUnauthorized: false }
}) : new Pool({
  host: process.env.DB_HOST || "ep-spring-night-acu7toll-pooler.sa-east-1.aws.neon.tech",
  user: process.env.DB_USER || "neondb_owner",
  password: process.env.DB_PASS || "TU_PASSWORD_AQUI",
  database: process.env.DB_NAME || "neondb",
  port: Number(process.env.DB_PORT || 5432),
  ssl: { rejectUnauthorized: false }
});

export const dbController = { pool };

// query helper para usar en controllers
export const query = async (text, params = []) => {
  const client = await dbController.pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
};

// cerrar pool (útil para tests o shutdown)
export const closePool = async () => {
  await dbController.pool.end();
};
