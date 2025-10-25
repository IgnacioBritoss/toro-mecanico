/* ==========================================================
   MÓDULO 1 — Envío de reseñas (/review)
   - Soporta pass o QR (?q=… -> header X-Review-QR)
   - Validaciones front
   - Mensajes claros con detalle de error del backend
   ========================================================== */
(function(){
  const qs = new URLSearchParams(location.search);
  const qrToken = (qs.get('q') || '').trim();
  const fromQR  = qrToken.length > 0;

  const form      = document.getElementById('reviewForm');
  if (!form) return; // <- este módulo solo corre en la página de reseñas

  const passWrap  = document.getElementById('passWrap');
  const passInput = document.getElementById('revPass');
  const nameInput = document.getElementById('revName');
  const textInput = document.getElementById('revText');
  const ratingInp = document.getElementById('revRating');
  const starsBox  = document.getElementById('revStars');
  const hint      = document.getElementById('revHint');
  const btn       = document.getElementById('revSend');

  if (fromQR && passWrap) passWrap.classList.add('hide');

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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await sendReview();
    return false;
  });

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

/* ==========================================================
   MÓDULO 2 — Feed público + Panel admin (home/index)
   - Auto-detecta modo admin
   - En admin muestra botón "X" para borrar en cada tarjeta
   ========================================================== */
