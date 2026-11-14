// =========================================================================
// STUDIO.JS v7.0 (ЧАСТЬ 1/2) — ТАБЛИЦА ВЕРСИЙ, ПАКЕТНАЯ ДОКАЧКА И МОЗАИКА ЦВЕТА
// =========================================================================

let executionLogHistory = [];
let stopBulkDownloadRequested = false;

// Переопределяем фильтр версий так, чтобы зрители видели только Опубликованные версии!
getFrameVersionsInfo = function(frame) {
  const versions = frame.frame_versions || [];
  const isRestoredUrl = (u) => u && !u.includes("/originals/");
  const origVer = versions.find(v => v.version_type === "original") || versions.find(v => (v.image_url || "").includes("/originals/"));
  const originalUrl = (origVer ? origVer.image_url : null) || frame.original_url || "";

  const hiddenList = currentFilm?.extra_data?.hidden_versions || [];
  const defVer = currentFilm?.default_version;

  const availableRestored = [];
  versions.forEach(v => {
    if (v.version_type !== "original" && isRestoredUrl(v.image_url)) {
      const isHidden = hiddenList.includes(v.version_type);
      // Обычным посетителям скрытые версии (черновики) не показываем
      if (!isAdmin && isHidden) return;
      availableRestored.push({
        type: v.version_type,
        label: (v.version_label || v.version_type) + (isAdmin && isHidden ? " 🔒" : ""),
        url: v.image_url,
        meta: v.meta || null,
        isHidden
      });
    }
  });

  if (defVer && defVer !== "auto") {
    availableRestored.sort((a, b) => (a.type === defVer ? -1 : b.type === defVer ? 1 : 0));
  }
  return { originalUrl, availableRestored };
};

function uiLog(shortMsg, detailMsg = "") {
  const timeStr = new Date().toLocaleTimeString("ru-RU");
  const box = document.getElementById("aiLogBox");
  if (box) {
    box.classList.remove("hidden");
    box.innerText = shortMsg;
  }
  const fullEntry = `[${timeStr}] ${shortMsg.replace(/\n/g, " | ")}${detailMsg ? " -> " + detailMsg : ""}`;
  executionLogHistory.push(fullEntry);
  if (executionLogHistory.length > 400) executionLogHistory.shift();
  const drawer = document.getElementById("fullLogDrawer");
  if (drawer) {
    drawer.innerText = executionLogHistory.join("\n");
    drawer.scrollTop = drawer.scrollHeight;
  }
}

function toggleFullLogView() {
  document.getElementById("fullLogDrawer")?.classList.toggle("hidden");
}

async function copyExecutionLog() {
  const txt = executionLogHistory.length ? executionLogHistory.join("\n") : (document.getElementById("aiLogBox")?.innerText || "Лог пуст");
  try {
    await navigator.clipboard.writeText(txt);
    alert("✅ Полный лог скопирован в буфер обмена!");
  } catch (e) {
    prompt("Скопируйте текст лога:", txt);
  }
}

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
      adminSecrets.bonus_left_ils = parseFloat(res.bonus_left_ils ?? 152.20);
      adminSecrets.prepay_left_ils = parseFloat(res.prepay_left_ils ?? 12.70);
      adminSecrets.total_spent_ils = parseFloat(res.total_spent_ils ?? 0.00);
      updateAdminUI(); onFilterChange();
      uiLog("✅ Студия v7.0 готова к работе");
      if (showAlerts) alert("✅ Вы вошли в студию управления (v7.0)!");
    } else if (showAlerts) alert("❌ Неверный пароль!");
  } catch (e) { if (showAlerts) alert("Ошибка входа: " + e.message); }
}

function updateBudgetBadge() {
  const b = document.getElementById("budgetBadge");
  if (!b) return;
  const isVertexJson = (adminSecrets.gcp_credentials || "").trim().startsWith("{");
  const bonusStr = Number(adminSecrets.bonus_left_ils || 0).toFixed(2);
  const prepayStr = Number(adminSecrets.prepay_left_ils || 0).toFixed(2);
  b.innerText = isVertexJson
    ? `🎁 Бонусы: ₪${bonusStr} (Деп: ₪${prepayStr})`
    : `💳 Депозит: ₪${prepayStr} (Бон: ₪${bonusStr})`;
}

function updateAdminUI() {
  const btn = document.getElementById("loginBtn");
  btn.innerText = isAdmin ? "Выйти" : "Войти";
  btn.className = isAdmin
    ? "px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#d99b26] text-[#18120e]"
    : "px-3 py-1.5 rounded-xl text-xs font-medium bg-[#2a2017] text-[#e6ccb2] border border-[#4a3728]";
  ["budgetBadge", "adminPromptsBtn", "adminSettingsBtn", "adminBar", "adminPlayerControls"].forEach(id => {
    document.getElementById(id)?.classList.toggle("hidden", !isAdmin);
  });

  // Автоматически добавляем кнопку пакетной докачки всех нескачанных фильмов в панель управления
  const bulkMetaBtn = document.getElementById("btnBulkMeta");
  if (bulkMetaBtn && !document.getElementById("btnBulkDownloadPending")) {
    const dlBtn = document.createElement("button");
    dlBtn.id = "btnBulkDownloadPending";
    dlBtn.onclick = () => runBulkDownloadAllPendingFilms();
    dlBtn.className = "px-3 py-1.5 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow";
    dlBtn.innerText = "📦 Докачать все нескачанные (по 8 фильмов в 1 коммит HF)";
    bulkMetaBtn.parentNode.insertBefore(dlBtn, bulkMetaBtn);

    const stopDlBtn = document.createElement("button");
    stopDlBtn.id = "btnStopBulkDownload";
    stopDlBtn.onclick = () => { stopBulkDownloadRequested = true; };
    stopDlBtn.className = "hidden px-3 py-1.5 rounded-xl text-xs font-bold bg-red-600 text-white";
    stopDlBtn.innerText = "⏹️ Стоп (сохранить скачанные)";
    bulkMetaBtn.parentNode.insertBefore(stopDlBtn, bulkMetaBtn);
  }

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
    { id: "waiting_approval", label: `⏳ Скрыты / На проверке (${cWait})` },
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
  const bEl = document.getElementById("secBonusLeft") || document.getElementById("secBudgetTotal");
  const pEl = document.getElementById("secPrepayLeft") || document.getElementById("secBudgetSpent");
  if (bEl) bEl.value = Number(adminSecrets.bonus_left_ils || 0).toFixed(2);
  if (pEl) pEl.value = Number(adminSecrets.prepay_left_ils || 0).toFixed(2);
  document.getElementById("secNewPass").value = "";
  document.getElementById("secretsModal").classList.remove("hidden");
}
function closeSecretsModal() { document.getElementById("secretsModal").classList.add("hidden"); }

async function saveSecretsToDb() {
  const bEl = document.getElementById("secBonusLeft") || document.getElementById("secBudgetTotal");
  const pEl = document.getElementById("secPrepayLeft") || document.getElementById("secBudgetSpent");
  const payload = {
    pass_input: adminPassword,
    new_hf: document.getElementById("secHfToken").value.trim(),
    new_gcp: document.getElementById("secGcpCreds").value.trim(),
    new_xai: document.getElementById("secXaiKey").value.trim(),
    new_openrouter: document.getElementById("secOpenRouterKey").value.trim(),
    new_bonus_left: String(parseFloat(bEl ? bEl.value : 152.20) || 0),
    new_prepay_left: String(parseFloat(pEl ? pEl.value : 12.70) || 0),
    new_pass: document.getElementById("secNewPass").value.trim() || null
  };
  try {
    const res = await sbFetch("rpc/admin_save_secrets", { method: "POST", body: JSON.stringify(payload) });
    if (res && res.ok) {
      adminSecrets.hf_token = payload.new_hf; adminSecrets.gcp_credentials = payload.new_gcp;
      adminSecrets.xai_api_key = payload.new_xai; adminSecrets.openrouter_api_key = payload.new_openrouter;
      adminSecrets.bonus_left_ils = parseFloat(payload.new_bonus_left); adminSecrets.prepay_left_ils = parseFloat(payload.new_prepay_left);
      if (payload.new_pass) { adminPassword = payload.new_pass; sessionStorage.setItem("diafond_admin_pass", adminPassword); }
      updateBudgetBadge(); closeSecretsModal(); alert("✅ Ключи и балансы сохранены!");
    }
  } catch (e) { alert("Ошибка: " + e.message); }
}

