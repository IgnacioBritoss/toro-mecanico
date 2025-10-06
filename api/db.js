import pkg from "pg";
const { Pool } = pkg;

// Usa DATABASE_URL de Neon (con ssl=true)
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
