// Editor de precios para admin (inline)
// Activo con ?editprices=1 y sesión admin válida.

(function(){
  const wrapId = "pricingCards";

  // ==== Helpers de admin/CSRF ====
  function getCsrfToken(){
    const m = (document.cookie || "").match(/(?:^|;\s*)adm_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  async function isAdmin(){
    try{
      const r = await fetch('/api/admin/plans', { headers: { "x-csrf-token": getCsrfToken() }});
      return r.status !== 401;
    }catch{ return false; }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const wantsEdit = new URLSearchParams(location.search).has("editprices");
    if (!wantsEdit) return;
    if (!(await isAdmin())) return;

    try{
      // 1) Cargar planes admin (con id/price)
      const plans = await fetchPlansAdmin();

      // 2) Esperar a que main.js pinte las tarjetas
      await waitForCards();

      // 3) Inyectar editores
      enhanceCards(plans);
      injectNotice();
    }catch(e){
      console.error("admin-prices init error:", e);
    }
  });

  async function fetchPlansAdmin(){
    const r = await fetch('/api/admin/plans', { headers: { "x-csrf-token": getCsrfToken() }});
    if (!r.ok) throw new Error("No se pudieron cargar planes (admin).");
    const d = await r.json();
    return Array.isArray(d.plans) ? d.plans : [];
  }

  // Espera a que existan .card dentro de #pricingCards (máx 6s)
  function waitForCards(){
    const host = document.getElementById(wrapId);
    if (!host) return Promise.reject(new Error("#pricingCards no existe"));

    return new Promise((resolve, reject) => {
      const ready = () => host.querySelectorAll('.card').length > 0;
      if (ready()) return resolve();

      const obs = new MutationObserver(() => { if (ready()) { obs.disconnect(); resolve(); } });
      obs.observe(host, { childList: true, subtree: true });

      setTimeout(() => { obs.disconnect(); ready() ? resolve() : reject(new Error("Timeout esperando tarjetas")); }, 6000);
    });
  }

  function enhanceCards(plans){
    const host = document.getElementById(wrapId);
    const cards = host ? [...host.querySelectorAll('.card')] : [];
    if (!cards.length) return;

    // Asumimos el mismo orden DB → UI (como hace main.js). Si no, se podría
    // mapear por label aproximado.
    plans.forEach((p, idx) => {
      const card = cards[idx];
      if (!card) return;

      // Editor UI
      const editor = document.createElement('div');
      editor.className = "admin-editor";
      editor.style.marginTop = "10px";
      editor.innerHTML = `
        <div class="admin-editor__row">
          <label style="display:flex;align-items:center;gap:.5rem">
            <span>USD</span>
            <input type="number" min="0" step="1" value="${Number(p.price_usd).toFixed(0)}"
                   class="admin-editor__input" style="width:120px" />
          </label>
          <button class="admin-editor__save btn btn--primary" type="button">Guardar</button>
          <small class="admin-editor__hint hint" style="margin-left:.5rem"></small>
        </div>
      `;

      const priceEl = card.querySelector('.card__price');
      const saveBtn = editor.querySelector('.admin-editor__save');
      const input   = editor.querySelector('.admin-editor__input');
      const hint    = editor.querySelector('.admin-editor__hint');

      saveBtn.addEventListener('click', async () => {
        const val = Math.round(Number(input.value));
        if (!Number.isFinite(val) || val < 0){
          hint.textContent = "Precio inválido";
          return;
        }
        saveBtn.disabled = true;
        hint.textContent = "Guardando…";
        try{
          const res = await fetch('/api/admin/plans', {
            method: 'POST',
            headers: {
              'Content-Type':'application/json',
              'x-csrf-token': getCsrfToken()
            },
            body: JSON.stringify({ action:"update", id: p.id, price_usd: val })
          });
          const data = await res.json();
          if (!res.ok || !data.ok){
            hint.textContent = data?.error || `Error (${res.status})`;
            saveBtn.disabled = false;
            return;
          }
          // Optimista: actualizar UI
          if (priceEl) priceEl.innerHTML = `$${val.toFixed(0)} <span>USD</span>`;
          hint.textContent = "Guardado ✓";
          setTimeout(() => hint.textContent = "", 1200);
          saveBtn.disabled = false;
        }catch(e){
          hint.textContent = "Error de red";
          saveBtn.disabled = false;
        }
      });

      // Marcar tarjeta y pegar editor
      card.appendChild(editor);
      card.style.boxShadow = "0 0 0 2px rgba(59,130,246,.25)";
      card.style.position = "relative";
      const tag = document.createElement('span');
      tag.textContent = "Admin";
      tag.className = "badge";
      tag.style.position = "absolute";
      tag.style.top = "10px";
      tag.style.right = "10px";
      card.appendChild(tag);
    });
  }

  function injectNotice(){
    const title = document.querySelector('#precios .section__title');
    if (!title) return;
    const note = document.createElement('p');
    note.className = "hint";
    note.textContent = "Modo edición: podés actualizar el precio en USD de cada plan. (Solo visible para admin)";
    title.insertAdjacentElement('afterend', note);
  }
})();
