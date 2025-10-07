// ======= Config básica =======
const MAX_PER_DAY = 2;
const HOURS = [12, 14, 16, 18, 20, 22];
const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

let activeMonth = (() => { const n=new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); })();
let selectedDate = null;
let selectedHour = 18;
let availability = {}; // { "YYYY-MM-DD": {count, hours:[] } }

// DOM
const yearSpan = document.getElementById("year");
const calTitle = document.getElementById("calTitle");
const calGrid = document.getElementById("calGrid");
const prevMonthBtn = document.getElementById("prevMonth");
const nextMonthBtn = document.getElementById("nextMonth");
const hourList = document.getElementById("hourList");
const summaryText = document.getElementById("summaryText");
const goToFormBtn = document.getElementById("goToForm");

// Form reserva
const reserveForm = document.getElementById("reserveForm");
const fName = document.getElementById("fName");
const fEmail = document.getElementById("fEmail");
const fAge = document.getElementById("fAge");
const fLocality = document.getElementById("fLocality");
const fMsg = document.getElementById("fMsg");
const formDate = document.getElementById("formDate");
const formTime = document.getElementById("formTime");
const formHint = document.getElementById("formHint");

// Opiniones
const reviewForm = document.getElementById("reviewForm");
const reviewName = document.getElementById("reviewName");
const reviewText = document.getElementById("reviewText");
const reviewHint = document.getElementById("reviewHint");
const reviewsList = document.getElementById("reviewsList");

document.addEventListener("DOMContentLoaded", async () => {
  if (yearSpan) yearSpan.textContent = new Date().getFullYear();

  await fetchAvailabilityForMonth(activeMonth);
  renderCalendar();
  renderHours();
  updateSummary();

  prevMonthBtn.addEventListener("click", async () => {
    activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() - 1, 1);
    await fetchAvailabilityForMonth(activeMonth); renderCalendar();
  });
  nextMonthBtn.addEventListener("click", async () => {
    activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 1);
    await fetchAvailabilityForMonth(activeMonth); renderCalendar();
  });

  goToFormBtn.addEventListener("click", () => {
    if (selectedDate) formDate.value = toInputDate(selectedDate);
    if (selectedHour) formTime.value = `${pad2(selectedHour)}:00`;
    document.getElementById("reserva").scrollIntoView({ behavior: "smooth" });
  });

  reserveForm.addEventListener("submit", onSubmitReservation);

  // Opiniones
  reviewForm.addEventListener("submit", onSubmitReview);
  await loadReviews();
});

// --------- Calendario ----------
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
  calTitle.textContent = `${monthNames[activeMonth.getMonth()]} ${activeMonth.getFullYear()}`;
  calGrid.innerHTML = "";
  grid.forEach(d=>{
    const btn = document.createElement("button");
    btn.className = "cal__day";
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
          const taken=new Set(info.hours||[]);
          if(taken.has(selectedHour)){ const free=HOURS.find(h=>!taken.has(h)); if(free){ selectedHour=free; formTime.value=`${pad2(free)}:00`; } }
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
  summaryText.textContent = `${dateStr} • ${pad2(selectedHour)}:00 hs`;
}

// --------- Reserva ----------
async function onSubmitReservation(e){
  e.preventDefault();
  const name=fName.value.trim();
  const email=fEmail.value.trim();
  const age=parseInt(fAge.value,10);
  const locality=fLocality.value.trim();
  const message=fMsg.value.trim();
  const date=formDate.value;
  const time=formTime.value;
  const plan=(document.querySelector('input[name="plan"]:checked')||{}).value || "1h";

  if(!name||!email||!age||!date||!time||!locality){ formHint.textContent="Completá todos los campos."; return; }
  if(age<18){ formHint.textContent="Solo mayores de 18 años."; return; }

  try{
    const res=await fetch("/api/reserve",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ name, email, age, zone:locality, message, date, time, plan })
    });
    const data=await res.json();
    if(!res.ok){ formHint.textContent=data.error||"No se pudo procesar la reserva."; return; }

    formHint.textContent="Reserva enviada. Revisá tu email para aceptarla y señar el 10%.";
    reserveForm.reset();

    await fetchAvailabilityForMonth(activeMonth);
    renderCalendar(); renderHours(); updateSummary();
  }catch{
    formHint.textContent="Error de red. Intentá nuevamente.";
  }
}

// --------- Opiniones ----------
async function onSubmitReview(e){
  e.preventDefault();
  const name = reviewName.value.trim();
  const text = reviewText.value.trim();
  const stars = parseInt((document.querySelector('input[name="stars"]:checked')||{}).value||"1",10);
  if(!name || !text){ reviewHint.textContent="Completá nombre y comentario."; return; }
  try{
    const r=await fetch("/api/review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,text,stars})});
    const d=await r.json();
    if(!r.ok){ reviewHint.textContent=d.error||"No se pudo guardar."; return; }
    reviewHint.textContent="¡Gracias por tu opinión!";
    reviewForm.reset(); await loadReviews();
  }catch{ reviewHint.textContent="Error de red."; }
}

async function loadReviews(){
  try{
    const r=await fetch("/api/review?recent=1");
    const d=await r.json();
    reviewsList.innerHTML = "";
    (d.items||[]).forEach(x=>{
      const el=document.createElement("div");
      el.className="review";
      el.innerHTML = `
        <div><strong>${escapeHtml(x.name)}</strong> — ${"★".repeat(x.stars)}${"☆".repeat(5-x.stars)}</div>
        <div class="review__meta">${new Date(x.created_at).toLocaleDateString("es-AR")}</div>
        <div>${escapeHtml(x.text)}</div>`;
      reviewsList.appendChild(el);
    });
  }catch{ /* noop */ }
}

// Helpers
function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function pad2(n){ return String(n).padStart(2,"0"); }
function toLocaleDate(d){ try{ return d.toLocaleDateString("es-AR"); } catch{ return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`; } }
function toInputDate(d){ const yyyy=d.getFullYear(); const mm=pad2(d.getMonth()+1); const dd=pad2(d.getDate()); return `${yyyy}-${mm}-${dd}`; }
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }
