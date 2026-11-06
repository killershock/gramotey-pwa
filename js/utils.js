export function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

export function isLetter(character) {
  return !!character && /\p{L}/u.test(character);
}

export function isUppercaseLetter(character) {
  return !!character && character === character.toUpperCase() && character !== character.toLowerCase();
}

export function detectLanguage(text) {
  let cyrillic = 0;
  let latin = 0;

  for (const character of text) {
    if (/[а-яё]/i.test(character)) {
      cyrillic += 1;
    } else if (/[a-z]/i.test(character)) {
      latin += 1;
    }
  }

  if (cyrillic === 0 && latin === 0) return "ru";
  return cyrillic >= latin ? "ru" : "en";
}

export function formatCount(value) {
  return new Intl.NumberFormat("ru-RU").format(value);
}
