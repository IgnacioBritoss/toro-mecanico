// public/reach-zones.js
// Panel "Deshabilitar zonas" y helper de interés de zona.

// ===== Listas de selección
const PROVS = ["CABA", "Buenos Aires"];

// Barrios detallados CABA
const CABA_BARRIOS = [
  "Agronomía","Almagro","Balvanera","Barracas","Belgrano","Boedo","Caballito",
  "Chacarita","Coghlan","Colegiales","Constitución","Flores","Floresta",
  "La Boca","La Paternal","Liniers","Mataderos","Monte Castro","Monserrat",
  "Nueva Pompeya","Núñez","Palermo","Parque Avellaneda","Parque Chacabuco",
  "Parque Chas","Parque Patricios","Puerto Madero","Recoleta","Retiro",
  "Saavedra","San Cristóbal","San Nicolás","San Telmo","Versalles",
  "Villa Crespo","Villa del Parque","Villa Devoto","Villa General Mitre",
  "Villa Lugano","Villa Luro","Villa Ortúzar","Villa Pueyrredón","Villa Real",
  "Villa Riachuelo","Villa Santa Rita","Villa Soldati","Villa Urquiza"
];

// Partidos del corredor principal de AMBA (podés ampliar)
const BA_CITIES = [
  "Avellaneda","Lanús","Quilmes","Berazategui","Florencio Varela","Lomas de Zamora",
  "Almirante Brown","Esteban Echeverría","Ezeiza","La Matanza","Morón","Ituzaingó",
  "Hurlingham","Merlo","Tres de Febrero","San Martín","Vicente López","San Isidro",
  "San Fernando","Tigre","Berisso","Ensenada","Malvinas Argentinas","San Miguel"
];

// ===== DOM
const panel    = document.getElementById("zonesPanel");
const controls = document.getElementById("zonesPanelControls");

if (panel && controls) {
  const titleH2 = panel.querySelector("h2");
  if (titleH2) titleH2.textContent = "Deshabilitar zonas";

  const selProv = document.getElementById("zoneProv");
  const selCity = document.getElementById("zoneCity");
  const btnAdd  = document.getElementById("btnAddZone");
  const list    = document.getElementById("zonesEnabled");
  const btnSave = document.getElementById("zonesSaveBtn");
  const hint    = document.getElementById("zonesHint");

  // Estado
  let uiDisabled = [];            // [{province, city, active:false}]
  let serverDisabled = new Set(); // keys "prov||city"
  const key = (p,c) => `${p}||${c}`;

  // Utils UI
  function msg(t, kind=""){ if(!hint) return; hint.textContent=t||""; hint.className="msg"+(kind?` ${kind}`:""); }
  function fillProvs(){
    if (!selProv) return;
    selProv.innerHTML = PROVS.map(p=>`<option value="${p}">${p}</option>`).join("");
  }
  function fillCities(){
    if(!selProv || !selCity) return;
    const src = selProv.value === "CABA" ? CABA_BARRIOS : BA_CITIES;
    selCity.innerHTML = src.map(c=>`<option value="${c}">${c}</option>`).join("");
  }
  function render(){
    if (!list) return;
    list.innerHTML = "";
    if (!uiDisabled.length){
      list.innerHTML = `<span class="muted">Todas las zonas habilitadas por defecto.</span>`;
      return;
    }
    uiDisabled.forEach(z => {
      const li = document.createElement("li");
      li.className = "chip";
      li.innerHTML = `${z.province} — ${z.city} <button type="button" class="chip__x" aria-label="Quitar">×</button>`;
      li.querySelector("button").addEventListener("click", () => {
        uiDisabled = uiDisabled.filter(x => !(x.province===z.province && x.city===z.city));
        render();
      });
      list.appendChild(li);
    });
  }

  // Cargar snapshot desde server
  async function load(){
    try{
      const r = await fetch("/api/reserve?zones=1");
      const d = await r.json();
      const zones = Array.isArray(d?.zones) ? d.zones : [];
      serverDisabled = new Set(
        zones.filter(z => z.active === false).map(z => key(z.province, z.city))
      );
      uiDisabled = zones
        .filter(z => z.active === false)
        .map(z => ({ province:z.province, city:z.city, active:false }));
      render();
      msg("");
    }catch(e){
      console.warn("No se pudieron cargar zonas:", e);
      render();
      msg("No se pudieron cargar zonas.","err");
    }
  }

  // Guardar: deshabilitar lo que quede en UI, re-habilitar lo que se quitó
  async function save(){
    try{
      if (btnSave) btnSave.disabled = true;
      msg("Guardando…");
      const uiKeys = new Set(uiDisabled.map(z => key(z.province, z.city)));

      const toFalse = uiDisabled.map(z => ({ province:z.province, city:z.city, active:false }));
      const toTrue  = [];
      serverDisabled.forEach(k => {
        if (!uiKeys.has(k)){
          const [p,c] = k.split("||");
          toTrue.push({ province:p, city:c, active:true });
        }
      });

      const payload = { zones: [...toFalse, ...toTrue] };
      const r = await fetch("/api/reserve?zones=1", {
        method:"PUT",
        headers:{ "Content-Type":"application/json", "X-Admin":"1" },
        body: JSON.stringify(payload)
      });
      const d = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(d?.error || String(r.status));

      // actualizar snapshot
      serverDisabled = new Set(uiDisabled.map(z => key(z.province, z.city)));
      msg("Zonas guardadas.","ok");
    }catch(e){
      console.error("Error guardando zonas:", e);
      msg("Error guardando zonas","err");
    }finally{
      if (btnSave) btnSave.disabled = false;
    }
  }

  btnAdd?.addEventListener("click", () => {
    const p = selProv?.value; const c = selCity?.value;
    if (!p || !c) return;
    if (uiDisabled.some(z => z.province===p && z.city===c)) return; // evita duplicados
    uiDisabled.push({ province:p, city:c, active:false });
    render();
  });
  btnSave?.addEventListener("click", save);
  selProv?.addEventListener("change", fillCities);

  // Init
  fillProvs();
  fillCities();
  render();
  panel.hidden = !window.IS_ADMIN;   // lo setea main.js
  load();
}

