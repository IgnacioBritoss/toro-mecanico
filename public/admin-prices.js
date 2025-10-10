// public/admin-prices.js

(function(){
  const qs = new URLSearchParams(location.search);
  const wantsEdit = qs.get('editprices') === '1';

  // nodo helper
  const $ = (sel, ctx=document) => ctx.querySelector(sel);

  async function ensureAdmin() {
    try {
      // ping usando un endpoint protegido
      const r = await fetch('/api/admin/plans', { method: 'GET' });
      if (r.status === 401) return false;
      // 200 => ok (o 204/empty)
      return true;
    } catch {
      return false;
    }
  }

  async function loadPlansForEdit() {
    const r = await fetch('/api/admin/plans');
    if (!r.ok) throw new Error('No se pudieron cargar los planes');
    const d = await r.json();
    return Array.isArray(d.plans) ? d.plans : [];
  }

  async function savePlanPrice(id, newPrice) {
    const r = await fetch('/api/admin/plans', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ action:'update', id, price_usd: Number(newPrice) })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || 'No se pudo guardar');
  }

  // Crea una barrita flotante simple arriba de la sección Precios
  function renderEditor(plans){
    // contenedor
    const holder = document.createElement('div');
    holder.id = 'tm-admin-editor';
    holder.style.position = 'sticky';
    holder.style.top = '8px';
    holder.style.zIndex = '50';
    holder.style.margin = '24px auto';
    holder.style.maxWidth = '1100px';
    holder.style.background = '#fff';
    holder.style.border = '1px solid #e5e7eb';
    holder.style.borderRadius = '16px';
    holder.style.padding = '16px';
    holder.style.boxShadow = '0 8px 24px rgba(0,0,0,.06)';
    holder.style.display = 'flex';
    holder.style.alignItems = 'center';
    holder.style.gap = '12px';

    // cerrar
    const close = document.createElement('button');
    close.textContent = '✕ Cerrar editor';
    close.className = 'btn';
    close.style.marginLeft = 'auto';
    close.onclick = () => {
      const url = new URL(location.href);
      url.searchParams.delete('editprices');
      location.href = url.toString();
    };
    // filas por plan
    const rowsWrap = document.createElement('div');
    rowsWrap.style.display = 'grid';
    rowsWrap.style.gridTemplateColumns = '1fr auto';
    rowsWrap.style.gap = '10px 12px';
    rowsWrap.style.flex = '1';

    plans.forEach(p => {
      const label = document.createElement('div');
      label.textContent = `${p.label}`;
      label.style.fontWeight = '600';

      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '8px';
      right.style.alignItems = 'center';

      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = '0';
      inp.step = '1';
      inp.value = Number(p.price_usd || 0).toFixed(0);
      inp.style.width = '110px';
      inp.style.padding = '8px 10px';
      inp.style.border = '1px solid #e5e7eb';
      inp.style.borderRadius = '10px';
      inp.setAttribute('aria-label', `USD para ${p.label}`);

      const save = document.createElement('button');
      save.textContent = 'Guardar';
      save.className = 'btn btn--primary';
      save.style.padding = '8px 14px';

      save.onclick = async () => {
        try{
          save.disabled = true;
          await savePlanPrice(p.id, inp.value);
          save.textContent = 'Guardado ✓';
          setTimeout(() => (save.textContent = 'Guardar', save.disabled=false), 1200);
          // refrescar cards mostradas al público
          try { window.__tm_refresh_plans__ && window.__tm_refresh_plans__(); } catch {}
        }catch(e){
          alert(e.message || 'Error al guardar');
          save.disabled = false;
        }
      };

      right.appendChild(inp);
      right.appendChild(save);

      rowsWrap.appendChild(label);
      rowsWrap.appendChild(right);
    });

    holder.appendChild(rowsWrap);
    holder.appendChild(close);

    // insertar antes de la sección de precios (o al inicio)
    const precios = document.getElementById('precios');
    const parent = precios?.parentElement || document.querySelector('.container') || document.body;
    parent.insertBefore(holder, precios || parent.firstChild);
  }

  async function boot(){
    if (!wantsEdit) return; // sólo si ?editprices=1

    const ok = await ensureAdmin();
    if (!ok) {
      // no logueado => manda a /admin para hacer el flujo (se reescribe a /?editprices=1)
      location.href = '/admin';
      return;
    }

    try {
      const plans = await loadPlansForEdit();
      renderEditor(plans);
    } catch (e) {
      console.error(e);
      alert('No se pudo inicializar el editor de precios.');
    }
  }

  document.addEventListener('DOMContentLoaded', boot);

  // hook público para refrescar cards después de guardar
  window.__tm_refresh_plans__ = async function(){
    try{
      const r = await fetch('/api/plans');
      const d = await r.json();
      if (Array.isArray(d.plans)) {
        // si tu main.js tiene renderPricingCards/plans, reúsalo
        if (typeof renderPricingCards === 'function') renderPricingCards(d.plans);
        if (typeof renderPlanRadios === 'function')  renderPlanRadios(d.plans);
      }
    }catch{}
  };
})();
