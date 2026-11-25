// Toggle explicito de tema: localStorage("portaless-theme") =
// "dark" | "light" fuerza el tema; ausente = auto (SO). Se carga de forma
// sincrona desde 'self' en <head> antes del primer paint para evitar FOUC
// sin necesidad de 'unsafe-inline' en Content-Security-Policy (A-07).
try {
  var t = localStorage.getItem("portaless-theme");
  if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
} catch (e) { /* sin storage: auto */ }
