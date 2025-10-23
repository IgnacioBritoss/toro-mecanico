// public/js/reach-zones.js
// Sección admin: "¿Hasta dónde llegamos?" + Zonas con restricciones (compacto)

(() => {
  // ================================
  // Config datos (podés editar)
  // ================================
  const CABA_CITIES = ["CABA"]; // unitaria
  const PBA_PARTIDOS = [
    "La Matanza","Lomas de Zamora","Quilmes","Lanús","Almirante Brown","Avellaneda","Merlo","General San Martín",
    "Florencio Varela","Moreno","Tigre","Tres de Febrero","Berazategui","Esteban Echeverría","San Isidro","Malvinas Argentinas",
    "Vicente López","Pilar","Ituzaingó","Hurlingham","San Miguel","Ezeiza","Berisso","Ensenada","Morón","José C. Paz",
    "San Fernando","Escobar","La Plata","Brandsen","Marcos Paz","General Rodríguez","Cañuelas","Luján","Navarro","Campana",
    "Zárate","Bahía Blanca","Mar del Plata" // extendible
  ];

  // Zonas con restricciones operativas (lista compacta)
  const NON_RECOMMENDED = [
    { province: "CABA",          area: "Barrio Padre Mugica (ex Villa 31), Retiro" },
    { province: "CABA",          area: "Barrio Padre Ricciardelli (ex 1-11-14), Bajo Flores" },
    { province: "CABA",          area: "Barrio 20, Villa Lugano" },
    { province: "Buenos Aires",  area: "Villa Itatí, Quilmes" },
    { province: "Buenos Aires",  area: "Villa Azul, Avellaneda/Quilmes" },
    { province: "Buenos Aires",  area: "La Cava, San Isidro" }
  ];

  // ================================
  // Mostrar la sección si es admin o ?editzones
  // ================================
  document.addEventListener("DOMContentLoaded", () => {
    const reach = document.getElementById("reachSection");
    if (!reach) return;

    const qs = new URLSearchParams(location.search);
    // Nota: main.js debe publicar window.IS_ADMIN / window.ON_ADMIN
    if ((typeof window !== "undefined" && (window.IS_ADMIN || window.ON_ADMIN)) || qs.has("editzones")) {
      reach.hidden = false;
    }

    initReachSection();
    renderAdvisories();
  });

  // ================================
  // Lógica de zonas habilitadas
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

    let zones = []; // {province, city, active:true}

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

    function setMsg(text, ok=false) {
      msg.textContent = text || "";
      msg.className = ok ? "msg ok" : (text ? "msg err" : "msg");
    }

    async function fetchZones() {
      try {
        const r = await fetch("/api/reserve?zones=1");
        if (!r.ok) {
          setMsg("Error cargando zonas (HTTP " + r.status + ")", false);
          zones = [];
          renderTags();
          return;
        }
        const data = await r.json();
        const list = Array.isArray(data) ? data
                   : Array.isArray(data?.zones) ? data.zones
                   : [];
        zones = list.map(d => ({ province: d.province, city: d.city, active: !!d.active }));
        if (data?.setup_needed) {
          setMsg("Falta crear la tabla service_zones (ver migración SQL).", false);
        } else {
          setMsg("");
        }
        renderTags();
      } catch (e) {
        console.error(e);
        setMsg("Error de red al cargar zonas", false);
        zones = [];
        renderTags();
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
          headers: { "Content-Type":"application/json", "x-admin":"1" },
          body: JSON.stringify({ zones: filtered })
        });

        if (!r.ok) {
          const e = await r.json().catch(()=>({error:"Error"}));
          setMsg(e.error || "Error guardando", false);
        } else {
          setMsg("Zonas guardadas", true);
        }
      } catch (e) {
        console.error(e);
        setMsg("Error de red", false);
      }
    }

    selProv.addEventListener("change", paintCities);
    addBtn.addEventListener("click", () => {
      const z = { province: selProv.value, city: selCity.value, active: true };
      const idx = zones.findIndex(x => x.province===z.province && x.city===z.city);
      if (idx >= 0) zones[idx].active = true; else zones.push(z);
      renderTags();
    });
    saveBtn.addEventListener("click", saveZones);

    // mapa clicable
    pbaShape?.addEventListener("click", () => { selProv.value = "Buenos Aires"; paintCities(); });
    cabaShape?.addEventListener("click", () => { selProv.value = "CABA"; paintCities(); });

    // init
    paintCities();
    fetchZones();
  }

  // ================================
  // Lista compacta "Zonas con restricciones"
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
          Esta lista es operativa. Podés coordinar caso a caso por seguridad y acceso.
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
