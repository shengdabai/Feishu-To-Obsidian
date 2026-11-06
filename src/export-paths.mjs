import { createHash } from "node:crypto";

export function documentFileBase(title, sourceUrl) {
  const cleanedTitle = String(title).normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ").trim();
  // Keep complete code points and reserve bytes for " - ", the hash and ".raw.txt".
  let safeTitle = "";
  for (const char of Array.from(cleanedTitle).slice(0, 80)) {
    if (Buffer.byteLength(safeTitle + char, "utf8") > 228) break;
    safeTitle += char;
  }
  safeTitle = safeTitle.trim() || "untitled";
  const url = new URL(sourceUrl);
  url.hash = "";
  const identity = createHash("sha256").update(url.href).digest("hex").slice(0, 16);
  return `${safeTitle} - ${identity}`;
}
