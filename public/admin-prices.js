// public/admin-prices.js
(function(){
  const qs = new URLSearchParams(location.search);
  const wantsEdit = qs.get('editprices') === '1';

  const $ = (sel, ctx=document) => ctx.querySelector(sel);

  async function ensureAdmin() {
    try {
      const r = await fetch('/api/admin/plans', { method: 'GET' });
      if (r.status === 401) return false;
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

  // Editor FIJO (no sticky) debajo del título "Precios"
  function renderEditor(plans){
    const preciosSec = document.getElementById('precios');
    const container  = $('.container', preciosSec) || preciosSec;
    const titleH2    = $('.section__title', container);

    const holder = document.createElement('aside');
    holder.id = 'tm-admin-editor';
    holder.setAttribute('aria-label','Editor de precios');
    // SIN sticky
    holder.style.position = 'relative';
    holder.style.zIndex = '1';
    holder.style.background = '#ffffff';
    holder.style.border = '1px solid #e5e7eb';
    holder.style.borderRadius = '16px';
    holder.style.padding = '16px';
    holder.style.margin = '12px 0 20px';
    holder.style.boxShadow = '0 8px 24px rgba(0,0,0,.06)';

    const rowsWrap = document.createElement('div');
    rowsWrap.style.display = 'grid';
    rowsWrap.style.gridTemplateColumns = '1fr auto';
    rowsWrap.style.gap = '10px 12px';

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

    // Insertar justo DESPUÉS del h2 de Precios
    if (titleH2 && titleH2.parentNode){
      titleH2.parentNode.insertBefore(holder, titleH2.nextSibling);
    } else if (container){
      container.insertBefore(holder, container.firstChild);
    } else {
      document.body.insertBefore(holder, document.body.firstChild);
    }
  }

  async function boot(){
    if (!wantsEdit) return; // solo si ?editprices=1

    const ok = await ensureAdmin();
    if (!ok) {
      location.href = '/admin'; // fuerza login si no hay sesión
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
        if (typeof renderPricingCards === 'function') renderPricingCards(d.plans);
        if (typeof renderPlanRadios === 'function')  renderPlanRadios(d.plans);
      }
    }catch{}
  };
})();
