/** Language normalization only; never use this to rewrite catalog identifiers. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, '')
    .replace(/[\u0640\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu, '')
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/[ىی]/gu, 'ي')
    .replace(/ک/gu, 'ك')
    .replace(/[٠-٩]/gu, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, digit => String(digit.charCodeAt(0) - 0x06f0))
    // STT providers occasionally join adjacent Arabic and Latin words. A
    // script transition is a safe lexical boundary; digits stay attached for
    // Arabizi, sizes, SKUs and other alphanumeric vocabulary.
    .replace(/(?<=\p{Script=Arabic})(?=\p{Script=Latin})|(?<=\p{Script=Latin})(?=\p{Script=Arabic})/gu, ' ')
    // Keep Arabizi digits attached to letters; punctuation separates whole tokens.
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function tokenizeText(text: string): readonly string[] {
  const normalized = normalizeText(text)
  return Object.freeze(normalized ? normalized.split(' ') : [])
}
