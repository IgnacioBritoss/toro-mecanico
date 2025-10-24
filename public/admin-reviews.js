// public/admin-reviews.js

(async function initAdminReviews(){
    // Solo mostrar si estamos en modo admin (mismo criterio que usás en otras secciones):
    const wrapSection = document.getElementById("reviewsAdmin");
    const list = document.getElementById("reviewsAdminList");
    const hint = document.getElementById("reviewsAdminHint");
    if (!wrapSection || !list) return;
  
    // Mostramos la sección SOLO si está el modo admin (tu main.js deja window.IS_ADMIN)
    if (!window.ON_ADMIN) return;        // sólo en /admin o con ?edit...
    if (!window.IS_ADMIN) return;        // confirmado admin
    wrapSection.hidden = false;
  
    async function loadAll(){
      hint.textContent = "Cargando reseñas…";
      list.innerHTML = "";
      try{
        const r = await fetch("/api/reserve?review=all", { method:"GET" });
        const d = await r.json();
        if (!r.ok || !d.ok){
          hint.textContent = d?.error || ("Error " + r.status);
          return;
        }
        hint.textContent = "";
        if (!Array.isArray(d.reviews) || !d.reviews.length){
          list.innerHTML = `<article class="card"><p>No hay reseñas.</p></article>`;
          return;
        }
        list.innerHTML = "";
        d.reviews.forEach(rv => {
          const art = document.createElement("article");
          art.className = "card card--review-admin";
          const stars = "★".repeat(rv.rating) + "☆".repeat(5 - rv.rating);
          const name = rv.name || "Anónimo";
          const date = new Date(rv.created_at).toLocaleDateString("es-AR");
          art.innerHTML = `
            <header class="card__head">
              <strong>${name}</strong>
              <span class="muted">${date}</span>
            </header>
            <p class="review__stars" aria-label="${rv.rating} de 5">${stars}</p>
            <p class="review__comment">${(rv.comment || "").replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</p>
            <div class="row end">
              <button class="btn btn--danger" data-id="${rv.id}">Borrar</button>
            </div>
          `;
          const btn = art.querySelector("button[data-id]");
          btn.addEventListener("click", async () => {
            if (!confirm("¿Borrar esta reseña?")) return;
            btn.disabled = true;
            try{
              const resp = await fetch(`/api/reserve?review=delete&id=${encodeURIComponent(rv.id)}`, {
                method: "DELETE",
                headers: { "X-Admin": "1" }   // mismo header que usás en otras partes
              });
              const dj = await resp.json();
              if (!resp.ok || !dj.ok){
                alert(dj?.error || ("Error " + resp.status));
                btn.disabled = false;
                return;
              }
              art.remove();
              if (!list.children.length){
                list.innerHTML = `<article class="card"><p>No hay reseñas.</p></article>`;
              }
            }catch(e){
              alert("Error de red");
              btn.disabled = false;
            }
          });
          list.appendChild(art);
        });
      }catch{
        hint.textContent = "Error de red al cargar reseñas.";
      }
    }
  
    loadAll();
  })();
  