(function(){
  const strip     = document.getElementById("reviewsStrip");
  const empty     = document.getElementById("reviewsEmpty");
  const btnPrev   = document.getElementById("revPrev");
  const btnNext   = document.getElementById("revNext");
  const adminSection = document.getElementById("reviewsAdmin");
  const adminList    = document.getElementById("reviewsAdminList");
  const adminHint    = document.getElementById("reviewsAdminHint");

  // si no existe el contenedor ni la sección admin, no estamos en el home -> salir
  if (!strip && !adminSection) return;

  // ---------- Detección de admin (robusta) ----------
  function hasCookieFlag() {
    // busca tm_admin=1 o tm_is_admin=1 en cookies no httpOnly
    return document.cookie.split(";").some(c => {
      const [k,v] = c.trim().split("=");
      return (k === "tm_admin" || k === "tm_is_admin") && v === "1";
    });
  }
  function isAdminNow(){
    return (
      // clase en body
      document.body.classList.contains("is-admin") ||
      document.body.classList.contains("admin-mode") ||
      // claves comunes en localStorage que tal vez use tu login
      localStorage.getItem("tm_is_admin") === "1" ||
      localStorage.getItem("tm_admin") === "1" ||
      localStorage.getItem("tm_admin_ok") === "1" ||
      !!localStorage.getItem("tm_admin_jwt") ||
      // cookie simple
      hasCookieFlag()
    );
  }
  let IS_ADMIN = isAdminNow();

  // Re-render si cambia el modo admin (por login en otro script o en otra pestaña)
  window.addEventListener("storage", (e) => {
    if (!e.key) return;
    const before = IS_ADMIN;
    IS_ADMIN = isAdminNow();
    if (before !== IS_ADMIN) bootstrap();   // vuelve a cargar feed/panel
  });
  // si tu login dispara un evento custom, lo escuchamos
  window.addEventListener("tm:admin:ready", () => { const b=IS_ADMIN; IS_ADMIN=isAdminNow(); if (b!==IS_ADMIN) bootstrap(); });
  window.addEventListener("tm:admin:logout", () => { const b=IS_ADMIN; IS_ADMIN=isAdminNow(); if (b!==IS_ADMIN) bootstrap(); });

  // ---------- Utilidades ----------
  function stars(n) {
    const on = "★".repeat(Math.max(0, Math.min(5, n|0)));
    const off = "☆".repeat(5 - on.length);
    return on + off;
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString("es-AR",{day:"2-digit",month:"short",year:"numeric"}); }
    catch { return ""; }
  }

  // ---------- Feed (público para users; completo para admin) ----------
  async function loadFeed() {
    if (!strip) return;
    try {
      const url  = IS_ADMIN ? "/api/reserve?review=all"    : "/api/reserve?review=public";
      const opts = IS_ADMIN ? { headers: { "X-Admin": "1" }} : undefined;
      const r = await fetch(url, opts);
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || "No se pudieron cargar las reseñas");

      const rows  = Array.isArray(d.reviews) ? d.reviews : [];
      const items = IS_ADMIN ? rows.filter(x => x.publish !== false) : rows;

      strip.innerHTML = "";
      if (!items.length) {
        if (empty) { empty.style.display = "block"; }
        return;
      }
      if (empty) empty.style.display = "none";

      for (const it of items) {
        const card = document.createElement("article");
        card.className = "rev-card";
        card.innerHTML = `
          <div class="rev-stars" aria-label="Calificación: ${it.rating} de 5">${stars(it.rating)}</div>
          <p class="rev-text">${(it.comment || "").replace(/\n/g, "<br/>")}</p>
          <div class="rev-name">${it.name ? it.name : "Anónimo"}</div>
          <div class="rev-date">${fmtDate(it.created_at)}</div>
        `;

        // Botón X solo para admin
        if (IS_ADMIN && it.id) {
          const btnDel = document.createElement("button");
          btnDel.className = "rev-del";
          btnDel.type = "button";
          btnDel.title = "Eliminar reseña";
          btnDel.setAttribute("aria-label", `Eliminar reseña #${it.id}`);
          btnDel.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7A1 1 0 0 0 5.7 7.1L10.6 12l-4.9 4.9a1 1 0 1 0 1.4 1.4L12 13.4l4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"/>
            </svg>
          `;
          btnDel.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            if (!confirm(`¿Eliminar reseña #${it.id}?`)) return;
            try {
              const rr = await fetch(`/api/reserve?review=delete&id=${encodeURIComponent(it.id)}`, {
                method: "DELETE",
                headers: { "X-Admin": "1" }
              });
              const dd = await rr.json();
              if (!rr.ok || !dd?.ok) throw new Error(dd?.error || "No se pudo eliminar");
              card.remove();
              if (adminHint) adminHint.textContent = `Reseña #${it.id} eliminada.`;
            } catch (e) { alert(e.message || "Error al eliminar"); }
          });
          card.appendChild(btnDel);
        }

        strip.appendChild(card);
      }
    } catch (e) {
      if (empty) { empty.textContent = "No se pudieron cargar las reseñas."; empty.style.display = "block"; }
      console.error(e);
    }
  }

  // ---------- Panel admin (lista completa con borrar) ----------
  async function loadAdminPanel() {
    if (!adminSection || !adminList) return;
    if (!IS_ADMIN) { adminSection.hidden = true; adminList.innerHTML = ""; return; }

    adminSection.hidden = false;
    adminHint.textContent = "Cargando…";
    try {
      const r = await fetch("/api/reserve?review=all", { headers: { "X-Admin": "1" } });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || "No se pudieron cargar");

      const rows = Array.isArray(d.reviews) ? d.reviews : [];
      adminList.innerHTML = "";
      if (!rows.length) { adminHint.textContent = "No hay reseñas aún."; return; }
      adminHint.textContent = "";

      for (const it of rows) {
        const item = document.createElement("div");
        item.className = "rev-card";
        item.dataset.id = it.id;
        item.innerHTML = `
          <div class="rev-stars">${stars(it.rating)}</div>
          <p class="rev-text" style="white-space:pre-wrap">${it.comment || ""}</p>
          <div class="rev-name">${it.name || "Anónimo"}</div>
          <div class="rev-date">#${it.id} • ${fmtDate(it.created_at)} • ${it.publish ? "publicada" : "oculta"}</div>
          <div style="display:flex; gap:8px; margin-top:6px">
            <button class="btn btn--icon" data-act="del" aria-label="Eliminar">🗑️</button>
          </div>
        `;
        item.querySelector('[data-act="del"]').addEventListener("click", async () => {
          if (!confirm(`¿Eliminar reseña #${it.id}?`)) return;
          try {
            const rr = await fetch(`/api/reserve?review=delete&id=${encodeURIComponent(it.id)}`, {
              method: "DELETE",
              headers: { "X-Admin": "1" }
            });
            const dd = await rr.json();
            if (!rr.ok || !dd?.ok) throw new Error(dd?.error || "No se pudo eliminar");
            item.remove();
            adminHint.textContent = `Reseña #${it.id} eliminada.`;
          } catch (e) { adminHint.textContent = e.message || "Error al eliminar"; }
        });
        adminList.appendChild(item);
      }
    } catch (e) {
      adminHint.textContent = e.message || "Error cargando reseñas";
      console.error(e);
    }
  }

  // ---------- Navegación horizontal ----------
  if (btnPrev && strip) btnPrev.addEventListener("click", () => strip.scrollBy({ left: -320, behavior: "smooth" }));
  if (btnNext && strip) btnNext.addEventListener("click", () => strip.scrollBy({ left:  320, behavior: "smooth" }));

  // ---------- Orquestador ----------
  function bootstrap(){
    loadFeed();
    loadAdminPanel();
  }
  document.addEventListener("DOMContentLoaded", bootstrap);

  // (Dev helper opcional): Alt+Shift+A para togglear admin localmente
  document.addEventListener("keydown", (e)=>{
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === "a"){
      const newVal = localStorage.getItem("tm_is_admin")==="1" ? "0" : "1";
      localStorage.setItem("tm_is_admin", newVal);
      const before = IS_ADMIN;
      IS_ADMIN = isAdminNow();
      if (before !== IS_ADMIN) bootstrap();
    }
  });
})();
