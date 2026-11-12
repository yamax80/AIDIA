// =========================================================================
// STUDIO.JS — АДМИНКА, ПРОМПТЫ, 2 ЭТАЛОНА, ПАРСЕР 13 ПОЛЕЙ, ЖИВОЕ ПРЕВЬЮ И ИИ
// =========================================================================

async function handleAuthClick() {
  if (isAdmin) {
    if (confirm("Выйти из режима администратора?")) {
      isAdmin = false; adminPassword = ""; sessionStorage.removeItem("diafond_admin_pass");
      adminStatusFilter = "ALL_DOWNLOADED"; updateAdminUI(); onFilterChange();
    }
    return;
  }
  const pass = prompt("Введите пароль администратора:");
  if (pass) await tryAdminLogin(pass.trim(), true);
}

async function tryAdminLogin(pass, showAlerts = false) {
  try {
    const res = await sbFetch("rpc/admin_login", { method: "POST", body: JSON.stringify({ pass_input: pass }) });
    if (res && res.ok) {
      isAdmin = true; adminPassword = pass; sessionStorage.setItem("diafond_admin_pass", pass);
      adminSecrets.hf_token = res.hf_token || "";
      adminSecrets.gcp_credentials = res.gcp_credentials || "";
      adminSecrets.xai_api_key = res.xai_api_key || "";
      adminSecrets.openrouter_api_key = res.openrouter_api_key || "";
      adminSecrets.budget_total_ils = parseFloat(res.budget_total_ils) || 30.0;
      adminSecrets.budget_spent_ils = parseFloat(res.budget_spent_ils) || 0.0;
      updateAdminUI(); onFilterChange();
      if (showAlerts) alert("✅ Вы вошли в студию управления!");
    } else if (showAlerts) alert("❌ Неверный пароль!");
  } catch (e) { if (showAlerts) alert("Ошибка входа: " + e.message); }
}

function updateBudgetBadge() {
  const b = document.getElementById("budgetBadge");
  if (!b) return;
  const left = (adminSecrets.budget_total_ils - adminSecrets.budget_spent_ils).toFixed(2);
  b.innerText = `💳 ₪${left} (из ₪${adminSecrets.budget_total_ils.toFixed(0)})`;
}

function updateAdminUI() {
  const btn = document.getElementById("loginBtn");
  btn.innerText = isAdmin ? "Выйти" : "Войти";
  btn.className = isAdmin
    ? "px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#d99b26] text-[#18120e]"
    : "px-3 py-1.5 rounded-xl text-xs font-medium bg-[#2a2017] hover:bg-[#35281d] text-[#e6ccb2] border border-[#4a3728]";
  ["budgetBadge", "adminPromptsBtn", "adminSettingsBtn", "adminBar", "adminPlayerControls"].forEach(id => {
    document.getElementById(id)?.classList.toggle("hidden", !isAdmin);
  });
  if (isAdmin) { updateBudgetBadge(); renderStatusTabs(); }
}

function renderStatusTabs() {
  let cAll = allFilms.length, cDown = 0, cRest = 0, cWait = 0, cPend = 0;
  allFilms.forEach(f => {
    const st = filmStatsMap[f.id] || {};
    if (st.hasFrames) cDown++; else cPend++;
    if (st.hasRestored) cRest++;
    if (f.status === "waiting_approval") cWait++;
  });
  const tabs = [
    { id: "ALL_DOWNLOADED", label: `На витрине (${cDown})` },
    { id: "RESTORED", label: `✨ С ИИ (${cRest})` },
    { id: "waiting_approval", label: `⏳ На проверке (${cWait})` },
    { id: "pending", label: `💤 Не скачаны (${cPend})` },
    { id: "ALL", label: `Все в БД (${cAll})` }
  ];
  document.getElementById("adminStatusTabs").innerHTML = tabs.map(t => `
    <button onclick="adminStatusFilter='${t.id}'; renderStatusTabs(); onFilterChange();"
      class="px-3 py-1 rounded-xl text-xs font-medium transition ${adminStatusFilter === t.id ? 'bg-[#d99b26] text-[#18120e] font-bold' : 'bg-[#16110d] text-[#cfc4b6] border border-[#382b20]'}">${t.label}</button>
  `).join("");
}

function openSecretsModal() {
  document.getElementById("secHfToken").value = adminSecrets.hf_token || "";
  document.getElementById("secGcpCreds").value = adminSecrets.gcp_credentials || "";
  document.getElementById("secXaiKey").value = adminSecrets.xai_api_key || "";
  document.getElementById("secOpenRouterKey").value = adminSecrets.openrouter_api_key || "";
  document.getElementById("secBudgetTotal").value = adminSecrets.budget_total_ils;
  document.getElementById("secBudgetSpent").value = adminSecrets.budget_spent_ils.toFixed(2);
  document.getElementById("secNewPass").value = "";
  document.getElementById("secretsModal").classList.remove("hidden");
}
function closeSecretsModal() { document.getElementById("secretsModal").classList.add("hidden"); }

async function saveSecretsToDb() {
  const payload = {
    pass_input: adminPassword,
    new_hf: document.getElementById("secHfToken").value.trim(),
    new_gcp: document.getElementById("secGcpCreds").value.trim(),
    new_xai: document.getElementById("secXaiKey").value.trim(),
    new_openrouter: document.getElementById("secOpenRouterKey").value.trim(),
    new_budget_total: String(parseFloat(document.getElementById("secBudgetTotal").value) || 30),
    new_budget_spent: String(parseFloat(document.getElementById("secBudgetSpent").value) || 0),
    new_pass: document.getElementById("secNewPass").value.trim() || null
  };
  try {
    const res = await sbFetch("rpc/admin_save_secrets", { method: "POST", body: JSON.stringify(payload) });
    if (res && res.ok) {
      adminSecrets.hf_token = payload.new_hf;
      adminSecrets.gcp_credentials = payload.new_gcp;
      adminSecrets.xai_api_key = payload.new_xai;
      adminSecrets.openrouter_api_key = payload.new_openrouter;
      adminSecrets.budget_total_ils = parseFloat(payload.new_budget_total);
      adminSecrets.budget_spent_ils = parseFloat(payload.new_budget_spent);
      if (payload.new_pass) { adminPassword = payload.new_pass; sessionStorage.setItem("diafond_admin_pass", adminPassword); }
      updateBudgetBadge(); closeSecretsModal(); alert("✅ Ключи и бюджет сохранены в БД!");
    }
  } catch (e) { alert("Ошибка: " + e.message); }
}

