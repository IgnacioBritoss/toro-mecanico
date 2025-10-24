// reach-zones.js — Panel de zonas (deshabilitar) + suscripción "avisame" sin tocar main.js

// ====================== Config ======================
const PROVS = ["CABA", "Buenos Aires"];
const CABA_CIUDAD = ["CABA"];
const BA_CITIES = [
  "Avellaneda","Lanús","Quilmes","Berazategui","Florencio Varela","Lomas de Zamora",
  "Almirante Brown","Esteban Echeverría","Ezeiza","La Matanza","Morón","Ituzaingó",
  "Hurlingham","Merlo","Tres de Febrero","San Martín","Vicente López","San Isidro",
  "San Fernando","Tigre","San Miguel","Malvinas Argentinas","Berisso","Ensenada"
];

// ====================== DOM refs (panel) ======================
const panel    = document.getElementById("zonesPanel");
const controls = document.getElementById("zonesPanelControls");

const selProv  = document.getElementById("zoneProv");
const selCity  = document.getElementById("zoneCity");
const btnAdd   = document.getElementById("btnAddZone");
const list     = document.getElementById("zonesEnabled");
const btnSave  = document.getElementById("zonesSaveBtn");
const hint     = document.getElementById("zonesHint");

// ====================== Estado ======================
let uiDisabled = [];      // [{province, city, active:false}]
let serverDisabled = new Set(); // keys "prov||city"
const key = (p,c) => `${p}||${c}`;

// ====================== Utils ======================
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
    list.innerHTML = `<span class="muted">Todas las zonas habilitadas (por defecto).</span>`;
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

// ====================== Cargar/Guardar zonas ======================
async function loadZones(){
  try{
    const r = await fetch("/api/reserve?zones=1");
    const d = await r.json();
    const zones = Array.isArray(d?.zones) ? d.zones : [];
    serverDisabled = new Set(
      zones.filter(z => z.active === false).map(z => key(z.province, z.city))
    );
    uiDisabled = zones.filter(z => z.active === false)
                      .map(z => ({ province:z.province, city:z.city, active:false }));
    render(); msg("");
  }catch(e){
    console.warn("No se pudieron cargar zonas:", e);
    render(); msg("No se pudieron cargar zonas.","err");
  }
}

async function saveZones(){
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

    // éxito => snapshot actualiza
    serverDisabled = new Set(uiDisabled.map(z => key(z.province, z.city)));
    msg("Zonas guardadas.","ok");
  }catch(e){
    console.error("Error guardando zonas:", e);
    msg("Error guardando zonas","err");
  }finally{
    if (btnSave) btnSave.disabled = false;
  }
}

// ====================== Eventos UI panel ======================
btnAdd?.addEventListener("click", () => {
  const p = selProv?.value; const c = selCity?.value;
  if (!p || !c) return;
  if (uiDisabled.some(z => z.province===p && z.city===c)) return;
  uiDisabled.push({ province:p, city:c, active:false });
  render();
});
btnSave?.addEventListener("click", saveZones);
selProv?.addEventListener("change", fillCities);

// ====== Ajustes visuales del panel (título y escondemos bloques que no usamos)
(function tweakPanelCopy(){
  if (!panel) return;
  const h2 = panel.querySelector("h2");
  if (h2) h2.textContent = "Deshabilitar zonas";
  // ocultar bloques no deseados si existen en el HTML
  document.getElementById("blocksWrap")?.remove();     // bloqueos por barrio (no usado)
  document.getElementById("villaBlacklist")?.closest(".row")?.remove?.(); // listado villas (solo lectura)
})();

// ====== Init panel (solo si existe en el DOM) ======
if (panel && controls){
  fillProvs(); fillCities(); render();
  // mostrar el panel solo si sos admin (flag global seteado por main.js)
  panel.hidden = !window.IS_ADMIN;
  loadZones();
}

// =============================================================
//          INTERÉS “AVISARME” (NO TOCAR main.js)
//  Intercepta fetch al POST /api/reserve, si devuelve 409 con
//  {can_subscribe:true, province, city, display_name} abre modal,
//  guarda el email y avisa.
// =============================================================

