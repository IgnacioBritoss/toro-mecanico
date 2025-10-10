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
