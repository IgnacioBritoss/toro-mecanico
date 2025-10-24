(function(){
    const strip = document.getElementById('reviewsStrip');
    const empty = document.getElementById('reviewsEmpty');
    const btnPrev = document.getElementById('revPrev');
    const btnNext = document.getElementById('revNext');
  
    function stars(n){
      const v = Math.max(1, Math.min(5, Number(n)||0));
      return '★'.repeat(v) + '☆'.repeat(5 - v);
    }
    function fmtDate(iso){
      try{
        const d = new Date(iso);
        return d.toLocaleDateString('es-AR', { year:'numeric', month:'short', day:'numeric' });
      }catch{ return ''; }
    }
  
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
  
    function escapeHtml(s){
      return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
  
    async function load(){
      try{
        const r = await fetch('/api/reserve?review=public', { cache: 'no-store' });
        const d = await r.json();
        if (!r.ok || !d?.ok){ throw new Error(d?.error || 'fetch'); }
  
        const list = Array.isArray(d.reviews) ? d.reviews : [];
        strip.innerHTML = '';
        if (!list.length){
          empty.style.display = '';
          return;
        }
        empty.style.display = 'none';
        list.forEach(x => strip.appendChild(card(x)));
      }catch(e){
        empty.textContent = 'No se pudieron cargar las reseñas.';
        empty.style.display = '';
      }
    }
  
    btnPrev?.addEventListener('click', () => { strip.scrollBy({ left: -strip.clientWidth * 0.9, behavior: 'smooth' }); });
    btnNext?.addEventListener('click', () => { strip.scrollBy({ left:  strip.clientWidth * 0.9, behavior: 'smooth' }); });
  
    // init
    load();
  })();
  