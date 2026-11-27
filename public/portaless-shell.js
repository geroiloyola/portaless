// Listeners delegados del shell publico de Portaless (compartido por
// BaseLayout.astro y el shell runtime functions/pages/[slug].js).
// Servido desde 'self' con defer para eliminar 'unsafe-inline' de script-src.

// 1. Boton "Compartir" del header ([data-portaless-share]): Web Share API si
// existe (movil); si no, copia la URL al portapapeles y avisa con un toast.
document.addEventListener("click", async function (e) {
  var t = e.target;
  var el = t && t.closest ? t.closest("[data-portaless-share]") : null;
  if (!el) return;
  e.preventDefault();
  var url = location.href;
  if (navigator.share) {
    try { await navigator.share({ title: document.title, url: url }); return; }
    catch (err) { if (err && err.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    var toast = document.createElement("div");
    toast.textContent = "Enlace copiado";
    toast.setAttribute("role", "status");
    toast.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#261C15;color:#fff;padding:8px 16px;border-radius:999px;font-size:0.85rem;z-index:99;box-shadow:0 6px 20px rgba(0,0,0,.25);";
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 1800);
  } catch (err) { /* sin clipboard (contexto no seguro): nada que romper */ }
});

// 2. Control de volumen (Atomic Icons Responsive, [data-portaless-volume]):
// postMessage crudo para iframes de YouTube/Vimeo sin SDK externo.
document.addEventListener("click", function (e) {
  var t = e.target;
  var btn = t && t.closest ? t.closest("[data-portaless-volume]") : null;
  if (!btn) return;
  var muted = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", muted ? "true" : "false");
  btn.setAttribute("aria-label", muted ? "Activar sonido" : "Silenciar video");
  btn.setAttribute("title", muted ? "Activar sonido" : "Silenciar video");
  var frames = document.querySelectorAll(".ae-video iframe");
  for (var i = 0; i < frames.length; i++) {
    var frame = frames[i];
    var src = frame.getAttribute("src") || "";
    var payload = null;
    if (src.indexOf("youtube") !== -1 || src.indexOf("youtu.be") !== -1) {
      payload = JSON.stringify({ event: "command", func: muted ? "mute" : "unmute", args: "" });
    } else if (src.indexOf("player.vimeo.com") !== -1) {
      payload = JSON.stringify({ method: "setVolume", value: muted ? 0 : 1 });
    }
    if (!payload) continue;
    try { frame.contentWindow.postMessage(payload, "*"); } catch (err) { /* cross-origin duro: nada */ }
  }
});

// 3. Alternador Claro/Oscuro ([data-theme-toggle]): alterna data-theme en <html>,
// persiste en localStorage("portaless-theme") y sincroniza de inmediato las
// variables de ThemePack v2 (<meta name="portaless-theme-light|dark">).
(function () {
  var root = document.documentElement;
  var mq = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  function isDarkActive() {
    var attr = root.getAttribute("data-theme");
    return attr === "dark" || (attr !== "light" && Boolean(mq && mq.matches));
  }

  function applyDualMeta(dark) {
    var lightMeta = document.querySelector('meta[name="portaless-theme-light"]');
    var darkMeta = document.querySelector('meta[name="portaless-theme-dark"]');
    var lightCss = lightMeta ? lightMeta.getAttribute("content") : null;
    var darkCss = darkMeta ? darkMeta.getAttribute("content") : null;
    if (!lightCss && !darkCss) return;
    var css = dark ? (darkCss || lightCss) : (lightCss || darkCss);
    if (css) root.setAttribute("style", css);
  }

  function syncToggleButtons() {
    var dark = isDarkActive();
    var isEs = (root.getAttribute("lang") || "").toLowerCase().indexOf("es") === 0;
    var label = dark
      ? (isEs ? "Cambiar a modo claro" : "Switch to light mode")
      : (isEs ? "Cambiar a modo oscuro" : "Switch to dark mode");
    var btns = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", dark ? "true" : "false");
      btns[i].setAttribute("aria-label", label);
      btns[i].setAttribute("title", label);
    }
  }

  syncToggleButtons();
  if (mq && typeof mq.addEventListener === "function") {
    mq.addEventListener("change", syncToggleButtons);
  }

  document.addEventListener("click", function (e) {
    var target = e.target;
    var btn = target && target.closest ? target.closest("[data-theme-toggle]") : null;
    if (!btn) return;
    e.preventDefault();
    var next = isDarkActive() ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("portaless-theme", next); } catch (err) { /* sin storage */ }
    applyDualMeta(next === "dark");
    syncToggleButtons();
  });
})();
