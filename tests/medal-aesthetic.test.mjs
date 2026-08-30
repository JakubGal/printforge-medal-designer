import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMedalConcepts } from '../concept-engine.js';
import {
  MEDAL_AESTHETIC_CATEGORIES,
  MEDAL_AESTHETIC_THRESHOLD,
  polishMedalDesign,
  requirePolishedMedal,
  scoreMedalAesthetics,
} from '../medal-aesthetic.js';
import { buildChecks, createTemplateProject, DEFAULT_INVENTORY } from '../project-model.js';

const PREMIUM_BRIEF = 'Prague Midnight Half Marathon, 21 km, 5 May 2027, night city skyline, elegant runner';

test('the aesthetic score exposes the complete deterministic 0–10 rubric', () => {
  const project = generateMedalConcepts(PREMIUM_BRIEF).concepts[0].project;
  const first = scoreMedalAesthetics(project);
  const second = scoreMedalAesthetics(structuredClone(project));
  assert.deepEqual(first, second);
  assert.equal(first.schema, 'MedalAestheticScore');
  assert.equal(first.version, 1);
  assert.ok(first.score >= MEDAL_AESTHETIC_THRESHOLD && first.score <= 10);
  assert.equal(first.passed, true);
  assert.deepEqual(Object.keys(first.categories), Object.keys(MEDAL_AESTHETIC_CATEGORIES));
  for (const category of Object.values(first.categories)) {
    assert.ok(category.score >= 0 && category.score <= 10);
    assert.ok(Array.isArray(category.strengths));
    assert.ok(Array.isArray(category.issues));
    assert.equal(typeof category.metrics, 'object');
  }
});

test('all text-to-medal variants are polished or rejected before presentation', () => {
  const { concepts } = generateMedalConcepts(PREMIUM_BRIEF);
  assert.equal(concepts.length, 4);
  for (const concept of concepts) {
    assert.equal(concept.quality.passed, true);
    assert.ok(concept.quality.score >= 9, `${concept.label} scored ${concept.quality.score}`);
    assert.equal(concept.project.designPlan.aesthetic.passed, true);
    assert.equal(concept.project.designPlan.aesthetic.score, concept.quality.score);
    assert.ok(concept.polishIterations >= 1 && concept.polishIterations <= 4);
    assert.equal(concept.quality.categories.manufacturability.metrics.oneLineWarnings, 0);
  }
});

test('a blank or token medal cannot receive a dishonest presentation-ready score', () => {
  const blank = createTemplateProject('blank');
  const result = polishMedalDesign(blank);
  assert.equal(result.accepted, false);
  assert.ok(result.assessment.score < 7);
  assert.ok(result.assessment.categories.typography.score < 8);
  assert.ok(result.assessment.categories.focalArt.score < 8);
  assert.throws(() => requirePolishedMedal(blank), /rejected at .*required 9\/10/i);
});

test('polishing removes random heights, sub-nozzle lines, and edge collisions', () => {
  const source = structuredClone(generateMedalConcepts(PREMIUM_BRIEF).concepts[0].project);
  const front = source.elements.filter(element => element.face === 'front');
  const line = front.find(element => element.type === 'path' && !element.closed);
  const headline = front.find(element => element.type === 'text');
  const symbol = front.find(element => element.type === 'shape');
  const closedPath = front.find(element => element.type === 'path' && element.closed);
  assert.ok(line && headline && symbol && closedPath);
  line.strokeWidth = .04;
  symbol.size = .2;
  closedPath.scale = .02;
  headline.x = source.medal.width;
  front.forEach((element, index) => { if (element.operation === 'raise') element.zHeight = .23 + index * .073; });
  const before = scoreMedalAesthetics(source);
  const polished = polishMedalDesign(source);
  assert.ok(polished.assessment.score > before.score);
  assert.equal(polished.accepted, true);
  assert.equal(polished.assessment.categories.manufacturability.metrics.blockers, 0);
  assert.equal(polished.assessment.categories.manufacturability.metrics.subNozzleLines, 0);
  assert.equal(buildChecks(polished.project, DEFAULT_INVENTORY).some(check => /uses one-line detail/i.test(check.title)), false);
  assert.ok(polished.assessment.categories.detailContinuity.metrics.reliefTiers <= 3);
  assert.ok(polished.history.some(entry => entry.changes.some(change => /one-line/.test(change))));
  assert.ok(polished.history.some(entry => entry.changes.some(change => /safe area/.test(change))));
});

test('coarse raster-heavy artwork is explicitly penalized for pixelation', () => {
  const project = structuredClone(generateMedalConcepts(PREMIUM_BRIEF).concepts[0].project);
  const frontIds = new Set(project.elements.filter(element => element.face === 'front' && element.type !== 'text').map(element => element.id));
  project.elements = project.elements.filter(element => !frontIds.has(element.id));
  project.elements.push({
    id: 'coarse-raster', type: 'image', name: 'Pixelated runner', x: 0, y: 0,
    width: 30, height: 30, scaleX: 1, scaleY: 1, rotation: 0, lockAspect: true,
    color: 1, usedSlots: [1, 2], face: 'front', operation: 'raise', zHeight: .6,
    zDepth: .2, inlayHeight: 0, layerSnap: true, combine: 'replace', groupId: null,
    hidden: false, locked: false, pixelWidth: 24, pixelHeight: 24, detailCell: 1.25,
    minimumFeature: 1.25, dataUrl: 'data:image/png;base64,AA==', maskUrls: [],
  });
  const assessment = scoreMedalAesthetics(project);
  assert.ok(assessment.categories.detailContinuity.score <= 6.5);
  assert.ok(assessment.categories.detailContinuity.metrics.coarseRasterObjects >= 1);
  assert.equal(assessment.passed, false);
});
