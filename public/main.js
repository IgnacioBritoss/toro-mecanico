// ======= Config (tu número real de WhatsApp) =======
const PHONE_E164 = "5491132895416"; // +54 9 11 3289-5416

// ======= Calendario =======
const monthNames = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];

function buildMonthGrid(baseDate) {
  const y = baseDate.getFullYear();
  const m = baseDate.getMonth();
  const first = new Date(y, m, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // 0 = Lunes
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

let activeMonth = (() => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
})();
let selectedDate = null;
let selectedHour = 18; // default
const hours = [12, 14, 16, 18, 20, 22];

// Elements
const yearSpan = document.getElementById("year");
const calTitle = document.getElementById("calTitle");
const calGrid = document.getElementById("calGrid");
const prevMonthBtn = document.getElementById("prevMonth");
const nextMonthBtn = document.getElementById("nextMonth");
const hourList = document.getElementById("hourList");
const summaryText = document.getElementById("summaryText");
const waBtn = document.getElementById("waBtn");
const waTop = document.getElementById("waTop");

const reserveForm = document.getElementById("reserveForm");
const fName = document.getElementById("fName");
const fEmail = document.getElementById("fEmail");
const fAge = document.getElementById("fAge");
const fZone = document.getElementById("fZone");
const fMsg = document.getElementById("fMsg");
const formDate = document.getElementById("formDate");
const formTime = document.getElementById("formTime");
const formHint = document.getElementById("formHint");

// Init
document.addEventListener("DOMContentLoaded", () => {
  if (yearSpan) yearSpan.textContent = new Date().getFullYear();
  renderCalendar();
  renderHours();
  updateSummary();
  updateWhatsAppLinks();

  prevMonthBtn.addEventListener("click", () => {
    activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  nextMonthBtn.addEventListener("click", () => {
    activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 1);
    renderCalendar();
  });

  reserveForm.addEventListener("submit", onSubmitReservation);
});

// Render
function renderCalendar() {
  const grid = buildMonthGrid(activeMonth);
  if (calTitle) calTitle.textContent = `${monthNames[activeMonth.getMonth()]} ${activeMonth.getFullYear()}`;
  calGrid.innerHTML = "";

  grid.forEach((d) => {
    const btn = document.createElement("button");
    btn.className = "cal__day";
    if (!d) {
      btn.classList.add("cal__day--muted");
      btn.disabled = true;
      btn.textContent = "";
    } else {
      btn.textContent = d.getDate();
      if (selectedDate && sameDay(d, selectedDate)) {
        btn.classList.add("cal__day--selected");
      }
      btn.addEventListener("click", () => {
        selectedDate = d;
        renderCalendar();
        updateSummary();
        updateWhatsAppLinks();
        // Prefill form date
        formDate.value = toInputDate(d);
      });
    }
    calGrid.appendChild(btn);
  });
}

function renderHours() {
  hourList.innerHTML = "";
  hours.forEach((h) => {
    const b = document.createElement("button");
    b.textContent = `${h}:00`;
    b.className = "slot__btn";
    if (h === selectedHour) b.classList.add("slot__btn--active");
    b.addEventListener("click", () => {
      selectedHour = h;
      renderHours();
      updateSummary();
      updateWhatsAppLinks();
      // Prefill form time
      formTime.value = `${pad2(h)}:00`;
    });
    hourList.appendChild(b);
  });
}

function updateSummary() {
  const dateStr = selectedDate ? toLocaleDate(selectedDate) : "Elegí un día";
  summaryText.textContent = `${dateStr} • ${pad2(selectedHour)}:00 hs`;
}

function updateWhatsAppLinks() {
  const msg = encodeURIComponent(
    `Hola, quiero reservar el Toro Mecánico para el ${selectedDate ? toLocaleDate(selectedDate) : "[elegir fecha]"} a las ${pad2(selectedHour)}:00. ¿Está disponible?`
  );
  const waUrl = `https://wa.me/${PHONE_E164}?text=${msg}`;
  waBtn.setAttribute("href", waUrl);
  waTop.setAttribute("href", waUrl);
}

// Submit reservation -> POST /api/reserve
async function onSubmitReservation(e) {
  e.preventDefault();
  // Basic validation
  const name = fName.value.trim();
  const email = fEmail.value.trim();
  const age = parseInt(fAge.value, 10);
  const zone = fZone.value.trim();
  const message = fMsg.value.trim();
  const date = formDate.value; // yyyy-mm-dd
  const time = formTime.value; // HH:mm
  const plan = (document.querySelector('input[name="plan"]:checked') || {}).value || "hora";

  if (!name || !email || !age || !date || !time) {
    formHint.textContent = "Completá nombre, email, edad, fecha y horario.";
    return;
  }
  if (age < 18) {
    formHint.textContent = "Solo mayores de 18 años pueden reservar.";
    return;
  }

  try {
    const res = await fetch("/api/reserve", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ name, email, age, zone, message, date, time, plan })
    });
    const data = await res.json();
    if (!res.ok) {
      formHint.textContent = data.error || "No se pudo procesar la reserva.";
      return;
    }
    formHint.textContent = "Reserva enviada. Te contactamos para confirmar.";
    reserveForm.reset();
  } catch (err) {
    formHint.textContent = "Error de red. Intentalo de nuevo.";
  }
}

// Helpers
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
function pad2(n) { return String(n).padStart(2, "0"); }
function toLocaleDate(d) {
  try { return d.toLocaleDateString("es-AR"); }
  catch { return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`; }
}
function toInputDate(d) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth()+1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}
