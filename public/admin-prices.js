// public/admin-prices.js
(function () {
  // --- solo admins: buscamos cookie admin_session=ok ---
  function hasAdminSession() {
    return /(?:^|;\s*)admin_session=ok(?:;|$)/.test(document.cookie || "");
  }
  if (!hasAdminSession()) return;

  // ---- helpers ----
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  function el(tag, attrs = {}, html) {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "style") Object.assign(n.style, attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  }

  // ---- estilos mínimos inyectados ----
  const css = `
  .ap-panel{
    position: relative;
    margin-top: 12px;
    background:#fff;
    border:1px solid #e5e7eb;
    border-radius:14px;
    padding:12px;
    box-shadow:0 10px 26px rgba(0,0,0,.06);
  }
  .ap-header{
    display:flex; justify-content:space-between; align-items:center; gap:10px;
    margin-bottom: 6px;
  }
  .ap-title{font-weight:800}
  .ap-row{
    display:grid; grid-template-columns:1fr 120px 120px; gap:10px; align-items:center;
    padding:8px 0; border-top:1px dashed #e5e7eb;
  }
  .ap-row:first-of-type{ border-top:0; }
  .ap-label{ font-weight:600 }
  .ap-input{
    width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:12px;
    font-size:14px;
  }
  .ap-btn{ cursor:pointer; border:0; border-radius:10px; padding:10px 12px; font-weight:700 }
  .ap-btn--save{ background:#0f172a; color:#fff }
  .ap-btn--reload{ background:#fff; border:1px solid #cbd5e1; }
  .ap-hint{ font-size:12px; color:#64748b; margin-top:6px; min-height:18px }
  .ap-badge{
    display:inline-flex; align-items:center; gap:8px;
    padding:8px 10px; border:1px solid #cbd5e1; border-radius:999px;
    background:#fff; cursor:pointer; font-weight:700;
  }
  .ap-wrap{
    margin:8px 0 0 0;
  }
  .ap-ok{ color:#16a34a; }
  .ap-err{ color:#b91c1c; }
  `;
  const style = el("style", {}, css);
  document.head.appendChild(style);

  // ---- UI: botón “Editar precios” y panel ----
  const preciosSection = document.getElementById("precios");
  if (!preciosSection) return;

  const container = preciosSection.querySelector(".container") || preciosSection;
  const badge = el("button", { class: "ap-badge", type: "button" }, "✎ Editar precios");
  const wrap = el("div", { class: "ap-wrap" });
  container.insertBefore(badge, container.firstElementChild?.nextSibling || null);
  container.insertBefore(wrap, badge.nextSibling);

  let open = false;
  badge.addEventListener("click", () => {
    open = !open;
    if (open) openPanel();
    else wrap.innerHTML = "";
  });

  async function openPanel() {
    wrap.innerHTML = "";
    const panel = el("div", { class: "ap-panel" });
    const head = el(
      "div",
      { class: "ap-header" },
      `<div class="ap-title">Editar precios (USD)</div>
       <div style="display:flex;gap:8px">
        <button type="button" class="ap-btn ap-btn--reload" id="apReload">Recargar</button>
       </div>`
    );
    const hint = el("div", { class: "ap-hint", id: "apHint" });

    panel.appendChild(head);

    // traer planes actuales
    const plans = await fetchPlans();
    if (!plans.length) {
      panel.appendChild(el("div", {}, "<em>No hay planes para editar.</em>"));
      panel.appendChild(hint);
      wrap.appendChild(panel);
      return;
    }

    plans.forEach((p) => {
      const row = el("div", { class: "ap-row" });
      const label = el("div", { class: "ap-label" }, escapeHtml(p.label || p.code));
      const input = el("input", {
        class: "ap-input",
        type: "number",
        step: "1",
        min: "0",
        value: Number(p.price_usd || 0).toFixed(0),
      });
      const save = el("button", { class: "ap-btn ap-btn--save", type: "button" }, "Guardar");

      save.addEventListener("click", async () => {
        hint.classList.remove("ap-ok", "ap-err");
        hint.textContent = "Guardando…";
        save.disabled = true;
        try {
          const ok = await savePrice({
            id: p.id,
            code: p.code,
            label: p.label,
            price_usd: Number(input.value),
          });
          if (ok) {
            hint.classList.add("ap-ok");
            hint.textContent = "Guardado. Actualizando tarjetas…";
            // refrescar tarjetas visibles (si las arma main.js) o recargar
            try {
              await refreshPricingCards();
              hint.textContent = "Listo ✅";
            } catch {
              location.reload();
            }
          } else {
            hint.classList.add("ap-err");
            hint.textContent = "No se pudo guardar.";
          }
        } catch {
          hint.classList.add("ap-err");
          hint.textContent = "Error de red al guardar.";
        } finally {
          save.disabled = false;
        }
      });

      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(save);
      panel.appendChild(row);
    });

    panel.appendChild(hint);
    wrap.appendChild(panel);

    $("#apReload", panel)?.addEventListener("click", async () => {
      wrap.innerHTML = "";
      await openPanel();
    });
  }

  async function fetchPlans() {
    try {
      const r = await fetch("/api/plans");
      const d = await r.json();
      return Array.isArray(d.plans) ? d.plans : [];
    } catch {
      return [];
    }
  }

  // En tu backend ya tenés /api/admin/plans (por tus capturas).
  // Esta llamada intenta upsert por id o code con action=update.
  async function savePrice({ id, code, label, price_usd }) {
    const body = { action: "update", price_usd };
    if (id != null) body.id = id;
    if (code != null) body.code = code;
    if (label != null) body.label = label;

    const r = await fetch("/api/admin/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    return r.ok && d.ok;
  }

  // Si tus tarjetas de precios las arma main.js desde /api/plans,
  // tratamos de re-render sin recargar (si existe esa función pública).
  async function refreshPricingCards() {
    // 1) si main.js expone render dinámico (como en tu proyecto), rehacemos:
    const cardsWrap = document.getElementById("pricingCards");
    if (!cardsWrap) return;

    const plans = await fetchPlans();
    // reconstrucción simple (igual a como se muestran)
    cardsWrap.innerHTML = "";
    plans.forEach((p, idx) => {
      const art = el("article", { class: "card" + (idx === 1 ? " card--featured" : "") });
      art.innerHTML = `
        <header class="card__head">
          <h3>${escapeHtml(p.label || p.code)}</h3>
          ${idx === 1 ? '<span class="badge">Más pedido</span>' : ""}
        </header>
        <p class="card__price">$${Number(p.price_usd).toFixed(0)} <span>USD</span></p>
        <ul class="card__list">
          <li>Operador incluido</li>
          <li>Colchonetas y seguridad</li>
          <li>Traslado en AMBA*</li>
        </ul>
        <a href="#calendario" class="btn btn--block ${idx === 1 ? "btn--primary" : ""}">Reservar</a>
      `;
      cardsWrap.appendChild(art);
    });
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
