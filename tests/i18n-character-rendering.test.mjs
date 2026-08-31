import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INVENTORY,
  createTemplateProject,
  enrichForExport,
  normalizeProject,
  normalizeProjectBundle,
  projectBundleForExport,
} from '../project-model.js';
import { meshesTo3mf, projectToSvg } from '../export-engine.js';
import { buildTechnicalSheetPdf, projectFaceToTechnicalSvg } from '../report-engine.js';
import { localeMetadata, normalizeLocale } from '../localization.js';

const SPECIMENS = Object.freeze({
  sk: 'Ľudánická nočná výzva — čučoriedka, ô, ä, ŕ, ĺ',
  cs: 'Příliš žluťoučký kůň úpěl ďábelské ódy',
  de: 'Straße, ÄÖÜß — größerer Zwerg',
  pl: 'Zażółć gęślą jaźń — Łódź',
});

const PROJECT_NAME = 'Medaila Žluťoučký kôň — Łódź Straße';
const encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function unicodeProject() {
  const project = createTemplateProject('blank');
  project.name = PROJECT_NAME;
  project.elements = Object.entries(SPECIMENS).map(([locale, value], index) => ({
    id: `unicode-${locale}`,
    type: 'text',
    name: `Nápis ${locale} — Český Ľódź`,
    text: value,
    x: 0,
    y: -18 + index * 12,
    fontSize: 3.2,
    fontFamily: index % 2 ? 'Verdana' : 'Arial',
    weight: 800,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    lockAspect: true,
    face: index === 3 ? 'back' : 'front',
    color: index % 2,
    operation: index === 3 ? 'inlay' : 'raise',
    zHeight: .6,
    zDepth: .4,
    inlayHeight: index === 3 ? .2 : 0,
    layerSnap: true,
    combine: 'replace',
    groupId: null,
    hidden: false,
    locked: false,
  }));
  return normalizeProject(project);
}

function assertCleanNfc(value, label) {
  assert.equal(value, value.normalize('NFC'), `${label} must remain NFC-normalized`);
  assert.doesNotMatch(value, /\uFFFD|[\u0080-\u009f]/u, `${label} must not contain replacement or C1 characters`);
}

function parseStoredZip(bytes) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    if (view.getUint32(0, true) !== 0x04034b50) break;
    const method = view.getUint16(8, true);
    const compressedSize = view.getUint32(18, true);
    const uncompressedSize = view.getUint32(22, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    assert.equal(method, 0, 'small localization fixture should use stored ZIP entries');
    assert.equal(compressedSize, uncompressedSize);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    assert.ok(dataEnd <= bytes.length, 'ZIP entry remains inside its package');
    entries.set(
      utf8Decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      bytes.slice(dataStart, dataEnd),
    );
    offset = dataEnd;
  }
  return entries;
}

function reportCanvasHarness() {
  const textCalls = [];
  const context = {
    beginPath() {}, closePath() {}, drawImage() {}, fill() {}, fillRect() {}, lineTo() {}, moveTo() {}, restore() {}, roundRect() {}, save() {}, stroke() {},
    fillText(value) { textCalls.push(String(value)); },
    measureText(value) { return { width: [...String(value)].length * 10 }; },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => 'data:image/jpeg;base64,/9j/2Q==',
  };
  return { canvas, textCalls };
}

test('Latin Extended medal wording survives normalization, JSON, and SVG export exactly', () => {
  const normalized = unicodeProject();
  const bundle = projectBundleForExport(normalized, DEFAULT_INVENTORY);
  const jsonBytes = encoder.encode(JSON.stringify(bundle));
  const json = utf8Decoder.decode(jsonBytes);
  const restored = normalizeProjectBundle(JSON.parse(json), DEFAULT_INVENTORY).project;
  const svg = projectToSvg(enrichForExport(restored, DEFAULT_INVENTORY));
  const svgAfterUtf8 = utf8Decoder.decode(encoder.encode(svg));

  assert.equal(restored.name, PROJECT_NAME);
  assertCleanNfc(json, 'project JSON');
  assertCleanNfc(svgAfterUtf8, 'SVG export');
  for (const [locale, value] of Object.entries(SPECIMENS)) {
    const element = restored.elements.find(item => item.id === `unicode-${locale}`);
    assert.equal(element.text, value);
    assertCleanNfc(element.text, `${locale} restored text`);
    assert.ok(svgAfterUtf8.includes(value), `${locale} characters must remain intact in SVG text`);
  }
});

