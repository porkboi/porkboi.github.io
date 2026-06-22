import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "./vendor/pdf.worker.min.mjs",
  import.meta.url
).toString();

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const MIN_PAGE_WIDTH = 390;
const MAX_PAGE_WIDTH = 460;
const ZOOM_LEVELS = [0.9, 1, 1.1];

const statusLightbox = document.getElementById("statusLightbox");
const hero = document.getElementById("hero");
const statusPill = document.getElementById("statusPill");
const statusDetail = document.getElementById("statusDetail");
const progressRing = document.getElementById("progressRing");
const bookmarkList = document.getElementById("bookmarkList");
const chapterSidebar = document.getElementById("chapterSidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const zoomBtn = document.getElementById("zoomBtn");
const navRow = document.getElementById("navRow");
const bookShell = document.getElementById("bookShell");
const rotateReminder = document.getElementById("rotateReminder");

const defaultPdfUrl = new URL("./pdf1.pdf", window.location.href).toString();
const chaptersJsonUrl = new URL("./chapters.json", window.location.href).toString();
const LOADING_TRANSITION_MS = 360;

let pageFlip = null;
let totalBookPages = 0;
let currentPageIndex = 0;
let currentZoomIndex = 1;
let renderedPageSpecs = [];
let chapterBookmarks = [];
let sidebarCollapsed = false;

function setStatus(label, state = "idle") {
  statusPill.textContent = label;
  if (statusLightbox.isConnected) {
    statusLightbox.dataset.state = state;
  }

  if (state === "idle") {
    statusPill.removeAttribute("data-state");
    return;
  }

  statusPill.dataset.state = state;
}

function setProgress(value) {
  const safeValue = Math.max(0, Math.min(100, value));
  progressRing.style.strokeDashoffset = `${100 - safeValue}`;
}

function showLightbox() {
  if (statusLightbox.isConnected) {
    statusLightbox.hidden = false;
  }
}

function hideLightbox() {
  fadeOutAndRemove(statusLightbox);
}

function hideHero() {
  fadeOutAndRemove(hero);
}

function fadeOutAndRemove(element) {
  if (!element || !element.isConnected) {
    return;
  }

  element.classList.add("is-fading-out");

  const removeElement = () => {
    if (element.isConnected) {
      element.remove();
    }
  };

  element.addEventListener("transitionend", removeElement, { once: true });
  window.setTimeout(removeElement, 320);
}

function isMobileDevice() {
  // Check if device is mobile based on screen width and touch capability
  return window.innerWidth < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
}

function isPortraitOrientation() {
  return window.innerHeight > window.innerWidth;
}

function updateRotateReminder() {
  if (rotateReminder && rotateReminder.isConnected) {
    const shouldShow = isMobileDevice() && isPortraitOrientation();
    rotateReminder.hidden = !shouldShow;
  }
}

// Listen for orientation changes
window.addEventListener("orientationchange", updateRotateReminder);
window.addEventListener("resize", updateRotateReminder);

// Initial check
updateRotateReminder();

function finishLoadingTransition(onReady) {
  hideLightbox();
  hideHero();

  window.setTimeout(() => {
    showReaderControls();

    if (typeof onReady === "function") {
      onReady();
    }
  }, LOADING_TRANSITION_MS);
}

function updateStatusDetail(current, total) {
  statusDetail.textContent = `${current} / ${total} book pages ready`;
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function slugify(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isChapterTitle(text) {
  return /\bchapter\b/i.test(text);
}

function setSidebarCollapsed(collapsed) {
  sidebarCollapsed = collapsed;
  chapterSidebar.dataset.collapsed = String(collapsed);
  sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  sidebarToggle.innerHTML = collapsed
    ? '<span class="toggle-icon" aria-hidden="true">&#9776;</span>'
    : '<span class="toggle-icon" aria-hidden="true">&#8249;</span>';
}

function getDisplayMetrics() {
  const sidebarWidth = !sidebarCollapsed && window.innerWidth > 900 ? 260 : 0;
  const available = Math.max(640, window.innerWidth - sidebarWidth - 72);
  const basePageWidth = Math.max(
    MIN_PAGE_WIDTH,
    Math.min(MAX_PAGE_WIDTH, Math.floor((available - 56) / 2))
  );
  const zoom = ZOOM_LEVELS[currentZoomIndex];
  const width = Math.round(basePageWidth * zoom);
  const height = Math.round((PDF_PAGE_HEIGHT / PDF_PAGE_WIDTH) * width);
  const spreadWidth = width * 2;

  return { width, height, spreadWidth };
}

function updateZoomButton() {
  zoomBtn.textContent = `${Math.round(ZOOM_LEVELS[currentZoomIndex] * 100)}%`;
}

function showReaderControls() {
  sidebarToggle.hidden = false;
  navRow.hidden = false;
  bookShell.hidden = false;
  document.body.classList.remove("is-loading");
}

function createBookRoot() {
  const root = document.createElement("div");
  root.id = "book";
  bookShell.replaceChildren(root);
  return root;
}

function buildPageElement(src, pageNumber, totalPages, side, label) {
  const page = document.createElement("div");
  page.className = "flipbook-page";

  if (pageNumber === 1 || pageNumber === totalPages) {
    page.dataset.density = "hard";
  }

  const crop = document.createElement("div");
  crop.className = "page-crop";
  crop.dataset.side = side;

  const image = document.createElement("img");
  image.src = src;
  image.alt = `${label} ${side} page ${pageNumber}`;

  crop.append(image);
  page.append(crop);

  return page;
}

async function renderPageToDataUrl(page, targetWidth) {
  const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const scale = targetWidth / baseViewport.width;
  const viewport = page.getViewport({ scale, rotation: page.rotate });
  const outputScale = window.devicePixelRatio || 1;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const renderContext = {
    canvasContext: context,
    transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
    viewport,
  };

  await page.render(renderContext).promise;

  return { dataUrl: canvas.toDataURL("image/jpeg", 0.92) };
}

function getBookPageForPdfPage(pdfPageNumber, pdfPageCount) {
  if (pdfPageCount <= 1) {
    return 1;
  }

  if (pdfPageNumber === 1) {
    return 1;
  }

  if (pdfPageNumber === pdfPageCount) {
    return pdfPageCount * 2 - 2;
  }

  return pdfPageNumber * 2 - 2;
}

function extractLinesFromTextContent(textContent) {
  const lines = [];

  for (const item of textContent.items) {
    const text = normalizeText(item.str || "");
    if (!text) {
      continue;
    }

    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const height =
      item.height ||
      Math.abs(item.transform?.[0] ?? 0) ||
      Math.abs(item.transform?.[3] ?? 0) ||
      0;

    let line = lines.find((entry) => Math.abs(entry.y - y) < 6);
    if (!line) {
      line = { y, items: [], maxHeight: height };
      lines.push(line);
    }

    line.items.push({ text, x });
    line.maxHeight = Math.max(line.maxHeight, height);
  }

  return lines
    .map((line) => {
      line.items.sort((left, right) => left.x - right.x);
      const text = normalizeText(line.items.map((item) => item.text).join(" "));
      return {
        text,
        y: line.y,
        maxHeight: line.maxHeight,
        wordCount: text.split(/\s+/).filter(Boolean).length,
      };
    })
    .filter((line) => line.text)
    .sort((left, right) => right.y - left.y);
}

function scoreHeadingCandidate(line, pageHeight) {
  if (!isChapterTitle(line.text)) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = Math.min(line.maxHeight, 34) + 80;

  if (line.wordCount <= 8) {
    score += 12;
  }

  if (line.wordCount > 16) {
    score -= 16;
  }

  if (line.y > pageHeight * 0.35) {
    score += 10;
  }

  if (line.text === line.text.toUpperCase()) {
    score += 8;
  }

  return score;
}

function findChapterCandidate(lines, pageHeight) {
  const candidates = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const score = scoreHeadingCandidate(line, pageHeight);
    if (Number.isFinite(score)) {
      candidates.push({ text: line.text, score, y: line.y });
    }

    const next = lines[index + 1];
    if (next && Math.abs(line.y - next.y) < Math.max(line.maxHeight, next.maxHeight) * 1.7) {
      const combinedText = normalizeText(`${line.text} ${next.text}`);
      const combinedLine = {
        text: combinedText,
        y: line.y,
        maxHeight: Math.max(line.maxHeight, next.maxHeight),
        wordCount: combinedText.split(/\s+/).filter(Boolean).length,
      };
      const combinedScore = scoreHeadingCandidate(combinedLine, pageHeight) + 6;
      if (Number.isFinite(combinedScore)) {
        candidates.push({ text: combinedText, score: combinedScore, y: line.y });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score || right.y - left.y);
  return candidates[0]?.score >= 70 ? candidates[0].text : null;
}

async function detectChapterBookmark(page, pdfPageNumber, pdfPageCount) {
  const textContent = await page.getTextContent();
  const lines = extractLinesFromTextContent(textContent);
  const pageHeight = page.getViewport({ scale: 1 }).height;
  const title = findChapterCandidate(lines, pageHeight);

  if (!title) {
    return null;
  }

  return {
    title,
    pageNumber: getBookPageForPdfPage(pdfPageNumber, pdfPageCount),
    pdfPageNumber,
    key: slugify(title),
  };
}

async function loadLocalChapters() {
  try {
    const response = await fetch(chaptersJsonUrl, { cache: "no-store" });
    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const chapters = Array.isArray(payload) ? payload : payload.chapters;
    if (!Array.isArray(chapters)) {
      return [];
    }

    return chapters
      .filter((chapter) => chapter && isChapterTitle(chapter.title || ""))
      .map((chapter) => ({
        title: normalizeText(chapter.title),
        pageNumber: Number(chapter.pageNumber),
        pdfPageNumber: Number(chapter.pdfPageNumber || 0),
        key: slugify(chapter.title),
      }))
      .filter((chapter) => Number.isFinite(chapter.pageNumber) && chapter.pageNumber > 0);
  } catch {
    return [];
  }
}

function renderBookmarks() {
  if (!chapterBookmarks.length) {
    bookmarkList.replaceChildren();
    setSidebarCollapsed(true);
    return;
  }

  const buttons = chapterBookmarks.map((bookmark) => {
    const button = document.createElement("button");
    button.className = "bookmark-chip";
    button.type = "button";
    button.dataset.pageIndex = String(bookmark.pageNumber - 1);
    button.innerHTML = `<span>${bookmark.title}</span><span class="bookmark-page">p. ${bookmark.pageNumber}</span>`;
    button.addEventListener("click", () => {
      if (pageFlip) {
        currentPageIndex = bookmark.pageNumber - 1;
        pageFlip.flip(bookmark.pageNumber - 1, "top");
        updateActiveBookmark(currentPageIndex);
      }
    });
    return button;
  });

  bookmarkList.replaceChildren(...buttons);
}

function updateActiveBookmark(pageIndex) {
  const buttons = bookmarkList.querySelectorAll(".bookmark-chip");
  if (!buttons.length) {
    return;
  }

  let activeIndex = 0;
  for (let index = 0; index < chapterBookmarks.length; index += 1) {
    if (chapterBookmarks[index].pageNumber - 1 <= pageIndex) {
      activeIndex = index;
    }
  }

  buttons.forEach((button, index) => {
    button.classList.toggle("is-active", index === activeIndex);
  });
}

function mountFlipbook(startPageIndex = 0) {
  if (pageFlip) {
    try {
      pageFlip.destroy();
    } catch (error) {
      console.warn("Unable to destroy prior flipbook instance.", error);
    }
    pageFlip = null;
  }

  const root = createBookRoot();
  root.replaceChildren(
    ...renderedPageSpecs.map((page) =>
      buildPageElement(page.src, page.pageNumber, totalBookPages, page.side, page.label)
    )
  );

  const metrics = getDisplayMetrics();
  bookShell.style.setProperty("--page-width", `${metrics.spreadWidth}px`);
  bookShell.style.setProperty("--page-height", `${metrics.height}px`);
  root.style.width = `${metrics.spreadWidth}px`;
  root.style.height = `${metrics.height}px`;
  updateZoomButton();

  pageFlip = new St.PageFlip(root, {
    width: metrics.width,
    height: metrics.height,
    size: "fixed",
    showCover: true,
    usePortrait: false,
    drawShadow: true,
    maxShadowOpacity: 0.16,
    flippingTime: 920,
    autoSize: true,
  });

  pageFlip.loadFromHTML(root.querySelectorAll(".flipbook-page"));

  const targetPage = Math.max(0, Math.min(startPageIndex, totalBookPages - 1));
  pageFlip.turnToPage(targetPage);

  currentPageIndex = targetPage;
  updateActiveBookmark(currentPageIndex);
}

async function buildFlipbook(source, label) {
  renderedPageSpecs = [];
  chapterBookmarks = await loadLocalChapters();
  totalBookPages = 0;
  currentPageIndex = 0;

  createBookRoot();
  showLightbox();
  setStatus("Loading PDF", "busy");
  setProgress(5);
  updateStatusDetail(0, 0);

  const loadingTask = pdfjsLib.getDocument(
    typeof source === "string" ? { url: source } : { data: source }
  );

  const pdf = await loadingTask.promise;
  totalBookPages = pdf.numPages <= 1 ? 1 : pdf.numPages * 2 - 2;
  const runtimeChapters = [];
  let bookPageNumber = 0;

  for (let pdfPageNumber = 1; pdfPageNumber <= pdf.numPages; pdfPageNumber += 1) {
    setStatus(`Rendering spread ${pdfPageNumber} of ${pdf.numPages}`, "busy");

    const page = await pdf.getPage(pdfPageNumber);
    if (!chapterBookmarks.length) {
      const bookmark = await detectChapterBookmark(page, pdfPageNumber, pdf.numPages);
      if (bookmark) {
        const prior = runtimeChapters[runtimeChapters.length - 1];
        if (!prior || prior.key !== bookmark.key) {
          runtimeChapters.push(bookmark);
        }
      }
    }

    const isBoundaryPage =
      pdf.numPages === 1 ||
      pdfPageNumber === 1
    const targetWidth = isBoundaryPage ? PDF_PAGE_WIDTH : PDF_PAGE_WIDTH * 2;
    const rendered = await renderPageToDataUrl(page, targetWidth);

    if (isBoundaryPage) {
      bookPageNumber += 1;
      renderedPageSpecs.push({ src: rendered.dataUrl, pageNumber: bookPageNumber, side: "full", label });
    } else {
      bookPageNumber += 1;
      renderedPageSpecs.push({ src: rendered.dataUrl, pageNumber: bookPageNumber, side: "left", label });
      bookPageNumber += 1;
      renderedPageSpecs.push({ src: rendered.dataUrl, pageNumber: bookPageNumber, side: "right", label });
    }

    const percent = 5 + (pdfPageNumber / pdf.numPages) * 90;
    setProgress(percent);
    updateStatusDetail(bookPageNumber, totalBookPages);
  }

  if (!chapterBookmarks.length) {
    chapterBookmarks = runtimeChapters.filter((bookmark) => isChapterTitle(bookmark.title));
  }

  renderBookmarks();
  setProgress(100);
  finishLoadingTransition(() => {
    requestAnimationFrame(() => {
      mountFlipbook(0);
    });
  });
}

async function loadBundledPdf() {
  try {
    await buildFlipbook(defaultPdfUrl, "pdf1.pdf");
  } catch (error) {
    console.error(error);
    setStatus("Unable to process PDF", "error");
    statusDetail.textContent = "The local PDF could not be rendered.";
  }
}

sidebarToggle.addEventListener("click", () => {
  setSidebarCollapsed(!sidebarCollapsed);
  if (renderedPageSpecs.length) {
    mountFlipbook(currentPageIndex);
  }
});

prevBtn.addEventListener("click", () => {
  if (pageFlip) {
    pageFlip.flipPrev("bottom");
  }
});

nextBtn.addEventListener("click", () => {
  if (pageFlip) {
    pageFlip.flipNext("bottom");
  }
});

zoomBtn.addEventListener("click", () => {
  if (!renderedPageSpecs.length) {
    return;
  }

  currentZoomIndex = (currentZoomIndex + 1) % ZOOM_LEVELS.length;
  mountFlipbook(currentPageIndex);
});

window.addEventListener("resize", () => {
  if (renderedPageSpecs.length) {
    mountFlipbook(currentPageIndex);
  }
});

setSidebarCollapsed(true);
updateZoomButton();
void loadBundledPdf();
