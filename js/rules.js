import { detectLanguage, isLetter, isUppercaseLetter } from "./utils.js";
export const KIND_META = {
  spelling: { title: "Орфография", color: "#dc2626" },
  punctuation: { title: "Пунктуация", color: "#2563eb" },
  casing: { title: "Заглавные", color: "#0284c7" },
  grammar: { title: "Грамматика", color: "#7c3aed" },
  spacing: { title: "Пробелы", color: "#0d9488" },
  duplicate: { title: "Повтор", color: "#9333ea" },
  style: { title: "Стиль", color: "#b45309" }
};

const ABBREVIATIONS = new Set([
  "т", "е", "г", "д", "п", "с", "ул", "рис", "стр", "см", "др", "им",
  "проф", "акад", "напр", "тыс", "млн", "млрд", "руб", "коп", "гг", "вв"
]);

let issueSequence = 0;

/**
 * Быстрые офлайн-правила: пробелы, тире, кавычки, многоточие,
 * заглавные буквы и повторы слов.
 */
export function runLocalCheck(text, options = {}) {
  const issues = [];
  if (!text) return issues;

  const language = options.language || "auto";
  const isRussian = language === "ru" || (language === "auto" && detectLanguage(text) === "ru");

  const add = (kind, start, end, message, suggestions, insertion = false) => {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (start < 0 || end < start || start > text.length || end > text.length) return;
    issues.push({
      id: `local-${++issueSequence}`,
      kind,
      start,
      end,
      original: text.slice(start, end),
      insertion,
      message,
      suggestions,
      source: "local"
    });
  };

  // 1. Несколько пробелов подряд.
  for (const match of text.matchAll(/[ \t]{2,}/g)) {
    const start = match.index;
    if (start > 0 && /[\n\r]/.test(text[start - 1])) continue;
    add("spacing", start, start + match[0].length, "Здесь несколько пробелов подряд — нужен один.", [
      { label: "Оставить один пробел", value: " " }
    ]);
  }

  // 2. Пробел перед знаком препинания.
  for (const match of text.matchAll(/[ \t]+([,.;:!?…])/g)) {
    const punctuation = match[1];
    const start = match.index;
    const previous = start > 0 ? text[start - 1] : "";
    if (/\d/.test(previous) && (punctuation === "." || punctuation === ",")) continue;

    add("spacing", start, start + match[0].length, `Перед знаком «${punctuation}» пробел не нужен.`, [
      { label: "Убрать пробел", value: punctuation }
    ]);
  }

  // 3. Нет пробела после точки, «!», «?» или многоточия перед заглавной.
  for (const match of text.matchAll(/([.!?…])(?=[А-ЯЁA-Z])/g)) {
    const start = match.index;
    const mark = match[1];
    const previous = start > 0 ? text[start - 1] : "";
    if (isUppercaseLetter(previous)) continue;

    add("punctuation", start + mark.length, start + mark.length, `После знака «${mark}» нужен пробел.`, [
      { label: "Добавить пробел", value: " " }
    ], true);
  }

  // 4. Нет пробела после запятой, точки с запятой или двоеточия.
  for (const match of text.matchAll(/([,;:])(?=[\p{L}])/gu)) {
    const index = match.index;
    if (index > 0 && index + 1 < text.length) {
      const before = text[index - 1];
      const after = text[index + 1];
      if (/\d/.test(before) && /\d/.test(after)) continue;
    }

    const mark = match[1];
    add("punctuation", index + 1, index + 1, `После знака «${mark}» нужен пробел.`, [
      { label: "Добавить пробел", value: " " }
    ], true);
  }

  // 5. Многоточие.
  for (const match of text.matchAll(/\.{2,}/g)) {
    const start = match.index;
    const previous = start > 0 ? text[start - 1] : "";
    if ("/:=".includes(previous)) continue;

    add("punctuation", start, start + match[0].length, "Многоточие оформляется одним знаком «…».", [
      { label: "Заменить на «…»", value: "…" }
    ]);
  }

  // 6. Тире в русском тексте.
  if (isRussian) {
    for (const match of text.matchAll(/[ \t]+[-–][ \t]+/g)) {
      const start = match.index;
      const end = start + match[0].length;
      if (start === 0 || end >= text.length) continue;
      if (!isLetter(text[start - 1]) || !isLetter(text[end])) continue;

      add("punctuation", start, end, "В русском тексте между словами ставится тире (—).", [
        { label: "Поставить «—»", value: " — " }
      ]);
    }

    for (const match of text.matchAll(/[—–]/g)) {
      const index = match.index;
      if (index === 0 || index + 1 >= text.length) continue;
      if (!isLetter(text[index - 1]) || !isLetter(text[index + 1])) continue;

      add("punctuation", index, index + 1, "Тире нужно отделить пробелами.", [
        { label: "Поставить «—»", value: " — " }
      ]);
    }
  }

  // 7. Кавычки-ёлочки.
  if (isRussian) {
    const positions = [];
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '"') positions.push(index);
    }

    if (positions.length >= 2 && positions.length % 2 === 0) {
      positions.forEach((position, index) => {
        const value = index % 2 === 0 ? "«" : "»";
        add("style", position, position + 1, "В русском тексте используют кавычки-ёлочки: «…».", [
          { label: value, value }
        ]);
      });
    }
  }

  // 8. Заглавная буква в начале предложения.
  const capitalization = isRussian ? /([.!?…])[ \t]+([а-яё])/g : /([.!?…])[ \t]+([a-z])/g;
  for (const match of text.matchAll(capitalization)) {
    const punctuationIndex = match.index;
    const letterIndex = punctuationIndex + match[0].length - 1;

    let wordStart = punctuationIndex;
    while (wordStart > 0 && isLetter(text[wordStart - 1])) wordStart -= 1;
    const previousWord = text.slice(wordStart, punctuationIndex).toLowerCase();

    if (previousWord.length <= 1 || ABBREVIATIONS.has(previousWord)) continue;
    if (punctuationIndex > 0 && isUppercaseLetter(text[punctuationIndex - 1])) continue;

    const letter = text[letterIndex];
    add("casing", letterIndex, letterIndex + 1, "Предложение начинается с заглавной буквы.", [
      { label: "Сделать заглавной", value: letter.toUpperCase() }
    ]);
  }

  // 9. Повтор слова.
  // \b в JavaScript не считает кириллицу словом, поэтому границы заданы
  // через Unicode-свойства и захват предыдущего символа.
  const duplicatePattern = /(^|[^\p{L}\p{M}])([\p{L}\p{M}]{2,})([ \t]+)\2(?![\p{L}\p{M}])/giu;
  for (const match of text.matchAll(duplicatePattern)) {
    const prefix = match[1] || "";
    const word = match[2];
    const start = match.index + prefix.length;
    const end = match.index + match[0].length;

    add("duplicate", start, end, `Слово «${word}» повторяется дважды.`, [
      { label: "Удалить повтор", value: word }
    ]);
  }

  // 10. Пропущенные запятые в частых конструкциях.
  if (isRussian) {
    addMissingCommas(text, add);
  }

  return issues;
}

