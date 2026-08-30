import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChecks, DEFAULT_INVENTORY, projectUsedSlots } from '../project-model.js';
import {
  CURATED_EXAMPLE_INFO,
  CURATED_EXAMPLE_KEYS,
  createCuratedExample,
  listCuratedExamples,
} from '../curated-examples.js';
import { scoreMedalAesthetics } from '../medal-aesthetic.js';

test('curated gallery exposes seven original deterministic production fixtures', () => {
  assert.deepEqual(CURATED_EXAMPLE_KEYS, ['alpine-current-25k', 'aurora-polar-10k', 'heritage-marathon-42', 'summit-trail-21k', 'podium-classic', 'honey-run', 'junior-champion']);
  assert.equal(listCuratedExamples().length, 7);
  for (const key of CURATED_EXAMPLE_KEYS) {
    const first = createCuratedExample(key);
    const second = createCuratedExample(key);
    assert.deepEqual(first, second, `${key} has stable IDs and timestamps`);
    assert.equal(first.version, 7);
    assert.equal(first.profile.meshQuality, 'ultra');
    assert.ok(first.elements.length >= 20);
    assert.ok(first.groups.length >= 4);
    assert.ok(projectUsedSlots(first).length >= 3);
    assert.equal(buildChecks(first, DEFAULT_INVENTORY).some(check => check.level === 'block'), false);
    assert.equal(first.curatedExample.originalArtwork, true);
    assert.equal(CURATED_EXAMPLE_INFO[key].acceptanceCriteria.length, 4);
    assert.equal(CURATED_EXAMPLE_INFO[key].bodyShape, first.medal.shape);
    assert.equal(CURATED_EXAMPLE_INFO[key].rimStyle, first.medal.rimStyle);
    assert.equal(CURATED_EXAMPLE_INFO[key].attachmentStyle, first.medal.loopStyle);
  }
});

test('new premium examples clear the deterministic 9/10 release gate', () => {
  for (const key of ['alpine-current-25k', 'aurora-polar-10k', 'heritage-marathon-42']) {
    const assessment = scoreMedalAesthetics(createCuratedExample(key));
    assert.equal(assessment.passed, true, `${key} scores ${assessment.score}/10: ${assessment.failedCategories.join(', ')}`);
    assert.ok(assessment.score >= 9, `${key} scores at least 9/10`);
  }
});

test('curated reverse artwork is always a flush first-layer multicolor inlay', () => {
  for (const key of CURATED_EXAMPLE_KEYS) {
    const project = createCuratedExample(key);
    const back = project.elements.filter(element => element.face === 'back');
    assert.ok(back.length >= 4, `${key} has an editable reverse design`);
    assert.ok(back.every(element => element.operation === 'inlay'));
    assert.ok(back.every(element => element.zDepth === project.profile.layerHeight));
    assert.ok(back.every(element => element.inlayHeight === 0));
  }
});

test('curated examples exercise distinct bodies, edges, and ribbon attachments', () => {
  const projects = CURATED_EXAMPLE_KEYS.map(createCuratedExample);
  assert.ok(new Set(projects.map(project => project.medal.shape)).size >= 3);
  assert.ok(new Set(projects.map(project => project.medal.rimStyle)).size >= 3);
  assert.ok(new Set(projects.map(project => project.medal.loopStyle)).size >= 3);
});
