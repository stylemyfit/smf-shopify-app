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

  // Product status from the backend: 1 not found, 2 found but inactive, 3 active (Live)
  var STATUS_NOT_FOUND = 1;
  var STATUS_INACTIVE = 2;
  var STATUS_ACTIVE = 3;

  var memo = {};
  var pending = {};

  function log(message, details) {
    try {
      if (window.console && window.console.info) window.console.info("[StyleMyFit] " + message, details);
    } catch (e) {}
  }

  // options (optional): { profileId, view: "result" | "edit" | "new" } - used by the fit summary
  function openSMF(options) {
    if (!window.MyWidget || !window.MyWidget.initiateHandler) {
      alert("SMF plugin is loading, please try again");
      return;
    }
    window.MyWidget.initiateHandler(options);
  }

  // An answer is { show: boolean, status: 1|2|3|null } (status is null when only show is known)
  function makeAnswer(show, status) {
    if (status === STATUS_NOT_FOUND || status === STATUS_INACTIVE || status === STATUS_ACTIVE) {
      return { show: status === STATUS_ACTIVE, status: status };
    }
    return { show: show === true, status: null };
  }

  // ---- cache (memory + sessionStorage, per product) ----
  function readCache(key) {
    if (memo.hasOwnProperty(key)) return memo[key];
    try {
      var entry = JSON.parse(window.sessionStorage.getItem(CACHE_PREFIX + key));
      if (entry && new Date().getTime() - entry.t < CACHE_TTL_MS) {
        // Entries written before statuses existed only have v (show)
        memo[key] = makeAnswer(entry.v, entry.s);
        return memo[key];
      }
    } catch (e) {}
    return undefined;
  }

  function writeCache(key, answer) {
    memo[key] = answer;
    try {
      window.sessionStorage.setItem(
        CACHE_PREFIX + key,
        JSON.stringify({ v: answer.show, s: answer.status, t: new Date().getTime() })
      );
    } catch (e) {}
  }

  // Accepts JSON {"show": ..., "status": 1|2|3} (status wins when present), JSON {"show": ...},
  // or plain true/false; null when the answer can't be read
  function parseAnswer(text) {
    text = String(text || "").replace(/^\s+|\s+$/g, "");
    if (text === "true") return makeAnswer(true);
    if (text === "false") return makeAnswer(false);
    try {
      var json = JSON.parse(text);
      if (json === true || json === false) return makeAnswer(json);
      if (json && typeof json === "object" && (json.hasOwnProperty("status") || json.hasOwnProperty("show"))) {
        return makeAnswer(json.show, json.status);
      }
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
    function finish(answer, cacheable) {
      if (finished) return;
      finished = true;
      if (cacheable) writeCache(key, answer);
      var callbacks = pending[key];
      delete pending[key];
      for (var i = 0; i < callbacks.length; i++) callbacks[i](answer, cacheable ? "backend" : "error");
    }

    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", buildUrl(pageUrl), true);
      xhr.timeout = TIMEOUT_MS;
      xhr.setRequestHeader("Accept", "application/json");
      xhr.onload = function () {
        var answer = parseAnswer(xhr.responseText);
        // An unreadable answer (eg proxy not set up -> HTML page) counts as a failed check
        if (answer === null) finish(makeAnswer(FAIL_OPEN), false);
        else finish(answer, true);
      };
      xhr.onerror = xhr.ontimeout = xhr.onabort = function () {
        finish(makeAnswer(FAIL_OPEN), false);
      };
      xhr.send();
    } catch (e) {
      finish(makeAnswer(FAIL_OPEN), false);
    }
  }

  function setupBlock(block) {
    if (block.getAttribute("data-smf-ready")) return;
    block.setAttribute("data-smf-ready", "true");

    var button = block.querySelector(".smf-button");
    if (button) button.addEventListener("click", function () { openSMF(); });

    var pageUrl = window.location.href.split("#")[0];
    var key = block.getAttribute("data-product-id") || pageUrl;
    var designMode = block.getAttribute("data-smf-design-mode") === "true";

    checkEligibility(key, pageUrl, function (answer, source) {
      var show = answer.show;
      var details = { productId: block.getAttribute("data-product-id"), pageUrl: pageUrl, source: source, status: answer.status };
      var hiddenReason = "this product is not enabled in StyleMyFit";
      if (source === "error") {
        log("Eligibility check failed - " + (show ? "showing" : "hiding") + " the button (\"Show button if the check fails\" is " + (FAIL_OPEN ? "on" : "off") + ")", details);
      } else if (show) {
        log("Product is Live in StyleMyFit - showing the button", details);
      } else if (answer.status === STATUS_INACTIVE) {
        hiddenReason = "this product is in StyleMyFit but not Live";
        log("Product found in StyleMyFit but not Live - hiding the button", details);
      } else if (answer.status === STATUS_NOT_FOUND) {
        hiddenReason = "no StyleMyFit product matches this page";
        log("Product not found in StyleMyFit - hiding the button", details);
      } else {
        log("Product not found in StyleMyFit (or not Live) - hiding the button", details);
      }

      // Sizes for the shopper's saved profiles (smf-fit-summary.js). Only for a real Live answer;
      // the theme editor always gets a preview so merchants can see and place it.
      var fitSummary = window.SMFFitSummary;
      if (fitSummary && designMode) fitSummary.attach(block, key, pageUrl, true);
      else if (fitSummary && show && source !== "error") fitSummary.attach(block, key, pageUrl, false);

      if (show) {
        block.removeAttribute("hidden");
      } else if (designMode) {
        // Keep it visible (dimmed) in the theme editor so merchants can still place and style it
        block.className += " smf-block--ineligible";
        block.setAttribute("title", "Hidden on your store: " + hiddenReason);
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
