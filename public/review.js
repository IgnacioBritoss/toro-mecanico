// /public/review.js
(function(){
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const form = $('#reviewForm');
  if (!form) return;

  const title = $('#revTitle');
  const subtitle = $('#revSubtitle');

  const passLabel = $('#revPassLabel');
  const pass = $('#revPass');
  const name = $('#revName');
  const text = $('#revText');
  const ratingInput = $('#revRating');
  const starsWrap = $('#revStars');
  const publishWrap = $('#revPublishWrap');
  const publish = $('#revPublish');
  const hint = $('#revHint');
  const btn = $('#revSend');

  // Detectar QR (?q=TOKEN)
  const params = new URLSearchParams(location.search);
  const qrToken = params.get('q');

  // Si viene por QR: ocultar contraseña + “acepto publicar”, y ajustar textos
  if (qrToken) {
    if (passLabel) passLabel.style.display = 'none';
    if (publishWrap) publishWrap.style.display = 'none';
    if (publish) publish.checked = true; // forzar publish

    if (title) title.textContent = '¡Gracias por colaborar! ⭐';
    if (subtitle) subtitle.textContent = 'Ingresaste desde el QR. Podés dejarnos tu reseña sin ingresar contraseña.';
  }

  // estrellas
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
      publish: qrToken ? true : !!publish?.checked
    };

    if (!qrToken && !payload.pass){
      hint.textContent = 'Ingresá la contraseña.';
      return;
    }
    if (!payload.comment){
      hint.textContent = 'Escribí un comentario.';
      return;
    }
    if (payload.rating < 1 || payload.rating > 5){
      hint.textContent = 'Calificación inválida.';
      return;
    }

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
        // Si el server devolvió 401, mostrá mensaje claro
        if (r.status === 401) {
          hint.textContent = qrToken
            ? 'QR inválido o vencido.'
            : 'Contraseña inválida.';
        } else {
          hint.textContent = d?.error || 'No se pudo guardar la reseña.';
        }
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
})();
