// app.js - cliente
const bookingForm = document.getElementById('bookingForm');
const message = document.getElementById('message');
const goBooking = document.getElementById('goBooking');

if (goBooking) goBooking.addEventListener('click', ()=> location.hash = '#booking');

// Barrios donde tenemos servicio (puedes mover esto a la DB)
const SERVICED_NEIGHBORHOODS = [
  "palermo","belgrano","recoleta","caballito","san telmo","boca","almagro"
].map(s=>s.toLowerCase());

bookingForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  message.textContent = 'Procesando...';

  const payload = {
    name: document.getElementById('name').value.trim(),
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    eventType: document.getElementById('eventType').value,
    date: document.getElementById('date').value,
    time: document.getElementById('time').value,
    address: document.getElementById('address').value,
    neighborhood: document.getElementById('neighborhood').value.trim(),
    duration: parseInt(document.getElementById('duration').value, 10),
  };

  // Validación de barrio
  if (!SERVICED_NEIGHBORHOODS.includes(payload.neighborhood.toLowerCase())) {
    message.textContent = 'Lo siento, actualmente no llegamos a ese barrio. Contactanos por WhatsApp para ver alternativas.';
    return;
  }

  // crear reserva preliminar y pedir link de pago
  try {
    const res = await fetch('/api/createPreference', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Error creando preferencia');
    // data.init_point es el link a Mercado Pago
    message.innerHTML = `Se creó la reserva. <a href="${data.init_point}" target="_blank">Pagar seña con Mercado Pago</a>. También te llegará un email con instrucciones.`;
  } catch (err) {
    console.error(err);
    message.textContent = 'Error: ' + err.message;
  }
});

// Auth (registro/login simple)
const authForm = document.getElementById('authForm');
authForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('authEmail').value;
  const name = document.getElementById('authName').value;

  try {
    const res = await fetch('/api/register', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({email, name})
    });
    const j = await res.json();
    document.getElementById('authMsg').textContent = j.message || 'Listo. Revisa tu email.';
  } catch(err){
    document.getElementById('authMsg').textContent = 'Error: ' + err.message;
  }
});
