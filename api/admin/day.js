// api/admin/day.js
export const config = { runtime: "nodejs" };

/**
 * Devuelve las reservas de un día (máx 2), para admin.
 * GET /api/admin/day?date=YYYY-MM-DD
 * Respuesta: { reservations: [ { name,email,phone,time, location:{address,display_name,lat,lng}, ... }, ... ] }
 */

function isAdmin(req){
  // cookie seteada por /api/admin/auth
  const cookie = req.headers.cookie || "";
  return /(?:^|;\s*)admin_session=ok(?:;|$)/.test(cookie);
}

// === ADAPTAR A TU DB REAL ========================================
// Debés reemplazar esta función por tu lector real.
// Debe devolver una lista de objetos con al menos:
// { name, email, phone, date: 'YYYY-MM-DD', time: 'HH:MM', location: { display_name, address, lat, lng } }
async function listReservationsByDate(dateYmd){
  // EJEMPLO: si ya guardás en un archivo o DB, consultalo acá.
  // A modo de demo devuelvo un array vacío:
  return []; // <-- REEMPLAZÁ por tu consulta real
}
// ================================================================

export default async function handler(req, res){
  if (req.method !== 'GET'){
    return res.status(405).json({ ok:false, error:'Método no permitido' });
  }
  if (!isAdmin(req)){
    return res.status(401).json({ ok:false, error:'No autorizado' });
  }

  const date = (req.query?.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)){
    return res.status(400).json({ ok:false, error:'Parámetro date inválido' });
  }

  try{
    let list = await listReservationsByDate(date);
    // seguridad: máximo 2 porque tu negocio lo limita
    list = (Array.isArray(list) ? list : []).slice(0,2).map(x => ({
      name: x.name || '',
      email: x.email || '',
      phone: x.phone || '',
      time: x.time || '',
      location: {
        display_name: x.location?.display_name || x.location?.address || '',
        address: x.location?.address || '',
        lat: typeof x.location?.lat === 'number' ? x.location?.lat : undefined,
        lng: typeof x.location?.lng === 'number' ? x.location?.lng : undefined,
      }
    }));
    return res.status(200).json({ ok:true, reservations: list });
  }catch(e){
    return res.status(500).json({ ok:false, error:'Error leyendo reservas' });
  }
}
