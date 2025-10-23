// public/js/reach-zones.js
// Admin: “¿Hasta dónde llegamos?” con barrios de CABA, partidos PBA y restricciones

(() => {
  // ================================
  // Catálogos
  // ================================
  const CABA_BARRIOS = [
    "Agronomía","Almagro","Balvanera","Barracas","Belgrano","Boedo","Caballito","Chacarita",
    "Coghlan","Colegiales","Constitución","Flores","Floresta","La Boca","La Paternal",
    "Liniers","Mataderos","Monte Castro","Montserrat","Nueva Pompeya","Núñez",
    "Palermo","Parque Avellaneda","Parque Chacabuco","Parque Chas","Parque Patricios",
    "Puerto Madero","Recoleta","Retiro","Saavedra","San Cristóbal","San Nicolás",
    "San Telmo","Vélez Sarsfield","Versalles","Villa Crespo","Villa del Parque",
    "Villa Devoto","Villa General Mitre","Villa Lugano","Villa Luro","Villa Ortúzar",
    "Villa Pueyrredón","Villa Real","Villa Riachuelo","Villa Santa Rita","Villa Soldati",
    "Villa Urquiza"
  ];

  const PBA_PARTIDOS = [
    "La Matanza","Lomas de Zamora","Quilmes","Lanús","Almirante Brown","Avellaneda","Merlo","General San Martín",
    "Florencio Varela","Moreno","Tigre","Tres de Febrero","Berazategui","Esteban Echeverría","San Isidro","Malvinas Argentinas",
    "Vicente López","Pilar","Ituzaingó","Hurlingham","San Miguel","Ezeiza","Berisso","Ensenada","Morón","José C. Paz",
    "San Fernando","Escobar","La Plata","Brandsen","Marcos Paz","General Rodríguez","Cañuelas","Luján","Navarro","Campana",
    "Zárate","Bahía Blanca","Mar del Plata"
  ];

  // **Restricciones** (no operamos ahí). Se puede extender.
  // Para CABA usamos barrios; para PBA villas/zonas conflictivas.
  const RESTRICTED = [
    { province: "CABA",         city: "Barrio Padre Mugica" },     // Villa 31
    { province: "CABA",         city: "Barrio Padre Ricciardelli" },// 1-11-14
    { province: "CABA",         city: "Barrio 20" },
    { province: "CABA",         city: "Villa 21-24" },
    { province: "Buenos Aires", city: "Villa Itatí" },
    { province: "Buenos Aires", city: "Villa Azul" },
    { province: "Buenos Aires", city: "La Cava" }
  ];

  // ================================
  // Mostrar la sección si es admin o ?editzones
  // ================================
  document.addEventListener("DOMContentLoaded", () => {
    const reach = document.getElementById("reachSection");
    if (!reach) return;

    const qs = new URLSearchParams(location.search);
    if ((window.IS_ADMIN || window.ON_ADMIN) || qs.has("editzones")) {
      reach.hidden = false;
    }

    initReachSection();
    renderAdvisories();
  });

  // ================================
  // UI / Lógica
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

    const isRestricted = (p, c) => !!RESTRICTED.find(z =>
      z.province === p && normalize(z.city) === normalize(c)
    );

    function normalize(s){ return String(s||"").trim().toLowerCase(); }

    function paintCities() {
      const prov = selProv.value;
      const list = prov === "CABA" ? CABA_BARRIOS : PBA_PARTIDOS;
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
        const danger = isRestricted(z.province, z.city);
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.innerHTML = `
          ${z.province} — ${z.city}
          ${danger ? '<span class="badge" title="Zona restringida">R</span>' : ''}
          <span class="x" title="Quitar">×</span>
        `;
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
          setMsg("Falta crear la tabla service_zones (el back la crea automáticamente al guardar).", false);
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

        // Bloqueo en UI: no enviar restringidas activas
        const denied = zones.filter(z => z.active && isRestricted(z.province, z.city));
        if (denied.length) {
          setMsg("Quitá las zonas restringidas antes de guardar.", false);
          return;
        }

        const filtered = zones
          .filter(z => z.province === "CABA" || z.province === "Buenos Aires")
          .map(z => ({ province: z.province, city: z.city, active: !!z.active }));

        const r = await fetch("/api/reserve?zones=1", {
          method: "PUT",
          headers: { "Content-Type":"application/json", "x-admin":"1" },
          body: JSON.stringify({ zones: filtered })
        });

        const resp = await r.json().catch(()=>({}));
        if (!r.ok || resp.error) {
          setMsg(resp.error || "Error guardando zonas", false);
        } else {
          // el back puede devolver denied (servidor bloquea por blacklist)
          if (Array.isArray(resp.denied) && resp.denied.length) {
            setMsg("Guardado parcial. Se bloquearon zonas restringidas.", false);
          } else {
            setMsg("Zonas guardadas", true);
          }
        }
      } catch (e) {
        console.error(e);
        setMsg("Error de red", false);
      }
    }

    selProv.addEventListener("change", paintCities);
    addBtn.addEventListener("click", () => {
      const province = selProv.value;
      const city = selCity.value;
      if (isRestricted(province, city)) {
        setMsg("Esa zona está restringida por seguridad.", false);
        return;
      }
      const z = { province, city, active: true };
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
  // Lista compacta “Zonas con restricciones”
  // ================================
  function renderAdvisories() {
    const host = document.getElementById("reachAdvisories");
    if (!host) return;

    const count = RESTRICTED.length;
    host.innerHTML = `
      <details class="advisory" open>
        <summary>
          Zonas con restricciones operativas
          <span class="badge">${count}</span>
        </summary>
        <p class="advisory-note">
          Estas zonas no se pueden reservar por motivos de seguridad y acceso.
        </p>
        <ul class="pill-list" id="advisoryList"></ul>
      </details>
    `;

    const ul = host.querySelector("#advisoryList");
    RESTRICTED.forEach(item => {
      const li = document.createElement("li");
      li.className = "pill";
      li.textContent = `${item.province} — ${item.city}`;
      ul.appendChild(li);
    });
  }
})();
