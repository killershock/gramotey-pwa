// Грамотей — темы.
//
// Тема хранится в настройках: "system" | "light" | "dark" | id своей темы.
// "system" разрешается в светлую или тёмную по настройке устройства.
// У своей темы задаются четыре цвета, остальные переменные вычисляются здесь,
// чтобы в CSS не расползались десятки ручных значений.

export const THEME_CACHE_KEY = "gramotey.theme.v1";

export const PRESETS = [
  { id: "system", name: "Как на устройстве", hint: "День — светлая, ночь — тёмная" },
  { id: "light", name: "Светлая" },
  { id: "dark", name: "Тёмная" }
];

export const CUSTOM_DEFAULTS = {
  name: "Моя тема",
  bg: "#f2f4f9",
  surface: "#ffffff",
  text: "#131a2a",
  accent: "#2f66d0"
};

export const PRESET_META = {
  light: "#f2f4f9",
  dark: "#0c111b"
};

// MARK: - Цветовые утилиты

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function parseHex(value) {
  let hex = String(value || "").trim().replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

function toHex({ r, g, b }) {
  return (
    "#" +
    [r, g, b]
      .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function mix(from, to, t) {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return from;
  const k = clamp(Number(t) || 0, 0, 1);
  return toHex({
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k
  });
}

function alpha(hex, a) {
  const c = parseHex(hex);
  if (!c) return hex;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${clamp(a, 0, 1)})`;
}

function shade(hex, amount) {
  return amount >= 0 ? mix(hex, "#ffffff", amount) : mix(hex, "#000000", -amount);
}

/** Простая яркость 0..1 — по ней решаем, тёмная тема или светлая. */
export function brightness(hex) {
  const c = parseHex(hex);
  if (!c) return 1;
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

/** Цвет текста поверх акцентной кнопки. */
export function onColor(hex) {
  return brightness(hex) > 0.62 ? "#101828" : "#ffffff";
}

function channelLum(value) {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex) {
  const c = parseHex(hex);
  if (!c) return 1;
  return 0.2126 * channelLum(c.r) + 0.7152 * channelLum(c.g) + 0.0722 * channelLum(c.b);
}

/** Контраст по WCAG: 1 — невидимо, 21 — чёрное на белом. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

// MARK: - Переменные темы

const VAR_KEYS = [
  "--bg",
  "--bg-translucent",
  "--bg-elev",
  "--bg-soft",
  "--text",
  "--muted",
  "--muted-2",
  "--line",
  "--accent",
  "--accent-strong",
  "--accent-soft",
  "--ok",
  "--warn",
  "--danger",
  "--switch-bg",
  "--shadow",
  "--shadow-lg"
];

function safeColor(value, fallback) {
  return parseHex(value) ? value : fallback;
}

/** Из четырёх цветов получаем полный набор переменных оформления. */
export function customVars(theme) {
  const bg = safeColor(theme && theme.bg, CUSTOM_DEFAULTS.bg);
  const surface = safeColor(theme && theme.surface, CUSTOM_DEFAULTS.surface);
  const text = safeColor(theme && theme.text, CUSTOM_DEFAULTS.text);
  const accent = safeColor(theme && theme.accent, CUSTOM_DEFAULTS.accent);
  const dark = brightness(bg) < 0.5;

  return {
    "--bg": bg,
    "--bg-translucent": alpha(bg, 0.88),
    "--bg-elev": surface,
    "--bg-soft": mix(bg, surface, 0.65),
    "--text": text,
    "--muted": mix(text, bg, 0.42),
    "--muted-2": mix(text, bg, 0.64),
    "--line": alpha(text, 0.12),
    "--accent": accent,
    "--accent-strong": dark ? shade(accent, 0.3) : shade(accent, -0.28),
    "--accent-soft": alpha(accent, dark ? 0.22 : 0.12),
    "--ok": dark ? "#34d399" : "#12864a",
    "--warn": dark ? "#fbbf24" : "#b45309",
    "--danger": dark ? "#f87171" : "#b91c1c",
    "--switch-bg": mix(surface, text, dark ? 0.26 : 0.18),
    "--shadow": dark ? "0 12px 30px rgba(0, 0, 0, 0.45)" : "0 10px 28px rgba(18, 30, 60, 0.08)",
    "--shadow-lg": dark ? "0 30px 80px rgba(0, 0, 0, 0.6)" : "0 24px 70px rgba(10, 18, 40, 0.22)"
  };
}

// MARK: - Разрешение темы

export function prefersDark() {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function findCustomTheme(settings, id) {
  const list = settings && Array.isArray(settings.customThemes) ? settings.customThemes : [];
  return list.find((item) => item && item.id === id) || null;
}

/**
 * Возвращает { mode, vars, colorScheme, metaColor }.
 * mode: "light" | "dark" | "custom".
 */
export function buildTheme(settings) {
  const id = (settings && settings.theme) || "system";

  if (id === "custom") {
    return presetTheme(prefersDark());
  }

  if (id === "system") {
    return presetTheme(prefersDark());
  }

  if (id === "light" || id === "dark") {
    return presetTheme(id === "dark");
  }

  const custom = findCustomTheme(settings, id);
  if (!custom) return presetTheme(prefersDark());

  return {
    mode: "custom",
    vars: customVars(custom),
    colorScheme: brightness(custom.bg) < 0.5 ? "dark" : "light",
    metaColor: safeColor(custom.surface, custom.bg)
  };
}

function presetTheme(isDark) {
  return {
    mode: isDark ? "dark" : "light",
    vars: null,
    colorScheme: isDark ? "dark" : "light",
    metaColor: isDark ? PRESET_META.dark : PRESET_META.light
  };
}

// MARK: - Применение

function cacheTheme(theme) {
  try {
    localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({
        mode: theme.mode,
        vars: theme.vars,
        colorScheme: theme.colorScheme,
        metaColor: theme.metaColor
      })
    );
  } catch {
    /* приватный режим — не страшно, тема применится из настроек */
  }
}

function updateMetaColor(color) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && color) meta.setAttribute("content", color);
}

function clearVars(root) {
  for (const key of VAR_KEYS) root.style.removeProperty(key);
}

export function applyTheme(settings) {
  const root = document.documentElement;
  const theme = buildTheme(settings);

  root.dataset.theme = theme.mode;

  if (theme.vars) {
    for (const [key, value] of Object.entries(theme.vars)) root.style.setProperty(key, value);
  } else {
    clearVars(root);
  }

  root.style.colorScheme = theme.colorScheme;
  updateMetaColor(theme.metaColor);
  cacheTheme(theme);
  return theme;
}
