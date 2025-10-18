// api/admin/_auth.js
export function isAdmin(req){
  const ck = req.headers.cookie || "";
  return /(?:^|;\s*)admin_session=ok(?:;|$)/.test(ck);
}

export function requireAdmin(req, res){
  if (!isAdmin(req)){
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok:false, error:"Unauthorized" }));
    return false;
  }
  return true;
}

/* ========= NUEVO: Helpers seguros (CSRF + wrapper) ========= */

// Nombre del header y cookie de CSRF
export const CSRF_HEADER = "x-csrf-token";
export const CSRF_COOKIE = "adm_csrf";

// Lee cookies en forma simple (sin deps)
function getCookie(req, name){
  const raw = req.headers.cookie || "";
  const m = raw.match(new RegExp("(?:^|;\\s*)" + name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

// Verifica CSRF sólo en métodos de escritura
export function checkCsrf(req){
  const method = (req.method || "GET").toUpperCase();
  if (!["POST","PUT","PATCH","DELETE"].includes(method)) return true;
  const tokenHeader = req.headers[CSRF_HEADER] || req.headers[CSRF_HEADER.toLowerCase()];
  const tokenCookie = getCookie(req, CSRF_COOKIE);
  return !!tokenHeader && !!tokenCookie && tokenHeader === tokenCookie;
}

// Wrapper para rutas admin: sesión + CSRF (métodos de escritura)
export function withAdmin(handler){
  return async (req, res) => {
    if (!isAdmin(req)){
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok:false, error:"Unauthorized" }));
      return;
    }
    if (!checkCsrf(req)){
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok:false, error:"Forbidden (CSRF)" }));
      return;
    }
    return handler(req, res);
  };
}
