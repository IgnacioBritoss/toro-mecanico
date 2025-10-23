// public/js/reach-zones.js
(() => {
  // ========= Datos base =========
  // Barrios oficiales de CABA (excluí explícitamente las "villas" del listado visible)
  const CABA_BARRIOS = [
    "Agronomía","Almagro","Balvanera","Barracas","Belgrano","Boedo","Caballito",
    "Chacarita","Coghlan","Colegiales","Constitución","Flores","Floresta","La Boca",
    "La Paternal","Liniers","Mataderos","Monte Castro","Montserrat","Nueva Pompeya",
    "Núñez","Palermo","Parque Avellaneda","Parque Chacabuco","Parque Chas","Parque Patricios",
    "Puerto Madero","Recoleta","Retiro","Saavedra","San Cristóbal","San Nicolás",
    "San Telmo","Vélez Sarsfield","Versalles","Villa Crespo","Villa del Parque",
    "Villa Devoto","Villa General Mitre","Villa Lugano","Villa Luro","Villa Ortúzar",
    "Villa Pueyrredón","Villa Real","Villa Riachuelo","Villa Santa Rita","Villa Soldati",
    "Villa Urquiza"
  ];
  // Partidos de PBA frecuentes + podés agregar más
  const PBA_PARTIDOS = [
    "Avellaneda","Lanús","Quilmes","Lomas de Zamora","Almirante Brown","Esteban Echeverría",
    "Ezeiza","Florencio Varela","Berazategui","Morón","Ituzaingó","Hurlingham","Merlo",
    "La Matanza","Tres de Febrero","San Martín","San Isidro","Vicente López","San Miguel",
    "Malvinas Argentinas","Tigre","San Fernando","Pilar","Escobar","Campana","Zárate",
    "General Rodríguez","Marcos Paz","Cañuelas","Luján","La Plata","Berisso","Ensenada"
  ];

  // Detecta “villas”/barrios populares (no habilitables)
  function isDangerWord(s){
    return /\bvilla[\s\-_.]/i.test(s) ||
           /\bbarrio\s+(popular|de\s+emergencia|carenciado)/i.test(s.toLowerCase()) ||
           /\basentamiento\b/i.test(s) ||
           /\b1-11-14\b|\b21-24\b|\b31\b|\bmugica\b|\bricciardelli\b|\bla\s*cava\b|\bvilla\s*azul\b|\bvilla\s*itat[ií]\b/i.test(s);
  }

  // ========= Estado UI =========
  const reach = document.getElementById("reachSection");
  if (!reach) return;

  const root = document.createElement("div");
  root.className = "card";
  root.innerHTML = `
    <h2>¿Hasta dónde llegamos?</h2>
    <p class="muted">Activá las zonas donde trabajás. Todas las “villas” están bloqueadas por seguridad.</p>

    <div class="tabs">
      <button class="tab on" data-tab="caba">CABA</button>
      <button class="tab" data-tab="pba">Provincia</button>
    </div>

    <div class="reach-boards">
      <div id="board-caba" class="board on"></div>
      <div id="board-pba" class="board"></div>
    </div>

    <div class="row end" style="margin-top:10px">
      <button id="reachSave" class="btn primary">Guardar zonas</button>
      <span id="reachMsg" class="msg"></span>
    </div>

    <details class="advisory" style="margin-top:10px">
      <summary>Zonas con restricciones (bloqueadas)</summary>
      <div id="denyList" class="pill-list"></div>
    </details>
  `;
  reach.replaceChildren(root);

  const tabs = root.querySelectorAll(".tab");
  const boardCABA = root.querySelector("#board-caba");
  const boardPBA  = root.querySelector("#board-pba");
  const saveBtn   = root.querySelector("#reachSave");
  const msgEl     = root.querySelector("#reachMsg");
  const denyList  = root.querySelector("#denyList");

  // dataset → items clickeables
  function renderBoard(host, province, items){
    host.innerHTML = "";
    const ul = document.createElement("ul");
    ul.className = "pill-list";
    items.forEach(name => {
      const li = document.createElement("li");
      const danger = isDangerWord(name);
      li.className = "pill zone-chip";
      li.dataset.province = province;
      li.dataset.city = name;
      li.dataset.locked = danger ? "1" : "0";
      li.dataset.active = "0";
      li.textContent = name;
      if (danger){
        li.classList.add("pill-locked");
        const lock = document.createElement("span");
        lock.setAttribute("aria-hidden","true");
        lock.textContent = " 🔒";
        li.appendChild(lock);
        li.title = "Zona bloqueada por seguridad";
      }else{
        li.addEventListener("click", () => {
          const on = li.dataset.active === "1";
          li.dataset.active = on ? "0" : "1";
          li.classList.toggle("pill-on", !on);
        });
      }
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  // tabs
  tabs.forEach(b => b.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("on"));
    b.classList.add("on");
    const tab = b.dataset.tab;
    boardCABA.classList.toggle("on", tab==="caba");
    boardPBA.classList.toggle("on",  tab==="pba");
  }));

  // carga inicial desde backend
  let current = []; // [{province,city,active}]
  async function fetchZones(){
    try{
      const r = await fetch("/api/reserve?zones=1");
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Error");
      current = Array.isArray(d) ? d : (d.zones||[]);
    }catch(e){
      current = [];
    }
  }

  // marca las zonas activas según DB
  function applyActiveFromDB(){
    const chips = root.querySelectorAll(".zone-chip");
    const set = new Set(current.filter(z=>z.active).map(z => `${z.province}||${z.city}`));
    chips.forEach(ch => {
      const key = `${ch.dataset.province}||${ch.dataset.city}`;
      if (set.has(key) && ch.dataset.locked !== "1"){
        ch.dataset.active = "1";
        ch.classList.add("pill-on");
      }
    });

    // lista de bloqueadas (informativo)
    const denied = [...chips].filter(ch => ch.dataset.locked === "1").map(ch => `${ch.dataset.province} — ${ch.dataset.city}`);
    denyList.innerHTML = denied.map(t => `<span class="pill">${t}</span>`).join("");
  }

  async function saveZones(){
    msgEl.textContent = "";
    const payload = [];
    root.querySelectorAll(".zone-chip").forEach(ch => {
      const province = ch.dataset.province;
      const city     = ch.dataset.city;
      const locked   = ch.dataset.locked === "1";
      const active   = ch.dataset.active === "1";
      // nunca mandamos locked=true como activo
      payload.push({ province, city, active: locked ? false : active });
    });

    try{
      const r = await fetch("/api/reserve?zones=1",{
        method:"PUT",
        headers: { "Content-Type":"application/json", "x-admin":"1" },
        body: JSON.stringify({ zones: payload })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Error guardando");
      msgEl.textContent = "Zonas guardadas";
      msgEl.className = "msg ok";

      // refrescar estado
      await fetchZones();
      render(); // re-pinta
    }catch(e){
      msgEl.textContent = "Error guardando zonas";
      msgEl.className = "msg err";
    }
  }

  function render(){
    renderBoard(boardCABA, "CABA", CABA_BARRIOS);
    renderBoard(boardPBA,  "Buenos Aires", PBA_PARTIDOS);
    applyActiveFromDB();
  }

  saveBtn.addEventListener("click", saveZones);

  // init
  (async () => {
    render();           // pinta primero
    await fetchZones(); // trae DB
    applyActiveFromDB();
  })();
})();
