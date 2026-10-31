/* StyleMyFit glue for the Shopify theme app extension (ES5, no dependencies).
 * Shows each [data-smf-block] only when the backend says the product is eligible,
 * and opens the StyleMyFit plugin (window.MyWidget.initiateHandler) on click. */
(function (window, document) {
  "use strict";

  var config = window.SMFShopify || {};
  var ENDPOINT = config.endpoint || "/apps/smf/chek_prd/";
  var FAIL_OPEN = config.failOpen === true;
  var TIMEOUT_MS = 8000;
  var CACHE_TTL_MS = 5 * 60 * 1000;
  var CACHE_PREFIX = "smf:chk:";

  var memo = {};
  var pending = {};

  function log(message, details) {
    try {
      if (window.console && window.console.info) window.console.info("[StyleMyFit] " + message, details);
    } catch (e) {}
  }

  function openSMF() {
    if (!window.MyWidget || !window.MyWidget.initiateHandler) {
      alert("SMF plugin is loading, please try again");
      return;
    }
    window.MyWidget.initiateHandler();
  }

  // ---- cache (memory + sessionStorage, per product) ----
  function readCache(key) {
    if (memo.hasOwnProperty(key)) return memo[key];
    try {
      var entry = JSON.parse(window.sessionStorage.getItem(CACHE_PREFIX + key));
      if (entry && new Date().getTime() - entry.t < CACHE_TTL_MS) {
        memo[key] = entry.v === true;
        return memo[key];
      }
    } catch (e) {}
    return undefined;
  }

  function writeCache(key, value) {
    memo[key] = value;
    try {
      window.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ v: value, t: new Date().getTime() }));
    } catch (e) {}
  }

  // Accepts plain true/false or JSON {"show": ...}; null when the answer can't be read
  function parseAnswer(text) {
    text = String(text || "").replace(/^\s+|\s+$/g, "");
    if (text === "true") return true;
    if (text === "false") return false;
    try {
      var json = JSON.parse(text);
      if (json === true || json === false) return json;
      if (json && typeof json === "object" && json.hasOwnProperty("show")) return json.show === true;
    } catch (e) {}
    return null;
  }

  function buildUrl(pageUrl) {
    return ENDPOINT + (ENDPOINT.indexOf("?") === -1 ? "?" : "&") + "pageUrl=" + encodeURIComponent(pageUrl);
  }

  function checkEligibility(key, pageUrl, callback) {
    var cached = readCache(key);
    if (cached !== undefined) return callback(cached, "cache");
    if (pending[key]) return pending[key].push(callback);
    pending[key] = [callback];

    var finished = false;
    // source: "backend" (real answer) or "error" (check failed, fail-open setting applied)
    function finish(show, cacheable) {
      if (finished) return;
      finished = true;
      if (cacheable) writeCache(key, show);
      var callbacks = pending[key];
      delete pending[key];
      for (var i = 0; i < callbacks.length; i++) callbacks[i](show, cacheable ? "backend" : "error");
    }

    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", buildUrl(pageUrl), true);
      xhr.timeout = TIMEOUT_MS;
      xhr.setRequestHeader("Accept", "application/json");
      xhr.onload = function () {
        var answer = parseAnswer(xhr.responseText);
        // An unreadable answer (eg proxy not set up -> HTML page) counts as a failed check
        if (answer === null) finish(FAIL_OPEN, false);
        else finish(answer, true);
      };
      xhr.onerror = xhr.ontimeout = xhr.onabort = function () {
        finish(FAIL_OPEN, false);
      };
      xhr.send();
    } catch (e) {
      finish(FAIL_OPEN, false);
    }
  }

  function setupBlock(block) {
    if (block.getAttribute("data-smf-ready")) return;
    block.setAttribute("data-smf-ready", "true");

    var button = block.querySelector(".smf-button");
    if (button) button.addEventListener("click", openSMF);

    var pageUrl = window.location.href.split("#")[0];
    var key = block.getAttribute("data-product-id") || pageUrl;
    var designMode = block.getAttribute("data-smf-design-mode") === "true";

    checkEligibility(key, pageUrl, function (show, source) {
      var details = { productId: block.getAttribute("data-product-id"), pageUrl: pageUrl, source: source };
      if (source === "error") {
        log("Eligibility check failed - " + (show ? "showing" : "hiding") + " the button (\"Show button if the check fails\" is " + (FAIL_OPEN ? "on" : "off") + ")", details);
      } else if (show) {
        log("Product found in StyleMyFit - showing the button", details);
      } else {
        log("Product not found in StyleMyFit (or not Live) - hiding the button", details);
      }

      if (show) {
        block.removeAttribute("hidden");
      } else if (designMode) {
        // Keep it visible (dimmed) in the theme editor so merchants can still place and style it
        block.className += " smf-block--ineligible";
        block.setAttribute("title", "Hidden on your store: this product is not enabled in StyleMyFit");
        block.removeAttribute("hidden");
      } else if (block.parentNode) {
        block.parentNode.removeChild(block);
      }
    });
  }

  function init(root) {
    var blocks = (root || document).querySelectorAll("[data-smf-block]");
    for (var i = 0; i < blocks.length; i++) setupBlock(blocks[i]);
  }

  // Backwards compatibility with the manual integration's onclick="openSMF()"
  window.openSMF = openSMF;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(document); });
  } else {
    init(document);
  }

  // Theme editor re-renders sections without a page load
  document.addEventListener("shopify:section:load", function (event) {
    init(event.target);
  });
})(window, document);
