// reach-zones.js — Admin: deshabilitar zonas puntuales (por defecto TODO habilitado)

const PROVS = ["CABA", "Buenos Aires"];
const CABA_CIUDAD = ["CABA"];
const BA_CITIES = [
  "Avellaneda","Lanús","Quilmes","Berazategui","Florencio Varela","Lomas de Zamora",
  "Almirante Brown","Esteban Echeverría","Ezeiza","La Matanza","Morón","Ituzaingó",
  "Hurlingham","Merlo","Tres de Febrero","San Martín","Vicente López","San Isidro",
  "San Fernando","Tigre"
];

// DOM
const panel    = document.getElementById("zonesPanel");
const controls = document.getElementById("zonesPanelControls");

if (!panel || !controls) {
  // nada que hacer
} else {
  const selProv = document.getElementById("zoneProv");
  const selCity = document.getElementById("zoneCity");
  const btnAdd  = document.getElementById("btnAddZone");
  const list    = document.getElementById("zonesEnabled");
  const btnSave = document.getElementById("zonesSaveBtn");
  const hint    = document.getElementById("zonesHint");

  let uiDisabled = [];        // [{province, city, active:false}]
  let serverDisabled = new Set(); // "prov||city"
  const key = (p,c) => `${p}||${c}`;

  function msg(t, kind=""){ if(!hint) return; hint.textContent=t||""; hint.className="msg"+(kind?` ${kind}`:""); }
  function fillProvs(){ if(selProv) selProv.innerHTML = PROVS.map(p=>`<option value="${p}">${p}</option>`).join(""); }
  function fillCities(){
    if(!selProv || !selCity) return;
    const src = selProv.value === "CABA" ? CABA_CIUDAD : BA_CITIES;
    selCity.innerHTML = src.map(c=>`<option value="${c}">${c}</option>`).join("");
  }
  function render(){
    if (!list) return;
    list.innerHTML = "";
    if (!uiDisabled.length){
      list.innerHTML = `<span class="muted">No hay zonas deshabilitadas.</span>`;
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

  async function load(){
    try{
      const r = await fetch("/api/reserve?zones=1");
      const d = await r.json();
      const zones = Array.isArray(d?.zones) ? d.zones : [];
      serverDisabled = new Set(zones.filter(z=>z.active===false).map(z=>key(z.province,z.city)));
      uiDisabled = zones.filter(z=>z.active===false).map(z => ({province:z.province, city:z.city, active:false}));
      render(); msg("");
    }catch(e){
      console.warn("No se pudieron cargar zonas:", e);
      render(); msg("No se pudieron cargar zonas.","err");
    }
  }

  async function save(){
    try{
      btnSave && (btnSave.disabled = true);
      msg("Guardando…");
      const uiKeys = new Set(uiDisabled.map(z => key(z.province, z.city)));
      const toFalse = uiDisabled.map(z => ({province:z.province, city:z.city, active:false}));
      const toTrue  = [];
      serverDisabled.forEach(k=>{
        if(!uiKeys.has(k)){
          const [p,c] = k.split("||");
          toTrue.push({province:p, city:c, active:true});
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
      serverDisabled = new Set(uiDisabled.map(z=>key(z.province,z.city)));
      msg("Zonas guardadas.","ok");
    }catch(e){
      console.error("save zones:", e);
      msg("Error guardando zonas","err");
    }finally{
      btnSave && (btnSave.disabled = false);
    }
  }

  btnAdd?.addEventListener("click", () => {
    const p = selProv?.value, c = selCity?.value;
    if(!p || !c) return;
    if (uiDisabled.some(z=>z.province===p && z.city===c)) return;
    uiDisabled.push({province:p, city:c, active:false});
    render();
  });
  btnSave?.addEventListener("click", save);
  selProv?.addEventListener("change", fillCities);

  fillProvs(); fillCities(); render();

  // visibilidad controlada por main.js cuando resuelve admin
  panel.hidden = true;
  if (window.IS_ADMIN === true){ panel.hidden = false; load(); }
  window.addEventListener("admin:ready", (ev)=>{
    const isAdmin = !!ev?.detail?.isAdmin;
    panel.hidden = !isAdmin;
    if (isAdmin) load();
  });
}
