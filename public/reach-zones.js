// reach-zones.js — Panel de zonas con espera de admin listo

// ---------- Catálogo base ----------
const PROVS = ["CABA", "Buenos Aires"];
const CABA_BARRIOS = [
  "Agronomía","Almagro","Balvanera","Barracas","Belgrano","Boedo","Caballito",
  "Chacarita","Coghlan","Colegiales","Constitución","Flores","Floresta",
  "La Boca","La Paternal","Liniers","Mataderos","Montserrat","Monte Castro",
  "Nueva Pompeya","Núñez","Palermo","Parque Avellaneda","Parque Chacabuco",
  "Parque Patricios","Puerto Madero","Recoleta","Retiro","Saavedra","San Cristóbal",
  "San Nicolás","San Telmo","Vélez Sarsfield","Versalles","Villa Crespo","Villa del Parque",
  "Villa Devoto","Villa General Mitre","Villa Lugano","Villa Luro","Villa Ortúzar",
  "Villa Pueyrredón","Villa Real","Villa Riachuelo","Villa Santa Rita","Villa Soldati",
  "Villa Urquiza"
];
const BA_CITIES = [
  "Avellaneda","Lanús","Quilmes","Berazategui","Florencio Varela","Lomas de Zamora",
  "Almirante Brown","Esteban Echeverría","Ezeiza","La Matanza","Morón","Ituzaingó",
  "Hurlingham","Merlo","Tres de Febrero","San Martín","Vicente López","San Isidro",
  "San Fernando","Tigre"
];

// ---------- DOM ----------
const panel   = document.getElementById("reachSection");
const selProv = document.getElementById("reachProvince");
const selCity = document.getElementById("reachCity");
const btnAdd  = document.getElementById("reachAdd");
const tags    = document.getElementById("reachTags");
const btnSave = document.getElementById("reachSave");
const msgEl   = document.getElementById("reachMsg");
const advisEl = document.getElementById("reachAdvisories");

// ---------- State ----------
let enabled = []; // [{province,city,active:true}]

// ---------- Utils ----------
const key = (p, c) => `${p}||${c}`;
const dedup = (arr) => {
  const m=new Map();
  arr.forEach(z => m.set(key(z.province,z.city), {province:z.province, city:z.city, active:true}));
  return [...m.values()];
};
function hint(t, kind=""){ if(!msgEl) return; msgEl.textContent=t||""; msgEl.className="msg"+(kind?` ${kind}`:""); }
function chip(text, onClose){
  const li=document.createElement("li"); li.className="chip";
  li.innerHTML = `${text} <button type="button" class="chip__x" aria-label="Quitar">×</button>`;
  li.querySelector("button").addEventListener("click", onClose);
  return li;
}

// ---------- UI helpers ----------
function fillProvinces(){ if(selProv) selProv.innerHTML = PROVS.map(p=>`<option value="${p}">${p}</option>`).join(""); }
function fillCities(){
  if(!selCity||!selProv) return;
  const list = selProv.value === "CABA" ? CABA_BARRIOS : BA_CITIES;
  selCity.innerHTML = list.map(c=>`<option value="${c}">${c}</option>`).join("");
}
function renderTags(){
  if(!tags){ return; }
  tags.innerHTML = "";
  if(!enabled.length){
    tags.innerHTML = `<span class="muted">No hay zonas habilitadas todavía.</span>`;
    return;
  }
  enabled.forEach(z => {
    tags.appendChild(
      chip(`${z.province} — ${z.city}`, () => {
        enabled = enabled.filter(x => key(x.province,x.city)!==key(z.province,z.city));
        renderTags();
      })
    );
  });
}
function renderAdvisories(){
  if(!advisEl) return;
  advisEl.innerHTML = `
    <details class="advisories">
      <summary>Zonas con restricciones operativas</summary>
      <p class="muted">
        Las <strong>villas de emergencia</strong> de CABA y PBA están <strong>bloqueadas automáticamente</strong>
        por seguridad. Habilitar una ciudad no habilita esas áreas.
      </p>
    </details>
  `;
}

// ---------- Server ----------
async function loadZonesFromServer(){
  try{
    const r = await fetch("/api/reserve?zones=1", { method:"GET" });
    if(!r.ok){ throw new Error(String(r.status)); }
    const data = await r.json();
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.zones) ? data.zones : []);
    enabled = dedup(rows.filter(z => z.active!==false).map(z => ({province:z.province, city:z.city, active:true})));
    renderTags();
    hint("");
  }catch(e){
    console.warn("No se pudieron cargar zonas:", e);
    hint("No se pudieron cargar zonas.","err");
  }
}
async function saveZonesToServer(){
  try{
    btnSave && (btnSave.disabled = true);
    hint("Guardando…");
    const r = await fetch("/api/reserve?zones=1", {
      method:"PUT",
      headers:{ "Content-Type":"application/json", "X-Admin":"1" },
      body: JSON.stringify({ zones: dedup(enabled) })
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok){ throw new Error(d?.error || String(r.status)); }
    hint("Zonas guardadas.","ok");
  }catch(e){
    console.error("Error guardando zonas:", e);
    hint("Error guardando zonas","err");
  }finally{
    btnSave && (btnSave.disabled = false);
  }
}

// ---------- Eventos ----------
btnAdd?.addEventListener("click", () => {
  const p = selProv?.value; const c = selCity?.value;
  if(!p || !c) return;
  enabled.push({ province:p, city:c, active:true });
  enabled = dedup(enabled);
  renderTags();
});
btnSave?.addEventListener("click", saveZonesToServer);
selProv?.addEventListener("change", fillCities);

// ---------- Espera a que main.js determine admin ----------
function waitForAdminReady(maxMs=8000){
  return new Promise((resolve) => {
    const start = Date.now();
    (function tick(){
      // main.js primero define window.IS_ADMIN=false y luego lo actualiza;
      // consideramos "listo" cuando exista la propiedad (aunque sea false),
      // pero además damos tiempo para que cambie a true si corresponde.
      if (typeof window.IS_ADMIN !== "undefined") {
        // si ya es true, listo; si es false y aún hay tiempo, esperamos un poco más
        if (window.IS_ADMIN || (Date.now()-start) > maxMs) return resolve(Boolean(window.IS_ADMIN));
      }
      setTimeout(tick, 100);
    })();
  });
}

// ---------- Init seguro ----------
async function init(){
  if (!panel) return;

  // Esperar a main.js
  const isAdmin = await waitForAdminReady();
  if (!isAdmin) {
    panel.hidden = true;
    hint("Ingresá como admin para editar zonas.","err");
    return;
  }

  // Mostrar panel
  panel.hidden = false;

  renderAdvisories();
  fillProvinces();
  fillCities();
  renderTags();
  await loadZonesFromServer();
}

// DOM listo => iniciar
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
