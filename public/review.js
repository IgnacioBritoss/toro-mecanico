(function(){
  const qs = new URLSearchParams(location.search);
  const qrToken = (qs.get('q') || '').trim();      // si viene de QR: ?q=rvQR_...
  const fromQR  = qrToken.length > 0;

  const form      = document.getElementById('reviewForm');
  const passWrap  = document.getElementById('passWrap');
  const passInput = document.getElementById('revPass');
  const nameInput = document.getElementById('revName');
  const textInput = document.getElementById('revText');
  const ratingInp = document.getElementById('revRating');
  const starsBox  = document.getElementById('revStars');
  const hint      = document.getElementById('revHint');
  const btn       = document.getElementById('revSend');

  // Si viene con ?q=... (QR): ocultar password
  if (fromQR && passWrap) passWrap.classList.add('hide');

  // Estrellas
  function paint(n){
    if (!starsBox) return;
    const btns = starsBox.querySelectorAll('button');
    btns.forEach(b => {
      const v = Number(b.dataset.v);
      b.textContent = v <= n ? '★' : '☆';
    });
  }
  paint(Number(ratingInp?.value) || 5);

  if (starsBox){
    starsBox.addEventListener('click', (e) => {
      const v = Number(e.target?.dataset?.v || 0);
      if (!v) return;
      if (ratingInp) ratingInp.value = String(v);
      paint(v);
    });
  }

  if (form){
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await sendReview();
      return false;
    });
  }

  // Enter en inputs => mandar
  [passInput, nameInput, textInput].forEach(el=>{
    if (!el) return;
    el.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){
        e.preventDefault();
        form?.requestSubmit?.();
      }
    });
  });

  async function sendReview(){
    if (hint){ hint.textContent = ''; hint.className = 'hint'; }

    const payload = {
      pass: fromQR ? '' : (passInput?.value || '').trim(),
      name: (nameInput?.value || '').trim(),
      comment: (textInput?.value || '').trim(),
      rating: Number(ratingInp?.value || 5),
    };

    // Validaciones UX
    if (!fromQR && !payload.pass){
      if (hint){ hint.textContent = 'Ingresá la contraseña.'; hint.className='err'; }
      return;
    }
    if (!payload.comment || payload.comment.length < 3){
      if (hint){ hint.textContent = 'Escribí un comentario.'; hint.className='err'; }
      return;
    }
    if (!Number.isFinite(payload.rating) || payload.rating < 1 || payload.rating > 5){
      if (hint){ hint.textContent = 'Calificación inválida.'; hint.className='err'; }
      return;
    }

    try{
      if (btn) btn.disabled = true;
      if (hint){ hint.textContent = 'Enviando...'; hint.className='hint'; }

      const headers = { 'Content-Type': 'application/json' };
      if (fromQR) headers['X-Review-QR'] = qrToken;

      const r = await fetch('/api/reserve?review=1', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      // Intentamos JSON; si falla, mostramos texto para ver el error completo.
      let d = null;
      const rawText = await r.text();
      try { d = JSON.parse(rawText); } catch { d = null; }

      if (!r.ok || !d?.ok){
        const msg = (d && (d.error || d.message)) ? (d.error || d.message) : `Error ${r.status}`;
        const extra = d?.detail ? ` (${d.detail})` :
                      (d?.code ? ` (${d.code})` :
                      (rawText && rawText !== '' ? ` — ${rawText}` : ''));
        if (hint){ hint.textContent = msg + extra; hint.className='err'; }
        if (btn) btn.disabled = false;
        return;
      }

      if (hint){ hint.textContent = '¡Gracias! Tu reseña fue enviada.'; hint.className='ok'; }
      form?.reset();
      if (ratingInp) ratingInp.value = '5';
      paint(5);
    }catch(err){
      if (hint){ hint.textContent = 'Error de red. Intentá de nuevo.'; hint.className='err'; }
    }finally{
      if (btn) btn.disabled = false;
    }
  }
})();
