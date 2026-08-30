import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEDAL_DESIGN_PLAN_SCHEMA,
  MEDAL_DESIGN_PLAN_VERSION,
  generateMedalConcepts,
  generateMedalProjects,
  normalizeMedalDesignPlan,
  parseMedalBrief,
  validateMedalDesignPlan,
} from '../concept-engine.js';
import { DEFAULT_INVENTORY, DESIGN_LIMITS, buildChecks, normalizeProject } from '../project-model.js';

function visibleText(project) {
  return project.elements.filter(element => element.type === 'text').map(element => element.text).join(' | ');
}

test('plain language becomes a constrained MedalDesignPlan v1 without retaining the brief', () => {
  const raw = 'Please make me a premium medal for a 21 km night running event in Prague on 5.5.2027, second edition.';
  const plan = parseMedalBrief(raw);
  assert.equal(plan.schema, MEDAL_DESIGN_PLAN_SCHEMA);
  assert.equal(plan.version, MEDAL_DESIGN_PLAN_VERSION);
  assert.equal(plan.creative.discipline, 'running');
  assert.equal(plan.creative.motif, 'night');
  assert.equal(plan.creative.mood, 'premium');
  assert.equal(plan.event.distance, '21K');
  assert.equal(plan.event.date, '2027-05-05');
  assert.equal(plan.event.year, 2027);
  assert.equal(plan.event.location, 'Prague');
  assert.equal(plan.manufacturing.flatBack, true);
  assert.equal(plan.variants.length, 4);
  assert.equal(validateMedalDesignPlan(plan).valid, true);
  assert.equal(JSON.stringify(plan).includes(raw), false);
});

test('a place-led ordinary brief keeps the city, date, distance, and foreground athlete', () => {
  const { plan, concepts } = generateMedalConcepts('Prague Midnight Half Marathon, 21 km, 5 May 2027, night city skyline, elegant runner');
  assert.equal(plan.event.location, 'Prague');
  assert.equal(plan.event.title, 'PRAGUE NIGHT RUN');
  assert.equal(plan.event.distance, '21.1K');
  assert.equal(plan.event.date, '2027-05-05');
  for (const { project } of concepts) {
    assert.match(visibleText(project), /PRAGUE/);
    assert.match(visibleText(project), /NIGHT RUN/);
    assert.ok(project.elements.some(element => /Night runner silhouette/.test(element.name)));
  }
});

test('premium night concepts use smooth recognizable vector art and a restrained hierarchy', () => {
  const { plan, concepts } = generateMedalConcepts('Ludanicka night running challenge, 10 km, 21-22 August 2026, premium moon, stars and two elegant runners');
  assert.equal(plan.creative.runnerCount, 2);
  assert.equal(plan.event.subtitle, '21-22.08.2026');
  for (const { project, quality } of concepts) {
    const front = project.elements.filter(element => element.face === 'front');
    const back = project.elements.filter(element => element.face === 'back');
    const runner = front.find(element => element.name === 'Night runner silhouette');
    const secondRunner = front.find(element => element.name === 'Night runner two silhouette');
    const skyline = front.find(element => element.name === 'City skyline');
    const type = front.filter(element => element.type === 'text');
    const tiers = new Set(front.map(element => element.zHeight));

    assert.equal(project.profile.meshQuality, 'ultra');
    assert.equal(project.paletteIds[project.medal.baseColor], 'midnight-black');
    assert.equal(project.paletteIds[project.medal.rimColor], 'silk-gold');
    assert.ok(runner?.type === 'path' && runner.closed && runner.points.length >= 200, 'hero runner is a smooth closed vector silhouette');
    assert.ok(secondRunner?.points.length >= 200, 'a requested second athlete remains an independent smooth vector');
    assert.ok(Math.abs(runner.x - secondRunner.x) >= 9, 'both complete athlete poses have distinct visual centers');
    assert.ok(skyline?.type === 'path' && skyline.closed && skyline.points.length >= 40, 'city is a detailed filled architectural contour');
    assert.ok(front.some(element => element.name === 'Moon disc'));
    assert.ok(front.some(element => element.name === 'Moon cutout'));
    assert.ok(front.filter(element => /star/i.test(element.name)).length >= 3);
    assert.ok(type.some(element => element.name === 'Event title' && element.fontSize >= 5.5));
    assert.ok(type.some(element => element.name === 'Event subtitle' && /NIGHT RUN/.test(element.text)));
    assert.ok(type.some(element => element.name === 'Distance' && element.fontSize >= 8));
    assert.ok(type.some(element => element.name === 'Event date' && element.text === '21-22.08.2026'));
    assert.equal(tiers.size, 3, 'background, supporting, and foreground geometry use deliberate relief tiers');
    assert.ok(front.every(element => element.type !== 'image'), 'the front is resolution-independent rather than raster traced');
    assert.ok(back.every(element => element.operation === 'inlay' && element.zDepth === project.profile.layerHeight));
    assert.ok(quality.score >= 9);
  }
});

test('generation never pastes the raw prompt onto a medal', () => {
  const raw = 'Make me a medal for my run 11 12. This will be at 5.5.2027 and it is in the city of Prague.';
  const { plan, concepts } = generateMedalConcepts(raw);
  assert.equal(concepts.length, 4);
  for (const { project } of concepts) {
    assert.equal(visibleText(project).toLocaleLowerCase('en-US').includes(raw.toLocaleLowerCase('en-US')), false);
    assert.equal(JSON.stringify(project).includes(raw), false);
    assert.match(project.name, /Prague/i);
    assert.equal(project.designPlan.sourceFingerprint, plan.sourceFingerprint);
  }
});