/* ===========================================================
   Modal para interés de zona (para usar desde main.js)
   Uso sugerido en main.js ante 409 con can_subscribe:
   window.handleZoneBlocked?.(data)
=========================================================== */
window.handleZoneBlocked = function handleZoneBlocked(data){
  const province = data?.province || "";
  const city     = data?.city || "";
  const displayName = data?.display_name || "";

  // Overlay simple (reusa estilos del admin overlay)
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="ov-card" style="max-width:520px">
      <h3 class="ov-title">Por ahora no llegamos</h3>
      <p class="ov-sub">Aún no operamos en <strong>${province} / ${city}</strong>. Te avisamos cuando habilitemos la zona.</p>
      <div class="ov-row">
        <label>Email para avisarte</label>
        <input id="interestEmail" type="email" class="ov-input" placeholder="tu@email.com" />
      </div>
      <div class="ov-actions">
        <button id="interestCancel" class="ov-btn ov-ghost" type="button">Cancelar</button>
        <button id="interestSave" class="ov-btn" type="button">Avisarme</button>
      </div>
      <div id="interestHint" class="ov-hint"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('has-admin-overlay');

  const emailInput = overlay.querySelector('#interestEmail');
  const hint = overlay.querySelector('#interestHint');
  // si existe el campo de email del form, lo precargo
  try{
    const fEmail = document.getElementById("fEmail");
    if (fEmail?.value) emailInput.value = fEmail.value;
  }catch{}

  overlay.querySelector('#interestCancel').addEventListener('click', () => {
    document.body.classList.remove('has-admin-overlay');
    overlay.remove();
  });

  overlay.querySelector('#interestSave').addEventListener('click', async () => {
    const email = (emailInput.value || '').trim();
    if (!email){ hint.textContent = 'Ingresá un email.'; return; }
    try{
      const r = await fetch('/api/reserve?interest=1', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ email, province, city, display_name: displayName })
      });
      const d = await r.json();
      if (!r.ok){ hint.textContent = d?.error || 'No se pudo guardar.'; return; }
      hint.textContent = 'Listo. Te avisamos cuando lleguemos a tu zona.';
      setTimeout(() => {
        document.body.classList.remove('has-admin-overlay');
        overlay.remove();
      }, 1200);
    }catch{
      hint.textContent = 'Error de red.';
    }
  });
};
