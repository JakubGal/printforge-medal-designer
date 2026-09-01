import { SUPPORTED_LOCALES, TRANSLATIONS, translateMessage } from './localization.js?v=20260901-release34';

const STORAGE_KEY = 'printforge-language-v1';
export const LANGUAGE_CHANGE_EVENT = 'printforge:languagechange';
const TRANSLATABLE_ATTRIBUTES = Object.freeze(['aria-label', 'title', 'placeholder', 'alt', 'content']);
const LOCALE_TAGS = Object.freeze({ en: 'en-GB', sk: 'sk-SK', cs: 'cs-CZ', de: 'de-DE', pl: 'pl-PL' });
const TEXT_STATE = new WeakMap();
const ATTRIBUTE_STATE = new WeakMap();
let observer = null;
let initialized = false;
let currentLocale = 'en';

function localeCode(locale) { return typeof locale === 'string' ? locale : locale?.code; }

function flattenCatalog(value, prefix = '', result = {}) {
  for (const [key, child] of Object.entries(value || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flattenCatalog(child, path, result);
    else if (typeof child === 'string') result[path] = child;
  }
  return result;
}

function normalizedMessage(value) { return String(value ?? '').trim().replace(/\s+/gu, ' ').normalize('NFC'); }
function escapePattern(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+'); }

const ENGLISH_MESSAGES = flattenCatalog(TRANSLATIONS.en);
const MESSAGE_KEYS = new Map();
const MESSAGE_PATTERNS = [];

for (const [key, message] of Object.entries(ENGLISH_MESSAGES)) {
  const normalized = normalizedMessage(message);
  if (!normalized) continue;
  if (!MESSAGE_KEYS.has(normalized)) MESSAGE_KEYS.set(normalized, key);
  const placeholders = [...normalized.matchAll(/\{([A-Za-z_][A-Za-z0-9_.-]*)\}/gu)];
  if (!placeholders.length) continue;
  const literalLength = normalized.replace(/\{[A-Za-z_][A-Za-z0-9_.-]*\}/gu, '').replace(/\s/gu, '').length;
  if (literalLength < 3) continue;
  let cursor = 0;
  let source = '^';
  const names = [];
  for (const match of placeholders) {
    source += escapePattern(normalized.slice(cursor, match.index));
    source += '(.+?)';
    names.push(match[1]);
    cursor = match.index + match[0].length;
  }
  source += `${escapePattern(normalized.slice(cursor))}$`;
  MESSAGE_PATTERNS.push({ key, names, expression: new RegExp(source, 'u'), literalLength });
}
MESSAGE_PATTERNS.sort((left, right) => right.literalLength - left.literalLength);

function supportedLocale(value) {
  const requested = String(value || '').toLowerCase().split(/[-_]/u)[0];
  const normalized = requested === 'cz' ? 'cs' : requested;
  return SUPPORTED_LOCALES.some(locale => localeCode(locale) === normalized) ? normalized : '';
}

function initialLocale() {
  const queryLocale = supportedLocale(new URLSearchParams(window.location.search).get('lang'));
  if (queryLocale) return queryLocale;
  try {
    const stored = supportedLocale(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {}
  return supportedLocale(navigator.language) || 'en';
}

function translateNormalized(source, locale = currentLocale) {
  if (!source || locale === 'en') return source;
  const directKey = MESSAGE_KEYS.get(source);
  if (directKey) return translateMessage(locale, directKey);
  for (const pattern of MESSAGE_PATTERNS) {
    const match = pattern.expression.exec(source);
    if (!match) continue;
    const variables = Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]]));
    return translateMessage(locale, pattern.key, variables);
  }
  return source;
}

export function translateUi(source, locale = currentLocale) {
  const value = String(source ?? '');
  const match = value.match(/^(\s*)(.*?)(\s*)$/su);
  if (!match || !match[2]) return value;
  const normalized = normalizedMessage(match[2]);
  return `${match[1]}${translateNormalized(normalized, locale)}${match[3]}`;
}

export function translateUiKey(key, variables = {}, locale = currentLocale) {
  return translateMessage(locale, key, variables);
}

function ignoredElement(element, { text = false } = {}) {
  if (!element || element.closest?.('script, style, noscript, code, pre, [data-i18n-ignore], [contenteditable="true"]')) return true;
  // Preserve artwork text inside graphical documents, but still localize the
  // accessibility labels on the canvas/SVG controls themselves.
  return text && Boolean(element.closest?.('canvas, svg'));
}

function localizeTextNode(node) {
  if (!node?.parentElement || ignoredElement(node.parentElement, { text: true }) || !node.data.trim()) return;
  let state = TEXT_STATE.get(node);
  if (!state || node.data !== state.lastApplied) state = { source: node.data, lastApplied: null };
  const target = translateUi(state.source);
  state.lastApplied = target;
  TEXT_STATE.set(node, state);
  if (node.data !== target) node.data = target;
}

function attributeMap(element) {
  let map = ATTRIBUTE_STATE.get(element);
  if (!map) { map = new Map(); ATTRIBUTE_STATE.set(element, map); }
  return map;
}