test('3MF model XML and manifest preserve UTF-8 names and the selected xml:lang', async () => {
  const project = enrichForExport(unicodeProject(), DEFAULT_INVENTORY);
  const meshName = 'Čelná vrstva — Příliš žluťoučký kůň';
  const mesh = {
    name: meshName,
    slot: 0,
    shell: 1,
    shellCount: 1,
    triangles: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  };
  const bytes = new Uint8Array(await (await meshesTo3mf(project, [mesh], { locale: 'sk-SK' })).arrayBuffer());
  const entries = parseStoredZip(bytes);
  const model = utf8Decoder.decode(entries.get('3D/3dmodel.model'));
  const manifestJson = utf8Decoder.decode(entries.get('Metadata/medalforge-manifest.json'));
  const manifest = JSON.parse(manifestJson);

  assert.match(model, /<model\b[^>]*\bxml:lang="sk-SK"/u);
  assert.ok(model.includes(`<metadata name="Title">${PROJECT_NAME}</metadata>`));
  assert.ok(model.includes(`name="${meshName}"`));
  assert.equal(manifest.project, PROJECT_NAME);
  assert.equal(manifest.operations[0].name, 'Nápis sk — Český Ľódź');
  assertCleanNfc(model, '3MF model XML');
  assertCleanNfc(manifestJson, '3MF manifest JSON');
});

test('technical-report SVG localizes labels while preserving project artwork Unicode', () => {
  const project = enrichForExport(unicodeProject(), DEFAULT_INVENTORY);
  const translations = new Map([
    ['Front face', 'Predná strana'],
    ['FRONT', 'PREDNÁ STRANA'],
    ['Reverse · outside-facing · readable', 'Zadná strana · pohľad zvonka · čitateľná'],
    ['REVERSE · OUTSIDE VIEW', 'ZADNÁ STRANA · POHĽAD ZVONKA'],
  ]);
  const translate = value => translations.get(value) || value;
  const front = projectFaceToTechnicalSvg(project, 'front', { translate });
  const back = projectFaceToTechnicalSvg(project, 'back', { translate });

  assert.match(front, /<title>Predná strana<\/title>/u);
  assert.match(front, />PREDNÁ STRANA<\/text>/u);
  assert.match(back, /<title>Zadná strana · pohľad zvonka · čitateľná<\/title>/u);
  assert.match(back, />ZADNÁ STRANA · POHĽAD ZVONKA<\/text>/u);
  assert.ok(front.includes(SPECIMENS.sk));
  assert.ok(back.includes(SPECIMENS.pl));
  assertCleanNfc(`${front}\n${back}`, 'technical report SVG');
});

test('PDF report rendering sends localized NFC text to the browser canvas before rasterization', async () => {
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  const { canvas, textCalls } = reportCanvasHarness();
  globalThis.document = { createElement: type => {
    assert.equal(type, 'canvas');
    return canvas;
  } };
  globalThis.Image = class {
    set src(value) {
      this.currentSrc = value;
      this.width = 1200;
      this.height = 1200;
      queueMicrotask(() => this.onload?.());
    }
  };

  const translations = new Map([
    ['MedalForge · technical & quote sheet', 'MedalForge · technický a cenový list'],
    ['Overall dimensions', 'Celkové rozmery'],
    ['Front face', 'Predná strana'],
    ['FRONT', 'PREDNÁ STRANA'],
    ['Reverse · outside-facing · readable', 'Zadná strana · pohľad zvonka · čitateľná'],
    ['REVERSE · OUTSIDE VIEW', 'ZADNÁ STRANA · POHĽAD ZVONKA'],
  ]);
  try {
    const result = await buildTechnicalSheetPdf({
      project: unicodeProject(),
      inventory: DEFAULT_INVENTORY,
      quantity: 25,
      localeTag: 'sk-SK',
      translate: value => translations.get(value) || value,
    });
    assert.equal(result.blob.type, 'application/pdf');
    assert.ok(result.blob.size > 0);
    assert.ok(textCalls.includes(PROJECT_NAME));
    assert.ok(textCalls.includes('MEDALFORGE · TECHNICKÝ A CENOVÝ LIST'));
    assert.ok(textCalls.includes('CELKOVÉ ROZMERY'));
    assertCleanNfc(textCalls.join('\n'), 'technical report canvas text');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousImage === undefined) delete globalThis.Image;
    else globalThis.Image = previousImage;
  }
});

test('legacy cz locale aliases normalize to the supported Czech locale', () => {
  for (const alias of ['cz', 'cz-CZ', 'CZ_cz']) assert.equal(normalizeLocale(alias), 'cs');
  assert.equal(localeMetadata('cz').code, 'cs');
  assert.equal(localeMetadata('cz-CZ').numberLocale, 'cs-CZ');
});
