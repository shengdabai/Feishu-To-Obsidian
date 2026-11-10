export function validateDocumentUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("请使用有效的 HTTPS 飞书/Lark 文档链接。");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !/\.(?:feishu\.cn|larksuite\.com)$/i.test(url.hostname)) {
    throw new Error("仅支持不含账号密码和自定义端口的 HTTPS 飞书/Lark 链接。");
  }
  return url.href;
}

export function parseDocumentLinks(raw) {
  const links = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    try {
      links.push(validateDocumentUrl(value));
    } catch {
      throw new Error(`links.txt 第 ${index + 1} 行不是受支持的 HTTPS 飞书/Lark 链接。`);
    }
  }
  if (links.length === 0) throw new Error("links.txt 里还没有有效链接。");
  return [...new Set(links)];
}

// This function runs in the page, so it must not reference module bindings.
export function expandVisibleControls(labels) {
  const allowedLabels = new Set(labels);
  const selector = "button, [role='button'], summary, span, div";
  for (const element of document.querySelectorAll(selector)) {
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    if (!allowedLabels.has(text) || element.closest("a, form, [contenteditable]:not([contenteditable='false'])")) continue;
    if (element.tagName === "BUTTON" && element.form) continue;
    const control = element.closest("button, [role='button'], summary");
    if (control && control !== element) continue;
    if (element.querySelector("button, [role='button'], summary, a, input, select, textarea")) continue;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0) {
      element.click();
    }
  }
}
