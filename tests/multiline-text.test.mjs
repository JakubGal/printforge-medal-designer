import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_INVENTORY,
  TEXT_MAX_CHARACTERS,
  TEXT_MAX_LINES,
  drawTextBlock,
  elementBounds,
  enrichForExport,
  normalizeProject,
  normalizeTextAlignment,
  normalizeTextLineHeight,
  normalizeTextValue,
  textBlockMetrics,
} from '../project-model.js';
import { projectToSvg } from '../export-engine.js';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

function textProject(element) {
  const project = normalizeProject({
    name: 'Multiline text QA',
    medal: { diameter: 70, width: 70, height: 70, rimWidth: 0, loopStyle: 'none' },
    paletteIds: ['midnight-black', 'natural-white'],
    elements: [{
      id: 'multiline-text',
      type: 'text',
      name: 'Multiline text',
      text: 'NIGHT\nRUN',
      x: 0,
      y: 0,
      fontSize: 6,
      fontFamily: 'Arial',
      weight: 800,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      face: 'front',
      color: 1,
      operation: 'raise',
      zHeight: .6,
      ...element,
    }],
  });
  return enrichForExport(project, DEFAULT_INVENTORY);
}

test('multiline wording normalizes line endings while preserving intentional lines and alignment', () => {
  const project = textProject({
    text: 'ĽUDÁNICKÁ\r\n\r\nNOČNÁ\rVÝZVA',
    textAlign: 'right',
    lineHeight: 1.45,
  });
  const [element] = project.elements;

  assert.equal(element.text, 'ĽUDÁNICKÁ\n\nNOČNÁ\nVÝZVA');
  assert.equal(element.textAlign, 'right');
  assert.equal(element.lineHeight, 1.45);
  assert.equal(element.text, element.text.normalize('NFC'));
  assert.equal(normalizeTextValue('A\tB'), 'A    B');
  assert.equal(normalizeTextAlignment('justify'), 'center');
  assert.equal(normalizeTextLineHeight(.1), .85);
  assert.equal(normalizeTextLineHeight(99), 2);
});

test('multiline text limits are deterministic and legacy single-line projects get safe defaults', () => {
  const tooManyLines = Array.from({ length: TEXT_MAX_LINES + 3 }, (_, index) => `Line ${index + 1}`).join('\n');
  assert.equal(normalizeTextValue(tooManyLines).split('\n').length, TEXT_MAX_LINES);
  assert.ok([...normalizeTextValue('X'.repeat(TEXT_MAX_CHARACTERS + 50))].length <= TEXT_MAX_CHARACTERS);

  const legacy = textProject({ text: 'LEGACY', textAlign: undefined, lineHeight: undefined });
  const [element] = legacy.elements;
  assert.equal(element.text, 'LEGACY');
  assert.equal(element.textAlign, 'center');
  assert.equal(element.lineHeight, 1.2);

  const svg = projectToSvg(legacy);
  assert.match(svg, /data-text-align="center"/u);
  assert.match(svg, /text-anchor="middle"/u);
  assert.match(svg, /<tspan\b[^>]*>LEGACY<\/tspan>/u);
});

test('multiline bounds use the longest line and the complete block height', () => {
  const base = {
    type: 'text',
    text: 'LONGEST',
    textAlign: 'center',
    lineHeight: 1.2,
    x: 2,
    y: -3,
    fontSize: 10,
    fontFamily: 'Arial',
    weight: 700,
    scaleX: 1,
    scaleY: 1,
  };
  const single = elementBounds(base);
  const twoLines = elementBounds({ ...base, text: 'LONGEST\nX' });
  const threeLines = elementBounds({ ...base, text: 'LONGEST\n\nX' });

  assert.equal(twoLines.width, single.width, 'a short second line must not widen the selection box');
  assert.equal(twoLines.height, 10 * 1.05 + 10 * 1.2);
  assert.equal(threeLines.height, 10 * 1.05 + 2 * 10 * 1.2);
  assert.equal(twoLines.x, 2);
  assert.equal(twoLines.y, -3);

  for (const textAlign of ['left', 'center', 'right']) {
    assert.deepEqual(
      elementBounds({ ...base, text: 'LONGEST\nX', textAlign }),
      twoLines,
      `${textAlign} alignment must remain centered under the same transform gizmo`,
    );
  }

  const scaled = elementBounds({ ...base, text: 'LONGEST\nX', scaleX: 1.5, scaleY: .75 });
  assert.equal(scaled.width, twoLines.width * 1.5);
  assert.equal(scaled.height, twoLines.height * .75);
});

