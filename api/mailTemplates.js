// api/mailTemplates.js
// Plantillas y helpers para correos con estilo profesional (Gmail/Outlook-safe)

const TZ = "America/Argentina/Buenos_Aires";

/* -------------------------------------------------------
   Helpers
--------------------------------------------------------*/

/** Devuelve fecha y hora legibles en español (AR) */
function formatDateTimeEs({ date, time }) {
  // date: 'YYYY-MM-DD', time: 'HH:MM'
  const iso = `${date}T${time || "00:00"}:00`;
  const d = new Date(iso);

  const fmtDate = new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const fmtTime = new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  return {
    fecha: cap(fmtDate.format(d)), // "Viernes, 10 de octubre de 2025"
    hora: fmtTime.format(d),       // "20:00"
  };
}

/** Layout base compatible con la mayoría de clientes de email */
function baseEmail({ title, bodyHtml, footerHtml }) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f9ff;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:94%;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;box-shadow:0 8px 24px rgba(15,23,42,.06);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">
          <tr>
            <td style="padding:22px 22px 8px;">
              <h1 style="margin:0;font-size:20px;line-height:1.2;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 22px 18px;">
              ${bodyHtml}
            </td>
          </tr>
          ${
            footerHtml
              ? `<tr><td style="padding:16px 22px 22px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;">${footerHtml}</td></tr>`
              : ""
          }
        </table>
      </td>
    </tr>
  </table>`;
}

/** “Botón” accesible (es un <a> con estilos inline) */
function button({ href, label, variant = "primary" }) {
  const styles =
    variant === "danger"
      ? "background:#dc2626;border-color:#dc2626"
      : "background:#0f172a;border-color:#0f172a";
  return `
  <a href="${href}"
     style="display:inline-block;padding:12px 16px;border-radius:12px;border:1px solid;${styles};color:#fff;text-decoration:none;font-weight:700;">
     ${label}
  </a>`;
}

/** Tabla key/value para listar info prolijamente */
function dataList(items) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 6px;">
    ${items
      .map(
        ([k, v]) => `
      <tr>
        <td style="width:160px;color:#64748b;font-size:14px;padding:0;">${k}</td>
        <td style="font-size:14px;padding:0;"><strong>${escapeHtml(v)}</strong></td>
      </tr>`
      )
      .join("")}
  </table>`;
}

/** Escapa caracteres básicos para evitar sorpresas al insertar texto del usuario */
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* -------------------------------------------------------
   Plantillas
--------------------------------------------------------*/

/** Mail al DUEÑO: nueva reserva + botones Aceptar/Rechazar */
function tplOwnerNewReservation({
  name,
  email,
  phone,
  postal,
  age,
  zone,
  plan,
  priceUsd,
  date,
  time,
  acceptLink,
  rejectLink,
}) {
  const { fecha, hora } = formatDateTimeEs({ date, time });

  const body = `
    <p style="margin:0 0 10px;">Llegó una <strong>nueva reserva</strong>. Revisá los datos y aceptá o rechazá:</p>
    ${dataList([
      ["Nombre", name],
      ["Email", email],
      ["Teléfono", phone],
      ["Código postal", postal],
      ["Edad", `${age} años`],
      ["Localidad", zone],
      ["Fecha", fecha],
      ["Horario", `${hora} hs`],
      ["Plan", `${plan} — USD ${priceUsd}`],
    ])}
    <div style="margin-top:16px;display:flex;gap:10px;">
      ${button({ href: acceptLink, label: "Aceptar" })}
      ${button({ href: rejectLink, label: "Rechazar", variant: "danger" })}
    </div>
  `;

  const footer =
    "Este mensaje se envió automáticamente desde el sistema de reservas de Toro Mecánico.";

  return {
    subject: `Nueva reserva — ${fecha} ${hora} hs`,
    html: baseEmail({ title: "Nueva reserva", bodyHtml: body, footerHtml: footer }),
  };
}

/** Mail al CLIENTE: recibimos la solicitud */
function tplClientReceived({ name, date, time, plan }) {
  const { fecha, hora } = formatDateTimeEs({ date, time });
  const body = `
    <p style="margin:0 0 10px;">Hola ${escapeHtml(name)},</p>
    <p style="margin:0 0 10px;">Recibimos tu solicitud para el <strong>${fecha}</strong> a las <strong>${hora} hs</strong> (plan <strong>${escapeHtml(
    plan
  )}</strong>).</p>
    <p style="margin:0;">En el siguiente paso vas a poder confirmar y ver el pago de seña.</p>
  `;
  return {
    subject: `Reserva recibida — ${fecha} ${hora} hs`,
    html: baseEmail({ title: "Recibimos tu solicitud", bodyHtml: body }),
  };
}

/** Mail al CLIENTE: reserva aceptada/confirmada */
function tplClientAccepted({ name, date, time, plan }) {
  const { fecha, hora } = formatDateTimeEs({ date, time });
  const body = `
    <p style="margin:0 0 10px;">Hola ${escapeHtml(name)},</p>
    <p style="margin:0 0 10px;">¡Tu reserva fue <strong>confirmada</strong>!</p>
    ${dataList([
      ["Fecha", fecha],
      ["Horario", `${hora} hs`],
      ["Plan", escapeHtml(plan)],
    ])}
    <p style="margin:12px 0 0;">Gracias por elegirnos. Te vamos a escribir por cualquier coordinación adicional.</p>
  `;
  return {
    subject: `Reserva confirmada — ${fecha} ${hora} hs`,
    html: baseEmail({ title: "Reserva confirmada", bodyHtml: body }),
  };
}

/** Mail al CLIENTE: reserva rechazada (sin emojis) */
function tplClientRejected({ name, reason, date, time }) {
  const { fecha, hora } = formatDateTimeEs({ date, time });
  const cleanReason = String(reason || "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "") // quita emojis
    .trim();

  const body = `
    <p style="margin:0 0 10px;">Hola ${escapeHtml(name)},</p>
    <p style="margin:0 0 10px;">Lamentamos informarte que no podemos tomar la reserva del <strong>${fecha}</strong> a las <strong>${hora} hs</strong>.</p>
    ${
      cleanReason
        ? `<p style="margin:0 0 10px;">Motivo: <strong>${escapeHtml(
            cleanReason
          )}</strong>.</p>`
        : ""
    }
    <p style="margin:0;">Si querés, podés responder este correo para coordinar otra fecha u horario.</p>
  `;
  return {
    subject: `Reserva no disponible — ${fecha} ${hora} hs`,
    html: baseEmail({ title: "No pudimos tomar la reserva", bodyHtml: body }),
  };
}

module.exports = {
  // helpers
  formatDateTimeEs,
  baseEmail,
  button,
  dataList,
  // templates
  tplOwnerNewReservation,
  tplClientReceived,
  tplClientAccepted,
  tplClientRejected,
};
