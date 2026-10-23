const api = window.coursebridge;
CourseBridgeIcons.hydrate();
const $ = (selector) => document.querySelector(selector);
const labels = {
  overview: "学习总览",
  settings: "任务设置",
  bank: "我的题库",
  extension: "浏览器连接",
  logs: "活动记录",
};
let initialized = false;
let toastTimer;
let bankRevision = -1;
let bankFilter = "all";
let bankOffset = 0;
let bankRequest = 0;
let bankViewKey = "";
const expandedQuestions = new Set();
let editingQuestion;
let enncyDirty = false;
let enncyBusy = false;
let enncyState;
let deepseekDirty = false;
let deepseekBusy = false;
let deepseekState;
const strategyLabels = { local: "本地题库", enncy: "本地 → 言溪", deepseek: "本地 → DeepSeek", "enncy-deepseek": "本地 → 言溪 → DeepSeek" };
function renderRouting(state) {
  const mode = state.settings.lookupMode || "enncy-deepseek";
  $("#lookupMode").value = mode;
  $("#saveOnlineAnswers").checked = state.settings.saveOnlineAnswers !== false;
  $("#routing-summary").textContent = strategyLabels[mode] + (state.settings.saveOnlineAnswers !== false ? " · 在线答案自动存回，标记未核验" : " · 在线答案不自动保存");
  const warnings = [];
  if (["enncy", "enncy-deepseek"].includes(mode) && !state.enncy?.enabled) warnings.push("言溪未启用");
  if (["deepseek", "enncy-deepseek"].includes(mode) && !state.deepseek?.enabled) warnings.push("DeepSeek 未启用");
  $("#routing-warning").textContent = warnings.length ? warnings.join("；") + "。缺题时只会使用已启用的来源。" : "";
  $("#routing-warning").hidden = !warnings.length;
  $("#online-overview").textContent = strategyLabels[mode];
}
function renderDeepSeek(value = {}) {
  deepseekState = value;
  $("#deepseek-status").textContent = !value.configured ? "未配置" : !value.enabled ? "已关闭" : value.active === false ? "策略未使用" : value.error ? "需检查" : "已启用";
  $("#deepseek-status").classList.toggle("accent-chip", !!value.enabled && value.active !== false && !value.error);
  $("#deepseek-balance").textContent = value.balances?.length ? value.balances.map(item => `${item.currency === "CNY" ? "¥" : "$"}${item.total}`).join(" / ") : "—";
  $("#deepseek-updated").textContent = value.updatedAt ? `更新于 ${new Date(value.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })} · 以官方账户为准` : "配置后读取官方账户余额";
  $("#deepseek-usage").textContent = `按 Token 计费；本次请求 ${value.sessionRequests || 0} 次，已返回 ${(value.sessionTokens || 0).toLocaleString()} Token。`;
  if (!deepseekDirty) { $("#deepseek-enabled").checked = value.enabled === true; $("#deepseek-model").value = value.model || "deepseek-flash"; }
  $("#deepseek-key").placeholder = value.configured ? "API Key 已保存；留空保留，输入替换" : "在 DeepSeek 官方平台创建并粘贴";
  $("#deepseek-save").disabled = deepseekBusy;
  $("#deepseek-clear").disabled = !value.configured || deepseekBusy;
  $("#deepseek-refresh").disabled = !value.configured || value.refreshing || deepseekBusy;
  $("#deepseek-refresh").textContent = value.refreshing ? "刷新中…" : "刷新余额";
  $("#deepseek-retry").disabled = !value.enabled || value.active === false || deepseekBusy;
  $("#deepseek-storage").textContent = value.configured && !value.persisted ? "系统加密不可用，API Key 仅供本次运行，退出后重新填写。" : "API Key 由系统加密保存在本机，不发送给课程网页，不随题库导出。";
  $("#deepseek-message").textContent = value.error || (!value.configured ? "尚未配置 DeepSeek" : !value.enabled ? "DeepSeek 已关闭" : value.active === false ? "当前查题策略不使用 DeepSeek" : value.pending ? `DeepSeek 分析中 · ${value.pending} 道题目等待结果` : value.lastResult || "等待策略分配缺题；需开启自动填写并开始任务");
}
function renderEnncy(value = {}) {
  enncyState = value;
  $("#enncy-remaining").textContent = value.remaining == null ? "—" : `${value.remaining.toLocaleString()} 次`;
  $("#enncy-status").textContent = !value.configured ? "未配置" : !value.enabled ? "已关闭" : value.active === false ? "策略未使用" : value.error ? "需检查" : value.remaining === 0 ? "额度为 0" : "已启用";
  $("#enncy-status").classList.toggle("accent-chip", !!value.enabled && value.active !== false && !value.error && value.remaining !== 0);
  if (!enncyDirty) $("#enncy-enabled").checked = value.enabled === true;
  $("#enncy-token").placeholder = value.configured ? "凭证已保存；留空则保留，输入可替换" : "在言溪个人中心获取，粘贴到这里";
  $("#enncy-clear").disabled = !value.configured || enncyBusy;
  $("#enncy-save").disabled = enncyBusy;
  $("#enncy-refresh").disabled = !value.configured || value.refreshing || enncyBusy;
  $("#enncy-refresh").textContent = value.refreshing ? "刷新中…" : "刷新额度";
  $("#enncy-retry").disabled = !value.enabled || value.active === false || enncyBusy;
  $("#enncy-updated").textContent = value.updatedAt
    ? `更新于 ${new Date(value.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })} · 以言溪返回的额度为准`
    : "填写凭证后获取，以言溪返回的额度为准";
  const stats = [];
  if (value.used != null) stats.push(`账户累计查询 ${value.used.toLocaleString()} 次`);
  if (value.succeeded != null) stats.push(`查询成功 ${value.succeeded.toLocaleString()} 次`);
  $("#enncy-stats").textContent = (stats.length ? stats.join(" · ") + "。" : "") + "启用期间每 60 秒刷新，查题返回后立即更新剩余次数。";
  $("#enncy-storage").textContent = value.configured && !value.persisted
    ? "当前系统加密不可用，凭证仅供本次运行使用，退出后需重新填写。"
    : "凭证由系统加密，仅保存在这台电脑；不发送给课程网页，不随题库备份导出。";
  $("#enncy-message").textContent = value.error || (!value.configured ? "尚未配置在线题库" : !value.enabled ? "在线查题已关闭，本地题库仍可使用" : value.active === false ? "当前查题策略不使用言溪" : value.pending ? `言溪查题中 · ${value.pending} 道题目等待结果` : value.lastResult || (value.remaining === 0 ? "言溪剩余次数为 0，请到官网查看额度" : "等待缺答案的题目；还需在任务设置中开启自动填写并开始任务"));
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3000);
}
function navigate(page) {
  for (const element of document.querySelectorAll(".page"))
    element.classList.toggle("active", element.id === page);
  for (const element of document.querySelectorAll("nav button")) {
    element.classList.toggle("active", element.dataset.page === page);
    if (element.dataset.page === page)
      element.setAttribute("aria-current", "page");
    else element.removeAttribute("aria-current");
  }
  $("#page-title").textContent = labels[page];
  if (page === "bank") loadBank();
  window.scrollTo(0, 0);
}
for (const button of document.querySelectorAll("[data-page], [data-go]"))
  button.onclick = () => navigate(button.dataset.page || button.dataset.go);
