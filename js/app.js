import { runLocalCheck, KIND_META } from "./rules.js";
import {
  checkWithLanguageTool,
  matchesToIssues,
  OnlineCheckError,
  MAX_ONLINE_CHARS,
  DEFAULT_ENDPOINT
} from "./languagetool.js";
import { rewriteText, REWRITE_MODES, PROVIDERS } from "./ai.js";
import { diffTokens } from "./diff.js";
import { loadSettings, saveSettings, loadDraft, saveDraft, clearDraft } from "./store.js";
import { debounce, escapeHtml, detectLanguage, formatCount } from "./utils.js";

// MARK: - Ссылки на элементы

const $ = (id) => document.getElementById(id);

const dom = {
  editor: $("editor"),
  hlInner: $("hlInner"),
  langBadge: $("langBadge"),
  charCount: $("charCount"),
  issues: $("issues"),
  corrections: $("corrections"),
  correctionsCount: $("correctionsCount"),
  correctionsList: $("correctionsList"),
  undoCorrections: $("undoCorrections"),
  installTip: $("installTip"),
  installTipClose: $("installTipClose"),
  statusText: $("statusText"),
  statusSpinner: $("statusSpinner"),
  statusDot: $("statusDot"),
  fixAllBtn: $("fixAllBtn"),
  refreshBtn: $("refreshBtn"),
  banner: $("banner"),
  bannerText: $("bannerText"),
  bannerRetry: $("bannerRetry"),
  bannerClose: $("bannerClose"),
  pasteBtn: $("pasteBtn"),
  copyBtn: $("copyBtn"),
  clearBtn: $("clearBtn"),
  settingsBtn: $("settingsBtn"),
  rewriteBtn: $("rewriteBtn"),
  installHeaderBtn: $("installHeaderBtn"),
  toast: $("toast"),

  rewriteDialog: $("rewriteDialog"),
  settingsDialog: $("settingsDialog"),

  aiSetup: $("aiSetup"),
  aiBody: $("aiBody"),
  aiOpenSettings: $("aiOpenSettings"),
  modeGrid: $("modeGrid"),
  aiRunBtn: $("aiRunBtn"),
  aiRunLabel: $("aiRunLabel"),
  translateField: $("translateField"),
  targetLanguage: $("targetLanguage"),
  aiError: $("aiError"),
  aiResult: $("aiResult"),
  resultText: $("resultText"),
  diffToggle: $("diffToggle"),
  diffHint: $("diffHint"),
  staleNote: $("staleNote"),
  applyResult: $("applyResult"),
  copyResult: $("copyResult"),

  optOnline: $("optOnline"),
  optLocal: $("optLocal"),
  optAutoFix: $("optAutoFix"),
  optAutoFixSpelling: $("optAutoFixSpelling"),
  optNative: $("optNative"),
  optLanguage: $("optLanguage"),
  endpoint: $("endpoint"),
  provider: $("provider"),
  apiBaseURL: $("apiBaseURL"),
  apiModel: $("apiModel"),
  apiKey: $("apiKey"),
  clearKeyBtn: $("clearKeyBtn"),
  installBtn: $("installBtn"),
  installedNote: $("installedNote")
};

// MARK: - Состояние

const state = {
  settings: loadSettings(),
  text: "",
  checkedText: null,
  issues: [],
  localIssues: [],
  onlineIssues: [],
  onlineText: "",
  onlineStatus: "idle",
  onlineError: "",
  onlineToken: 0,
  onlineController: null,
  cooldownUntil: 0,
  bannerDismissed: false,
  corrections: [],
  autoFix: {
    passes: 0,
    undoText: null
  },
  ai: {
    mode: "polish",
    targetLanguage: "английский",
    busy: false,
    result: "",
    original: "",
    error: "",
    showDiff: false
  }
};

let localTimer = 0;
let onlineTimer = 0;
let toastTimer = 0;
let autoFixTimer = 0;
let autoFixBusy = false;
let correctionSequence = 0;
let deferredPrompt = null;

// MARK: - Утилиты интерфейса

function toast(message, duration = 1800) {
  const openDialog = document.querySelector("dialog[open]");
  const parent = openDialog || document.body;
  if (dom.toast.parentElement !== parent) {
    parent.appendChild(dom.toast);
  }

  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove("show"), duration);
}

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createIcon(id, className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (className) svg.setAttribute("class", className);
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.appendChild(use);
  return svg;
}

