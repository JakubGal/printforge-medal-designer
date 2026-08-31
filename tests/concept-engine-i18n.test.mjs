import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMedalBrief, validateMedalDesignPlan } from '../concept-engine.js';

test('Slovak brief parses inflected dates, a date range, edition, mood and runner count', () => {
  const plan = parseMedalBrief(
    'Prosím vytvor prémiovú medailu pre nočný beh v Bratislave 21.–22. augusta 2026, 10 km, 7. ročník a dvaja elegantní bežci.',
  );

  assert.deepEqual(plan.event, {
    title: 'BRATISLAVA NOČNÝ BEH',
    subtitle: '21-22.08.2026',
    location: 'Bratislava',
    distance: '10K',
    date: '2026-08-22',
    year: 2026,
    edition: '7',
  });
  assert.deepEqual(plan.creative, { discipline: 'running', motif: 'night', mood: 'premium', runnerCount: 2 });
  assert.equal(validateMedalDesignPlan(plan).valid, true);
});

test('Czech brief distinguishes Czech wording and normalizes a locative city name', () => {
  const plan = parseMedalBrief(
    'Vytvoř hravou medaili pro městský běh v Praze dne 14. června 2028, půlmaraton a tři běžci.',
  );

  assert.equal(plan.event.title, 'PRAHA MĚSTSKÝ BĚH');
  assert.equal(plan.event.location, 'Praha');
  assert.equal(plan.event.distance, '21.1K');
  assert.equal(plan.event.date, '2028-06-14');
  assert.deepEqual(plan.creative, { discipline: 'running', motif: 'city', mood: 'playful', runnerCount: 3 });
});

test('German brief parses cycling, March, kilometers, edition and location', () => {
  const plan = parseMedalBrief(
    'Bitte erstelle eine technische Medaille für ein 75 km Radrennen in Berlin am 12. März 2029, 4. Auflage.',
  );

  assert.equal(plan.event.title, 'BERLIN RADRENNEN');
  assert.equal(plan.event.location, 'Berlin');
  assert.equal(plan.event.distance, '75K');
  assert.equal(plan.event.date, '2029-03-12');
  assert.equal(plan.event.edition, '4');
  assert.deepEqual(plan.creative, { discipline: 'cycling', motif: 'cycling', mood: 'technical', runnerCount: 1 });
});

test('Polish brief parses trail motif, inflected city/month, mood and edition', () => {
  const plan = parseMedalBrief(
    'Stwórz elegancki medal na górski bieg trailowy w Krakowie 9 sierpnia 2030, 30 km, 3. edycja.',
  );

  assert.equal(plan.event.title, 'KRAKÓW TRAIL');
  assert.equal(plan.event.location, 'Kraków');
  assert.equal(plan.event.distance, '30K');
  assert.equal(plan.event.date, '2030-08-09');
  assert.equal(plan.event.edition, '3');
  assert.deepEqual(plan.creative, { discipline: 'trail', motif: 'trail', mood: 'premium', runnerCount: 1 });
});

test('an explicit locale can disambiguate short Czech and Slovak prompts', () => {
  const czech = parseMedalBrief('Beh v Praze 5.5.2027', { locale: 'cz' });
  const slovak = parseMedalBrief('Beh v Prahe 5.5.2027', { locale: 'sk-SK' });

  assert.equal(czech.event.location, 'Praha');
  assert.equal(czech.event.title, 'PRAHA BĚH');
  assert.equal(slovak.event.location, 'Praha');
  assert.equal(slovak.event.title, 'PRAHA BEH');
});

