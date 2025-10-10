// public/admin-prices.js
(function adminPricesEditor(){
  // --- helpers ---
  function hasAdminSession(){
    return /(?:^|;\s*)admin_session=ok(?:;|$)/.test(document.cookie || "");
  }
  function qs(sel){ return document.querySelector(sel); }
  function el(tag, attrs = {}, html = "") {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "style") n.setAttribute("style", attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    if (html) n.innerHTML = html;
    return n;
  }
  function money(v){ return Number(v || 0).toFixed(0); }
  function num(v){ const n = parseFloat(String(v).replace(/[^\d.]/g, "")); return Number.isFinite(n) ? n : 0; }

  // Requiere venir con ?editprices=1 (que inyecta /admin vía vercel.json)
  const url = new URL(window.location.href);
  const showFlag = url.searchParams.has("editprices");

  // Si no venís por /admin, no cargamos nada:
  if (!showFlag) return;

  // Si no sos admin, no mostramos el panel. (Tu overlay de login corre aparte)
  if (!hasAdminSession()) {
    // Opcional: podés mostrar un mensajito suave en consola
    console.info("[admin-prices] Falta sesión admin. Logueate en /admin y volvés acá.");
    return;
  }

  // --- anclar cerca de la sección de precios ---
  const anchor = document.getElementById("precios") || qs("#precios");
  if (anchor) {
    try { anchor.scrollIntoView({ behavior: "smooth", block: "start" }); }
    catch {}
  }

  // --- UI flotante ---
  const panel = el("div", { class: "admin-price-panel" }, `
    <div class="ap-head">
      <strong>Editor de precios</strong>
      <button type="button" class="ap-close" title="Cerrar">×</button>
    </div>
    <div class="ap-body">
      <div class="ap-row">
        <label>1 hora (USD)</label>
        <input type="number" id="apOne" min="0" step="1" inputmode="numeric" />
      </div>
      <div class="ap-row">
        <label>2 horas (USD)</label>
        <input type="number" id="apTwo" min="0" step="1" inputmode="numeric" />
      </div>
      <div class="ap-actions">
        <button type="button" id="apSave" class="ap-btn ap-btn--primary">Guardar</button>
        <button type="button" id="apRefresh" class="ap-btn">Recargar</button>
      </div>
      <div id="apHint" class="ap-hint"></div>
    </div>
  `);

  // estilos mínimos incrustados (no tocan tu styles.css)
  const style = el("style", {}, `
    .admin-price-panel{
      position: fixed;
      right: 18px;
      top: 88px;
      z-index: 1050;
      width: 320px;
      border-radius: 14px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      box-shadow: 0 16px 38px rgba(0,0,0,.18);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    .ap-head{
      display:flex; align-items:center; justify-content:space-between;
      padding: 10px 12px; border-bottom:1px solid #e5e7eb; background:#f8fafc;
    }
    .ap-head strong{ font-weight:800; font-size:14px; }
    .ap-close{ border:0; background:transparent; font-size:20px; cursor:pointer; line-height:1; padding:4px; }
    .ap-body{ padding: 12px; }
    .ap-row{ display:grid; gap:6px; margin-bottom:10px; }
    .ap-row label{ font-size:13px; color:#334155; }
    .ap-row input{
      border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px;
      font-size: 14px; width: 100%;
    }
    .ap-actions{ display:flex; gap:8px; margin-top:8px; }
    .ap-btn{
      border-radius: 10px; padding: 10px 12px; border:1px solid #cbd5e1; background:#fff; cursor:pointer;
    }
    .ap-btn--primary{ background:#0f172a; color:#fff; border-color:#0f172a; }
    .ap-hint{ margin-top:10px; font-size:12px; color:#475569; min-height:16px; }
  `);

  document.head.appendChild(style);
  document.body.appendChild(panel);

  const $one  = panel.querySelector("#apOne");
  const $two  = panel.querySelector("#apTwo");
  const $save = panel.querySelector("#apSave");
  const $ref  = panel.querySelector("#apRefresh");
  const $hint = panel.querySelector("#apHint");
  const $x    = panel.querySelector(".ap-close");

  $x.addEventListener("click", () => { panel.remove(); });

  async function loadPrices(){
    $hint.textContent = "Cargando...";
    try{
      const r = await fetch("/api/plans");
      const d = await r.json();
      if (!r.ok) { $hint.textContent = d.error || "No se pudo cargar."; return; }

      // Buscamos planes por code ("1h" y "2h"). Si no existen, usamos fallback 300/500
      const one = (d.plans || []).find(p => p.code === "1h");
      const two = (d.plans || []).find(p => p.code === "2h");
      $one.value = one ? money(one.price_usd) : "300";
      $two.value = two ? money(two.price_usd) : "500";
      $hint.textContent = "Listo.";
    }catch(e){
      $hint.textContent = "Error de red.";
    }
  }

  async function savePrice(code, price){
    const r = await fetch("/api/admin/plans", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ code, price_usd: price })
    });
    const d = await r.json();
    if(!r.ok || !d.ok) throw new Error(d.error || "Error al guardar");
  }

  $ref.addEventListener("click", loadPrices);

  $save.addEventListener("click", async () => {
    const v1 = num($one.value);
    const v2 = num($two.value);
    if (v1 <= 0 || v2 <= 0){ $hint.textContent = "Ingresá valores mayores a 0."; return; }

    $save.disabled = true;
    $hint.textContent = "Guardando...";
    try{
      await savePrice("1h", v1);
      await savePrice("2h", v2);
      $hint.textContent = "Precios actualizados.";
      // opcional refrescar cards visibles si tu main.js las lee de /api/plans
      // window.location.reload(); // si querés refrescar toda la página
    }catch(e){
      $hint.textContent = e.message || "No autorizado (logueate en /admin).";
      alert($hint.textContent);
    }finally{
      $save.disabled = false;
    }
  });

  // Carga inicial
  loadPrices();
})();