function showBankView(name, focus = false) {
  for (const tab of document.querySelectorAll("[data-bank-view]")) {
    const selected = tab.dataset.bankView === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`#bank-${tab.dataset.bankView}`).hidden = !selected;
    if (selected && focus) tab.focus();
  }
}
for (const tab of document.querySelectorAll("[data-bank-view]")) {
  tab.onclick = () => showBankView(tab.dataset.bankView);
  tab.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    showBankView(event.key === "Home" ? "local" : event.key === "End" ? "services" : tab.dataset.bankView === "local" ? "services" : "local", true);
  };
}
$("#online-overview").onclick = () => { navigate("bank"); showBankView("services"); };
$("#collapse-questions").onclick = () => {
  expandedQuestions.clear();
  for (const row of document.querySelectorAll(".library-row")) row.open = false;
};
$("#question-collection").addEventListener("toggle", () => {
  $(".collection-hint").textContent = $("#question-collection").open ? "收起列表" : "展开查看";
});
function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
function render(state) {
  const summary = CourseBridgeSessions.summarizeSessions(
    state.frames,
    state.settings.enabled,
  );
  const settings = state.settings;
  const enabled = settings.enabled;
  renderEnncy(state.enncy);
  renderDeepSeek(state.deepseek);
  renderRouting(state);
  for (const id of ["power-summary", "power-status"])
    $(`#${id}`).textContent = state.power?.message || "仅插电且任务运行时生效";
  const working = summary.some(
    (item) => item.media || item.questions || item.assessment,
  );
  $("#course-count").replaceChildren(
    document.createTextNode(`${summary.length} `),
    textElement("small", "个页面"),
  );
  $("#bank-count").replaceChildren(
    document.createTextNode(
      `${(state.bankCount + (state.offlineBankCount || 0)).toLocaleString()} `,
    ),
    textElement("small", state.offlineBankCount ? "条记录" : "道题目"),
  );
  $("#bank-summary-note").textContent = state.offlineBankCount
    ? `本地可匹配 ${state.bankCount} 道 · 未核验 ${state.unreviewedCount || 0} 道 · 离线库已加载`
    : `本地可匹配 ${state.bankCount} 道 · 在线未核验 ${state.unreviewedCount || 0} 道`;
  $("#bank-total").textContent = `${state.bankCount} 道题目`;
  $("#bank-inbox-count").textContent = `${state.pendingCount || 0} 道待补充`;
  $("#collectQuestions").checked = settings.collectQuestions !== false;
  $("#offline-bank-count").textContent = state.offlineBankCount
    ? `${state.offlineBankCount.toLocaleString()} 条含答案记录`
    : "尚未加载";
  $("#useOfflineBank").checked = settings.useOfflineBank === true;
  $("#useOfflineBank").disabled = !state.offlineBankCount;
  if (
    $("#bank").classList.contains("active") &&
    bankRevision !== state.libraryRevision
  )
    loadBank();
  if (state.browser) {
    const browser = state.browser;
    $("#browser-status").textContent =
      browser.status + (browser.version ? ` · ${browser.version}` : "");
    $("#browser-badge").textContent = browser.updatePending
      ? "待更新"
      : browser.running
        ? "已连接"
        : browser.status.startsWith("正在")
          ? "正在打开"
          : "未打开";
    $("#browser-badge").classList.toggle("accent-chip", browser.running);
    for (const id of ["open-learning", "open-browser-2", "open-browser-3"])
      $(`#${id}`).disabled = browser.status.startsWith("正在");
  }
  $("#task-state").textContent = enabled
    ? working
      ? "运行中"
      : "等待内容"
    : "已暂停";
  $("#task-state").classList.toggle("task-active", enabled);
  $("#task-note").textContent = enabled
    ? working
      ? "正在与课程页面同步"
      : "请进入具体章节，等待识别课程内容"
    : "准备好后，开始本次任务";
  $("#connection-note").textContent = summary.length
    ? "浏览器插件已连接"
    : "打开课程浏览器后自动连接";
  $("#session-count").textContent = summary.length
    ? `${summary.length} 个页面已连接`
    : "暂无连接";
  $("#course-empty").hidden = summary.length > 0;
  $("#sessions").hidden = summary.length === 0;
  $("#sessions").replaceChildren(
    ...summary.map((frame) => {
      const element = document.createElement("div");
      element.className = "session";
      const top = document.createElement("div");
      top.className = "session-top";
      const icon = textElement("span", "", "session-icon");
      icon.innerHTML = CourseBridgeIcons.svg(
        frame.assessment ? "book" : frame.media ? "play" : "browser",
      );
      icon.setAttribute("aria-hidden", "true");
      const content = document.createElement("div");
      content.className = "session-content";
      const chapter = String(frame.chapter || "")
        .replace(/\s+/g, " ")
        .replace(/\s+\d+个待完成任务点.*$/, "")
        .trim();
      content.append(textElement("h3", chapter || frame.title));
      const status = document.createElement("p");
      status.className = "session-status";
      const dot = document.createElement("span");
      dot.className = "dot";
      status.append(dot, document.createTextNode(frame.status));
      content.append(status);
      const parts = [];
      if (chapter && frame.title !== chapter) parts.push(frame.title);
      if (frame.media) parts.push(`${frame.media} 个音视频`);
      if (frame.questions) parts.push(`${frame.questions} 道题目`);
      if (frame.legacy) parts.push("旧版插件，请重新加载并刷新课程页");
      if (parts.length) content.append(textElement("small", parts.join(" · ")));
      if (frame.media || frame.assessment) {
        const flow = textElement("div", "", "session-flow");
        flow.setAttribute(
          "aria-label",
          frame.assessment ? "当前环节：章节测验" : "当前环节：课程视频",
        );
        for (const [index, label] of [
          "课程视频",
          "章节测验",
          "下一课时",
        ].entries()) {
          if (index) {
            const arrow = textElement("span", "", "flow-arrow");
            arrow.innerHTML = CourseBridgeIcons.svg("chevron");
            flow.append(arrow);
          }
          const step = textElement("span", label, "flow-step");
          if (index === (frame.assessment ? 1 : 0))
            step.classList.add("current");
          flow.append(step);
        }
        content.append(flow);
      }
      top.append(icon, content);
      element.append(top);
      return element;
    }),
  );
  $("#start").disabled = enabled;
  $("#pause").disabled = !enabled;
  $("#next").disabled = !summary.length;
  $("#action-hint").textContent = enabled
    ? "任务正在运行，需要时可随时暂停"
    : summary.length
      ? "点击开始任务，继续处理当前课程"
      : "进入课程后，点击开始任务";
  $("#runtime-settings").replaceChildren(
    ...[
      `${settings.playbackRate} ×`,
      settings.muted ? "静音播放" : "有声播放",
      settings.autoNext ? "自动下一步" : "手动切换",
    ].map((text) => textElement("span", text)),
  );
  $("#answer-mode").textContent =
    (settings.autoAnswer
      ? settings.autoSubmit
        ? "匹配后填写并提交，确认成功后继续"
        : "匹配后填写，等待你提交"
      : "自动填写未开启") +
    (settings.skipUnanswered
      ? "；无法答题时保留测验并继续"
      : "；无法答题时等待处理");
  const rows = state.logs.map((log) => {
    const row = document.createElement("div");
    row.className = "log-row";
    row.dataset.level = log.level || "info";
    row.append(
      textElement(
        "time",
        new Date(log.time).toLocaleTimeString("zh-CN", { hour12: false }),
      ),
      textElement("p", log.message),
    );
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "log-empty";
    empty.append(
      textElement("h3", "还没有活动记录"),
      textElement("p", "开始任务后，连接和操作记录会显示在这里。"),
    );
    rows.push(empty);
  }
  $("#log-list").replaceChildren(...rows);
  const recent = state.logs.slice(0, 3).map((log) => {
    const row = textElement("div", "", "recent-row");
    row.append(
      textElement(
        "time",
        new Date(log.time).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      ),
      textElement("p", log.message),
    );
    return row;
  });
  $("#recent-list").replaceChildren(
    ...(recent.length
      ? recent
      : [
          textElement(
            "p",
            "任务启动后，操作记录会显示在这里。",
            "recent-empty",
          ),
        ]),
  );
  if (!initialized) {
    for (const key of [
      "autoNext",
      "muted",
      "autoAnswer",
      "autoSubmit",
      "skipUnanswered",
      "keepAwake",
    ])
      $(`#${key}`).checked = settings[key];
    for (const key of ["playbackRate", "nextDelay"])
      $(`#${key}`).value = settings[key];
    $("#major").value = settings.major || "";
    initialized = true;
  }
}
async function act(fn, message) {
  try {
    const result = await fn();
    if (result?.settings) render(result);
    if (message) toast(message);
    return result;
  } catch (error) {
    toast(
      error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      ),
    );
    return null;
  }
}
for (const action of ["start", "pause", "next"])
  $(`#${action}`).onclick = () =>
    act(
      () => api.control(action),
      action === "next"
        ? "已请求下一步"
        : action === "start"
          ? "任务已开始"
          : "任务已暂停",
    );
