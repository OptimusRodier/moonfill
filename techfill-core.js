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
  { key: "gtm", name: "GTM", ecom: "Not Applicable", tms: "GTM (Google Tag Manager)" }
];
const makeTemplate = (d) => BASE.replace("{ecom}", d.ecom).replace("{tms}", d.tms);
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
  return { BASE, DEFAULTS, makeTemplate, uid, defaultPreset, stripScanLines };
})();
