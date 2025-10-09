export const config = { runtime: "nodejs" };

export default function handler(req, res){
  if (req.method !== "POST") return res.status(405).json({ error:"Método no permitido" });
  // Expira cookie
  res.setHeader("Set-Cookie", "ADMIN_TOKEN=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");
  return res.status(200).json({ ok:true });
}