// =========================================================================
// МЕНЕДЖЕР ГЛОБАЛЬНЫХ ПРОМПТОВ (ТАБЛИЦА PROMPT_PRESETS)
// =========================================================================
async function loadPromptPresets() {
  try {
    promptPresets = await sbFetch("prompt_presets?select=*&order=sort_order.asc,created_at.asc") || [];
  } catch (e) { promptPresets = []; }

  const styleSel = document.getElementById("nbStylePresetSelect");
  const colorSel = document.getElementById("nbColorPresetSelect");
  if (!styleSel || !colorSel) return;

  const styles = promptPresets.filter(p => p.preset_group !== "color_fix");
  const colors = promptPresets.filter(p => p.preset_group === "color_fix");

  styleSel.innerHTML = styles.map(p => `<option value="${p.id}">${p.title}</option>`).join("");
  colorSel.innerHTML = `<option value="">Без цветового фильтра</option>` + colors.map(p => `<option value="${p.id}">${p.title}</option>`).join("");
  if (colors.length > 0) colorSel.value = colors[0].id;
  onPresetSelectChange();
}

function onPresetSelectChange() {
  const stId = document.getElementById("nbStylePresetSelect")?.value;
  const stObj = promptPresets.find(p => p.id === stId);
  if (stObj && stObj.default_temp) {
    document.getElementById("nbTempRange").value = stObj.default_temp;
    document.getElementById("tempValLabel").innerText = stObj.default_temp;
  }
  rebuildVisiblePrompt();
}

function rebuildVisiblePrompt() {
  const stObj = promptPresets.find(p => p.id === document.getElementById("nbStylePresetSelect")?.value);
  const colObj = promptPresets.find(p => p.id === document.getElementById("nbColorPresetSelect")?.value);
  const extra = (document.getElementById("nbExtraDetails")?.value || "").trim();

  const parts = [
    colObj ? colObj.prompt_text : "",
    stObj ? stObj.prompt_text : "",
    extra ? `Additional scene & style instructions: ${extra}.` : "",
    "Text preservation: Exactly reproduce the Russian Cyrillic caption at the bottom. Do not invent or mutate characters. Keep Russian letters identical, sharp and legible."
  ].filter(Boolean);

  const area = document.getElementById("nbFinalPromptText");
  if (area) area.value = parts.join("\n\n");
}

function openPromptsModal() {
  renderPresetsManagerList();
  clearPresetForm();
  document.getElementById("promptsModal").classList.remove("hidden");
}
function closePromptsModal() { document.getElementById("promptsModal").classList.add("hidden"); }

function renderPresetsManagerList() {
  const box = document.getElementById("presetsListContainer");
  box.innerHTML = promptPresets.map(p => `
    <div class="p-2.5 rounded-xl bg-[#16110d] border border-[#33271d] flex items-start justify-between gap-2 text-xs">
      <div class="flex-1">
        <div class="font-semibold text-[#f3ece2]">${p.preset_group === 'color_fix' ? '🌈' : '🎨'} ${p.title}</div>
        <div class="text-[11px] text-[#9e9081] font-mono line-clamp-2 mt-0.5">${p.prompt_text}</div>
      </div>
      <div class="flex gap-1 shrink-0">
        <button onclick="editPresetInModal('${p.id}')" class="px-2 py-1 rounded bg-[#2a2017] text-[#d99b26]">✏️</button>
        <button onclick="deletePresetFromDb('${p.id}')" class="px-2 py-1 rounded bg-red-950/60 text-red-400">🗑️</button>
      </div>
    </div>`).join("");
}

function editPresetInModal(id) {
  const p = promptPresets.find(x => x.id === id);
  if (!p) return;
  document.getElementById("presetFormTitle").innerText = `✏️ Редактирование: ${p.title}`;
  document.getElementById("editPresetId").value = p.id;
  document.getElementById("editPresetTitle").value = p.title;
  document.getElementById("editPresetGroup").value = p.preset_group || "style";
  document.getElementById("editPresetText").value = p.prompt_text;
}

function clearPresetForm() {
  document.getElementById("presetFormTitle").innerText = "➕ Добавить новый пресет";
  document.getElementById("editPresetId").value = "";
  document.getElementById("editPresetTitle").value = "";
  document.getElementById("editPresetGroup").value = "style";
  document.getElementById("editPresetText").value = "";
}

