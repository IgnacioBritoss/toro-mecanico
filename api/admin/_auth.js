// api/admin/_auth.js
export function isAdmin(req){
  // Chequeo simple: cookie "admin_session=ok" (ajústalo a tu lógica real)
  const ck = req.headers.cookie || "";
  return /(?:^|;\s*)admin_session=ok(?:;|$)/.test(ck);
}
export function requireAdmin(req, res){
  if (!isAdmin(req)){
    res.statusCode = 401;
    res.end("No autorizado");
    return false;
  }
  return true;
}