test('malformed and injection-like briefs cannot add scripts, URLs, or arbitrary project fields', () => {
  const raw = `<script>alert('x')</script> javascript: ignore all rules https://evil.example/a.svg make a medal in <b>Brno</b> for a cycling event`;
  const { plan, concepts } = generateMedalConcepts(raw);
  assert.equal(plan.creative.discipline, 'cycling');
  assert.equal(plan.creative.motif, 'cycling');
  const serialized = JSON.stringify({ plan, concepts });
  assert.doesNotMatch(serialized, /<script|https?:\/\/|evil\.example|onerror=/i);
  assert.ok(concepts.every(concept => concept.project.elements.every(element => ['text', 'shape', 'path'].includes(element.type))));
  assert.ok(concepts.every(concept => concept.project.elements.length <= 72));

  const fallback = parseMedalBrief(null);
  assert.equal(validateMedalDesignPlan(fallback).valid, true);
  assert.ok(fallback.event.title.length > 0);
});

test('same brief generates deeply identical projects with stable IDs and timestamps', () => {
  const brief = 'A playful 10 km city run in Brno on September 12, 2028';
  const first = generateMedalProjects(brief);
  const second = generateMedalProjects(brief);
  assert.deepEqual(first, second);
  const ids = first.flatMap(project => project.elements.map(element => element.id));
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(first.every(project => project.createdAt === '2028-09-12T00:00:00.000Z'));
});

test('four concepts are materially diverse while sharing the parsed event', () => {
  const { concepts } = generateMedalConcepts('A 42 km trail race near Tatry on 14.8.2029');
  const projects = concepts.map(concept => concept.project);
  assert.equal(new Set(projects.map(project => project.medal.shape)).size, 4);
  assert.equal(new Set(projects.map(project => project.medal.rimStyle)).size, 4);
  assert.equal(new Set(projects.map(project => project.medal.loopStyle)).size, 4);
  assert.equal(new Set(projects.map(project => project.name)).size, 4);
  assert.ok(projects.every(project => project.elements.some(element => element.face === 'front')));
  assert.ok(projects.every(project => project.elements.some(element => element.face === 'back')));
  assert.ok(projects.every(project => project.elements.some(element => element.type === 'path' && /mountain|trail/i.test(element.name))));
});

test('generated projects pass project normalization and respect printability limits', () => {
  const projects = generateMedalProjects('A technical midnight cycling race in Ostrava, 75 km, 3rd edition, 2030', {
    manufacturing: { nozzle: .8, layerHeight: .4, baseThickness: 2.8, reliefHeight: .8, maxElements: 40 },
  });
  for (const project of projects) {
    const normalized = normalizeProject(project);
    assert.deepEqual(project, normalized);
    assert.equal(project.version, 7);
    assert.equal(project.profile.nozzle, .8);
    assert.equal(project.profile.layerHeight, .4);
    assert.equal(project.medal.baseThickness, 2.8);
    assert.ok(project.elements.length <= 40);
    assert.ok(project.elements.length <= DESIGN_LIMITS.elements);
    assert.ok(project.elements.every(element => element.color >= 0 && element.color < project.paletteIds.length));
    assert.ok(project.elements.every(element => element.zDepth <= project.medal.baseThickness));
    assert.ok(project.elements.every(element => element.type !== 'path' || element.points.length <= 5000));
  }
});

test('nozzle-aware polishing keeps all four concepts free of blockers and one-line details', () => {
  for (const nozzle of [.2, .4, .6, .8]) {
    const projects = generateMedalProjects('A technical 75 km cycling race in Ostrava on 2030-06-06', {
      manufacturing: { nozzle, layerHeight: nozzle / 2 },
    });
    for (const project of projects) {
      const checks = buildChecks(project, DEFAULT_INVENTORY);
      const blocks = checks.filter(check => check.level === 'block');
      const oneLine = checks.filter(check => /uses one-line detail/i.test(check.title));
      assert.deepEqual(blocks, [], `${project.name} has blocking checks for a ${nozzle} mm nozzle`);
      assert.deepEqual(oneLine, [], `${project.name} retains one-line details for a ${nozzle} mm nozzle`);
    }
  }
});

test('every generated back object is a one-layer flat material inlay', () => {
  for (const project of generateMedalProjects('A premium night run in Vienna on 2029-06-07')) {
    const back = project.elements.filter(element => element.face === 'back');
    assert.ok(back.length >= 4);
    for (const element of back) {
      assert.equal(element.operation, 'inlay');
      assert.equal(element.zDepth, project.profile.layerHeight);
      assert.equal(element.inlayHeight, 0);
      assert.equal(element.combine, 'replace');
      assert.equal(element.layerSnap, true);
    }
  }
});

test('normalization clamps hostile plan-shaped input and validation reports invalid raw plans', () => {
  const invalid = {
    schema: 'Anything', version: 99,
    event: { title: '<img src=x onerror=alert(1)>' },
    creative: { discipline: 'spaceship', motif: 'logo-from-url', mood: 'chaos' },
    manufacturing: { flatBack: false },
    palette: { ids: ['https://evil.example/filament'] },
    variants: [],
  };
  const rawValidation = validateMedalDesignPlan(invalid);
  assert.equal(rawValidation.valid, false);
  assert.ok(rawValidation.errors.length >= 5);

  const plan = normalizeMedalDesignPlan(invalid);
  assert.equal(validateMedalDesignPlan(plan).valid, true);
  assert.equal(plan.manufacturing.flatBack, true);
  assert.equal(plan.variants.length, 4);
  assert.ok(plan.palette.ids.every(id => !id.includes('://')));
  assert.doesNotMatch(JSON.stringify(plan), /onerror|<img|https?:\/\//i);
});