async function savePresetToDb() {
  const id = document.getElementById("editPresetId").value.trim();
  const title = document.getElementById("editPresetTitle").value.trim();
  const preset_group = document.getElementById("editPresetGroup").value;
  const prompt_text = document.getElementById("editPresetText").value.trim();
  if (!title || !prompt_text) return alert("Заполните название и текст промпта!");

  try {
    if (id) {
      await sbFetch(`prompt_presets?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ title, preset_group, prompt_text }) });
    } else {
      await sbFetch("prompt_presets", { method: "POST", body: JSON.stringify({ title, preset_group, prompt_text }) });
    }
    await loadPromptPresets(); renderPresetsManagerList(); clearPresetForm();
  } catch (e) { alert("Ошибка: " + e.message); }
}

async function deletePresetFromDb(id) {
  if (!confirm("Удалить этот пресет?")) return;
  try {
    await sbFetch(`prompt_presets?id=eq.${id}`, { method: "DELETE" });
    await loadPromptPresets(); renderPresetsManagerList();
  } catch (e) { alert("Ошибка: " + e.message); }
}

async function saveCurrentPromptAsPreset() {
  const txt = document.getElementById("nbFinalPromptText").value.trim();
  if (!txt) return;
  const title = prompt("Введите название для сохранения этого промпта в список пресетов:");
  if (!title) return;
  try {
    await sbFetch("prompt_presets", { method: "POST", body: JSON.stringify({ title: title.trim(), preset_group: "style", prompt_text: txt }) });
    await loadPromptPresets();
    alert(`✅ Пресет "${title}" сохранен в базу!`);
  } catch (e) { alert("Ошибка: " + e.message); }
}

// =========================================================================
// ПАРСИНГ ВСЕХ 13 ПОЛЕЙ МЕТАДАННЫХ И ОТКАЗОУСТОЙЧИВОЕ СКАЧИВАНИЕ КАДРОВ
// =========================================================================
function decodeHtmlBytes(buf) {
  const bytes = new Uint8Array(buf);
  const ascii = new TextDecoder("ascii").decode(bytes.slice(0, 2048)).toLowerCase();
  if (ascii.includes("1251")) return new TextDecoder("windows-1251").decode(bytes);
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  return utf8.includes("\uFFFD") ? new TextDecoder("windows-1251").decode(bytes) : utf8;
}

async function fetchDiafilmyHtml(targetUrl, logFn) {
  if (logFn) logFn(`📡 Чтение страницы ${targetUrl}...`);
  const rpc = await sbFetch("rpc/admin_proxy_fetch", {
    method: "POST", body: JSON.stringify({ pass_input: adminPassword, target_url: targetUrl })
  });
  if (rpc && rpc.ok) {
    if (rpc.base64) {
      const bin = atob(rpc.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const decoded = decodeHtmlBytes(arr.buffer);
      if (!decoded.includes("\uFFFD") && decoded.length > 200) return decoded;
    }
    if (rpc.html_text && rpc.html_text.length > 200) return rpc.html_text;
  }
  throw new Error(rpc?.error || "Не удалось загрузить страницу diafilmy.su");
}

function extractDiafilmyFullMetadata(html, sourceUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let title = (doc.querySelector("title")?.textContent || "")
    .replace(/^Смотреть диафильм\s+/i, "").replace(/\s*[-»–|]\s*Диафильмы\.su.*$/i, "").trim();

  const text = (doc.body.innerText || "").replace(/\u00A0/g, " ");
  const ex = (rx) => { const m = text.match(rx); return m ? m[1].trim() : null; };

  if (ex(/Название:\s*([^\n\r|]+)/i)) title = ex(/Название:\s*([^\n\r|]+)/i);
  const category = ex(/Категория:\s*([^\n\r|]+)/i);
  const studio = ex(/Студия:\s*([^\n\r|]+)/i);
  const yearStr = ex(/Год выпуска:\s*(\d{4})/i);
  const color = ex(/Цветность:\s*([^\n\r|]+)/i);
  const filmStyle = ex(/Вид диафильма:\s*([^\n\r|]+)/i);
  const framesCountStr = ex(/Кадров:\s*(\d+)/i);
  const filmNumber = ex(/Номер:\s*([^\n\r|]+)/i);
  const author = ex(/Автор:\s*([^\n\r|]+)/i);
  const artist = ex(/(?:^|\n)\s*Художник:\s*([^\n\r|]+)/i);
  const designer = ex(/Художник-оформитель:\s*([^\n\r|]+)/i);
  const editor = ex(/(?:^|\n)\s*Редактор:\s*([^\n\r|]+)/i);
  const artDirector = ex(/Художественный редактор:\s*([^\n\r|]+)/i);
  const tagsRaw = ex(/Теги:\s*([^\n\r|]+)/i);
  const tags = tagsRaw ? tagsRaw.split(/[,;#]+|\s{2,}/).map(t => t.trim()).filter(Boolean) : null;

  const box = doc.querySelector('[id^="news-id-"]') || doc.querySelector('.full-news') || doc.body;
  let rawImgs = Array.from(box.querySelectorAll("img"))
    .map(img => img.getAttribute("src") || img.getAttribute("data-src"))
    .filter(src => src && src.includes("/uploads/") && !src.includes("/thumbs/"));

  if (!rawImgs.length) {
    rawImgs = Array.from(box.querySelectorAll("img"))
      .map(img => img.getAttribute("src") || img.getAttribute("data-src"))
      .filter(src => src && src.includes("/uploads/"))
      .map(src => src.replace("/thumbs/", "/"));
  }
  const uniqueImgs = [...new Set(rawImgs)].map(src => src.startsWith("http") ? src : "https://diafilmy.su" + src);

  const metaPayload = {
    ...(title && { title }),
    ...(sourceUrl && { original_url: sourceUrl }),
    ...(category && { category }),
    ...(studio && { studio }),
    ...(yearStr && { year: parseInt(yearStr) }),
    ...(color && { color }),
    ...(filmStyle && { film_style: filmStyle }),
    ...(framesCountStr && { frame_count: parseInt(framesCountStr) }),
    ...(filmNumber && { film_number: filmNumber }),
    ...(author && { author }),
    ...(artist && { artist }),
    ...(designer && { designer }),
    ...(editor && { editor }),
    ...(artDirector && { art_director: artDirector }),
    ...(tags && tags.length && { tags })
  };

  return { metaPayload, uniqueImgs };
}

// Безотказное скачивание одного кадра с резервным прокси Google (не роняет весь фильм при ошибке!)
async function fetchImageAsWebpBlobSafe(imgUrl) {
  const routes = [
    `https://wsrv.nl/?url=${encodeURIComponent(imgUrl)}&output=webp&q=90`,
    `https://images1-focus-opensocial.googleusercontent.com/gadgets/proxy?container=focus&refresh=2592000&url=${encodeURIComponent(imgUrl)}`
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const u of routes) {
      try {
        const r = await fetch(u);
        if (r.ok) {
          const b = await r.blob();
          if (b.size > 1000) return b;
        }
      } catch (e) {}
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  return null; // Возвращаем null вместо выброса фатальной ошибки!
}

let wakeLockObj = null;
async function keepScreenAwake(enable) {
  try {
    if (enable && "wakeLock" in navigator && !wakeLockObj) wakeLockObj = await navigator.wakeLock.request("screen");
    else if (!enable && wakeLockObj) { await wakeLockObj.release(); wakeLockObj = null; }
  } catch (e) {}
}

async function parseAndImportDiafilmUrl(sourceUrl, existingFilmId = null, logEl = null) {
  if (!adminSecrets.hf_token) { openSecretsModal(); throw new Error("Укажите HF_TOKEN в '🔑 Ключи'"); }
  const log = (msg) => { if (logEl) { logEl.classList.remove("hidden"); logEl.innerText = msg; } };

  await keepScreenAwake(true);
  try {
    const html = await fetchDiafilmyHtml(sourceUrl, log);
    const { metaPayload, uniqueImgs } = extractDiafilmyFullMetadata(html, sourceUrl);
    if (!uniqueImgs.length) throw new Error("Кадры (/uploads/) на странице не найдены!");

    const title = metaPayload.title || "Диафильм";
    metaPayload.status = "downloaded";
    metaPayload.frame_count = uniqueImgs.length;

    log(`🎬 "${title}" (${uniqueImgs.length} кадр., ${metaPayload.year || '—'} г., худ. ${metaPayload.artist || '—'}).\nСохраняю карточку в Supabase...`);
    let filmId = existingFilmId;
    if (!filmId) {
      const existing = await sbFetch(`filmstrips?original_url=eq.${encodeURIComponent(sourceUrl)}&select=id`);
      if (existing && existing.length) {
        filmId = existing[0].id;
        await sbFetch(`filmstrips?id=eq.${filmId}`, { method: "PATCH", body: JSON.stringify(metaPayload) });
      } else {
        const ins = await sbFetch("filmstrips", { method: "POST", headers: { "Prefer": "return=representation" }, body: JSON.stringify(metaPayload) });
        filmId = ins[0].id;
      }
    } else {
      await sbFetch(`filmstrips?id=eq.${filmId}`, { method: "PATCH", body: JSON.stringify(metaPayload) });
    }

    const slug = toSlug(title);
    const downloadedFiles = [];
    const failedFrames = [];
    let doneCount = 0;

    const workers = Array.from({ length: 4 }, async (_, wIdx) => {
      for (let i = wIdx; i < uniqueImgs.length; i += 4) {
        const webpBlob = await fetchImageAsWebpBlobSafe(uniqueImgs[i]);
        doneCount++;
        if (webpBlob) {
          downloadedFiles.push({ frameNum: i, path: `originals/${slug}/f_${String(i).padStart(3, "0")}.webp`, content: webpBlob });
        } else {
          failedFrames.push(i + 1);
        }
        log(`📥 Скачано: ${doneCount} из ${uniqueImgs.length} кадров (пропущено битых: ${failedFrames.length})...`);
      }
    });
    await Promise.all(workers);

    downloadedFiles.sort((a, b) => a.frameNum - b.frameNum);
    if (!downloadedFiles.length) throw new Error("Не удалось скачать ни одного кадра!");

    log(`📤 Выгрузка ${downloadedFiles.length} кадров на Hugging Face (1 коммит)...`);
    const { uploadFiles } = await import("https://esm.sh/@huggingface/hub");
    await uploadFiles({
      repo: { type: "dataset", name: HF_REPO },
      accessToken: adminSecrets.hf_token,
      commitTitle: `Import originals for ${title} (${downloadedFiles.length} frames)`,
      files: downloadedFiles.map(f => ({ path: f.path, content: f.content }))
    });

    log(`🔗 Запись кадров в базу Supabase...`);
    const rows = downloadedFiles.map(f => ({
      filmstrip_id: filmId, frame_number: f.frameNum, sort_order: f.frameNum,
      original_url: `https://huggingface.co/datasets/${HF_REPO}/resolve/main/${f.path}`, is_active: true
    }));
    await sbFetch("frames?on_conflict=filmstrip_id,frame_number", {
      method: "POST", headers: { "Prefer": "resolution=merge-duplicates" }, body: JSON.stringify(rows)
    });

    const warnTxt = failedFrames.length ? `\n⚠️ Пропущены битые кадры №: ${failedFrames.join(", ")}` : "";
    log(`✅ ГОТОВО! "${title}" (${downloadedFiles.length} кадров) сохранен в базу!${warnTxt}`);
    await reloadCatalogData();
    return filmId;
  } finally { await keepScreenAwake(false); }
}

function openImportModal() {
  document.getElementById("importUrlInput").value = "";
  document.getElementById("importLogBox").classList.add("hidden");
  document.getElementById("importModal").classList.remove("hidden");
}
function closeImportModal() { document.getElementById("importModal").classList.add("hidden"); }

async function runImportFromUrl() {
  const url = document.getElementById("importUrlInput").value.trim();
  if (!url.includes("diafilmy.su")) return alert("Введите ссылку на diafilmy.su!");
  const btn = document.getElementById("btnStartImport");
  const logEl = document.getElementById("importLogBox");
  btn.disabled = true;
  try {
    const fid = await parseAndImportDiafilmUrl(url, null, logEl);
    setTimeout(() => { closeImportModal(); openFilm(fid); }, 800);
  } catch (e) { logEl.classList.remove("hidden"); logEl.innerText = `❌ ${e.message}`; }
  finally { btn.disabled = false; }
}

async function downloadOriginalsForCurrentFilm() {
  if (!currentFilm?.original_url) return alert("У фильма не указан original_url!");
  const logEl = document.getElementById("aiLogBox");
  try {
    await parseAndImportDiafilmUrl(currentFilm.original_url, currentFilm.id, logEl);
    await openFilm(currentFilm.id);
  } catch (e) { logEl.classList.remove("hidden"); logEl.innerText = `❌ ${e.message}`; }
}

// Обновление всех 13 полей метаданных для одного или всех диафильмов в базе
async function refreshSingleFilmMetadata() {
  if (!currentFilm?.original_url) return alert("Нет ссылки на diafilmy.su!");
  const logEl = document.getElementById("aiLogBox");
  try {
    const html = await fetchDiafilmyHtml(currentFilm.original_url, (m) => { logEl.classList.remove("hidden"); logEl.innerText = m; });
    const { metaPayload } = extractDiafilmyFullMetadata(html, currentFilm.original_url);
    await sbFetch(`filmstrips?id=eq.${currentFilm.id}`, { method: "PATCH", body: JSON.stringify(metaPayload) });
    Object.assign(currentFilm, metaPayload);
    populateAdminFilmForm(currentFilm);
    await reloadCatalogData();
    logEl.innerText = `✅ Все метаданные для "${currentFilm.title}" успешно обновлены!`;
  } catch (e) { logEl.classList.remove("hidden"); logEl.innerText = `❌ ${e.message}`; }
}

async function runBulkMetadataRebuild() {
  const targets = allFilms.filter(f => f.original_url && f.original_url.includes("diafilmy.su") && (!f.category || !f.film_style || !f.color));
  if (!targets.length) return alert("У всех фильмов в базе уже заполнены метаданные!");
  if (!confirm(`Обновить полные метаданные (13 полей) с diafilmy.su для ${targets.length} фильмов?`)) return;

  const logEl = document.getElementById("bulkMetaLog");
  logEl.classList.remove("hidden");
  let okCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const f = targets[i];
    logEl.innerText = `🔄 [${i + 1}/${targets.length}] Парсинг метаданных: "${f.title}"...`;
    try {
      const html = await fetchDiafilmyHtml(f.original_url);
      const { metaPayload } = extractDiafilmyFullMetadata(html, f.original_url);
      await sbFetch(`filmstrips?id=eq.${f.id}`, { method: "PATCH", body: JSON.stringify(metaPayload) });
      okCount++;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 800));
  }
  await reloadCatalogData();
  logEl.innerText = `✅ Готово! Обновлены карточки ${okCount} из ${targets.length} диафильмов.`;
}

function populateAdminFilmForm(f) {
  document.getElementById("editFilmStatus").value = f.status || "downloaded";
  document.getElementById("editDefaultVersion").value = f.default_version || "auto";
  document.getElementById("editFilmCategory").value = f.category || "";
  document.getElementById("editFilmStyle").value = f.film_style || "";
  document.getElementById("editFilmStudio").value = f.studio || "";
  document.getElementById("editFilmColor").value = f.color || "";
  document.getElementById("editFilmYear").value = f.year || "";
  document.getElementById("editFilmNumber").value = f.film_number || "";
  document.getElementById("editFilmAuthor").value = f.author || "";
  document.getElementById("editFilmArtist").value = f.artist || "";
  document.getElementById("editFilmDesigner").value = f.designer || "";
  document.getElementById("editFilmEditor").value = f.editor || "";
  document.getElementById("editFilmArtDirector").value = f.art_director || "";
  document.getElementById("editFilmTags").value = Array.isArray(f.tags) ? f.tags.join(", ") : (f.tags || "");
  document.getElementById("nbExtraDetails").value = f.custom_prompt || "";
  document.getElementById("editFilmOrigUrl").href = f.original_url || "#";
  rebuildVisiblePrompt();
}

async function saveFilmMeta() {
  if (!isAdmin || !currentFilm) return;
  const tagsStr = document.getElementById("editFilmTags").value.trim();
  const payload = {
    status: document.getElementById("editFilmStatus").value,
    default_version: document.getElementById("editDefaultVersion").value.trim() || "auto",
    category: document.getElementById("editFilmCategory").value.trim() || null,
    film_style: document.getElementById("editFilmStyle").value.trim() || null,
    studio: document.getElementById("editFilmStudio").value.trim() || null,
    color: document.getElementById("editFilmColor").value.trim() || null,
    year: parseInt(document.getElementById("editFilmYear").value) || null,
    film_number: document.getElementById("editFilmNumber").value.trim() || null,
    author: document.getElementById("editFilmAuthor").value.trim() || null,
    artist: document.getElementById("editFilmArtist").value.trim() || null,
    designer: document.getElementById("editFilmDesigner").value.trim() || null,
    editor: document.getElementById("editFilmEditor").value.trim() || null,
    art_director: document.getElementById("editFilmArtDirector").value.trim() || null,
    tags: tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(Boolean) : null,
    custom_prompt: document.getElementById("nbExtraDetails").value.trim() || null
  };
  try {
    await sbFetch(`filmstrips?id=eq.${currentFilm.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    Object.assign(currentFilm, payload);
    onFilterChange(); alert("✅ Карточка диафильма сохранена!");
  } catch (e) { alert("Ошибка: " + e.message); }
}

// =========================================================================
// ЯДРО РЕСТАВРАЦИИ: 2 ЭТАЛОНА, МУЛЬТИ-ВЕРСИИ, ЖИВОЕ ПРЕВЬЮ И СПИСАНИЕ БЮДЖЕТА
// =========================================================================
function onTargetModeChange() {
  const m = document.getElementById("nbTargetMode").value;
  document.getElementById("customRangeBox").classList.toggle("hidden", m !== "custom_range");
  if (m === "custom_range") document.getElementById("nbFramesCustom").value = String(currentFrameIdx + 1);
  updateCostEstimate();
}

function getTargetFramesForBatch() {
  const mode = document.getElementById("nbTargetMode").value;
  const slot = (document.getElementById("nbVersionSlot").value || "nanobanana").trim();
  const indexed = currentFrames.map((fr, idx) => ({ fr, humanNum: idx + 1 })).filter(x => x.fr.is_active !== false);

  if (mode === "overwrite_all") return indexed;
  if (mode === "only_missing") {
    return indexed.filter(x => !getFrameVersionsInfo(x.fr).availableRestored.some(v => v.type === slot));
  }
  const nums = new Set();
  (document.getElementById("nbFramesCustom").value || "").split(",").forEach(p => {
    p = p.trim();
    if (p.includes("-")) {
      const [s, e] = p.split("-").map(Number);
      for (let i = s; i <= e; i++) nums.add(i);
    } else if (!isNaN(parseInt(p))) nums.add(parseInt(p));
  });
  return indexed.filter(x => nums.has(x.humanNum));
}

function getUnitCostUsd() {
  const model = document.getElementById("nbModelSelect")?.value || "gemini-3.1-flash-lite-image";
  const res = document.getElementById("nbResSelect")?.value || "1K";
  return (MODEL_PRICING_USD[model] && MODEL_PRICING_USD[model][res]) || 0.015;
}

function updateCostEstimate() {
  const targets = getTargetFramesForBatch();
  const totalUsd = targets.length * getUnitCostUsd();
  document.getElementById("costEstimateValue").innerText = `${targets.length} кадр. ≈ $${totalUsd.toFixed(2)} (~₪${(totalUsd * USD_TO_ILS).toFixed(2)})`;
}

async function sleepWithCountdown(seconds, prefixText, logCallback) {
  for (let rem = seconds; rem > 0; rem--) {
    if (stopBatchRequested) return;
    if (logCallback) logCallback(`${prefixText}\n⏳ До продолжения: ${rem} сек...`);
    await new Promise(r => setTimeout(r, 1000));
  }
}

let cachedTokenObj = { token: "", projectId: "", exp: 0 };
async function getVertexAccessToken(saJsonStr) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedTokenObj.token && cachedTokenObj.exp > now + 120) return cachedTokenObj;
  const sa = JSON.parse(saJsonStr);
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const bin = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", bin.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const b64u = (s) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const hdr = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const clm = b64u(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${hdr}.${clm}`));
  const jwt = `${hdr}.${clm}.${b64u(String.fromCharCode(...new Uint8Array(sig)))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  const d = await res.json();
  if (!d.access_token) throw new Error("Ошибка GCP: " + JSON.stringify(d));
  cachedTokenObj = { token: d.access_token, projectId: sa.project_id || VERTEX_PROJECT_ID, exp: now + 3500 };
  return cachedTokenObj;
}

// Сбор двух эталонов: №1 (Цвет и палитра) и №2 (Лицо и детали персонажа)
function getDualReferenceUrls(autoChainUrl = null) {
  const colorNum = parseInt(document.getElementById("nbRefColorFrame").value);
  const faceNum = parseInt(document.getElementById("nbRefFaceFrame").value);
  let refColorUrl = null, refFaceUrl = null;

  if (!isNaN(colorNum) && colorNum >= 1 && colorNum <= currentFrames.length) {
    refColorUrl = pickBestUrl(currentFrames[colorNum - 1], "restored", preferredEngine).url;
  } else if (document.getElementById("nbAutoChainColor").checked && autoChainUrl) {
    refColorUrl = autoChainUrl;
  }

  if (!isNaN(faceNum) && faceNum >= 1 && faceNum <= currentFrames.length) {
    refFaceUrl = pickBestUrl(currentFrames[faceNum - 1], "restored", preferredEngine).url;
  }
  return { refColorUrl, refFaceUrl, refColorNum: !isNaN(colorNum) ? colorNum : (autoChainUrl ? "Авто" : null), refFaceNum: !isNaN(faceNum) ? faceNum : null };
}

async function callAiRestoreWithRetry(origUrl, refs, onRetryLog, onBeforeCooldown) {
  const modelId = document.getElementById("nbModelSelect").value;
  const resSize = document.getElementById("nbResSelect").value;
  const baseTemp = parseFloat(document.getElementById("nbTempRange").value) || 0.35;
  const promptText = document.getElementById("nbFinalPromptText").value.trim();

  const toB64 = async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Файл недоступен (${r.status})`);
    const b = await r.blob();
    const b64 = await new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result.split(",")[1]); fr.readAsDataURL(b); });
    return { b64, mime: b.type || "image/webp" };
  };

  // Поддержка внешних моделей (Grok / OpenRouter)
  if (modelId === "grok-2-image") {
    if (!adminSecrets.xai_api_key) { openSecretsModal(); throw new Error("Укажите xAI Grok API Key в '🔑 Ключи'"); }
    const r = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${adminSecrets.xai_api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-2-image", prompt: promptText, response_format: "b64_json" })
    });
    if (!r.ok) throw new Error(`Ошибка Grok API: ${await r.text()}`);
    const j = await r.json();
    const rawBlob = await (await fetch(`data:image/png;base64,${j.data[0].b64_json}`)).blob();
    return rawBlob;
  }

  const creds = (adminSecrets.gcp_credentials || "").trim();
  if (!creds) { openSecretsModal(); throw new Error("Укажите ключ Gemini/Vertex в '🔑 Ключи'"); }

  const orig = await toB64(origUrl);
  const parts = [];
  if (refs.refColorUrl) {
    try {
      const rc = await toB64(refs.refColorUrl);
      parts.push({ text: "COLOR & STYLE PALETTE REFERENCE (Match the color warmth, saturation, lighting, and brush texture from this image; do NOT copy its scene):" }, { inlineData: { mimeType: rc.mime, data: rc.b64 } });
    } catch (e) {}
  }
  if (refs.refFaceUrl) {
    try {
      const rf = await toB64(refs.refFaceUrl);
      parts.push({ text: "CHARACTER & FACE DETAILS REFERENCE (Use this image to reconstruct exact facial features, hair, and clothing details where the source frame is blurry):" }, { inlineData: { mimeType: rf.mime, data: rf.b64 } });
    } catch (e) {}
  }
  parts.push({ text: "SOURCE FRAME TO RESTORE:" }, { inlineData: { mimeType: orig.mime, data: orig.b64 } }, { text: promptText });

  let emptyCount = 0;
  for (let attempt = 1; attempt <= 8; attempt++) {
    if (stopBatchRequested) throw new Error("Остановлено пользователем");
    const reqBody = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: emptyCount === 0 ? ["IMAGE"] : ["TEXT", "IMAGE"],
        temperature: emptyCount === 0 ? baseTemp : Math.min(0.65, baseTemp + 0.1),
        topP: 0.95,
        imageConfig: { aspectRatio: "4:3", imageSize: resSize }
      }
    };

    let apiUrl = "", headers = { "Content-Type": "application/json" };
    if (creds.startsWith("{")) {
      const { token, projectId } = await getVertexAccessToken(creds);
      apiUrl = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${modelId}:generateContent`;
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${creds}`;
    }

    const res = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify(reqBody) });
    if (res.status === 429 || res.status === 503) {
      if (onBeforeCooldown) await onBeforeCooldown();
      await sleepWithCountdown(20, `⏸️ Минутный лимит Google API (попытка ${attempt}/8).`, onRetryLog);
      continue;
    }
    if (!res.ok) throw new Error(`Ошибка API (${res.status}): ${await res.text()}`);

    const json = await res.json();
    const imgPart = (json?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
    if (!imgPart) {
      emptyCount++;
      if (attempt < 8) {
        await sleepWithCountdown(5, `🔄 Пустой ответ ИИ, повтор (${attempt}/8)...`, onRetryLog);
        continue;
      }
      throw new Error("ИИ не вернул картинку");
    }

    const webpBlob = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        c.toBlob(b => (b && b.size > 1500) ? resolve(b) : reject(new Error("Битый WebP")), "image/webp", 0.92);
      };
      img.onerror = reject;
      img.src = `data:${imgPart.inlineData.mimeType || 'image/png'};base64,${imgPart.inlineData.data}`;
    });
    return webpBlob;
  }
  throw new Error("Превышено время ожидания API");
}

