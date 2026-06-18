export const DEFAULT_LANGUAGE = "en-GB";

export const LANGUAGE_OPTIONS = [
  { value: DEFAULT_LANGUAGE, label: "🇬🇧 English (UK)" },
  { value: "yue-Hant-HK", label: "🇭🇰 廣東話 (Cantonese)" },
  { value: "zh-CN", label: "🇨🇳 普通话 (Mandarin)" },
  { value: "ja-JP", label: "🇯🇵 日本語 (Japanese)" },
  { value: "ko-KR", label: "🇰🇷 한국어 (Korean)" },
];

export function getPreferredLanguage() {
  if (typeof navigator === "undefined") {
    return DEFAULT_LANGUAGE;
  }

  const browserLanguages = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ].filter(Boolean);

  for (const browserLanguage of browserLanguages) {
    const exactMatch = LANGUAGE_OPTIONS.find((language) => language.value === browserLanguage);

    if (exactMatch) {
      return exactMatch.value;
    }

    const languagePrefix = browserLanguage.toLowerCase().split("-")[0];
    const prefixMatch = LANGUAGE_OPTIONS.find((language) => language.value.toLowerCase().startsWith(languagePrefix));

    if (prefixMatch) {
      return prefixMatch.value;
    }
  }

  return DEFAULT_LANGUAGE;
}
