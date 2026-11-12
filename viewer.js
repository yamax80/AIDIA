// =========================================================================
// VIEWER.JS — КАТАЛОГ, КАСКАДНЫЕ ФИЛЬТРЫ, ПЛЕЕР, ПОДПИСИ И ПОЛНЫЙ ЭКРАН
// =========================================================================
const SUPABASE_URL = "https://ppzbqkexgbcejgvazhlb.supabase.co";
const PUBLIC_KEY = "sb_publishable_yao4t4XJoW6i847Mi33ETw_bjJssYrs";
const HF_REPO = "YaMax80/diafilms-archive";
const VERTEX_PROJECT_ID = "gen-lang-client-0898760452";

const MODEL_PRICING_USD = {
  "gemini-3.1-flash-lite-image": { "1K": 0.015, "2K": 0.030 },
  "gemini-3.1-flash-image":      { "1K": 0.039, "2K": 0.075 },
  "gemini-3-pro-image":          { "1K": 0.134, "2K": 0.240 },
  "grok-2-image":                { "1K": 0.070, "2K": 0.070 },
  "openrouter-flux2":            { "1K": 0.050, "2K": 0.080 }
};
const USD_TO_ILS = 3.65;

let isAdmin = false;
let adminPassword = sessionStorage.getItem("diafond_admin_pass") || "";
let adminSecrets = {
  hf_token: "", gcp_credentials: "", xai_api_key: "", openrouter_api_key: "",
  bonus_left_ils: 152.20, prepay_left_ils: 12.70, total_spent_ils: 0.00
};
let adminStatusFilter = "ALL_DOWNLOADED";

let allFilms = [];
let filmStatsMap = {};
let promptPresets = [];
let currentFilm = null;
let currentFrames = [];
let currentFrameIdx = 0;
let viewMode = "restored";
let preferredEngine = "auto";
let stopBatchRequested = false;
let isFsRotated = false;
let fsControlsTimer = null;

async function sbFetch(path, options = {}) {
  const headers = { "apikey": PUBLIC_KEY, "Content-Type": "application/json", ...(options.headers || {}) };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers });
  const txt = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : null;
}

