import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('standalone user-created names and prompts are excluded from source-English localization', async () => {
  const app = await read('app.js');

  const protectedContracts = [
    ['filament name', /<strong data-i18n-ignore>\$\{escapeHtml\(filament\.name\)\}<\/strong>/u],
    ['filament material and effect', /<small data-i18n-ignore>\$\{escapeHtml\(filament\.material\)\} · \$\{escapeHtml\(filament\.effect\)\}<\/small>/u],
    ['image palette filament name', /class="image-color-chip" data-i18n-ignore/u],
    ['generated concept label', /<span data-i18n-ignore>\$\{escapeHtml\(project\.conceptMeta\?\.label/u],
    ['generated concept description', /<small><span data-i18n-ignore>\$\{escapeHtml\(project\.conceptMeta\?\.description/u],
    ['parsed event wording', /<strong data-i18n-ignore>\$\{escapeHtml\(planPreview\.event\.title\)\}/u],
    ['parsed artwork subject', /<strong data-i18n-ignore>\$\{escapeHtml\(parsed\.visualSubject\)\}<\/strong>/u],
    ['selected material name', /<span data-i18n-ignore>\$\{escapeHtml\(selected\?\.name/u],
    ['placement label', /placementGhostLabel'\)\.innerHTML = `<span data-i18n-ignore>\$\{escapeHtml\(/u],
    ['wizard project name', /<h3 data-i18n-ignore>\$\{escapeHtml\(project\.name\)\}<\/h3>/u],
    ['saved project name', /project-library-copy"><strong data-i18n-ignore>\$\{escapeHtml\(item\.name/u],
    ['segmented image-part name', /<strong data-i18n-ignore>\$\{escapeHtml\(preference\.name\)\}<\/strong>/u],
  ];

  for (const [label, pattern] of protectedContracts) {
    assert.match(app, pattern, `${label} must stay inside a data-i18n-ignore boundary`);
  }

  const protectedElementNames = app.match(/(?:strong|h2) data-i18n-ignore>\$\{escapeHtml\(element\.name\)\}/gu) || [];
  assert.ok(protectedElementNames.length >= 4, 'layer list, selection HUD, object tree, and inspector must preserve editable object names');

  const protectedGroupNames = app.match(/data-i18n-ignore[^>]*>\$\{escapeHtml\(group\.name\)\}/gu) || [];
  assert.ok(protectedGroupNames.length >= 3, 'empty groups, populated groups, and group options must preserve user group names');

  assert.doesNotMatch(
    app,
    /translateUi\(\s*(?:state\.project\.name|state\.conceptBrief|state\.localArtworkBrief|element\.(?:name|text)|group\.name|item\.name|filament\.(?:name|brand)|preference\.name|selected\.(?:name|text))/u,
    'user-authored values must never be passed directly to the source-English translator',
  );
});

test('user prompt textareas preserve their contents while their static placeholders remain localizable', async () => {
  const app = await read('app.js');

  assert.match(app, /id="localArtworkBrief"[^>]*data-i18n-ignore[^>]*placeholder="\$\{escapeHtml\(translateUi\('/u);
  assert.match(app, /id="conceptBrief"[^>]*data-i18n-ignore[^>]*placeholder="\$\{escapeHtml\(translateUi\('/u);
  assert.match(app, /<textarea class="text-input" rows="9" data-i18n-ignore readonly>\$\{escapeHtml\(prompt\)\}<\/textarea>/u);
});

test('input value attributes remain outside the localizer and hub registry copy remains translatable', async () => {
  const [runtime, hub] = await Promise.all([
    read('localization-runtime.js'),
    read('workspace-hub.js'),
  ]);

  const attributeList = runtime.match(/const TRANSLATABLE_ATTRIBUTES = Object\.freeze\(\[([^\]]+)\]\)/u)?.[1] || '';
  assert.ok(attributeList, 'localization runtime must declare its translated attributes');
  assert.doesNotMatch(attributeList, /['"]value['"]/u, 'input values contain project and artwork text and must not be localized');
  assert.match(runtime, /\[data-i18n-ignore\]/u, 'runtime must honor explicit user-content boundaries');

  assert.match(hub, /title\.textContent = copy\.name/u);
  assert.match(hub, /description\.textContent = copy\.description/u);
  assert.match(hub, /copy\.capabilities\.map\(capability/u);
  assert.doesNotMatch(hub, /data-i18n-ignore/u, 'workspace registry copy is app-owned UI metadata, not user project content');
});
