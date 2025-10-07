// ======= Config =======
const MAX_PER_DAY = 2;
const HOURS = [12, 14, 16, 18, 20, 22];

let activeMonth = (() => { const n=new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); })();
let selectedDate = null;
let selectedHour = 18;
let availability = {};
let lastReservation = null; // { id, token }

// DOM
const calTitle = document.getElementById("calTitle");
const calGrid = document.getElementById("calGrid");
const prevMonthBtn = document.getElementById("prevMonth");
const nextMonthBtn = document.getElementById("nextMonth");
const hourList = document.getElementById("hourList");
const summaryText = document.getElementById("summaryText");
const goToFormBtn = document.getElementById("goToForm");

const reserveForm = document.getElementById("reserveForm");
const fName = document.getElementById("fName");
const fEmail = document.getElementById("fEmail");
const fPhone = document.getElementById("fPhone");
const fPostal = document.getElementById("fPostal");
const fAge = document.getElementById("fAge");
const fLocality = document.getElementById("fLocality");
const fMsg = document.getElementById("fMsg");
const formDate = document.getElementById("formDate");
const formTime = document.getElementById("formTime");
const formHint = document.getElementById("formHint");

// Paso 2 + Pago
const secondStepBlock = document.getElementById("secondStepBlock");
const secondStepBtn = document.getElementById("secondStepBtn");
const secondStepHint = document.getElementById("secondStepHint");
const paymentBlockManual = document.getElementById("paymentBlockManual");
const mpButtonWrap = document.getElementById("mp-button-wrap"); // contenedor del script embebido (si existe)
const mpLink1ars = document.getElementById("mp-link-1ars");     // fallback link mpago.li
const payWarn = document.getElementById("payWarn");

