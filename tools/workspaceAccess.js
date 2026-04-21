const fs = require("fs");
const path = require("path");

const WORKSPACE_ROOT = path.resolve(process.env.VERA_WORKSPACE_ROOT || process.cwd());
const MAX_READ_BYTES = Number(process.env.VERA_WORKSPACE_READ_MAX_BYTES || 512000);
const MAX_LIST_ENTRIES = Number(process.env.VERA_WORKSPACE_LIST_MAX || 200);
const MAX_WRITE_BYTES = Number(process.env.VERA_WORKSPACE_WRITE_MAX_BYTES || 256000);

function resolveSafe(relativePath) {
  const rel = String(relativePath || "").trim() || ".";
  const joined = path.resolve(WORKSPACE_ROOT, rel);
  const rootNorm = path.resolve(WORKSPACE_ROOT);
  const relativeToRoot = path.relative(rootNorm, joined);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return { ok: false, error: "Path escapes workspace root." };
  }
  return { ok: true, absolute: joined };
}

function workspaceRead(relativePath) {
  const r = resolveSafe(relativePath);
  if (!r.ok) return { ok: false, error: r.error };
  try {
    const st = fs.statSync(r.absolute);
    if (!st.isFile()) return { ok: false, error: "Not a file." };
    if (st.size > MAX_READ_BYTES) {
      return { ok: false, error: `File too large (max ${MAX_READ_BYTES} bytes).` };
    }
    const text = fs.readFileSync(r.absolute, "utf8");
    return { ok: true, path: r.absolute, content: text };
  } catch (e) {
    return { ok: false, error: e.message || "read failed" };
  }
}

function workspaceList(relativePath = ".") {
  const r = resolveSafe(relativePath);
  if (!r.ok) return { ok: false, error: r.error };
  try {
    const st = fs.statSync(r.absolute);
    if (!st.isDirectory()) return { ok: false, error: "Not a directory." };
    const names = fs.readdirSync(r.absolute);
    const slice = names.slice(0, MAX_LIST_ENTRIES);
    const entries = slice.map((name) => {
      const p = path.join(r.absolute, name);
      let type = "unknown";
      try {
        const s = fs.statSync(p);
        type = s.isDirectory() ? "dir" : s.isFile() ? "file" : "other";
      } catch (_e) {
        type = "inaccessible";
      }
      return { name, type };
    });
    return {
      ok: true,
      path: r.absolute,
      entries,
      truncated: names.length > MAX_LIST_ENTRIES,
    };
  } catch (e) {
    return { ok: false, error: e.message || "list failed" };
  }
}

function workspaceWrite(relativePath, content) {
  const text = content != null ? String(content) : "";
  if (text.length > MAX_WRITE_BYTES) {
    return { ok: false, error: `Content too large (max ${MAX_WRITE_BYTES} chars).` };
  }
  const r = resolveSafe(relativePath);
  if (!r.ok) return { ok: false, error: r.error };
  try {
    const dir = path.dirname(r.absolute);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(r.absolute, text, "utf8");
    return { ok: true, path: r.absolute, bytesWritten: Buffer.byteLength(text, "utf8") };
  } catch (e) {
    return { ok: false, error: e.message || "write failed" };
  }
}

module.exports = {
  WORKSPACE_ROOT,
  resolveSafe,
  workspaceRead,
  workspaceList,
  workspaceWrite,
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
};
