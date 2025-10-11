// week-activity.js
// 1) "Actividad por semanas" (solo admin)
// 2) Colorear calendario según disponibilidad (para todos)

(function(){
  const CAL_ROOT_ID = "calendario"; // anclaje visual del bloque
  document.addEventListener("DOMContentLoaded", init);

  async function init(){
    // Colores del calendario: SIEMPRE (admin y público)
    await paintCalendarForCurrentMonth();
    hookMonthButtons(paintCalendarForCurrentMonth);

    // Bloque "Actividad por semanas": SOLO admin
    const admin = await isAdmin();
    if (!admin) return;

    let host = document.getElementById("weekActivity");
    if (!host){
      const calSection = document.getElementById(CAL_ROOT_ID) || document.body;
      host = document.createElement("section");
      host.id = "weekActivity";
      host.className = "section";
      host.innerHTML = `
        <div class="container">
          <div class="section__header" style="margin-bottom:12px">
            <div>
              <h3 class="section__title" style="margin-bottom:2px">Actividad por semanas</h3>
              <p class="section__subtitle">Días con reservas en este mes</p>
            </div>
          </div>
          <div id="weekActivityBody"></div>
        </div>`;
      calSection.appendChild(host);
    }

    await renderWeeksCompact();
    hookMonthButtons(renderWeeksCompact);
  }

  /* ----------------------------------------------------------
   *  COLORES EN EL CALENDARIO (para todos)
   * -------------------------------------------------------- */
  async function paintCalendarForCurrentMonth(){
    const { start, end } = getActiveMonthRange();
    const qs = `start=${fmt(start)}&end=${fmt(end)}`;
    let days = {};
    try{
      const r = await fetch(`/api/availability?${qs}`);
      if (r.ok){
        const d = await r.json();
        days = d.days || {};
      }
    }catch{}

    paintCalendarCells(days);
  }

  function paintCalendarCells(daysMap){
    const grid = document.getElementById("calGrid");
    if (!grid) return;

    // limpieza previa (por si venimos de otro mes)
    [...grid.children].forEach(btn => {
      if (!(btn instanceof HTMLElement)) return;
      btn.style.background = "";
      btn.style.borderColor = "";
      btn.style.boxShadow = "";
    });

    // Reconstruimos fechas reales en función de activeMonth y el orden de los botones
    const base = getActiveMonthSafe();
    const year = base.getFullYear();
    const month = base.getMonth();
    const daysInMonth = new Date(year, month+1, 0).getDate();

    // Tomar solo las celdas "reales" (las que no tienen .cal__day--muted)
    const realCells = [...grid.children].filter(el => el.classList && !el.classList.contains("cal__day--muted"));
    // En teoría hay daysInMonth celdas "reales"
    const today = truncateDay(new Date());
    const cutoff = addDays(truncateDay(new Date()), 4); // hoy + 4 (bloquea pasado, hoy y 3 días)

    for (let i=0; i<Math.min(realCells.length, daysInMonth); i++){
      const btn = realCells[i];
      if (!(btn instanceof HTMLElement)) continue;

      const dateObj = new Date(year, month, i+1);
      const key = fmt(dateObj);

      const info = daysMap[key] || { count: 0, hours: [] };
      const count = Number(info.count) || 0;

      // bloqueado por "lead time" (pasado / hoy / 3 siguientes)
      const blocked = dateObj < cutoff;

      // Pintamos:
      // - 0 reservas y NO bloqueado => verde suave
      // - 1 reserva => ámbar suave
      // - 2 reservas => rojo suave
      // - bloqueados => sin color
      if (!blocked && count === 0){
        setCellSoftColor(btn, "green");
      } else if (count === 1){
        setCellSoftColor(btn, "amber");
      } else if (count >= 2){
        setCellSoftColor(btn, "red");
      }
    }

    function setCellSoftColor(el, kind){
      // tonos muy suaves, sólo para sugerir
      const palettes = {
        green: { bg: "rgba(34,197,94,.12)",  border:"#c7f2d2" },
        amber: { bg: "rgba(245,158,11,.12)", border:"#fde68a" },
        red:   { bg: "rgba(239,68,68,.12)",  border:"#fecaca" },
      };
      const p = palettes[kind] || palettes.green;
      el.style.background   = p.bg;
      el.style.borderColor  = p.border;
      el.style.boxShadow    = "inset 0 0 0 1px " + p.border;
    }
  }

  /* ----------------------------------------------------------
   *  ACTIVIDAD POR SEMANAS (SOLO ADMIN)
   * -------------------------------------------------------- */
  async function renderWeeksCompact(){
    const body = document.getElementById("weekActivityBody");
    if (!body) return;

    body.innerHTML = `<p class="hint">Cargando…</p>`;

    const { start, end } = getActiveMonthRange();
    const qs = `start=${fmt(start)}&end=${fmt(end)}`;
    let data = {};
    try{
      const r = await fetch(`/api/availability?${qs}`);
      if (r.ok){
        const d = await r.json();
        data = d.days || {};
      }
    }catch{}

    const weeks = groupByWeeks(start, end, data);
    if (!weeks.length){
      body.innerHTML = `<p class="hint">No hay reservas en este mes.</p>`;
      return;
    }

    body.innerHTML = weeks.map((w, i) => {
      const items = w.days.length
        ? w.days.map(d => {
            const hours = (d.hours || []).map(h => `${h}:00`).join(", ");
            return `<li><strong>${d.dd}/${d.mm}</strong> — ${hours || "sin hora cargada"}</li>`;
          }).join("")
        : `<li class="hint">Sin actividad</li>`;

      const title = `Semana ${i+1} (${w.label})`;

      // Ajuste de padding/espaciado inline (compacto)
      return `
        <article class="card" style="padding:12px 16px;margin:12px 0 14px">
          <header class="card__head" style="margin-bottom:8px">
            <h4 style="margin:0">${title}</h4>
          </header>
          <ul class="card__list" style="margin:6px 0 4px">
            ${items}
          </ul>
        </article>`;
    }).join("");
  }

  function groupByWeeks(start, end, daysMap){
    const weeks = [];
    const first = new Date(start.getFullYear(), start.getMonth(), 1);
    const firstWeekday = (first.getDay() + 6) % 7; // 0=lun … 6=dom
    let cursor = new Date(first);
    cursor.setDate(cursor.getDate() - firstWeekday); // lunes de la primer semana visible

    while (cursor <= end || ((cursor.getDay()+6)%7) !== 0){
      const weekStart = new Date(cursor);
      const weekEnd   = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const label = `${pad2(weekStart.getDate())}/${pad2(weekStart.getMonth()+1)} – ${pad2(weekEnd.getDate())}/${pad2(weekEnd.getMonth()+1)}`;

      const days = [];
      for (let i=0;i<7;i++){
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        if (d.getMonth() !== start.getMonth()) continue; // sólo días del mes actual
        const key = fmt(d);
        const info = daysMap[key];
        if (info && Number(info.count) > 0){
          days.push({
            date: d,
            dd: pad2(d.getDate()),
            mm: pad2(d.getMonth()+1),
            hours: Array.isArray(info.hours) ? info.hours : []
          });
        }
      }
      if (days.length){ weeks.push({ label, days }); }
      cursor.setDate(cursor.getDate() + 7);
    }
    return weeks;
  }

  /* ----------------------------------------------------------
   *  Utils
   * -------------------------------------------------------- */
  function getActiveMonthSafe(){
    try{
      return (window.activeMonth instanceof Date) ? new Date(window.activeMonth) : new Date();
    }catch{ return new Date(); }
  }
  function getActiveMonthRange(){
    const m = getActiveMonthSafe();
    const start = new Date(m.getFullYear(), m.getMonth(), 1);
    const end   = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    return { start, end };
  }
  function truncateDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
  function addDays(d, n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

  function fmt(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
  function pad2(n){ return String(n).padStart(2,"0"); }

  async function isAdmin(){
    try{
      const r = await fetch("/api/admin/plans", { method: "GET" });
      return r.status !== 401;
    }catch{ return false; }
  }

  function hookMonthButtons(cb){
    const prev = document.getElementById("prevMonth");
    const next = document.getElementById("nextMonth");
    if (prev) prev.addEventListener("click", () => setTimeout(cb, 50));
    if (next) next.addEventListener("click", () => setTimeout(cb, 50));
  }
})();
