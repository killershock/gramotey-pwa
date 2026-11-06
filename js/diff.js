/**
 * Пофрагментное сравнение двух версий текста (слова + пробелы).
 * Возвращает последовательность фрагментов: equal | inserted | deleted.
 */
export function diffTokens(previousText, nextText, limit = 700) {
  const previous = tokenize(previousText);
  const next = tokenize(nextText);

  if (previous.length > limit || next.length > limit) {
    return [{ text: nextText, kind: "equal" }];
  }

  const previousCount = previous.length;
  const nextCount = next.length;
  const table = Array.from({ length: previousCount + 1 }, () => new Uint16Array(nextCount + 1));

  for (let i = previousCount - 1; i >= 0; i -= 1) {
    for (let j = nextCount - 1; j >= 0; j -= 1) {
      table[i][j] = previous[i] === next[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const result = [];
  const push = (text, kind) => {
    const last = result[result.length - 1];
    if (last && last.kind === kind) {
      last.text += text;
    } else {
      result.push({ text, kind });
    }
  };

  let i = 0;
  let j = 0;

  while (i < previousCount && j < nextCount) {
    if (previous[i] === next[j]) {
      push(previous[i], "equal");
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push(previous[i], "deleted");
      i += 1;
    } else {
      push(next[j], "inserted");
      j += 1;
    }
  }

  while (i < previousCount) {
    push(previous[i], "deleted");
    i += 1;
  }

  while (j < nextCount) {
    push(next[j], "inserted");
    j += 1;
  }

  return result;
}

function tokenize(text) {
  const tokens = [];
  let current = "";
  let currentIsWhitespace = null;

  for (const character of text) {
    const isWhitespace = /\s/.test(character);
    if (currentIsWhitespace !== null && isWhitespace !== currentIsWhitespace) {
      tokens.push(current);
      current = character;
    } else {
      current += character;
    }
    currentIsWhitespace = isWhitespace;
  }

  if (current) tokens.push(current);
  return tokens;
}
