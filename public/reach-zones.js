// reach-zones.js — panel mínimo de zonas

const PROVS = ["CABA", "Buenos Aires"];
const CABA_BARRIOS_O_CIUDAD = ["CABA"]; // en CABA solo aparece "CABA"
const BA_CITIES = [
  "Avellaneda","Lanús","Quilmes","Berazategui","Florencio Varela","Lomas de Zamora",
  "Almirante Brown","Esteban Echeverría","Ezeiza","La Matanza","Morón","Ituzaingó",
  "Hurlingham","Merlo","Tres de Febrero","San Martín","Vicente López","San Isidro",
  "San Fernando","Tigre"
];

const panel = document.getElementById("zonesPanel");
const controls = document.getElementById("zonesPanelControls");
if (panel && controls){
  const selProv = document.getElementById("zoneProv");
  const selCity = document.getElementById("zoneCity");
  const btnAdd  = document.getElementById("btnAddZone");
  const list    = document.getElementById("zonesEnabled");
  const btnSave = document.getElementById("zonesSaveBtn");
  const hint    = document.getElementById("zonesHint");

  let enabled = []; // {province, city, active:true}

  function fillProvs(){ selProv.innerHTML = PROVS.map(p=>`<option value="${p}">${p}</option>`).join(""); }
  function fillCities(){
    const p = selProv.value;
    const src = p === "CABA" ? CABA_BARRIOS_O_CIUDAD : BA_CITIES;
    selCity.innerHTML = src.map(c=>`<option value="${c}">${c}</option>`).join("");
  }
  function chip(z){
    const li = document.createElement("li");
    li.className = "chip";
    li.innerHTML = `${z.province} — ${z.city} <button type="button" class="chip__x" aria-label="Deshabilitar zona">×</button>`;
    li.querySelector("button").addEventListener("click", () => {
      enabled = enabled.filter(x => !(x.province===z.province && x.city===z.city));
      render();
    });
    return li;
  }
  function render(){
    list.innerHTML = "";
    if (!enabled.length){
      list.innerHTML = `<span class="muted">Todas las zonas habilitadas (por defecto).</span>`;
      return;
    }
    enabled.forEach(z => list.appendChild(chip(z)));
  }
  function msg(t, kind=""){ hint.textContent=t||""; hint.className = "msg" + (kind?` ${kind}`:""); }

  async function load(){
    try{
      const r = await fetch("/api/reserve?zones=1");
      const d = await r.json();
      const zones = Array.isArray(d?.zones) ? d.zones : [];
      // Solo mostramos las que están activas=false (deshabilitadas)
      enabled = zones.filter(z => z.active === false).map(z => ({province:z.province, city:z.city, active:false}));
      render();
    }catch{ render(); }
  }
  async function save(){
    try{
      btnSave.disabled = true; msg("Guardando…");
      // Mandamos únicamente las que querés DESHABILITAR con active=false.
      const payload = { zones: enabled.map(z => ({ province:z.province, city:z.city, active:false })) };
      const r = await fetch("/api/reserve?zones=1", {
        method:"PUT", headers:{ "Content-Type":"application/json", "X-Admin":"1" }, body: JSON.stringify(payload)
      });
      const d = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(d?.error || String(r.status));
      msg("Listo.","ok");
    }catch(e){ msg("No se pudo guardar.","err"); }
    finally{ btnSave.disabled = false; }
  }

  btnAdd?.addEventListener("click", () => {
    const p = selProv.value, c = selCity.value;
    if (!p || !c) return;
    if (enabled.some(z => z.province===p && z.city===c)) return;
    enabled.push({ province:p, city:c, active:false });
    render();
  });
  btnSave?.addEventListener("click", save);
  selProv?.addEventListener("change", fillCities);

  // init
  fillProvs(); fillCities(); render(); load();
  panel.hidden = !window.IS_ADMIN; // lo muestra solo si sos admin
}
