// Platform detection (runs in the background service worker; loaded with importScripts).
// The approach and the platform signs are taken from the colleague's Checklist Autofill
// (Moonfill_x_SF_autofill) and adapted: no permission prompt (site access is declared in the manifest),
// results are cached, tiny pages are re-read in a background tab only when needed.
//
//   { action: "detectPlatform", url }  ->  { name | null, reason, via, cached? } or { error }
//
// The client's page is requested once (HTML + response headers) and searched for each platform's
// signs; the platform with the most matching signs wins, a tie or no match means "not detected".
(function (root) {
  const LIMIT = 1500000;        // characters of page text kept
  const FETCH_TIMEOUT = 8000;
  const TAB_TIMEOUT = 15000;
  const TAB_SETTLE = 1500;      // let the page's scripts run after it loads
  const SHELL_SIZE = 20000;     // a smaller page is probably a script-rendered shell
  const POSITIVE_MS = 12 * 3600 * 1000;
  const NEGATIVE_MS = 1 * 3600 * 1000;

  const SIGNS = {
    'BigCommerce': [/cdn\d*\.bigcommerce\.com/i, /mybigcommerce\.com/i, /stencil-utils/i, /\bBCData\b/],
    'Lightspeed': [/webshopapp\.com/i, /shoplightspeed\.com/i, /lightspeedhq/i, /\bseoshop\b/i],
    'Magento': [/text\/x-magento-init/i, /\bMagento_[A-Z]/, /mage\/cookies/i, /\/static\/version\d+\/frontend\//i],
    'OpenCart': [/index\.php\?route=(common|product|checkout|account)\//i, /catalog\/view\/(theme|javascript)\//i, /\bOpenCart\b/i],
    'PrestaShop': [/var prestashop\s*=/i, /\/modules\/ps_[a-z]/i, /\bprestashop\b/i],
    'Salesforce Commerce Cloud': [/\/on\/demandware\.(store|static)\//i, /\bdemandware\b/i, /dwanalytics/i, /\/dw\/shop\//i],
    'Shopify': [/cdn\.shopify\.com/i, /\bShopify\.theme\b/, /\bShopify\.shop\s*=/, /myshopify\.com/i, /shopify-digital-wallet/i],
    'Shoplazza': [/shoplazza\.com/i, /\bshoplazza\b/i, /\bSHOPLAZZA\b/],
    'Shopware 5': [/\/themes\/Frontend\//i, /\/web\/cache\/\d+_/i, /\bStateManager\b/, /jQuery\.publish/],
    'Shopware 6': [/\/bundles\/storefront\//i, /window\.router\s*=/, /frontend\.checkout\./i, /\/theme\/[0-9a-f]{32}\//i],
    'Squarespace': [/static1\.squarespace\.com/i, /Static\.SQUARESPACE_CONTEXT/, /squarespace-cdn\.com/i, /\bsquarespace\b/i],
    'Wix': [/static\.wixstatic\.com/i, /parastorage\.com/i, /x-wix-request-id/i, /wixsite\.com/i, /\bwix-bolt\b/i],
    'WooCommerce': [/wp-content\/plugins\/woocommerce\//i, /woocommerce-no-js/i, /\bwc-block-/i, /woocommerce_params|wc_add_to_cart_params/]
  };

  // The platform whose signs best match the page text. { name } or { name: null, reason }
  function detect(text) {
    const scores = Object.entries(SIGNS)
      .map(([name, list]) => ({ name, score: list.filter((sign) => sign.test(text)).length }))
      .filter((s) => s.score)
      .sort((a, b) => b.score - a.score);
    if (!scores.length) return { name: null, reason: "no platform signs found on the site" };
    if (scores[1] && scores[1].score === scores[0].score) {
      return { name: null, reason: `the site shows signs of both ${scores[0].name} and ${scores[1].name}` };
    }
    return { name: scores[0].name };
  }

  // "https://shop.com/x", "shop.com" and "www.shop.com" are accepted; anything else is not an address
  function webAddress(raw) {
    const t = String(raw == null ? "" : raw).trim();
    if (!t || /\s/.test(t)) return null;
    const url = /^https?:\/\//i.test(t) ? t : /^[\w-]+(\.[\w-]+)+([/?#:].*)?$/.test(t) ? "https://" + t : null;
    if (!url) return null;
    try { return new URL(url).href; } catch (e) { return null; }
  }

  // never read the user's own machine or private network
  function privateHost(host) {
    const h = host.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
    const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
    if (m) { const a = +m[1], b = +m[2]; return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254); }
    return h.includes(":"); // IPv6 literal
  }

  async function viaFetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { credentials: "omit", redirect: "follow", cache: "no-store", signal: controller.signal });
      const headers = [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n");
      return { ok: res.ok, status: res.status, text: (headers + "\n" + (await res.text())).slice(0, LIMIT) };
    } finally {
      clearTimeout(timer);
    }
  }

  // Reads the page inside an inactive tab (after its scripts ran), then closes the tab
  async function viaTab(url) {
    const tab = await chrome.tabs.create({ url, active: false });
    try {
      await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); };
        const onUpdated = (id, info) => { if (id === tab.id && info.status === "complete") done(); };
        const timer = setTimeout(done, TAB_TIMEOUT);
        chrome.tabs.onUpdated.addListener(onUpdated);
      });
      await new Promise((resolve) => setTimeout(resolve, TAB_SETTLE));
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (limit) => {
          const globals = ["Shopify", "Shopware", "BCData", "prestashop", "Mage", "wixBiSession", "Static", "woocommerce_params", "SHOPLAZZA"]
            .filter((name) => name in window).map((name) => `window.${name}`).join(" ");
          return (document.documentElement.outerHTML + "\n" + globals).slice(0, limit);
        },
        args: [LIMIT]
      });
      return { ok: true, status: 200, text: (frame && frame.result) || "" };
    } finally {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  async function run(rawUrl) {
    const url = webAddress(rawUrl);
    if (!url) return { error: "not a web address" };
    const u = new URL(url);
    if (privateHost(u.hostname)) return { error: "private address" };

    const key = "moonfillPlatform_" + u.origin;
    try {
      const c = (await chrome.storage.session.get(key))[key];
      if (c && Date.now() - c.at < (c.name ? POSITIVE_MS : NEGATIVE_MS)) return { ...c, cached: true };
    } catch (e) { /* no session storage: just detect again */ }

    let via = "fetch";
    let page;
    try { page = await viaFetch(url); }
    catch (e) { page = { ok: false, status: 0, error: e && e.name === "AbortError" ? "timed out" : String((e && e.message) || e) }; }
    let found = page.ok
      ? detect(page.text)
      : { name: null, reason: page.error ? `the site couldn't be read (${page.error})` : `the site answered ${page.status}` };
    // nothing found on a page that could not be read, or that is a tiny script-rendered shell: read it in a tab
    if (!found.name && (!page.ok || page.text.length < SHELL_SIZE)) {
      try {
        const t = await viaTab(url);
        if (t.ok && t.text.trim()) { found = detect(t.text); via = "tab"; } // an empty read keeps the earlier reason
      } catch (e) { found = { name: null, reason: found.reason || `the site couldn't be read in a tab (${e && e.message})` }; }
    }
    const out = { name: found.name || null, reason: found.reason || "", via, at: Date.now() };
    try { await chrome.storage.session.set({ [key]: out }); } catch (e) { /* ignore */ }
    return out;
  }

  root.PlatformDetect = { SIGNS, detect, webAddress, privateHost, run };
})(globalThis);