// Безопасное сохранение готовых кадров + запись Техпаспорта + Живое превью + Списание баланса ₪
async function flushReadyFrames(queue, logBox) {
  const validBatch = queue.splice(0, queue.length).filter(x => x && x.blob instanceof Blob && x.blob.size > 1500);
  if (!validBatch.length) return 0;

  logBox.innerText = `💾 Сохранение ${validBatch.length} готовых кадров на Hugging Face и в БД...`;
  const { uploadFiles } = await import("https://esm.sh/@huggingface/hub");
  await uploadFiles({
    repo: { type: "dataset", name: HF_REPO },
    accessToken: adminSecrets.hf_token,
    commitTitle: `Save ${validBatch.length} frames (${validBatch[0].slot}) for ${currentFilm.title}`,
    files: validBatch.map(x => ({ path: x.path, content: x.blob }))
  });

  const ts = Date.now();
  const verRows = validBatch.map(x => ({
    frame_id: x.fr.id,
    version_type: x.slot,
    version_label: x.slot,
    image_url: `https://huggingface.co/datasets/${HF_REPO}/resolve/main/${x.path}`,
    meta: x.meta
  }));
  await sbFetch("frame_versions?on_conflict=frame_id,version_type", {
    method: "POST", headers: { "Prefer": "resolution=merge-duplicates" }, body: JSON.stringify(verRows)
  });

  // Списываем стоимость из бюджета ₪ в БД
  const spentIls = validBatch.reduce((acc, x) => acc + (parseFloat(x.meta.cost_ils) || 0), 0);
  try {
    const bRes = await sbFetch("rpc/admin_add_spent_ils", { method: "POST", body: JSON.stringify({ pass_input: adminPassword, add_ils: spentIls }) });
    if (bRes && bRes.ok) {
      adminSecrets.budget_spent_ils = parseFloat(bRes.budget_spent_ils);
      updateBudgetBadge();
    }
  } catch (e) {}

  // Обновляем кадры в памяти и добавляем в Живую ленту превью (Live Preview)
  const liveSec = document.getElementById("livePreviewSection");
  const liveStrip = document.getElementById("livePreviewStrip");
  liveSec.classList.remove("hidden");

  validBatch.forEach(x => {
    const bustUrl = `https://huggingface.co/datasets/${HF_REPO}/resolve/main/${x.path}?t=${ts}`;
    const ex = x.fr.frame_versions.find(v => v.version_type === x.slot);
    if (ex) { ex.image_url = bustUrl; ex.meta = x.meta; }
    else x.fr.frame_versions.push({ version_type: x.slot, version_label: x.slot, image_url: bustUrl, meta: x.meta });

    const card = document.createElement("div");
    card.className = "flex-shrink-0 w-24 cursor-pointer rounded-lg overflow-hidden border border-emerald-500/60 bg-black";
    card.onclick = () => { currentFrameIdx = x.humanNum - 1; preferredEngine = x.slot; setViewMode("restored"); };
    card.innerHTML = `<div class="frame-aspect"><img src="${bustUrl}" class="w-full h-full object-cover" /></div><div class="text-[10px] text-center py-0.5 text-emerald-300 font-mono">№${x.humanNum} (${x.slot})</div>`;
    liveStrip.prepend(card);
  });

  preferredEngine = validBatch[0].slot;
  updatePlayerFrame(); renderThumbsGrid(); updateCostEstimate();
  return validBatch.length;
}

