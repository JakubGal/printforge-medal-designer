import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateProject, normalizeProject } from '../project-model.js';
import { attachmentOpeningLabel, medalOverallSizeLabel, medalSizeLabel, medalTopViewSvg } from '../medal-preview.js';

function projectFor(shape = 'circle', attachment = 'single') {
  const project = createTemplateProject('blank');
  project.medal.shape = shape;
  project.medal.loopStyle = attachment;
  return normalizeProject(project);
}

test('the live top view uses exact circular body and external attachment geometry', () => {
  const project = projectFor('circle', 'single');
  const source = medalTopViewSvg(project);
  assert.match(source, /data-preview-shape="circle"/);
  assert.match(source, /data-preview-attachment="single"/);
  assert.match(source, /<ellipse[^>]+rx="30"[^>]+ry="30"/);
  assert.equal((source.match(/data-preview-attachment-outer=/g) || []).length, 1);
  assert.equal((source.match(/data-preview-aperture=/g) || []).length, 1);
  assert.equal(medalSizeLabel(project), 'Ø 60 mm');
  assert.equal(medalOverallSizeLabel(project), '60 × 66 mm overall');
  assert.equal(attachmentOpeningLabel(project), '27 × 3.6 mm ribbon opening');
});

test('pointy hex previews match manufacturing orientation and double-bar cuts', () => {
  const project = projectFor('hexagon', 'double');
  const source = medalTopViewSvg(project, { compact: true });
  assert.match(source, /<polygon points="0,-30 25\.981,-15/);
  assert.doesNotMatch(source, /<ellipse/);
  assert.equal((source.match(/data-preview-aperture=/g) || []).length, 2);
  assert.equal(medalSizeLabel(project), '52 × 60 mm');
  assert.equal(medalOverallSizeLabel(project), '52 × 66 mm overall');
});

test('every internal attachment stays inside the body and quick-load slit shows its channel', () => {
  for (const attachment of ['eyelet', 'slit', 'open-slit', 'none']) {
    const project = projectFor('circle', attachment);
    const source = medalTopViewSvg(project, { compact: true });
    assert.equal(medalOverallSizeLabel(project), '60 × 60 mm overall');
    assert.doesNotMatch(source, /data-preview-attachment-outer=/);
    if (attachment === 'none') assert.doesNotMatch(source, /data-preview-aperture=/);
    else assert.match(source, /data-preview-aperture="0"/);
    if (attachment === 'open-slit') assert.match(source, /data-preview-channel="true"/);
    else assert.doesNotMatch(source, /data-preview-channel=/);
  }
});

test('preview generation is deterministic and never mutates its project', () => {
  const project = projectFor('shield', 'eyelet');
  const before = structuredClone(project);
  const first = medalTopViewSvg(project);
  const second = medalTopViewSvg(project);
  assert.equal(first, second);
  assert.deepEqual(project, before);
  assert.match(first, /role="img"/);
  assert.match(first, /Exact|shield medal/i);
});