function localizeAttribute(element, name) {
  if (!element?.hasAttribute?.(name) || ignoredElement(element)) return;
  if (name === 'content' && element.tagName !== 'META') return;
  const value = element.getAttribute(name);
  if (!value?.trim()) return;
  const map = attributeMap(element);
  let state = map.get(name);
  if (!state || value !== state.lastApplied) state = { source: value, lastApplied: null };
  const target = translateUi(state.source);
  state.lastApplied = target;
  map.set(name, state);
  if (value !== target) element.setAttribute(name, target);
}

function localizeElement(element) {
  if (ignoredElement(element)) return;
  for (const name of TRANSLATABLE_ATTRIBUTES) localizeAttribute(element, name);
}

export function localizeSubtree(root = document.documentElement) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) { localizeTextNode(root); return; }
  if (root.nodeType === Node.ELEMENT_NODE) localizeElement(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node);
    else localizeElement(node);
    node = walker.nextNode();
  }
}

function updateLanguageControls() {
  document.querySelectorAll('[data-language-select]').forEach(select => { select.value = currentLocale; });
}

export function getCurrentLocale() { return currentLocale; }
export function getCurrentLocaleTag() { return LOCALE_TAGS[currentLocale] || LOCALE_TAGS.en; }
export function formatLocalizedNumber(value, options = {}) {
  return new Intl.NumberFormat(getCurrentLocaleTag(), options).format(Number(value) || 0);
}

export function setCurrentLocale(locale, { persist = true, announce = true, updateUrl = false } = {}) {
  const next = supportedLocale(locale) || 'en';
  const previous = currentLocale;
  currentLocale = next;
  document.documentElement.lang = next;
  document.documentElement.dir = 'ltr';
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }
  if (updateUrl) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', next);
      window.history.replaceState(window.history.state, '', url);
    } catch {}
  }
  updateLanguageControls();
  localizeSubtree(document.documentElement);
  if (announce && previous !== next) window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: { locale: next, previous } }));
  return next;
}

function languageControl(context = 'studio') {
  const label = document.createElement('label');
  label.className = `language-switcher ${context === 'hub' ? 'hub-language-switcher' : ''}`;
  label.title = 'Language';
  label.innerHTML = '<span aria-hidden="true">🌐</span>';
  const select = document.createElement('select');
  select.dataset.languageSelect = '';
  select.setAttribute('aria-label', 'Choose language');
  for (const locale of SUPPORTED_LOCALES) {
    const code = localeCode(locale);
    const option = document.createElement('option');
    option.value = code;
    option.textContent = String(locale.short || code).toUpperCase();
    option.title = locale.nativeName || locale.nativeLabel || locale.label || code;
    select.append(option);
  }
  select.value = currentLocale;
  select.addEventListener('change', event => setCurrentLocale(event.target.value, { updateUrl: true }));
  label.append(select);
  return label;
}

function mountLanguageControl(context) {
  if (document.querySelector('[data-language-select]')) return;
  const control = languageControl(context);
  if (context === 'hub') {
    const navigation = document.querySelector('.hub-header nav');
    const action = navigation?.querySelector('.header-cta');
    if (navigation) navigation.insertBefore(control, action || null);
    return;
  }
  const actions = document.querySelector('.top-actions');
  const mode = actions?.querySelector('.mode-pill');
  if (mode) mode.after(control);
  else actions?.prepend(control);
}

function startObserver() {
  observer?.disconnect();
  observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') localizeTextNode(record.target);
      else if (record.type === 'attributes') localizeAttribute(record.target, record.attributeName);
      else for (const node of record.addedNodes) localizeSubtree(node);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATABLE_ATTRIBUTES,
  });
}

function highConfidenceEnglish(value) {
  const text = normalizedMessage(value);
  return text.length > 7 && /\b(?:the|your|this|and|or|to|from|with|for|click|drag|choose|select|open|close|save|download|create|make|add|remove|new|back|front|settings|guide|checks?|colors?|medal)\b/iu.test(text);
}

export function auditVisibleTranslations(root = document.body) {
  const missing = new Set();
  if (currentLocale === 'en' || !root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (!ignoredElement(node.parentElement, { text: true }) && node.data.trim()) {
      const state = TEXT_STATE.get(node);
      const source = normalizedMessage(state?.source || node.data);
      if (translateNormalized(source) === source && highConfidenceEnglish(source)) missing.add(source);
    }
    node = walker.nextNode();
  }
  return [...missing].sort((left, right) => left.localeCompare(right));
}

export function initializeLocalization({ context = 'studio' } = {}) {
  if (!initialized) {
    currentLocale = initialLocale();
    initialized = true;
    mountLanguageControl(context);
    document.documentElement.lang = currentLocale;
    localizeSubtree(document.documentElement);
    startObserver();
    Object.defineProperty(window, 'MedalForgeI18n', {
      configurable: true,
      value: Object.freeze({
        locales: SUPPORTED_LOCALES,
        getLocale: getCurrentLocale,
        setLocale: setCurrentLocale,
        audit: auditVisibleTranslations,
      }),
    });
  }
  return Object.freeze({ locale: currentLocale, setLocale: setCurrentLocale, localize: localizeSubtree });
}