function buildFrameMetaObject(refs) {
  const unitUsd = getUnitCostUsd();
  const stObj = promptPresets.find(p => p.id === document.getElementById("nbStylePresetSelect")?.value);
  const colObj = promptPresets.find(p => p.id === document.getElementById("nbColorPresetSelect")?.value);
  return {
    model: document.getElementById("nbModelSelect").value,
    resolution: document.getElementById("nbResSelect").value,
    temperature: parseFloat(document.getElementById("nbTempRange").value) || 0.35,
    style_preset: stObj ? stObj.title : "Свой",
    color_preset: colObj ? colObj.title : "Нет",
    ref_color: refs.refColorNum || "Нет",
    ref_face: refs.refFaceNum || "Нет",
    cost_usd: unitUsd.toFixed(3),
    cost_ils: (unitUsd * USD_TO_ILS).toFixed(2),
    date: new Date().toLocaleString("ru-RU"),
    prompt: document.getElementById("nbFinalPromptText").value.trim()
  };
}

function getRepoFolderForSlot(slot) {
  if (slot === "nanobanana") return `nanobanana_paid/${currentFilm.id}`;
  if (slot === "flux2") return `flux2/${currentFilm.id}`;
  return `restored/${currentFilm.id}/${toSlug(slot)}`;
}

