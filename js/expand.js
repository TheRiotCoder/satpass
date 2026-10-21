/* Expand a tracker inside the app shell, retaining its existing canvases and
   controls. This deliberately keeps the page header/navigation available. */
(function () {
  "use strict";
  function dimensions(canvas, aspect) {
    var width = Math.max(1, canvas.parentElement.clientWidth), stage = canvas.closest(".visual-stage");
    var expanded = !!(stage && stage.closest(".visual-expanded"));
    var height = expanded ? Math.max(1, stage.clientHeight) : undefined;
    return { width: expanded && aspect ? Math.min(width, height * aspect) : width, height: height, expanded: expanded };
  }
  function bind(card, redraw) {
    var active = false, placeholder = null, scrollX = 0, scrollY = 0, app = document.getElementById("app"), appInert = false;
    var buttons = [], removers = [];
    var icons = '<svg class="expand-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"/></svg>' +
      '<svg class="restore-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5"/></svg>';
    function listen(el, type, fn) { el.addEventListener(type, fn); removers.push(function () { el.removeEventListener(type, fn); }); }
    function resize() {
      if (!active) return;
      var header = document.querySelector(".top").getBoundingClientRect(), nav = document.getElementById("tabs").getBoundingClientRect();
      var top = Math.max(0, header.bottom), left = 0, bottom = 0;
      if (nav.width < window.innerWidth / 2 && nav.height > window.innerHeight / 2) left = nav.right;
      else if (nav.top >= window.innerHeight / 2) bottom = window.innerHeight - nav.top;
      else top = Math.max(top, nav.bottom);
      card.style.setProperty("--visual-top", top + "px");
      card.style.setProperty("--visual-left", left + "px");
      card.style.setProperty("--visual-bottom", Math.max(0, bottom) + "px");
    }
    function labels() {
      buttons.forEach(function (button) {
        button.setAttribute("aria-pressed", String(active));
        button.setAttribute("aria-label", active ? "Restore dashboard" : "Expand " + button.dataset.view);
        button.title = active ? "Restore view (Esc)" : "Expand " + button.dataset.view;
      });
    }
    function restore(focus) {
      if (!active) return;
      active = false;
      var button = card.querySelector('[role="tabpanel"]:not([hidden]) .visual-expand');
      placeholder.replaceWith(card); placeholder = null;
      card.classList.remove("visual-expanded");
      document.body.classList.remove("has-expanded-visual");
      document.documentElement.classList.remove("visual-expanded-open");
      app.inert = appInert; labels();
      ["--visual-top", "--visual-left", "--visual-bottom"].forEach(function (name) { card.style.removeProperty(name); });
      if (focus) {
        if (button) button.focus({ preventScroll: true });
        window.scrollTo(scrollX, scrollY); redraw();
      }
    }
    function expand(button) {
      scrollX = window.scrollX; scrollY = window.scrollY;
      placeholder = document.createElement("div"); placeholder.className = "tracker-visual visual-placeholder";
      placeholder.setAttribute("aria-hidden", "true"); placeholder.style.height = card.getBoundingClientRect().height + "px";
      card.before(placeholder); document.body.appendChild(card);
      active = true; appInert = app.inert; app.inert = true;
      document.body.classList.add("has-expanded-visual");
      document.documentElement.classList.add("visual-expanded-open");
      card.classList.add("visual-expanded");
      // Lock scrolling at the shell's origin. A scrolled body becomes a new
      // sticky containing block when overflow is locked; keep both bars in view.
      window.scrollTo(0, 0); labels(); resize();
      button.focus({ preventScroll: true }); redraw();
    }
    Array.prototype.forEach.call(card.querySelectorAll(".canvaswrap, .ground-view"), function (host) {
      var stage = document.createElement("div"); stage.className = "visual-stage";
      if (host.querySelector(".sky-chart")) stage.classList.add("sky-stage");
      if (host.classList.contains("ground-view")) stage.classList.add("ground-stage");
      host.before(stage); stage.appendChild(host);
      var panel = stage.closest('[role="tabpanel"]'), tab = document.getElementById(panel.getAttribute("aria-labelledby"));
      var button = document.createElement("button"); button.type = "button"; button.className = "visual-expand";
      button.dataset.view = tab.textContent.trim(); button.innerHTML = icons; stage.appendChild(button); buttons.push(button);
      listen(button, "click", function () { if (active) restore(true); else expand(button); });
    });
    listen(document, "keydown", function (event) {
      if (active && event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); restore(true); }
    });
    // Browser controls can change the visible height without changing layout
    // width. The route owns scheduling and disposal of any resulting redraw.
    if (window.visualViewport) listen(window.visualViewport, "resize", redraw);
    labels();
    return { resize: resize, dispose: function () { restore(false); removers.forEach(function (remove) { remove(); }); } };
  }
  window.SatExpand = { bind: bind, dimensions: dimensions };
})();
