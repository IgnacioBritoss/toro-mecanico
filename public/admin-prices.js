// public/admin-prices.js
(function(){
  const isEdit = /[?&]editprices\b/i.test(location.search);
  if (!isEdit) return;

  const container = document.createElement("div");
  container.id = "priceEditor";
  container.style.position = "sticky";
  container.style.top = "76px";
  container.style.zIndex = "60";
  container.style.margin = "16px auto";
  container.style.maxWidth = "1100px";
  container.style.padding = "16px";
  container.style.borderRadius = "14px";
  container.style.border = "1px solid #e2e8f0";
  container.style.background = "#fff";
  container.style.boxShadow = "0 10px 24px rgba(0,0,0,.10)";
  container.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;margin-bottom:8px">
      <button id="closePriceEditor" style="padding:8px 12px;border-radius:10px;border:1px solid #e2e8f0;background:#111827;color:#fff;font-weight:700;cursor:pointer">✕ Cerrar editor</button>
    </div>
    <div style="display:grid;gap:12px">
      <!-- fila 1h -->
      <div style="display:flex;align-items:center;gap:10px">
        <div style="min-width:120px;font-weight:700">1 hora (1h)</div>
        <input id="price1h" type="number" min="1" step="1" style="flex:0 0 140px;padding:10px;border:1px solid #cbd5e1;border-radius:10px" />
        <button id="save1h" data-plan="1" style="padding:10px 12px;border-radius:10px;border:1px solid #111827;background:#111827;color:#fff;font-weight:700;cursor:pointer">Guardar</button>
      </div>

      <!-- fila 2h -->
      <div style="display:flex;align-items:center;gap:10px">
        <div style="min-width:120px;font-weight:700">2 horas (2h)</div>
        <input id="price2h" type="number" min="1" step="1" style="flex:0 0 140px;padding:10px;border:1px solid #cbd5e1;border-radius:10px" />
        <button id="save2h" data-plan="2" style="padding:10px 12px;border-radius:10px;border:1px solid #111827;background:#111827;color:#fff;font-weight:700;cursor:pointer">Guardar</button>
      </div>

      <small style="color:#475569">Los cambios impactan en toda la web. Guardá plan por plan.</small>
    </div>
  `;

  // Insertar el editor arriba de la sección "Precios"
  const precios = document.querySelector('#precios') || document.body.firstElementChild;
  precios?.parentNode?.insertBefore(container, precios);

  document.getElementById("closePriceEditor")?.addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.delete("editprices");
    location.href = url.toString();
  });

  // Cargar valores actuales:
  // Si tu GET público es /api/plans, usalo; si no, /api/admin/plans (ya logueado).
  fetch("/api/plans")
    .then(r => r.json())
    .then(d => {
      const pl = d.plans || [];
      const p1 = pl.find(x => x.code === "1h" || x.id === 1);
      const p2 = pl.find(x => x.code === "2h" || x.id === 2);
      if (p1) document.getElementById("price1h").value = Number(p1.price_usd).toFixed(0);
      if (p2) document.getElementById("price2h").value = Number(p2.price_usd).toFixed(0);
    })
    .catch(()=>{});

  async function saveOne(id, value){
    const res = await fetch("/api/admin/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin", // <- ENVÍA COOKIE
      body: JSON.stringify({ id, price_usd: Number(value) })
    });
    if (res.status === 401){
      alert("No estás autorizado. Iniciá sesión de admin e intentá de nuevo.");
      return null;
    }
    const data = await res.json();
    if (!res.ok || !data.ok){
      alert(data.error || "No se pudo guardar.");
      return null;
    }
    return data.plan;
  }

  document.getElementById("save1h")?.addEventListener("click", async (e) => {
    const v = document.getElementById("price1h").value;
    const saved = await saveOne(1, v);
    if (saved) alert("Precio 1h actualizado a USD " + saved.price_usd);
  });

  document.getElementById("save2h")?.addEventListener("click", async (e) => {
    const v = document.getElementById("price2h").value;
    const saved = await saveOne(2, v);
    if (saved) alert("Precio 2h actualizado a USD " + saved.price_usd);
  });
})();
