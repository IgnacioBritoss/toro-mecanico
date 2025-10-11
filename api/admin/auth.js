// api/admin/auth.js
export const config = { runtime: "nodejs" };

/**
 * Endpoint unificado:
 *  - POST { action:"start", email }
 *  - POST { action:"verify-email", session_id, code }
 *  - POST { action:"verify-totp",  session_id, code }
 *
 * NOTA: adentro llamá a lo mismo que usabas antes en tus tres handlers.
 *       Aquí te dejo "stubs" para que enchufes tu lógica real.
 */

// ======= REEMPLAZAR por tu storage / emailer / totp reales =======
async function startFlow(email){
  // enviar código al email y devolver session_id
  // ...
  return { ok:true, session_id: "sess_"+Date.now() };
}
async function verifyEmail(session_id, code){
  // validar código de email. Si OK y TOTP deshabilitado, setear cookie
  // ...
  const done = false; // si TOTP deshabilitado
  return { ok:true, done, totpDisabled: done, qrDataUrl: null, otpauth: null };
}
async function verifyTotp(session_id, code){
  // validar TOTP y setear cookie admin_session=ok
  // ...
  return { ok:true };
}
// ================================================================

export default async function handler(req, res){
  if (req.method !== "POST"){
    return res.status(405).json({ ok:false, error:"Método no permitido" });
  }
  const { action } = req.body || {};
  try{
    if (action === 'start'){
      const { email } = req.body;
      const r = await startFlow(email);
      return res.status(r.ok?200:400).json(r);
    }
    if (action === 'verify-email'){
      const { session_id, code } = req.body;
      const r = await verifyEmail(session_id, code);
      // si ya está OK sin TOTP, seteamos cookie
      if (r.ok && (r.done || r.totpDisabled)){
        res.setHeader('Set-Cookie', `admin_session=ok; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${60*60*4}`);
      }
      return res.status(r.ok?200:400).json(r);
    }
    if (action === 'verify-totp'){
      const { session_id, code } = req.body;
      const r = await verifyTotp(session_id, code);
      if (r.ok){
        res.setHeader('Set-Cookie', `admin_session=ok; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${60*60*4}`);
      }
      return res.status(r.ok?200:400).json(r);
    }
    return res.status(400).json({ ok:false, error:"Acción inválida" });
  }catch(e){
    return res.status(500).json({ ok:false, error:"Error interno" });
  }
}
