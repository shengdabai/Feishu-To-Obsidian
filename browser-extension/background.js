const DOWNLOAD_DIR = "Feishu Exports";
const SUPPORTED_HOST_PATTERNS = [
  /\.feishu\.cn$/i,
  /\.larksuite\.com$/i
];

chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab.id;

  if (!tabId) {
    return;
  }

  try {
    await setBusy(tabId);
    const url = new URL(tab.url || "");
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !SUPPORTED_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
      throw new Error("请先打开飞书文档或知识库页面，再点击插件按钮。");
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractFeishuPage
    });

    const result = injection?.result;
    if (!result?.success) {
      throw new Error(result?.error || "未能提取页面内容。");
    }

    const safeBaseName = slugify(result.title || "feishu-export");
    const markdownFilename = `${DOWNLOAD_DIR}/${safeBaseName}.md`;
    const rawFilename = `${DOWNLOAD_DIR}/${safeBaseName}.raw.txt`;

    await downloadText(markdownFilename, result.markdown, "text/markdown;charset=utf-8");
    await downloadText(rawFilename, result.rawText, "text/plain;charset=utf-8");

    await setSuccess(tabId, `已下载到 Downloads/${DOWNLOAD_DIR}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await setError(tabId, message);
    } catch {
      // The tab may have closed while extraction or badge updates were in progress.
    }
  }
});

// Service workers have no URL.createObjectURL (it is only exposed to windows and dedicated/shared
// workers), so the text is handed to chrome.downloads as a base64 data: URL instead.
function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

async function downloadText(filename, content, mimeType) {
  await chrome.downloads.download({
    url: `data:${mimeType};base64,${toBase64Utf8(content)}`,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
}

function slugify(inputText) {
  const cleaned = inputText.normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ").trim();
  const encoder = new TextEncoder();
  const maxTitleBytes = 255 - encoder.encode(".raw.txt").length - 16;
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(cleaned);
  let title = "";
  let count = 0;
  // Reserve 16 bytes for uniquify's suffix as well as .raw.txt; keep whole graphemes.
  for (const { segment } of graphemes) {
    if (count >= 80 || encoder.encode(title + segment).length > maxTitleBytes) break;
    title += segment;
    count += 1;
  }
  return title.trim() || "untitled";
}

async function setBusy(tabId) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#0369a1" });
  await chrome.action.setBadgeText({ tabId, text: "..." });
  await chrome.action.setTitle({
    tabId,
    title: "正在提取当前飞书页面，请稍候"
  });
}

async function setSuccess(tabId, title) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#15803d" });
  await chrome.action.setBadgeText({ tabId, text: "OK" });
  await chrome.action.setTitle({ tabId, title });
  clearBadgeLater(tabId, 8000);
}

async function setError(tabId, title) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b91c1c" });
  await chrome.action.setBadgeText({ tabId, text: "ERR" });
  await chrome.action.setTitle({ tabId, title });
  clearBadgeLater(tabId, 12000);
}

function clearBadgeLater(tabId, delayMs) {
  setTimeout(async () => {
    try {
      await chrome.action.setBadgeText({ tabId, text: "" });
      await chrome.action.setTitle({
        tabId,
        title: "下载当前飞书页面为 Markdown"
      });
    } catch {
      // Ignore badge cleanup errors if the tab no longer exists.
    }
  }, delayMs);
}

async function extractFeishuPage() {
  const EXPAND_LABELS = [
    "展开",
    "展开更多",
    "查看更多",
    "显示全部",
    "继续阅读",
    "更多",
    "全文",
    "阅读更多",
    "Expand",
    "Show more",
    "See more",
    "More"
  ];

  const IGNORED_LINE_PATTERNS = [
    /^飞书云文档$/,
    /^登录\/注册$/,
    /^帮助中心$/,
    /^效率指南$/,
    /^加载中\.\.\.$/,
    /^与我分享$/,
    /^评论（\d+）$/,
    /^header-v2$/,
    /^纳豆的云文档$/,
    /^纳$/,
    /^最新修改时间为.+$/,
    /^最新修改时间.+$/
  ];

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const cleanLine = (text) =>
    (text || "")
      .replace(/[\u200b-\u200f\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const shouldIgnoreLine = (line) =>
    IGNORED_LINE_PATTERNS.some((pattern) => pattern.test(line));

  const uniqueOrderedLines = (lines) => {
    const seen = new Set();
    const output = [];

    for (const rawLine of lines) {
      const line = cleanLine(rawLine);
      if (!line || shouldIgnoreLine(line)) {
        continue;
      }
      if (seen.has(line)) {
        continue;
      }
      seen.add(line);
      output.push(line);
    }

    return output;
  };

  const isShortHeading = (line) => line.length <= 64;

  const classifyLine = (line) => {
    if (/^第[一二三四五六七八九十0-9]+章/.test(line) && isShortHeading(line)) {
      return "chapter";
    }

    if (/^[一二三四五六七八九十]+[、.：:]/.test(line) && isShortHeading(line)) {
      return "section";
    }

    if (/^技巧\d+/.test(line) && isShortHeading(line)) {
      return "section";
    }

    if (/^法则[一二三四五六七八九十0-9]+/.test(line) && isShortHeading(line)) {
      return "section";
    }

    if (/^本章小结$/.test(line)) {
      return "section";
    }

    if (/^[（(][一二三四五六七八九十0-9]+[）)]/.test(line) && isShortHeading(line)) {
      return "section";
    }

    if (/^\d+[、.]\s*/.test(line)) {
      return "ordered-item";
    }

    if (/^[a-zA-Z][.)]\s*/.test(line)) {
      return "ordered-item";
    }

    if (/^[•◦·-]\s*/.test(line)) {
      return "bullet";
    }

    return "paragraph";
  };

  const renderMarkdownFromLines = (lines, documentTitle) => {
    const output = [];
    let skippedTitle = false;

    for (const line of lines) {
      if (!skippedTitle && cleanLine(line) === cleanLine(documentTitle)) {
        skippedTitle = true;
        continue;
      }

      const kind = classifyLine(line);

      if (kind === "chapter") {
        if (output.length > 0 && output.at(-1) !== "") {
          output.push("");
        }
        output.push(`## ${line}`);
        output.push("");
        continue;
      }

      if (kind === "section") {
        if (output.length > 0 && output.at(-1) !== "") {
          output.push("");
        }
        output.push(`### ${line}`);
        output.push("");
        continue;
      }

      if (kind === "ordered-item") {
        output.push(`- ${line.replace(/^\d+[、.]\s*|^[a-zA-Z][.)]\s*/, "")}`);
        continue;
      }

      if (kind === "bullet") {
        output.push(`- ${line.replace(/^[•◦·-]\s*/, "")}`);
        continue;
      }

      output.push(line);
    }

    return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  };

  const clickExpandableElements = async () => {
    const allowedLabels = new Set(EXPAND_LABELS);
    const selector = "button, [role='button'], summary, span, div";
    for (const element of document.querySelectorAll(selector)) {
      const text = cleanLine(element.textContent || "");
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
  };

  const scrollWindow = async () => {
    let previousHeight = 0;

    for (let round = 0; round < 10; round += 1) {
      const currentHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
      window.scrollTo(0, currentHeight);
      await wait(900);
      await clickExpandableElements();

      if (currentHeight === previousHeight) {
        break;
      }

      previousHeight = currentHeight;
    }

    window.scrollTo(0, 0);
    await wait(300);
  };

  const collectScrollableText = async () => {
    const chunks = [];
    let previousSignature = "";

    for (let round = 0; round < 40; round += 1) {
      const snapshot = (() => {
        const rootCandidates = [
          ".page-main",
          ".page-main-item.editor",
          ".editor-container",
          ".page-block.root-block",
          "#docx .page-main",
          "#docx"
        ];

        const getVisibleText = (element) =>
          (element?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();

        const root =
          rootCandidates
            .map((selector) => document.querySelector(selector))
            .find((element) => element && getVisibleText(element)) ||
          document.body;

        const scrollCandidates = Array.from(document.querySelectorAll("div, main, section"))
          .filter((element) => element.scrollHeight > element.clientHeight + 200)
          .sort((left, right) => {
            const leftScore = left.scrollHeight - left.clientHeight;
            const rightScore = right.scrollHeight - right.clientHeight;
            return rightScore - leftScore;
          });

        const scroller =
          scrollCandidates.find((element) => element.contains(root) || root.contains(element)) ||
          scrollCandidates.find((element) => {
            const className = typeof element.className === "string" ? element.className : "";
            return className.includes("bear-web") || className.includes("scrollbar");
          }) ||
          document.scrollingElement ||
          document.documentElement;

        const title =
          document.querySelectorAll("h1")[1]?.textContent?.trim() ||
          document.querySelector("h1")?.textContent?.trim() ||
          document.title.replace(/\s*-\s*飞书云文档\s*$/, "").trim() ||
          document.title.trim() ||
          "Feishu Document";

        return {
          title,
          rootText: getVisibleText(root),
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight
        };
      })();

      chunks.push(snapshot.rootText);

      const signature = snapshot.rootText.slice(0, 800);
      const isAtBottom =
        snapshot.scrollTop + snapshot.clientHeight >= snapshot.scrollHeight - 10;

      if (isAtBottom && signature === previousSignature) {
        return {
          title: snapshot.title,
          chunks
        };
      }

      previousSignature = signature;

      (() => {
        const scrollCandidates = Array.from(document.querySelectorAll("div, main, section"))
          .filter((element) => element.scrollHeight > element.clientHeight + 200)
          .sort((left, right) => {
            const leftScore = left.scrollHeight - left.clientHeight;
            const rightScore = right.scrollHeight - right.clientHeight;
            return rightScore - leftScore;
          });

        const root =
          document.querySelector(".page-main") ||
          document.querySelector(".page-main-item.editor") ||
          document.querySelector(".editor-container") ||
          document.querySelector("#docx") ||
          document.body;

        const scroller =
          scrollCandidates.find((element) => element.contains(root) || root.contains(element)) ||
          scrollCandidates.find((element) => {
            const className = typeof element.className === "string" ? element.className : "";
            return className.includes("bear-web") || className.includes("scrollbar");
          }) ||
          document.scrollingElement ||
          document.documentElement;

        const nextTop = Math.min(
          scroller.scrollTop + Math.max(scroller.clientHeight * 0.85, 700),
          scroller.scrollHeight
        );

        scroller.scrollTop = nextTop;
      })();

      await wait(850);
      await clickExpandableElements();
    }

    const fallbackTitle =
      document.querySelectorAll("h1")[1]?.textContent?.trim() ||
      document.title.replace(/\s*-\s*飞书云文档\s*$/, "").trim() ||
      document.title.trim() ||
      "Feishu Document";

    return {
      title: fallbackTitle,
      chunks
    };
  };

  try {
    // Recheck the injected page: the tab can navigate between the click and injection.
    const url = new URL(location.href);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !/\.(?:feishu\.cn|larksuite\.com)$/i.test(url.hostname)) {
      throw new Error("请先打开 HTTPS 飞书/Lark 文档或知识库页面。");
    }
    await wait(1800);
    await clickExpandableElements();
    await scrollWindow();
    const collected = await collectScrollableText();

    const lines = uniqueOrderedLines(
      collected.chunks.flatMap((chunk) => chunk.split(/\r?\n/))
    );

    if (lines.length === 0) {
      return {
        success: false,
        error: "页面中没有提取到可见正文，请先确认你能正常看到完整文档。"
      };
    }

    const title = cleanLine(collected.title || lines[0] || "Feishu Document");
    const rawText = lines.join("\n");
    const markdownBody = renderMarkdownFromLines(lines, title);
    const markdown = [
      `# ${title}`,
      "",
      `- 来源: ${location.href}`,
      `- 导出时间: ${new Date().toISOString()}`,
      `- 导出方式: 浏览器插件一键下载`,
      "",
      "## 正文",
      "",
      markdownBody || "_未能整理出正文，请查看 raw.txt 备份。_",
      "",
      "## 文字保全说明",
      "",
      "同次下载还会生成 `.raw.txt` 文件，用来保留页面可见纯文本，便于核对遗漏。"
    ].join("\n");

    return {
      success: true,
      title,
      markdown,
      rawText
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
