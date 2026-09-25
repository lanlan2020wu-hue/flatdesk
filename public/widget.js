// Flatdesk chat widget. Embed with:
// <script src="https://YOUR-FLATDESK-HOST/widget.js" data-key="WIDGET_KEY" async></script>
(function () {
  var script = document.currentScript;
  if (!script || window.__flatdeskWidget) return;
  window.__flatdeskWidget = true;
  var key = script.getAttribute("data-key");
  if (!key) return console.warn("Flatdesk widget: missing data-key");
  var origin = new URL(script.src).origin;
  var color = script.getAttribute("data-color") || "#1d6b55";

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Open chat");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  button.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483646;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.2);background:" +
    color;

  var frame = document.createElement("iframe");
  frame.src = origin + "/chat/" + encodeURIComponent(key);
  frame.title = "Chat with us";
  frame.setAttribute("loading", "lazy");
  var small = window.matchMedia("(max-width: 480px)");
  function place() {
    frame.style.cssText = small.matches
      ? "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;background:#fff;display:" + (open ? "block" : "none")
      : "position:fixed;right:20px;bottom:88px;width:380px;height:560px;max-height:calc(100vh - 110px);border:1px solid rgba(0,0,0,.12);border-radius:12px;z-index:2147483647;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.2);display:" +
        (open ? "block" : "none");
  }
  var open = false;
  function toggle(next) {
    open = typeof next === "boolean" ? next : !open;
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    place();
    if (small.matches) button.style.display = open ? "none" : "flex";
  }
  button.addEventListener("click", function () { toggle(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) toggle(false); });
  window.addEventListener("message", function (e) {
    if (e.origin === origin && e.data === "flatdesk:close") toggle(false);
  });
  small.addEventListener("change", place);
  place();
  document.body.appendChild(frame);
  document.body.appendChild(button);
})();
