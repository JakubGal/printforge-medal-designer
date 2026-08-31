import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { GUIDE_LIBRARY } from '../guide-library.js';

const guideRoot = new URL('../guides/', import.meta.url);
const EXPECTED_STEMS = [
  '01-overview',
  '02-body-and-ribbon',
  '03-text-and-surfaces',
  '04-symbols-and-drawing',
  '05-image-to-objects',
  '06-ideas-to-medal',
  '07-colors-and-back',
  '08-check-and-export',
];

function boxes(buffer, start = 0, end = buffer.length) {
  const result = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) size = end - offset;
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) break;
    result.push({ type, start: offset, dataStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return result;
}

function mp4DurationSeconds(buffer) {
  const moov = boxes(buffer).find(box => box.type === 'moov');
  assert.ok(moov, 'MP4 must contain a moov metadata box');
  const mvhd = boxes(buffer, moov.dataStart, moov.end).find(box => box.type === 'mvhd');
  assert.ok(mvhd, 'MP4 must contain an mvhd duration box');
  const version = buffer.readUInt8(mvhd.dataStart);
  const timescale = buffer.readUInt32BE(mvhd.dataStart + (version === 1 ? 20 : 12));
  const duration = version === 1
    ? Number(buffer.readBigUInt64BE(mvhd.dataStart + 24))
    : buffer.readUInt32BE(mvhd.dataStart + 16);
  assert.ok(timescale > 0 && duration > 0, 'MP4 duration metadata must be valid');
  return duration / timescale;
}

test('quick-guide catalog is complete, ordered, concise, and always under 30 seconds', () => {
  assert.equal(GUIDE_LIBRARY.length, EXPECTED_STEMS.length);
  assert.deepEqual(GUIDE_LIBRARY.map(guide => guide.stem), EXPECTED_STEMS);
  assert.equal(new Set(GUIDE_LIBRARY.map(guide => guide.id)).size, GUIDE_LIBRARY.length);
  for (const guide of GUIDE_LIBRARY) {
    assert.ok(guide.durationSeconds > 0 && guide.durationSeconds < 30, `${guide.id} must be declared under 30 seconds`);
    assert.equal(guide.video, `${guide.stem}.mp4`);
    assert.equal(guide.poster, `${guide.stem}.webp`);
    assert.equal(guide.captions, `${guide.stem}.vtt`);
    assert.ok(guide.title.length >= 8 && guide.title.length <= 42);
    assert.ok(guide.outcome.length >= 30 && guide.outcome.length <= 120);
    assert.ok(guide.transcript.length >= 3 && guide.transcript.every(line => line.length >= 20));
  }
});

test('every quick guide has a playable MP4, WebP poster, and English WebVTT captions', async () => {
  for (const guide of GUIDE_LIBRARY) {
    const videoUrl = new URL(guide.video, guideRoot);
    const posterUrl = new URL(guide.poster, guideRoot);
    const captionsUrl = new URL(guide.captions, guideRoot);
    const [video, poster, captions, videoInfo] = await Promise.all([
      readFile(videoUrl),
      readFile(posterUrl),
      readFile(captionsUrl, 'utf8'),
      stat(videoUrl),
    ]);

    assert.ok(videoInfo.size > 1024, `${guide.video} must contain real video data`);
    assert.equal(video.toString('ascii', 4, 8), 'ftyp', `${guide.video} must be an MP4 container`);
    const actualDuration = mp4DurationSeconds(video);
    assert.ok(actualDuration >= 3 && actualDuration < 30, `${guide.video} is ${actualDuration.toFixed(2)}s; it must remain under 30s`);

    assert.equal(poster.toString('ascii', 0, 4), 'RIFF', `${guide.poster} must be a WebP image`);
    assert.equal(poster.toString('ascii', 8, 12), 'WEBP', `${guide.poster} must be a WebP image`);

    assert.match(captions.replace(/^\uFEFF/u, ''), /^WEBVTT(?:\r?\n|$)/u, `${guide.captions} must be WebVTT`);
    assert.match(captions, /(?:\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(?:\d{2}:)?\d{2}:\d{2}\.\d{3}/u, `${guide.captions} must contain timed captions`);
  }
});
