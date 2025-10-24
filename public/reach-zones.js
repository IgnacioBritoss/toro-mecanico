// reach-zones.js — listas con checkboxes + “Lugares peligrosos” en cajita scrolleable

// ===== Catálogo base =====
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

const BA_PARTIDOS = [
  "Avellaneda","Lanús","Quilmes","Berazategui","Florencio Varela","Lomas de Zamora",
  "Almirante Brown","Esteban Echeverría","Ezeiza","La Matanza","Morón","Ituzaingó",
  "Hurlingham","Merlo","Tres de Febrero","San Martín","Vicente López","San Isidro",
  "San Fernando","Tigre"
];

// ===== DOM =====
const panel   = document.getElementById("zonesPanel");
const controls = document.getElementById("zonesPanelControls");
const btnSave = document.getElementById("zonesSaveBtn");
const hintEl  = document.getElementById("zonesHint");

// ===== Estado =====
let enabled = [];   // [{province:"CABA"|"Buenos Aires", city:"..."}]
let blacklist = []; // villas (solo lectura)

// ===== Utils =====
const key = (p,c)=>`${p}||${c}`;
function hint(t, kind=""){ if(!hintEl) return; hintEl.textContent=t||""; hintEl.className="msg"+(kind?` ${kind}`:""); }
function group(title, id){
  const wrap = document.createElement("div");
  wrap.className = "row";
  wrap.innerHTML = `<h3 style="margin:.5rem 0">${title}</h3><div id="${id}" class="checklist"></div>`;
  return wrap;
}
function checkbox(id,label,checked){
  const div = document.createElement("label");
  div.className = "chk";
  div.innerHTML = `<input type="checkbox" id="${id}" ${checked?"checked":""}/> <span>${label}</span>`;
  return div;
}
function dedup(arr){
  const m=new Map();
  arr.forEach(z => { if(z?.province&&z?.city) m.set(key(z.province,z.city), {province:z.province, city:z.city}); });
  return [...m.values()];
}

// ===== Render =====
function renderLists(){
  if (!controls) return;
  controls.innerHTML = "";

  const gCaba = group("CABA — Barrios", "lstCaba");
  const gGba  = group("Gran Buenos Aires — Partidos", "lstGba");
  controls.appendChild(gCaba);
  controls.appendChild(gGba);

  const lstCaba = gCaba.querySelector("#lstCaba");
  const lstGba  = gGba.querySelector("#lstGba");
  const enabledSet = new Set(enabled.map(z=>key(z.province,z.city)));

  CABA_BARRIOS.forEach(b=>{
    const id=`caba_${b.replace(/\s+/g,"_")}`;
    const node=checkbox(id,b,enabledSet.has(key("CABA",b)));
    node.querySelector("input").addEventListener("change",(e)=>{
      const k=key("CABA",b);
      if(e.target.checked) enabled.push({province:"CABA",city:b});
      else enabled=enabled.filter(z=>key(z.province,z.city)!==k);
      enabled=dedup(enabled);
    });
    lstCaba.appendChild(node);
  });

  BA_PARTIDOS.forEach(p=>{
    const id=`gba_${p.replace(/\s+/g,"_")}`;
    const node=checkbox(id,p,enabledSet.has(key("Buenos Aires",p)));
    node.querySelector("input").addEventListener("change",(e)=>{
      const k=key("Buenos Aires",p);
      if(e.target.checked) enabled.push({province:"Buenos Aires",city:p});
      else enabled=enabled.filter(z=>key(z.province,z.city)!==k);
      enabled=dedup(enabled);
    });
    lstGba.appendChild(node);
  });

  // Cajita scrolleable “Lugares peligrosos”
  const box=document.createElement("div");
  box.className="row";
  box.innerHTML=`
    <h3 style="margin-top:1rem">Lugares peligrosos</h3>
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:8px;max-width:420px;">
      <div style="max-height:6.2rem; overflow:auto;"> 
        <ul id="dangerList" style="margin:0;padding-left:18px">
          ${(blacklist||[]).map(v=>`<li>${v}</li>`).join("")}
        </ul>
      </div>
      <small class="muted">Bloqueados automáticamente (no se pueden habilitar)</small>
    </div>
  `;
  controls.appendChild(box);
}

// ===== Server =====
async function loadFromServer(){
  try{
    const r=await fetch("/api/reserve?zones=1");
    const d=await r.json();

    const came=Array.isArray(d?.zones)?d.zones:[];
    if(came.length){
      enabled=dedup(came.filter(z=>z.active!==false).map(z=>({province:z.province,city:z.city})));
    }else{
      // por defecto TODO habilitado
      enabled=[...CABA_BARRIOS.map(b=>({province:"CABA",city:b})),
               ...BA_PARTIDOS.map(p=>({province:"Buenos Aires",city:p}))];
    }
    blacklist=Array.isArray(d?.blacklist)?d.blacklist:[];
    renderLists();
    hint("");
  }catch(e){
    console.warn("Error cargando zonas:",e);
    hint("No se pudieron cargar zonas.","err");
  }
}

async function saveToServer(){
  try{
    btnSave&&(btnSave.disabled=true);
    hint("Guardando…");
    const r=await fetch("/api/reserve?zones=1",{
      method:"PUT",
      headers:{ "Content-Type":"application/json", "X-Admin":"1" },
      body:JSON.stringify({ zones:dedup(enabled) })
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d?.error||String(r.status));
    hint("Zonas guardadas.","ok");
  }catch(e){
    console.error("PUT zonas:",e);
    hint("Error guardando zonas.","err");
  }finally{
    btnSave&&(btnSave.disabled=false);
  }
}

// ===== Espera admin =====
function waitForAdminReady(maxMs=8000){
  return new Promise(res=>{
    const t0=Date.now();
    (function tick(){
      if(typeof window.IS_ADMIN!=="undefined"){
        if(window.IS_ADMIN || Date.now()-t0>maxMs) return res(Boolean(window.IS_ADMIN));
      }
      setTimeout(tick,100);
    })();
  });
}

// ===== Init =====
async function init(){
  if(!panel) return;
  const isAdmin=await waitForAdminReady();
  if(!isAdmin){ panel.hidden=true; return; }
  panel.hidden=false;
  renderLists();
  await loadFromServer();
  btnSave?.addEventListener("click", saveToServer);
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init); else init();