// --- Запятые -------------------------------------------------------------
// Правила сознательно узкие: только конструкции, где запятая почти всегда
// обязательна. Сложные случаи (придаточные, вводные слова) не трогаем —
// их надёжнее отдать ИИ-редактору.

const PARTICLE_WORDS = new Set(["бы", "б", "ли", "ль", "же", "ж"]);

// Слова, после которых запятая ставится перед союзом, а не после него.
const LINK_WORDS = new Set([
  "и", "а", "но", "да", "или", "либо", "даже", "только", "лишь", "ведь",
  "же", "ни", "не", "то", "ну", "вот", "как", "именно", "просто", "ещё", "еще", "раз"
]);

const PREPOSITIONS = new Set([
  "в", "во", "на", "с", "со", "о", "об", "обо", "по", "при", "для", "из",
  "от", "до", "к", "ко", "у", "без", "под", "над", "за", "про", "через",
  "между", "около", "кроме", "после", "перед", "вместо", "благодаря",
  "согласно", "вопреки"
]);

// Глаголы и слова со значением «говорю / думаю / чувствую».
const SPEECH_WORDS = new Set([
  "думаю", "думаешь", "думает", "думаем", "думаете", "думают",
  "думал", "думала", "думали", "думать", "думается",
  "знаю", "знаешь", "знает", "знаем", "знаете", "знают",
  "знал", "знала", "знали", "знать",
  "понимаю", "понимаешь", "понимает", "понимаем", "понимаете", "понимают",
  "понял", "поняла", "поняли", "понимать",
  "считаю", "считаешь", "считает", "считаем", "считаете", "считают",
  "считал", "считала", "считали",
  "сказал", "сказала", "сказали", "скажу", "скажешь", "скажет",
  "скажем", "скажете", "скажут", "сказать",
  "говорю", "говоришь", "говорит", "говорим", "говорите", "говорят",
  "говорил", "говорила", "говорили",
  "сообщил", "сообщила", "сообщили", "ответил", "ответила", "ответили",
  "спросил", "спросила", "спросили", "уточнил", "уточнила", "уточнили",
  "надеюсь", "надеемся", "надеялся", "надеялась", "надеялись",
  "уверен", "уверена", "уверены",
  "вижу", "видишь", "видит", "видим", "видите", "видят",
  "видел", "видела", "видели",
  "слышал", "слышала", "слышали", "слышу", "слышишь", "слышит",
  "чувствую", "чувствуешь", "чувствует", "чувствовал", "чувствовала",
  "заметил", "заметила", "заметили",
  "кажется", "казалось",
  "ясно", "понятно", "известно", "важно", "странно", "интересно",
  "хорошо", "плохо", "жаль", "обидно", "видно", "слышно"
]);

