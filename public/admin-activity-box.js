/* Recuadro “Actividad del mes” (solo visual, solo admin)
   - No toca main.js
   - Muestra días con reservas del mes actual y cruces (1 ó 2)
   - Se re-renderiza cuando se vuelve a dibujar el calendario
*/
(function () {
  // ===== estilos inyectados =====
  const css = `
  .act-box{ background:rgba(255,255,255,.9); border:1px solid var(--border,#e2e8f0);
            border-radius:18px; padding:16px; margin-top:16px; }
  .act-head{ font-weight:800; margin:0 0 8px; }
  .act-sub{ color:#64748b; margin:0 0 10px; font-size:14px; }
  .act-list{ list-style:none; margin:0; padding:0; display:grid; gap:8px; }
  .act-item{ display:flex; align-items:center; justify-content:space-between;
             padding:10px 12px; border:1px solid var(--border,#e2e8f0); border-radius:12px;
             background:#fff; }
  .act-date{ font-weight:700; }
  .act-x{ display:flex; gap:6px; align-items:center; }
  .act-x i{ width:16px; height:16px; background:url("/imgproyecto/x.png") center/contain no-repeat; display:inline-block; }
  .act-empty{ color:#64748b; font-size:14px; }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ===== helpers =====
  function ddmm(dateKey){
    const d = new Date(dateKey + "T00:00:00");
    const dd = String(d.getDate()).padStart(2,"0");
    const mm = String(d.getMonth()+1).padStart(2,"0");
    return `${dd}/${mm}`;
  }
  function ensureBox(){
    // debajo del bloque de horarios (panel derecho)
    let box = document.getElementById("monthActivityBox");
    if (box) return box;

    const hoursBox = document.querySelector(".slot");
    if (!hoursBox || !hoursBox.parentElement) return null;

    box = document.createElement("section");
    box.id = "monthActivityBox";
    box.className = "act-box";
    box.innerHTML = `
      <h3 class="act-head">Actividad del mes</h3>
      <p class="act-sub">Días con reservas</p>
      <ul class="act-list" id="actList"></ul>
    `;
    hoursBox.insertAdjacentElement("afterend", box);
    return box;
  }
  async function isAdmin(){
    try{ const r = await fetch("/api/admin/plans",{method:"GET"}); return r.status !== 401; }
    catch{ return false; }
  }

  function renderList(){
    const box = ensureBox();
    if (!box) return;
    const listEl = box.querySelector("#actList");
    if (!listEl) return;

    const avail = (window.availability || {});
    const entries = Object.entries(avail).filter(([,v]) => v && Number(v.count) > 0);
    entries.sort((a,b) => (a[0] < b[0] ? -1 : 1));

    if (!entries.length){
      listEl.innerHTML = `<li class="act-empty">No hay reservas en este mes.</li>`;
      return;
    }

    listEl.innerHTML = entries.map(([key, v]) => {
      const n = Math.min(Number(v.count||0),2);
      const xs = Array.from({length:n}).map(()=>"<i></i>").join("");
      return `
        <li class="act-item">
          <span class="act-date">${ddmm(key)}</span>
          <span class="act-x" title="${n===2?'Doble turno':'Un turno'}">${xs}</span>
        </li>
      `;
    }).join("");
  }

  // ==== Integración mínima (solo admin) ====
  isAdmin().then(ok => {
    const box = ensureBox();
    if (!ok){ if (box) box.style.display = "none"; return; }
    if (box) box.style.display = "";

    // render inicial cuando availability ya esté cargado por main.js
    const kick = () => {
      if (Object.keys(window.availability || {}).length) renderList();
      else requestAnimationFrame(kick);
    };
    kick();

    // parche suave: cuando main.js llame a renderCalendar, volvemos a dibujar la lista
    const oldRender = window.renderCalendar;
    if (typeof oldRender === "function"){
      window.renderCalendar = function(){
        const r = oldRender.apply(this, arguments);
        try{ renderList(); }catch{}
        return r;
      };
    }
  });
})();
