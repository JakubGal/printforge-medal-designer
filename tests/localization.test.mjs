import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SUPPORTED_LOCALES,
  TRANSLATIONS,
  translateMessage,
} from '../localization.js';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root));
const EXPECTED_LOCALES = ['en', 'sk', 'cs', 'de', 'pl'];
const EXPECTED_NATIVE_NAMES = {
  en: 'English',
  sk: 'Slovenčina',
  cs: 'Čeština',
  de: 'Deutsch',
  pl: 'Polski',
};

const REQUIRED_SECTIONS = [
  'language',
  'common',
  'header',
  'tools',
  'workspace',
  'camera',
  'setup',
  'medal',
  'add',
  'text',
  'shapes',
  'draw',
  'image',
  'ideas',
  'items',
  'filament',
  'checks',
  'pricing',
  'export',
  'guides',
  'renderStudio',
  'status',
  'errors',
  'accessibility',
  'hub',
];

// These are deliberately limited to the persistent editor chrome. Keeping this
// list small avoids treating project names, units, file formats, and examples as
// untranslated UI while still catching a disconnected or incomplete catalog.
const REQUIRED_VISIBLE_MESSAGES = [
  'Current design',
  'My medals',
  'New medal',
  'Examples',
  'Guides',
  'Save a copy',
  'Check & export',
  'Add',
  'Medal',
  'Items',
  'Front side',
  'Back side',
  'Fit view',
  'Print layers',
  'Render images',
  'Printer & materials',
  'Colors in this medal',
  'Nozzle size',
  'Quantity',
  'Estimated total',
];

const REQUIRED_DYNAMIC_MESSAGES = [
  'Raised',
  'Recessed',
  'Flat color',
  'Hole',
  'Show item',
  'Fix automatically',
  'No blocking issues',
  'Advanced design files',
  'Continue in CAD',
  'Restart interactive guide',
  'Start a new medal',
  'Medal image studio',
  'Glow preview',
  'Light + dark image',
  '4-view sheet',
];

const REQUIRED_DIACRITICS = {
  sk: ['á', 'č', 'ľ', 'š', 'ť', 'ž'],
  cs: ['á', 'č', 'ě', 'ř', 'š', 'ž'],
  de: ['ä', 'ö', 'ü', 'ß'],
  pl: ['ą', 'ć', 'ę', 'ł', 'ń', 'ó', 'ś', 'ż'],
};

function localeCode(locale) {
  return typeof locale === 'string' ? locale : locale?.code;
}

function flattenCatalog(value, prefix = '', result = {}) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${prefix || 'catalog'} must be an object`);
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flattenCatalog(child, path, result);
    else result[path] = child;
  }
  return result;
}

function placeholders(value) {
  // Supports the catalog's {name} placeholders as well as common printf and
  // template-literal forms, so a later catalog migration remains protected.
  const tokens = [];
  for (const match of value.matchAll(/\{\{?\s*([\p{L}_][\p{L}\p{N}_.-]*)\s*\}\}?|\$\{\s*([\p{L}_][\p{L}\p{N}_.-]*)\s*\}|%(?:(\d+)\$)?([sdif])/gu)) {
    tokens.push(match[1] || match[2] || `${match[3] || ''}${match[4]}`);
  }
  return tokens.sort();
}

function normalizedText(value) {
  return value.trim().replace(/\s+/gu, ' ').normalize('NFC');
}

function isHighConfidenceEnglishUi(value) {
  const text = normalizedText(value);
  if (text.length < 8 || !/[A-Za-z]/u.test(text)) return false;
  if (/^(?:MedalForge|(?:2|3)D|STL|3MF|STEP|SVG|DXF|PDF|PNG|JPEG|WebP|mm)(?:\s|$)/u.test(text)) return false;
  return /\b(?:the|your|this|and|or|to|from|with|for|click|drag|choose|select|open|close|save|download|create|make|add|remove|new|back|front|settings|guide|checks?|colors?|medal)\b/iu.test(text);
}

function decodeUtf8Strict(buffer, label) {
  let decoded;
  assert.doesNotThrow(() => {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  }, `${label} must be valid UTF-8`);
  return decoded;
}

const flattened = Object.fromEntries(
  EXPECTED_LOCALES.filter(locale => TRANSLATIONS?.[locale]).map(locale => [locale, flattenCatalog(TRANSLATIONS[locale])]),
);

test('the language chooser exposes exactly the five supported locales with native names', () => {
  assert.ok(Array.isArray(SUPPORTED_LOCALES), 'SUPPORTED_LOCALES must be an array');
  const codes = SUPPORTED_LOCALES.map(localeCode);
  assert.deepEqual(codes, EXPECTED_LOCALES);
  assert.equal(new Set(codes).size, EXPECTED_LOCALES.length, 'locale codes must be unique');

  for (const locale of SUPPORTED_LOCALES) {
    const code = localeCode(locale);
    const metadataName = typeof locale === 'object'
      ? locale.nativeName || locale.nativeLabel || locale.label || locale.name
      : undefined;
    const catalogName = flattened.en?.[`language.${code}`];
    assert.equal(metadataName || catalogName, EXPECTED_NATIVE_NAMES[code], `${code} needs its correctly spelled native language name`);
  }
});

test('all locale catalogs are complete, non-empty, and structurally identical to English', () => {
  assert.deepEqual(Object.keys(TRANSLATIONS).sort(), [...EXPECTED_LOCALES].sort());
  const englishKeys = Object.keys(flattened.en).sort();
  assert.ok(englishKeys.length >= 100, `expected broad whole-app coverage, received only ${englishKeys.length} messages`);

  for (const section of REQUIRED_SECTIONS) {
    assert.ok(englishKeys.some(key => key === section || key.startsWith(`${section}.`)), `English catalog is missing the ${section} section`);
  }

  for (const locale of EXPECTED_LOCALES) {
    const catalog = flattened[locale];
    assert.ok(catalog, `missing ${locale} catalog`);
    assert.deepEqual(Object.keys(catalog).sort(), englishKeys, `${locale} keys must exactly match the English schema`);
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string`);
      assert.ok(value.trim(), `${locale}.${key} must not be empty or whitespace-only`);
    }
  }
});