test('drawTextBlock draws every line at a symmetric baseline with the requested anchor', () => {
  const element = {
    type: 'text',
    text: 'AAA\nB\nCC',
    textAlign: 'center',
    lineHeight: 1.2,
    fontSize: 10,
    fontFamily: 'Arial',
    weight: 800,
  };

  for (const [textAlign, expectedX] of [['left', -15], ['center', 0], ['right', 15]]) {
    const calls = [];
    const context = {
      fillText(value, x, y) { calls.push({ value, x, y }); },
      measureText(value) { return { width: [...String(value)].length * 10 }; },
    };
    const layout = drawTextBlock(context, { ...element, textAlign });

    assert.equal(context.textAlign, textAlign);
    assert.equal(context.textBaseline, 'middle');
    assert.equal(context.font, '800 10px Arial');
    assert.deepEqual(calls, [
      { value: 'AAA', x: expectedX, y: -12 },
      { value: 'B', x: expectedX, y: 0 },
      { value: 'CC', x: expectedX, y: 12 },
    ]);
    assert.equal(layout.anchorX, expectedX);
    assert.equal(layout.width, 30);
    assert.equal(layout.lines.length, 3);
  }
});

test('SVG export creates escaped per-line tspans with correct left, center, and right anchors', () => {
  for (const [textAlign, textAnchor] of [['left', 'start'], ['center', 'middle'], ['right', 'end']]) {
    const project = textProject({
      text: 'NIGHT &\nRUN <2027>',
      textAlign,
      lineHeight: 1.25,
      fontSize: 4,
    });
    const layout = textBlockMetrics(project.elements[0]);
    const svg = projectToSvg(project);
    const block = svg.match(new RegExp(`<text[^>]*data-text-align="${textAlign}"[^>]*>([\\s\\S]*?)<\\/text>`, 'u'));

    assert.ok(block, `${textAlign} text block must be present in the SVG`);
    assert.match(block[0], new RegExp(`text-anchor="${textAnchor}"`, 'u'));
    assert.match(block[0], /data-line-height="1\.25"/u);
    assert.match(block[0], /xml:space="preserve"/u);

    const tspans = [...block[1].matchAll(/<tspan x="([^"]+)" y="([^"]+)">([\s\S]*?)<\/tspan>/gu)];
    assert.equal(tspans.length, 2);
    assert.equal(tspans[0][3], 'NIGHT &amp;');
    assert.equal(tspans[1][3], 'RUN &lt;2027&gt;');
    assert.equal(Number(tspans[0][1]), layout.anchorX);
    assert.equal(Number(tspans[1][1]), layout.anchorX);
    assert.equal(Number(tspans[0][2]), -Number(tspans[1][2]), 'line baselines stay centered around the element origin');
    assert.doesNotMatch(block[1], /NIGHT &\nRUN/u, 'a literal newline inside one SVG text node would not render as two lines');
  }
});

test('back-face multiline SVG remains readable and keeps authored line order', () => {
  const project = textProject({
    text: 'BACK TOP\nBACK BOTTOM',
    textAlign: 'left',
    face: 'back',
    x: 4,
    y: 7,
    rotation: 12,
  });
  const svg = projectToSvg(project);
  const block = svg.match(/<text[^>]*data-text-align="left"[^>]*data-face="back"[^>]*>([\s\S]*?)<\/text>/u);

  assert.ok(block);
  assert.match(block[0], /transform="translate\(4 -7\) rotate\(-12\)/u);
  assert.deepEqual(
    [...block[1].matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/gu)].map(match => match[1]),
    ['BACK TOP', 'BACK BOTTOM'],
  );
});

test('editor source exposes multiline creation and editing controls and shares one renderer with export', async () => {
  const [app, exportEngine] = await Promise.all([read('app.js'), read('export-engine.js')]);

  assert.match(app, /<textarea[^>]*id="newTextValue"[^>]*rows="3"[^>]*maxlength="240"[^>]*>/u);
  assert.doesNotMatch(app, /<input[^>]*id="newTextValue"/u);
  assert.match(app, /id="newTextLineHeight"/u);
  for (const alignment of ['left', 'center', 'right']) {
    assert.match(app, new RegExp(`data-new-text-align="${alignment}"`, 'u'));
    assert.match(app, new RegExp(`<option value="${alignment}"[^>]*>${alignment[0].toUpperCase()}${alignment.slice(1)}</option>`, 'u'));
  }
  assert.match(app, /role="radiogroup" aria-label="Text alignment"/u);
  assert.match(app, /<select[^>]*data-element-field="textAlign"/u);
  assert.match(app, /<textarea[^>]*data-inline-text-editor[^>]*maxlength="240"[^>]*>/u);
  assert.match(app, /<textarea[^>]*data-element-field="text"[^>]*maxlength="240"[^>]*>/u);
  assert.match(app, /event\.key === 'Enter' && \(event\.ctrlKey \|\| event\.metaKey\)/u,
    'Ctrl/Cmd+Enter should apply multiline editing while plain Enter remains available for a new line');

  assert.ok((app.match(/drawTextBlock\(context, element/gu) || []).length >= 2,
    'placement and medal preview must use the shared multiline renderer');
  assert.match(exportEngine, /drawTextBlock\(context, element\)/u,
    'manufacturing masks must use the same multiline renderer as the editor');
  assert.doesNotMatch(exportEngine, /fillText\(element\.text/u,
    'production geometry must never pass unsplit multiline wording to one fillText call');
});
