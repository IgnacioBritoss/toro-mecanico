// index.js
process.env.TZ = 'America/Argentina/Buenos_Aires';

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";

// controllers (asegurate que existan los archivos en controllers/)
import * as usuarios from "./controllers/usuarios.js";
import * as reservas from "./controllers/reservas.js";
import * as pagos from "./controllers/pagos.js";

// utils (db exportará pool/query)
import { dbController } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

// Servir contenido estático (frontend)
const publicPath = path.join(process.cwd(), "public");
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
}

// Ruta de prueba / salud
app.get("/api/health", (req, res) => {
  res.json({ ok: true, api: "ToroMecanico", env: process.env.NODE_ENV || "development" });
});

// Rutas Usuarios
app.post("/api/usuarios", usuarios.Crear);
app.get("/api/usuarios", usuarios.Listar);
app.get("/api/usuarios/:id", usuarios.Obtener);
app.post("/api/login", usuarios.Login);

// Rutas Reservas
app.post("/api/reservas", reservas.Crear);                     // crear reserva preliminar
app.get("/api/reservas", reservas.Listar);                     // listar todas (admin)
app.get("/api/usuarios/:id/reservas", reservas.ListarPorUsuario);
app.get("/api/reservas/:id", reservas.Obtener);
app.post("/api/reservas/:id/cancelar", reservas.Cancelar);

// Pagos / Mercado Pago
app.post("/api/pagos/preference", pagos.CreatePreference);     // crea preferencia en MP para una reserva
app.post("/api/pagos/webhook", pagos.MPWebhook);               // webhook para MP

// Fallback: si acceden a / (no API) servir index.html (SPA)
app.get("/", (req, res) => {
  const indexFile = path.join(publicPath, "index.html");
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  return res.json({ ok: true, api: "ToroMecanico" });
});

// Manejo de errores básico
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "internal_server_error" });
});

// Iniciar servidor
const puerto = Number(process.env.PORT || 3000);
app.listen(puerto, () => {
  console.log(`Servidor corriendo en puerto ${puerto} - env: ${process.env.NODE_ENV || "dev"}`);
});