test('localization sources and messages remain valid, normalized UTF-8 without mojibake', async () => {
  const source = decodeUtf8Strict(await read('localization.js'), 'localization.js');
  const combined = `${source}\n${Object.values(flattened).flatMap(catalog => Object.values(catalog)).join('\n')}`;

  assert.doesNotMatch(combined, /\uFFFD/u, 'replacement characters indicate damaged text');
  assert.doesNotMatch(combined, /[\u0080-\u009F]/u, 'C1 control characters usually indicate broken UTF-8 decoding');
  assert.doesNotMatch(combined, /(?:Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â(?:€|€™|€œ|€�|€¦|€“|€”|€¢)|Ä[\u0080-\u00BF]|Å[\u0080-\u00BF])/u, 'common mojibake sequences must not appear');

  for (const locale of EXPECTED_LOCALES) {
    for (const [key, value] of Object.entries(flattened[locale])) {
      assert.equal(value, value.normalize('NFC'), `${locale}.${key} must use NFC-normalized Unicode`);
    }
  }
});

test('each translated language pack contains its expected native diacritics', () => {
  for (const [locale, requiredCharacters] of Object.entries(REQUIRED_DIACRITICS)) {
    const content = Object.values(flattened[locale]).join(' ').toLocaleLowerCase(locale);
    for (const character of requiredCharacters) {
      assert.ok(content.includes(character), `${locale} catalog must include the native character “${character}”`);
    }
  }
});

test('translations preserve every interpolation placeholder from the English message', () => {
  const english = flattened.en;
  const parameterizedKeys = Object.keys(english).filter(key => placeholders(english[key]).length);
  assert.ok(parameterizedKeys.length, 'catalog should include at least one parameterized message');

  for (const locale of EXPECTED_LOCALES) {
    for (const key of Object.keys(english)) {
      assert.deepEqual(
        placeholders(flattened[locale][key]),
        placeholders(english[key]),
        `${locale}.${key} must preserve its placeholder names and counts`,
      );
    }
  }
});

test('translateMessage interpolates variables for every locale without leaking tokens', () => {
  const key = Object.keys(flattened.en).find(candidate => placeholders(flattened.en[candidate]).length);
  const variables = Object.fromEntries(placeholders(flattened.en[key]).map((name, index) => [name, `value-${index + 1}`]));
  for (const locale of EXPECTED_LOCALES) {
    const output = translateMessage(locale, key, variables);
    assert.equal(typeof output, 'string');
    for (const value of Object.values(variables)) assert.ok(output.includes(value), `${locale}.${key} did not interpolate ${value}`);
    assert.deepEqual(placeholders(output), [], `${locale}.${key} leaked an interpolation token`);
  }
});

