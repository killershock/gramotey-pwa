const SETTINGS_KEY = "gramotey.settings.v1";
const DRAFT_KEY = "gramotey.draft.v1";

export const DEFAULT_SETTINGS = {
  onlineCheck: true,
  localRules: true,
  autoFix: true,
  autoFixSpelling: false,
  nativeSpellcheck: false,
  language: "auto",
  endpoint: "https://api.languagetool.org/v2/check",
  provider: "gemini",
  apiBaseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
  apiModel: "gemini-3.5-flash-lite",
  apiKey: ""
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* приватный режим или переполнение — молча игнорируем */
  }
}

export function loadDraft() {
  try {
    return localStorage.getItem(DRAFT_KEY) || "";
  } catch {
    return "";
  }
}

export function saveDraft(text) {
  try {
    localStorage.setItem(DRAFT_KEY, text);
  } catch {
    /* ignore */
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
