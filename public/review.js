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

  // Evitar submit nativo accidental (por si el HTML tuviera action)
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
        if (form) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', {cancelable:true, bubbles:true}));
      }
    });
  });

  async function sendReview(){
    if (hint){ hint.textContent = ''; hint.className = 'hint'; }

    const payload = {
      // si es QR, no mandamos pass (se valida por header)
      pass: fromQR ? '' : (passInput?.value || '').trim(),
      name: (nameInput?.value || '').trim(),
      comment: (textInput?.value || '').trim(),
      rating: Number(ratingInp?.value || 5),
      // publish: true
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

      // headers: solo ponemos X-Review-QR cuando viene de QR
      const headers = { 'Content-Type': 'application/json' };
      if (fromQR) headers['X-Review-QR'] = qrToken;

      const r = await fetch('/api/reserve?review=1', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const d = await r.json().catch(()=> ({}));

      if (!r.ok || !d?.ok){
        if (hint){ hint.textContent = d?.error || `Error ${r.status}`; hint.className='err'; }
        if (btn) btn.disabled = false;
        return;
      }

      if (hint){ hint.textContent = '¡Gracias! Tu reseña fue enviada.'; hint.className='ok'; }
      if (form) form.reset();
      if (ratingInp) ratingInp.value = '5';
      paint(5);
    }catch(err){
      if (hint){ hint.textContent = 'Error de red. Intentá de nuevo.'; hint.className='err'; }
    }finally{
      if (btn) btn.disabled = false;
    }
  }
})();