test('core non-English messages do not silently fall back to high-confidence English UI copy', () => {
  const english = flattened.en;
  const coreKeys = Object.keys(english).filter(key =>
    REQUIRED_SECTIONS.some(section => key === section || key.startsWith(`${section}.`)),
  );

  for (const locale of EXPECTED_LOCALES.filter(code => code !== 'en')) {
    const suspicious = coreKeys.filter(key => {
      const source = english[key];
      const target = flattened[locale][key];
      return isHighConfidenceEnglishUi(source) && normalizedText(source).toLocaleLowerCase('en') === normalizedText(target).toLocaleLowerCase(locale);
    });
    assert.deepEqual(suspicious, [], `${locale} contains likely English fallbacks: ${suspicious.join(', ')}`);
  }
});

test('persistent visible editor labels are represented in the localization catalog', async () => {
  const [htmlBuffer, appBuffer] = await Promise.all([
    read('workspaces/medals/index.html'),
    read('app.js'),
  ]);
  const html = decodeUtf8Strict(htmlBuffer, 'workspaces/medals/index.html');
  const app = decodeUtf8Strict(appBuffer, 'app.js');
  const decodedHtml = html
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
  const englishValues = new Set(Object.values(flattened.en).map(normalizedText));

  for (const message of REQUIRED_VISIBLE_MESSAGES) {
    assert.ok(decodedHtml.includes(message), `test fixture drift: expected the editor to contain “${message}”`);
    assert.ok(englishValues.has(normalizedText(message)), `visible editor label “${message}” is absent from the localization catalog`);
  }

  for (const message of REQUIRED_DYNAMIC_MESSAGES) {
    const renderStudioKeys = {
      'Medal image studio': "renderStudioText('title')",
      'Glow preview': "renderStudioText('glow')",
      'Light + dark image': "renderStudioText('lightDarkImage')",
      '4-view sheet': "renderStudioText('fourViewSheet')",
    };
    const explicitlyKeyed = (message === 'No blocking issues' && app.includes("localizedPluralMessage('export.warnings'"))
      || (renderStudioKeys[message] && app.includes(renderStudioKeys[message]));
    assert.ok(app.includes(message) || explicitlyKeyed, `test fixture drift: expected app.js to contain “${message}” or its explicit localization key`);
    assert.ok(englishValues.has(normalizedText(message)), `dynamic editor label “${message}” is absent from the localization catalog`);
  }
});

test('high-touch wizard, medal, shape, and stock copy uses explicit semantic keys', () => {
  const keys = [
    'wizardUi.titleBody', 'wizardUi.titleRibbon', 'wizardUi.titleEvent', 'wizardUi.titleReady',
    'wizardUi.everyItemEditable', 'wizardUi.livePreview', 'wizardUi.finishedFootprint',
    'wizardUi.overall', 'wizardUi.ribbonOpening', 'wizardUi.noRibbonOpening',
    'medalSettingsUi.bodyLayerMany', 'medalSettingsUi.measuredFromModel',
    'medalSettingsUi.bodyDescription', 'medalSettingsUi.edgeDescription',
    'medalSettingsUi.standardRibbon', 'medalSettingsUi.wideRibbon',
    'shapeCategoryUi.raceDay', 'stockStatusUi.unknown', 'stockStatusUi.out',
    'stockStatusUi.low', 'stockStatusUi.available',
  ];

  for (const key of keys) {
    assert.ok(flattened.en[key], `${key} must be an explicit English message`);
    assert.ok(!key.startsWith('exactSource.'), `${key} must not rely on generated exact-source copy`);
    for (const locale of EXPECTED_LOCALES) assert.ok(flattened[locale][key]?.trim(), `${locale}.${key} is missing`);
  }

  assert.deepEqual(EXPECTED_LOCALES.map(locale => translateMessage(locale, 'shapeCategoryUi.raceDay')),
    ['Race day', 'Pretekový deň', 'Závodní den', 'Wettkampftag', 'Dzień zawodów']);
  assert.deepEqual(EXPECTED_LOCALES.map(locale => translateMessage(locale, 'stockStatusUi.available')),
    ['In stock', 'Na sklade', 'Skladem', 'Auf Lager', 'W magazynie']);
  assert.deepEqual(EXPECTED_LOCALES.map(locale => translateMessage(locale, 'stockStatusUi.low')),
    ['Low stock', 'Nízky stav zásob', 'Nízký stav zásob', 'Geringer Bestand', 'Niski stan']);
  assert.equal(translateMessage('sk', 'wizardUi.titleBody'), 'Vyberte telo medaily');
  assert.equal(translateMessage('pl', 'medalSettingsUi.measuredFromModel', { height: '3,40' }), '3,40 mm · zmierzono z modelu');
  assert.equal(translateMessage('cs', 'medalSettingsUi.bodyLayerFew', { count: 3 }), '3 vrstvy těla');
});