(function interestModalBootstrap(){
  // Construimos el modal por JS para no tocar el HTML
  const overlay = document.createElement("div");
  overlay.id = "interestOverlay";
  overlay.className = "overlay hidden";
  overlay.setAttribute("role","dialog");
  overlay.setAttribute("aria-modal","true");

  overlay.innerHTML = `
    <div class="ov-card" style="max-width:560px">
      <h3 class="ov-title">Por ahora no llegamos</h3>
      <p id="interestLead" class="ov-sub"></p>
      <div class="ov-row">
        <label>Email para avisarte</label>
        <input id="interestEmail" type="email" class="ov-input" placeholder="alguien@ejemplo.com" />
      </div>
      <div class="ov-actions">
        <button id="interestCancel" class="ov-btn ov-ghost" type="button">Cancelar</button>
        <button id="interestSubmit" class="ov-btn" type="button">Avisarme</button>
      </div>
      <div id="interestHint" class="ov-hint"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const el = (id) => overlay.querySelector('#'+id);
  const lead = el("interestLead");
  const input = el("interestEmail");
  const hint  = el("interestHint");
  const btnOk = el("interestSubmit");
  const btnNo = el("interestCancel");

  let lastPayload = null;

  function openInterestModal(payload){
    lastPayload = payload || null;
    hint.textContent = "";
    input.value = (window.fEmail?.value || "").trim(); // si tu form tiene fEmail, lo tomamos
    lead.innerHTML = `Aún no operamos en <strong>${payload.province}</strong> / <strong>${payload.city}</strong>. Te avisamos cuando habilitemos la zona.`;
    overlay.classList.remove("hidden");
    document.body.classList.add("has-admin-overlay"); // reutilizo clase para bloquear scroll
    setTimeout(()=>input.focus(), 50);
  }
  function closeInterestModal(){
    overlay.classList.add("hidden");
    document.body.classList.remove("has-admin-overlay");
  }
  function isValidEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e||""); }

  async function subscribeInterest(){ // POST /api/reserve?interest=1
    try{
      hint.textContent = "";
      const email = (input.value || "").trim().toLowerCase();
      if (!isValidEmail(email)){ hint.textContent = "Ingresá un email válido."; return; }
      if (!lastPayload){ hint.textContent = "Falta la zona."; return; }

      btnOk.disabled = true;
      const r = await fetch("/api/reserve?interest=1", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          email,
          province: lastPayload.province,
          city: lastPayload.city,
          display_name: lastPayload.display_name || ""
        })
      });
      const d = await r.json().catch(()=> ({}));
      if (!r.ok) throw new Error(d?.error || ("HTTP "+r.status));

      hint.textContent = "Listo. Te avisaremos apenas lleguemos a tu zona.";
      setTimeout(closeInterestModal, 1200);
    }catch(e){
      console.error("interest:", e);
      hint.textContent = "Error interno (interest)";
    }finally{
      btnOk.disabled = false;
    }
  }

  btnOk.addEventListener("click", subscribeInterest);
  btnNo.addEventListener("click", closeInterestModal);

  // Exponer por si querés abrir manualmente desde consola.
  window.openInterestModal = openInterestModal;

  // -------- Interceptor de fetch para no tocar main.js ----------
  const origFetch = window.fetch;
  window.fetch = async function(input, init){
    const res = await origFetch(input, init);
    try{
      const isReservePost =
        typeof input === "string" &&
        input.startsWith("/api/reserve") &&
        (init?.method || "GET").toUpperCase() === "POST";

      if (isReservePost && res.status === 409){
        // Clonamos para que el caller aún pueda leer el body
        const clone = res.clone();
        const data = await clone.json().catch(()=>null);
        if (data && data.can_subscribe && data.province && data.city){
          openInterestModal({
            province: data.province,
            city: data.city,
            display_name: data.display_name || ""
          });
        }
      }
    }catch{ /* no-op */ }
    return res;
  };
})();

