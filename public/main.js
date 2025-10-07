// ======= Calendario / disponibilidad =======
const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MAX_PER_DAY = 2;
const HOURS = [12, 14, 16, 18, 20, 22];

let activeMonth = (() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); })();
let selectedDate = null;
let selectedHour = 18;

let availability = {}; // { "YYYY-MM-DD": {count: n, hours: [hh,...]} }

const yearSpan = document.getElementById("year");
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
const fAge = document.getElementById("fAge");
const fZone = document.getElementById("fZone");
const fMsg = document.getElementById("fMsg");
const formDate = document.getElementById("formDate");
const formTime = document.getElementById("formTime");
const formHint = document.getElementById("formHint");

document.addEventListener("DOMContentLoaded", async () => {
  if (yearSpan) yearSpan.textContent = new Date().getFullYear();
  await fetchAvailabilityForMonth(activeMonth);
  renderCalendar();
  renderHours();
  updateSummary();

  prevMonthBtn.addEventListener("click", async () => {
    activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() - 1, 1);
    await fetchAvailabilityForMonth(activeMonth);
    renderCalendar();
  });
  nextMonthBtn.addEventListener("click", async () => {
    activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 1);
    await fetchAvailabilityForMonth(activeMonth);
    renderCalendar();
  });

  goToFormBtn.addEventListener("click", () => {
    if (selectedDate) formDate.value = toInputDate(selectedDate);
    if (selectedHour) formTime.value = `${pad2(selectedHour)}:00`;
    document.getElementById("reserva").scrollIntoView({ behavior: "smooth" });
  });

  reserveForm.addEventListener("submit", onSubmitReservation);
});

function buildMonthGrid(baseDate) {
  const y = baseDate.getFullYear(), m = baseDate.getMonth();
  const first = new Date(y, m, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // 0 = Lunes
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

async function fetchAvailabilityForMonth(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const qs = `start=${toInputDate(start)}&end=${toInputDate(end)}`;
  try {
    const res = await fetch(`/api/availability?${qs}`);
    if (!res.ok) { availability = {}; return; }
    const data = await res.json();
    availability = data.days || {};
  } catch { availability = {}; }
}

function renderCalendar() {
  const grid = buildMonthGrid(activeMonth);
  calTitle.textContent = `${monthNames[activeMonth.getMonth()]} ${activeMonth.getFullYear()}`;
  calGrid.innerHTML = "";

  grid.forEach((d) => {
    const btn = document.createElement("button");
    btn.className = "cal__day";
    if (!d) {
      btn.classList.add("cal__day--muted");
      btn.disabled = true;
      btn.textContent = "";
    } else {
      const key = toInputDate(d);
      const dayInfo = availability[key] || { count: 0, hours: [] };
      const full = dayInfo.count >= MAX_PER_DAY;
      btn.textContent = d.getDate();
      if (full) {
        btn.classList.add("cal__day--full");
        btn.disabled = true;
      } else {
        if (selectedDate && sameDay(d, selectedDate)) btn.classList.add("cal__day--selected");
        btn.addEventListener("click", () => {
          selectedDate = d;
          formDate.value = toInputDate(d);
          const taken = new Set(dayInfo.hours || []);
          if (taken.has(selectedHour)) {
            const free = HOURS.find(h => !taken.has(h));
            if (free) { selectedHour = free; formTime.value = `${pad2(free)}:00`; }
          }
          renderCalendar();
          renderHours();
          updateSummary();
        });
      }
    }
    calGrid.appendChild(btn);
  });
}

function renderHours() {
  hourList.innerHTML = "";
  const key = selectedDate ? toInputDate(selectedDate) : null;
  const dayInfo = key ? (availability[key] || { count: 0, hours: [] }) : { count: 0, hours: [] };
  const taken = new Set(dayInfo.hours || []);
  const full = dayInfo.count >= MAX_PER_DAY;

  HOURS.forEach((h) => {
    const b = document.createElement("button");
    b.textContent = `${h}:00`;
    b.className = "slot__btn";
    const disabled = full || taken.has(h);
    if (disabled) {
      b.classList.add("slot__btn--disabled");
      b.disabled = true;
      b.title = full ? "Día completo" : "Ocupado";
    } else {
      if (h === selectedHour) b.classList.add("slot__btn--active");
      b.addEventListener("click", () => {
        selectedHour = h;
        formTime.value = `${pad2(h)}:00`;
        renderHours();
        updateSummary();
      });
    }
    hourList.appendChild(b);
  });
}

function updateSummary() {
  const dateStr = selectedDate ? toLocaleDate(selectedDate) : "Elegí un día";
  summaryText.textContent = `${dateStr} • ${pad2(selectedHour)}:00 hs`;
}

async function onSubmitReservation(e) {
  e.preventDefault();
  const name = fName.value.trim();
  const email = fEmail.value.trim();
  const age = parseInt(fAge.value, 10);
  const zone = fZone.value.trim();
  const message = fMsg.value.trim();
  const date = formDate.value;
  const time = formTime.value;
  const plan = (document.querySelector('input[name="plan"]:checked') || {}).value || "hora";

  if (!name || !email || !age || !date || !time) { formHint.textContent = "Completá nombre, email, edad, fecha y horario."; return; }
  if (age < 18) { formHint.textContent = "Solo mayores de 18 años."; return; }

  try {
    const res = await fetch("/api/reserve", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ name, email, age, zone, message, date, time, plan })
    });
    const data = await res.json();
    if (!res.ok) { formHint.textContent = data.error || "No se pudo procesar la reserva."; return; }

    formHint.textContent = "Reserva enviada. Te contactamos para confirmar.";
    reserveForm.reset();

    // refrescar disponibilidad
    await fetchAvailabilityForMonth(activeMonth);
    renderCalendar();
    renderHours();
    updateSummary();
  } catch {
    formHint.textContent = "Error de red. Intentalo de nuevo.";
  }
}

// Helpers
function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function pad2(n){ return String(n).padStart(2,"0"); }
function toLocaleDate(d){ try{ return d.toLocaleDateString("es-AR"); } catch{ return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`; } }
function toInputDate(d){ const yyyy=d.getFullYear(); const mm=pad2(d.getMonth()+1); const dd=pad2(d.getDate()); return `${yyyy}-${mm}-${dd}`; }
