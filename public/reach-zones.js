// public/js/reach-zones.js
// Sección admin “¿Hasta dónde llegamos?” + gestión de zonas (endpoints /api/reserve?zones=1)

(() => {
  // ================================
  // Datos base
  // ================================
  const CABA_CITIES = ["CABA"]; // en esta versión la unidad CABA se trata como una sola “ciudad”

  // Partidos comunes de PBA; podés ampliar sin problema
  const PBA_PARTIDOS = [
    "La Matanza","Lomas de Zamora","Quilmes","Lanús","Almirante Brown","Avellaneda","Merlo","General San Martín",
    "Florencio Varela","Moreno","Tigre","Tres de Febrero","Berazategui","Esteban Echeverría","San Isidro","Malvinas Argentinas",
    "Vicente López","Pilar","Ituzaingó","Hurlingham","San Miguel","Ezeiza","Berisso","Ensenada","Morón","José C. Paz",
    "San Fernando","Escobar","La Plata","Brandsen","Marcos Paz","General Rodríguez","Cañuelas","Luján","Navarro","Campana",
    "Zárate","Bahía Blanca","Mar del Plata"
  ];

  // Solo informativo (el backend es quien bloquea realmente las “villas de emergencia”)
  const NON_RECOMMENDED = [
    { province: "CABA",         area: "Barrio Padre Mugica (ex Villa 31), Retiro" },
    { province: "CABA",         area: "Barrio Padre Ricciardelli (ex 1-11-14), Bajo Flores" },
    { province: "CABA",         area: "Barrio 20, Villa Lugano" },
    { province: "Buenos Aires", area: "Villa Itatí, Quilmes" },
    { province: "Buenos Aires", area: "Villa Azul, Avellaneda/Quilmes" },
    { province: "Buenos Aires", area: "La Cava, San Isidro" }
  ];

  // ================================
  // Mostrar sección solo si es admin
  // ================================
  document.addEventListener("DOMContentLoaded", async () => {
    const reach = document.getElementById("reachSection");
    if (!reach) return;

    // 1) si main.js ya expuso flags y dice que NO estamos en admin, ocultamos
    if (typeof window !== "undefined" && window.ON_ADMIN === false) {
      return;
    }

    // 2) verificación real con backend (no dependemos solo de window.IS_ADMIN)
    let canAdmin = false;
    try {
      const r = await fetch("/api/admin/plans", { method: "GET" });
      canAdmin = r.status !== 401;
    } catch { canAdmin = false; }

    if (!canAdmin) return;

    // ok: mostramos y arrancamos
    reach.hidden = false;
    initReachSection();
    renderAdvisories();
  });

  // ================================
  // UI / Lógica de zonas
  // ================================
  function initReachSection() {
    const selProv = document.getElementById("reachProvince");
    const selCity = document.getElementById("reachCity");
    const addBtn  = document.getElementById("reachAdd");
    const saveBtn = document.getElementById("reachSave");
    const tagsBox = document.getElementById("reachTags");
    const msg     = document.getElementById("reachMsg");

    const pbaShape  = document.getElementById("pba-shape");
    const cabaShape = document.getElementById("caba-shape");

    let zones = []; // [{province, city, active:true}]

    function setMsg(text, ok=false) {
      msg.textContent = text || "";
      msg.className = ok ? "msg ok" : (text ? "msg err" : "msg");
    }

    function paintCities() {
      const prov = selProv.value;
      const list = prov === "CABA" ? CABA_CITIES : PBA_PARTIDOS;
      selCity.innerHTML = "";
      for (const c of list) {
        const opt = document.createElement("option");
        opt.value = c; opt.textContent = c;
        selCity.appendChild(opt);
      }
    }

    function renderTags() {
      tagsBox.innerHTML = "";
      zones.filter(z => z.active).forEach(z => {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.innerHTML = `${z.province} — ${z.city} <span class="x" title="Quitar">×</span>`;
        tag.querySelector(".x").addEventListener("click", () => {
          z.active = false;
          renderTags();
        });
        tagsBox.appendChild(tag);
      });
    }

    async function fetchZones() {
      try {
        const r = await fetch("/api/reserve?zones=1"); // <- endpoint correcto
        const data = await r.json();
        if (!r.ok) {
          setMsg(data?.error || "No se pudieron cargar las zonas.", false);
          return;
        }
        // data puede ser Array o {setup_needed:true, zones:[]}
        const list = Array.isArray(data) ? data : (Array.isArray(data.zones) ? data.zones : []);
        zones = list.map(d => ({ province: d.province, city: d.city, active: !!d.active }));
        renderTags();
      } catch (e) {
        console.error(e);
        setMsg("Error de red al cargar zonas.", false);
      }
    }

    async function saveZones() {
      try {
        setMsg("");
        const filtered = zones
          .filter(z => z.province === "CABA" || z.province === "Buenos Aires")
          .map(z => ({ province: z.province, city: z.city, active: !!z.active }));

        const r = await fetch("/api/reserve?zones=1", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-admin":"1" },
          body: JSON.stringify({ zones: filtered })
        });

        const resp = await r.json().catch(()=>({}));
        if (!r.ok) {
          setMsg(resp?.error || "Error guardando zonas.", false);
          return;
        }

        // opcional: si el backend avisa de bloqueadas por seguridad
        if (Array.isArray(resp.blocked) && resp.blocked.length) {
          const list = resp.blocked.map(b => `${b.province} — ${b.city}`).join(", ");
          setMsg(`Guardado. (Bloqueadas por seguridad: ${list})`, true);
        } else {
          setMsg("Zonas guardadas.", true);
        }

        await fetchZones();
      } catch (e) {
        console.error(e);
        setMsg("Error de red al guardar.", false);
      }
    }

    // eventos
    selProv.addEventListener("change", paintCities);
    addBtn.addEventListener("click", () => {
      const z = { province: selProv.value, city: selCity.value, active: true };
      const idx = zones.findIndex(x => x.province===z.province && x.city===z.city);
      if (idx >= 0) zones[idx].active = true; else zones.push(z);
      renderTags();
    });
    saveBtn.addEventListener("click", saveZones);

    // mapa clicable (decorativo/ayuda: setea provincia en el select)
    pbaShape?.addEventListener("click", () => { selProv.value = "Buenos Aires"; paintCities(); });
    cabaShape?.addEventListener("click", () => { selProv.value = "CABA"; paintCities(); });

    // init
    paintCities();
    fetchZones();
  }

  // ================================
  // Zonas con restricciones (solo visual)
  // ================================
  function renderAdvisories() {
    const host = document.getElementById("reachAdvisories");
    if (!host) return;

    const count = NON_RECOMMENDED.length;
    host.innerHTML = `
      <details class="advisory">
        <summary>
          Zonas con restricciones operativas
          <span class="badge">${count}</span>
        </summary>
        <p class="advisory-note">
          Esta lista es informativa. El backend bloquea automáticamente villas de emergencia.
        </p>
        <ul class="pill-list" id="advisoryList"></ul>
      </details>
    `;

    const ul = host.querySelector("#advisoryList");
    NON_RECOMMENDED.forEach(item => {
      const li = document.createElement("li");
      li.className = "pill";
      li.textContent = `${item.province} — ${item.area}`;
      ul.appendChild(li);
    });
  }
})();
