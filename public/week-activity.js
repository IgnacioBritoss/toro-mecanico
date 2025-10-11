// week-activity.js
// Muestra "Actividad por semanas" bajo el calendario SOLO para admin.

(function(){
  const CAL_ROOT_ID = "calendario"; // sección donde colgamos el bloque

  document.addEventListener("DOMContentLoaded", init);

  async function init(){
    const admin = await isAdmin();
    if (!admin) return; // solo admin

    // Contenedor (si no existe, lo creamos al final de la sección del calendario)
    let host = document.getElementById("weekActivity");
    if (!host){
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

    // Render inicial y cada vez que cambie el mes del calendario
    await renderWeeks();
    hookMonthButtons(renderWeeks);
  }

  // Lee el mes activo desde el título del calendario (ya lo maneja main.js)
  function getActiveMonthRange(){
    // Tomamos activeMonth desde el código global si existe:
    // (main.js define 'activeMonth' en el global scope)
    try{
      const m = window.activeMonth instanceof Date ? new Date(window.activeMonth) : new Date();
      const start = new Date(m.getFullYear(), m.getMonth(), 1);
      const end   = new Date(m.getFullYear(), m.getMonth() + 1, 0);
      return { start, end };
    }catch{
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start, end };
    }
  }

  async function renderWeeks(){
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

    // Agrupar días con reservas por semana (lunes a domingo)
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
      return `
        <article class="card">
          <header class="card__head">
            <h4>${title}</h4>
          </header>
          <ul class="card__list" style="margin-top:6px">
            ${items}
          </ul>
        </article>`;
    }).join("");
  }

  function groupByWeeks(start, end, daysMap){
    const weeks = [];
    // anclamos la semana a LUNES
    const first = new Date(start.getFullYear(), start.getMonth(), 1);
    const firstWeekday = (first.getDay() + 6) % 7; // 0=lun … 6=dom
    let cursor = new Date(first);
    cursor.setDate(cursor.getDate() - firstWeekday); // lunes de la primer semana visible

    // recorremos hasta cubrir todo el mes (incluyendo bordes)
    while (cursor <= end || ((cursor.getDay()+6)%7) !== 0){
      const weekStart = new Date(cursor);
      const weekEnd   = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const label = `${pad2(weekStart.getDate())}/${pad2(weekStart.getMonth()+1)} – ${pad2(weekEnd.getDate())}/${pad2(weekEnd.getMonth()+1)}`;

      const days = [];
      for (let i=0;i<7;i++){
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        if (d.getMonth() !== start.getMonth()) continue; // solo días del mes actual
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

      // paso a la próxima semana
      cursor.setDate(cursor.getDate() + 7);
    }
    return weeks;
  }

  function fmt(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
  function pad2(n){ return String(n).padStart(2,"0"); }

  // igual que en main.js
  async function isAdmin(){
    try{
      const r = await fetch("/api/admin/plans", { method: "GET" });
      return r.status !== 401;
    }catch{ return false; }
  }

  // re-render cuando cambie el mes con las flechas del calendario
  function hookMonthButtons(cb){
    const prev = document.getElementById("prevMonth");
    const next = document.getElementById("nextMonth");
    if (prev) prev.addEventListener("click", () => setTimeout(cb, 50));
    if (next) next.addEventListener("click", () => setTimeout(cb, 50));
  }
})();