// ---- helpers fecha/hora
function pad2(n){ return String(n).padStart(2,"0"); }
function toInputDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function toLocaleDate(d){ try{ return d.toLocaleDateString("es-AR"); }catch{ return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`; } }
function sameDay(a,b){ return a?.getFullYear()===b?.getFullYear() && a?.getMonth()===b?.getMonth() && a?.getDate()===b?.getDate(); }

// --- Bloquear edición directa de Fecha/Hora en el form ---
function lockDateTimeFields() {
  if (!formDate || !formTime) return;

  const blockEv = (e) => e.preventDefault();
  ["keydown","keypress","keyup","wheel","paste","cut","contextmenu","beforeinput","input"].forEach(ev => {
    formDate.addEventListener(ev, blockEv);
    formTime.addEventListener(ev, blockEv);
  });

  formDate.style.pointerEvents = "none";
  formTime.style.pointerEvents = "none";
}

function setFormDateTimeFromSelection() {
  if (selectedDate) formDate.value = toInputDate(selectedDate);
  if (selectedHour) formTime.value = `${pad2(selectedHour)}:00`;
}

document.addEventListener("DOMContentLoaded", async () => {
  lockDateTimeFields();                  // bloquear edición en el form
  await fetchAvailabilityForMonth(activeMonth);
  renderCalendar(); renderHours(); updateSummary();
  setFormDateTimeFromSelection();        // por si ya hay selección

  prevMonthBtn?.addEventListener("click", async () => {
    activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() - 1, 1);
    await fetchAvailabilityForMonth(activeMonth); renderCalendar();
  });
  nextMonthBtn?.addEventListener("click", async () => {
    activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 1);
    await fetchAvailabilityForMonth(activeMonth); renderCalendar();
  });

  goToFormBtn?.addEventListener("click", () => {
    setFormDateTimeFromSelection(); // aseguramos sincronización
    document.getElementById("reserva").scrollIntoView({ behavior:"smooth" });
  });

  reserveForm?.addEventListener("submit", onSubmitReservation);
  secondStepBtn?.addEventListener("click", onSecondStep);
});

// --------- calendario/horas/summary ----------
function buildMonthGrid(baseDate){
  const y=baseDate.getFullYear(), m=baseDate.getMonth();
  const first=new Date(y,m,1); const firstW=(first.getDay()+6)%7;
  const days=new Date(y,m+1,0).getDate();
  const cells=[]; for(let i=0;i<firstW;i++) cells.push(null);
  for(let d=1; d<=days; d++) cells.push(new Date(y,m,d));
  while(cells.length%7!==0) cells.push(null);
  return cells;
}
async function fetchAvailabilityForMonth(date){
  const start=new Date(date.getFullYear(), date.getMonth(), 1);
  const end=new Date(date.getFullYear(), date.getMonth()+1, 0);
  const qs=`start=${toInputDate(start)}&end=${toInputDate(end)}`;
  try{
    const res=await fetch(`/api/availability?${qs}`);
    availability = res.ok ? (await res.json()).days || {} : {};
  }catch{ availability = {}; }
}
function renderCalendar(){
  const grid = buildMonthGrid(activeMonth);
  if (calTitle) calTitle.textContent = `${activeMonth.toLocaleString("es-AR",{month:"long"})} ${activeMonth.getFullYear()}`;
  calGrid.innerHTML = "";
  grid.forEach(d=>{
    const btn=document.createElement("button");
    btn.className="cal__day";
    if(!d){ btn.classList.add("cal__day--muted"); btn.disabled=true; }
    else{
      const key = toInputDate(d);
      const info = availability[key] || {count:0, hours:[]};
      const full = info.count >= MAX_PER_DAY;
      btn.textContent = d.getDate();
      if(full){ btn.classList.add("cal__day--full"); btn.disabled=true; }
      else{
        if(selectedDate && sameDay(d,selectedDate)) btn.classList.add("cal__day--selected");
        btn.addEventListener("click", ()=>{
          selectedDate=d; formDate.value=toInputDate(d);
          const taken=new Set((availability[key]?.hours)||[]);
          if(taken.has(selectedHour)){
            const free=HOURS.find(h=>!taken.has(h));
            if(free){ selectedHour=free; formTime.value=`${pad2(free)}:00`; }
          }
          renderCalendar(); renderHours(); updateSummary();
        });
      }
    }
    calGrid.appendChild(btn);
  });
}
function renderHours(){
  hourList.innerHTML = "";
  const key = selectedDate ? toInputDate(selectedDate) : null;
  const info = key ? (availability[key] || {count:0, hours:[]}) : {count:0, hours:[]};
  const taken = new Set(info.hours||[]);
  const full = info.count >= MAX_PER_DAY;
  HOURS.forEach(h=>{
    const b=document.createElement("button");
    b.textContent=`${h}:00`; b.className="slot__btn";
    const disabled = full || taken.has(h);
    if(disabled){ b.classList.add("slot__btn--disabled"); b.disabled=true; b.title=full?"Día completo":"Ocupado"; }
    else{
      if(h===selectedHour) b.classList.add("slot__btn--active");
      b.addEventListener("click",()=>{ selectedHour=h; formTime.value=`${pad2(h)}:00`; renderHours(); updateSummary(); });
    }
    hourList.appendChild(b);
  });
}
function updateSummary(){
  const dateStr = selectedDate ? toLocaleDate(selectedDate) : "Elegí un día";
  summaryText && (summaryText.textContent = `${dateStr} • ${pad2(selectedHour)}:00 hs`);
}

// =======================
// UBICACIÓN DEL EVENTO
// (Leaflet + Nominatim)
// =======================
const fAddress    = document.getElementById("fAddress");
const addrSuggest = document.getElementById("addrSuggest");
const addrMapEl   = document.getElementById("addrMap");

const addrLat     = document.getElementById("addr_lat");
const addrLng     = document.getElementById("addr_lng");
const addrDisplay = document.getElementById("addr_display");
const addrOsmId   = document.getElementById("addr_osm_id");

// Centro inicial (CABA) + sesgo a AMBA
const START = { lat: -34.6037, lng: -58.3816, zoom: 13 };
// west, north, east, south
const VIEWBOX = "-58.9,-34.2,-57.9,-34.9";
const USE_VIEWBOX = true;

let addrMap, addrMarker, debounceTimer = null, selectedIndex = -1, currentData = [];

function ensureMapVisible(){
  if (!addrMapEl) return;
  if (addrMapEl.classList.contains("hidden")) {
    addrMapEl.classList.remove("hidden");
  }
  if (!addrMap && window.L){
    addrMap = L.map('addrMap').setView([START.lat, START.lng], START.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(addrMap);

    addrMarker = L.marker([START.lat, START.lng], { draggable: true }).addTo(addrMap);
    addrMarker.on('dragend', () => {
      const { lat, lng } = addrMarker.getLatLng();
      setHidden(lat, lng, addrDisplay?.value || "", addrOsmId?.value || "");
    });

    setTimeout(() => addrMap.invalidateSize(), 50);
  } else if (addrMap) {
    setTimeout(() => addrMap.invalidateSize(), 50);
  }
}

function fetchSuggest(q){
  const base = 'https://nominatim.openstreetmap.org/search';
  const params = new URLSearchParams({
    q, format: 'jsonv2', addressdetails: '1',
    countrycodes: 'ar', limit: '6', 'accept-language': 'es'
  });
  if (USE_VIEWBOX){ params.append('viewbox', VIEWBOX); params.append('bounded','1'); }

  fetch(`${base}?${params.toString()}`, { headers: { 'Accept': 'application/json' } })
    .then(r => r.json())
    .then(showSuggest)
    .catch(() => hideSuggest());
}

function showSuggest(list){
  currentData = list || [];
  if (!addrSuggest) return;
  if (!currentData.length) { hideSuggest(); return; }
  addrSuggest.innerHTML = currentData.map((it, i) =>
    `<div class="s-item${i===0?' active':''}" data-i="${i}" role="option">${esc(it.display_name||'')}</div>`
  ).join('');
  selectedIndex = 0;
  addrSuggest.classList.remove("hidden");
  [...addrSuggest.querySelectorAll('.s-item')].forEach(div => {
    div.addEventListener('mousedown', () => {
      const i = Number(div.getAttribute('data-i'));
      choose(currentData[i]);
    });
  });
}

function hideSuggest(){
  if (!addrSuggest) return;
  addrSuggest.classList.add("hidden");
  addrSuggest.innerHTML = '';
  currentData = [];
  selectedIndex = -1;
}

function moveActive(delta){
  const items = addrSuggest ? [...addrSuggest.querySelectorAll('.s-item')] : [];
  if (!items.length) return;
  selectedIndex = (selectedIndex + delta + items.length) % items.length;
  items.forEach((el, idx) => el.classList.toggle('active', idx === selectedIndex));
  items[selectedIndex].scrollIntoView({ block: 'nearest' });
}

function choose(item){
  hideSuggest();
  ensureMapVisible();
  const nice = item.display_name || '';
  const lat = Number(item.lat), lng = Number(item.lon);
  if (fAddress) fAddress.value = nice;
  setHidden(lat, lng, nice, item.osm_id || '');
  if (addrMarker) addrMarker.setLatLng([lat, lng]);
  if (addrMap) addrMap.setView([lat, lng], 18);
}

function setHidden(lat, lng, displayName, osmId){
  if (addrLat) addrLat.value = lat ?? '';
  if (addrLng) addrLng.value = lng ?? '';
  if (addrDisplay) addrDisplay.value = displayName ?? '';
  if (addrOsmId) addrOsmId.value = osmId ?? '';
}

function esc(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Eventos del input
fAddress?.addEventListener('input', () => {
  const q = fAddress.value.trim();
  if (debounceTimer) clearTimeout(debounceTimer);
  if (q.length < 3) { hideSuggest(); return; }
  debounceTimer = setTimeout(() => { ensureMapVisible(); fetchSuggest(q); }, 320);
});
fAddress?.addEventListener('keydown', (e) => {
  if (!addrSuggest || addrSuggest.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown'){ e.preventDefault(); moveActive(1); }
  else if (e.key === 'ArrowUp'){ e.preventDefault(); moveActive(-1); }
  else if (e.key === 'Enter'){ e.preventDefault(); if (selectedIndex>=0) choose(currentData[selectedIndex]); }
  else if (e.key === 'Escape'){ hideSuggest(); }
});

// --------- enviar reserva ----------
async function onSubmitReservation(e){
  e.preventDefault();
  const payload = {
    name: fName.value.trim(),
    email: fEmail.value.trim(),
    phone: fPhone.value.trim(),
    postal_code: fPostal.value.trim(),
    age: parseInt(fAge.value,10),
    zone: fLocality.value.trim(),
    message: fMsg.value.trim(),
    date: formDate.value,
    time: formTime.value,
    plan: (document.querySelector('input[name="plan"]:checked')||{}).value || "1h",

    // NUEVO: ubicación precisa
    location: {
      address: (document.getElementById('fAddress')?.value || '').trim(),
      lat: Number(addrLat?.value || 0),
      lng: Number(addrLng?.value || 0),
      display_name: addrDisplay?.value || '',
      osm_id: addrOsmId?.value || ''
    }
  };

  if(!payload.name||!payload.email||!payload.age||!payload.date||!payload.time||!payload.zone||!payload.phone||!payload.postal_code){
    formHint.textContent="Completá todos los campos."; return;
  }
  if(payload.age<18){ formHint.textContent="Solo mayores de 18 años."; return; }

  // Ubicación requerida
  if (!payload.location.lat || !payload.location.lng || !payload.location.display_name){
    formHint.textContent = "Indicá la dirección y elegí una sugerencia para fijar el punto en el mapa.";
    document.getElementById('fAddress')?.focus();
    return;
  }

  try{
    const res=await fetch("/api/reserve",{ method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(payload) });
    const data=await res.json();
    if(!res.ok){ formHint.textContent=data.error||"No se pudo procesar la reserva."; return; }

    lastReservation = { id: data.reservation?.id, token: data.token };
    formHint.textContent="Reserva enviada. Ahora seguí el segundo paso.";
    reserveForm.reset();

    // Limpiar ubicación en ocultos y re-ocultar mapa (opcional)
    setHidden('', '', '', '');
    addrMapEl?.classList.add('hidden');

    // Mostrar bloque de segundo paso y ocultar pago (hasta que confirme)
    secondStepBlock.classList.remove("hidden");
    secondStepHint.textContent="";
    paymentBlockManual.classList.add("hidden");

    await fetchAvailabilityForMonth(activeMonth);
    renderCalendar(); renderHours(); updateSummary();
  }catch{
    formHint.textContent="Error de red. Intentá nuevamente.";
  }
}

// --------- segundo paso ----------
async function onSecondStep(){
  if(!lastReservation?.id || !lastReservation?.token){
    secondStepHint.textContent="No encontramos tu reserva. Volvé a enviarla.";
    return;
  }
  secondStepBtn.disabled = true;
  secondStepHint.textContent = "Avisando al dueño...";

  try{
    const r = await fetch("/api/confirm-step",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ id:lastReservation.id, token:lastReservation.token })
    });
    const d = await r.json();

    // Mostramos SIEMPRE el bloque de pago y ocultamos el de segundo paso
    secondStepBlock.classList.add("hidden");
    paymentBlockManual.classList.remove("hidden");

    // Limpieza del contenedor embebido y del link
    if (mpButtonWrap) mpButtonWrap.innerHTML = "";
    if (mpLink1ars) {
      mpLink1ars.classList.add("hidden");
      mpLink1ars.textContent = "Señar $1 con Mercado Pago";
    }
    payWarn.textContent = "";

    if(!r.ok){
      payWarn.textContent = d.error || "No se pudo preparar el pago.";
      secondStepBtn.disabled=false;
      return;
    }

    // 1) Si hay preference, renderizamos el botón embebido oficial
    if (d.mpPreferenceId && mpButtonWrap){
      const s = document.createElement("script");
      s.src = "https://www.mercadopago.com.ar/integrations/v1/web-payment-checkout.js";
      s.dataset.preferenceId = d.mpPreferenceId;
      s.dataset.source = "button";
      mpButtonWrap.appendChild(s);
    }

    // 2) Fallback: si hay link mpago.li lo mostramos
    if (d.payLink && mpLink1ars){
      mpLink1ars.href = d.payLink;
      mpLink1ars.classList.remove("hidden");
    }

    // 3) Si no hay nada configurado, avisamos
    if (!d.mpPreferenceId && !d.payLink){
      payWarn.textContent = "Falta configurar MP_PREFERENCE_ID o MP_LINK_1ARS en Vercel.";
    }

    secondStepHint.textContent = "Listo. Abajo tenés el botón para señar.";
  }catch{
    secondStepHint.textContent="Error de red. Probá de nuevo.";
    secondStepBtn.disabled=false;
  }
}


// ===== Nice Select (Custom) - FIX =====
(function initNiceSelect(){
  const wrap = document.querySelector('.nice-select-wrap');
  if(!wrap) return;

  const sel  = wrap.querySelector('select');
  const btn  = wrap.querySelector('.nice-select-display');
  const list = wrap.querySelector('.nice-select-list');
  const text = wrap.querySelector('.nice-select-text');

  function buildList(){
    list.innerHTML = '';
    Array.from(sel.options).forEach((opt) => {
      const li = document.createElement('li');
      const v = opt.getAttribute('value') ?? opt.textContent.trim();
      li.dataset.value = v;
      li.textContent = opt.textContent;
      li.setAttribute('role','option');
      if (opt.selected) li.setAttribute('aria-selected','true');

      li.addEventListener('click', () => {
        setSelectValue(v);
        close();
        btn.focus();
      });

      list.appendChild(li);
    });
  }

  function setSelectValue(v){
    let foundIndex = -1;
    for (let i=0; i<sel.options.length; i++){
      if (sel.options[i].value === v){
        foundIndex = i;
        break;
      }
    }
    if (foundIndex === -1){
      for (let i=0; i<sel.options.length; i++){
        if (sel.options[i].textContent.trim() === v){
          foundIndex = i;
          break;
        }
      }
    }
    if (foundIndex !== -1){
      sel.selectedIndex = foundIndex;
      sel.dispatchEvent(new Event('input',  {bubbles:true}));
      sel.dispatchEvent(new Event('change', {bubbles:true}));
      syncFromSelect();
    }
  }

  function syncFromSelect(){
    const v = sel.value;
    const opt = sel.options[sel.selectedIndex] || sel.options[0];
    text.textContent = opt ? opt.textContent : 'Elegí tu zona';
    wrap.classList.toggle('is-empty', !v);

    const items = list.querySelectorAll('li');
    items.forEach(li => {
      li.toggleAttribute('aria-selected', li.dataset.value === v ||
        li.textContent.trim() === v);
    });
  }

  function open(){
    btn.setAttribute('aria-expanded','true');
    document.addEventListener('click', onDoc, { capture:true });
    document.addEventListener('keydown', onKey);
  }
  function close(){
    btn.setAttribute('aria-expanded','false');
    document.removeEventListener('click', onDoc, { capture:true });
    document.removeEventListener('keydown', onKey);
  }
  function toggle(){ (btn.getAttribute('aria-expanded') === 'true') ? close() : open(); }
  function onDoc(e){ if (!wrap.contains(e.target)) close(); }
  function onKey(e){ if (e.key === 'Escape') close(); }

  btn.addEventListener('click', toggle);
  sel.addEventListener('change', syncFromSelect);

  buildList();
  syncFromSelect();
})();
