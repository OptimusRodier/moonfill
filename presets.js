// Preset editor. Everything is saved as you type.

// Same values for every preset, only these two fields change.


// Ready-made presets. "standard" = direct implementation (no platform, no tag manager).


const { BASE, DEFAULTS, makeTemplate, uid, defaultPreset, stripScanLines } = TechfillCore; // techfill-core.js
const $ = (id) => document.getElementById(id);
// The five scan fields belong to Moonfill: strip them from presets saved by older versions

let state = { presets: [], activePreset: null, autoSave: false, presetsV: 4 };
let flashTimer = null;
let deleteArmed = false;
let resetArmed = false;

const current = () => state.presets.find((p) => p.id === state.activePreset) || state.presets[0];
const persist = () => chrome.storage.local.set(state);

function flash(text) {
  $("saved").textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => ($("saved").textContent = ""), 1500);
}

function draw() {
  const sel = $("preset");
  sel.textContent = "";
  state.presets.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  });
  sel.value = state.activePreset;
  $("name").value = current().name;
  $("text").value = current().text;
  document.querySelector(`input[name="mode"][value="${state.autoSave ? "save" : "review"}"]`).checked = true;
  $("delBtn").textContent = "Delete";
  deleteArmed = false;
  $("resetBtn").textContent = "Reset values";
  resetArmed = false;
}

async function load() {
  const s = await chrome.storage.local.get(["presets", "activePreset", "autoSave", "presetsV"]);
  let presets = s.presets && s.presets.length ? s.presets : [];
  let active = s.activePreset;

  if (!s.presetsV || s.presetsV < 2) {
    // One-time upgrade: the old single "Standard" (it filled Shopify) is kept as a backup,
    // then the six ready-made presets are added and "Standard (direct imp)" becomes the active one.
    presets = presets.map((p) =>
      !p.key && p.name === "Standard" ? { ...p, name: "Old Standard (backup)" } : p
    );
    DEFAULTS.forEach((d) => {
      if (!presets.some((p) => p.key === d.key)) presets.push(defaultPreset(d));
    });
    active = presets.find((p) => p.key === "standard").id;
  }

  if (!s.presetsV || s.presetsV < 3) {
    // v3: the five scan fields are Moonfill's; presets also keep a list of Parameters-panel overrides
    presets = presets.map((p) => ({ ...p, text: stripScanLines(p.text), overrides: p.overrides || [] }));
  }

  if (!s.presetsV || s.presetsV < 4) {
    // v4: the platforms added with automatic detection (BigCommerce, Lightspeed, ...) exist as presets
    DEFAULTS.forEach((d) => { if (!presets.some((p) => p.key === d.key)) presets.push(defaultPreset(d)); });
  }

  state.presets = presets;
  state.activePreset = presets.some((p) => p.id === active) ? active : presets[0].id;
  state.autoSave = !!s.autoSave;
  await persist();
  draw();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.presets || !state.presets.length) return;
  const incoming = changes.presets.newValue || [];
  if (JSON.stringify(incoming) === JSON.stringify(state.presets)) return; // our own write
  state.presets = incoming;
  if (!incoming.some((p) => p.id === state.activePreset) && incoming[0]) state.activePreset = incoming[0].id;
  draw();
});

document.addEventListener("DOMContentLoaded", () => {
  load();

  $("preset").addEventListener("change", async (e) => {
    state.activePreset = e.target.value;
    await persist();
    draw();
  });

  $("text").addEventListener("input", (e) => {
    current().text = e.target.value;
    persist();
    flash("Saved ✓");
  });

  $("name").addEventListener("input", (e) => {
    current().name = e.target.value || "Untitled";
    const opt = $("preset").selectedOptions[0];
    if (opt) opt.textContent = current().name;
    persist();
    flash("Saved ✓");
  });

  $("newBtn").addEventListener("click", async () => {
    const p = { id: uid(), key: current().key, name: "Copy of " + current().name, text: current().text, overrides: [...(current().overrides || [])] };
    state.presets.push(p);
    state.activePreset = p.id;
    await persist();
    draw();
    $("name").focus();
    $("name").select();
  });

  $("delBtn").addEventListener("click", async () => {
    if (state.presets.length <= 1) return flash("Keep at least one preset");
    if (!deleteArmed) {
      deleteArmed = true;
      $("delBtn").textContent = "Sure?";
      setTimeout(() => { deleteArmed = false; $("delBtn").textContent = "Delete"; }, 3000);
      return;
    }
    state.presets = state.presets.filter((p) => p.id !== state.activePreset);
    state.activePreset = state.presets[0].id;
    await persist();
    draw();
  });

  // Reset puts this preset back to its own ready-made values (Shopify -> Shopify, GTM -> GTM...)
  $("resetBtn").addEventListener("click", async () => {
    if (!resetArmed) {
      resetArmed = true;
      $("resetBtn").textContent = "Sure?";
      setTimeout(() => { resetArmed = false; $("resetBtn").textContent = "Reset values"; }, 3000);
      return;
    }
    const d = DEFAULTS.find((x) => x.key === current().key) || DEFAULTS[0];
    current().text = makeTemplate(d);
    current().overrides = []; // back to the ready-made values: nothing is forced any more
    await persist();
    draw();
    flash("Back to the usual values ✓");
  });

  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", () => {
      state.autoSave = r.value === "save" && r.checked;
      persist();
      flash("Saved ✓");
    })
  );
});
