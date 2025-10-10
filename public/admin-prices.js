/* public/admin-prices.js
   Editor liviano para modificar precios de planes desde el sitio.
   - Lee planes públicos desde /api/plans
   - Guarda cambios (de a uno) en /api/admin/plans  { action:'update', id, price_usd }
   - Muestra UI solo si hay sesión admin (cookie) o si la URL tiene ?editprices (debug)
*/

// ---- DEBUG: ?editprices fuerza el editor aunque no haya cookie ----
const __DEBUG_SHOW_PRICES__ = new URLSearchParams(location.search).has("editprices");

function hasAdminSession() {
  if (__DEBUG_SHOW_PRICES__) return true;
  const c = document.cookie || "";
  return /(?:^|;\s*)admin_session=ok(?:;|$)/.test(c);
}

function $id(id){ return document.getElementById(id); }
function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function fetchPublicPlans(){
  try{
    const r = await fetch('/api/plans');
    if(!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.plans) ? d.plans : [];
  }catch{
    return [];
  }
}

async function savePlanPrice(id, price){
  const body = { action:'update', id, price_usd: Number(price) };
  const r = await fetch('/api/admin/plans', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  const d = await r.json().catch(()=> ({}));
  return { ok: r.ok && d?.ok, data: d };
}

function injectStylesOnce(){
  if ($id('apc-styles')) return;
  const css = `
  .apc-wrap{
    position: relative;
  }
  .apc-btn{
    position: absolute;
    top: -8px;
    right: 0;
    transform: translateY(-100%);
    background:#111827; color:#fff; border:0; border-radius:12px;
    padding:10px 12px; font-weight:700; cursor:pointer;
    box-shadow:0 8px 24px rgba(0,0,0,.12);
  }
  .apc-panel{
    margin:12px 0 4px;
    border:1px solid #e2e8f0; border-radius:14px; background:#fff;
    box-shadow:0 8px 24px rgba(15,23,42,.08);
    padding:12px;
  }
  .apc-row{
    display:grid; grid-template-columns: 1fr auto 110px; gap:10px; align-items:center;
    padding:8px; border-radius:10px;
  }
  .apc-row + .apc-row{ margin-top:6px; }
  .apc-row:hover{ background:#f8fafc; }
  .apc-label{ font-weight:700; }
  .apc-input{
    width:120px; max-width:100%;
    border:1px solid #cbd5e1; border-radius:10px; padding:8px 10px; text-align:right;
  }
  .apc-save{
    background:#0f172a; color:#fff; border:0; border-radius:10px; padding:8px 10px; cursor:pointer; font-weight:700;
  }
  .apc-hint{ color:#475569; font-size:12px; margin-top:8px; }
  @media (max-width: 560px){
    .apc-row{ grid-template-columns: 1fr 1fr; }
    .apc-input{ width:100%; }
  }
  `;
  const el = document.createElement('style');
  el.id = 'apc-styles';
  el.textContent = css;
  document.head.appendChild(el);
}

function formatMoney(n){
  const v = Number(n||0);
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function patchPricingCards(plans){
  // Si tus tarjetas ya se renderizan con main.js desde /api/plans, no hace falta tocar nada.
  // Este refuerzo asegura que los precios del HTML visible coincidan con el último fetch.
  const cardsWrap = document.querySelector('#precios .cards');
  if (!cardsWrap) return;

  // Map por label (1 hora, 2 horas) y por code si lo tenés.
  const mapByLabel = new Map(plans.map(p => [String(p.label||'').trim().toLowerCase(), p]));
  const priceEls = cardsWrap.querySelectorAll('.card');

  priceEls.forEach(card => {
    const title = (card.querySelector('h3')?.textContent || '').trim().toLowerCase();
    const p = mapByLabel.get(title);
    if (p){
      const priceEl = card.querySelector('.card__price');
      if (priceEl){
        // Reemplaza solo el número grande
        const strong = priceEl.querySelector('strong');
        if (strong) strong.textContent = `$${formatMoney(p.price_usd)}`;
        else priceEl.innerHTML = `<strong>$${formatMoney(p.price_usd)}</strong> <span>USD</span>`;
      }
    }
  });
}

function buildEditor(plans){
  const preciosSec = $id('precios');
  if (!preciosSec) return;

  injectStylesOnce();

  // envoltorio para posicionar el botón
  let wrap = preciosSec.querySelector('.apc-wrap');
  if (!wrap){
    wrap = document.createElement('div');
    wrap.className = 'apc-wrap';
    // insertamos al comienzo del contenedor para que el botón quede encima del bloque
    const cont = preciosSec.querySelector('.container') || preciosSec;
    cont.prepend(wrap);
  }

  // Botón
  let btn = wrap.querySelector('.apc-btn');
  if (!btn){
    btn = document.createElement('button');
    btn.className = 'apc-btn';
    btn.type = 'button';
    btn.textContent = '✎ Editar precios';
    wrap.appendChild(btn);
  }

  // Panel (oculto por defecto)
  let panel = wrap.querySelector('.apc-panel');
  if (!panel){
    panel = document.createElement('div');
    panel.className = 'apc-panel';
    panel.style.display = 'none';
    wrap.appendChild(panel);
  }

  // Render filas
  panel.innerHTML = '';
  plans.forEach(p => {
    const row = document.createElement('div');
    row.className = 'apc-row';
    row.innerHTML = `
      <div class="apc-label">${esc(p.label)} <small style="color:#64748b">(${esc(p.code || p.id)})</small></div>
      <input class="apc-input" type="number" min="0" step="1" value="${Number(p.price_usd).toFixed(0)}" />
      <button class="apc-save" type="button">Guardar</button>
    `;
    const input = row.querySelector('.apc-input');
    const save  = row.querySelector('.apc-save');

    save.addEventListener('click', async () => {
      const val = Number(input.value);
      if (Number.isNaN(val) || val < 0){ alert('Precio inválido'); return; }
      save.disabled = true; save.textContent = '...';
      try{
        const res = await savePlanPrice(p.id, val);
        if(!res.ok){
          const err = res.data?.error || 'No se pudo guardar. ¿Sesión admin?';
          alert(err);
        }else{
          // Refrescar tarjetas visibles y feedback
          p.price_usd = val;
          patchPricingCards(plans);
          save.textContent = 'Guardado ✓';
          setTimeout(()=> save.textContent = 'Guardar', 1200);
        }
      }catch{
        alert('Error de red');
      }finally{
        save.disabled = false;
      }
    });

    panel.appendChild(row);
  });

  const hint = document.createElement('div');
  hint.className = 'apc-hint';
  hint.textContent = 'Los cambios impactan en toda la web. Guardá plan por plan.';
  panel.appendChild(hint);

  // Toggle
  btn.addEventListener('click', () => {
    panel.style.display = (panel.style.display === 'none') ? 'block' : 'none';
    btn.textContent = panel.style.display === 'none' ? '✎ Editar precios' : '✕ Cerrar editor';
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Si no hay sesión admin y no está el flag de debug, no mostramos nada
  if (!hasAdminSession()) return;

  const plans = await fetchPublicPlans();
  if (!plans.length) return;

  // Asegurar que las tarjetas coincidan con lo que vamos a editar (por si aún no estaban render)
  patchPricingCards(plans);

  // Construir UI de edición
  buildEditor(plans);

  console.debug('[admin-prices] listo. planes:', plans);
});
