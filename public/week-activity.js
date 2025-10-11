// week-activity.js
// 1) "Actividad por semanas" (solo admin) — compacto y con separación
// 2) Colores en el calendario para TODOS: por ahora días sin eventos => verde muy claro.

(function () {
  const CAL_ROOT_ID = "calendario"; // donde colgamos el bloque de semanas

  document.addEventListener("DOMContentLoaded", () => {
    // 1) Colores del calendario (para todos)
    initCalendarColors();

    // 2) Bloque "Actividad por semanas" (solo admin)
    initWeeksForAdmin();
  });

  /* =========================
   *  A) COLORES DEL CALENDARIO
   * ========================= */
  function initCalendarColors() {
    // repinta ahora y cada vez que el calendario se regenere
    recolorCalendar();

    // observar cambios en la grilla del calendario (main.js la reconstruye)
    const grid = document.getElementById("calGrid");
    if (grid) {
      const mo = new MutationObserver(() => recolorCalendar());
      mo.observe(grid, { childList: true, subtree: false });
    }

    // cuando se cambia de mes con las flechas
    hookMonthButtons(() => setTimeout(recolorCalendar, 30));
  }

  function recolorCalendar() {
    const grid = document.getElementById("calGrid");
    if (!grid) return;

    const avail = (window && window.availability) || {};
    const m = window.activeMonth instanceof Date ? window.activeMonth : new Date();
    const y = m.getFullYear();
    const mo = m.getMonth();

    [...grid.children].forEach((btn) => {
      if (!btn || !btn.classList || btn.classList.contains("cal__day--muted")) return;

      // reconstruyo la fecha de ese botón a partir del número de día que muestra
      const dayNum = parseInt(btn.textContent.trim(), 10);
      if (!Number.isFinite(dayNum)) return;

      const d = new Date(y, mo, dayNum);
      const key = fmt(d);
      const info = avail[key];

      // limpiamos estilos inline previos
      btn.style.background = "";
      btn.style.borderColor = "";
      btn.style.boxShadow = "";

      // Solo coloreamos los días válidos del mes (no "muted") y que NO estén llenos
      // Primer estado pedido: "sin reservas" => verde muy claro
      if (!info || Number(info.count || 0) === 0) {
        // verde MUY apagado
        btn.style.background = "rgba(46, 160, 67, 0.10)";
        btn.style.borderColor = "rgba(46, 160, 67, 0.25)";
      }
      // En siguientes iteraciones podemos sumar más estados/colores:
      // - un turno tomado (amarillo pálido)
      // - día completo (rojo muy claro)
      // etc.
    });
  }

  /* =========================
   *  B) ACTIVIDAD POR SEMANAS (ADMIN)
   * ========================= */
  async function initWeeksForAdmin() {
    const admin = await isAdmin();
    if (!admin) return;

    let host = document.getElementById("weekActivity");
    if (!host) {
      const calSection = document.getElementById(CAL_ROOT_ID) || document.body;
      host = document.createElement("section");
      host.id = "weekActivity";
      host.className = "section";
      host.innerHTML = `
        <div class="container">
          <div class="section__header">
            <div>
              <h3 class="section__title">Actividad por semanas</h3>
              <p class="section__subtitle">Días con reservas en este mes</p>
            </div>
          </div>
          <div id="weekActivityBody"></div>
        </div>`;
      calSection.appendChild(host);
    }

    await renderWeeks();
    hookMonthButtons(renderWeeks);
  }

  function getActiveMonthRange() {
    try {
      const m = window.activeMonth instanceof Date ? new Date(window.activeMonth) : new Date();
      const start = new Date(m.getFullYear(), m.getMonth(), 1);
      const end = new Date(m.getFullYear(), m.getMonth() + 1, 0);
      return { start, end };
    } catch {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start, end };
    }
  }

  async function renderWeeks() {
    const body = document.getElementById("weekActivityBody");
    if (!body) return;

    body.innerHTML = `<p class="hint">Cargando…</p>`;

    const { start, end } = getActiveMonthRange();
    const qs = `start=${fmt(start)}&end=${fmt(end)}`;
    let data = {};
    try {
      const r = await fetch(`/api/availability?${qs}`);
      if (r.ok) {
        const d = await r.json();
        data = d.days || {};
      }
    } catch {}

    const weeks = groupByWeeks(start, end, data);

    if (!weeks.length) {
      body.innerHTML = `<p class="hint">No hay reservas en este mes.</p>`;
      return;
    }

    // Tarjetas compactas y separadas (inline styles para garantizar el cambio sin tocar CSS global)
    body.innerHTML = weeks
      .map((w, i) => {
        const items = w.days.length
          ? w.days
              .map((d) => {
                const hours = (d.hours || []).map((h) => `${h}:00`).join(", ");
                return `<li><strong>${d.dd}/${d.mm}</strong> — ${hours || "sin hora cargada"}</li>`;
              })
              .join("")
          : `<li class="hint">Sin actividad</li>`;
        const title = `Semana ${i + 1} (${w.label})`;
        return `
          <article class="card" style="padding:14px 16px; margin-bottom:12px;">
            <header class="card__head" style="margin-bottom:8px;">
              <h4 style="margin:0;font-size:18px">${title}</h4>
            </header>
            <ul class="card__list" style="margin:6px 0 0 18px;">
              ${items}
            </ul>
          </article>`;
      })
      .join("");
  }

  function groupByWeeks(start, end, daysMap) {
    const weeks = [];
    const first = new Date(start.getFullYear(), start.getMonth(), 1);
    const firstWeekday = (first.getDay() + 6) % 7; // 0=lun … 6=dom
    let cursor = new Date(first);
    cursor.setDate(cursor.getDate() - firstWeekday); // lunes de la primera semana visible

    while (cursor <= end || ((cursor.getDay() + 6) % 7) !== 0) {
      const weekStart = new Date(cursor);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const label = `${pad2(weekStart.getDate())}/${pad2(weekStart.getMonth() + 1)} – ${pad2(
        weekEnd.getDate()
      )}/${pad2(weekEnd.getMonth() + 1)}`;

      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        if (d.getMonth() !== start.getMonth()) continue; // solo días del mes actual
        const key = fmt(d);
        const info = daysMap[key];
        if (info && Number(info.count) > 0) {
          days.push({
            date: d,
            dd: pad2(d.getDate()),
            mm: pad2(d.getMonth() + 1),
            hours: Array.isArray(info.hours) ? info.hours : [],
          });
        }
      }

      if (days.length) weeks.push({ label, days });
      cursor.setDate(cursor.getDate() + 7);
    }
    return weeks;
  }

  function fmt(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  async function isAdmin() {
    try {
      const r = await fetch("/api/admin/plans", { method: "GET" });
      return r.status !== 401;
    } catch {
      return false;
    }
  }

  function hookMonthButtons(cb) {
    const prev = document.getElementById("prevMonth");
    const next = document.getElementById("nextMonth");
    if (prev) prev.addEventListener("click", () => setTimeout(cb, 50));
    if (next) next.addEventListener("click", () => setTimeout(cb, 50));
  }
})();
