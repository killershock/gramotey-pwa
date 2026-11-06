export const REWRITE_MODES = [
  { id: "polish", title: "Вычитать", subtitle: "Исправить ошибки, сохранить ваш голос", icon: "i-check" },
  { id: "formal", title: "Официально", subtitle: "Деловой и нейтральный тон", icon: "i-briefcase" },
  { id: "simple", title: "Проще", subtitle: "Простые слова, короткие фразы", icon: "i-bubble" },
  { id: "concise", title: "Короче", subtitle: "Убрать воду и повторы", icon: "i-scissors" },
  { id: "friendly", title: "Дружелюбно", subtitle: "Живой тон без канцелярита", icon: "i-smile" }
];

export const PROVIDERS = {
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
  friendly: "Сделай тон дружелюбным и живым, убери канцелярит. Смысл, факты и структуру сохрани."
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

export async function rewriteText({ text, mode, settings }) {
  const source = text.trim();
  if (!source) throw new AIError("Сначала добавьте текст.", "empty");

  const apiKey = String(settings.apiKey || "").trim();
  if (!apiKey) throw new AIError("Добавьте ключ API в настройках.", "config");

  const base = String(settings.apiBaseURL || "").trim().replace(/\/+$/, "");
  if (!base) throw new AIError("Укажите адрес API в настройках.", "config");

  const model = String(settings.apiModel || "").trim();
  if (!model) throw new AIError("Укажите модель в настройках.", "config");

  const instruction = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.polish;
  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Режим: ${instruction}\n\nЕсли текст уже корректен, верни его без изменений.\n\nТекст:\n${source}`
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
    let message = "";
    try {
      const payload = JSON.parse(raw);
      message = payload?.error?.message || payload?.message || "";
    } catch {
      message = "";
    }
    if (!message) message = `Сервис ответил ошибкой ${response.status}.`;
    throw new AIError(message, "http");
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