// =========================================================================
// НАГЛЯДНАЯ ТАБЛИЦА ВЕРСИЙ: ВЫБОР ГЛАВНОЙ (⭐) И ОПУБЛИКОВАТЬ/СКРЫТЬ (👁️/🔒)
// =========================================================================
function refreshFilmVersionSetsUI() {
  const summaryEl = document.getElementById("existingVersionsSummary");
  const inputSrcSel = document.getElementById("nbInputSourceSelect");
  if (!summaryEl || !inputSrcSel || !currentFrames.length || !currentFilm) return;

  const counts = {};
  currentFrames.forEach(fr => {
    (fr.frame_versions || []).forEach(v => {
      if (v.version_type !== "original" && v.image_url && !v.image_url.includes("/originals/")) {
        counts[v.version_type] = (counts[v.version_type] || 0) + 1;
      }
    });
  });

  const keys = Object.keys(counts);
  const defVer = currentFilm.default_version || "auto";
  const hiddenList = currentFilm.extra_data?.hidden_versions || [];
  const isFilmPublished = ["restored_paid", "downloaded", "restored"].includes(currentFilm.status);

  let html = `
    <div class="flex items-center justify-between p-2 mb-2 rounded-lg bg-[#221a14] border border-[#382b20]">
      <span class="text-xs font-semibold text-[#f3ece2]">Видимость диафильма в каталоге:</span>
      <button onclick="toggleWholeFilmPublished()" class="px-3 py-1 rounded-lg text-xs font-bold transition ${isFilmPublished ? 'bg-emerald-600 text-white' : 'bg-red-900/70 text-red-200 border border-red-500/40'}">
        ${isFilmPublished ? '🌍 ОПУБЛИКОВАН НА САЙТЕ' : '🔒 СКРЫТ С ВИТРИНЫ (На проверке)'}
      </button>
    </div>`;

  if (keys.length === 0) {
    html += `<div class="text-[11px] text-stone-400 py-1">У фильма пока нет ИИ-версий (зрителям показывается 📜 Оригинал).</div>`;
  } else {
    html += `<div class="space-y-1.5">`;
    keys.forEach(k => {
      const isDefault = (defVer === k) || (defVer === "auto" && keys[0] === k);
      const isHidden = hiddenList.includes(k);
      const isSelected = preferredEngine === k;
      html += `
        <div class="flex flex-wrap items-center justify-between gap-1.5 p-2 rounded-lg border ${isSelected ? 'bg-[#2a2017] border-[#d99b26]' : 'bg-[#1c1510] border-[#33271d]'}">
          <button onclick="selectVersionSetInStudio('${k}')" class="text-left flex-1 min-w-[110px]">
            <span class="text-xs font-bold ${isSelected ? 'text-[#d99b26]' : 'text-[#f3ece2]'}">🎨 ${k}</span>
            <span class="text-[10px] text-[#9e9081] ml-1">(${counts[k]}/${currentFrames.length} кадр.)</span>
          </button>
          <div class="flex items-center gap-1">
            <button onclick="setVersionAsDefault('${k}')" class="px-2 py-1 rounded text-[10px] font-bold transition ${isDefault ? 'bg-[#d99b26] text-[#18120e]' : 'bg-[#16110d] text-[#9e9081] hover:text-white border border-[#382b20]'}">
              ${isDefault ? '⭐ По умолч. на сайте' : '☆ Сделать главной'}
            </button>
            <button onclick="toggleVersionPublished('${k}')" class="px-2 py-1 rounded text-[10px] font-semibold transition ${!isHidden ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-600/40' : 'bg-stone-800 text-stone-400 border border-stone-700'}">
              ${!isHidden ? '👁️ Видна всем' : '🔒 Черновик (Скрыта)'}
            </button>
          </div>
        </div>`;
    });
    html += `</div>`;
  }
  summaryEl.innerHTML = html;

  const prevVal = inputSrcSel.value;
  inputSrcSel.innerHTML = `<option value="ORIGINAL">📜 Оригинальный скан пленки</option>` +
    keys.map(k => `<option value="${k}">✨ ИИ-набор: ${k} (${counts[k]} кадр.)</option>`).join("");
  if (prevVal && (prevVal === "ORIGINAL" || counts[prevVal])) inputSrcSel.value = prevVal;
}