async function restoreSingleCurrentFrame() {
  if (!isAdmin || !currentFrames.length || !currentFilm) return;
  if (!adminSecrets.hf_token) return openSecretsModal();

  const fr = currentFrames[currentFrameIdx];
  const humanNum = currentFrameIdx + 1;
  const slot = (document.getElementById("nbVersionSlot").value || "nanobanana").trim();
  const origUrl = getFrameVersionsInfo(fr).originalUrl;
  const refs = getDualReferenceUrls(null);
  const logBox = document.getElementById("aiLogBox");
  logBox.classList.remove("hidden");
  logBox.innerText = `⏳ Реставрирую кадр №${humanNum} в версию [${slot}]...`;
  stopBatchRequested = false;

  await keepScreenAwake(true);
  try {
    const webpBlob = await callAiRestoreWithRetry(origUrl, refs, (m) => { logBox.innerText = `🍌 Кадр №${humanNum}: ${m}`; }, null);
    const path = `${getRepoFolderForSlot(slot)}/f_${String(fr.frame_number).padStart(3, "0")}.webp`;
    await flushReadyFrames([{ fr, humanNum, slot, path, blob: webpBlob, meta: buildFrameMetaObject(refs) }], logBox);
    setViewMode("restored");
    logBox.innerText = `✅ Кадр №${humanNum} сохранен в версию [${slot}]!`;
  } catch (e) { logBox.innerText = `❌ ${e.message}`; }
  finally { await keepScreenAwake(false); }
}