function openDialog(dialog) {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function closeDialog(dialog) {
  if (!dialog || !dialog.open) return;
  if (dom.toast.parentElement === dialog) document.body.appendChild(dom.toast);
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIOSDevice() {
  const userAgent = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

// MARK: - Работа с текстом

function normalize(value) {
  return String(value).replace(/\r\n?/g, "\n");
}

function updateMeta() {
  dom.charCount.textContent = `${formatCount(state.text.length)} симв.`;
  const language = state.text.trim() ? detectLanguage(state.text) : "ru";
  dom.langBadge.textContent = language.toUpperCase();
}

function autoGrow() {
  dom.editor.style.height = "auto";
  const max = Math.min(window.innerHeight * 0.55, 560);
  const height = Math.max(172, Math.min(dom.editor.scrollHeight, max));
  dom.editor.style.height = `${height}px`;
  syncHighlightScroll();
}

function syncHighlightScroll() {
  dom.hlInner.style.transform = `translateY(${-dom.editor.scrollTop}px)`;
}

function setText(value, { focus = false } = {}) {
  state.text = normalize(value);
  dom.editor.value = state.text;
  state.autoFix.undoText = null;
  state.autoFix.passes = 0;
  dom.undoCorrections.hidden = true;
  saveDraft(state.text);
  autoGrow();
  updateMeta();
  if (focus) dom.editor.focus({ preventScroll: true });
  runCheckNow(250);
  scheduleAutoFix(600);
}

function onInput() {
  state.text = dom.editor.value;
  invalidateOnline();
  state.autoFix.undoText = null;
  state.autoFix.passes = 0;
  dom.undoCorrections.hidden = true;
  saveDraftDebounced(state.text);
  autoGrow();
  updateMeta();
  renderHighlights();
  renderStatus();
  scheduleCheck();
  scheduleAutoFix(1500);
}

function invalidateOnline() {
  if (state.onlineController) {
    state.onlineController.abort();
    state.onlineController = null;
  }
  state.onlineToken += 1;
  state.onlineStatus = state.settings.onlineCheck ? "idle" : "off";
  state.onlineError = "";
  state.onlineIssues = [];
  state.onlineText = "";
}

const saveDraftDebounced = debounce((value) => saveDraft(value), 500);

async function pasteText() {
  try {
    const value = await navigator.clipboard.readText();
    if (!value) {
      toast("В буфере обмена пусто");
      return;
    }
    setText(state.text ? `${state.text}\n${value}` : value);
    toast("Вставлено");
  } catch {
    dom.editor.focus();
    toast("Браузер не дал доступ к буферу — вставьте вручную");
  }
}

async function copyText(value, message = "Скопировано") {
  if (!value) {
    toast("Нечего копировать");
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    toast(message);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    try {
      document.execCommand("copy");
      toast(message);
    } catch {
      toast("Не удалось скопировать");
    }
    helper.remove();
  }
}

function clearText() {
  if (!state.text) return;
  if (!window.confirm("Очистить текст и сохранённый черновик?")) return;
  state.text = "";
  dom.editor.value = "";
  clearDraft();
  state.corrections = [];
  state.autoFix.undoText = null;
  state.autoFix.passes = 0;
  renderCorrections();
  autoGrow();
  updateMeta();
  runCheckNow(0);
  toast("Очищено");
}

// MARK: - Проверка

function scheduleCheck() {
  clearTimeout(localTimer);
  clearTimeout(onlineTimer);
  localTimer = setTimeout(applyLocalCheck, 120);
  onlineTimer = setTimeout(fetchOnlineCheck, 700);
}

function runCheckNow(onlineDelay = 0) {
  clearTimeout(localTimer);
  clearTimeout(onlineTimer);
  applyLocalCheck();
  onlineTimer = setTimeout(fetchOnlineCheck, onlineDelay);
}

function applyLocalCheck() {
  const text = state.text;
  const local = state.settings.localRules
    ? runLocalCheck(text, { language: state.settings.language })
    : [];

  state.localIssues = local;
  if (state.onlineText !== text) state.onlineIssues = [];

  state.issues = mergeIssues(state.localIssues, state.onlineIssues);
  state.checkedText = text;
  renderAll();
}

async function fetchOnlineCheck() {
  const text = state.text;

  if (!text.trim()) {
    state.onlineStatus = "idle";
    state.onlineError = "";
    state.onlineIssues = [];
    state.onlineText = "";
    renderAll();
    return;
  }

  if (!state.settings.onlineCheck) {
    state.onlineStatus = "off";
    state.onlineError = "";
    state.onlineIssues = [];
    state.onlineText = "";
    renderAll();
    return;
  }

  if (Date.now() < state.cooldownUntil) {
    state.onlineStatus = "error";
    state.onlineError = "Лимит запросов к LanguageTool. Подождите минуту.";
    renderStatus();
    renderBanner();
    return;
  }

  if (state.onlineText === text && state.onlineStatus === "ok") {
    renderAll();
    return;
  }

  if (state.onlineController) {
    state.onlineController.abort();
    state.onlineController = null;
  }

  const token = ++state.onlineToken;
  const controller = new AbortController();
  state.onlineController = controller;

  state.onlineStatus = "checking";
  state.onlineError = "";
  state.bannerDismissed = false;
  renderStatus();
  renderBanner();

  const payload = text.length > MAX_ONLINE_CHARS ? text.slice(0, MAX_ONLINE_CHARS) : text;
  const language = state.settings.language === "ru"
    ? "ru-RU"
    : state.settings.language === "en"
      ? "en-US"
      : "auto";

  try {
    const { matches } = await checkWithLanguageTool(payload, {
      language,
      endpoint: state.settings.endpoint || DEFAULT_ENDPOINT,
      signal: controller.signal
    });

    if (token !== state.onlineToken) return;
    if (state.text !== text) return;

    state.onlineIssues = matchesToIssues(matches, payload);
    state.onlineText = text;
    state.onlineStatus = "ok";
    state.onlineError = "";

    if (state.settings.autoFixSpelling) {
      scheduleAutoFix(300);
    }
  } catch (error) {
    if (error?.name === "AbortError" || token !== state.onlineToken) return;

    state.onlineStatus = "error";
    state.onlineError = error?.message || "Не удалось выполнить онлайн-проверку.";
    state.onlineIssues = [];
    state.onlineText = "";

    if (error instanceof OnlineCheckError && error.code === "limit") {
      state.cooldownUntil = Date.now() + 60000;
    }
  } finally {
    if (state.onlineController === controller) state.onlineController = null;
    if (token === state.onlineToken && state.text === text) {
      state.issues = mergeIssues(state.localIssues, state.onlineIssues);
      state.checkedText = text;
      renderAll();
    }
  }
}

function mergeIssues(local, online) {
  // LanguageTool иногда дублирует локальные правила про пробелы —
  // оставляем локальную, более точную подсказку.
  const meaningfulOnline = online.filter((candidate) => {
    if (candidate.kind !== "spacing" || !/пробел/i.test(candidate.message)) return true;

    return !local.some((localIssue) => {
      if (!(localIssue.insertion || localIssue.kind === "spacing")) return false;
      return Math.abs(localIssue.start - candidate.start) <= 1
        || Math.abs(localIssue.end - candidate.end) <= 1
        || rangesOverlap(localIssue, candidate);
    });
  });

  const combined = [...local, ...meaningfulOnline];
  combined.sort((lhs, rhs) => {
    if (lhs.start !== rhs.start) return lhs.start - rhs.start;
    return (rhs.end - rhs.start) - (lhs.end - lhs.start);
  });

  const kept = [];
  for (const issue of combined) {
    if (kept.some((existing) => rangesOverlap(existing, issue))) continue;
    kept.push(issue);
    if (kept.length >= 400) break;
  }
  return kept;
}

function rangesOverlap(lhs, rhs) {
  const lhsLength = lhs.end - lhs.start;
  const rhsLength = rhs.end - rhs.start;

  if (lhsLength === 0 && rhsLength === 0) return lhs.start === rhs.start;
  if (lhsLength === 0) return rhs.start < lhs.start && lhs.start < rhs.end;
  if (rhsLength === 0) return lhs.start < rhs.start && rhs.start < lhs.end;
  return Math.max(lhs.start, rhs.start) < Math.min(lhs.end, rhs.end);
}

// MARK: - Автоисправление

function scheduleAutoFix(delay = 1500) {
  clearTimeout(autoFixTimer);
  if (!state.settings.autoFix) return;
  autoFixTimer = setTimeout(maybeAutoFix, delay);
}

function maybeAutoFix() {
  if (!state.settings.autoFix || autoFixBusy) return;
  if (!state.text.trim()) return;

  // Ждём, пока проверка текущего текста завершится.
  if (state.checkedText !== state.text) {
    scheduleAutoFix(400);
    return;
  }

  if (state.autoFix.passes >= 2) return;

  const allowOnline = Boolean(state.settings.autoFixSpelling);
  const applicable = state.issues
    .filter((issue) => issue.suggestions.length > 0)
    .filter((issue) => allowOnline || issue.source === "local")
    .filter((issue) => issue.end <= state.text.length)
    .filter((issue) => issue.insertion || state.text.slice(issue.start, issue.end) === issue.original)
    .sort((lhs, rhs) => rhs.start - lhs.start || rhs.end - lhs.end);

  if (!applicable.length) return;

  autoFixBusy = true;

  const beforeText = state.text;
  const caret = dom.editor.selectionStart || 0;
  let next = beforeText;
  let nextCaret = caret;
  const corrections = [];

  for (const issue of applicable) {
    const value = issue.suggestions[0].value;
    const delta = value.length - (issue.end - issue.start);
    if (issue.start < nextCaret) nextCaret += delta;

    next = next.slice(0, issue.start) + value + next.slice(issue.end);
    corrections.push({
      kind: issue.kind,
      before: issue.original,
      after: value,
      message: issue.message,
      insertion: issue.insertion,
      position: issue.start
    });
  }

  if (next === beforeText) {
    autoFixBusy = false;
    return;
  }

  if (state.autoFix.passes === 0) {
    state.autoFix.undoText = beforeText;
  }
  state.autoFix.passes += 1;

  state.text = next;
  dom.editor.value = next;
  saveDraft(next);
  autoGrow();
  updateMeta();

  if (document.activeElement === dom.editor) {
    const position = Math.max(0, Math.min(nextCaret, next.length));
    dom.editor.setSelectionRange(position, position);
  }

  addCorrections(corrections);
  autoFixBusy = false;

  runCheckNow(0);
  toast(`Исправлено: ${corrections.length}`);
  scheduleAutoFix(700);
}

function addCorrections(list) {
  if (!list.length) return;

  const ordered = [...list].sort((lhs, rhs) => (lhs.position || 0) - (rhs.position || 0));
  const entries = ordered.map((item) => ({
    id: `correction-${++correctionSequence}`,
    ...item
  }));

  state.corrections = [...entries, ...state.corrections].slice(0, 60);
  renderCorrections();
}

function renderCorrections() {
  const hasCorrections = state.corrections.length > 0;
  dom.corrections.hidden = !hasCorrections;
  dom.undoCorrections.hidden = !state.autoFix.undoText;

  if (!hasCorrections) {
    dom.correctionsList.innerHTML = "";
    dom.correctionsCount.textContent = "";
    return;
  }

  dom.correctionsCount.textContent = `(${state.corrections.length})`;
  dom.correctionsList.innerHTML = "";

  const visible = state.corrections.slice(0, 12);
  for (const item of visible) {
    const meta = KIND_META[item.kind] || KIND_META.punctuation;
    const row = createElement("div", "correction");
    row.style.setProperty("--c", meta.color);

    row.appendChild(createElement("div", "correction-top", meta.title));

    const change = createElement("p", "correction-change");
    change.appendChild(createElement("span", "correction-before", displayValue(item.before, item.insertion)));
    change.append(" → ");
    change.appendChild(createElement("span", "correction-after", displayValue(item.after, false)));
    row.appendChild(change);

    row.appendChild(createElement("p", "correction-why", item.message));
    dom.correctionsList.appendChild(row);
  }

  if (state.corrections.length > visible.length) {
    dom.correctionsList.appendChild(
      createElement("p", "correction-more", `Ещё ${state.corrections.length - visible.length} исправлений`)
    );
  }
}

function displayValue(value, insertion) {
  if (insertion) return "нет";
  if (value === "" || value === undefined || value === null) {
    return "удалено";
  }
  return String(value)
    .replace(/ /g, "␣")
    .replace(/\n/g, "↵")
    .replace(/\t/g, "⇥");
}

function undoAutoFix() {
  if (!state.autoFix.undoText) return;

  const value = state.autoFix.undoText;
  state.autoFix.undoText = null;
  state.autoFix.passes = 0;
  state.corrections = [];

  state.text = value;
  dom.editor.value = value;
  saveDraft(value);
  autoGrow();
  updateMeta();
  renderCorrections();
  runCheckNow(0);
  toast("Изменения отменены");
}

// MARK: - Отрисовка

function renderAll() {
  renderStatus();
  renderBanner();
  renderIssues();
  renderHighlights();
}

function renderStatus() {
  const hasText = state.text.trim().length > 0;
  const checking = state.onlineStatus === "checking" || (hasText && state.checkedText !== state.text && state.settings.onlineCheck);

  let text = "Начните печатать — проверю ошибки";
  if (hasText) {
    if (checking) {
      text = "Проверяю орфографию и грамматику…";
    } else if (state.issues.length > 0) {
      text = `Найдено мест: ${state.issues.length}`;
    } else if (state.onlineStatus === "error") {
      text = "Онлайн-проверка недоступна";
    } else if (state.onlineStatus === "off") {
      text = "Проверка по локальным правилам";
    } else if (state.checkedText === state.text) {
      text = "Ошибок не найдено";
    } else {
      text = "Проверяю…";
    }
  }

  dom.statusText.textContent = text;
  dom.statusSpinner.hidden = !checking;
  dom.fixAllBtn.hidden = !(hasText && state.issues.length > 0);

  const showDot = hasText && !checking && state.onlineStatus !== "error";
  dom.statusDot.hidden = !showDot;
  if (showDot) {
    dom.statusDot.className = state.issues.length > 0 ? "status-dot warn" : "status-dot ok";
  }
}

function renderBanner() {
  const show = state.onlineStatus === "error" && Boolean(state.onlineError) && !state.bannerDismissed;
  dom.banner.hidden = !show;
  if (!show) return;

  dom.bannerText.textContent = state.onlineError;

  const note = state.text.length > MAX_ONLINE_CHARS
    ? `Онлайн-проверка смотрит первые ${formatCount(MAX_ONLINE_CHARS)} символов.`
    : "";
  dom.bannerNote.hidden = !note;
  dom.bannerNote.textContent = note;
}

function renderIssues() {
  const container = dom.issues;
  container.innerHTML = "";

  if (!state.text.trim()) {
    container.appendChild(buildTipsCard());
    return;
  }

  const waiting = state.checkedText !== state.text || state.onlineStatus === "checking";

  if (state.issues.length === 0) {
    container.appendChild(waiting ? buildLoadingCard() : buildCleanCard());
    return;
  }

  const visible = state.issues.slice(0, 150);
  const fragment = document.createDocumentFragment();

  for (const issue of visible) {
    fragment.appendChild(buildIssueCard(issue));
  }

  container.appendChild(fragment);

  if (state.issues.length > visible.length) {
    const note = createElement("p", "hint");
    note.textContent = `Показаны первые ${visible.length} из ${state.issues.length}. Исправьте эти — проверка обновится.`;
    container.appendChild(note);
  }

  if (state.text.length > MAX_ONLINE_CHARS && state.settings.onlineCheck && state.onlineText === state.text) {
    const note = createElement("p", "hint");
    note.textContent = `Онлайн-проверка ограничена первыми ${formatCount(MAX_ONLINE_CHARS)} символами.`;
    container.appendChild(note);
  }
}

function buildTipsCard() {
  const card = createElement("div", "tips");
  const tips = [
    ["i-check", "Орфография: проверка через LanguageTool и подсказки замены"],
    ["i-alert", "Пунктуация, пробелы, тире и кавычки"],
    ["i-refresh", "Повторы слов — локально и без интернета"],
    ["i-sparkles", "ИИ-редактор перепишет текст, сохранив смысл"]
  ];

  for (const [iconId, text] of tips) {
    const row = createElement("div", "tip");
    row.appendChild(createIcon(iconId));
    row.appendChild(createElement("span", null, text));
    card.appendChild(row);
  }

  return card;
}

function buildLoadingCard() {
  const card = createElement("div", "empty");
  const icon = createElement("div", "empty-icon");
  icon.appendChild(createElement("span", "spinner"));
  card.appendChild(icon);
  card.appendChild(createElement("h3", null, "Проверяю текст"));
  card.appendChild(createElement("p", null, "Обычно это занимает меньше секунды."));
  return card;
}

function buildCleanCard() {
  const card = createElement("div", "empty");
  const icon = createElement("div", "empty-icon");
  icon.appendChild(createIcon("i-check"));
  card.appendChild(icon);
  card.appendChild(createElement("h3", null, "Всё чисто"));

  let message = "Орфография и пунктуация в порядке.";
  if (state.onlineStatus === "off") {
    message = "Локальные правила не нашли проблем. Включите онлайн-проверку для орфографии.";
  } else if (state.onlineStatus === "error") {
    message = "Локальные правила не нашли проблем. Онлайн-проверка сейчас недоступна.";
  }

  card.appendChild(createElement("p", null, message));
  return card;
}

function buildIssueCard(issue) {
  const meta = KIND_META[issue.kind] || KIND_META.punctuation;
  const text = state.text;

  const card = createElement("article", "issue");
  card.style.setProperty("--c", meta.color);

  const top = createElement("div", "issue-top");
  top.appendChild(createElement("span", "issue-kind", meta.title));
  if (issue.source === "lt") {
    top.appendChild(createElement("span", "source-pill", "LanguageTool"));
  }
  card.appendChild(top);

  card.appendChild(createElement("p", "issue-msg", issue.message));

  const context = createElement("p", "issue-ctx");
  appendContext(context, issue, text);
  card.appendChild(context);

  if (issue.suggestions.length > 0) {
    const chips = createElement("div", "chips");
    for (const suggestion of issue.suggestions.slice(0, 4)) {
      const chip = createElement("button", "chip", suggestion.label);
      chip.type = "button";
      chip.title = suggestion.value === "" ? "Удалить" : suggestion.value;
      chip.addEventListener("click", () => applySuggestion(issue, suggestion));
      chips.appendChild(chip);
    }
    card.appendChild(chips);
  } else {
    card.appendChild(createElement("p", "hint", "Готового варианта нет — исправьте это место вручную."));
  }

  return card;
}

function appendContext(container, issue, text) {
  const length = text.length;
  const start = Math.max(0, Math.min(issue.start, length));
  const end = Math.max(start, Math.min(issue.end, length));

  const from = Math.max(0, start - 26);
  const to = Math.min(length, end + 26);

  const prefix = text.slice(from, start).replace(/\s+/g, " ");
  const suffix = text.slice(end, to).replace(/\s+/g, " ");
  const highlighted = issue.insertion ? "␣" : text.slice(start, end).replace(/\s+/g, " ");

  if (from > 0) container.append("…");
  container.append(prefix);

  const mark = document.createElement("mark");
  mark.textContent = highlighted;
  container.append(mark);

  container.append(suffix);
  if (to < length) container.append("…");
}

function renderHighlights() {
  const text = state.text;

  if (!text) {
    dom.hlInner.innerHTML = "";
    return;
  }

  if (state.checkedText !== text) {
    dom.hlInner.innerHTML = escapeHtml(text) + (text.endsWith("\n") ? "\u200b" : "");
    syncHighlightScroll();
    return;
  }

  const issues = [...state.issues].sort((lhs, rhs) => lhs.start - rhs.start);
  let html = "";
  let cursor = 0;

  for (const issue of issues) {
    const start = Math.max(0, Math.min(issue.start, text.length));
    const end = Math.max(start, Math.min(issue.end, text.length));

    if (issue.insertion) {
      if (start >= cursor && start < text.length) {
        html += escapeHtml(text.slice(cursor, start));
        const meta = KIND_META[issue.kind] || KIND_META.punctuation;
        html += `<mark class="hl hl-insert" style="--hl-line:${meta.color}">${escapeHtml(text[start])}</mark>`;
        cursor = start + 1;
      }
      continue;
    }

    if (start < cursor || end === start) continue;

    html += escapeHtml(text.slice(cursor, start));
    html += `<mark class="hl hl-${issue.kind}">${escapeHtml(text.slice(start, end))}</mark>`;
    cursor = end;
  }

  html += escapeHtml(text.slice(cursor));
  if (text.endsWith("\n")) html += "\u200b";

  dom.hlInner.innerHTML = html;
  syncHighlightScroll();
}

// MARK: - Применение исправлений

function applySuggestion(issue, suggestion) {
  const text = state.text;
  const { start, end } = issue;

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end < start) {
    toast("Текст изменился — проверьте заново");
    runCheckNow(0);
    return;
  }

  if (!issue.insertion && text.slice(start, end) !== issue.original) {
    toast("Текст изменился — проверьте заново");
    runCheckNow(0);
    return;
  }

  const next = text.slice(0, start) + suggestion.value + text.slice(end);
  addCorrections([{
    kind: issue.kind,
    before: issue.original,
    after: suggestion.value,
    message: issue.message,
    insertion: issue.insertion,
    position: issue.start
  }]);
  setText(next);
  toast("Исправлено");
}

function fixAll() {
  if (state.issues.length === 0) return;

  const applicable = state.issues.filter((issue) => {
    if (issue.suggestions.length === 0) return false;
    if (issue.end > state.text.length) return false;
    if (!issue.insertion && state.text.slice(issue.start, issue.end) !== issue.original) return false;
    return true;
  });

  if (applicable.length === 0) {
    toast("Нет готовых вариантов для автоматической правки");
    return;
  }

  const confirmed = window.confirm(
    `Применить первые подсказки в ${applicable.length} мест(ах)? Для орфографии берётся первый вариант — проверьте результат.`
  );
  if (!confirmed) return;

  applicable.sort((lhs, rhs) => rhs.start - lhs.start || rhs.end - lhs.end);

  let text = state.text;
  const corrections = [];

  for (const issue of applicable) {
    text = text.slice(0, issue.start) + issue.suggestions[0].value + text.slice(issue.end);
    corrections.push({
      kind: issue.kind,
      before: issue.original,
      after: issue.suggestions[0].value,
      message: issue.message,
      insertion: issue.insertion,
      position: issue.start
    });
  }

  addCorrections(corrections);
  setText(text);
  toast("Применены все исправления");
}

// MARK: - ИИ-редактор

function openRewrite() {
  if (!state.text.trim()) {
    toast("Сначала добавьте текст");
    return;
  }

  if (!state.ai.busy && state.ai.original && state.ai.original !== state.text) {
    state.ai.result = "";
    state.ai.error = "";
    state.ai.showDiff = false;
    state.ai.original = "";
  }

  renderRewrite();
  openDialog(dom.rewriteDialog);
}

function renderRewrite() {
  const hasKey = Boolean(state.settings.apiKey.trim());

  dom.aiSetup.hidden = hasKey;
  dom.aiBody.hidden = !hasKey;

  if (!hasKey) return;

  renderModeGrid();

  const isTranslate = state.ai.mode === "translate";
  dom.translateField.hidden = !isTranslate;
  if (isTranslate) {
    dom.targetLanguage.value = state.ai.targetLanguage;
  }

  dom.aiRunBtn.disabled = state.ai.busy || !state.text.trim();
  dom.aiRunLabel.textContent = state.ai.busy
    ? (isTranslate ? "Перевожу…" : "Переписываю…")
    : (isTranslate ? "Перевести текст" : "Переписать текст");

  dom.aiError.hidden = !state.ai.error;
  dom.aiError.textContent = state.ai.error || "";

  const hasResult = Boolean(state.ai.result);
  dom.aiResult.hidden = !hasResult;
  if (!hasResult) return;

  dom.resultText.innerHTML = "";

  if (state.ai.showDiff) {
    for (const token of diffTokens(state.ai.original, state.ai.result)) {
      const span = document.createElement("span");
      span.textContent = token.text;
      if (token.kind === "inserted") span.className = "diff-add";
      else if (token.kind === "deleted") span.className = "diff-del";
      dom.resultText.appendChild(span);
    }
  } else {
    dom.resultText.textContent = state.ai.result;
  }

  dom.diffHint.hidden = !state.ai.showDiff;
  dom.diffToggle.textContent = state.ai.showDiff ? "Текст" : "Изменения";

  const stale = state.ai.original !== state.text;
  dom.staleNote.hidden = !stale;
  dom.applyResult.disabled = stale || state.ai.busy;
}

function renderModeGrid() {
  dom.modeGrid.innerHTML = "";

  for (const mode of REWRITE_MODES) {
    const button = createElement("button", `mode${state.ai.mode === mode.id ? " active" : ""}`);
    button.type = "button";

    const icon = createElement("span", "mode-icon");
    icon.appendChild(createIcon(mode.icon));
    button.appendChild(icon);
    button.appendChild(createElement("span", "mode-title", mode.title));
    button.appendChild(createElement("span", "mode-sub", mode.subtitle));

    button.addEventListener("click", () => {
      state.ai.mode = mode.id;

      if (mode.id === "translate") {
        state.ai.targetLanguage = detectLanguage(state.text) === "ru" ? "английский" : "русский";
      }

      renderRewrite();
    });

    dom.modeGrid.appendChild(button);
  }
}

async function runAI() {
  if (state.ai.busy) return;

  const source = state.text;
  if (!source.trim()) {
    toast("Сначала добавьте текст");
    return;
  }

  state.ai.busy = true;
  state.ai.error = "";
  state.ai.result = "";
  state.ai.showDiff = false;
  state.ai.original = source;
  renderRewrite();

  try {
    const result = await rewriteText({
      text: source,
      mode: state.ai.mode,
      targetLanguage: state.ai.targetLanguage,
      settings: state.settings
    });
    state.ai.result = result;
  } catch (error) {
    state.ai.error = error?.message || "Не удалось переписать текст. Попробуйте ещё раз.";
  }

  state.ai.busy = false;
  renderRewrite();
}

function applyAIResult() {
  if (!state.ai.result) return;

  if (state.ai.original !== state.text) {
    toast("Текст изменился — запустите переписывание заново");
    return;
  }

  setText(state.ai.result, { focus: true });
  closeDialog(dom.rewriteDialog);
  toast("Текст заменён");
}

// MARK: - Настройки

function persistSettings() {
  saveSettings(state.settings);
}

function syncSettingsUI() {
  dom.optOnline.checked = state.settings.onlineCheck;
  dom.optLocal.checked = state.settings.localRules;
  dom.optAutoFix.checked = state.settings.autoFix;
  dom.optAutoFixSpelling.checked = state.settings.autoFixSpelling;
  dom.optNative.checked = state.settings.nativeSpellcheck;
  dom.optLanguage.value = state.settings.language;
  dom.endpoint.value = state.settings.endpoint;
  dom.provider.value = PROVIDERS[state.settings.provider] ? state.settings.provider : "custom";
  dom.apiBaseURL.value = state.settings.apiBaseURL;
  dom.apiModel.value = state.settings.apiModel;
  dom.apiKey.value = state.settings.apiKey;
  dom.editor.spellcheck = state.settings.nativeSpellcheck;
}

function bindSettings() {
  dom.optOnline.addEventListener("change", () => {
    state.settings.onlineCheck = dom.optOnline.checked;
    persistSettings();
    runCheckNow(0);
  });

  dom.optLocal.addEventListener("change", () => {
    state.settings.localRules = dom.optLocal.checked;
    persistSettings();
    runCheckNow(0);
  });

  dom.optAutoFix.addEventListener("change", () => {
    state.settings.autoFix = dom.optAutoFix.checked;
    state.autoFix.passes = 0;
    persistSettings();
    if (state.settings.autoFix) {
      scheduleAutoFix(300);
    } else {
      clearTimeout(autoFixTimer);
    }
  });

  dom.optAutoFixSpelling.addEventListener("change", () => {
    state.settings.autoFixSpelling = dom.optAutoFixSpelling.checked;
    state.autoFix.passes = 0;
    persistSettings();
    if (state.settings.autoFix && state.settings.autoFixSpelling) {
      scheduleAutoFix(300);
    }
  });

  dom.optNative.addEventListener("change", () => {
    state.settings.nativeSpellcheck = dom.optNative.checked;
    dom.editor.spellcheck = state.settings.nativeSpellcheck;
    persistSettings();
  });

  dom.optLanguage.addEventListener("change", () => {
    state.settings.language = dom.optLanguage.value;
    persistSettings();
    runCheckNow(0);
  });

  dom.endpoint.addEventListener("input", debounce(() => {
    state.settings.endpoint = dom.endpoint.value.trim() || DEFAULT_ENDPOINT;
    persistSettings();
    runCheckNow(800);
  }, 700));

  dom.provider.addEventListener("change", () => {
    const id = dom.provider.value;
    state.settings.provider = id;
    const preset = PROVIDERS[id];
    if (preset && id !== "custom") {
      state.settings.apiBaseURL = preset.baseURL;
      state.settings.apiModel = preset.model;
      dom.apiBaseURL.value = preset.baseURL;
      dom.apiModel.value = preset.model;
    }
    persistSettings();
  });

  dom.apiBaseURL.addEventListener("input", debounce(() => {
    state.settings.apiBaseURL = dom.apiBaseURL.value.trim();
    state.settings.provider = "custom";
    dom.provider.value = "custom";
    persistSettings();
  }, 500));

  dom.apiModel.addEventListener("input", debounce(() => {
    state.settings.apiModel = dom.apiModel.value.trim();
    persistSettings();
  }, 500));

  dom.apiKey.addEventListener("input", debounce(() => {
    state.settings.apiKey = dom.apiKey.value.trim();
    persistSettings();
  }, 400));

  dom.clearKeyBtn.addEventListener("click", () => {
    state.settings.apiKey = "";
    dom.apiKey.value = "";
    persistSettings();
    toast("Ключ удалён");
    renderRewrite();
  });
}

// MARK: - Установка PWA

function updateInstallUI() {
  const standalone = isStandalone();
  const canInstall = Boolean(deferredPrompt) && !standalone;
  dom.installBtn.hidden = !canInstall;
  dom.installHeaderBtn.hidden = !canInstall;
  dom.installedNote.hidden = !standalone;
}

async function promptInstall() {
  if (!deferredPrompt) return;

  deferredPrompt.prompt();
  try {
    await deferredPrompt.userChoice;
  } finally {
    deferredPrompt = null;
    updateInstallUI();
  }
}

function setupInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    updateInstallUI();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    updateInstallUI();
    toast("Приложение установлено");
  });

  dom.installBtn.addEventListener("click", promptInstall);
  dom.installHeaderBtn.addEventListener("click", promptInstall);
  updateInstallUI();
}

