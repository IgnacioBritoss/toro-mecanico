import pg from "pg";
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Opcionales (no rompen si no están definidos)
  application_name: "toro-mecanico",
  statement_timeout: process.env.PG_STATEMENT_TIMEOUT ? Number(process.env.PG_STATEMENT_TIMEOUT) : undefined,
  idle_in_transaction_session_timeout: process.env.PG_IDLE_TX_TIMEOUT ? Number(process.env.PG_IDLE_TX_TIMEOUT) : undefined
});