async function runBatchRestoration() {
  if (!isAdmin || !currentFrames.length || !currentFilm) return;
  if (!adminSecrets.hf_token) return openSecretsModal();

  const targetItems = getTargetFramesForBatch();
  if (!targetItems.length) return alert("В выбранной версии все эти кадры уже есть! Выберите другой слот версии или режим '🔄 Все кадры'.");

  const slot = (document.getElementById("nbVersionSlot").value || "nanobanana").trim();
  const btn = document.getElementById("btnBatchRestore");
  const stopBtn = document.getElementById("btnStopBatch");
  const logBox = document.getElementById("aiLogBox");
  btn.disabled = true; stopBtn.classList.remove("hidden"); logBox.classList.remove("hidden");
  stopBatchRequested = false;

  await keepScreenAwake(true);
  const pendingQueue = [];
  let totalSaved = 0;
  let autoChainAnchorUrl = null;

  try {
    for (let i = 0; i < targetItems.length; i++) {
      if (stopBatchRequested) break;
      const { fr, humanNum } = targetItems[i];
      const refs = getDualReferenceUrls(autoChainAnchorUrl);
      logBox.innerText = `🍌 Кадр №${humanNum} (${i + 1} из ${targetItems.length}) -> версия [${slot}] | Сохранено: ${totalSaved} 🟢...`;

      try {
        const webpBlob = await callAiRestoreWithRetry(
          getFrameVersionsInfo(fr).originalUrl,
          refs,
          (retryMsg) => { logBox.innerText = `🍌 Кадр №${humanNum} (Сохранено: ${totalSaved} 🟢)\n${retryMsg}`; },
          async () => { totalSaved += await flushReadyFrames(pendingQueue, logBox); }
        );
        if (webpBlob && !stopBatchRequested) {
          const path = `${getRepoFolderForSlot(slot)}/f_${String(fr.frame_number).padStart(3, "0")}.webp`;
          pendingQueue.push({ fr, humanNum, slot, path, blob: webpBlob, meta: buildFrameMetaObject(refs) });
          // Сохраняем каждые 2 кадра сразу на HF и в БД (живое превью без риска потери!)
          if (pendingQueue.length >= 2) {
            totalSaved += await flushReadyFrames(pendingQueue, logBox);
            if (!autoChainAnchorUrl && humanNum >= 3) {
              autoChainAnchorUrl = pickBestUrl(fr, "restored", slot).url;
            }
          }
        }
      } catch (e) {
        if (stopBatchRequested) break;
        logBox.innerText += `\n❌ Кадр №${humanNum}: ${e.message}`;
      }

      if (!stopBatchRequested && i < targetItems.length - 1) {
        await sleepWithCountdown(4, `✅ Кадр №${humanNum} готов! Пауза перед следующим...`, (m) => { logBox.innerText = m; });
      }
    }

    if (pendingQueue.length > 0) {
      totalSaved += await flushReadyFrames(pendingQueue, logBox);
    }

    if (totalSaved > 0) {
      await sbFetch(`filmstrips?id=eq.${currentFilm.id}`, { method: "PATCH", body: JSON.stringify({ status: "restored_paid" }) });
      currentFilm.status = "restored_paid";
      document.getElementById("editFilmStatus").value = "restored_paid";
      await reloadCatalogData();
    }
    logBox.innerText = `🏁 ГОТОВО! Сохранено кадров в версию [${slot}]: ${totalSaved} шт.`;
  } catch (e) { logBox.innerText = `❌ ${e.message}`; }
  finally { btn.disabled = false; stopBtn.classList.add("hidden"); await keepScreenAwake(false); }
}

