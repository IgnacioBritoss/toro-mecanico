// reach-zones.js — compatible con index.html provisto (IDs: zonesPanel, zoneProv, ...)

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

// ---------- DOM (IDs del HTML actual) ----------
const panel = document.getElementById("zonesPanel");

const selProv = document.getElementById("zoneProv");
const selCity = document.getElementById("zoneCity");
const btnAddZone = document.getElementById("btnAddZone");
const chipsZones = document.getElementById("zonesEnabled");

const blocksWrap = document.getElementById("blocksWrap");
const blkCitySelect = document.getElementById("blkCitySelect");
const blkInput = document.getElementById("blkInput");
const blkAddBtn = document.getElementById("blkAddBtn");
const blkList = document.getElementById("blkList");

const villaList = document.getElementById("villaBlacklist");

const btnSave = document.getElementById("zonesSaveBtn");
const hintEl = document.getElementById("zonesHint");

// ---------- State ----------
let zonesEnabled = [];   // [{province, city, active:true}]
let blocks = [];         // [{province, city, neighborhood, active:false}]
let blacklist = [];      // ["villa 31", ...] (solo lectura)

// ---------- Utils ----------
const keyZone = (p, c) => `${p}||${c}`;
const keyBlock = (p, c, n) => `${p}||${c}||${n}`.toLowerCase();

function dedupZones(arr){
  const m = new Map();
  arr.forEach(z => {
    if (!z?.province || !z?.city) return;
    m.set(keyZone(z.province, z.city), {province:z.province, city:z.city, active: z.active!==false});
  });
  return [...m.values()];
}
function dedupBlocks(arr){
  const m = new Map();
  arr.forEach(b => {
    if (!b?.province || !b?.city || !b?.neighborhood) return;
    m.set(keyBlock(b.province, b.city, b.neighborhood), {
      province:b.province, city:b.city, neighborhood:b.neighborhood, active:false
    });
  });
  return [...m.values()];
}
function hint(t, kind=""){ if(!hintEl) return; hintEl.textContent = t||""; hintEl.className = "msg"+(kind?` ${kind}`:""); }
function chip(text, onClose){
  const li = document.createElement("li");
  li.className = "chip";
  li.innerHTML = `${text} <button type="button" class="chip__x" aria-label="Quitar">×</button>`;
  li.querySelector("button").addEventListener("click", onClose);
  return li;
}

// ---------- UI ----------
function fillProvinces(){
  if (!selProv) return;
  selProv.innerHTML = PROVS.map(p=>`<option value="${p}">${p}</option>`).join("");
}
function fillCities(){
  if (!selCity || !selProv) return;
  const list = selProv.value === "CABA" ? CABA_BARRIOS : BA_CITIES;
  selCity.innerHTML = list.map(c=>`<option value="${c}">${c}</option>`).join("");
}
function fillBlkCitySelect(){
  if (!blkCitySelect) return;
  // Para bloqueos: "CABA" (para barrios de capital) + todos los partidos del GBA
  blkCitySelect.innerHTML = [`<option value="CABA">CABA</option>`]
    .concat(BA_CITIES.map(c=>`<option value="${c}">${c}</option>`))
    .join("");
}

function renderZones(){
  if (!chipsZones) return;
  chipsZones.innerHTML = "";
  if (!zonesEnabled.length){
    chipsZones.innerHTML = `<span class="muted">No hay zonas habilitadas todavía.</span>`;
    return;
  }
  zonesEnabled.forEach(z => {
    chipsZones.appendChild(
      chip(`${z.province} — ${z.city}`, () => {
        zonesEnabled = zonesEnabled.filter(x => keyZone(x.province, x.city) !== keyZone(z.province, z.city));
        renderZones();
      })
    );
  });
}

function renderBlocks(){
  if (!blkList) return;
  blkList.innerHTML = "";
  if (!blocks.length){
    blkList.innerHTML = `<span class="muted">No hay barrios bloqueados.</span>`;
    return;
  }
  blocks.forEach(b => {
    blkList.appendChild(
      chip(`${b.city} — ${b.neighborhood}`, () => {
        blocks = blocks.filter(x => keyBlock(x.province,x.city,x.neighborhood) !== keyBlock(b.province,b.city,b.neighborhood));
        renderBlocks();
      })
    );
  });
}

function renderBlacklist(){
  if (!villaList) return;
  villaList.innerHTML = "";
  if (!blacklist.length){
    villaList.innerHTML = `<li class="muted">—</li>`;
    return;
  }
  blacklist.forEach(v => {
    const li = document.createElement("li");
    li.textContent = v;
    villaList.appendChild(li);
  });
}

// ---------- Server ----------
async function loadFromServer(){
  try{
    const r = await fetch("/api/reserve?zones=1", { method: "GET" });
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();

    zonesEnabled = dedupZones((d?.zones || []).filter(z => z.active!==false));
    blocks       = dedupBlocks(d?.blocks || []);
    blacklist    = Array.isArray(d?.blacklist) ? d.blacklist : [];

    renderZones();
    renderBlocks();
    renderBlacklist();
    hint("");
  }catch(e){
    console.warn("No se pudieron cargar zonas/bloqueos:", e);
    hint("No se pudieron cargar zonas.","err");
  }
}

async function saveToServer(){
  try{
    btnSave && (btnSave.disabled = true);
    hint("Guardando…");
    const r = await fetch("/api/reserve?zones=1", {
      method: "PUT",
      headers: { "Content-Type":"application/json", "X-Admin":"1" },
      body: JSON.stringify({ zones: dedupZones(zonesEnabled), blocks: dedupBlocks(blocks) })
    });
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d?.error || String(r.status));
    hint("Zonas guardadas.","ok");
  }catch(e){
    console.error("Error guardando:", e);
    hint("Error guardando zonas/bloqueos","err");
  }finally{
    btnSave && (btnSave.disabled = false);
  }
}

// ---------- Eventos ----------
btnAddZone?.addEventListener("click", () => {
  const p = selProv?.value;
  const c = selCity?.value;
  if (!p || !c) return;
  zonesEnabled.push({ province:p, city:c, active:true });
  zonesEnabled = dedupZones(zonesEnabled);
  renderZones();
});

blkAddBtn?.addEventListener("click", () => {
  const citySel = blkCitySelect?.value;
  const neigh = (blkInput?.value || "").trim();
  if (!citySel || !neigh) return;
  const province = citySel === "CABA" ? "CABA" : "Buenos Aires";
  const city = citySel;
  blocks.push({ province, city, neighborhood: neigh, active:false });
  blocks = dedupBlocks(blocks);
  blkInput.value = "";
  renderBlocks();
});

btnSave?.addEventListener("click", saveToServer);
selProv?.addEventListener("change", fillCities);

// ---------- Esperar a que main.js determine admin ----------
function waitForAdminReady(maxMs=8000){
  return new Promise((resolve) => {
    const start = Date.now();
    (function tick(){
      if (typeof window.IS_ADMIN !== "undefined") {
        if (window.IS_ADMIN || (Date.now()-start) > maxMs) return resolve(Boolean(window.IS_ADMIN));
      }
      setTimeout(tick, 100);
    })();
  });
}

// ---------- Init ----------
async function init(){
  if (!panel) return;

  const isAdmin = await waitForAdminReady();
  if (!isAdmin) {
    panel.hidden = true;
    return; // si no es admin, no mostramos nada (coincide con tu UI)
  }

  panel.hidden = false;
  fillProvinces();
  fillCities();
  fillBlkCitySelect();
  renderZones();
  renderBlocks();
  renderBlacklist();
  await loadFromServer();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