async function toggleWholeFilmPublished() {
  if (!currentFilm) return;
  const isPub = ["restored_paid", "downloaded", "restored"].includes(currentFilm.status);
  const nextStatus = isPub ? "waiting_approval" : (filmStatsMap[currentFilm.id]?.hasRestored ? "restored_paid" : "downloaded");
  try {
    await sbFetch(`filmstrips?id=eq.${currentFilm.id}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
    currentFilm.status = nextStatus;
    document.getElementById("editFilmStatus").value = nextStatus;
    refreshFilmVersionSetsUI(); renderStatusTabs(); renderCatalog();
    uiLog(`🌍 Статус публикации диафильма изменен на: ${nextStatus}`);
  } catch (e) { uiLog(`❌ ${e.message}`); }
}

async function setVersionAsDefault(slotName) {
  if (!currentFilm) return;
  try {
    // Если делаем версию главной, автоматически снимаем с нее пометку "скрыта"
    const hidden = (currentFilm.extra_data?.hidden_versions || []).filter(x => x !== slotName);
    const newExtra = { ...(currentFilm.extra_data || {}), hidden_versions: hidden };
    await sbFetch(`filmstrips?id=eq.${currentFilm.id}`, {
      method: "PATCH",
      body: JSON.stringify({ default_version: slotName, extra_data: newExtra })
    });
    currentFilm.default_version = slotName;
    currentFilm.extra_data = newExtra;
    document.getElementById("editDefaultVersion").value = slotName;
    selectVersionSetInStudio(slotName);
    await reloadCatalogData();
    uiLog(`⭐ Набор [${slotName}] установлен как ГЛАВНАЯ версия по умолчанию для всех посетителей!`);
  } catch (e) { uiLog(`❌ ${e.message}`); }
}

async function toggleVersionPublished(slotName) {
  if (!currentFilm) return;
  const curHidden = new Set(currentFilm.extra_data?.hidden_versions || []);
  if (curHidden.has(slotName)) curHidden.delete(slotName);
  else curHidden.add(slotName);

  const newExtra = { ...(currentFilm.extra_data || {}), hidden_versions: [...curHidden] };
  try {
    await sbFetch(`filmstrips?id=eq.${currentFilm.id}`, { method: "PATCH", body: JSON.stringify({ extra_data: newExtra }) });
    currentFilm.extra_data = newExtra;
    refreshFilmVersionSetsUI(); updatePlayerFrame();
    uiLog(`${curHidden.has(slotName) ? '🔒 Набор [' + slotName + '] переведен в Черновик (скрыт от посетителей)' : '👁️ Набор [' + slotName + '] опубликован для посетителей!'}`);
  } catch (e) { uiLog(`❌ ${e.message}`); }
}

function selectVersionSetInStudio(slotName) {
  document.getElementById("nbVersionSlot").value = slotName;
  preferredEngine = slotName;
  setViewMode("restored");
  renderThumbsGrid();
  updateCostEstimate();
  uiLog(`🗂️ Выбран активный набор кадров: [${slotName}]`);
}

async function cloneVersionSetModal() {
  if (!currentFrames.length || !currentFilm) return;
  const currentSlot = (document.getElementById("nbVersionSlot").value || preferredEngine || "nanobanana").trim();
  const baseSlot = prompt(`Из какого набора скопировать кадры за основу?\n(Введите имя существующего набора или "ORIGINAL"):`, currentSlot);
  if (!baseSlot) return;
  const newSlot = prompt(`Введите имя для НОВОГО набора кадров (например: nanolite-color-fix):`, `${baseSlot}-fix`);
  if (!newSlot || !newSlot.trim()) return;
  const targetSlot = newSlot.trim();

  uiLog(`📑 Создаю новый набор [${targetSlot}] на базе [${baseSlot}]...`);
  try {
    const rows = currentFrames.map(fr => {
      const versions = fr.frame_versions || [];
      const found = versions.find(v => v.version_type === baseSlot.trim());
      const origUrl = getFrameVersionsInfo(fr).originalUrl;
      const imgUrl = found ? found.image_url.split("?")[0] : origUrl;
      return {
        frame_id: fr.id,
        version_type: targetSlot,
        version_label: targetSlot,
        image_url: imgUrl,
        meta: found?.meta ? { ...found.meta, cloned_from: baseSlot } : { cloned_from: "original" }
      };
    });
    await sbFetch("frame_versions?on_conflict=frame_id,version_type", { method: "POST", headers: { "Prefer": "resolution=merge-duplicates" }, body: JSON.stringify(rows) });
    await openFilm(currentFilm.id);
    selectVersionSetInStudio(targetSlot);
    document.getElementById("nbInputSourceSelect").value = baseSlot.trim() !== "ORIGINAL" ? baseSlot.trim() : "ORIGINAL";
    uiLog(`✅ Создан набор [${targetSlot}] (${rows.length} кадр.)!`);
  } catch (e) { uiLog(`❌ Ошибка клонирования: ${e.message}`); }
}
// =========================================================================
// STUDIO.JS v7.0 (ЧАСТЬ 2/2) — МОЗАИКА ЦВЕТА, ПАКЕТНАЯ ДОКАЧКА 171 ФИЛЬМА И ИИ
// =========================================================================

async function loadPromptPresets() {
  try { promptPresets = await sbFetch("prompt_presets?select=*&order=sort_order.asc,created_at.asc") || []; } catch (e) { promptPresets = []; }
  const styleSel = document.getElementById("nbStylePresetSelect"), colorSel = document.getElementById("nbColorPresetSelect");
  if (!styleSel || !colorSel) return;
  const styles = promptPresets.filter(p => p.preset_group !== "color_fix"), colors = promptPresets.filter(p => p.preset_group === "color_fix");
  styleSel.innerHTML = styles.map(p => `<option value="${p.id}">${p.title}</option>`).join("");
  colorSel.innerHTML = `<option value="">Без цветового фильтра</option>` + colors.map(p => `<option value="${p.id}">${p.title}</option>`).join("");
  if (colors.length > 0) colorSel.value = colors[0].id;
  onPresetSelectChange();
}

function onPresetSelectChange() {
  const stObj = promptPresets.find(p => p.id === document.getElementById("nbStylePresetSelect")?.value);
  if (stObj?.default_temp) { document.getElementById("nbTempRange").value = stObj.default_temp; document.getElementById("tempValLabel").innerText = stObj.default_temp; }
  rebuildVisiblePrompt();
}

function rebuildVisiblePrompt() {
  const stObj = promptPresets.find(p => p.id === document.getElementById("nbStylePresetSelect")?.value);
  const colObj = promptPresets.find(p => p.id === document.getElementById("nbColorPresetSelect")?.value);
  const extra = (document.getElementById("nbExtraDetails")?.value || "").trim();
  const parts = [
    colObj ? colObj.prompt_text : "",
    stObj ? stObj.prompt_text : "",
    extra ? `Additional filmstrip context & instructions: ${extra}.` : "",
    "Text preservation: Exactly reproduce the Russian Cyrillic caption at the bottom. Do not invent or mutate characters. Keep Russian letters identical, sharp and legible."
  ].filter(Boolean);
  const area = document.getElementById("nbFinalPromptText");
  if (area) area.value = parts.join("\n\n");
}

function openPromptsModal() { renderPresetsManagerList(); clearPresetForm(); document.getElementById("promptsModal").classList.remove("hidden"); }
function closePromptsModal() { document.getElementById("promptsModal").classList.add("hidden"); }

function renderPresetsManagerList() {
  document.getElementById("presetsListContainer").innerHTML = promptPresets.map(p => `
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
  ["editPresetId", "editPresetTitle", "editPresetText"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("editPresetGroup").value = "style";
}

async function savePresetToDb() {
  const id = document.getElementById("editPresetId").value.trim(), title = document.getElementById("editPresetTitle").value.trim();
  const preset_group = document.getElementById("editPresetGroup").value, prompt_text = document.getElementById("editPresetText").value.trim();
  if (!title || !prompt_text) return alert("Заполните название и текст промпта!");
  try {
    if (id) await sbFetch(`prompt_presets?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ title, preset_group, prompt_text }) });
    else await sbFetch("prompt_presets", { method: "POST", body: JSON.stringify({ title, preset_group, prompt_text }) });
    await loadPromptPresets(); renderPresetsManagerList(); clearPresetForm();
  } catch (e) { alert("Ошибка: " + e.message); }
}

async function deletePresetFromDb(id) {
  if (!confirm("Удалить этот пресет?")) return;
  try { await sbFetch(`prompt_presets?id=eq.${id}`, { method: "DELETE" }); await loadPromptPresets(); renderPresetsManagerList(); }
  catch (e) { alert("Ошибка: " + e.message); }
}

async function saveCurrentPromptAsPreset() {
  const txt = document.getElementById("nbFinalPromptText").value.trim();
  if (!txt) return;
  const title = prompt("Введите название для нового пресета:");
  if (!title) return;
  try {
    await sbFetch("prompt_presets", { method: "POST", body: JSON.stringify({ title: title.trim(), preset_group: "style", prompt_text: txt }) });
    await loadPromptPresets(); alert(`✅ Пресет "${title}" сохранен!`);
  } catch (e) { alert("Ошибка: " + e.message); }
}

// =========================================================================
// МОДУЛЬ OCR (БЕЗ ОСТАНОВОК НА ПУСТЫХ КАДРАХ)
// =========================================================================
async function saveCurrentFrameTextAndHint() {
  if (!isAdmin || !currentFrames.length) return;
  const fr = currentFrames[currentFrameIdx];
  const source_text = document.getElementById("editFrameSourceText").value.trim() || null;
  const scene_hint = document.getElementById("editFrameSceneHint").value.trim() || null;
  try {
    await sbFetch(`frames?id=eq.${fr.id}`, { method: "PATCH", body: JSON.stringify({ source_text, scene_hint }) });
    fr.source_text = source_text; fr.scene_hint = scene_hint;
    updatePlayerFrame(); renderThumbsGrid();
    uiLog(`✅ Текст и подсказка кадра №${currentFrameIdx + 1} сохранены`);
  } catch (e) { uiLog(`❌ ${e.message}`); }
}

let workingOcrRoute = null;

async function runGeminiVisionOcrOnFrame(origUrl, filmTitle, humanNum) {
  const creds = (adminSecrets.gcp_credentials || "").trim();
  if (!creds) { openSecretsModal(); throw new Error("Укажите ключ в '🔑 Ключи'"); }
  const rImg = await fetch(origUrl);
  if (!rImg.ok) throw new Error(`HTTP ${rImg.status}`);
  const b = await rImg.blob();
  const b64 = await new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result.split(",")[1]); fr.readAsDataURL(b); });

  const ocrPrompt = `Analyze frame #${humanNum} from Soviet filmstrip "${filmTitle}".
1. Read exact Russian Cyrillic caption text at bottom/top. Fix broken letters using Russian grammar context. If no caption, set "caption" to "".
2. Using BOTH image and Russian caption, write concise English scene & pose description (1-2 sentences): who is depicted, facing viewer, profile, or turned away (seen from behind), objects/colors mentioned, time of day.
Return ONLY valid JSON: {"caption": "...", "scene_hint": "..."}`;

  const allRoutes = [
    { loc: "global", model: "gemini-2.5-flash" },
    { loc: "global", model: "gemini-3.1-flash-lite" },
    { loc: "global", model: "gemini-3.1-flash" },
    { loc: "global", model: "gemini-2.5-flash-lite" },
    { loc: "us-central1", model: "gemini-2.0-flash" },
    { loc: "global", model: "gemini-3.1-flash-lite-image", imgMode: true }
  ];
  const routes = workingOcrRoute ? [workingOcrRoute, ...allRoutes.filter(r => r.model !== workingOcrRoute.model || r.loc !== workingOcrRoute.loc)] : allRoutes;
  const errs = [];

  for (const rt of routes) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (stopBatchRequested) throw new Error("Остановлено");
      const reqBody = {
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: b.type || "image/webp", data: b64 } }, { text: ocrPrompt }] }],
        generationConfig: { temperature: 0.1, ...(rt.imgMode ? { responseModalities: ["TEXT", "IMAGE"] } : {}) }
      };
      let apiUrl = "", headers = { "Content-Type": "application/json" };
      if (creds.startsWith("{")) {
        const { token, projectId } = await getVertexAccessToken(creds);
        const host = rt.loc === "global" ? "aiplatform.googleapis.com" : `${rt.loc}-aiplatform.googleapis.com`;
        apiUrl = `https://${host}/v1/projects/${projectId}/locations/${rt.loc}/publishers/google/models/${rt.model}:generateContent`;
        headers["Authorization"] = `Bearer ${token}`;
      } else apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${rt.model}:generateContent?key=${creds}`;

      const res = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify(reqBody) });
      if (res.status === 429 || res.status === 503) {
        await sleepWithCountdown(12, `⏸️ OCR №${humanNum}: лимит 429 (${rt.model}), попытка ${attempt}/3`, (m) => uiLog(m));
        continue;
      }
      if (!res.ok) { errs.push(`${rt.model}:${res.status}`); break; }
      const j = await res.json();
      const rawTxt = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join(" ").trim();
      const m = rawTxt.match(/\{[\s\S]*\}/);
      if (m) {
        try { const parsed = JSON.parse(m[0]); workingOcrRoute = rt; return { source_text: (parsed.caption || "").trim(), scene_hint: (parsed.scene_hint || "").trim(), modelUsed: rt.model }; } catch (pe) {}
      }
      if (rawTxt.length > 0) { workingOcrRoute = rt; return { source_text: "", scene_hint: rawTxt.slice(0, 200), modelUsed: rt.model }; }
      errs.push(`${rt.model}:empty`); break;
    }
  }
  throw new Error(`OCR сбой [${errs.join(", ")}]`);
}

async function ocrSingleCurrentFrame() {
  if (!isAdmin || !currentFrames.length || !currentFilm) return;
  const fr = currentFrames[currentFrameIdx], humanNum = currentFrameIdx + 1;
  stopBatchRequested = false; uiLog(`📖 OCR кадра №${humanNum}...`);
  try {
    const { source_text, scene_hint, modelUsed } = await runGeminiVisionOcrOnFrame(getFrameVersionsInfo(fr).originalUrl, currentFilm.title, humanNum);
    await sbFetch(`frames?id=eq.${fr.id}`, { method: "PATCH", body: JSON.stringify({ source_text, scene_hint }) });
    fr.source_text = source_text; fr.scene_hint = scene_hint; updatePlayerFrame(); renderThumbsGrid();
    uiLog(`✅ Кадр №${humanNum} (${modelUsed}):\n📖 Подпись: ${source_text || '(нет)'}\n🎭 Сцена: ${scene_hint}`);
  } catch (e) { uiLog(`❌ Кадр №${humanNum}: ${e.message}`); }
}

async function runBatchOcrForFilm() {
  if (!isAdmin || !currentFrames.length || !currentFilm) return;
  const missing = currentFrames.map((fr, idx) => ({ fr, humanNum: idx + 1 })).filter(x => x.fr.is_active !== false && !x.fr.source_text);
  const list = missing.length > 0 ? missing : currentFrames.map((fr, idx) => ({ fr, humanNum: idx + 1 })).filter(x => x.fr.is_active !== false);
  if (!confirm(`Распознать подписи и ракурс для ${list.length} кадров "${currentFilm.title}"?`)) return;

  const btn = document.getElementById("btnBatchOcr"), stopBtn = document.getElementById("btnStopBatch");
  btn.disabled = true; stopBtn.classList.remove("hidden"); stopBatchRequested = false; await keepScreenAwake(true);
  let okCount = 0, skipCount = 0;
  try {
    for (let i = 0; i < list.length; i++) {
      if (stopBatchRequested) { uiLog(`⏹️ OCR остановлен. Успешно: ${okCount}`); break; }
      const { fr, humanNum } = list[i];
      uiLog(`📖 OCR кадра №${humanNum} (${i + 1}/${list.length}) | Готово: ${okCount}...`);
      try {
        const { source_text, scene_hint, modelUsed } = await runGeminiVisionOcrOnFrame(getFrameVersionsInfo(fr).originalUrl, currentFilm.title, humanNum);
        await sbFetch(`frames?id=eq.${fr.id}`, { method: "PATCH", body: JSON.stringify({ source_text, scene_hint }) });
        fr.source_text = source_text; fr.scene_hint = scene_hint; okCount++;
        uiLog(`✅ OCR №${humanNum} (${modelUsed}): "${source_text.slice(0, 45)}..."`, scene_hint);
        updatePlayerFrame(); renderThumbsGrid();
      } catch (e) { skipCount++; uiLog(`⚠️ Пропущен кадр №${humanNum}: ${e.message}`); }
      await new Promise(r => setTimeout(r, 1100));
    }
    uiLog(`🏁 OCR завершен! Распознано: ${okCount}, пропущено: ${skipCount}.`);
  } finally { btn.disabled = false; stopBtn.classList.add("hidden"); await keepScreenAwake(false); }
}

// =========================================================================
// ПАРСЕР И ПАКЕТНАЯ ДОКАЧКА ВСЕХ 171 ФИЛЬМОВ ПО 8 ШТУК В 1 КОММИТ HF
// =========================================================================
function decodeHtmlBytes(buf) {
  const bytes = new Uint8Array(buf);
  if (new TextDecoder("ascii").decode(bytes.slice(0, 2048)).toLowerCase().includes("1251")) return new TextDecoder("windows-1251").decode(bytes);
  const u8 = new TextDecoder("utf-8").decode(bytes);
  return u8.includes("\uFFFD") ? new TextDecoder("windows-1251").decode(bytes) : u8;
}

async function fetchDiafilmyHtml(targetUrl, logFn) {
  if (logFn) logFn(`📡 Чтение ${targetUrl}...`);
  const rpc = await sbFetch("rpc/admin_proxy_fetch", { method: "POST", body: JSON.stringify({ pass_input: adminPassword, target_url: targetUrl }) });
  if (rpc?.ok) {
    if (rpc.base64) {
      const bin = atob(rpc.base64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const dec = decodeHtmlBytes(arr.buffer);
      if (!dec.includes("\uFFFD") && dec.length > 200) return dec;
    }
    if (rpc.html_text?.length > 200) return rpc.html_text;
  }
  throw new Error(rpc?.error || "Ошибка чтения diafilmy.su");
}

function extractDiafilmyFullMetadata(html, sourceUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let title = (doc.querySelector("title")?.textContent || "").replace(/^Смотреть диафильм\s+/i, "").replace(/\s*[-»–|]\s*Диафильмы\.su.*$/i, "").trim();
  const text = (doc.body.innerText || "").replace(/\u00A0/g, " ");
  const ex = (rx) => { const m = text.match(rx); return m ? m[1].trim() : null; };
  if (ex(/Название:\s*([^\n\r|]+)/i)) title = ex(/Название:\s*([^\n\r|]+)/i);
  const tagsRaw = ex(/Теги:\s*([^\n\r|]+)/i);
  const tags = tagsRaw ? tagsRaw.split(/[,;#]+|\s{2,}/).map(t => t.trim()).filter(Boolean) : null;
  const box = doc.querySelector('[id^="news-id-"]') || doc.querySelector('.full-news') || doc.body;
  let rawImgs = Array.from(box.querySelectorAll("img")).map(i => i.getAttribute("src") || i.getAttribute("data-src")).filter(s => s && s.includes("/uploads/") && !s.includes("/thumbs/"));
  if (!rawImgs.length) rawImgs = Array.from(box.querySelectorAll("img")).map(i => i.getAttribute("src") || i.getAttribute("data-src")).filter(s => s && s.includes("/uploads/")).map(s => s.replace("/thumbs/", "/"));
  const uniqueImgs = [...new Set(rawImgs)].map(s => s.startsWith("http") ? s : "https://diafilmy.su" + s);
  const y = ex(/Год выпуска:\s*(\d{4})/i), fc = ex(/Кадров:\s*(\d+)/i);
  const metaPayload = {
    ...(title && { title }), ...(sourceUrl && { original_url: sourceUrl }),
    ...(ex(/Категория:\s*([^\n\r|]+)/i) && { category: ex(/Категория:\s*([^\n\r|]+)/i) }),
    ...(ex(/Студия:\s*([^\n\r|]+)/i) && { studio: ex(/Студия:\s*([^\n\r|]+)/i) }),
    ...(y && { year: parseInt(y) }), ...(ex(/Цветность:\s*([^\n\r|]+)/i) && { color: ex(/Цветность:\s*([^\n\r|]+)/i) }),
    ...(ex(/Вид диафильма:\s*([^\n\r|]+)/i) && { film_style: ex(/Вид диафильма:\s*([^\n\r|]+)/i) }),
    ...(fc && { frame_count: parseInt(fc) }), ...(ex(/Номер:\s*([^\n\r|]+)/i) && { film_number: ex(/Номер:\s*([^\n\r|]+)/i) }),
    ...(ex(/Автор:\s*([^\n\r|]+)/i) && { author: ex(/Автор:\s*([^\n\r|]+)/i) }),
    ...(ex(/(?:^|\n)\s*Художник:\s*([^\n\r|]+)/i) && { artist: ex(/(?:^|\n)\s*Художник:\s*([^\n\r|]+)/i) }),
    ...(ex(/Художник-оформитель:\s*([^\n\r|]+)/i) && { designer: ex(/Художник-оформитель:\s*([^\n\r|]+)/i) }),
    ...(ex(/(?:^|\n)\s*Редактор:\s*([^\n\r|]+)/i) && { editor: ex(/(?:^|\n)\s*Редактор:\s*([^\n\r|]+)/i) }),
    ...(ex(/Художественный редактор:\s*([^\n\r|]+)/i) && { art_director: ex(/Художественный редактор:\s*([^\n\r|]+)/i) }),
    ...(tags?.length && { tags })
  };
  return { metaPayload, uniqueImgs };
}

async function fetchImageAsWebpBlobSafe(imgUrl) {
  const routes = [`https://wsrv.nl/?url=${encodeURIComponent(imgUrl)}&output=webp&q=90`, `https://images1-focus-opensocial.googleusercontent.com/gadgets/proxy?container=focus&refresh=2592000&url=${encodeURIComponent(imgUrl)}`];
  for (let a = 0; a < 3; a++) {
    for (const u of routes) {
      try { const r = await fetch(u); if (r.ok) { const b = await r.blob(); if (b.size > 1000) return b; } } catch (e) {}
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

let wakeLockObj = null;
async function keepScreenAwake(enable) {
  try {
    if (enable && "wakeLock" in navigator && !wakeLockObj) wakeLockObj = await navigator.wakeLock.request("screen");
    else if (!enable && wakeLockObj) { await wakeLockObj.release(); wakeLockObj = null; }
  } catch (e) {}
}

// МЕГА-ПАКЕТНАЯ ДОКАЧКА ВСЕХ НЕСКАЧАННЫХ ДИАФИЛЬМОВ (ПО 8 ФИЛЬМОВ В 1 КОММИТ HUGGING FACE!)
async function runBulkDownloadAllPendingFilms() {
  if (!adminSecrets.hf_token) return openSecretsModal();
  const pendingFilms = allFilms.filter(f => !filmStatsMap[f.id]?.hasFrames && f.original_url && f.original_url.includes("diafilmy.su"));
  if (!pendingFilms.length) return alert("Все диафильмы с ссылками уже скачаны!");
  const FILMS_PER_COMMIT = 8;
  const estCommits = Math.ceil(pendingFilms.length / FILMS_PER_COMMIT);
  if (!confirm(`Найдено нескачанных диафильмов: ${pendingFilms.length} шт.\n\nЗапустить пакетную докачку пачками по ${FILMS_PER_COMMIT} диафильмов в 1 коммит Hugging Face?\n(На все ${pendingFilms.length} фильмов уйдет всего ~${estCommits} коммитов HF при лимите 128 коммитов/час!)`)) return;

  const dlBtn = document.getElementById("btnBulkDownloadPending");
  const stopBtn = document.getElementById("btnStopBulkDownload");
  const logEl = document.getElementById("bulkMetaLog");
  if (dlBtn) dlBtn.disabled = true;
  if (stopBtn) stopBtn.classList.remove("hidden");
  logEl.classList.remove("hidden");
  stopBulkDownloadRequested = false;
  await keepScreenAwake(true);

  let megaFilesQueue = [];
  let megaFilmsMetaQueue = [];
  let totalFilmsSaved = 0, hfCommitsUsed = 0;

  const flushMegaPackToHfAndDb = async () => {
    if (!megaFilesQueue.length || !megaFilmsMetaQueue.length) return;
    hfCommitsUsed++;
    logEl.innerText = `📤 Выгрузка пачки из ${megaFilmsMetaQueue.length} диафильмов (${megaFilesQueue.length} кадров) на Hugging Face в ОДИН коммит #${hfCommitsUsed}...`;
    const { uploadFiles } = await import("https://esm.sh/@huggingface/hub");
    await uploadFiles({
      repo: { type: "dataset", name: HF_REPO },
      accessToken: adminSecrets.hf_token,
      commitTitle: `Bulk import ${megaFilmsMetaQueue.length} filmstrips (pack #${hfCommitsUsed})`,
      files: megaFilesQueue.map(x => ({ path: x.path, content: x.content }))
    });

    logEl.innerText = `🔗 Запись ${megaFilmsMetaQueue.length} диафильмов в базу Supabase...`;
    for (const item of megaFilmsMetaQueue) {
      await sbFetch(`filmstrips?id=eq.${item.filmId}`, { method: "PATCH", body: JSON.stringify(item.metaPayload) });
      await sbFetch("frames?on_conflict=filmstrip_id,frame_number", { method: "POST", headers: { "Prefer": "resolution=merge-duplicates" }, body: JSON.stringify(item.frameRows) });
      totalFilmsSaved++;
    }
    megaFilesQueue = [];
    megaFilmsMetaQueue = [];
    await reloadCatalogData();
  };

  try {
    for (let idx = 0; idx < pendingFilms.length; idx++) {
      if (stopBulkDownloadRequested) {
        logEl.innerText = `⏹️ Остановка по запросу. Сохраняю уже скачанные в текущей пачке фильмы...`;
        break;
      }
      const film = pendingFilms[idx];
      try {
        logEl.innerText = `📦 Фильм [${idx + 1}/${pendingFilms.length}] "${film.title}" (В текущей пачке: ${megaFilmsMetaQueue.length}/${FILMS_PER_COMMIT} | Сохранено: ${totalFilmsSaved} | Коммитов HF: ${hfCommitsUsed})...\n📡 Чтение страницы diafilmy.su...`;
        const html = await fetchDiafilmyHtml(film.original_url);
        const { metaPayload, uniqueImgs } = extractDiafilmyFullMetadata(html, film.original_url);
        if (!uniqueImgs.length) continue;

        const title = metaPayload.title || film.title || "Диафильм";
        metaPayload.status = "downloaded";
        metaPayload.frame_count = uniqueImgs.length;
        const slug = toSlug(title);
        const filmFiles = [];
        let doneFrames = 0;

        await Promise.all(Array.from({ length: 4 }, async (_, wIdx) => {
          for (let i = wIdx; i < uniqueImgs.length; i += 4) {
            if (stopBulkDownloadRequested) return;
            const b = await fetchImageAsWebpBlobSafe(uniqueImgs[i]);
            doneFrames++;
            if (b) filmFiles.push({ frameNum: i, path: `originals/${slug}/f_${String(i).padStart(3, "0")}.webp`, content: b });
            logEl.innerText = `📦 Фильм [${idx + 1}/${pendingFilms.length}] "${title}": скачано кадров ${doneFrames}/${uniqueImgs.length}\n(Пачка: ${megaFilmsMetaQueue.length + 1}/${FILMS_PER_COMMIT} | Всего готово: ${totalFilmsSaved} | Коммитов HF: ${hfCommitsUsed})`;
          }
        }));

        if (filmFiles.length > 0 && !stopBulkDownloadRequested) {
          filmFiles.sort((a, b) => a.frameNum - b.frameNum);
          megaFilesQueue.push(...filmFiles);
          megaFilmsMetaQueue.push({
            filmId: film.id,
            metaPayload,
            frameRows: filmFiles.map(f => ({
              filmstrip_id: film.id, frame_number: f.frameNum, sort_order: f.frameNum,
              original_url: `https://huggingface.co/datasets/${HF_REPO}/resolve/main/${f.path}`, is_active: true
            }))
          });
        }

        if (megaFilmsMetaQueue.length >= FILMS_PER_COMMIT) {
          await flushMegaPackToHfAndDb();
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (fe) {
        logEl.innerText += `\n⚠️ Пропущен "${film.title}": ${fe.message}`;
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (megaFilmsMetaQueue.length > 0) {
      await flushMegaPackToHfAndDb();
    }
    logEl.innerText = `🏁 ПАКЕТНАЯ ДОКАЧКА ЗАВЕРШЕНА! Успешно сохранено диафильмов: ${totalFilmsSaved} шт. Использовано коммитов HF: ${hfCommitsUsed}.`;
  } catch (e) {
    logEl.innerText = `❌ Ошибка пакетной выгрузки: ${e.message}`;
  } finally {
    if (dlBtn) dlBtn.disabled = false;
    if (stopBtn) stopBtn.classList.add("hidden");
    await keepScreenAwake(false);
  }
}

async function parseAndImportDiafilmUrl(sourceUrl, existingFilmId = null, logEl = null) {
  if (!adminSecrets.hf_token) { openSecretsModal(); throw new Error("Укажите HF_TOKEN"); }
  const log = (m) => { if (logEl) { logEl.classList.remove("hidden"); logEl.innerText = m; } uiLog(m); };
  await keepScreenAwake(true);
  try {
    const html = await fetchDiafilmyHtml(sourceUrl, log);
    const { metaPayload, uniqueImgs } = extractDiafilmyFullMetadata(html, sourceUrl);
    if (!uniqueImgs.length) throw new Error("Кадры не найдены!");
    const title = metaPayload.title || "Диафильм";
    metaPayload.status = "downloaded"; metaPayload.frame_count = uniqueImgs.length;
    let filmId = existingFilmId;
    if (!filmId) {
      const ex = await sbFetch(`filmstrips?original_url=eq.${encodeURIComponent(sourceUrl)}&select=id`);
      if (ex?.length) { filmId = ex[0].id; await sbFetch(`filmstrips?id=eq.${filmId}`, { method: "PATCH", body: JSON.stringify(metaPayload) }); }
      else { const ins = await sbFetch("filmstrips", { method: "POST", headers: { "Prefer": "return=representation" }, body: JSON.stringify(metaPayload) }); filmId = ins[0].id; }
    } else await sbFetch(`filmstrips?id=eq.${filmId}`, { method: "PATCH", body: JSON.stringify(metaPayload) });

    const slug = toSlug(title), downloadedFiles = [], failedFrames = [];
    let doneCount = 0;
    await Promise.all(Array.from({ length: 4 }, async (_, wIdx) => {
      for (let i = wIdx; i < uniqueImgs.length; i += 4) {
        const b = await fetchImageAsWebpBlobSafe(uniqueImgs[i]);
        doneCount++;
        if (b) downloadedFiles.push({ frameNum: i, path: `originals/${slug}/f_${String(i).padStart(3, "0")}.webp`, content: b });
        else failedFrames.push(i + 1);
        log(`📥 Скачано: ${doneCount}/${uniqueImgs.length} (ошибок: ${failedFrames.length})...`);
      }
    }));
    downloadedFiles.sort((a, b) => a.frameNum - b.frameNum);
    log(`📤 Выгрузка ${downloadedFiles.length} кадров на HF...`);
    const { uploadFiles } = await import("https://esm.sh/@huggingface/hub");
    await uploadFiles({ repo: { type: "dataset", name: HF_REPO }, accessToken: adminSecrets.hf_token, commitTitle: `Import ${title}`, files: downloadedFiles.map(f => ({ path: f.path, content: f.content })) });
    const rows = downloadedFiles.map(f => ({ filmstrip_id: filmId, frame_number: f.frameNum, sort_order: f.frameNum, original_url: `https://huggingface.co/datasets/${HF_REPO}/resolve/main/${f.path}`, is_active: true }));
    await sbFetch("frames?on_conflict=filmstrip_id,frame_number", { method: "POST", headers: { "Prefer": "resolution=merge-duplicates" }, body: JSON.stringify(rows) });
    log(`✅ ГОТОВО! Загружено ${downloadedFiles.length} кадров!`);
    await reloadCatalogData(); return filmId;
  } finally { await keepScreenAwake(false); }
}

function openImportModal() { document.getElementById("importUrlInput").value = ""; document.getElementById("importLogBox").classList.add("hidden"); document.getElementById("importModal").classList.remove("hidden"); }
function closeImportModal() { document.getElementById("importModal").classList.add("hidden"); }

async function runImportFromUrl() {
  const url = document.getElementById("importUrlInput").value.trim();
  if (!url.includes("diafilmy.su")) return alert("Введите ссылку на diafilmy.su!");
  const btn = document.getElementById("btnStartImport"), logEl = document.getElementById("importLogBox");
  btn.disabled = true;
  try { const fid = await parseAndImportDiafilmUrl(url, null, logEl); setTimeout(() => { closeImportModal(); openFilm(fid); }, 800); }
  catch (e) { logEl.classList.remove("hidden"); logEl.innerText = `❌ ${e.message}`; }
  finally { btn.disabled = false; }
}

async function downloadOriginalsForCurrentFilm() {
  if (!currentFilm?.original_url) return alert("Нет original_url!");
  try { await parseAndImportDiafilmUrl(currentFilm.original_url, currentFilm.id, null); await openFilm(currentFilm.id); }
  catch (e) { uiLog(`❌ ${e.message}`); }
}

async function refreshSingleFilmMetadata() {
  if (!currentFilm?.original_url) return alert("Нет ссылки на diafilmy.su!");
  try {
    const html = await fetchDiafilmyHtml(currentFilm.original_url, (m) => uiLog(m));
    const { metaPayload } = extractDiafilmyFullMetadata(html, currentFilm.original_url);
    await sbFetch(`filmstrips?id=eq.${currentFilm.id}`, { method: "PATCH", body: JSON.stringify(metaPayload) });
    Object.assign(currentFilm, metaPayload); populateAdminFilmForm(currentFilm); await reloadCatalogData();
    uiLog(`✅ Метаданные "${currentFilm.title}" обновлены!`);
  } catch (e) { uiLog(`❌ ${e.message}`); }
}

async function runBulkMetadataRebuild() {
  const targets = allFilms.filter(f => f.original_url?.includes("diafilmy.su") && (!f.category || !f.film_style || !f.color));
  if (!targets.length) return alert("У всех фильмов уже заполнены метаданные!");
  if (!confirm(`Обновить метаданные для ${targets.length} фильмов?`)) return;
  const logEl = document.getElementById("bulkMetaLog"); logEl.classList.remove("hidden");
  let ok = 0;
  for (let i = 0; i < targets.length; i++) {
    logEl.innerText = `🔄 [${i + 1}/${targets.length}] "${targets[i].title}"...`;
    try { const html = await fetchDiafilmyHtml(targets[i].original_url); const { metaPayload } = extractDiafilmyFullMetadata(html, targets[i].original_url); await sbFetch(`filmstrips?id=eq.${targets[i].id}`, { method: "PATCH", body: JSON.stringify(metaPayload) }); ok++; } catch (e) {}
    await new Promise(r => setTimeout(r, 700));
  }
  await reloadCatalogData(); logEl.innerText = `✅ Обновлено: ${ok}/${targets.length}.`;
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
  try { await sbFetch(`filmstrips?id=eq.${currentFilm.id}`, { method: "PATCH", body: JSON.stringify(payload) }); Object.assign(currentFilm, payload); onFilterChange(); refreshFilmVersionSetsUI(); alert("✅ Сохранено!"); }
  catch (e) { alert("Ошибка: " + e.message); }
}

// =========================================================================
// ЯДРО РЕСТАВРАЦИИ С ГЕНЕРАТОРОМ МОЗАИКИ ТЕКСТУРЫ И ПАЛИТРЫ (БЕЗ ПЕРСОНАЖЕЙ!)
// =========================================================================
function onTargetModeChange() {
  const m = document.getElementById("nbTargetMode").value;
  document.getElementById("customRangeBox").classList.toggle("hidden", m !== "custom_range");
  if (m === "custom_range") document.getElementById("nbFramesCustom").value = String(currentFrameIdx + 1);
  updateCostEstimate();
}

function getTargetFramesForBatch() {
  const mode = document.getElementById("nbTargetMode").value;
  const slot = (document.getElementById("nbVersionSlot").value || "nanolite1").trim();
  const indexed = currentFrames.map((fr, idx) => ({ fr, humanNum: idx + 1 })).filter(x => x.fr.is_active !== false);
  if (mode === "overwrite_all") return indexed;
  if (mode === "only_missing") return indexed.filter(x => !getFrameVersionsInfo(x.fr).availableRestored.some(v => v.type === slot));
  const nums = new Set();
  (document.getElementById("nbFramesCustom").value || "").split(",").forEach(p => {
    p = p.trim();
    if (p.includes("-")) { const [s, e] = p.split("-").map(Number); for (let i = s; i <= e; i++) nums.add(i); }
    else if (!isNaN(parseInt(p))) nums.add(parseInt(p));
  });
  return indexed.filter(x => nums.has(x.humanNum));
}

function getUnitCostUsd() {
  const m = document.getElementById("nbModelSelect")?.value || "gemini-3.1-flash-lite-image";
  const r = document.getElementById("nbResSelect")?.value || "1K";
  return (MODEL_PRICING_USD[m] && MODEL_PRICING_USD[m][r]) || 0.015;
}

function updateCostEstimate() {
  refreshFilmVersionSetsUI();
  const t = getTargetFramesForBatch(), usd = t.length * getUnitCostUsd();
  document.getElementById("costEstimateValue").innerText = `${t.length} кадр. ≈ $${usd.toFixed(2)} (~₪${(usd * USD_TO_ILS).toFixed(2)})`;
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
  const sa = JSON.parse(saJsonStr), pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const bin = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", bin.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const b64u = (s) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const hdr = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const clm = b64u(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${hdr}.${clm}`));
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${hdr}.${clm}.${b64u(String.fromCharCode(...new Uint8Array(sig)))}` });
  const d = await res.json();
  if (!d.access_token) throw new Error("Ошибка GCP: " + JSON.stringify(d));
  cachedTokenObj = { token: d.access_token, projectId: sa.project_id || VERTEX_PROJECT_ID, exp: now + 3500 };
  return cachedTokenObj;
}

function getInputSourceUrlForFrame(fr) {
  const srcMode = document.getElementById("nbInputSourceSelect")?.value || "ORIGINAL";
  const info = getFrameVersionsInfo(fr);
  if (srcMode === "ORIGINAL") return { url: info.originalUrl, fromLabel: "Оригинал" };
  const found = (fr.frame_versions || []).find(v => v.version_type === srcMode);
  return found ? { url: found.image_url, fromLabel: `ИИ:${srcMode}` } : { url: info.originalUrl, fromLabel: "Оригинал(fallback)" };
}

function getDualReferenceUrls(autoChainUrl = null) {
  const cNum = parseInt(document.getElementById("nbRefColorFrame").value);
  const cSrc = document.getElementById("nbRefColorSource")?.value || "RESTORED";
  const fNum = parseInt(document.getElementById("nbRefFaceFrame").value);
  const fSrc = document.getElementById("nbRefFaceSource")?.value || "RESTORED";
  const fWho = (document.getElementById("nbRefFaceWho")?.value || "").trim();

  let refColorUrl = null, refFaceUrl = null;
  if (!isNaN(cNum) && cNum >= 1 && cNum <= currentFrames.length) {
    const cFr = currentFrames[cNum - 1];
    refColorUrl = cSrc === "ORIGINAL" ? getFrameVersionsInfo(cFr).originalUrl : pickBestUrl(cFr, "restored", preferredEngine).url;
  } else if (document.getElementById("nbAutoChainColor").checked && autoChainUrl) {
    refColorUrl = autoChainUrl;
  }
  if (!isNaN(fNum) && fNum >= 1 && fNum <= currentFrames.length) {
    const fFr = currentFrames[fNum - 1];
    refFaceUrl = fSrc === "ORIGINAL" ? getFrameVersionsInfo(fFr).originalUrl : pickBestUrl(fFr, "restored", preferredEngine).url;
  }
  return {
    refColorUrl, refFaceUrl, faceWho: fWho,
    refColorNum: !isNaN(cNum) ? `№${cNum}(${cSrc === 'ORIGINAL' ? 'Ориг' : 'ИИ'})` : (autoChainUrl ? "Авто" : null),
    refFaceNum: !isNaN(fNum) ? `№${fNum}(${fSrc === 'ORIGINAL' ? 'Ориг' : 'ИИ'}${fWho ? ':' + fWho : ''})` : null
  };
}

// Превращает Эталон №1 в чистую мозаику мазков и палитры (разрушает силуэты людей, оставляя 100% цвета, текстуры и насыщенности!)
async function createColorTextureSwatchB64(imgUrl) {
  const r = await fetch(imgUrl);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const blob = await r.blob();
  const objUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const W = 512, H = 384, cols = 8, rows = 6;
        const tw = W / cols, th = (H * 0.75) / rows;
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const ctx = c.getContext("2d");
        const tiles = [];
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) tiles.push({ x, y });
        tiles.sort(() => Math.random() - 0.5);
        // Верхние 75%: перемешанная макро-мозаика мазков кисти и зерна бумаги (без силуэтов!)
        const sx0 = img.width * 0.1, sy0 = img.height * 0.08, sw = img.width * 0.8, sh = img.height * 0.65;
        let idx = 0;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const t = tiles[idx++];
            ctx.save();
            ctx.translate(x * tw + tw / 2, y * th + th / 2);
            if ((x + y) % 2 === 0) ctx.scale(-1, 1);
            ctx.drawImage(img, sx0 + (t.x / cols) * sw, sy0 + (t.y / rows) * sh, sw / cols, sh / rows, -tw / 2, -th / 2, tw, th);
            ctx.restore();
          }
        }
        // Нижние 25%: плавные полосы цветовой гаммы и освещения
        ctx.filter = "blur(14px)";
        ctx.drawImage(img, sx0, sy0, sw, sh, 0, H * 0.75, W, H * 0.25);
        ctx.filter = "none";
        resolve({ b64: c.toDataURL("image/webp", 0.90).split(",")[1], mime: "image/webp" });
      };
      img.onerror = reject;
      img.src = objUrl;
    });
  } finally { URL.revokeObjectURL(objUrl); }
}

function buildPromptForSpecificFrame(fr) {
  const basePrompt = document.getElementById("nbFinalPromptText").value.trim();
  if (!document.getElementById("nbUseFrameCaption")?.checked) return basePrompt;
  const parts = [`Restoring frame from Soviet filmstrip "${currentFilm?.title || ''}".`];
  if (fr.scene_hint?.trim()) parts.push(`SCENE & POSE CLUE: ${fr.scene_hint.trim()}`);
  parts.push(basePrompt);
  if (fr.source_text?.trim()) parts.push(`EXACT VERIFIED RUSSIAN CAPTION TO RENDER AT THE BOTTOM: "${fr.source_text.trim()}"`);
  return parts.join("\n\n");
}

async function callAiRestoreWithRetry(fr, refs, onRetryLog, onBeforeCooldown) {
  const inputSrc = getInputSourceUrlForFrame(fr), modelId = document.getElementById("nbModelSelect").value;
  const resSize = document.getElementById("nbResSelect").value, baseTemp = parseFloat(document.getElementById("nbTempRange").value) || 0.35;
  const promptText = buildPromptForSpecificFrame(fr);
  const toB64 = async (u) => {
    const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const b = await r.blob(), b64 = await new Promise(res => { const rd = new FileReader(); rd.onloadend = () => res(rd.result.split(",")[1]); rd.readAsDataURL(b); });
    return { b64, mime: b.type || "image/webp" };
  };
  const creds = (adminSecrets.gcp_credentials || "").trim();
  if (!creds) { openSecretsModal(); throw new Error("Укажите ключ Gemini/Vertex"); }
  const isVertexJson = creds.startsWith("{");
  const orig = await toB64(inputSrc.url), parts = [];

  if (refs.refColorUrl) {
    try {
      const swatch = await createColorTextureSwatchB64(refs.refColorUrl);
      parts.push({ text: "COLOR PALETTE, SATURATION & BRUSH TEXTURE SWATCH BOARD (Extract ONLY the color harmony, warmth, saturation, paper grain, and painting technique from this abstract texture swatch board):" }, { inlineData: { mimeType: swatch.mime, data: swatch.b64 } });
    } catch (e) {}
  }
  if (refs.refFaceUrl) {
    try {
      const rf = await toB64(refs.refFaceUrl);
      const whoClause = refs.faceWho ? ` specifically for the character "${refs.faceWho}"` : "";
      parts.push({ text: `CHARACTER & FACE IDENTITY REFERENCE${whoClause}: Use this reference ONLY to reconstruct facial features, hair, and clothing details for the matching character already present in the SOURCE FRAME. STRICT COMPOSITION LOCK: Never add extra people from this reference into the source frame.` }, { inlineData: { mimeType: rf.mime, data: rf.b64 } });
    } catch (e) {}
  }
  parts.push({ text: `SOURCE FRAME TO RESTORE (Input: ${inputSrc.fromLabel} — keep 100% of the characters, poses, and composition from this frame):` }, { inlineData: { mimeType: orig.mime, data: orig.b64 } }, { text: promptText });

  let emptyCount = 0;
  for (let attempt = 1; attempt <= 8; attempt++) {
    if (stopBatchRequested) throw new Error("Остановлено");
    const reqBody = { contents: [{ role: "user", parts }], generationConfig: { responseModalities: emptyCount === 0 ? ["IMAGE"] : ["TEXT", "IMAGE"], temperature: emptyCount === 0 ? baseTemp : Math.min(0.65, baseTemp + 0.1), topP: 0.95, imageConfig: { aspectRatio: "4:3", imageSize: resSize } } };
    let apiUrl = "", headers = { "Content-Type": "application/json" };
    if (isVertexJson) {
      const { token, projectId } = await getVertexAccessToken(creds);
      apiUrl = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${modelId}:generateContent`;
      headers["Authorization"] = `Bearer ${token}`;
    } else apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${creds}`;

    const res = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify(reqBody) });
    if (res.status === 429 || res.status === 503) {
      if (onBeforeCooldown) await onBeforeCooldown();
      await sleepWithCountdown(20, `⏸️ Лимит API 429 (попытка ${attempt}/8).`, onRetryLog); continue;
    }
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const json = await res.json(), imgPart = (json?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
    if (!imgPart) { emptyCount++; if (attempt < 8) { await sleepWithCountdown(5, `🔄 Повтор (${attempt}/8)...`, onRetryLog); continue; } throw new Error("Пустой ответ ИИ"); }
    const webpBlob = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").drawImage(img, 0, 0); c.toBlob(b => (b && b.size > 1500) ? resolve(b) : reject(new Error("Битый WebP")), "image/webp", 0.92); };
      img.onerror = reject; img.src = `data:${imgPart.inlineData.mimeType || 'image/png'};base64,${imgPart.inlineData.data}`;
    });
    return { webpBlob, usage: json.usageMetadata || null, finalPromptUsed: promptText, wallet: isVertexJson ? "bonus" : "prepay", inputFrom: inputSrc.fromLabel };
  }
  throw new Error("Превышено время ожидания API");
}

function buildFrameMetaObject(refs, usage, finalPromptUsed, wallet, inputFrom) {
  let unitUsd = getUnitCostUsd();
  const pt = usage?.promptTokenCount || 0, ot = usage?.candidatesTokenCount || 0;
  if (pt > 0) unitUsd += (pt / 1000000) * 0.15;
  const stObj = promptPresets.find(p => p.id === document.getElementById("nbStylePresetSelect")?.value);
  const colObj = promptPresets.find(p => p.id === document.getElementById("nbColorPresetSelect")?.value);
  return { input_source: inputFrom || "Оригинал", model: document.getElementById("nbModelSelect").value, resolution: document.getElementById("nbResSelect").value, temperature: parseFloat(document.getElementById("nbTempRange").value) || 0.35, style_preset: stObj ? stObj.title : "Свой", color_preset: colObj ? colObj.title : "Нет", ref_color: refs.refColorNum || "Нет", ref_face: refs.refFaceNum || "Нет", prompt_tokens: pt, output_tokens: ot, wallet: wallet || "bonus", cost_usd: unitUsd.toFixed(4), cost_ils: (unitUsd * USD_TO_ILS).toFixed(3), date: new Date().toLocaleString("ru-RU"), prompt: finalPromptUsed };
}

async function flushReadyFrames(queue) {
  const validBatch = queue.splice(0, queue.length).filter(x => x?.blob instanceof Blob && x.blob.size > 1500);
  if (!validBatch.length) return 0;
  uiLog(`💾 Выгрузка ${validBatch.length} кадров в набор [${validBatch[0].slot}]...`);
  const { uploadFiles } = await import("https://esm.sh/@huggingface/hub");
  await uploadFiles({ repo: { type: "dataset", name: HF_REPO }, accessToken: adminSecrets.hf_token, commitTitle: `Save ${validBatch.length} frames (${validBatch[0].slot})`, files: validBatch.map(x => ({ path: x.path, content: x.blob })) });
  const ts = Date.now();
  await sbFetch("frame_versions?on_conflict=frame_id,version_type", { method: "POST", headers: { "Prefer": "resolution=merge-duplicates" }, body: JSON.stringify(validBatch.map(x => ({ frame_id: x.fr.id, version_type: x.slot, version_label: x.slot, image_url: `https://huggingface.co/datasets/${HF_REPO}/resolve/main/${x.path}`, meta: x.meta }))) });

  const spentIls = validBatch.reduce((acc, x) => acc + (parseFloat(x.meta.cost_ils) || 0), 0);
  try {
    const bRes = await sbFetch("rpc/admin_spend_wallet", { method: "POST", body: JSON.stringify({ pass_input: adminPassword, spend_ils: Number(spentIls.toFixed(4)), wallet_type: validBatch[0]?.meta?.wallet || "bonus" }) });
    if (bRes?.ok) { adminSecrets.bonus_left_ils = parseFloat(bRes.bonus_left_ils); adminSecrets.prepay_left_ils = parseFloat(bRes.prepay_left_ils); updateBudgetBadge(); }
  } catch (e) {}

  document.getElementById("livePreviewSection").classList.remove("hidden");
  const liveStrip = document.getElementById("livePreviewStrip");
  validBatch.forEach(x => {
    const bustUrl = `https://huggingface.co/datasets/${HF_REPO}/resolve/main/${x.path}?t=${ts}`;
    const ex = x.fr.frame_versions.find(v => v.version_type === x.slot);
    if (ex) { ex.image_url = bustUrl; ex.meta = x.meta; } else x.fr.frame_versions.push({ version_type: x.slot, version_label: x.slot, image_url: bustUrl, meta: x.meta });
    const card = document.createElement("div");
    card.className = "flex-shrink-0 w-24 cursor-pointer rounded-lg overflow-hidden border border-emerald-500/60 bg-black";
    card.onclick = () => { currentFrameIdx = x.humanNum - 1; preferredEngine = x.slot; setViewMode("restored"); };
    card.innerHTML = `<div class="frame-aspect"><img src="${bustUrl}" class="w-full h-full object-cover" /></div><div class="text-[10px] text-center py-0.5 text-emerald-300 font-mono">№${x.humanNum} (${x.slot})</div>`;
    liveStrip.prepend(card);
  });
  preferredEngine = validBatch[0].slot; updatePlayerFrame(); renderThumbsGrid(); updateCostEstimate();
  return validBatch.length;
}

function getRepoFolderForSlot(slot) {
  if (slot === "nanobanana") return `nanobanana_paid/${currentFilm.id}`;
  if (slot === "flux2") return `flux2/${currentFilm.id}`;
  return `restored/${currentFilm.id}/${toSlug(slot)}`;
}

async function restoreSingleCurrentFrame() {
  if (!isAdmin || !currentFrames.length || !currentFilm) return;
  if (!adminSecrets.hf_token) return openSecretsModal();
  const fr = currentFrames[currentFrameIdx], humanNum = currentFrameIdx + 1, slot = (document.getElementById("nbVersionSlot").value || "nanolite1").trim();
  fr.source_text = document.getElementById("editFrameSourceText")?.value.trim() || fr.source_text;
  fr.scene_hint = document.getElementById("editFrameSceneHint")?.value.trim() || fr.scene_hint;
  const refs = getDualReferenceUrls(null);
  stopBatchRequested = false;
  uiLog(`⏳ Реставрирую кадр №${humanNum} -> в набор [${slot}]...`);
  await keepScreenAwake(true);
  try {
    const { webpBlob, usage, finalPromptUsed, wallet, inputFrom } = await callAiRestoreWithRetry(fr, refs, (m) => uiLog(`🍌 Кадр №${humanNum}: ${m}`), null);
    const path = `${getRepoFolderForSlot(slot)}/f_${String(fr.frame_number).padStart(3, "0")}.webp`;
    const meta = buildFrameMetaObject(refs, usage, finalPromptUsed, wallet, inputFrom);
    await flushReadyFrames([{ fr, humanNum, slot, path, blob: webpBlob, meta }]);
    setViewMode("restored"); uiLog(`✅ Кадр №${humanNum} сохранен в набор [${slot}]! (Исходник: ${inputFrom}, ~₪${meta.cost_ils})`);
  } catch (e) { uiLog(`❌ Кадр №${humanNum}: ${e.message}`); } finally { await keepScreenAwake(false); }
}

async function runBatchRestoration() {
  if (!isAdmin || !currentFrames.length || !currentFilm) return;
  if (!adminSecrets.hf_token) return openSecretsModal();
  const targetItems = getTargetFramesForBatch();
  if (!targetItems.length) return alert("В целевом наборе все эти кадры уже есть! Выберите режим '🔄 Все кадры' или другой набор.");
  const slot = (document.getElementById("nbVersionSlot").value || "nanolite1").trim();
  const btn = document.getElementById("btnBatchRestore"), stopBtn = document.getElementById("btnStopBatch");
  btn.disabled = true; stopBtn.classList.remove("hidden"); stopBatchRequested = false;
  await keepScreenAwake(true);
  const pendingQueue = []; let totalSaved = 0, autoChainAnchorUrl = null;
  try {
    for (let i = 0; i < targetItems.length; i++) {
      if (stopBatchRequested) break;
      const { fr, humanNum } = targetItems[i], refs = getDualReferenceUrls(autoChainAnchorUrl);
      uiLog(`🍌 Кадр №${humanNum} (${i + 1}/${targetItems.length}) -> в набор [${slot}] | Сохранено: ${totalSaved} 🟢...`);
      try {
        const { webpBlob, usage, finalPromptUsed, wallet, inputFrom } = await callAiRestoreWithRetry(fr, refs, (m) => uiLog(`🍌 Кадр №${humanNum}\n${m}`), async () => { totalSaved += await flushReadyFrames(pendingQueue); });
        if (webpBlob && !stopBatchRequested) {
          const path = `${getRepoFolderForSlot(slot)}/f_${String(fr.frame_number).padStart(3, "0")}.webp`;
          pendingQueue.push({ fr, humanNum, slot, path, blob: webpBlob, meta: buildFrameMetaObject(refs, usage, finalPromptUsed, wallet, inputFrom) });
          if (pendingQueue.length >= 2) {
            totalSaved += await flushReadyFrames(pendingQueue);
            if (!autoChainAnchorUrl && humanNum >= 3) autoChainAnchorUrl = pickBestUrl(fr, "restored", slot).url;
          }
        }
      } catch (e) { if (stopBatchRequested) break; uiLog(`❌ Кадр №${humanNum}: ${e.message}`); }
      if (!stopBatchRequested && i < targetItems.length - 1) await sleepWithCountdown(4, `✅ Кадр №${humanNum} готов!`, (m) => uiLog(m));
    }
    if (pendingQueue.length > 0) totalSaved += await flushReadyFrames(pendingQueue);
    if (totalSaved > 0) { await sbFetch(`filmstrips?id=eq.${currentFilm.id}`, { method: "PATCH", body: JSON.stringify({ status: "restored_paid" }) }); currentFilm.status = "restored_paid"; await reloadCatalogData(); }
    uiLog(`🏁 ГОТОВО! Сохранено в набор [${slot}]: ${totalSaved} шт.`);
  } catch (e) { uiLog(`❌ ${e.message}`); } finally { btn.disabled = false; stopBtn.classList.add("hidden"); await keepScreenAwake(false); }
}

async function setCurrentFrameAsCover() {
  if (!isAdmin || !currentFrames.length || !currentFilm) return;
  const fr = currentFrames[currentFrameIdx], picked = pickBestUrl(fr, "restored", preferredEngine);
  const newExtra = { ...(currentFilm.extra_data || {}), cover_frame: fr.frame_number };
  try { await sbFetch(`filmstrips?id=eq.${currentFilm.id}`, { method: "PATCH", body: JSON.stringify({ extra_data: newExtra }) }); currentFilm.extra_data = newExtra; filmStatsMap[currentFilm.id].coverUrl = picked.url; renderCatalog(); uiLog(`✅ Кадр №${currentFrameIdx + 1} сделан обложкой!`); }
  catch (e) { uiLog(`❌ ${e.message}`); }
}

async function toggleCurrentFrameActive() {
  if (!isAdmin || !currentFrames.length) return;
  const fr = currentFrames[currentFrameIdx], nextVal = fr.is_active === false ? true : false;
  try { await sbFetch(`frames?id=eq.${fr.id}`, { method: "PATCH", body: JSON.stringify({ is_active: nextVal }) }); fr.is_active = nextVal; updatePlayerFrame(); renderThumbsGrid(); }
  catch (e) { uiLog(`❌ ${e.message}`); }
}

async function resetCurrentFilmRestorations() {
  const slot = (document.getElementById("nbVersionSlot").value || "nanobanana").trim();
  if (!currentFilm || !confirm(`Удалить набор [${slot}] для "${currentFilm.title}"?`)) return;
  try { const ids = currentFrames.map(x => x.id).join(","); if (ids) await sbFetch(`frame_versions?frame_id=in.(${ids})&version_type=eq.${encodeURIComponent(slot)}`, { method: "DELETE" }); await openFilm(currentFilm.id); await reloadCatalogData(); uiLog(`✅ Набор [${slot}] удален!`); }
  catch (e) { uiLog(`❌ ${e.message}`); }
}

function openCleanupModal() {
  const restoredFilms = allFilms.filter(f => filmStatsMap[f.id]?.hasRestored);
  document.getElementById("cleanupList").innerHTML = restoredFilms.map(f => `<label class="flex items-center gap-3 p-2 rounded-xl bg-[#16110d] border border-[#33271d] cursor-pointer"><input type="checkbox" class="cleanup-keep-cb w-4 h-4 accent-[#d99b26]" value="${f.id}" checked /><div class="flex-1 text-xs"><div class="font-semibold text-[#f3ece2]">${f.title}</div></div></label>`).join("");
  document.getElementById("cleanupModal").classList.remove("hidden");
}
function closeCleanupModal() { document.getElementById("cleanupModal").classList.add("hidden"); }
function toggleAllCleanupChecks(val) { document.querySelectorAll(".cleanup-keep-cb").forEach(cb => cb.checked = val); }

async function executeShowcaseCleanup() {
  const keepIds = new Set(Array.from(document.querySelectorAll(".cleanup-keep-cb:checked")).map(cb => cb.value));
  if (!confirm(`Оставить ИИ только у выбранных (${keepIds.size} шт.)?`)) return;
  const btn = document.getElementById("btnExecCleanup"); btn.disabled = true;
  try {
    for (const f of allFilms.filter(x => !keepIds.has(x.id) && x.status !== "pending")) {
      const frs = await sbFetch(`frames?filmstrip_id=eq.${f.id}&select=id`);
      if (frs.length > 0) { await sbFetch(`frame_versions?frame_id=in.(${frs.map(x => x.id).join(",")})`, { method: "DELETE" }); await sbFetch(`filmstrips?id=eq.${f.id}`, { method: "PATCH", body: JSON.stringify({ status: "downloaded" }) }); }
    }
    await reloadCatalogData(); closeCleanupModal(); alert(`✅ Готово!`);
  } catch (e) { alert("Ошибка: " + e.message); } finally { btn.disabled = false; }
}
