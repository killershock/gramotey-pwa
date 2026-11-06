export const REWRITE_MODES = [
  { id: "polish", title: "Исправить", subtitle: "Ошибки и аккуратная правка, сохранить голос", icon: "i-check" },
  { id: "translate", title: "Перевести", subtitle: "На другой язык, сохранив смысл", icon: "i-globe" },
  { id: "formal", title: "Официально", subtitle: "Деловой и нейтральный тон", icon: "i-briefcase" },
  { id: "concise", title: "Короче", subtitle: "Убрать воду и повторы", icon: "i-scissors" },
  { id: "simple", title: "Проще", subtitle: "Простые слова, короткие фразы", icon: "i-bubble" },
  { id: "friendly", title: "Дружелюбно", subtitle: "Живой тон без канцелярита", icon: "i-smile" },
  { id: "tribal", title: "Племенной", subtitle: "Коротко и по-варварски", icon: "i-flame" },
  { id: "corp", title: "Корпоративный", subtitle: "Канцелярит и синергия", icon: "i-chart" },
  { id: "zen", title: "Дзен", subtitle: "Спокойно и минималистично", icon: "i-leaf" },
  { id: "biblical", title: "Библейский", subtitle: "Торжественно и архаично", icon: "i-book" },
  { id: "viking", title: "Викинг", subtitle: "Сурово и эпично", icon: "i-shield" }
];

export const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.5-flash-lite"
  },
  openai: { label: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { label: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  deepseek: { label: "DeepSeek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  custom: { label: "Свой", baseURL: "", model: "" }
};

const MODE_INSTRUCTIONS = {
  polish: "Исправь орфографию, пунктуацию и грамматику. Сделай текст аккуратным, сохранив авторский голос, порядок мыслей и все детали.",
  formal: "Перепиши текст в официально-деловом стиле: нейтрально, вежливо, без разговорных выражений. Смысл и факты сохрани полностью.",
  simple: "Упрости формулировки: разбей длинные предложения, замени сложные слова понятными. Смысл, имена, числа и факты сохрани.",
  concise: "Сократи текст, убери повторы и воду. Сохрани все важные детали, факты, имена и числа. Не добавляй ничего нового.",
  friendly: "Сделай тон дружелюбным и живым, убери канцелярит. Смысл, факты и структуру сохрани.",
  tribal: "Перепиши в стиле древнего племени: короткие рубленые фразы, простые сильные слова, архаичная интонация. Смысл, факты и имена сохрани.",
  corp: "Перепиши в корпоративном стиле: деловая лексика, канцелярит, слова вроде «синергия», «процессы», «оптимизация». Смысл сохрани.",
  zen: "Перепиши в стиле дзен: спокойно, созерцательно, минималистично, короткими фразами. Смысл и факты сохрани.",
  biblical: "Перепиши в библейском стиле: торжественно, архаично, с библейскими оборотами и ритмом. Смысл, факты и имена сохрани.",
  viking: "Перепиши в стиле викинга: сурово, эпично, с северными образами и короткими фразами. Смысл, факты и имена сохрани."
};

export class AIError extends Error {
  constructor(message, code = "error") {
    super(message);
    this.name = "AIError";
    this.code = code;
  }
}

const SYSTEM_PROMPT = `Ты — профессиональный редактор текстов на русском и английском языках.
Правила:
1. Исправляй орфографию, пунктуацию, грамматику и согласование.
2. Полностью сохраняй смысл: факты, имена, названия, числа, даты, ссылки и структуру абзацев.
3. Не добавляй новую информацию и не выбрасывай важные детали.
4. Не меняй язык текста.
5. Не используй markdown, не добавляй пояснения, заголовки и кавычки вокруг ответа.
Возвращай только итоговый текст.`;

export async function rewriteText({ text, mode, targetLanguage, settings }) {
  const source = text.trim();
  if (!source) throw new AIError("Сначала добавьте текст.", "empty");

  const apiKey = String(settings.apiKey || "").trim();
  if (!apiKey) throw new AIError("Добавьте ключ API в настройках.", "config");

  const base = normalizeBaseURL(settings.apiBaseURL);
  if (!base) throw new AIError("Укажите адрес API в настройках.", "config");

  const model = String(settings.apiModel || "").trim();
  if (!model) throw new AIError("Укажите модель в настройках.", "config");

  const isTranslate = mode === "translate";
  const instruction = isTranslate
    ? `Переведи текст на ${targetLanguage || "русский"}. Сохрани смысл, имена, числа, ссылки и структуру абзацев. Верни только перевод.`
    : (MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.polish);

  const systemContent = isTranslate
    ? SYSTEM_PROMPT.replace(
        "4. Не меняй язык текста.",
        "4. Переведи текст на язык, указанный в задании."
      )
    : SYSTEM_PROMPT;

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemContent },
      {
        role: "user",
        content: isTranslate
          ? `Задача: ${instruction}\n\nТекст:\n${source}`
          : `Режим: ${instruction}\n\nЕсли текст уже корректен, верни его без изменений.\n\nТекст:\n${source}`
      }
    ]
  };

  let response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new AIError(
      "Не удалось связаться с сервисом. Проверьте интернет и адрес API. Если сервис не разрешает запросы из браузера (CORS), используйте прокси.",
      "network"
    );
  }

  const raw = await response.text();

  if (!response.ok) {
    const message = extractErrorMessage(raw);
    const hint = response.status === 404 && !/model|модел/i.test(message)
      ? " Проверьте адрес API — он должен начинаться с https:// и заканчиваться на /openai или /v1."
      : "";

    throw new AIError(
      message
        ? `${message}${hint}`
        : `Сервис ответил ошибкой ${response.status}.${hint}`,
      "http"
    );
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new AIError("Сервис вернул неожиданный ответ. Проверьте адрес API и модель.", "parse");
  }

  const content = extractContent(payload?.choices?.[0]?.message?.content);
  const cleaned = cleanup(content);
  if (!cleaned) throw new AIError("Модель вернула пустой текст. Попробуйте ещё раз.", "empty");

  return cleaned;
}

function extractContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

function normalizeBaseURL(value) {
  let base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return "";

  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }

  return base.replace(/\/chat\/completions$/i, "");
}

function extractErrorMessage(raw) {
  try {
    let payload = JSON.parse(raw);
    if (Array.isArray(payload)) payload = payload[0];

    const message = payload?.error?.message || payload?.message || payload?.detail;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  } catch {
    // Ответ не JSON — ниже попробуем вытащить текст из HTML.
  }

  return String(raw || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function cleanup(value) {
  let result = String(value || "").trim();

  if (result.startsWith("```")) {
    const lines = result.split("\n");
    lines.shift();
    if (lines.length && lines[lines.length - 1].trim().startsWith("```")) {
      lines.pop();
    }
    result = lines.join("\n").trim();
  }

  return result;
}