function setupInstallTip() {
  if (!isIOSDevice() || isStandalone()) return;

  let dismissed = false;
  try {
    dismissed = localStorage.getItem("gramotey.installTipDismissed") === "1";
  } catch {
    dismissed = false;
  }
  if (dismissed) return;

  dom.installTip.hidden = false;
  dom.installTipClose.addEventListener("click", () => {
    dom.installTip.hidden = true;
    try {
      localStorage.setItem("gramotey.installTipDismissed", "1");
    } catch {
      /* ignore */
    }
  });
}

// MARK: - События

function bindEvents() {
  dom.editor.addEventListener("input", onInput);
  dom.editor.addEventListener("scroll", syncHighlightScroll, { passive: true });

  dom.pasteBtn.addEventListener("click", pasteText);
  dom.copyBtn.addEventListener("click", () => copyText(state.text));
  dom.clearBtn.addEventListener("click", clearText);

  dom.refreshBtn.addEventListener("click", () => {
    state.autoFix.passes = 0;
    runCheckNow(0);
    scheduleAutoFix(500);
  });
  dom.fixAllBtn.addEventListener("click", fixAll);

  dom.bannerRetry.addEventListener("click", () => runCheckNow(0));
  dom.bannerClose.addEventListener("click", () => {
    state.bannerDismissed = true;
    renderBanner();
  });

  dom.undoCorrections.addEventListener("click", undoAutoFix);

  dom.settingsBtn.addEventListener("click", () => {
    syncSettingsUI();
    openDialog(dom.settingsDialog);
  });

  dom.rewriteBtn.addEventListener("click", openRewrite);

  dom.aiOpenSettings.addEventListener("click", () => {
    closeDialog(dom.rewriteDialog);
    syncSettingsUI();
    openDialog(dom.settingsDialog);
  });

  dom.aiRunBtn.addEventListener("click", runAI);

  dom.targetLanguage.addEventListener("change", () => {
    state.ai.targetLanguage = dom.targetLanguage.value;
  });

  dom.diffToggle.addEventListener("click", () => {
    state.ai.showDiff = !state.ai.showDiff;
    renderRewrite();
  });

  dom.applyResult.addEventListener("click", applyAIResult);
  dom.copyResult.addEventListener("click", () => copyText(state.ai.result));

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(button.closest("dialog")));
  });

  document.querySelectorAll("dialog.sheet").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const outside = event.clientX < rect.left
        || event.clientX > rect.right
        || event.clientY < rect.top
        || event.clientY > rect.bottom;
      if (outside) closeDialog(dialog);
    });

    dialog.addEventListener("close", () => {
      if (dom.toast.parentElement === dialog) document.body.appendChild(dom.toast);
    });
  });

  window.addEventListener("resize", debounce(autoGrow, 150));
}

// MARK: - Запуск

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* офлайн-режим недоступен, приложение продолжит работать онлайн */
    });
  });
}

function init() {
  state.settings = loadSettings();
  state.text = normalize(loadDraft());
  dom.editor.value = state.text;

  syncSettingsUI();
  bindEvents();
  bindSettings();
  setupInstall();
  setupInstallTip();
  registerServiceWorker();

  autoGrow();
  updateMeta();
  renderAll();
  renderCorrections();

  if (state.text.trim()) {
    runCheckNow(0);
  }
}

init();