// Слова, после которых «чтобы» вводит придаточную часть цели.
const PURPOSE_WORDS = new Set([
  "хочу", "хочешь", "хочет", "хотим", "хотите", "хотят",
  "хотел", "хотела", "хотели", "хотеть",
  "надо", "нужно", "важно", "необходимо", "можно", "нельзя",
  "прошу", "просил", "просила", "просили", "попросил", "попросила", "попросили",
  "сказал", "сказала", "сказали", "скажи", "скажите",
  "решил", "решила", "решили", "стараюсь", "старайся", "старайтесь",
  "следи", "следите", "проверь", "проверьте"
]);

function addMissingCommas(text, add) {
  const addComma = (position, message) => {
    const before = position > 0 ? text[position - 1] : "";
    if (!/[\p{L}\p{N}»")\]]/u.test(before)) return;
    add("punctuation", position, position, message, [
      { label: "Поставить запятую", value: "," }
    ], true);
  };

  // «… что», «… чтобы», «… если» и другие союзы.
  // Захватываем слово перед союзом и слово после, чтобы проверить соседей.
  const conjunctionPattern = /([\p{L}]+)([ \t]+)(что|чтобы|если|когда|где|куда|хотя|потому)([ \t]+)([\p{L}]+)/giu;

  for (const match of text.matchAll(conjunctionPattern)) {
    const previous = match[1].toLowerCase();
    const word = match[3].toLowerCase();
    const next = match[5].toLowerCase();

    // «хотя бы», «что ли», «если же» — союз не вводит придаточную часть.
    if (PARTICLE_WORDS.has(next)) continue;
    if (LINK_WORDS.has(previous)) continue;

    // «хотя и устал» — устойчивая пара, запятая перед «хотя» не нужна.
    if (word === "хотя" && next === "и") continue;

    if (word === "что") {
      if (!SPEECH_WORDS.has(previous)) continue;
      addComma(match.index + match[1].length, "Перед «что» нужна запятая.");
      continue;
    }

    if (word === "чтобы") {
      if (!PURPOSE_WORDS.has(previous)) continue;
      addComma(match.index + match[1].length, "Перед «чтобы» нужна запятая.");
      continue;
    }

    if (word === "потому") {
      if (next !== "что") continue;
      addComma(match.index + match[1].length, "Перед «потому что» нужна запятая.");
      continue;
    }

    // «если», «когда», «где», «куда», «хотя» — придаточная часть.
    if (PREPOSITIONS.has(previous)) continue;
    addComma(match.index + match[1].length, `Перед «${word}» нужна запятая.`);
  }

  // «а» и «но» между частями предложения: «пришел домой, а мама спала».
  // Пропускаем «а не», «а также», «а именно» и подобные обороты.
  const contrastPattern = /([\p{L}]+)([ \t]+)(а|но)([ \t]+)([\p{L}]+)/giu;
  const A_SKIP_NEXT = new Set([
    "не", "также", "именно", "значит", "потом", "затем", "вот",
    "еще", "ещё", "просто", "теперь", "сейчас", "ли", "бы", "же"
  ]);

  for (const match of text.matchAll(contrastPattern)) {
    const previous = match[1].toLowerCase();
    const word = match[3].toLowerCase();
    const next = match[5].toLowerCase();

    if (LINK_WORDS.has(previous)) continue;
    if (PARTICLE_WORDS.has(next)) continue;
    if (word === "а" && A_SKIP_NEXT.has(next)) continue;

    addComma(match.index + match[1].length, `Перед «${word}» нужна запятая.`);
  }

  // «который» и его формы. Запятая ставится перед предлогом, если он есть:
  // «дом, в котором…», но «дом, который…».
  const prepositionPrefix = [
    "в", "во", "на", "с", "со", "о", "об", "обо", "по", "при", "для", "из",
    "от", "до", "к", "ко", "у", "без", "под", "над", "за", "про", "через",
    "между", "около", "кроме", "после", "перед", "вместо", "благодаря",
    "согласно", "вопреки"
  ].join("|");

  const whichPattern = new RegExp(
    `([\\p{L}]+)([ \\t]+)((?:${prepositionPrefix})[ \\t]+)?(котор[а-яё]+)([ \\t]+)([\\p{L}]+)`,
    "giu"
  );

  for (const match of text.matchAll(whichPattern)) {
    const previous = match[1].toLowerCase();
    if (LINK_WORDS.has(previous)) continue;
    if (!match[3] && PREPOSITIONS.has(previous)) continue;

    addComma(match.index + match[1].length, "Перед «который» нужна запятая.");
  }
}
