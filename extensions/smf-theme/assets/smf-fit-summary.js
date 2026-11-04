/* StyleMyFit fit summary for the Shopify button (ES5, no dependencies).
 *
 * On a Live product page, shows every profile the shopper saved in StyleMyFit with its body shape, whether
 * the piece is designed for that shape, and its recommended size - without them opening the plugin. Same
 * design as the StyleMyFit customer app's "Fit guidance" box: a round button (top right) opens the plugin
 * on the chosen profile, profiles slide three at a time, and each row spins while its size loads.
 *
 * Saved profiles belong to a device id that only the plugin's own domain can read, so the data comes from
 * an invisible bridge iframe (<plugin origin>/fit-summary.html) that posts back display data only.
 *
 * smf-button.js calls window.SMFFitSummary.attach(block, productKey, pageUrl, designMode) once the
 * product is confirmed Live (or always in the theme editor, which gets a sample preview). */
(function (window, document) {
  "use strict";

  var CACHE_PREFIX = "smf:sum:";
  var CACHE_TTL_MS = 5 * 60 * 1000;
  var ACTIVE_KEY = "smf:active-profile";
  var TIMEOUT_MS = 12000;
  var PAGE_SIZE = 3;

  var hosts = []; // [data-smf-summary] elements showing the current product's summary
  var bridge = { iframe: null, origin: null, key: null, pageUrl: null, timer: null, waiting: false, scheduled: false };
  var current = null; // last summary data rendered
  var loading = false; // refreshing after the plugin closed - rows show a spinner

  var PREVIEW = {
    ok: true,
    total: 4,
    preview: true,
    designedFor: ["Hourglass", "Pear"],
    profiles: [
      { id: "preview-1", name: "Me", shape: "Hour Glass", suits: true, result: "fit", size: "M", tone: "good", label: "Excellent fit" },
      { id: "preview-2", name: "Mum", shape: "Pear", suits: true, result: "fit", size: "L", tone: "warn", label: "Good fit" },
      { id: "preview-3", name: "Sarah", shape: "Rectangle", suits: false, result: "no_fit", size: null, tone: "bad", label: "No size fits well" },
      { id: "preview-4", name: "Anna", shape: "Inverted Triangle", suits: false, result: "fit", size: "S", tone: "warn", label: "Good fit" }
    ]
  };

  var ORANGE = "#ea5b1f";
  var STYLES = [
    ":host{display:block;min-width:0;max-width:100%;margin-top:12px;color:#111;font-family:inherit;line-height:1.4;text-align:left}",
    "*{box-sizing:border-box}",
    "button{font:inherit}",
    "button:focus-visible{outline:2px solid #111;outline-offset:2px}",
    ".card{position:relative;border:1px solid rgba(0,0,0,.1);border-radius:var(--smf-card-radius,0);background:#fff;padding:20px;animation:smf-in .35s ease both}",
    "@keyframes smf-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}",

    /* header */
    ".head{min-height:56px;padding-right:64px}",
    ".eyebrow{margin:0;font-size:10px;letter-spacing:.35em;text-transform:uppercase;color:" + ORANGE + "}",
    ".title{margin:6px 0 0;font-size:20px;font-weight:500;line-height:1.2;color:#111}",
    ".sub{margin:4px 0 0;font-size:13px;line-height:1.35;color:#525252}",

    /* round open button */
    ".open{position:absolute;right:20px;top:20px;width:48px;height:48px}",
    ".open-ping{position:absolute;inset:0;border-radius:50%;background:rgba(234,91,31,.25);animation:smf-ping 2.8s cubic-bezier(0,0,.2,1) infinite}",
    "@keyframes smf-ping{75%,100%{transform:scale(2);opacity:0}}",
    ".open-ring{position:absolute;inset:-2px;border-radius:50%;background:conic-gradient(from 0deg," + ORANGE + ",#ffb38a 30%,rgba(234,91,31,0) 60%," + ORANGE + ");animation:smf-spin 3.5s linear infinite}",
    ".open:hover .open-ring{animation-duration:1.2s}",
    "@keyframes smf-spin{to{transform:rotate(360deg)}}",
    ".open-btn{position:relative;display:flex;align-items:center;justify-content:center;width:48px;height:48px;padding:0;border:0;border-radius:50%;background:#fff;cursor:pointer;box-shadow:0 6px 18px -8px rgba(234,91,31,.7);transition:transform .3s,box-shadow .3s}",
    ".open:hover .open-btn{transform:translateY(-2px);box-shadow:0 10px 24px -8px rgba(234,91,31,.85)}",
    ".open-btn img{width:32px;height:32px;object-fit:contain;transition:transform .3s ease-out}",
    ".open:hover .open-btn img{transform:rotate(-12deg) scale(1.1)}",
    ".open-tip{pointer-events:none;position:absolute;right:100%;top:50%;margin-right:8px;transform:translate(4px,-50%);white-space:nowrap;border-radius:999px;background:#000;padding:6px 12px;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#fff;opacity:0;transition:opacity .2s,transform .2s}",
    ".open:hover .open-tip,.open:focus-within .open-tip{opacity:1;transform:translate(0,-50%)}",

    /* profile slider */
    /* sized by its container, never by the pages lined up side by side */
    ".slider{contain:inline-size;margin:12px -12px 0;overflow:hidden;border-top:1px solid rgba(0,0,0,.1)}",
    ".track{display:flex;align-items:flex-start;transition:transform .5s cubic-bezier(.22,.61,.36,1)}",
    ".page{flex:none;width:100%;margin:0;padding:0 12px;list-style:none}",
    ".row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:0 -12px;padding:10px 12px;border-top:1px solid rgba(0,0,0,.06);transition:background-color .2s}",
    ".row:first-child{border-top:0}",
    ".row.pick{cursor:pointer}",
    ".row.pick:hover{background:rgba(234,91,31,.04)}",
    ".who{display:flex;flex:1 1 192px;min-width:0;align-items:center;gap:12px;padding:0;border:0;background:none;color:inherit;text-align:left;cursor:inherit}",
    ".avatar{flex:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#f5f5f5;color:#404040;font-size:12px;font-weight:600;text-transform:uppercase;transition:all .2s}",
    ".row.active .avatar{background:#000;color:#fff}",
    ".row.pick:hover .avatar{box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(234,91,31,.4)}",
    ".names{min-width:0}",
    ".name{display:block;overflow:hidden;font-size:14px;font-weight:500;white-space:nowrap;text-overflow:ellipsis;color:#000;transition:color .2s}",
    ".row.pick:hover .name{color:" + ORANGE + "}",
    ".shape{display:block;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#a3a3a3}",
    ".verdict{letter-spacing:normal;text-transform:none;color:#737373}",
    ".verdict.yes{color:#047857}",
    ".spin{flex:none;width:24px;height:24px;margin-left:4px}",
    ".fit{display:flex;align-items:center;gap:8px}",
    ".size{display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:32px;padding:0 8px;font-size:14px;font-weight:600}",
    ".label{font-size:12px;font-weight:500}",
    ".tone-good .size{background:#ecfdf5;color:#047857}.tone-good .label{color:#047857}",
    ".tone-warn .size{background:#fffbeb;color:#b45309}.tone-warn .label{color:#b45309}",
    ".tone-bad .size{background:#fff1f2;color:#be123c}.tone-bad .label{color:#be123c}",
    ".tone-neutral .size{background:#f5f5f5;color:#525252}.tone-neutral .label{color:#737373}",

    /* footer: hint + slider controls */
    ".foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;margin:8px -12px 0;padding:10px 12px 0;border-top:1px solid rgba(0,0,0,.06)}",
    ".hint{font-size:11px;color:#a3a3a3}",
    ".ctrls{display:flex;align-items:center;gap:12px;margin-left:auto}",
    ".more{padding:0 0 2px;border:0;border-bottom:1px solid rgba(0,0,0,.3);background:none;font-size:10px;letter-spacing:.25em;text-transform:uppercase;color:#525252;cursor:pointer}",
    ".more:hover{border-color:" + ORANGE + ";color:" + ORANGE + "}",
    ".nav{display:flex;align-items:center;gap:8px}",
    ".arrow{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid rgba(0,0,0,.15);border-radius:50%;background:#fff;color:#000;cursor:pointer;transition:all .2s}",
    ".arrow:hover{border-color:#000;background:#000;color:#fff}",
    ".arrow[disabled]{pointer-events:none;opacity:.3}",
    ".arrow svg{width:14px;height:14px}",
    ".dots{display:flex;align-items:center;gap:4px}",
    ".dot{display:flex;align-items:center;height:16px;padding:0 2px;border:0;background:none;cursor:pointer}",
    ".dot span{display:block;width:6px;height:6px;border-radius:999px;background:rgba(0,0,0,.15);transition:all .3s}",
    ".dot:hover span{background:rgba(0,0,0,.3)}",
    ".dot.on span{width:16px;background:" + ORANGE + "}",
    ".preview{margin:10px 0 0;font-size:11px;color:#a3a3a3}",
    "@media (max-width:640px){.fit{padding-left:44px}}",
    "@media (prefers-reduced-motion:reduce){.card{animation:none}.open-ping,.open-ring{animation:none}.track{transition:none}}"
  ].join("\n");

  // Circular loader: an orange arc that grows and shrinks as it turns (static markup, no shopper data)
  var SPINNER =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="2.5"/>' +
    '<g><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1.2s" repeatCount="indefinite"/>' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="' + ORANGE + '" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="1 57">' +
    '<animate attributeName="stroke-dasharray" values="1 57;34 57;1 57" keyTimes="0;0.5;1" dur="1.5s" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" repeatCount="indefinite"/>' +
    '<animate attributeName="stroke-dashoffset" values="0;-14;-56" keyTimes="0;0.5;1" dur="1.5s" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" repeatCount="indefinite"/>' +
    "</circle></g></svg>";
  var CHEVRON_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  var CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

  function log(message, details) {
    try {
      if (window.console && window.console.info) window.console.info("[StyleMyFit] " + message, details);
    } catch (e) {}
  }

  function open(options) {
    if (typeof window.openSMF === "function") window.openSMF(options);
  }

  // ---- storage helpers ----
  function readSession(key) {
    try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function writeSession(key, value) {
    try {
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch (e) {}
  }
  function readLocal(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeLocal(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }

  function readCache(key) {
    try {
      var entry = JSON.parse(readSession(CACHE_PREFIX + key));
      if (entry && new Date().getTime() - entry.t < CACHE_TTL_MS) return entry.d;
    } catch (e) {}
    return null;
  }
  function writeCache(key, data) {
    writeSession(CACHE_PREFIX + key, JSON.stringify({ t: new Date().getTime(), d: data }));
  }

  // ---- DOM helpers (textContent only for anything from the API - profile names are shopper input) ----
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function button(className, onClick) {
    var b = el("button", className);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }

  function rootOf(host) {
    if (host.shadowRoot) return host.shadowRoot;
    if (host.attachShadow) return host.attachShadow({ mode: "open" });
    return host; // very old browsers: render without isolation
  }

  function profilesOf(data) {
    var list = [];
    var profiles = (data && data.profiles) || [];
    for (var i = 0; i < profiles.length; i++) if (profiles[i] && profiles[i].id) list.push(profiles[i]);
    return list;
  }

  // The chosen profile: the shopper's last pick if still saved, else the newest
  function activeId(profiles) {
    var stored = readLocal(ACTIVE_KEY);
    for (var i = 0; i < profiles.length; i++) if (profiles[i].id === stored) return stored;
    return profiles.length ? profiles[0].id : null;
  }

  function pageOf(profiles, id) {
    for (var i = 0; i < profiles.length; i++) if (profiles[i].id === id) return Math.floor(i / PAGE_SIZE);
    return 0;
  }

  // ---- rendering ----
  function render(host, data) {
    var root = rootOf(host);
    while (root.firstChild) root.removeChild(root.firstChild);

    var profiles = profilesOf(data);
    if (!profiles.length) {
      host.setAttribute("hidden", "");
      return;
    }

    var style = el("style");
    style.textContent = STYLES;
    root.appendChild(style);
    root.appendChild(renderCard(host, data, profiles));
    host.removeAttribute("hidden");
  }

  function renderCard(host, data, profiles) {
    var preview = data.preview === true;
    var active = activeId(profiles);
    var designed = data.designedFor || [];

    var card = el("section", "card");
    card.setAttribute("aria-label", "Your size in this piece, by StyleMyFit");

    // About the piece - the same whichever profile is picked
    var head = el("div", "head");
    head.appendChild(el("p", "eyebrow", "Fit guidance"));
    head.appendChild(el("p", "title", "Your size in this piece"));
    if (designed.length) head.appendChild(el("p", "sub", "Designed with " + designed.join(", ") + " shapes in mind."));
    card.appendChild(head);
    card.appendChild(renderOpenButton(host, active, preview));

    // Profiles, PAGE_SIZE at a time
    var pages = [];
    for (var i = 0; i < profiles.length; i += PAGE_SIZE) pages.push(profiles.slice(i, i + PAGE_SIZE));
    if (host._smfIds !== idsOf(profiles)) {
      host._smfIds = idsOf(profiles);
      host._smfPage = pageOf(profiles, active); // new or re-loaded profiles: show the chosen one's page
    }
    host._smfPage = Math.min(host._smfPage || 0, pages.length - 1);

    var slider = el("div", "slider");
    var track = el("div", "track");
    for (var p = 0; p < pages.length; p++) {
      var ul = el("ul", "page");
      for (var r = 0; r < pages[p].length; r++) {
        ul.appendChild(renderRow(pages[p][r], pages[p][r].id === active, profiles.length > 1 && !preview, preview));
      }
      track.appendChild(ul);
    }
    slider.appendChild(track);
    addSwipe(slider, host);
    card.appendChild(slider);

    var more = Math.max(data.total || 0, profiles.length) - profiles.length;
    if (profiles.length > 1 || more > 0) card.appendChild(renderFoot(host, pages.length, more, profiles.length > 1, preview));
    if (preview) card.appendChild(el("p", "preview", "Preview - shoppers see their own saved profiles here."));

    showPage(card, host._smfPage, false);
    return card;
  }

  function idsOf(profiles) {
    var ids = [];
    for (var i = 0; i < profiles.length; i++) ids.push(profiles[i].id);
    return ids.join(",");
  }

  // Round button with the StyleMyFit mark: opens the plugin on the chosen profile
  function renderOpenButton(host, profileId, preview) {
    var wrap = el("div", "open");
    var ping = el("span", "open-ping");
    var ring = el("span", "open-ring");
    ping.setAttribute("aria-hidden", "true");
    ring.setAttribute("aria-hidden", "true");
    wrap.appendChild(ping);
    wrap.appendChild(ring);

    var btn = button("open-btn", preview ? null : function () {
      open({ profileId: profileId, view: "result" });
    });
    btn.setAttribute("aria-label", "Open StyleMyFit");
    var icon = host.getAttribute("data-smf-icon");
    if (icon) {
      var img = el("img");
      img.src = icon;
      img.alt = "";
      img.width = 32;
      img.height = 32;
      btn.appendChild(img);
    } else {
      btn.appendChild(el("span", null, "SMF"));
    }
    wrap.appendChild(btn);

    var tip = el("span", "open-tip", "Open StyleMyFit");
    tip.setAttribute("aria-hidden", "true");
    wrap.appendChild(tip);
    return wrap;
  }

  function renderRow(p, active, selectable, preview) {
    var row = el("li", "row tone-" + (p.tone || "neutral") + (active ? " active" : "") + (selectable ? " pick" : ""));

    var who = el(selectable ? "button" : "div", "who");
    if (selectable) {
      who.type = "button";
      who.setAttribute("aria-pressed", active ? "true" : "false");
      who.setAttribute("aria-label", "Select " + (p.name || "this profile"));
      // the whole row picks the profile
      row.addEventListener("click", function () { choose(p.id); });
    }
    var avatar = el("span", "avatar", (p.name || "?").replace(/^\s+/, "").charAt(0) || "?");
    avatar.setAttribute("aria-hidden", "true");
    who.appendChild(avatar);

    var names = el("span", "names");
    names.appendChild(el("span", "name", p.name || "Profile"));
    if (p.shape) {
      var shape = el("span", "shape", p.shape);
      if (p.suits === true || p.suits === false) {
        shape.appendChild(el("span", "verdict" + (p.suits ? " yes" : ""), " · " + (p.suits ? "Flatters this shape" : "Not designed for this shape")));
      }
      names.appendChild(shape);
    }
    who.appendChild(names);

    if (loading && !preview) {
      var spin = el("span", "spin");
      spin.setAttribute("role", "status");
      spin.innerHTML = SPINNER; // static markup
      spin.appendChild(el("span", null, ""));
      spin.lastChild.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
      spin.lastChild.textContent = "Finding the size for " + (p.name || "this profile");
      who.appendChild(spin);
    }
    row.appendChild(who);

    if (!loading || preview) {
      var fit = el("span", "fit");
      var size = el("span", "size", p.size || "–");
      if (p.size) size.setAttribute("aria-label", "Size " + p.size);
      fit.appendChild(size);
      fit.appendChild(el("span", "label", p.label || ""));
      row.appendChild(fit);
    }
    return row;
  }

  function renderFoot(host, pageCount, more, selectable, preview) {
    var foot = el("div", "foot");
    if (selectable) foot.appendChild(el("span", "hint", "Tap a profile to select it"));
    var ctrls = el("div", "ctrls");
    if (more > 0) {
      var moreBtn = button("more", preview ? null : function () { open(); });
      moreBtn.textContent = "+" + more + " more";
      ctrls.appendChild(moreBtn);
    }
    if (pageCount > 1) {
      var nav = el("div", "nav");
      nav.setAttribute("role", "group");
      nav.setAttribute("aria-label", "Your profiles");
      var prev = button("arrow prev", function () { go(host, host._smfPage - 1); });
      prev.setAttribute("aria-label", "Previous profiles");
      prev.innerHTML = CHEVRON_LEFT;
      var next = button("arrow next", function () { go(host, host._smfPage + 1); });
      next.setAttribute("aria-label", "Next profiles");
      next.innerHTML = CHEVRON_RIGHT;
      var dots = el("div", "dots");
      for (var i = 0; i < pageCount; i++) {
        (function (index) {
          var dot = button("dot", function () { go(host, index); });
          dot.setAttribute("aria-label", "Profiles page " + (index + 1) + " of " + pageCount);
          dot.appendChild(el("span"));
          dots.appendChild(dot);
        })(i);
      }
      nav.appendChild(prev);
      nav.appendChild(dots);
      nav.appendChild(next);
      ctrls.appendChild(nav);
    }
    foot.appendChild(ctrls);
    return foot;
  }

  // ---- slider ----
  function go(host, page) {
    var card = rootOf(host).querySelector(".card");
    if (!card) return;
    var count = card.querySelectorAll(".page").length;
    host._smfPage = Math.max(0, Math.min(count - 1, page));
    showPage(card, host._smfPage, true);
  }

  function showPage(card, page, animate) {
    var track = card.querySelector(".track");
    var pages = card.querySelectorAll(".page");
    if (!animate) track.style.transition = "none";
    track.style.transform = "translateX(-" + page * 100 + "%)";
    if (!animate) {
      void track.offsetWidth; // apply the jump before re-enabling the transition
      track.style.transition = "";
    }
    for (var i = 0; i < pages.length; i++) {
      // hidden pages can't be reached with the keyboard
      if (i === page) {
        pages[i].removeAttribute("aria-hidden");
        pages[i].removeAttribute("inert");
      } else {
        pages[i].setAttribute("aria-hidden", "true");
        pages[i].setAttribute("inert", "");
      }
    }
    var dots = card.querySelectorAll(".dot");
    for (var d = 0; d < dots.length; d++) {
      dots[d].className = "dot" + (d === page ? " on" : "");
      if (d === page) dots[d].setAttribute("aria-current", "true");
      else dots[d].removeAttribute("aria-current");
    }
    var prev = card.querySelector(".prev");
    var next = card.querySelector(".next");
    if (prev) prev.disabled = page === 0;
    if (next) next.disabled = page === pages.length - 1;
  }

  function addSwipe(slider, host) {
    var startX = null;
    slider.addEventListener("touchstart", function (e) { startX = e.touches[0].clientX; }, { passive: true });
    slider.addEventListener("touchend", function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) go(host, host._smfPage + (dx < 0 ? 1 : -1));
    });
  }

  function choose(id) {
    if (readLocal(ACTIVE_KEY) === id) return;
    writeLocal(ACTIVE_KEY, id);
    renderAll();
  }

  function renderAll() {
    var alive = [];
    for (var i = 0; i < hosts.length; i++) {
      if (document.documentElement.contains(hosts[i])) {
        alive.push(hosts[i]);
        if (current) render(hosts[i], current);
      }
    }
    hosts = alive;
  }

  function stopLoading() {
    if (!loading) return;
    loading = false;
    renderAll();
  }

  // ---- bridge iframe ----
  function pluginOrigin() {
    var origin = window.MyWidget && window.MyWidget.origin;
    return typeof origin === "string" && /^https?:\/\/[^/]+$/.test(origin) ? origin : null;
  }

  function onMessage(event) {
    if (!bridge.iframe || event.origin !== bridge.origin || event.source !== bridge.iframe.contentWindow) return;
    var data = event.data;
    if (!data || data.type !== "SMF_FIT_SUMMARY" || data.version !== 1) return;
    bridge.waiting = false;
    clearTimeout(bridge.timer);
    if (!data.ok) {
      log("Couldn't load the sizes for saved profiles", data);
      return stopLoading(); // keep whatever is already shown
    }
    var clean = { ok: true, total: data.total || 0, designedFor: data.designedFor || [], profiles: data.profiles || [] };
    writeCache(bridge.key, clean);
    current = clean;
    loading = false;
    log("Sizes for saved profiles: " + clean.profiles.length + " of " + clean.total, null);
    renderAll();
  }

  function onTimeout() {
    bridge.waiting = false;
    stopLoading();
  }

  function request() {
    if (!bridge.iframe) return loadBridge();
    bridge.waiting = true;
    if (current) {
      loading = true;
      renderAll();
    }
    clearTimeout(bridge.timer);
    bridge.timer = setTimeout(onTimeout, TIMEOUT_MS);
    try {
      bridge.iframe.contentWindow.postMessage({ type: "SMF_FIT_SUMMARY_REFRESH" }, bridge.origin);
    } catch (e) {}
  }

  function loadBridge() {
    if (bridge.iframe) return;
    var origin = pluginOrigin();
    if (!origin) {
      log("Saved-profile sizes are off: the StyleMyFit plugin script didn't load (or is an old version)", null);
      return;
    }
    bridge.origin = origin;
    var iframe = document.createElement("iframe");
    iframe.src = origin + "/fit-summary.html?pageUrl=" + encodeURIComponent(bridge.pageUrl) +
      "&origin=" + encodeURIComponent(window.location.origin);
    iframe.title = "StyleMyFit";
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");
    iframe.style.cssText = "position:absolute;width:1px;height:1px;border:0;left:-9999px;top:auto;visibility:hidden;";
    bridge.iframe = iframe;
    bridge.waiting = true;
    bridge.timer = setTimeout(onTimeout, TIMEOUT_MS);
    document.body.appendChild(iframe);
  }

  // Don't compete with the product page itself: load once the page is done and the browser is idle
  function whenIdle(fn) {
    function idle() {
      if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 2000 });
      else setTimeout(fn, 200);
    }
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle);
  }

  window.addEventListener("message", onMessage);

  // The shopper may have added or edited profiles in the plugin - fetch fresh sizes when it closes
  window.addEventListener("smf:widget-closed", function () {
    if (!bridge.key) return;
    writeSession(CACHE_PREFIX + bridge.key, null);
    request();
  });

  window.SMFFitSummary = {
    attach: function (block, key, pageUrl, designMode) {
      var host = block.querySelector("[data-smf-summary]");
      if (!host || host.getAttribute("data-smf-summary-ready")) return;
      host.setAttribute("data-smf-summary-ready", "true");

      // Theme editor: a sample, never the merchant's own profiles
      if (designMode) {
        render(host, PREVIEW);
        return;
      }

      hosts.push(host);
      if (bridge.key && bridge.key !== key) return; // one product per page
      bridge.key = key;
      bridge.pageUrl = pageUrl;

      var cached = readCache(key);
      if (cached) {
        current = cached;
        renderAll();
        return; // refreshed when the plugin closes, or after 5 minutes
      }
      if (current) return renderAll();
      if (!bridge.iframe && !bridge.scheduled) {
        bridge.scheduled = true;
        whenIdle(loadBridge);
      }
    }
  };
})(window, document);