$("#copy-token").onclick = () => act(() => api.copyToken(), "配对码已复制");
$("#open-extension").onclick = () => act(() => api.openExtension());
for (const id of ["open-learning", "open-browser-2", "open-browser-3"])
  $(`#${id}`).onclick = () =>
    act(() => api.openLearning(), "课程浏览器已打开，插件已自动配对");
$("#import-bank").onclick = async () => {
  const result = await act(() => api.importBank());
  if (result) {
    bankOffset = 0;
    await loadBank();
    toast("已合并导入，原有题目已保留");
  }
};
$("#export-bank").onclick = async () => {
  if (await act(() => api.exportBank())) toast("题库备份已保存");
};
$("#collectQuestions").onchange = () =>
  act(
    () => api.settings({ collectQuestions: $("#collectQuestions").checked }),
    "题目收集设置已保存",
  );
$("#useOfflineBank").onchange = () =>
  act(
    () => api.settings({ useOfflineBank: $("#useOfflineBank").checked }),
    "离线题库匹配设置已保存",
  );
for (const id of ["enncy-token", "enncy-enabled"])
  $(`#${id}`).addEventListener("input", () => {
    enncyDirty = true;
    $("#enncy-save-note").textContent = "有未保存的修改，保存后生效";
  });
$("#enncy-form").onsubmit = async event => {
  event.preventDefault();
  if (enncyBusy) return;
  enncyBusy = true;
  renderEnncy(enncyState);
  try {
    const value = $("#enncy-token").value.trim();
    const result = await api.configureEnncy({ enabled: $("#enncy-enabled").checked, ...(value ? { token: value } : {}) });
    $("#enncy-token").value = "";
    enncyDirty = false;
    render(result);
    $("#enncy-save-note").textContent = result.enncy.error ? "设置已保存，账户验证未成功" : "设置已保存";
    toast(result.enncy.error || "言溪题库设置已保存");
  } catch (error) {
    toast(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ""));
  } finally { enncyBusy = false; renderEnncy(enncyState); }
};
$("#enncy-clear").onclick = async () => {
  const result = await act(() => api.configureEnncy({ clear: true, enabled: false }));
  if (result) {
    enncyDirty = false;
    $("#enncy-token").value = "";
    render(result);
    $("#enncy-save-note").textContent = "凭证已清除，在线查题已关闭";
  }
};
$("#enncy-refresh").onclick = async () => {
  if (enncyBusy) return;
  enncyBusy = true; renderEnncy(enncyState);
  try { await act(() => api.refreshEnncy()); }
  finally { enncyBusy = false; renderEnncy(enncyState); }
};
$("#enncy-retry").onclick = () => act(() => api.retryEnncy(), "已允许重新查题，可能消耗言溪额度");
$("#enncy-website").onclick = () => act(() => api.openEnncy("website"));
$("#enncy-account").onclick = () => act(() => api.openEnncy("account"));
$("#enncy-docs").onclick = () => act(() => api.openEnncy("docs"));
$("#lookupMode").onchange = () => act(() => api.settings({ lookupMode: $("#lookupMode").value }), "查题策略已保存");
$("#saveOnlineAnswers").onchange = () => act(() => api.settings({ saveOnlineAnswers: $("#saveOnlineAnswers").checked }), "在线答案保存设置已更新");
for (const id of ["deepseek-key", "deepseek-model", "deepseek-enabled"]) $(`#${id}`).addEventListener("input", () => { deepseekDirty = true; $("#deepseek-save-note").textContent = "有未保存的修改，保存后生效"; });
$("#deepseek-form").onsubmit = async event => {
  event.preventDefault(); if (deepseekBusy) return;
  deepseekBusy = true; renderDeepSeek(deepseekState);
  try {
    const value = $("#deepseek-key").value.trim();
    const result = await api.configureDeepSeek({ enabled: $("#deepseek-enabled").checked, model: $("#deepseek-model").value, ...(value ? { apiKey: value } : {}) });
    $("#deepseek-key").value = ""; deepseekDirty = false; render(result);
    $("#deepseek-save-note").textContent = result.deepseek.error ? "设置已保存，账户验证未成功" : "已保存并读取账户信息，未调用答题接口";
    toast(result.deepseek.error || "DeepSeek 设置已保存");
  } catch (error) { toast(error.message.replace(/^Error invoking remote method '[^']+': Error: /, "")); }
  finally { deepseekBusy = false; renderDeepSeek(deepseekState); }
};
$("#deepseek-clear").onclick = async () => {
  const result = await act(() => api.configureDeepSeek({ clear: true, enabled: false }));
  if (result) { deepseekDirty = false; $("#deepseek-key").value = ""; render(result); $("#deepseek-save-note").textContent = "API Key 已清除，DeepSeek 已关闭"; }
};
$("#deepseek-refresh").onclick = async () => {
  if (deepseekBusy) return; deepseekBusy = true; renderDeepSeek(deepseekState);
  try { await act(() => api.refreshDeepSeek()); }
  finally { deepseekBusy = false; renderDeepSeek(deepseekState); }
};
$("#deepseek-retry").onclick = () => act(() => api.retryDeepSeek(), "已允许重新分析，可能产生 DeepSeek API 费用");
$("#deepseek-account").onclick = () => act(() => api.openDeepSeek("account"));
$("#deepseek-keys").onclick = () => act(() => api.openDeepSeek("keys"));
$("#deepseek-docs").onclick = () => act(() => api.openDeepSeek("docs"));
async function loadBank() {
  if (!api.listBank) return;
  const request = ++bankRequest;
  try {
    const query = {
      search: $("#bank-search").value,
      filter: bankFilter,
      offset: bankOffset,
    };
    const result =
      bankFilter === "offline"
        ? await api.searchOffline(query)
        : await api.listBank(query);
    if (request !== bankRequest) return;
    bankRevision = result.libraryRevision;
    $("#bank-result-count").textContent = `共 ${result.total} 道 · 每页 30 道`;
    $("#bank-prev").disabled = bankOffset === 0;
    $("#bank-next").disabled = bankOffset + 30 >= result.total;
    const viewKey = JSON.stringify(query);
    if (viewKey !== bankViewKey) expandedQuestions.clear();
    bankViewKey = viewKey;
    $("#collection-count").textContent = result.total
      ? `共 ${result.total.toLocaleString()} 道 · 题干、选项与答案`
      : bankFilter === "offline" ? "输入关键词搜索离线参考库" : "暂无题目，可新建或导入";
    // Retain disclosure state through the background refresh; new queries start collapsed.
    const focusedRow = document.activeElement?.closest(".library-row");
    const focusedKey = focusedRow?.dataset.questionKey;
    const focusedEdit = focusedRow && document.activeElement?.tagName === "BUTTON";
    const rows = result.entries.map((item) => {
      const row = document.createElement("details");
      row.className = "library-row";
      const key = String(item.id || JSON.stringify([item.question, item.options]));
      row.dataset.questionKey = key;
      row.open = expandedQuestions.has(key);
      row.addEventListener("toggle", () => {
        if (!row.isConnected) return;
        if (row.open) expandedQuestions.add(key);
        else expandedQuestions.delete(key);
      });
      const summary = document.createElement("summary");
      const arrow = textElement("span", "", "disclosure-arrow");
      arrow.innerHTML = CourseBridgeIcons.svg("chevron");
      const heading = textElement("span", item.question, "question-heading");
      const status = textElement("span",
        item.reference ? "参考答案" : item.conflict ? "需核对"
          : item.answers.length && item.reviewed === false
            ? item.aiGenerated ? "AI 参考 · 未核验" : "在线参考 · 未核验"
          : item.verified ? "可匹配" : "待补充", "chip");
      summary.append(arrow, heading, status);
      const content = document.createElement("div");
      content.className = "library-content";
      content.append(
        textElement(
          "small",
          `${({ blank: "填空", short: "简答", essay: "论述" })[item.type] || (item.multiple ? "多选" : "单选")} · ${item.source || "本地题目"}`,
        ),
      );
      if (item.options?.length) {
        const options = document.createElement("ol");
        options.className = "question-options";
        options.type = "A";
        for (const option of item.options) options.append(textElement("li", option));
        content.append(options);
      }
      if (item.answers.length)
        content.append(textElement("p", `答案：${item.answers.join("；")}`));
      else content.append(textElement("p", "答案待补充", "answer-pending"));
      const side = document.createElement("div");
      side.className = "library-row-actions";
      const edit = textElement(
        "button",
        item.reference ? "核对并存入" : item.answers.length && item.reviewed === false ? "核对答案" : item.verified ? "编辑" : "补充答案",
        "text-button",
      );
      edit.onclick = () => openEditor(item);
      side.append(edit);
      content.append(side);
      row.append(summary, content);
      return row;
    });
    if (!rows.length)
      rows.push(
        textElement(
          "p",
          bankFilter === "offline" && $("#bank-search").value.trim().length < 2
            ? "输入至少两个字，在离线参考库中搜索。"
            : $("#bank-search").value
              ? "没有找到匹配的题目。"
              : "这里还没有题目。打开章节测验收集，或手动新建、导入。",
          "library-empty",
        ),
      );
    $("#bank-list").replaceChildren(...rows);
    if (focusedKey) {
      const restored = rows.find(row => row.dataset.questionKey === focusedKey);
      restored?.querySelector(focusedEdit ? "button" : "summary")?.focus({ preventScroll: true });
    }
  } catch (error) {
    toast(`读取题库失败：${error.message}`);
  }
}
function openEditor(item) {
  editingQuestion = item;
  $("#editor-title").textContent = item ? "补充题目与答案" : "新建本地题目";
  $("#editor-source").textContent = item
    ? `来源：${item.source}`
    : "先保存题目，之后也可以再补充答案。";
  $("#question-text").value = item?.question || "";
  $("#question-options").value = (item?.options || []).join("\n");
  $("#question-answers").value = (item?.answers || []).join("\n");
  $("#question-type").value = item?.type || (item?.multiple ? "multiple" : "single");
  updateEditorType();
  $("#editor-error").textContent = "";
  $("#reference-note").textContent = item?.reference
    ? "这道题来自公开参考库，请核对答案后再存入个人题库。"
    : item?.answers.length && item.reviewed === false ? "这是自动保存的在线参考答案，尚未经人工核验。检查或修改后保存，将标记为已核对。" : "";
  $("#save-question").textContent = item?.answers.length && item.reviewed === false ? "核对并保存" : "保存题目";
  $("#editor-conflict").hidden = !item?.conflict;
  $("#editor-conflict").textContent = item?.conflict
    ? `导入了不同答案，请核对后保存。候选：${(item.answerVariants || []).map((value) => value.join("；")).join(" / ")}`
    : "";
  $("#question-editor").showModal();
}
$("#new-question").onclick = () => openEditor();
function updateEditorType() {
  const type = $("#question-type").value, text = ["blank", "short", "essay"].includes(type);
  $("#question-options").closest("label").hidden = text;
  $("#lookup-offline").hidden = text;
  $("#question-answers").placeholder = text ? (type === "blank" ? "按空的顺序，每行一个答案" : "填写完整正文，可保留分段；暂时没有答案可留空") : "填写选项完整文字；暂时没有答案可留空";
}
$("#question-type").onchange = updateEditorType;
$("#close-editor").onclick = () => $("#question-editor").close();
$("#question-form").onsubmit = async (event) => {
  event.preventDefault();
  const lines = (text) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  $("#save-question").disabled = true;
  try {
    const result = await api.saveQuestion({
      ...(editingQuestion?.id ? { id: editingQuestion.id } : {}),
      ...(editingQuestion?.source ? { source: editingQuestion.source } : {}),
      question: $("#question-text").value,
      options: ["blank", "short", "essay"].includes($("#question-type").value) ? [] : lines($("#question-options").value),
      answers: ["short", "essay"].includes($("#question-type").value) ? ($("#question-answers").value.trim() ? [$("#question-answers").value.trim()] : []) : lines($("#question-answers").value),
      type: $("#question-type").value,
      blankCount: editingQuestion?.blankCount,
      major: editingQuestion?.major || "",
      multiple: $("#question-type").value === "multiple",
    });
    $("#question-editor").close();
    render(result);
    await loadBank();
    toast("题目已保存到本机");
  } catch (error) {
    $("#editor-error").textContent = error.message.replace(
      /^Error invoking remote method '[^']+': Error: /,
      "",
    );
  } finally {
    $("#save-question").disabled = false;
  }
};
for (const button of document.querySelectorAll("[data-bank-filter]"))
  button.onclick = () => {
    bankFilter = button.dataset.bankFilter;
    bankOffset = 0;
    $("#question-collection").open = true;
    $("#bank-search").placeholder =
      bankFilter === "offline" ? "至少两个字，搜索离线库" : "搜索题干或选项";
    for (const element of document.querySelectorAll("[data-bank-filter]"))
      element.classList.toggle("active", element === button);
    loadBank();
  };
let bankSearchTimer;
$("#bank-search").oninput = () => {
  clearTimeout(bankSearchTimer);
  bankSearchTimer = setTimeout(() => {
    bankOffset = 0;
    if ($("#bank-search").value.trim()) $("#question-collection").open = true;
    loadBank();
  }, 180);
};
$("#bank-prev").onclick = () => {
  bankOffset = Math.max(0, bankOffset - 30);
  loadBank();
};
$("#bank-next").onclick = () => {
  bankOffset += 30;
  loadBank();
};
$("#lookup-offline").onclick = async () => {
  const result = await act(() =>
    api.offlineReference({
      title: $("#question-text").value,
      options: $("#question-options")
        .value.split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
      multiple: $("#question-type").value === "multiple",
    }),
  );
  if (result?.status === "matched") {
    $("#question-answers").value = result.texts.join("\n");
    $("#reference-note").textContent = "已填入离线参考答案，请核对后保存。";
  } else
    $("#reference-note").textContent =
      "没有找到题干和选项都能准确匹配的参考答案，可先保存待补充。";
};
$("#save-settings").onclick = async () => {
  const settings = {};
  for (const key of [
    "autoNext",
    "muted",
    "autoAnswer",
    "autoSubmit",
    "skipUnanswered",
    "keepAwake",
  ])
    settings[key] = $(`#${key}`).checked;
  for (const key of ["playbackRate", "nextDelay"])
    settings[key] = Number($(`#${key}`).value);
  settings.major = $("#major").value.trim();
  const result = await act(() => api.settings(settings), "设置已保存");
  if (result) $("#save-note").textContent = "已保存，设置保存在本机";
};
for (const input of document.querySelectorAll(
  "#settings input, #settings select",
))
  input.addEventListener("change", () => {
    $("#save-note").textContent = "有未保存的修改";
  });
$("#date").textContent = new Date().toLocaleDateString("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
});
const poll = () =>
  api
    .snapshot()
    .then(render)
    .catch(() => toast("暂时无法读取桌面端状态"));
navigate("overview");
poll();
setInterval(poll, 2000);
