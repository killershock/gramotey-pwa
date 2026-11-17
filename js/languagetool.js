import { isProtectedWord } from "./protected.js";

export const DEFAULT_ENDPOINT = "https://api.languagetool.org/v2/check";
export const MAX_ONLINE_CHARS = 18000;

// Правила LanguageTool, которые на проверенных фразах дают заведомо неверные
// подсказки. Verb_comma_Verb, например, предлагает «сказал чтобы я, пришел».
const BLOCKED_RULES = new Set(["Verb_comma_Verb"]);

export class OnlineCheckError extends Error {
  constructor(message, code = "error") {
    super(message);
    this.name = "OnlineCheckError";
    this.code = code;
  }
}

/**
 * Проверка орфографии, грамматики и пунктуации через LanguageTool.
 * Публичный API бесплатен и поддерживает CORS.
 */
export async function checkWithLanguageTool(text, { language = "auto", endpoint = DEFAULT_ENDPOINT, signal } = {}) {
  const body = new URLSearchParams({
    text,
    language,
    enabledOnly: "false",
    level: "default"
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: body.toString(),
      signal
    });
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    throw new OnlineCheckError("Не удалось связаться с LanguageTool. Проверьте интернет.", "network");
  }

  if (response.status === 429) {
    throw new OnlineCheckError("Слишком много запросов к LanguageTool. Подождите минуту.", "limit");
  }

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload && typeof payload.error === "string" ? payload.error : "";
    } catch {
      detail = "";
    }
    throw new OnlineCheckError(`Сервис проверки ответил ошибкой ${response.status}.${detail ? ` ${detail}` : ""}`, "http");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new OnlineCheckError("Сервис проверки вернул неожиданный ответ.", "parse");
  }

  return {
    matches: Array.isArray(payload.matches) ? payload.matches : [],
    detectedLanguage: payload?.language?.detectedLanguage?.code || payload?.language?.code || ""
  };
}

export function matchesToIssues(matches, text, ignoredWords = []) {
  const issues = [];

  for (const match of matches) {
    if (!match || typeof match.offset !== "number" || typeof match.length !== "number") continue;
    if (match.rule && BLOCKED_RULES.has(match.rule.id)) continue;

    const start = match.offset;
    const end = start + match.length;
    if (start < 0 || end > text.length || end < start) continue;

    const original = text.slice(start, end);
    // Мат и сленг не проверяем: иначе «бля» предлагают заменить на «Юля»/«для»/«Оля».
    if (isProtectedWord(original)) continue;
    if (isIgnored(original, ignoredWords)) continue;

    const kind = kindForRule(match.rule);
    const replacementValues = Array.isArray(match.replacements) ? match.replacements : [];
    const suggestions = replacementValues
      .map((item) => (item && typeof item.value === "string" ? item.value : null))
      .filter((value) => value !== null)
      .slice(0, 4)
      .map((value) => ({ label: value === "" ? "Удалить" : value, value }));

    issues.push({
      id: `lt-${start}-${end}-${match.rule?.id || "rule"}-${issues.length}`,
      kind,
      start,
      end,
      original: text.slice(start, end),
      insertion: match.length === 0,
      message: match.message || match.shortMessage || "Возможная ошибка.",
      suggestions,
      source: "lt",
      // Автоматически применяем только безопасные типы: орфографию, пробелы,
      // регистр и повторы. Грамматику и знаки препинания от LanguageTool
      // оставляем карточкой — в русском правила иногда ошибаются.
      autoFixable: isSafeOnlineKind(kind)
    });
  }

  return issues;
}

function kindForRule(rule = {}) {
  const type = String(rule.issueType || "").toLowerCase();
  const category = String(rule.category?.id || "").toUpperCase();

  if (type === "misspelling") return "spelling";
  if (type === "duplication") return "duplicate";
  if (category === "CASING") return "casing";
  if (category === "PUNCTUATION") return "punctuation";
  if (category === "TYPOGRAPHY" || type === "whitespace" || type === "typographical") return "spacing";
  if (category === "STYLE" || type === "style" || type === "register") return "style";
  if (category === "GRAMMAR" || type === "grammar") return "grammar";
  if (type === "uncategorized") return "grammar";
  return "punctuation";
}

function isSafeOnlineKind(kind) {
  return kind === "spelling" || kind === "spacing" || kind === "casing" || kind === "duplicate";
}

function normalizeForCompare(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isIgnored(value, ignoredWords) {
  if (!Array.isArray(ignoredWords) || ignoredWords.length === 0) return false;

  const normalized = normalizeForCompare(value);
  if (!normalized) return false;

  for (const raw of ignoredWords) {
    const word = normalizeForCompare(raw);
    if (!word) continue;
    if (normalized === word) return true;
    if (word.includes(" ") && normalized.includes(word)) return true;
  }

  return false;
}
