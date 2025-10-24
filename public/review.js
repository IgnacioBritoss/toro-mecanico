(function(){
    const form = document.getElementById('reviewForm');
    const pass = document.getElementById('revPass');
    const name = document.getElementById('revName');
    const text = document.getElementById('revText');
    const ratingInput = document.getElementById('revRating');
    const stars = document.getElementById('revStars');
    const publish = document.getElementById('revPublish');
    const hint = document.getElementById('revHint');
    const btn = document.getElementById('revSend');
  
    // estrellas
    function paint(n){
      [...stars.querySelectorAll('button')].forEach(btn => {
        const v = Number(btn.dataset.v);
        btn.textContent = v <= n ? '★' : '☆';
      });
    }
    paint(Number(ratingInput.value) || 5);
  
    stars.addEventListener('click', (e) => {
      const v = Number(e.target?.dataset?.v || 0);
      if (!v) return;
      ratingInput.value = String(v);
      paint(v);
    });
  
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hint.textContent = '';
      const payload = {
        pass: (pass.value || '').trim(),
        name: (name.value || '').trim(),
        rating: Number(ratingInput.value || 5),
        comment: (text.value || '').trim(),
        publish: !!publish.checked
      };
      if (!payload.pass){ hint.textContent = 'Ingresá la contraseña.'; return; }
      if (!payload.comment){ hint.textContent = 'Escribí un comentario.'; return; }
      if (payload.rating < 1 || payload.rating > 5){ hint.textContent = 'Calificación inválida.'; return; }
  
      try{
        btn.disabled = true;
        hint.textContent = 'Enviando...';
        const r = await fetch('/api/reserve?review=1', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        });
        const d = await r.json().catch(()=>({}));
        if (!r.ok){ hint.textContent = d?.error || 'No se pudo guardar la reseña.'; btn.disabled = false; return; }
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
  