// Остальные админ-действия с кадрами и очистка
async function setCurrentFrameAsCover() {
  if (!isAdmin || !currentFrames.length || !currentFilm) return;
  const fr = currentFrames[currentFrameIdx];
  const picked = pickBestUrl(fr, "restored", preferredEngine);
  const newExtra = { ...(currentFilm.extra_data || {}), cover_frame: fr.frame_number };
  try {
    await sbFetch(`filmstrips?id=eq.${currentFilm.id}`, { method: "PATCH", body: JSON.stringify({ extra_data: newExtra }) });
    currentFilm.extra_data = newExtra; filmStatsMap[currentFilm.id].coverUrl = picked.url;
    renderCatalog(); alert(`✅ Кадр №${currentFrameIdx + 1} назначен обложкой!`);
  } catch (e) { alert("Ошибка: " + e.message); }
}

async function toggleCurrentFrameActive() {
  if (!isAdmin || !currentFrames.length) return;
  const fr = currentFrames[currentFrameIdx];
  const nextVal = fr.is_active === false ? true : false;
  try {
    await sbFetch(`frames?id=eq.${fr.id}`, { method: "PATCH", body: JSON.stringify({ is_active: nextVal }) });
    fr.is_active = nextVal; updatePlayerFrame(); renderThumbsGrid();
  } catch (e) { alert("Ошибка: " + e.message); }
}

async function resetCurrentFilmRestorations() {
  const slot = (document.getElementById("nbVersionSlot").value || "nanobanana").trim();
  if (!currentFilm || !confirm(`Удалить из базы версию [${slot}] для всех кадров "${currentFilm.title}"?`)) return;
  try {
    const ids = currentFrames.map(x => x.id).join(",");
    if (ids) await sbFetch(`frame_versions?frame_id=in.(${ids})&version_type=eq.${encodeURIComponent(slot)}`, { method: "DELETE" });
    await openFilm(currentFilm.id); await reloadCatalogData();
    alert(`✅ Версия [${slot}] удалена!`);
  } catch (e) { alert("Ошибка: " + e.message); }
}

function openCleanupModal() {
  const restoredFilms = allFilms.filter(f => filmStatsMap[f.id]?.hasRestored);
  document.getElementById("cleanupList").innerHTML = restoredFilms.map(f => `
    <label class="flex items-center gap-3 p-2 rounded-xl bg-[#16110d] border border-[#33271d] cursor-pointer">
      <input type="checkbox" class="cleanup-keep-cb w-4 h-4 accent-[#d99b26]" value="${f.id}" checked />
      <div class="flex-1 text-xs">
        <div class="font-semibold text-[#f3ece2]">${f.title}</div>
        <div class="text-[10px] text-[#9e9081]">${[f.artist, f.year].filter(Boolean).join(" • ")}</div>
      </div>
    </label>`).join("");
  document.getElementById("cleanupModal").classList.remove("hidden");
}
function closeCleanupModal() { document.getElementById("cleanupModal").classList.add("hidden"); }
function toggleAllCleanupChecks(val) { document.querySelectorAll(".cleanup-keep-cb").forEach(cb => cb.checked = val); }

async function executeShowcaseCleanup() {
  const keepIds = new Set(Array.from(document.querySelectorAll(".cleanup-keep-cb:checked")).map(cb => cb.value));
  if (!confirm(`Оставить ИИ-версии только у выбранных (${keepIds.size} шт.), а у остальных очистить старые записи ИИ?`)) return;
  const btn = document.getElementById("btnExecCleanup");
  btn.disabled = true; btn.innerText = "⏳ Очистка...";
  try {
    const toReset = allFilms.filter(f => !keepIds.has(f.id) && f.status !== "pending");
    for (const f of toReset) {
      const frs = await sbFetch(`frames?filmstrip_id=eq.${f.id}&select=id`);
      if (frs.length > 0) {
        await sbFetch(`frame_versions?frame_id=in.(${frs.map(x => x.id).join(",")})`, { method: "DELETE" });
        await sbFetch(`filmstrips?id=eq.${f.id}`, { method: "PATCH", body: JSON.stringify({ status: "downloaded" }) });
      }
    }
    await reloadCatalogData(); closeCleanupModal();
    alert(`✅ Готово! ИИ-реставрация оставлена у ${keepIds.size} лент.`);
  } catch (e) { alert("Ошибка: " + e.message); }
  finally { btn.disabled = false; btn.innerText = "🧹 Оставить выбранные, остальные очистить"; }
}
