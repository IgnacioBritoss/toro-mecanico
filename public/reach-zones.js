// reach-zones.js  —  Panel de zonas (compatible con tu HTML actual)

// ---------- Config de catálogo (simple y local) ----------
const PROVS = ["CABA", "Buenos Aires"];

// Barrios de CABA (solo los principales para elegir; las villas se bloquean en backend)
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

// Partidos del GBA + algunos cercanos (podés sumar sin tocar el JS del resto)
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

// ---------- state ----------
let enabled = []; // [{province, city}]
let blocks  = {}; // { "CABA||Saavedra": true } (si más adelante agregás bloques por barrio)

// Util
const key = (p, c) => `${p}||${c}`;
const dedup = (arr) => {
  const m=new Map(); arr.forEach(z=>m.set(key(z.province,z.city), {province:z.province, city:z.city, active:true}));
  return [...m.values()];
};
function hint(t, kind=""){ if(!msgEl) return; msgEl.textContent=t||""; msgEl.className="msg"+(kind?` ${kind}`:""); }
function chip(text, onClose){
  const li=document.createElement("li"); li.className="chip";
  li.innerHTML = `${text} <button type="button" class="chip__x" aria-label="Quitar">×</button>`;
  li.querySelector("button").addEventListener("click", onClose);
  return li;
}

// ---------- helpers UI ----------
function fillProvinces(){
  if (!selProv) return;
  selProv.innerHTML = PROVS.map(p=>`<option value="${p}">${p}</option>`).join("");
}
function fillCities(){
  if(!selProv||!selCity) return;
  const prov = selProv.value;
  const list = prov === "CABA" ? CABA_BARRIOS : BA_CITIES;
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
        y no aceptan reservas. Si habilitás una ciudad, igual quedarán excluidas estas áreas por seguridad.
      </p>
    </details>
  `;
}

// ---------- fetch zonas ----------
async function loadZonesFromServer(){
  try{
    const r = await fetch("/api/reserve?zones=1");
    if(!r.ok){ throw new Error(String(r.status)); }
    const data = await r.json();
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.zones) ? data.zones : []);
    enabled = dedup(rows.filter(z => z.active!==false).map(z => ({province: z.province, city: z.city, active:true})));
    renderTags();
    hint("");
  }catch(e){
    console.error("load zones error", e);
    hint("No se pudieron cargar las zonas (intentalo luego).","err");
  }
}

async function saveZonesToServer(){
  try{
    btnSave.disabled = true;
    hint("Guardando…");
    const payload = { zones: dedup(enabled) };
    const r = await fetch("/api/reserve?zones=1", {
      method:"PUT",
      headers:{ "Content-Type":"application/json", "X-Admin":"1" },
      body: JSON.stringify(payload)
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok){ throw new Error(d?.error || String(r.status)); }
    hint("Zonas guardadas.","ok");
  }catch(e){
    console.error("save zones error", e);
    hint("Error guardando zonas","err");
  }finally{
    btnSave.disabled = false;
  }
}

// ---------- eventos ----------
btnAdd?.addEventListener("click", () => {
  const p = selProv?.value; const c = selCity?.value;
  if(!p || !c) return;
  enabled.push({ province:p, city:c, active:true });
  enabled = dedup(enabled);
  renderTags();
});

btnSave?.addEventListener("click", saveZonesToServer);
selProv?.addEventListener("change", fillCities);

// ---------- init ----------
(function init(){
  // Mostrar solo en admin (tu main.js ya setea window.IS_ADMIN luego de chequear)
  if (!panel) return;
  if (!window.IS_ADMIN){ panel.hidden = true; return; }
  panel.hidden = false;

  renderAdvisories();
  fillProvinces();
  fillCities();
  renderTags();
  loadZonesFromServer();
})();
