const fs = require("fs");
const path = require("path");

const PLUGINS_DIR = path.join(__dirname, "..", "plugins");

function safeLoadPlugin(file) {
  const full = path.join(PLUGINS_DIR, file);
  try {
    delete require.cache[require.resolve(full)];
  } catch (_e) {
    /* ignore */
  }
  return require(full);
}

/**
 * Optional plugins: each file exports { name, description, argsHint?, handler, schema? }.
 * Files starting with _ are ignored.
 */
function loadPluginsFromDisk() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  const out = [];
  for (const file of fs.readdirSync(PLUGINS_DIR)) {
    if (!file.endsWith(".js") || file.startsWith("_")) continue;
    try {
      const mod = safeLoadPlugin(file);
      if (!mod || typeof mod.name !== "string" || typeof mod.handler !== "function") {
        console.warn(`plugins: skip ${file} (need name + handler)`);
        continue;
      }
      out.push({
        name: mod.name.trim(),
        description: String(mod.description || "").trim() || `Plugin ${mod.name}`,
        argsHint: mod.argsHint != null ? String(mod.argsHint) : "{}",
        handler: mod.handler,
        schema: mod.schema && typeof mod.schema === "object" ? mod.schema : null,
        source: file,
      });
    } catch (err) {
      console.warn(`plugins: failed ${file}:`, err.message);
    }
  }
  return out;
}

let cached;

function getPlugins() {
  if (!cached) {
    cached = loadPluginsFromDisk();
  }
  return cached;
}

function augmentManifest(baseManifest) {
  const plugins = getPlugins();
  const seen = new Set(baseManifest.map((t) => t.name));
  const extra = [];
  for (const p of plugins) {
    if (seen.has(p.name)) {
      console.warn(`plugins: duplicate name '${p.name}' ignored (${p.source})`);
      continue;
    }
    seen.add(p.name);
    extra.push({
      name: p.name,
      description: p.description,
      argsHint: p.argsHint,
    });
  }
  return [...baseManifest, ...extra];
}

function buildRegisteredNames(baseNames) {
  const s = new Set(baseNames);
  for (const p of getPlugins()) {
    s.add(p.name);
  }
  return s;
}

function applyPluginHandlers(handlers) {
  for (const p of getPlugins()) {
    if (Object.prototype.hasOwnProperty.call(handlers, p.name)) {
      console.warn(`plugins: handler '${p.name}' conflicts with built-in; skipping plugin`);
      continue;
    }
    handlers[p.name] = async (args, ctx) => p.handler(args, ctx);
  }
}

function getPluginSchemas() {
  const o = {};
  for (const p of getPlugins()) {
    if (p.schema) o[p.name] = p.schema;
  }
  return o;
}

module.exports = {
  augmentManifest,
  buildRegisteredNames,
  applyPluginHandlers,
  getPluginSchemas,
  getPlugins,
  PLUGINS_DIR,
};
