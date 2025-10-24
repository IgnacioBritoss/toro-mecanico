// /public/reviews.js
// Unifica: feed público, envío con contraseña y panel admin (borrar reseñas)

(function (){
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, c => (
      {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]
    ));
  }
  function stars(v){
    const n = Math.max(1, Math.min(5, Number(v)||0));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }
  function fmtDate(iso){
    try{
      const d = new Date(iso);
      return d.toLocaleDateString('es-AR', { year:'numeric', month:'short', day:'numeric' });
    }catch{ return ''; }
  }

  /* ===== A) FEED PÚBLICO ===== */
  function initPublicFeed(){
    const strip = $('#reviewsStrip');
    const empty = $('#reviewsEmpty');
    const btnPrev = $('#revPrev');
    const btnNext = $('#revNext');
    if (!strip) return;

    function card({name, rating, comment, created_at}){
      const div = document.createElement('article');
      div.className = 'rev-card';
      div.innerHTML = `
        <div class="rev-stars" aria-label="${rating}/5">${stars(rating)}</div>
        <div class="rev-text">${escapeHtml(comment || '')}</div>
        <div class="rev-name">${escapeHtml(name || 'Anónimo')}</div>
        <div class="rev-date">${fmtDate(created_at)}</div>
      `;
      return div;
    }

    async function load(){
      try{
        const r = await fetch('/api/reserve?review=public', { cache: 'no-store' });
        const d = await r.json();
        if (!r.ok || !d?.ok) throw new Error(d?.error || 'fetch');

        const list = Array.isArray(d.reviews) ? d.reviews : [];
        strip.innerHTML = '';
        if (!list.length){
          empty.style.display = '';
          return;
        }
        empty.style.display = 'none';
        list.forEach(x => strip.appendChild(card(x)));
      }catch(e){
        if (empty){
          empty.textContent = 'No se pudieron cargar las reseñas.';
          empty.style.display = '';
        }
      }
    }

    btnPrev?.addEventListener('click', () => {
      strip.scrollBy({ left: -strip.clientWidth * 0.9, behavior: 'smooth' });
    });
    btnNext?.addEventListener('click', () => {
      strip.scrollBy({ left:  strip.clientWidth * 0.9, behavior: 'smooth' });
    });

    load();
  }

  /* ===== B) FORM PRIVADO (con modo QR opcional) ===== */
  function initPrivateForm(){
    const form = $('#reviewForm');
    if (!form) return;

    const pass = $('#revPass');
    const name = $('#revName');
    const text = $('#revText');
    const ratingInput = $('#revRating');
    const starsWrap = $('#revStars');
    const publish = $('#revPublish');
    const hint = $('#revHint');
    const btn = $('#revSend');

    // Detectar si vino por QR (?q=TOKEN). Si hay token, oculto el campo pass
    const params = new URLSearchParams(location.search);
    const qrToken = params.get('q');
    if (qrToken){
      const passLabel = document.querySelector('label[for="revPass"]') || pass?.closest("label");
      (passLabel || pass)?.style && ((passLabel || pass).style.display = "none");
      pass.value = "";
    }

    function paint(n){
      $$('#revStars button').forEach(b => {
        const v = Number(b.dataset.v);
        b.textContent = v <= n ? '★' : '☆';
      });
    }
    paint(Number(ratingInput?.value) || 5);

    starsWrap?.addEventListener('click', (e) => {
      const v = Number(e.target?.dataset?.v || 0);
      if (!v) return;
      ratingInput.value = String(v);
      paint(v);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hint.textContent = '';
      hint.className = 'hint';

      const payload = {
        pass: (pass?.value || '').trim(),
        name: (name?.value || '').trim(),
        rating: Number(ratingInput?.value || 5),
        comment: (text?.value || '').trim(),
        publish: !!publish?.checked
      };
      if (!qrToken && !payload.pass){ hint.textContent = 'Ingresá la contraseña.'; return; }
      if (!payload.comment){ hint.textContent = 'Escribí un comentario.'; return; }
      if (payload.rating < 1 || payload.rating > 5){ hint.textContent = 'Calificación inválida.'; return; }

      try{
        btn.disabled = true;
        hint.textContent = 'Enviando...';

        const headers = { 'Content-Type': 'application/json' };
        if (qrToken) headers['X-Review-QR'] = qrToken;

        const r = await fetch('/api/reserve?review=1', {
          method:'POST',
          headers,
          body: JSON.stringify(payload)
        });
        const d = await r.json().catch(()=>({}));
        if (!r.ok || !d?.ok){
          hint.textContent = d?.error || 'No se pudo guardar la reseña.';
          btn.disabled = false;
          return;
        }
        hint.textContent = '¡Gracias! Tu reseña fue enviada.';
        hint.className = 'ok';
        form.reset();
        ratingInput.value = '5';
        paint(5);
      }catch{
        hint.textContent = 'Error de red. Intentá de nuevo.';
      }finally{
        btn.disabled = false;
      }
    });
  }

  /* ===== C) ADMIN (borrar reseñas) ===== */
  function initAdminList(){
    const wrapSection = $('#reviewsAdmin');
    const list = $('#reviewsAdminList');
    const hint = $('#reviewsAdminHint');
    if (!wrapSection || !list) return;

    if (!window.ON_ADMIN || !window.IS_ADMIN) return;

    wrapSection.hidden = false;

    async function loadAll(){
      hint.textContent = 'Cargando reseñas…';
      list.innerHTML = '';
      try{
        const r = await fetch('/api/reserve?review=all', { method:'GET', cache:'no-store' });
        const d = await r.json();
        if (!r.ok || !d?.ok){
          hint.textContent = d?.error || ('Error ' + r.status);
          return;
        }
        hint.textContent = '';
        const arr = Array.isArray(d.reviews) ? d.reviews : [];
        if (!arr.length){
          list.innerHTML = `<article class="card"><p>No hay reseñas.</p></article>`;
          return;
        }
        list.innerHTML = '';
        arr.forEach(rv => {
          const art = document.createElement('article');
          art.className = 'card card--review-admin';
          const name = rv.name || 'Anónimo';
          const date = fmtDate(rv.created_at);
          art.innerHTML = `
            <header class="card__head">
              <strong>${escapeHtml(name)}</strong>
              <span class="muted">${date}</span>
            </header>
            <p class="review__stars" aria-label="${rv.rating} de 5">${stars(rv.rating)}</p>
            <p class="review__comment">${escapeHtml(rv.comment || '')}</p>
            <div class="row end">
              <button class="btn btn--danger" data-id="${rv.id}">Borrar</button>
            </div>
          `;
          const btn = art.querySelector('button[data-id]');
          btn.addEventListener('click', async () => {
            if (!confirm('¿Borrar esta reseña?')) return;
            btn.disabled = true;
            try{
              const resp = await fetch(`/api/reserve?review=delete&id=${encodeURIComponent(rv.id)}`, {
                method: 'DELETE',
                headers: { 'X-Admin': '1' }
              });
              const dj = await resp.json().catch(()=>({}));
              if (!resp.ok || !dj?.ok){
                alert(dj?.error || ('Error ' + resp.status));
                btn.disabled = false;
                return;
              }
              art.remove();
              if (!list.children.length){
                list.innerHTML = `<article class="card"><p>No hay reseñas.</p></article>`;
              }
            }catch(e){
              alert('Error de red');
              btn.disabled = false;
            }
          });
          list.appendChild(art);
        });
      }catch{
        hint.textContent = 'Error de red al cargar reseñas.';
      }
    }

    loadAll();
  }

  document.addEventListener('DOMContentLoaded', () => {
    initPublicFeed();
    initPrivateForm();
    initAdminList();
  });
})();
