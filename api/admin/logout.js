// api/admin/logout.js
export const config = { runtime: "nodejs" };

export default async function handler(req, res){
  if (req.method !== "POST" && req.method !== "GET"){
    return res.status(405).json({ ok:false, error:"Método no permitido" });
  }

  // Borrar cookie
  res.setHeader("Set-Cookie", [
    "admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"
  ]);

  return res.status(200).json({ ok:true });
}