function toSlug(str) {
  const ru = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'};
  return (str || "diafilm").toLowerCase().split('').map(c => ru[c] !== undefined ? ru[c] : c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ("film-" + Date.now());
}

function getFrameVersionsInfo(frame) {
  const versions = frame.frame_versions || [];
  const isRestoredUrl = (u) => u && !u.includes("/originals/");
  const origVer = versions.find(v => v.version_type === "original") || versions.find(v => (v.image_url || "").includes("/originals/"));
  const originalUrl = (origVer ? origVer.image_url : null) || frame.original_url || "";

  const availableRestored = [];
  versions.forEach(v => {
    if (v.version_type !== "original" && isRestoredUrl(v.image_url)) {
      availableRestored.push({
        type: v.version_type,
        label: v.version_label || v.version_type,
        url: v.image_url,
        meta: v.meta || null
      });
    }
  });

  const defVer = currentFilm?.default_version;
  if (defVer && defVer !== "auto") {
    availableRestored.sort((a, b) => (a.type === defVer ? -1 : b.type === defVer ? 1 : 0));
  }
  return { originalUrl, availableRestored };
}

function pickBestUrl(frame, mode = "restored", engine = "auto") {
  const { originalUrl, availableRestored } = getFrameVersionsInfo(frame);
  const chosen = (engine && engine !== "auto" ? availableRestored.find(v => v.type === engine) : null) || availableRestored[0];
  const hasBoth = Boolean(originalUrl && chosen && chosen.url && originalUrl !== chosen.url);
  if (mode === "original" || !chosen) {
    return { url: originalUrl, isRestored: Boolean(chosen), hasBoth, activeVersion: chosen || null };
  }
  return { url: chosen.url, isRestored: true, hasBoth, activeVersion: chosen };
}

async function initApp() {
  if (adminPassword && typeof tryAdminLogin === "function") {
    await tryAdminLogin(adminPassword, false);
  }
  if (typeof updateAdminUI === "function") updateAdminUI();
  if (typeof loadPromptPresets === "function") await loadPromptPresets();
  await reloadCatalogData();
}

async function reloadCatalogData() {
  try {
    allFilms = await sbFetch("filmstrips?select=*&order=title.asc");
    const sampleFrames = await sbFetch("frames?select=filmstrip_id,frame_number,original_url,frame_versions(version_type,version_label,image_url)&frame_number=in.(0,1,2,3,4,5)&order=frame_number.asc");
    const byFilm = {};
    sampleFrames.forEach(fr => { (byFilm[fr.filmstrip_id] = byFilm[fr.filmstrip_id] || []).push(fr); });

    allFilms.forEach(f => {
      const list = byFilm[f.id] || [];
      const hasFrames = list.length > 0 || f.status !== "pending";
      const hasRestored = list.some(fr => getFrameVersionsInfo(fr).availableRestored.length > 0) || ["restored_paid", "restored"].includes(f.status);

      const savedCoverNum = f.extra_data?.cover_frame != null ? Number(f.extra_data.cover_frame) : null;
      let targetFrame = savedCoverNum !== null ? list.find(x => x.frame_number === savedCoverNum) : null;
      if (!targetFrame) targetFrame = list.find(x => x.frame_number === 4) || list.find(x => x.frame_number === 3) || list[0];

      const coverUrl = targetFrame ? pickBestUrl(targetFrame, "restored", f.default_version || "auto").url : "";
      filmStatsMap[f.id] = { coverUrl, hasRestored, hasFrames };
    });

    if (isAdmin && typeof renderStatusTabs === "function") renderStatusTabs();
    onFilterChange();
  } catch (e) {
    document.getElementById("filmsCountLabel").innerText = "Ошибка загрузки: " + e.message;
  }
}

function matchesBaseFilters(f, excludeField = null) {
  const st = filmStatsMap[f.id] || {};
  if (!isAdmin) {
    if (!st.hasFrames || !st.coverUrl) return false;
  } else {
    if (adminStatusFilter === "ALL_DOWNLOADED" && !st.hasFrames) return false;
    if (adminStatusFilter === "RESTORED" && !st.hasRestored) return false;
    if (adminStatusFilter === "pending" && st.hasFrames) return false;
    if (adminStatusFilter === "waiting_approval" && f.status !== "waiting_approval") return false;
  }

  const q = (document.getElementById("searchInput").value || "").toLowerCase().trim();
  const restMode = document.getElementById("restoredFilter").value;
  const yFrom = parseInt(document.getElementById("yearFromInput").value) || null;
  const yTo = parseInt(document.getElementById("yearToInput").value) || null;

  if (restMode === "RESTORED" && !st.hasRestored) return false;
  if (restMode === "ORIGINAL" && st.hasRestored) return false;
  if (yFrom && (!f.year || f.year < yFrom)) return false;
  if (yTo && (!f.year || f.year > yTo)) return false;

  if (q) {
    const tagsStr = Array.isArray(f.tags) ? f.tags.join(" ") : (f.tags || "");
    const hay = `${f.title || ""} ${f.artist || ""} ${f.author || ""} ${f.designer || ""} ${f.studio || ""} ${f.film_number || ""} ${tagsStr}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  const fields = {
    category: document.getElementById("categoryFilter").value,
    film_style: document.getElementById("styleFilter").value,
    color: document.getElementById("colorFilter").value,
    studio: document.getElementById("studioFilter").value,
    artist: document.getElementById("artistFilter").value
  };

  for (const [k, val] of Object.entries(fields)) {
    if (k !== excludeField && val && (f[k] || "") !== val) return false;
  }
  return true;
}

function populateSelectWithCounts(selectId, fieldName, defaultLabel) {
  const sel = document.getElementById(selectId);
  const currentVal = sel.value;
  const counts = {};

  allFilms.forEach(f => {
    if (matchesBaseFilters(f, fieldName)) {
      const v = (f[fieldName] || "").trim();
      if (v) counts[v] = (counts[v] || 0) + 1;
    }
  });

  const sortedKeys = Object.keys(counts).sort();
  sel.innerHTML = `<option value="">${defaultLabel}</option>` +
    sortedKeys.map(k => `<option value="${k}" ${k === currentVal ? 'selected' : ''}>${k} (${counts[k]})</option>`).join("");

  if (currentVal && !counts[currentVal]) sel.value = "";
}

function onFilterChange() {
  populateSelectWithCounts("categoryFilter", "category", "Все категории");
  populateSelectWithCounts("styleFilter", "film_style", "Все виды (Рис./Кук.)");
  populateSelectWithCounts("colorFilter", "color", "Любая цветность");
  populateSelectWithCounts("studioFilter", "studio", "Все студии");
  populateSelectWithCounts("artistFilter", "artist", "Все художники");
  renderCatalog();
}

function resetFilters() {
  ["searchInput", "yearFromInput", "yearToInput", "categoryFilter", "styleFilter", "colorFilter", "studioFilter", "artistFilter"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("restoredFilter").value = "ALL";
  onFilterChange();
}

function renderCatalog() {
  const filtered = allFilms.filter(f => matchesBaseFilters(f, null));
  document.getElementById("filmsCountLabel").innerText = `${filtered.length} лент`;

  document.getElementById("filmsGrid").innerHTML = filtered.map(f => {
    const st = filmStatsMap[f.id] || {};
    const statusBadge = st.hasRestored
      ? `<span class="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#18120e]/85 text-[#d99b26] border border-[#d99b26]/50 backdrop-blur">✨ ИИ-реставрация</span>`
      : `<span class="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-black/70 text-[#cfc4b6] border border-white/15">📜 Оригинал</span>`;

    return `
      <div onclick="openFilm('${f.id}')" class="film-card rounded-2xl overflow-hidden cursor-pointer flex flex-col">
        <div class="frame-aspect relative overflow-hidden">
          ${st.coverUrl ? `<img src="${st.coverUrl}" loading="lazy" class="w-full h-full object-cover" onerror="this.style.opacity=0.15" />` : `<div class="w-full h-full flex items-center justify-center text-xs text-[#6e6256]">Не скачан</div>`}
          ${statusBadge}
          ${isAdmin ? `<span class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded text-[10px] font-mono bg-black/80 text-amber-300">${f.status || 'pending'}</span>` : ``}
        </div>
        <div class="p-4 flex-1 flex flex-col justify-between">
          <div>
            <h3 class="font-serif-title text-xl font-semibold text-[#f5efe6] leading-snug">${f.title || "Без названия"}</h3>
            <div class="text-xs text-[#d99b26] mt-1">${[f.artist ? `Худ. ${f.artist}` : "", f.year ? `${f.year} г.` : "", f.film_style || ""].filter(Boolean).join(" • ") || "Диафильм"}</div>
          </div>
          ${f.studio || f.category ? `<div class="text-[11px] text-[#9e9081] mt-1.5">${[f.category, f.studio].filter(Boolean).join(" • ")}</div>` : ``}
        </div>
      </div>`;
  }).join("");
}

function showSection(sec) {
  document.getElementById("catalogSection").classList.toggle("hidden", sec !== "catalog");
  document.getElementById("aboutSection").classList.toggle("hidden", sec !== "about");
  document.getElementById("playerSection").classList.toggle("hidden", sec !== "player");
}

async function openFilm(filmId) {
  currentFilm = allFilms.find(f => f.id === filmId);
  if (!currentFilm) return;
  showSection("player");
  document.getElementById("playerTitleTop").innerText = currentFilm.title || "";

  const metaParts = [
    currentFilm.category, currentFilm.film_style, currentFilm.color,
    currentFilm.studio ? `Студия: ${currentFilm.studio}` : "",
    currentFilm.year ? `${currentFilm.year} г.` : "",
    currentFilm.author ? `Авт: ${currentFilm.author}` : "",
    currentFilm.artist ? `Худ: ${currentFilm.artist}` : "",
    currentFilm.designer ? `Оформ: ${currentFilm.designer}` : "",
    currentFilm.film_number ? `№ ${currentFilm.film_number}` : ""
  ].filter(Boolean);
  document.getElementById("playerMetaLine").innerText = metaParts.join(" • ");

  if (isAdmin && typeof populateAdminFilmForm === "function") {
    populateAdminFilmForm(currentFilm);
  }

  document.getElementById("livePreviewSection").classList.add("hidden");
  document.getElementById("frameTechPassportBox").classList.add("hidden");

  const rawFrames = await sbFetch(`frames?filmstrip_id=eq.${filmId}&select=*,frame_versions(*)&order=frame_number.asc`);
  currentFrames = isAdmin ? rawFrames : rawFrames.filter(fr => fr.is_active !== false);
  currentFrameIdx = 0;
  preferredEngine = currentFilm.default_version || "auto";
  viewMode = "restored";

  updatePlayerFrame();
  renderThumbsGrid();
  if (isAdmin && typeof updateCostEstimate === "function") updateCostEstimate();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closePlayer() { showSection("catalog"); }

function setViewMode(m) {
  viewMode = m;
  const act = "px-3.5 py-1 rounded-full text-xs font-semibold bg-[#d99b26] text-[#18120e] transition";
  const idl = "px-3.5 py-1 rounded-full text-xs font-medium text-[#cfc4b6] hover:text-white transition";
  document.getElementById("pillRestored").className = m === "restored" ? act : idl;
  document.getElementById("pillOriginal").className = m === "original" ? act : idl;
  document.getElementById("fsPillRestored").className = m === "restored" ? act : idl;
  document.getElementById("fsPillOriginal").className = m === "original" ? act : idl;
  updatePlayerFrame();
}

function onVersionSelectChange(val) {
  preferredEngine = val;
  setViewMode("restored");
}

function updatePlayerFrame() {
  if (!currentFrames.length) {
    document.getElementById("mainFrameImg").src = "";
    document.getElementById("frameCounterText").innerText = "Кадры еще не скачаны";
    document.getElementById("floatingModePill").classList.add("hidden");
    document.getElementById("frameCaptionBar").classList.add("hidden");
    return;
  }
  const fr = currentFrames[currentFrameIdx];
  const humanNum = currentFrameIdx + 1;
  const info = getFrameVersionsInfo(fr);

  const verSel = document.getElementById("playerVersionSelect");
  if (info.availableRestored.length > 1 || (isAdmin && info.availableRestored.length >= 1)) {
    verSel.classList.remove("hidden");
    verSel.innerHTML = info.availableRestored.map(v =>
      `<option value="${v.type}" ${v.type === preferredEngine ? 'selected' : ''}>🎨 ${v.label}</option>`
    ).join("");
  } else {
    verSel.classList.add("hidden");
  }

  const picked = pickBestUrl(fr, viewMode, preferredEngine);
  const mainImg = document.getElementById("mainFrameImg");
  const fsImg = document.getElementById("fsImg");

  mainImg.onerror = () => { if (mainImg.src !== info.originalUrl && info.originalUrl) mainImg.src = info.originalUrl; };
  mainImg.src = picked.url;
  fsImg.src = picked.url;

  document.getElementById("floatingModePill").classList.toggle("hidden", !picked.hasBoth);
  document.getElementById("fsModePill").classList.toggle("hidden", !picked.hasBoth);

  // Показываем распознанную подпись кадра под проектором (если есть)
  const capBar = document.getElementById("frameCaptionBar");
  if (fr.source_text && fr.source_text.trim()) {
    capBar.classList.remove("hidden");
    capBar.innerText = `«${fr.source_text.trim()}»`;
  } else {
    capBar.classList.add("hidden");
  }

  const countStr = `${humanNum} / ${currentFrames.length}`;
  document.getElementById("frameCounterText").innerText = countStr;
  document.getElementById("fsCounter").innerText = countStr;

  const metaObj = picked.activeVersion?.meta;
  const hasMeta = metaObj && Object.keys(metaObj).length > 0;
  document.getElementById("btnTechPassport").classList.toggle("hidden", !hasMeta);
  if (hasMeta) {
    document.getElementById("frameTechPassportContent").innerText = [
      `Версия (слот): ${picked.activeVersion.type} (${picked.activeVersion.label})`,
      `Модель: ${metaObj.model || '—'} | Разрешение: ${metaObj.resolution || '1K'} | Температура: ${metaObj.temperature ?? '—'}`,
      `Пресет стиля: ${metaObj.style_preset || '—'} | Фильтр цвета: ${metaObj.color_preset || '—'}`,
      `Эталон цвета: ${metaObj.ref_color || 'Нет'} | Эталон лица: ${metaObj.ref_face || 'Нет'}`,
      `Токены: вх. ${metaObj.prompt_tokens || '—'}, вых. ${metaObj.output_tokens || '—'} | Списано: $${metaObj.cost_usd || '0.00'} (~₪${metaObj.cost_ils || '0.00'}, счет: ${metaObj.wallet || 'bonus'})`,
      `Дата: ${metaObj.date || '—'}`,
      `Итоговый промпт:\n${metaObj.prompt || '—'}`
    ].join("\n");
  } else {
    document.getElementById("frameTechPassportBox").classList.add("hidden");
  }

  if (isAdmin) {
    document.getElementById("adminCurrentFrameLabel").innerText = `Кадр №${humanNum} из ${currentFrames.length} (${picked.isRestored ? '✅ Есть ИИ' : '📜 Оригинал'})`;
    document.getElementById("btnRestoreSingle").innerText = `✨ Реставрировать кадр №${humanNum}`;
    const srcInput = document.getElementById("editFrameSourceText");
    const hintInput = document.getElementById("editFrameSceneHint");
    if (srcInput) srcInput.value = fr.source_text || "";
    if (hintInput) hintInput.value = fr.scene_hint || "";
  }
  highlightActiveThumb();
}

function toggleFrameTechPassport() {
  document.getElementById("frameTechPassportBox").classList.toggle("hidden");
}

function applyPassportToStudio() {
  const fr = currentFrames[currentFrameIdx];
  const picked = pickBestUrl(fr, "restored", preferredEngine);
  const m = picked.activeVersion?.meta;
  if (!m) return;
  if (m.model) document.getElementById("nbModelSelect").value = m.model;
  if (m.resolution) document.getElementById("nbResSelect").value = m.resolution;
  if (m.temperature) {
    document.getElementById("nbTempRange").value = m.temperature;
    document.getElementById("tempValLabel").innerText = m.temperature;
  }
  if (m.prompt) document.getElementById("nbFinalPromptText").value = m.prompt;
  alert("✅ Настройки и промпт этого кадра скопированы в пульт!");
}

function prevFrame() { if (currentFrameIdx > 0) { currentFrameIdx--; updatePlayerFrame(); } }
function nextFrame() { if (currentFrameIdx < currentFrames.length - 1) { currentFrameIdx++; updatePlayerFrame(); } }

function renderThumbsGrid() {
  document.getElementById("thumbsGrid").innerHTML = currentFrames.map((fr, idx) => {
    const humanNum = idx + 1;
    const picked = pickBestUrl(fr, "restored", preferredEngine);
    const origUrl = getFrameVersionsInfo(fr).originalUrl;
    const verCount = getFrameVersionsInfo(fr).availableRestored.length;
    const hasOcr = Boolean(fr.source_text && fr.source_text.trim());
    return `
      <div id="thumb_${idx}" onclick="currentFrameIdx=${idx}; updatePlayerFrame();"
        class="frame-aspect rounded-xl overflow-hidden border-2 cursor-pointer transition relative ${fr.is_active === false ? 'opacity-35' : ''}">
        <img src="${picked.url}" loading="lazy" class="w-full h-full object-cover" onerror="if(this.src!=='${origUrl}')this.src='${origUrl}'" />
        <div class="absolute top-1 left-1 flex gap-1">
          ${picked.isRestored ? `<span class="px-1 rounded bg-emerald-600/90 text-[9px] text-white font-bold">${verCount > 1 ? verCount + 'v' : 'ИИ'}</span>` : ``}
          ${hasOcr ? `<span class="px-1 rounded bg-amber-600/90 text-[9px] text-[#18120e] font-bold" title="Текст распознан">📖</span>` : ``}
        </div>
        <span class="absolute bottom-1 right-1 px-1.5 py-0.2 rounded bg-black/80 text-[10px] font-mono text-[#f3ece2]">№${humanNum}</span>
      </div>`;
  }).join("");
  highlightActiveThumb();
}

function highlightActiveThumb() {
  currentFrames.forEach((_, idx) => {
    const el = document.getElementById(`thumb_${idx}`);
    if (el) el.className = `frame-aspect rounded-xl overflow-hidden border-2 cursor-pointer transition relative ${idx === currentFrameIdx ? 'border-[#d99b26] ring-2 ring-[#d99b26]/40' : 'border-[#33271d]'}`;
  });
}

function openFullscreenModal() {
  const modal = document.getElementById("fullscreenModal");
  modal.classList.remove("hidden");
  document.getElementById("fsOverlayControls").classList.add("hidden");
  if (modal.requestFullscreen) modal.requestFullscreen().catch(() => {});
}

function closeFullscreenModal() {
  isFsRotated = false;
  document.getElementById("fsImg").classList.remove("fs-rotated");
  document.getElementById("fullscreenModal").classList.add("hidden");
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

function toggleFsRotate() {
  isFsRotated = !isFsRotated;
  document.getElementById("fsImg").classList.toggle("fs-rotated", isFsRotated);
}

function toggleFsOverlay() {
  const ov = document.getElementById("fsOverlayControls");
  const isHidden = ov.classList.toggle("hidden");
  clearTimeout(fsControlsTimer);
  if (!isHidden) {
    fsControlsTimer = setTimeout(() => ov.classList.add("hidden"), 4500);
  }
}

(function setupTouchGestures() {
  const mainEl = document.getElementById("mainFrameTouchArea");
  const fsEl = document.getElementById("fsTouchArea");

  let startX = 0, startY = 0;
  mainEl.addEventListener("touchstart", e => { startX = e.changedTouches[0].screenX; }, { passive: true });
  mainEl.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].screenX - startX;
    if (Math.abs(dx) > 40) { dx < 0 ? nextFrame() : prevFrame(); }
  }, { passive: true });

  let lastTapTime = 0;
  fsEl.addEventListener("touchstart", e => {
    startX = e.changedTouches[0].screenX;
    startY = e.changedTouches[0].screenY;
  }, { passive: true });

  fsEl.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].screenX - startX;
    const dy = e.changedTouches[0].screenY - startY;
    const delta = isFsRotated ? dy : dx;
    if (Math.abs(delta) > 45) {
      delta < 0 ? nextFrame() : prevFrame();
      return;
    }
    const now = Date.now();
    if (now - lastTapTime < 320) {
      toggleFsOverlay();
      lastTapTime = 0;
    } else {
      lastTapTime = now;
    }
  }, { passive: true });

  fsEl.addEventListener("dblclick", () => toggleFsOverlay());
})();

window.addEventListener("keydown", (e) => {
  if (document.getElementById("playerSection").classList.contains("hidden")) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
  if (e.key === "ArrowRight") nextFrame();
  if (e.key === "ArrowLeft") prevFrame();
  if (e.key === "Escape") closeFullscreenModal();
});

window.addEventListener("DOMContentLoaded", initApp);
