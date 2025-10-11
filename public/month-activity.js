// month-activity.js
// Dibuja un listado "Actividad del mes" con los días que tienen reservas.
// No modifica selección ni abre modales. Sólo informa estéticamente.
// Requiere que exista el título del calendario con id="calTitle"
// y los botones #prevMonth / #nextMonth (que ya tenés en main.js).

(function () {
  // ---- helpers de fecha ----
  const pad2 = n => String(n).padStart(2, "0");
  const toInputDate = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const monthNames = {
    "enero":0,"febrero":1,"marzo":2,"abril":3,"mayo":4,"junio":5,
    "julio":6,"agosto":7,"septiembre":8,"setiembre":8,"octubre":9,"noviembre":10,"diciembre":11
  };

  // ---- crea contenedor si no existe ----
  function ensurePanel() {
    let wrap = document.getElementById("activityPanel");
    if (wrap) return wrap;

    // buscamos el contenedor del calendario para insertar debajo
    const calSection = document.getElementById("calendario") || document.querySelector(".section");
    wrap = document.createElement("section");
    wrap.className = "section";
    wrap.id = "activityPanel";
    wrap.innerHTML = `
      <div class="container">
        <h3 class="section__title">Actividad del mes</h3>
        <p class="section__subtitle">Días con reservas</p>
        <div id="activityList" class="act-list"></div>
      </div>
    `;
    (calSection && calSection.parentNode)
      ? calSection.parentNode.insertBefore(wrap, calSection.nextSibling)
      : document.body.appendChild(wrap);
    return wrap;
  }

  // ---- lee mes/año visibles desde el título del calendario ----
  function getVisibleMonthYear() {
    const title = document.getElementById("calTitle");
    if (!title) {
      const now = new Date();
      return { y: now.getFullYear(), m: now.getMonth() };
    }
    const txt = (title.textContent || "").trim().toLowerCase(); // ej: "octubre 2025"
    const parts = txt.split(/\s+/);
    // intenta "mes año", sino cae a fecha actual
    const m = monthNames[parts[0]];
    const y = parseInt(parts[1], 10);
    if (Number.isInteger(m) && Number.isInteger(y)) return { y, m };
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  }

  async function fetchMonthAvailability(y, m) {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    const qs = `start=${toInputDate(start)}&end=${toInputDate(end)}`;
    try {
      const r = await fetch(`/api/availability?${qs}`);
      if (!r.ok) return {};
      const d = await r.json();
      return d?.days || {};
    } catch {
      return {};
    }
  }

  function renderList(daysMap, y, m) {
    const list = document.getElementById("activityList");
    if (!list) return;

    // construimos una lista ordenada de fechas con reservas
    const entries = Object.entries(daysMap)
      .map(([date, info]) => ({ date, count: info?.count || 0, hours: info?.hours || [] }))
      .filter(e => e.count > 0)
      .sort((a,b) => a.date.localeCompare(b.date));

    if (!entries.length) {
      list.innerHTML = `<div class="hint">No hay reservas en este mes.</div>`;
      return;
    }

    // render: fecha + horas (12,14,16…)
    const fmt = (dstr) => {
      const d = new Date(dstr + "T00:00:00");
      // 15/10/2025 (Mié)
      const wd = d.toLocaleDateString("es-AR", { weekday: "short" });
      const dd = String(d.getDate()).padStart(2,"0");
      const mm = String(d.getMonth()+1).padStart(2,"0");
      const yy = d.getFullYear();
      return `${dd}/${mm}/${yy} (${wd})`;
    };

    list.innerHTML = `
      <ul style="list-style:none; padding:0; margin:8px 0; display:grid; gap:8px">
        ${entries.map(e => `
          <li style="background:#fff; border:1px solid var(--border); border-radius:12px; padding:12px">
            <div style="font-weight:800">${fmt(e.date)}</div>
            <div style="margin-top:4px; color:#475569">
              Horas: ${e.hours.length ? e.hours.map(h => `${String(h).padStart(2,'0')}:00`).join(" · ") : "—"}
            </div>
          </li>
        `).join("")}
      </ul>
    `;
  }

  async function refreshPanel() {
    ensurePanel();
    const { y, m } = getVisibleMonthYear();
    const days = await fetchMonthAvailability(y, m);
    renderList(days, y, m);
  }

  // ---- inicia una vez cargado el DOM ----
  document.addEventListener("DOMContentLoaded", () => {
    // pintar al inicio
    refreshPanel();

    // volver a pintar cuando cambie de mes con los botones del calendario
    const prev = document.getElementById("prevMonth");
    const next = document.getElementById("nextMonth");
    const re = () => setTimeout(refreshPanel, 50); // pequeño delay para que el título actualice
    prev && prev.addEventListener("click", re);
    next && next.addEventListener("click", re);

    // por si el mes cambia por otros medios (hash, etc.)
    const title = document.getElementById("calTitle");
    if (title && "MutationObserver" in window) {
      const mo = new MutationObserver(() => refreshPanel());
      mo.observe(title, { childList: true, characterData: true, subtree: true });
    }
  });
})();
