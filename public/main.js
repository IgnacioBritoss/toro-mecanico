// ================================
// Config & estado base
// ================================
const MAX_PER_DAY = 2;
const HOURS = [12, 14, 16, 18, 20, 22];

let activeMonth = (() => { const n=new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); })();
let selectedDate = null;
let selectedHour = 18;
let availability = {};
let lastReservation = null; // { id, token }

// ================================
// Utilidades
// ================================
function pad2(n){ return String(n).padStart(2,"0"); }
function toInputDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function toLocaleDate(d){ try{ return d.toLocaleDateString("es-AR"); }catch{ return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`; } }
function sameDay(a,b){ return a?.getFullYear()===b?.getFullYear() && a?.getMonth()===b?.getMonth() && a?.getDate()===b?.getDate(); }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function getQS(name){ return new URLSearchParams(location.search).get(name); }

// ================================
// Admin session helpers
// ================================
function hasAdminSession(){
  return /(?:^|;\s*)admin_session=ok(?:;|$)/.test(document.cookie || "");
}
function clearAdminSessionCookie(){
  document.cookie = "admin_session=; Max-Age=0; path=/";
}
function saveAdminSessionId(id){
  try { localStorage.setItem("admin_session_id", id); } catch {}
}
function getAdminSessionId(){
  try { return localStorage.getItem("admin_session_id") || ""; } catch { return ""; }
}
function clearAdminSessionId(){
  try { localStorage.removeItem("admin_session_id"); } catch {}
}

// ================================
// DOM refs
// ================================
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
const fMsg = document.getElementById("fMsg");
const formDate = document.getElementById("formDate");
const formTime = document.getElementById("formTime");
const formHint = document.getElementById("formHint");

// Paso 2 + Pago
const secondStepBlock = document.getElementById("secondStepBlock");
const secondStepBtn = document.getElementById("secondStepBtn");
const secondStepHint = document.getElementById("secondStepHint");
const paymentBlockManual = document.getElementById("paymentBlockManual");
const mpButtonWrap = document.getElementById("mp-button-wrap");
const mpLink1ars = document.getElementById("mp-link-1ars");
const payWarn = document.getElementById("payWarn");

// Admin UI mínimos (badge y overlay si existen en el DOM)
const adminBadge = document.getElementById("adminBadge");
const adminOverlay = document.getElementById("adminOverlay");

// Footer year
const yearEl = document.getElementById("year");

// ================================
// Bloquear edición directa fecha/hora
// ================================
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

// ================================
// Inicio
// ================================
document.addEventListener("DOMContentLoaded", async () => {
  // año en footer
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Ajustar variable CSS del alto de la nav para centrar badge (tu CSS usa --nav-h y --badge)
  (function setNavHeightVar(){
    const el = document.querySelector('.nav__inner');
    const h = el ? el.getBoundingClientRect().height : 64;
    document.documentElement.style.setProperty('--nav-h', h + 'px');
    document.documentElement.style.setProperty('--badge', '48px');
    window.addEventListener('resize', () => {
      const el2 = document.querySelector('.nav__inner');
      const h2 = el2 ? el2.getBoundingClientRect().height : 64;
      document.documentElement.style.setProperty('--nav-h', h2 + 'px');
    });
  })();

  // ===== FIX ANTI-BUCLE /admin =====
  // Si estoy en /admin y ya tengo sesión admin => redirijo directo a editar precios
  if (location.pathname.replace(/\/+$/,'') === "/admin") {
    if (hasAdminSession()) {
      window.location.replace("/?editprices=1#precios");
      return; // detenemos el resto para evitar overlay
    } else {
      // no logueado: mostrar overlay de login
      if (adminOverlay){
        adminOverlay.classList.remove("hidden");
        document.body.classList.add("has-admin-overlay");
      }
    }
  }

  // Mostrar/ocultar badge admin
  // Mostrar/ocultar badge admin (sin leer cookie HttpOnly)
if (adminBadge){
  async function checkAdminAndToggle(){
    try{
      const r = await fetch('/api/admin/plans', { method:'GET' });
      const isAdmin = r.status !== 401;
      adminBadge.classList.toggle('hidden', !isAdmin);
    }catch{
      adminBadge.classList.add('hidden');
    }
  }

  // mostrar al cargar y también cuando vuelve el foco (por si se logueó en otra pestaña)
  checkAdminAndToggle();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkAdminAndToggle();
  });

  // salir de admin
  adminBadge.addEventListener("click", async () => {
    try { await fetch("/api/admin/logout", { method:'POST' }); } catch {}
    clearAdminSessionCookie();
    clearAdminSessionId();

    // limpiá el parámetro ?editprices si está presente
    const url = new URL(location.href);
    url.searchParams.delete('editprices');
    window.location.replace(url.pathname + url.search + url.hash || '/');
  });
}


  // Hookear overlay (login admin)
  initAdminAuth();

  lockDateTimeFields();

  // ===== Planes dinámicos =====
  const plans = await fetchPlans();
  renderPricingCards(plans);
  renderPlanRadios(plans);

  // Disponibilidad
  await fetchAvailabilityForMonth(activeMonth);
  renderCalendar(); renderHours(); updateSummary();
  setFormDateTimeFromSelection();

  prevMonthBtn?.addEventListener("click", async () => {
    activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() - 1, 1);
    await fetchAvailabilityForMonth(activeMonth); renderCalendar();
  });
  nextMonthBtn?.addEventListener("click", async () => {
    activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 1);
    await fetchAvailabilityForMonth(activeMonth); renderCalendar();
  });

  goToFormBtn?.addEventListener("click", () => {
    setFormDateTimeFromSelection();
    document.getElementById("reserva").scrollIntoView({ behavior:"smooth" });
  });

  reserveForm?.addEventListener("submit", onSubmitReservation);
  secondStepBtn?.addEventListener("click", onSecondStep);
});

// ================================
// Calendario / disponibilidad
// ================================
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

// ================================
// Ubicación (Leaflet + Nominatim)
// ================================
const fAddress    = document.getElementById("fAddress");
const addrSuggest = document.getElementById("addrSuggest");
const addrMapEl   = document.getElementById("addrMap");

const addrLat     = document.getElementById("addr_lat");
const addrLng     = document.getElementById("addr_lng");
const addrDisplay = document.getElementById("addr_display");
const addrOsmId   = document.getElementById("addr_osm_id");

const START = { lat: -34.6037, lng: -58.3816, zoom: 13 };
const VIEWBOX = "-58.9,-34.2,-57.9,-34.9";
const USE_VIEWBOX = true;

let addrMap, addrMarker, debounceTimer = null, selectedIndex = -1, currentData = [];

function ensureMapVisible(){
  if (!addrMapEl) return;
  if (addrMapEl.classList.contains("hidden")) addrMapEl.classList.remove("hidden");
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
    `<div class="s-item${i===0?' active':''}" data-i="${i}" role="option">${escapeHtml(it.display_name||'')}</div>`
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

// ================================
// Reserva
// ================================
async function onSubmitReservation(e){
  e.preventDefault();
  const payload = {
    name: fName.value.trim(),
    email: fEmail.value.trim(),
    phone: fPhone.value.trim(),
    postal_code: fPostal.value.trim(),
    age: parseInt(fAge.value,10),
    message: fMsg.value.trim(),
    date: formDate.value,
    time: formTime.value,
    plan: (document.querySelector('input[name="plan"]:checked')||{}).value || "1h",

    location: {
      address: (document.getElementById('fAddress')?.value || '').trim(),
      lat: Number(addrLat?.value || 0),
      lng: Number(addrLng?.value || 0),
      display_name: addrDisplay?.value || '',
      osm_id: addrOsmId?.value || ''
    }
  };

  if(!payload.name||!payload.email||!payload.age||!payload.date||!payload.time||!payload.phone||!payload.postal_code){
    formHint.textContent="Completá todos los campos."; return;
  }
  if(payload.age<18){ formHint.textContent="Solo mayores de 18 años."; return; }

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

    setHidden('', '', '', '');
    addrMapEl?.classList.add('hidden');

    secondStepBlock.classList.remove("hidden");
    secondStepHint.textContent="";
    paymentBlockManual.classList.add("hidden");

    await fetchAvailabilityForMonth(activeMonth);
    renderCalendar(); renderHours(); updateSummary();
  }catch{
    formHint.textContent="Error de red. Intentá nuevamente.";
  }
}

// ================================
// Segundo paso
// ================================
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

    secondStepBlock.classList.add("hidden");
    paymentBlockManual.classList.remove("hidden");

    if (mpButtonWrap) mpButtonWrap.innerHTML = "";
    if (mpLink1ars) {
      mpLink1ars.classList.add("hidden");
      mpLink1ars.textContent = "Señar con Mercado Pago";
    }
    payWarn.textContent = "";

    if(!r.ok){
      payWarn.textContent = d.error || "No se pudo preparar el pago.";
      secondStepBtn.disabled=false;
      return;
    }

    if (d.mpPreferenceId && mpButtonWrap){
      const s = document.createElement("script");
      s.src = "https://www.mercadopago.com.ar/integrations/v1/web-payment-checkout.js";
      s.dataset.preferenceId = d.mpPreferenceId;
      s.dataset.source = "button";
      mpButtonWrap.appendChild(s);
    }
    const FALLBACK_PAY_LINK = "https://mpago.la/142C1pN";
    const payLink = d.payLink || FALLBACK_PAY_LINK;

    const btn = document.getElementById("mp-link-1ars");
    const qr  = document.getElementById("mp-qr-1ars");

    if (btn){
      btn.href = payLink;
      btn.classList.remove("hidden");
    }
    if (qr){
      const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=" + encodeURIComponent(payLink);
      qr.src = qrUrl;
    }

    if (!d.mpPreferenceId && !d.payLink){
      payWarn.textContent = "Falta configurar MP_PREFERENCE_ID o MP_LINK_1ARS en Vercel.";
    }
    secondStepHint.textContent = "Listo. Abajo tenés el botón para señar.";
  }catch{
    secondStepHint.textContent="Error de red. Probá de nuevo.";
    secondStepBtn.disabled=false;
  }
}

// ================================
// Nice Select (si existe)
// ================================
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
      li.addEventListener('click', () => { setSelectValue(v); close(); btn.focus(); });
      list.appendChild(li);
    });
  }
  function setSelectValue(v){
    let foundIndex = -1;
    for (let i=0; i<sel.options.length; i++){ if (sel.options[i].value === v){ foundIndex = i; break; } }
    if (foundIndex === -1){
      for (let i=0; i<sel.options.length; i++){ if (sel.options[i].textContent.trim() === v){ foundIndex = i; break; } }
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
  function open(){ btn.setAttribute('aria-expanded','true'); document.addEventListener('click', onDoc, { capture:true }); document.addEventListener('keydown', onKey); }
  function close(){ btn.setAttribute('aria-expanded','false'); document.removeEventListener('click', onDoc, { capture:true }); document.removeEventListener('keydown', onKey); }
  function toggle(){ (btn.getAttribute('aria-expanded') === 'true') ? close() : open(); }
  function onDoc(e){ if (!wrap.contains(e.target)) close(); }
  function onKey(e){ if (e.key === 'Escape') close(); }

  btn.addEventListener('click', toggle);
  sel.addEventListener('change', syncFromSelect);

  buildList();
  syncFromSelect();
})();

// ================================
// PLANES / PRECIOS DINÁMICOS
// ================================
async function fetchPlans(){
  try{
    const r = await fetch('/api/plans');
    if(!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.plans) ? d.plans : [];
  }catch{ return []; }
}

function renderPricingCards(plans){
  const wrap = document.getElementById('pricingCards');
  if(!wrap) return;
  wrap.innerHTML = '';
  if(!plans.length){
    wrap.innerHTML = `<article class="card"><p>No hay planes activos.</p></article>`;
    return;
  }
  plans.forEach((p, idx) => {
    const art = document.createElement('article');
    art.className = 'card' + (idx===1 ? ' card--featured':'');
    art.innerHTML = `
      <header class="card__head">
        <h3>${escapeHtml(p.label)}</h3>
        ${idx===1 ? '<span class="badge">Más pedido</span>':''}
      </header>
      <p class="card__price">$${Number(p.price_usd).toFixed(0)} <span>USD</span></p>
      <ul class="card__list">
        <li>Operador incluido</li>
        <li>Colchonetas y seguridad</li>
        <li>Traslado en AMBA*</li>
      </ul>
      <a href="#calendario" class="btn btn--block ${idx===1?'btn--primary':''}">Reservar</a>
    `;
    wrap.appendChild(art);
  });
}

function renderPlanRadios(plans){
  const wrap = document.getElementById('planOptions');
  if(!wrap) return;
  wrap.innerHTML = '';
  if(!plans.length){
    wrap.innerHTML = `<p class="hint">No hay planes activos.</p>`;
    return;
  }
  const current = (document.querySelector('input[name="plan"]:checked')||{}).value;

  plans.forEach((p, idx) => {
    const checked = current ? (current === p.code) : (idx===0);
    const div = document.createElement('label');
    div.className = 'plan__opt';
    div.innerHTML = `
      <input type="radio" name="plan" value="${escapeHtml(p.code)}" ${checked?'checked':''} />
      <span class="plan__card ${idx===1?'plan__card--pop':''}">
        <strong>${escapeHtml(p.label)}</strong>
        <em>USD ${Number(p.price_usd).toFixed(0)}</em>
      </span>
    `;
    wrap.appendChild(div);
  });
}

// ================================
// ADMIN OVERLAY: lógica de login
// (Con session_id correcto) + REDIRECT POST-LOGIN
// ================================
function initAdminAuth(){
  const overlay = document.getElementById('adminOverlay');
  if (!overlay) return;

  const el = (id) => document.getElementById(id);

  // Pasos
  const stepEmail      = el('stepEmail');
  const stepCodeEmail  = el('stepCodeEmail');
  const stepCodeTotp   = el('stepCodeTotp');

  // Paso 1 (email)
  const emailInput     = el('ovEmail');
  const sendBtn        = el('ovSendEmail');
  const hint1          = el('ovHint1');

  // Paso 2 (código email)
  const codeEmailInput = el('ovCodeEmail');
  const verifyEmailBtn = el('ovVerifyEmail');
  const back1          = el('ovBack1');
  const hint2          = el('ovHint2');

  // Paso 3 (TOTP)
  const totpQR         = el('ovTotpQR');
  const codeTotpInput  = el('ovCodeTotp');
  const verifyTotpBtn  = el('ovVerifyTotp');
  const back2          = el('ovBack2');
  const hint3          = el('ovHint3');

  const show = (step) => {
    [stepEmail, stepCodeEmail, stepCodeTotp].forEach(s => s?.classList.remove('active'));
    step?.classList.add('active');
  };

  show(stepEmail); // arranca en paso email

  async function startEmail(){
    hint1.textContent = '';
    const email = (emailInput.value || '').trim().toLowerCase();
    if (!email){ hint1.textContent = 'Ingresá un email.'; return; }

    sendBtn.disabled = true;
    try{
      const r = await fetch('/api/admin/start', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email })
      });
      const d = await r.json();
      if (!r.ok || !d.ok){ hint1.textContent = d.error || 'No se pudo enviar el código.'; return; }

      // Guardar session_id para los siguientes pasos
      if (d.session_id) saveAdminSessionId(d.session_id);

      show(stepCodeEmail);
      codeEmailInput.focus();
    }catch(e){
      hint1.textContent = 'Error de red.';
    }finally{
      sendBtn.disabled = false;
    }
  }

  async function verifyEmail(){
    hint2.textContent = '';

    const session_id = getAdminSessionId();
    const code  = ((codeEmailInput.value || '').replace(/\D/g, '')).slice(0, 6);

    if (!session_id){ hint2.textContent = 'Reiniciá el proceso (falta sesión).'; show(stepEmail); return; }
    if (code.length !== 6){ hint2.textContent = 'Código de 6 dígitos.'; return; }

    verifyEmailBtn.disabled = true;
    try{
      const r = await fetch('/api/admin/verify-email', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ session_id, code })
      });
      const d = await r.json();

      if (!r.ok || !d.ok){
        hint2.textContent = d.error || 'Código incorrecto o vencido.';
        return;
      }

      // Si TOTP está deshabilitado, o el server decide que ya estás logueado, redirigí
      if (d.totpDisabled || d.done || d.session === 'ok'){
        // redirección directa post-login
        window.location.replace("/?editprices=1#precios");
        return;
      }

      // Mostrar QR para configurar TOTP si viene
      const qrData = d.qrDataUrl || d.qr || d.qrData || d.qrDataURL || d.qrDataurl || d.qrDataUrl;
      const otpauth = d.otpauth || d.provisioningUri;
      if (totpQR){
        if (qrData)        totpQR.src = qrData;
        else if (otpauth)  totpQR.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(otpauth);
      }

      show(stepCodeTotp);
      codeTotpInput.focus();

    }catch(e){
      hint2.textContent = 'Error de red.';
    }finally{
      verifyEmailBtn.disabled = false;
    }
  }

  async function verifyTotp(){
    hint3.textContent = '';

    const session_id = getAdminSessionId();
    const code  = ((codeTotpInput.value || '').replace(/\D/g, '')).slice(0, 6);

    if (!session_id){ hint3.textContent = 'Reiniciá el proceso (falta sesión).'; show(stepEmail); return; }
    if (code.length !== 6){ hint3.textContent = 'Código de 6 dígitos.'; return; }

    verifyTotpBtn.disabled = true;
    try{
      const r = await fetch('/api/admin/verify-totp', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ session_id, code })
      });
      const d = await r.json();

      if (!r.ok || !d.ok){
        hint3.textContent = d.error || 'Código inválido.';
        return;
      }

      // Éxito: el server setea la cookie admin_session=ok
      // Redirigimos DIRECTO a la edición de precios
      window.location.replace("/?editprices=1#precios");

    }catch(e){
      hint3.textContent = 'Error de red.';
    }finally{
      verifyTotpBtn.disabled = false;
    }
  }

  // Eventos
  el('ovSendEmail')?.addEventListener('click', startEmail);
  el('ovVerifyEmail')?.addEventListener('click', verifyEmail);
  el('ovVerifyTotp')?.addEventListener('click', verifyTotp);
  el('ovBack1')?.addEventListener('click', () => show(stepEmail));
  el('ovBack2')?.addEventListener('click', () => show(stepCodeEmail));
}
