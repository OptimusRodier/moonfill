// Techfill core: the ready-made presets and helpers, shared by the on-page orb (techfill.js)
// and the preset editor window (presets.js). Exposes ONE global: TechfillCore.
const TechfillCore = (() => {
const BASE = `# Techfill preset. One line per field:   Field label = value
# Dropdowns and text: the exact text shown in Salesforce. Checkboxes: true / false.
# {today} = today's date as dd/mm/yyyy. {created} = the date on the Created. line of
# Implementation History (e.g. Pixel Sent = {created}).
# Lines starting with # are ignored, and a field without a value is skipped.
# Left out on purpose: Successful Tracking Test (done by hand) and the read-only
# SingleView date and time-tracking fields.
# Also left out: Moonpull Status, Consent Signals, Transparency & Consent Framework Plugin,
# AASAF and Consent Management Platform. Moonfill fills those from the latest Moonpull scan
# result (overwriting what is there), so Techfill never touches them.
# SingleView Setup Type / Integration Status are filled automatically from the account type:
# Client Type, double-checked with Platform Offer when it says Access
# (Access = SV not activated. Anything else = MasterTag enabled + New).
# Add a line for them here only if you want to override that.
# Values you change in the on-page "Parameters" panel overwrite what is on the record.

Pixel Sent = {today}
# Successful Tracking Test =
Img tag implemented = Yes
Script tag implemented = Yes
1st party cookie compliant = Yes
Mastertag implemented on all pages = Yes
Server to server = Yes
# 3rd Party S2S Integration Tool =
Adblocking solution = Yes
Deduplication = Yes with channel parameters
Deduplication Solution = Not Applicable
# Other Deduplication Solution =
Deduplication Parameter = source,utm_source
Channel parameters implemented = aw,awin
Tag Management Solution = {tms}
eCommerce platform = {ecom}
# Website Platform URL =
# Other eCommerce platform =
Transactional app available = Yes
App tracking implemented = No
Keep users on m-web = No
Voucher Tracking implemented = Yes
Product Level Tracking implemented = Yes
Multi-currency implemented = No
VAT and Delivery implemented = Both excluded
Mobile Site Tracking Implemented = Yes
App tracking provider = No
# Other App tracking implemented =
Link Builder activated = Yes
# Active cross device =
# MT plugins activated =
Custom parameters implemented = Yes
Custom parameters notes = N vs R
Product Feed uploaded = Yes
# Product Feed format =
Batch validation = Yes
Linked Accounts activated = No
# AM set up in Awin UI =
IP Truncation Level Enabled = Level 4
Transaction Referrer Truncation = Strip path information when no valid domain
# Tech notes =
# Sales Tech Handover Notes =
`;

const DEFAULTS = [
  { key: "standard", name: "Standard (direct imp)", ecom: "Not Applicable", tms: "Not Applicable" },
  { key: "shopify", name: "Shopify", ecom: "Shopify", tms: "Not Applicable" },
  { key: "woocommerce", name: "WooCommerce", ecom: "Wordpress (Woocommerce)", tms: "Not Applicable" },
  { key: "magento", name: "Magento", ecom: "Magento", tms: "Not Applicable" },
  { key: "prestashop", name: "PrestaShop", ecom: "Prestashop", tms: "Not Applicable" },
  { key: "gtm", name: "GTM", ecom: "Not Applicable", tms: "GTM (Google Tag Manager)" },
  // Platforms added with the automatic platform detection. Values (eCommerce platform, Tag Management
  // Solution, Deduplication, Voucher / Product Level Tracking) are the Checklist Autofill team templates.
    {"key": "bigcommerce", "name": "BigCommerce", "ecom": "Bigcommerce", "tms": "Other", "lines": {"Deduplication Solution": "Other", "Voucher Tracking implemented": "Unknown", "Product Level Tracking implemented": "Yes", "Other Deduplication Solution": "BigCommerce plugin"}},
    {"key": "lightspeed", "name": "Lightspeed", "ecom": "Lightspeed", "tms": "Other", "lines": {"Deduplication Solution": "Other", "Voucher Tracking implemented": "Unknown", "Product Level Tracking implemented": "Yes", "Other Deduplication Solution": "Lightspeed plugin"}},
    {"key": "opencart", "name": "OpenCart", "ecom": "OpenCart", "tms": "Other", "lines": {"Deduplication Solution": "Other", "Voucher Tracking implemented": "Unknown", "Product Level Tracking implemented": "Yes", "Other Deduplication Solution": "OpenCart plugin"}},
    {"key": "sfcc", "name": "Salesforce Commerce Cloud", "ecom": "Salesforce Commerce Cloud", "tms": "Other", "lines": {"Deduplication Solution": "Other", "Voucher Tracking implemented": "Unknown", "Product Level Tracking implemented": "Yes", "Other Deduplication Solution": "Salesforce Commerce Cloud plugin"}},
    {"key": "shoplazza", "name": "Shoplazza", "ecom": "Shoplazza", "tms": "Other", "lines": {"Deduplication Solution": "Other", "Voucher Tracking implemented": "Unknown", "Product Level Tracking implemented": "Yes", "Other Deduplication Solution": "Shoplazza plugin"}},
    {"key": "shopware5", "name": "Shopware 5", "ecom": "Shopware", "tms": "Other", "lines": {"Deduplication Solution": "Other", "Voucher Tracking implemented": "Unknown", "Product Level Tracking implemented": "Yes", "Other Deduplication Solution": "Shopware 5 plugin"}},
    {"key": "shopware6", "name": "Shopware 6", "ecom": "Shopware", "tms": "Other", "lines": {"Deduplication Solution": "Other", "Voucher Tracking implemented": "Unknown", "Product Level Tracking implemented": "Yes", "Other Deduplication Solution": "Shopware 6 plugin"}},
    {"key": "squarespace", "name": "Squarespace", "ecom": "Squarespace", "tms": "Other", "lines": {"Deduplication Solution": "Other", "Voucher Tracking implemented": "Unknown", "Product Level Tracking implemented": "Yes", "Other Deduplication Solution": "Squarespace plugin"}},
    {"key": "wix", "name": "Wix", "ecom": "Wix", "tms": "Other", "lines": {"Deduplication Solution": "Other", "Voucher Tracking implemented": "Unknown", "Product Level Tracking implemented": "No", "Other Deduplication Solution": "Wix plugin"}}
];
const makeTemplate = (d) => {
    let t = BASE.replace("{ecom}", d.ecom).replace("{tms}", d.tms);
    // platform-specific lines replace (or add) the matching "Label = value" line, commented or not
    Object.entries(d.lines || {}).forEach(([label, value]) => {
      const re = new RegExp("^#?[ \\t]*" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ \\t]*=.*$", "m");
      t = re.test(t) ? t.replace(re, `${label} = ${value}`) : t + `\n${label} = ${value}`;
    });
    return t;
  };
const uid = () => Math.random().toString(36).slice(2, 10);
const defaultPreset = (d) => ({ id: uid(), key: d.key, name: d.name, text: makeTemplate(d), overrides: [] });
const SCAN_LABELS = ["moonpull status", "consent signals", "transparency & consent framework plugin", "aasaf", "consent management platform"];
const stripScanLines = (text) => String(text || "").split("\n").filter((line) => {
  const t = line.trim();
  if (t.startsWith("# Moonpull Status: change it")) return false;
  if (!t || t.startsWith("#")) return true;
  const i = t.indexOf("=");
  return i < 1 || !SCAN_LABELS.includes(t.slice(0, i).replace(/\s+/g, " ").trim().toLowerCase());
}).join("\n");
  // Detected platform name (see detect-platform.js) -> preset key
  const PLATFORM_KEYS = {
    "Shopify": "shopify", "WooCommerce": "woocommerce", "Magento": "magento", "PrestaShop": "prestashop",
    "BigCommerce": "bigcommerce", "Lightspeed": "lightspeed", "OpenCart": "opencart", "Salesforce Commerce Cloud": "sfcc",
    "Shoplazza": "shoplazza", "Shopware 5": "shopware5", "Shopware 6": "shopware6", "Squarespace": "squarespace", "Wix": "wix"
  };
  // Saved presets brought up to date: scan lines stripped, overrides list present, every ready-made preset exists
  function upgradePresets(list) {
    const out = (list || []).map((p) => ({ ...p, text: stripScanLines(p.text), overrides: p.overrides || [] }));
    DEFAULTS.forEach((d) => { if (!out.some((p) => p.key === d.key)) out.push(defaultPreset(d)); });
    return out;
  }
  return { BASE, DEFAULTS, makeTemplate, uid, defaultPreset, stripScanLines, PLATFORM_KEYS, upgradePresets };
})();
