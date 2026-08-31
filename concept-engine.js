import {
  ATTACHMENT_STYLE_INFO,
  DESIGN_LIMITS,
  RIM_STYLE_INFO,
  createTemplateProject,
  normalizeProject,
} from './project-model.js';
import { requirePolishedMedal } from './medal-aesthetic.js';

export const MEDAL_DESIGN_PLAN_SCHEMA = 'MedalDesignPlan';
export const MEDAL_DESIGN_PLAN_VERSION = 1;

const DISCIPLINES = new Set(['running', 'trail', 'cycling', 'general']);
const MOTIFS = new Set(['runner', 'night', 'city', 'trail', 'cycling', 'general']);
const MOODS = new Set(['bold', 'premium', 'playful', 'technical']);
const SAFE_PALETTE_IDS = new Set([
  'midnight-black',
  'electric-blue',
  'natural-white',
  'signal-lime',
  'signal-red',
  'glow-green',
  'galaxy-purple',
  'thermo-red',
  'silk-gold',
  'graphite-gray',
]);
const MAX_BRIEF_LENGTH = 2_000;
const MAX_GENERATED_ELEMENTS = Math.min(72, DESIGN_LIMITS.elements);
const DEFAULT_EVENT_YEAR = 2026;

// Keys are stored in the same accent-folded form produced by foldForMatch().
// Inflected month names matter here: ordinary Central-European prompts usually
// contain "5. maja / 5. května / 5. Mai", not the dictionary form.
const MONTHS = Object.freeze({
  january: 1, jan: 1, januar: 1, janner: 1, januara: 1, leden: 1, ledna: 1, styczen: 1, stycznia: 1,
  february: 2, feb: 2, februar: 2, februara: 2, unor: 2, unora: 2, luty: 2, lutego: 2,
  march: 3, mar: 3, marec: 3, marca: 3, marz: 3, marzec: 3,
  april: 4, apr: 4, aprile: 4, aprila: 4, duben: 4, dubna: 4, kwiecien: 4, kwietnia: 4,
  may: 5, mai: 5, maj: 5, maja: 5, kveten: 5, kvetna: 5,
  june: 6, jun: 6, juna: 6, juni: 6, cerven: 6, cervna: 6, czerwiec: 6, czerwca: 6,
  july: 7, jul: 7, jula: 7, juli: 7, cervenec: 7, cervence: 7, lipiec: 7, lipca: 7,
  august: 8, aug: 8, augusta: 8, srpen: 8, srpna: 8, sierpien: 8, sierpnia: 8,
  september: 9, sep: 9, sept: 9, septembra: 9, zari: 9, wrzesien: 9, wrzesnia: 9,
  october: 10, oct: 10, oktober: 10, okt: 10, oktobra: 10, rijen: 10, rijna: 10, pazdziernik: 10, pazdziernika: 10,
  november: 11, nov: 11, novembra: 11, listopad: 11, listopadu: 11, listopada: 11,
  december: 12, dec: 12, dezember: 12, dez: 12, decembra: 12, prosinec: 12, prosince: 12, grudzien: 12, grudnia: 12,
});

// A compact, deterministic lexicon is intentionally used instead of browser
// translation or an AI request. A trailing * means "this token starts with";
// it covers grammatical case, gender and plural suffixes while keeping the
// parser small enough to run instantly on every client.
const LANGUAGE_LEXICONS = Object.freeze({
  en: {
    signals: ['please', 'create*', 'design*', 'make', 'running', 'runner*', 'night', 'city', 'race*', 'edition'],
    cycling: ['cycle*', 'cycling', 'cyclist*', 'bike*', 'biking', 'bicycle*', 'mtb'],
    trail: ['trail*', 'mountain*', 'hike*', 'hiking', 'ultra', 'cross country'],
    running: ['run*', 'runner*', 'running', 'race*', 'marathon*', 'sprint*', 'relay*'],
    night: ['night*', 'midnight', 'moon', 'star*', 'dark', 'nocturnal'],
    city: ['city', 'urban', 'skyline', 'bridge', 'street*'],
    premium: ['premium', 'elegant*', 'luxury', 'luxurious', 'classic*', 'formal*'],
    playful: ['kid*', 'junior*', 'school*', 'fun', 'playful', 'family'],
    technical: ['technical', 'industrial', 'geometric*', 'minimal*'],
    runnerNouns: ['runner*'],
    two: ['two', '2'],
    three: ['three', '3'],
  },
  sk: {
    signals: ['prosím', 'vytvor*', 'navrhni', 'vygeneruj', 'sprav*', 'beh', 'bež*', 'nočn*', 'mestsk*', 'pretek*', 'ročník'],
    cycling: ['cyklist*', 'bicykl*', 'bajk*', 'bike*', 'mtb'],
    trail: ['trail*', 'horsk*', 'hora', 'hory', 'horách', 'turist*', 'ultra', 'kros*'],
    running: ['beh', 'bežeck*', 'bežec*', 'bežkyň*', 'pretek*', 'maratón*', 'šprint*', 'štafet*'],
    night: ['nočn*', 'noc', 'polnoc*', 'mesiac', 'hviezd*', 'tmav*'],
    city: ['mesto', 'meste', 'mestsk*', 'panoráma', 'skyline', 'most', 'ulic*'],
    premium: ['prémi*', 'elegant*', 'luxus*', 'klasick*', 'formáln*'],
    playful: ['dieťa*', 'deti', 'detsk*', 'junior*', 'školsk*', 'zábavn*', 'hrav*', 'rodinn*'],
    technical: ['technick*', 'industriáln*', 'geometrick*', 'minimal*'],
    runnerNouns: ['bežec*', 'bežc*', 'bežkyň*'],
    two: ['dva', 'dve', 'dvaja', '2'],
    three: ['tri', 'traja', '3'],
  },
  cs: {
    signals: ['prosím', 'vytvoř*', 'navrhni', 'vygeneruj', 'udělej*', 'běh', 'běž*', 'noční', 'městsk*', 'závod*', 'ročník'],
    cycling: ['cyklist*', 'bicykl*', 'kolo', 'bike*', 'mtb'],
    trail: ['trail*', 'horsk*', 'hora', 'hory', 'horách', 'turist*', 'ultra', 'kros*'],
    running: ['běh', 'běžeck*', 'běžec*', 'běžkyn*', 'závod*', 'maraton*', 'sprint*', 'štafet*'],
    night: ['noční', 'noc', 'půlnoc*', 'měsíc', 'hvězd*', 'tmav*'],
    city: ['město', 'městě', 'městsk*', 'panorama', 'skyline', 'most', 'ulic*'],
    premium: ['prémi*', 'elegant*', 'luxus*', 'klasick*', 'formáln*'],
    playful: ['dítě', 'děti', 'dětsk*', 'junior*', 'školn*', 'zábavn*', 'hrav*', 'rodinn*'],
    technical: ['technick*', 'průmyslov*', 'geometrick*', 'minimal*'],
    runnerNouns: ['běžec*', 'běžc*', 'běžkyn*'],
    two: ['dva', 'dvě', '2'],
    three: ['tři', '3'],
  },
  de: {
    signals: ['bitte', 'erstelle*', 'entwirf*', 'generiere*', 'mach*', 'lauf*', 'läufer*', 'nacht*', 'stadt*', 'rennen', 'auflage'],
    cycling: ['radfahr*', 'radrenn*', 'fahrrad*', 'radtour*', 'biken', 'mountainbike*', 'mtb'],
    trail: ['trail*', 'berg*', 'wander*', 'gebirg*', 'ultra', 'crosslauf*'],
    running: ['lauf*', 'läufer*', 'rennen', 'marathon*', 'sprint*', 'staffel*'],
    night: ['nacht*', 'mitternacht', 'mond', 'stern*', 'dunkel*'],
    city: ['stadt*', 'städt*', 'skyline', 'brücke', 'straße*', 'strasse*'],
    premium: ['premium', 'hochwert*', 'edel', 'elegant*', 'luxuriös*', 'klassisch*', 'formell*'],
    playful: ['kind*', 'junior*', 'schule', 'schul*', 'spaß*', 'spass*', 'verspielt*', 'famil*'],
    technical: ['technisch*', 'industriell*', 'geometrisch*', 'minimal*'],
    runnerNouns: ['läufer*'],
    two: ['zwei', '2'],
    three: ['drei', '3'],
  },
  pl: {
    signals: ['proszę', 'stwórz*', 'zaprojektuj', 'wygeneruj', 'zrób*', 'bieg*', 'nocn*', 'miejsk*', 'wyścig*', 'edycja'],
    cycling: ['kolar*', 'rower*', 'jazda rowerowa', 'bike*', 'mtb'],
    trail: ['trail*', 'górsk*', 'góry', 'trek*', 'ultra', 'przełaj*'],
    running: ['bieg*', 'biegacz*', 'wyścig*', 'maraton*', 'sprint*', 'sztafet*'],
    night: ['nocn*', 'noc', 'północ*', 'księżyc', 'gwiazd*', 'ciemn*'],
    city: ['miasto', 'mieście', 'miejsk*', 'panorama', 'skyline', 'most', 'ulic*'],
    premium: ['premium', 'eleganck*', 'luksus*', 'klasyczn*', 'formaln*'],
    playful: ['dziec*', 'junior*', 'szkoł*', 'zabawn*', 'figlarn*', 'rodzinn*'],
    technical: ['techniczn*', 'przemysłow*', 'geometryczn*', 'minimal*'],
    runnerNouns: ['biegacz*', 'biegaczk*'],
    two: ['dwa', 'dwie', 'dwóch', '2'],
    three: ['trzy', 'trzech', '3'],
  },
});

// Accent-sensitive signals resolve the few collisions that accent folding
// necessarily creates between Czech and Slovak (beh/běh, vytvor/vytvoř).
// They only select the wording used on the generated medal; all semantic
// matching remains language-agnostic.
const RAW_LANGUAGE_SIGNALS = Object.freeze({
  sk: ['vytvor*', 'sprav*', 'beh', 'bežeck*', 'bežci', 'nočn*', 'mestsk*', 'pretek*', 'súťaž*', 'dňa', 'mája', 'júna', 'júla', 'prahe', 'bratislave', 'košiciach', 'žiline', 'dvaja', 'traja'],
  cs: ['vytvoř*', 'udělej*', 'běh', 'běžeck*', 'běžci', 'noční', 'městsk*', 'závod*', 'soutěž*', 'dne', 'května', 'června', 'července', 'srpna', 'října', 'praze', 'brně', 'ostravě', 'plzni', 'dvě', 'tři'],
  de: ['erstelle*', 'entwirf*', 'läufer*', 'nachtlauf*', 'stadtlauf*', 'radrenn*', 'für', 'märz', 'jänner', 'zwei', 'drei'],
  pl: ['proszę', 'stwórz*', 'zrób*', 'bieg*', 'wyścig*', 'nocn*', 'miejsk*', 'w mieście', 'księżyc', 'półmaraton*', 'październik*', 'dwóch', 'trzech'],
});

const TITLE_LANGUAGE = Object.freeze({
  en: { night: 'NIGHT', city: 'CITY', running: 'RUN', cycling: 'RIDE', trail: 'TRAIL', general: 'CHALLENGE', fallback: 'COMMUNITY CHALLENGE', event: 'EVENT' },
  sk: { night: 'NOČNÝ', city: 'MESTSKÝ', running: 'BEH', cycling: 'CYKLISTIKA', trail: 'TRAIL', general: 'VÝZVA', fallback: 'SPOLOČNÁ VÝZVA', event: 'PODUJATIE' },
  cs: { night: 'NOČNÍ', city: 'MĚSTSKÝ', running: 'BĚH', cycling: 'CYKLISTIKA', trail: 'TRAIL', general: 'VÝZVA', fallback: 'KOMUNITNÍ VÝZVA', event: 'AKCE' },
  de: { night: 'NACHT', city: 'STADT', running: 'LAUF', cycling: 'RADRENNEN', trail: 'TRAIL', general: 'CHALLENGE', fallback: 'GEMEINSCHAFTSLAUF', event: 'EVENT' },
  pl: { night: 'NOCNY', city: 'MIEJSKI', running: 'BIEG', cycling: 'WYŚCIG', trail: 'TRAIL', general: 'WYZWANIE', fallback: 'WSPÓLNE WYZWANIE', event: 'WYDARZENIE' },
});

const LOCATION_ALIASES = Object.freeze({
  sk: Object.freeze({ prahe: 'Praha', bratislave: 'Bratislava', kosiciach: 'Košice', ziline: 'Žilina', trnave: 'Trnava', nitre: 'Nitra', presove: 'Prešov', trencine: 'Trenčín', poprade: 'Poprad', 'banskej bystrici': 'Banská Bystrica', brne: 'Brno', ostrave: 'Ostrava', viedni: 'Viedeň', tatrach: 'Tatry', 'ivanke pri nitre': 'Ivanka pri Nitre' }),
  cs: Object.freeze({ praze: 'Praha', brne: 'Brno', ostrave: 'Ostrava', plzni: 'Plzeň', olomouci: 'Olomouc', 'ceskych budejovicich': 'České Budějovice', 'hradci kralove': 'Hradec Králové', bratislave: 'Bratislava', vidni: 'Vídeň', tatrach: 'Tatry' }),
  de: Object.freeze({}),
  pl: Object.freeze({ warszawie: 'Warszawa', krakowie: 'Kraków', lodzi: 'Łódź', wroclawiu: 'Wrocław', poznaniu: 'Poznań', gdansku: 'Gdańsk', lublinie: 'Lublin', katowicach: 'Katowice', szczecinie: 'Szczecin', bydgoszczy: 'Bydgoszcz', bialymstoku: 'Białystok', rzeszowie: 'Rzeszów', pradze: 'Praga', berlinie: 'Berlin', wiedniu: 'Wiedeń' }),
  en: Object.freeze({}),
});

const VARIANT_LIBRARY = Object.freeze([
  {
    id: 'signature-round',
    label: 'Signature round',
    description: 'A balanced race medal with a strong central symbol and a quiet information back.',
    shape: 'circle', width: 68, height: 68, rimStyle: 'double', attachment: 'double',
    rimWidth: 2.4, rimHeight: .6, cornerRadius: 8,
  },
  {
    id: 'kinetic-shield',
    label: 'Kinetic shield',
    description: 'An energetic asymmetric composition with a compact internal ribbon eyelet.',
    shape: 'shield', width: 64, height: 72, rimStyle: 'faceted', attachment: 'eyelet',
    rimWidth: 2, rimHeight: .6, cornerRadius: 8,
  },
  {
    id: 'laurel-crest',
    label: 'Laurel crest',
    description: 'A premium centered crest framed by a printable laurel treatment.',
    shape: 'rounded', width: 64, height: 68, rimStyle: 'laurel', attachment: 'slit',
    rimWidth: 3.1, rimHeight: .6, cornerRadius: 13,
  },
  {
    id: 'panorama-oval',
    label: 'Panorama oval',
    description: 'A wide scenic layout with victory wings and a quick-load ribbon channel.',
    shape: 'oval', width: 74, height: 62, rimStyle: 'wings', attachment: 'open-slit',
    rimWidth: 3, rimHeight: .6, cornerRadius: 8,
  },
]);

function smoothClosedPath(points, iterations = 3) {
  let result = points.map(point => [...point]);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    result = result.flatMap((point, index) => {
      const next = result[(index + 1) % result.length];
      return [
        [point[0] * .75 + next[0] * .25, point[1] * .75 + next[1] * .25],
        [point[0] * .25 + next[0] * .75, point[1] * .25 + next[1] * .75],
      ];
    });
  }
  return result;
}

// A single continuous athletic silhouette is substantially cleaner than a
// stick figure made from overlapping capsules. Three Chaikin passes retain
// the authored elbow, hand, torso, knee, ankle, and shoe shapes while giving
// Ultra exports 224 resolution-independent boundary points.
const RUNNER_BODY = Object.freeze(smoothClosedPath([
  [-2.2,-7.4],[-.3,-7.8],[1.5,-6.8],[2.1,-4.9],[4.4,-3.5],[7.8,-1.2],[6.7,.3],[3.2,-1.4],[1.7,-1.8],[1.2,.1],
  [3,2.3],[7.5,5.1],[6.4,6.8],[4.7,6.3],[.4,3.8],[-1,2.8],[-2.9,4.1],[-6.3,6.5],[-7.4,5.1],[-6.5,3.5],
  [-3.4,.4],[-2.7,-1.2],[-4.4,-1.7],[-7,-.1],[-8,-1.7],[-6.5,-3.1],[-3.5,-3.2],[-2.6,-4.8],
], 3));

const CYCLIST_BODY = Object.freeze([
  [-1.4,-7.3],[.4,-7.8],[2,-6.8],[1.8,-5.1],[.4,-4.3],[2,-2.7],[5.4,-1.2],[6.1,.3],[4.5,1.1],[1.3,-.3],
  [-.1,1.4],[3.2,3.6],[2.1,4.9],[-1.4,2.8],[-3.6,4.8],[-5,3.7],[-2.3,.5],[-4.8,-1.3],[-3.9,-2.8],[-1.5,-1.5],
]);

// A closed architectural contour adapted from the detailed Prague showcase.
// The towers, spires, varied roofline, and continuous ground plane read as a
// real city even at medal scale; the source points remain editable vectors.
const CITY_SKYLINE = Object.freeze([
  [-25,7],[-25,3],[-22.5,3],[-22.5,-.5],[-20.5,-.5],[-20.5,4],[-17.5,4],[-17.5,-2],[-15.5,-2],[-15.5,4],
  [-12.5,4],[-12.5,1],[-10.5,1],[-10.5,-4.5],[-8.8,-4.5],[-8.8,-8],[-7.3,-10.5],[-5.8,-8],[-5.8,-4.5],
  [-4,-4.5],[-4,3],[-1.5,3],[-1.5,.2],[1,.2],[1,-5.8],[3.1,-5.8],[3.1,-1.7],[6,-1.7],[6,3],[9.5,3],
  [9.5,-1],[11.5,-1],[11.5,-6.5],[13.2,-9],[14.9,-6.5],[14.9,-1],[17,-1],[17,4],[20,4],[20,1],[22.5,1],[22.5,7],
]);

const MOUNTAIN_FRONT = Object.freeze([
  [-17,7],[-13,2],[-10,4],[-5,-6],[-2,-2],[3,-11],[7,-4],[10,-6],[17,7],
]);

const MOUNTAIN_BACK = Object.freeze([
  [-17,8],[-12,1],[-8,3],[-3,-5],[1,-1],[6,-8],[10,-2],[14,-4],[18,8],
]);

const COURSE_LINE = Object.freeze([
  [-15,7],[-12,4],[-8,5],[-5,1],[-7,-3],[-3,-6],[2,-4],[5,0],[3,4],[7,7],[12,5],[15,1],
]);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  const source = String(value ?? '');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function cleanBrief(value) {
  return String(value ?? '')
    .slice(0, MAX_BRIEF_LENGTH)
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function foldForMatch(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/ł/g, 'l')
    .replace(/ß/g, 'ss');
}

function normalizeForMatch(value) {
  return foldForMatch(value).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeRawForMatch(value) {
  return String(value ?? '').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function lexiconEntryMatches(normalizedText, entry) {
  const prefixMatch = String(entry).endsWith('*');
  const needle = normalizeForMatch(prefixMatch ? String(entry).slice(0, -1) : entry);
  if (!needle) return false;
  if (prefixMatch) return normalizedText.split(' ').some(token => token.startsWith(needle));
  return ` ${normalizedText} `.includes(` ${needle} `);
}

function rawLexiconEntryMatches(normalizedText, entry) {
  const prefixMatch = String(entry).endsWith('*');
  const needle = normalizeRawForMatch(prefixMatch ? String(entry).slice(0, -1) : entry);
  if (!needle) return false;
  if (prefixMatch) return normalizedText.split(' ').some(token => token.startsWith(needle));
  return ` ${normalizedText} `.includes(` ${needle} `);
}

function matchesLexicon(value, category) {
  const normalized = normalizeForMatch(value);
  return Object.values(LANGUAGE_LEXICONS).some(lexicon =>
    (lexicon[category] || []).some(entry => lexiconEntryMatches(normalized, entry)));
}

function canonicalBriefLocale(value) {
  const code = String(value || '').trim().toLocaleLowerCase('en-US').split(/[-_]/)[0];
  if (code === 'cz') return 'cs';
  return Object.hasOwn(LANGUAGE_LEXICONS, code) ? code : '';
}

function inferBriefLocale(brief, requestedLocale = '') {
  const requested = canonicalBriefLocale(requestedLocale);
  if (requested) return requested;
  const normalized = normalizeForMatch(brief);
  const rawNormalized = normalizeRawForMatch(brief);
  let winner = 'en';
  let bestScore = 0;
  for (const [locale, lexicon] of Object.entries(LANGUAGE_LEXICONS)) {
    const foldedScore = lexicon.signals.reduce((total, entry) => total + (lexiconEntryMatches(normalized, entry) ? 1 : 0), 0);
    const rawScore = (RAW_LANGUAGE_SIGNALS[locale] || []).reduce(
      (total, entry) => total + (rawLexiconEntryMatches(rawNormalized, entry) ? 2 : 0), 0);
    const score = foldedScore + rawScore;
    if (score > bestScore) {
      winner = locale;
      bestScore = score;
    }
  }
  return winner;
}

function monthNumber(value) {
  return MONTHS[foldForMatch(value).replace(/[^\p{L}]/gu, '')] || 0;
}

function cleanDisplayText(value, fallback, maxLength = 42) {
  const cleaned = String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/[^\p{L}\p{N}\s.&'’+\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:please|create|design|generate|make|build)\s+(?:me\s+)?(?:a\s+)?/i, '')
    .trim();
  return (cleaned || fallback).slice(0, maxLength).trim();
}

function titleCase(value) {
  return String(value || '').toLocaleLowerCase('en-US').replace(/(^|[\s\-])\p{L}/gu, character => character.toLocaleUpperCase('en-US'));
}

function isoDate(year, month, day) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return '';
  if (!Number.isInteger(month) || month < 1 || month > 12) return '';
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > days) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDate(brief) {
  let match = brief.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = brief.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  match = brief.match(/(?<![\p{L}\p{N}])(\d{1,2})(?:st|nd|rd|th|\.)?\s+(?:(?:of|dňa|dna|dne|am)\s+)?([\p{L}]+)\.?,?\s+(20\d{2})(?!\d)/iu);
  if (match && monthNumber(match[2])) return isoDate(Number(match[3]), monthNumber(match[2]), Number(match[1]));
  match = brief.match(/(?<![\p{L}\p{N}])([\p{L}]+)\.?\s+(\d{1,2})(?:st|nd|rd|th|\.)?,?\s+(20\d{2})(?!\d)/iu);
  if (match && monthNumber(match[1])) return isoDate(Number(match[3]), monthNumber(match[1]), Number(match[2]));
  return '';
}

function extractDateRangeLabel(brief) {
  let match = brief.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
  if (match) return `${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}.${String(Number(match[3])).padStart(2, '0')}.${match[4]}`;
  match = brief.match(/(?<![\p{L}\p{N}])(\d{1,2})\.?\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th|\.)?\s+(?:(?:of|dňa|dna|dne|am)\s+)?([\p{L}]+)\.?,?\s+(20\d{2})(?!\d)/iu);
  const month = match ? monthNumber(match[3]) : 0;
  return match && month
    ? `${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}.${String(month).padStart(2, '0')}.${match[4]}`
    : '';
}

function extractDistance(brief) {
  const normalized = normalizeForMatch(brief);
  const halfMarathon = ['half marathon', 'polmaraton', 'pulmaraton', 'halbmarathon']
    .some(entry => lexiconEntryMatches(normalized, entry));
  const fullMarathon = ['marathon', 'maraton']
    .some(entry => lexiconEntryMatches(normalized, entry));
  const marathon = halfMarathon ? '21.1K' : fullMarathon ? '42.2K' : '';
  if (marathon) return marathon;
  const match = foldForMatch(brief).match(/(?<![\p{L}\p{N}])(\d{1,3}(?:[.,]\d{1,2})?)\s*(km|kilomet(?:er|re)s?|kilometr[\p{L}]*|k|mi|miles?|mile|mil|meile[\p{L}]*)(?![\p{L}\p{N}])/iu);
  if (!match) return '';
  const amount = match[1].replace(',', '.');
  return `${amount}${/^(?:mi|mile|mil|meil)/i.test(match[2]) ? 'MI' : 'K'}`.slice(0, 10);
}

function extractEdition(brief) {
  const normalized = normalizeForMatch(brief);
  const terms = '(?:annual|edition|year|rocnik|edycja|ausgabe|auflage|jahrgang)';
  const match = normalized.match(new RegExp(`(?:^| )(?:(\\d{1,3})(?:st|nd|rd|th)?\\s+${terms}|${terms}\\s+(\\d{1,3}))(?: |$)`, 'i'));
  return match ? String(Number(match[1] || match[2])) : '';
}

function normalizeLocation(candidate, locale) {
  const cleaned = cleanDisplayText(candidate, '', 30)
    .replace(/\b(?:the|a|an|der|die|das|dem|den|eine|einer)\b$/iu, '')
    .trim();
  if (!cleaned) return '';
  return LOCATION_ALIASES[locale]?.[normalizeForMatch(cleaned)] || titleCase(cleaned);
}

function extractLocation(brief, locale = 'en') {
  const word = "[\\p{L}][\\p{L}'’\\-]*";
  const eventDescriptor = '(?:night|midnight|day|evening|trail|city|urban|half|marathon|marat[\p{L}]*|p[\p{L}]*marat[\p{L}]*|halbmarathon|run|race|ride|cycling|challenge|competition|nočn[\p{L}]*|denn[\p{L}]*|večern[\p{L}]*|mestsk[\p{L}]*|městsk[\p{L}]*|beh|běh|bežeck[\p{L}]*|běžeck[\p{L}]*|pretek[\p{L}]*|závod[\p{L}]*|cyklist[\p{L}]*|výzva|súťaž|soutěž|nacht[\p{L}]*|abend[\p{L}]*|stadtlauf|lauf|rennen|radrenn[\p{L}]*|wettkampf|nocn[\p{L}]*|dzienn[\p{L}]*|wieczorn[\p{L}]*|miejsk[\p{L}]*|bieg[\p{L}]*|wyścig[\p{L}]*|wyzwanie|zawody)';
  const stop = '(?:on|at|during|for|with|there|which|that|and|dňa|dna|počas|pre|ktor[\p{L}]*|dne|během|pro|kter[\p{L}]*|am|um|während|für|mit|und|dnia|podczas|dla|któr[\p{L}]*|i)';
  const patterns = [
    // Many ordinary users start with the place instead of writing “in Prague”.
    // Stop before the first event descriptor so only the location becomes type.
    new RegExp(`^\\s*(${word}(?:\\s+${word}){0,2}?)\\s+(?=${eventDescriptor}(?![\\p{L}\\p{N}]))`, 'iu'),
    new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:city\\s+of|town\\s+of|mesto|meste|město|městě|stadt|miasto|mieście)(?:\\s+(?:of|von))?\\s+(${word}(?:\\s+${word}){0,2}?)(?=\\s+${stop}(?![\\p{L}\\p{N}])|\\s+\\d|[,.!?]|$)`, 'iu'),
    new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:in|near|v|vo|ve|pri|neďaleko|blízko|u|poblíž|bei|nahe|w|we|koło|blisko|niedaleko)\\s+(${word}(?:\\s+${word}){0,2}?)(?=\\s+${stop}(?![\\p{L}\\p{N}])|\\s+\\d|[,.!?]|$)`, 'iu'),
  ];
  for (const pattern of patterns) {
    const match = brief.match(pattern);
    if (match) {
      const candidate = normalizeLocation(match[1], locale);
      const candidateWords = normalizeForMatch(candidate).split(' ').filter(Boolean);
      const looksLikeEvent = candidateWords.length > 0 && candidateWords.every(word =>
        ['running', 'cycling', 'trail', 'night', 'city'].some(category => matchesLexicon(word, category)));
      if (candidate && !looksLikeEvent) return candidate;
    }
  }
  return '';
}

function inferDiscipline(brief) {
  if (/\b(?:cycl(?:e|ing|ist)|bike|biking|bicycle|mtb)\b/i.test(brief) || matchesLexicon(brief, 'cycling')) return 'cycling';
  if (/\b(?:trail|mountain|ultra|hike|hiking|cross-country)\b/i.test(brief) || matchesLexicon(brief, 'trail')) return 'trail';
  if (/\b(?:run|runner|running|race|marathon|sprint|relay|5k|10k)\b/i.test(brief) || matchesLexicon(brief, 'running')) return 'running';
  return 'general';
}

function inferMotif(brief, discipline) {
  if (discipline === 'cycling') return 'cycling';
  if (discipline === 'trail') return 'trail';
  if (/\b(?:night|midnight|moon|stars?|dark|nocturnal)\b/i.test(brief) || matchesLexicon(brief, 'night')) return 'night';
  if (/\b(?:city|urban|skyline|bridge|street)\b/i.test(brief) || matchesLexicon(brief, 'city')) return 'city';
  if (discipline === 'running') return 'runner';
  return 'general';
}

function inferMood(brief) {
  if (/\b(?:premium|elegant|luxury|classic|formal)\b/i.test(brief) || matchesLexicon(brief, 'premium')) return 'premium';
  if (/\b(?:kids?|junior|school|fun|playful|family)\b/i.test(brief) || matchesLexicon(brief, 'playful')) return 'playful';
  if (/\b(?:technical|industrial|geometric|minimal)\b/i.test(brief) || matchesLexicon(brief, 'technical')) return 'technical';
  return 'bold';
}

function hasCountedRunners(brief, countCategory) {
  const tokens = normalizeForMatch(brief).split(' ').filter(Boolean);
  const countEntries = Object.values(LANGUAGE_LEXICONS).flatMap(lexicon => lexicon[countCategory] || []);
  const nounEntries = Object.values(LANGUAGE_LEXICONS).flatMap(lexicon => lexicon.runnerNouns || []);
  for (let index = 0; index < tokens.length; index += 1) {
    if (!countEntries.some(entry => lexiconEntryMatches(tokens[index], entry))) continue;
    const nearby = tokens.slice(index + 1, index + 5).join(' ');
    if (nounEntries.some(entry => lexiconEntryMatches(nearby, entry))) return true;
  }
  return false;
}

function inferRunnerCount(brief, discipline) {
  if (discipline !== 'running') return 1;
  if (/\b(?:three|3)\s+(?:elegant\s+|dynamic\s+|athletic\s+)?runners?\b/i.test(brief) || hasCountedRunners(brief, 'three')) return 3;
  if (/\b(?:two|2)\s+(?:elegant\s+|dynamic\s+|athletic\s+)?runners?\b/i.test(brief) || hasCountedRunners(brief, 'two')) return 2;
  return 1;
}

function disciplineLabel(discipline, locale = 'en') {
  const labels = TITLE_LANGUAGE[locale] || TITLE_LANGUAGE.en;
  return labels[discipline] || labels.general;
}

function derivedTitle({ location, discipline, motif }, rawBrief, locale = 'en') {
  const labels = TITLE_LANGUAGE[locale] || TITLE_LANGUAGE.en;
  let motifWord = motif === 'night' ? labels.night : motif === 'city' ? labels.city : '';
  let disciplineWord = disciplineLabel(discipline, locale);
  if (locale === 'de' && discipline === 'running' && motif === 'night') {
    motifWord = '';
    disciplineWord = 'NACHTLAUF';
  } else if (locale === 'de' && discipline === 'running' && motif === 'city') {
    motifWord = '';
    disciplineWord = 'STADTLAUF';
  }
  const parts = [location ? location.toLocaleUpperCase('en-US') : '', motifWord, disciplineWord].filter(Boolean);
  let title = cleanDisplayText(parts.join(' '), labels.fallback, 34).toLocaleUpperCase('en-US');
  if (title.toLocaleLowerCase('en-US') === rawBrief.toLocaleLowerCase('en-US')) title = `${title} ${labels.event}`.slice(0, 34);
  return title;
}

function paletteFor(motif, mood) {
  // Premium night medals use the same restrained material hierarchy as the
  // hand-authored showcase: black body, gold edge/accent, white identity, and
  // one cool architectural support color. This avoids the accidental neon
  // mix that results from merely reordering a generic five-color list.
  if (motif === 'night' && mood === 'premium') {
    return {
      ids: ['midnight-black', 'silk-gold', 'natural-white', 'electric-blue', 'graphite-gray'],
      roles: {
        body: 'midnight-black',
        rim: 'silk-gold',
        primary: 'natural-white',
        accent: 'silk-gold',
        support: 'electric-blue',
      },
    };
  }
  const lookup = {
    night: ['midnight-black', 'natural-white', 'electric-blue', 'signal-lime', 'silk-gold'],
    city: ['graphite-gray', 'natural-white', 'signal-red', 'electric-blue', 'midnight-black'],
    trail: ['midnight-black', 'signal-lime', 'silk-gold', 'natural-white', 'graphite-gray'],
    cycling: ['electric-blue', 'midnight-black', 'natural-white', 'signal-red', 'silk-gold'],
    runner: ['midnight-black', 'signal-red', 'natural-white', 'silk-gold', 'electric-blue'],
    general: ['electric-blue', 'silk-gold', 'natural-white', 'midnight-black', 'signal-lime'],
  };
  const ids = [...lookup[motif]];
  if (mood === 'premium') {
    const gold = ids.indexOf('silk-gold');
    if (gold > 1) [ids[1], ids[gold]] = [ids[gold], ids[1]];
  }
  return {
    ids,
    roles: { body: ids[0], rim: ids[1], primary: ids[2], accent: ids[3], support: ids[4] },
  };
}

function normalizeEvent(input = {}) {
  const date = /^20\d{2}-\d{2}-\d{2}$/.test(String(input.date || '')) ? String(input.date) : '';
  // Schema defaults must not depend on the machine clock: identical briefs
  // should generate byte-for-byte identical projects years later.
  const year = Math.round(clamp(input.year || date.slice(0, 4), 2000, 2100, DEFAULT_EVENT_YEAR));
  return {
    title: cleanDisplayText(input.title, 'COMMUNITY CHALLENGE', 34).toLocaleUpperCase('en-US'),
    subtitle: cleanDisplayText(input.subtitle, '', 34).toLocaleUpperCase('en-US'),
    location: cleanDisplayText(input.location, '', 30),
    distance: cleanDisplayText(input.distance, '', 10).toLocaleUpperCase('en-US'),
    date,
    year,
    edition: cleanDisplayText(input.edition, '', 4),
  };
}

function normalizePalette(input, motif, mood) {
  const fallback = paletteFor(motif, mood);
  const sourceIds = Array.isArray(input?.ids) ? input.ids : [];
  const ids = [...new Set(sourceIds.filter(id => SAFE_PALETTE_IDS.has(id)).slice(0, 6))];
  for (const id of fallback.ids) if (ids.length < 5 && !ids.includes(id)) ids.push(id);
  const role = key => {
    const candidate = input?.roles?.[key];
    return ids.includes(candidate) ? candidate : fallback.roles[key];
  };
  const roles = { body: role('body'), rim: role('rim'), primary: role('primary'), accent: role('accent'), support: role('support') };
  for (const [key, id] of Object.entries(roles)) if (!ids.includes(id)) roles[key] = ids[0];
  return { ids, roles };
}

function normalizeVariant(input, fallback) {
  const source = input && typeof input === 'object' ? input : {};
  const shape = ['circle', 'oval', 'rounded', 'hexagon', 'shield'].includes(source.shape) ? source.shape : fallback.shape;
  const rimStyle = Object.hasOwn(RIM_STYLE_INFO, source.rimStyle) ? source.rimStyle : fallback.rimStyle;
  const attachment = Object.hasOwn(ATTACHMENT_STYLE_INFO, source.attachment) ? source.attachment : fallback.attachment;
  return {
    id: cleanDisplayText(source.id, fallback.id, 32).toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback.id,
    label: cleanDisplayText(source.label, fallback.label, 36),
    description: cleanDisplayText(source.description, fallback.description, 100),
    shape,
    width: clamp(source.width, DESIGN_LIMITS.medalMin, DESIGN_LIMITS.medalMax, fallback.width),
    height: clamp(source.height, DESIGN_LIMITS.medalMin, DESIGN_LIMITS.medalMax, fallback.height),
    rimStyle,
    attachment,
    rimWidth: clamp(source.rimWidth, .6, DESIGN_LIMITS.rimWidthMax, fallback.rimWidth),
    rimHeight: clamp(source.rimHeight, .2, DESIGN_LIMITS.rimHeightMax, fallback.rimHeight),
    cornerRadius: clamp(source.cornerRadius, 2, 30, fallback.cornerRadius),
  };
}

/**
 * Convert untrusted plan-shaped data into the constrained v1 schema.
 * Unknown fields, URLs, executable markup, excessive objects, and arbitrary
 * geometry are deliberately not preserved.
 */
export function normalizeMedalDesignPlan(input) {
  const source = input && typeof input === 'object' ? input : {};
  const discipline = DISCIPLINES.has(source.creative?.discipline) ? source.creative.discipline : 'general';
  const motif = MOTIFS.has(source.creative?.motif) ? source.creative.motif : discipline === 'general' ? 'general' : discipline;
  const mood = MOODS.has(source.creative?.mood) ? source.creative.mood : 'bold';
  const event = normalizeEvent(source.event);
  const palette = normalizePalette(source.palette, motif, mood);
  const suppliedVariants = Array.isArray(source.variants) ? source.variants.slice(0, 4) : [];
  const variants = VARIANT_LIBRARY.map((fallback, index) => normalizeVariant(suppliedVariants[index], fallback));
  return {
    schema: MEDAL_DESIGN_PLAN_SCHEMA,
    version: MEDAL_DESIGN_PLAN_VERSION,
    sourceFingerprint: /^[a-z0-9]{7,16}$/i.test(String(source.sourceFingerprint || '')) ? String(source.sourceFingerprint) : stableHash(JSON.stringify({ event, discipline, motif, mood })),
    event,
    creative: { discipline, motif, mood, runnerCount: Math.round(clamp(source.creative?.runnerCount, 1, 3, 1)) },
    manufacturing: {
      nozzle: [0.2, 0.4, 0.6, 0.8].includes(Number(source.manufacturing?.nozzle)) ? Number(source.manufacturing.nozzle) : .4,
      layerHeight: clamp(source.manufacturing?.layerHeight, .05, .5, .2),
      baseThickness: clamp(source.manufacturing?.baseThickness, 1.2, DESIGN_LIMITS.baseThicknessMax, 2.4),
      reliefHeight: clamp(source.manufacturing?.reliefHeight, .2, 2, .6),
      flatBack: true,
      maxElements: Math.round(clamp(source.manufacturing?.maxElements, 12, MAX_GENERATED_ELEMENTS, 64)),
    },
    palette,
    variants,
  };
}

/** Return structured validation errors without mutating the supplied plan. */
export function validateMedalDesignPlan(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) errors.push('Plan must be an object.');
  if (input?.schema !== MEDAL_DESIGN_PLAN_SCHEMA) errors.push(`schema must be ${MEDAL_DESIGN_PLAN_SCHEMA}.`);
  if (input?.version !== MEDAL_DESIGN_PLAN_VERSION) errors.push(`version must be ${MEDAL_DESIGN_PLAN_VERSION}.`);
  if (!input?.event || typeof input.event !== 'object') errors.push('event is required.');
  if (!cleanDisplayText(input?.event?.title, '', 34)) errors.push('event.title is required.');
  if (!DISCIPLINES.has(input?.creative?.discipline)) errors.push('creative.discipline is invalid.');
  if (!MOTIFS.has(input?.creative?.motif)) errors.push('creative.motif is invalid.');
  if (!MOODS.has(input?.creative?.mood)) errors.push('creative.mood is invalid.');
  if (![1, 2, 3].includes(input?.creative?.runnerCount)) errors.push('creative.runnerCount is invalid.');
  if (input?.manufacturing?.flatBack !== true) errors.push('manufacturing.flatBack must be true.');
  if (!Array.isArray(input?.palette?.ids) || input.palette.ids.length < 3 || input.palette.ids.length > 6) errors.push('palette.ids must contain 3–6 colors.');
  if (Array.isArray(input?.palette?.ids) && input.palette.ids.some(id => !SAFE_PALETTE_IDS.has(id))) errors.push('palette.ids contains an unsupported filament.');
  if (!Array.isArray(input?.variants) || input.variants.length !== 4) errors.push('Exactly four variants are required.');
  if (Array.isArray(input?.variants)) {
    const ids = new Set();
    for (const variant of input.variants) {
      if (!['circle', 'oval', 'rounded', 'hexagon', 'shield'].includes(variant?.shape)) errors.push('A variant has an invalid body shape.');
      if (!Object.hasOwn(RIM_STYLE_INFO, variant?.rimStyle)) errors.push('A variant has an invalid rim style.');
      if (!Object.hasOwn(ATTACHMENT_STYLE_INFO, variant?.attachment)) errors.push('A variant has an invalid attachment.');
      if (!variant?.id || ids.has(variant.id)) errors.push('Variant IDs must be present and unique.');
      ids.add(variant?.id);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Parse ordinary event language without retaining or displaying the raw brief. */
export function parseMedalBrief(value, options = {}) {
  const brief = cleanBrief(value);
  const locale = inferBriefLocale(brief, options.locale);
  const discipline = inferDiscipline(brief);
  const motif = inferMotif(brief, discipline);
  const mood = inferMood(brief);
  const date = extractDate(brief);
  const location = extractLocation(brief, locale);
  const yearMatch = brief.match(/\b(20\d{2})\b/);
  const parsed = normalizeMedalDesignPlan({
    sourceFingerprint: stableHash(brief.toLocaleLowerCase('en-US')),
    event: {
      title: derivedTitle({ location, discipline, motif }, brief, locale),
      subtitle: options.subtitle || extractDateRangeLabel(brief),
      location,
      distance: extractDistance(brief),
      date,
      year: date ? Number(date.slice(0, 4)) : yearMatch ? Number(yearMatch[1]) : options.year,
      edition: extractEdition(brief),
    },
    creative: { discipline, motif, mood, runnerCount: inferRunnerCount(brief, discipline) },
    manufacturing: options.manufacturing,
    palette: options.palette,
  });
  return parsed;
}

function idFactory(plan, variantId) {
  let index = 0;
  return prefix => `${prefix}-${plan.sourceFingerprint}-${variantId}-${String(++index).padStart(2, '0')}`;
}

function baseElement(id, type, name, x, y, color, options = {}) {
  return {
    id: id(type), type, name, x, y, color,
    rotation: options.rotation || 0,
    scaleX: options.scaleX ?? 1,
    scaleY: options.scaleY ?? 1,
    lockAspect: options.lockAspect !== false,
    face: options.face === 'back' ? 'back' : 'front',
    operation: options.operation || 'raise',
    zHeight: options.zHeight ?? .6,
    zDepth: options.zDepth ?? .2,
    inlayHeight: options.inlayHeight || 0,
    layerSnap: true,
    combine: 'replace',
    groupId: options.groupId || null,
    hidden: false,
    locked: false,
  };
}

function textElement(id, name, value, x, y, size, color, options = {}) {
  return {
    ...baseElement(id, 'text', name, x, y, color, options),
    text: cleanDisplayText(value, 'EVENT', 44),
    fontSize: size,
    fontFamily: options.fontFamily || 'Arial',
    weight: options.weight || 900,
  };
}

function fittedTextSize(value, maximumWidth, preferredSize, minimumSize = 3) {
  const length = Math.max(1, [...String(value || '')].length);
  return Math.max(minimumSize, Math.min(preferredSize, maximumWidth / (length * .59)));
}

function shapeElement(id, name, shape, x, y, size, color, options = {}) {
  return { ...baseElement(id, 'shape', name, x, y, color, options), shape, size };
}

function pathElement(id, name, points, x, y, color, options = {}) {
  return {
    ...baseElement(id, 'path', name, x, y, color, options),
    points: points.map(([px, py]) => [px, py]),
    scale: options.scale ?? 1,
    closed: options.closed !== false,
    strokeWidth: options.strokeWidth ?? .9,
  };
}

function circlePoints(radius, count = 48) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = index * Math.PI * 2 / count;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function reliefTiers(plan) {
  const layer = plan.manufacturing.layerHeight;
  return { background: layer * 2, middle: layer * 3, foreground: layer * 4 };
}

function starfield(id, color, groupId, offsetX = 0, offsetY = 0, options = {}) {
  const height = options.zHeight;
  return [
    shapeElement(id, 'North star', 'star', offsetX - 10.5, offsetY - 7.5, 4.5, color, { groupId, zHeight: height }),
    shapeElement(id, 'East star', 'star', offsetX + 11.5, offsetY - 10.5, 4, color, { groupId, rotation: 18, zHeight: height }),
    shapeElement(id, 'Small star', 'star', offsetX + 15, offsetY - 2, 3.7, color, { groupId, rotation: 9, zHeight: height }),
  ];
}

function runnerMotif(id, slots, groupId, options = {}) {
  const x = options.x || 0, y = options.y || 0, scale = options.scale || 1;
  const tiers = options.tiers || { background: .4, middle: .6, foreground: .8 };
  return [
    pathElement(id, 'Runner silhouette', RUNNER_BODY, x, y, slots.primary, { groupId, scale, rotation: options.rotation || 0, zHeight: tiers.foreground }),
    shapeElement(id, 'Runner head', 'circle', x + 1.2 * scale, y - 10.1 * scale, 4.2 * scale, slots.primary, { groupId, zHeight: tiers.foreground }),
    pathElement(id, 'Runner speed line upper', [[-9,0],[-2,0]], x - 2 * scale, y - 2.6 * scale, slots.accent, { groupId, closed: false, strokeWidth: 1.15, zHeight: tiers.middle }),
    pathElement(id, 'Runner speed line lower', [[-8,0],[-3,0]], x - 2 * scale, y + .8 * scale, slots.accent, { groupId, closed: false, strokeWidth: .9, zHeight: tiers.middle }),
  ];
}

function cyclingMotif(id, slots, groupId, options = {}) {
  const x = options.x || 0, y = options.y || 0, scale = options.scale || 1;
  return [
    pathElement(id, 'Front wheel', circlePoints(5.2), x - 7 * scale, y + 5 * scale, slots.primary, { groupId, scale, closed: false, strokeWidth: 1.4 }),
    pathElement(id, 'Rear wheel', circlePoints(5.2), x + 8 * scale, y + 5 * scale, slots.primary, { groupId, scale, closed: false, strokeWidth: 1.4 }),
    pathElement(id, 'Bicycle frame', [[-7,5],[-2,-1],[3,5],[-7,5],[1,5],[-2,-1],[5,-3],[8,5]], x, y, slots.accent, { groupId, scale, closed: false, strokeWidth: 1.2 }),
    pathElement(id, 'Cyclist silhouette', CYCLIST_BODY, x, y - 2 * scale, slots.primary, { groupId, scale }),
    shapeElement(id, 'Cyclist head', 'circle', x + .2 * scale, y - 11.2 * scale, 3.7 * scale, slots.primary, { groupId }),
  ];
}

function trailMotif(id, slots, groupId, options = {}) {
  const x = options.x || 0, y = options.y || 0, scale = options.scale || 1;
  return [
    pathElement(id, 'Far mountain range', MOUNTAIN_BACK, x, y, slots.support, { groupId, scale, closed: false, strokeWidth: 1.3 }),
    pathElement(id, 'Mountain ridge', MOUNTAIN_FRONT, x, y + 2 * scale, slots.primary, { groupId, scale, closed: false, strokeWidth: 1.7 }),
    pathElement(id, 'Trail route', COURSE_LINE, x, y + 4 * scale, slots.accent, { groupId, scale, closed: false, strokeWidth: 1.2 }),
    shapeElement(id, 'Summit marker', 'diamond', x + 3 * scale, y - 11 * scale, 3.7 * scale, slots.accent, { groupId }),
  ];
}

function cityMotif(id, slots, groupId, options = {}) {
  const x = options.x || 0, y = options.y || 0, scale = options.scale || 1;
  const tiers = options.tiers || { background: .4, middle: .6, foreground: .8 };
  const lights = [-18,-10,-2,7,15,21].map((lightX, index) => shapeElement(
    id,
    `City light ${index + 1}`,
    'square',
    x + lightX * scale,
    y + (3.8 + (index % 2) * 1.4) * scale,
    1.8 * scale,
    index % 3 === 0 ? slots.accent : slots.primary,
    { groupId, zHeight: tiers.middle },
  ));
  return [
    pathElement(id, 'City skyline', CITY_SKYLINE, x, y, slots.support, { groupId, scale, closed: true, zHeight: tiers.background }),
    pathElement(id, 'City horizon', [[-25,0],[25,0]], x, y + 7 * scale, slots.accent, { groupId, scale, closed: false, strokeWidth: 1.15, zHeight: tiers.middle }),
    shapeElement(id, 'City beacon', 'diamond', x + 13.2 * scale, y - 9 * scale, 3.8 * scale, slots.accent, { groupId, zHeight: tiers.middle }),
    ...lights,
  ];
}

function nightMotif(id, slots, groupId, options = {}) {
  const x = options.x || 0, y = options.y || 0, scale = options.scale || 1;
  const tiers = options.tiers || { background: .4, middle: .6, foreground: .8 };
  const runnerCount = Math.max(1, Math.min(3, Number(options.runnerCount) || 1));
  const runnerScale = scale * (runnerCount > 1 ? 1.28 : 1.48);
  const runnerX = x + (runnerCount > 1 ? -2.2 : 2.2) * scale;
  const runnerY = y + .8 * scale;
  const runners = [];
  if (runnerCount >= 2) {
    // The gold athlete is offset forward and down rather than stacked directly
    // behind the white athlete. Both complete poses remain readable at Top
    // view scale, and their heads no longer merge into a detached circle/limb.
    const rearScale = runnerScale * .8;
    const rearX = x + 13.2 * scale;
    const rearY = y + 3.6 * scale;
    runners.push(
      pathElement(id, 'Night runner two silhouette', RUNNER_BODY, rearX, rearY, slots.accent, { groupId, scale: rearScale, rotation: -3, zHeight: tiers.middle }),
      shapeElement(id, 'Night runner two head', 'circle', rearX + 1.2 * rearScale, rearY - 10.1 * rearScale, 4.2 * rearScale, slots.accent, { groupId, zHeight: tiers.middle }),
    );
  }
  if (runnerCount >= 3) {
    const thirdScale = runnerScale * .69;
    const thirdX = x + 13.5 * scale;
    const thirdY = y + 4.5 * scale;
    runners.push(
      pathElement(id, 'Night runner three silhouette', RUNNER_BODY, thirdX, thirdY, slots.support, { groupId, scale: thirdScale, rotation: 3, zHeight: tiers.middle }),
      shapeElement(id, 'Night runner three head', 'circle', thirdX + 1.2 * thirdScale, thirdY - 10.1 * thirdScale, 4.2 * thirdScale, slots.support, { groupId, zHeight: tiers.middle }),
    );
  }
  return [
    shapeElement(id, 'Moon disc', 'circle', x - 16 * scale, y - 7.8 * scale, 13.2 * scale, slots.accent, { groupId, zHeight: tiers.foreground }),
    shapeElement(id, 'Moon cutout', 'circle', x - 12.8 * scale, y - 10.2 * scale, 11.5 * scale, slots.body, { groupId, zHeight: tiers.foreground }),
    ...starfield(id, slots.accent, groupId, x + 4 * scale, y - 1.5 * scale, { zHeight: tiers.middle }),
    ...cityMotif(id, slots, groupId, { x, y: y + 5.2 * scale, scale: scale * 1.02, tiers }),
    ...runners,
    pathElement(id, 'Night runner silhouette', RUNNER_BODY, runnerX, runnerY, slots.primary, { groupId, scale: runnerScale, zHeight: tiers.foreground }),
    shapeElement(id, 'Night runner head', 'circle', runnerX + 1.2 * runnerScale, runnerY - 10.1 * runnerScale, 4.2 * runnerScale, slots.primary, { groupId, zHeight: tiers.foreground }),
    pathElement(id, 'Night speed trail', [[-14,0],[-8,-.6],[-1,0]], runnerX - 7 * scale, runnerY + 2.5 * scale, slots.primary, { groupId, scale, closed: false, strokeWidth: 1, zHeight: tiers.middle }),
  ];
}

function generalMotif(id, slots, groupId, options = {}) {
  const x = options.x || 0, y = options.y || 0, scale = options.scale || 1;
  const rays = Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4;
    return pathElement(id, `Achievement ray ${index + 1}`, [[Math.cos(angle) * 8, Math.sin(angle) * 8],[Math.cos(angle) * 12, Math.sin(angle) * 12]], x, y, slots.accent, { groupId, scale, closed: false, strokeWidth: 1 });
  });
  return [shapeElement(id, 'Achievement star', 'star', x, y, 14 * scale, slots.primary, { groupId }), ...rays];
}

function motifElements(plan, id, slots, groupId, options = {}) {
  const enrichedOptions = { ...options, tiers: reliefTiers(plan), runnerCount: plan.creative.runnerCount };
  const motif = plan.creative.motif;
  if (motif === 'cycling') return cyclingMotif(id, slots, groupId, enrichedOptions);
  if (motif === 'trail') return trailMotif(id, slots, groupId, enrichedOptions);
  if (motif === 'night') return nightMotif(id, slots, groupId, enrichedOptions);
  if (motif === 'city') return cityMotif(id, slots, groupId, enrichedOptions);
  if (motif === 'runner') return runnerMotif(id, slots, groupId, enrichedOptions);
  return generalMotif(id, slots, groupId, enrichedOptions);
}

function backOptions(groupId) {
  return { face: 'back', operation: 'inlay', zDepth: .2, zHeight: .2, groupId };
}

function eventDateLabel(event) {
  if (/^\d{2}-\d{2}\.\d{2}\.20\d{2}$/.test(event.subtitle)) return event.subtitle;
  if (!event.date) return String(event.year);
  const [year, month, day] = event.date.split('-');
  return `${day}.${month}.${year}`;
}

function eventTitleLines(event) {
  const full = event.title.trim();
  const place = event.location.trim().toLocaleUpperCase('en-US');
  if (place && full.startsWith(place)) {
    const remainder = full.slice(place.length).trim();
    if (remainder) return { primary: place, secondary: remainder };
  }
  if (full.length <= 15) return { primary: full, secondary: '' };
  const words = full.split(/\s+/);
  let split = 1, best = Infinity;
  for (let index = 1; index < words.length; index += 1) {
    const difference = Math.abs(words.slice(0, index).join(' ').length - words.slice(index).join(' ').length);
    if (difference < best) { best = difference; split = index; }
  }
  return { primary: words.slice(0, split).join(' '), secondary: words.slice(split).join(' ') };
}

function frontTitleElements(id, event, slots, groupId, layout, tiers) {
  const lines = eventTitleLines(event);
  const elements = [textElement(
    id,
    'Event title',
    lines.primary,
    layout.x || 0,
    layout.primaryY,
    fittedTextSize(lines.primary, layout.maximumWidth, layout.preferredSize, 3.6),
    slots.primary,
    { groupId, weight: 900, zHeight: tiers.foreground },
  )];
  if (lines.secondary) elements.push(textElement(
    id,
    'Event subtitle',
    lines.secondary,
    layout.x || 0,
    layout.secondaryY,
    fittedTextSize(lines.secondary, layout.secondaryWidth || layout.maximumWidth, layout.secondarySize || 4.1, 3.2),
    slots.accent,
    { groupId, weight: 900, zHeight: tiers.foreground },
  ));
  return elements;
}

function frontForVariant(plan, variant, id, slots, groupId, index) {
  const event = plan.event;
  const distance = event.distance || (event.edition ? `${event.edition}TH` : String(event.year));
  const date = eventDateLabel(event);
  const tiers = reliefTiers(plan);
  if (index === 0) {
    return [
      ...frontTitleElements(id, event, slots, groupId, { primaryY: -21.7, secondaryY: -16.1, maximumWidth: 38, preferredSize: 6.1, secondaryWidth: 34, secondarySize: 4.2 }, tiers),
      pathElement(id, 'Title underline', [[-11,0],[11,0]], 0, -12.9, slots.accent, { groupId, closed: false, strokeWidth: .75, zHeight: tiers.middle }),
      ...motifElements(plan, id, slots, groupId, { x: 0, y: -.2, scale: .76 }),
      textElement(id, 'Distance', distance, 0, 18.4, 9.2, slots.accent, { groupId, weight: 900, zHeight: tiers.foreground }),
      textElement(id, 'Event date', date, 0, 26, 3.2, slots.primary, { groupId, weight: 800, zHeight: tiers.middle }),
    ];
  }
  if (index === 1) {
    return [
      pathElement(id, 'Kinetic accent panel', [[-22,-13],[-18,-15],[-4,8],[-9,10]], 0, 0, slots.accent, { groupId, closed: true, zHeight: tiers.background }),
      ...frontTitleElements(id, event, slots, groupId, { primaryY: -23.8, secondaryY: -18, maximumWidth: 38, preferredSize: 6.2, secondaryWidth: 33, secondarySize: 4.1 }, tiers),
      ...motifElements(plan, id, slots, groupId, { x: 3.2, y: 0, scale: .7 }),
      textElement(id, 'Distance', distance, -10.5, 18.2, 9.2, slots.accent, { groupId, weight: 900, zHeight: tiers.foreground }),
      textElement(id, 'Event date', date, 10.5, 22.3, fittedTextSize(date, 24, 3.25), slots.primary, { groupId, weight: 800, zHeight: tiers.middle }),
    ];
  }
  if (index === 2) {
    return [
      shapeElement(id, 'Central crest field', 'circle', 0, -1, 40, slots.neutral, { groupId, zHeight: tiers.background }),
      pathElement(id, 'Crest inner ring', circlePoints(21.5, 72), 0, -1, slots.accent, { groupId, closed: false, strokeWidth: .7, zHeight: tiers.middle }),
      ...motifElements(plan, id, slots, groupId, { x: 0, y: -.8, scale: .65 }),
      ...frontTitleElements(id, event, slots, groupId, { primaryY: -23, secondaryY: -17.7, maximumWidth: 38, preferredSize: 5.9, secondaryWidth: 32, secondarySize: 3.9 }, tiers),
      textElement(id, 'Distance', distance, 0, 17.8, 8.8, slots.accent, { groupId, weight: 900, zHeight: tiers.foreground }),
      textElement(id, 'Event date', date, 0, 25.1, 3.1, slots.primary, { groupId, weight: 800, zHeight: tiers.middle }),
      shapeElement(id, 'Left award star', 'star', -20.5, 18.5, 4, slots.accent, { groupId, zHeight: tiers.middle }),
      shapeElement(id, 'Right award star', 'star', 20.5, 18.5, 4, slots.accent, { groupId, zHeight: tiers.middle }),
    ];
  }
  return [
    pathElement(id, 'Panorama field', [[-27,-8],[27,-8],[27,10],[-27,10]], 0, 0, slots.neutral, { groupId, closed: true, zHeight: tiers.background }),
    ...motifElements(plan, id, slots, groupId, { x: 5, y: 1, scale: .66 }),
    ...frontTitleElements(id, event, slots, groupId, { primaryY: -20.5, secondaryY: -15.4, maximumWidth: 42, preferredSize: 5.8, secondaryWidth: 37, secondarySize: 3.9 }, tiers),
    textElement(id, 'Distance', distance, -17, 16.2, 8.4, slots.accent, { groupId, weight: 900, zHeight: tiers.foreground }),
    textElement(id, 'Event date', date, 13.5, 17.2, fittedTextSize(date, 25, 3.2), slots.primary, { groupId, weight: 800, zHeight: tiers.middle }),
  ];
}

function backForVariant(plan, id, slots, groupId, index) {
  const event = plan.event;
  const date = eventDateLabel(event);
  const place = event.location || 'FINISHER SERIES';
  const options = backOptions(groupId);
  const common = [
    textElement(id, 'Back date', date, 0, -10, 5.5, slots.primary, { ...options, weight: 900 }),
    textElement(id, 'Back location', place.toLocaleUpperCase('en-US'), 0, 10.5, fittedTextSize(place, 40, 4.4), slots.accent, { ...options, weight: 800 }),
  ];
  if (index === 0) return [
    ...common,
    shapeElement(id, 'Back edition seal', 'circle', 0, 0, 12, slots.support, options),
    textElement(id, 'Back edition', event.edition || '01', 0, .5, 5.4, slots.body, { ...options, weight: 900 }),
    pathElement(id, 'Back upper rule', [[-16,0],[16,0]], 0, -5.2, slots.support, { ...options, closed: false, strokeWidth: .8 }),
  ];
  if (index === 1) return [
    ...common,
    pathElement(id, 'Back route', COURSE_LINE, 0, 0, slots.support, { ...options, closed: false, strokeWidth: 1.4, scale: .85 }),
    shapeElement(id, 'Back route start', 'circle', -12.7, 6, 2.6, slots.primary, options),
    shapeElement(id, 'Back route finish', 'diamond', 12.7, 1, 3.1, slots.primary, options),
  ];
  if (index === 2) return [
    ...common,
    shapeElement(id, 'Back finisher star', 'star', 0, 0, 13, slots.support, options),
    textElement(id, 'Back mark', 'FIN', 0, .5, 3.7, slots.body, { ...options, weight: 900 }),
    pathElement(id, 'Back lower rule', [[-14,0],[14,0]], 0, 5.8, slots.primary, { ...options, closed: false, strokeWidth: .75 }),
  ];
  return [
    ...common,
    ...starfield(id, slots.support, groupId, 0, 0).map(element => ({ ...element, ...options })),
    pathElement(id, 'Back panorama line', [[-17,1],[-10,-2],[-3,1],[4,-4],[11,0],[17,-2]], 0, 0, slots.primary, { ...options, closed: false, strokeWidth: 1 }),
  ];
}

function timestampFor(plan) {
  const date = plan.event.date || `${plan.event.year}-01-01`;
  return `${date}T00:00:00.000Z`;
}

function scalePlanarElement(element, factor) {
  if (factor === 1) return element;
  const scaled = { ...element, x: element.x * factor, y: element.y * factor };
  if (scaled.type === 'text') scaled.fontSize *= factor;
  else if (scaled.type === 'shape') scaled.size *= factor;
  else if (scaled.type === 'path') {
    scaled.scale *= factor;
    scaled.strokeWidth *= factor;
  }
  return scaled;
}

function projectForVariant(plan, variant, index) {
  const project = createTemplateProject('blank');
  const nextId = idFactory(plan, variant.id);
  const slotOf = role => plan.palette.ids.indexOf(plan.palette.roles[role]);
  const slots = {
    body: Math.max(0, slotOf('body')),
    rim: Math.max(0, slotOf('rim')),
    primary: Math.max(0, slotOf('primary')),
    accent: Math.max(0, slotOf('accent')),
    support: Math.max(0, slotOf('support')),
    neutral: Math.max(0, plan.palette.ids.indexOf('graphite-gray')),
  };
  const frontGroup = `front-${variant.id}`;
  const backGroup = `back-${variant.id}`;
  // Coarse nozzles need proportionally larger artwork to preserve the same
  // number of printable extrusion lines. Scaling the whole planar design
  // avoids silently thickening/distorting only selected vector objects.
  const detailScale = Math.max(1, plan.manufacturing.nozzle / .4);
  const elements = [
    ...frontForVariant(plan, variant, nextId, slots, frontGroup, index),
    ...backForVariant(plan, nextId, slots, backGroup, index),
  ].slice(0, Math.min(plan.manufacturing.maxElements, MAX_GENERATED_ELEMENTS)).map(element => scalePlanarElement(element, detailScale));
  const loopWidth = Math.min(60, 34 * detailScale);
  const minimumLoopWall = Math.max(2.5 * detailScale, plan.manufacturing.nozzle * 2.25);
  const slotWidth = Math.min(29 * detailScale, loopWidth - minimumLoopWall * 2);
  const timestamp = timestampFor(plan);
  const normalized = normalizeProject({
    ...project,
    name: `${plan.event.title} · ${variant.label}`.slice(0, 60),
    template: 'generated-concept-v1',
    createdAt: timestamp,
    updatedAt: timestamp,
    profile: {
      ...project.profile,
      nozzle: plan.manufacturing.nozzle,
      layerHeight: plan.manufacturing.layerHeight,
      meshQuality: 'ultra',
    },
    medal: {
      ...project.medal,
      shape: variant.shape,
      diameter: (variant.shape === 'circle' ? variant.width : Math.max(variant.width, variant.height)) * detailScale,
      width: variant.width * detailScale,
      height: variant.height * detailScale,
      cornerRadius: variant.cornerRadius * detailScale,
      baseThickness: plan.manufacturing.baseThickness,
      minimumFloor: Math.min(1.2, plan.manufacturing.baseThickness - .2),
      defaultHeight: plan.manufacturing.reliefHeight,
      reliefHeight: plan.manufacturing.reliefHeight,
      baseColor: slots.body,
      rimStyle: variant.rimStyle,
      rimWidth: variant.rimWidth * detailScale,
      rimHeight: Math.max(variant.rimHeight, plan.manufacturing.layerHeight * 2),
      rimColor: slots.rim,
      loopStyle: variant.attachment,
      loopWidth,
      loopHeight: 8 * detailScale,
      slotWidth,
      slotHeight: 3.6 * detailScale,
      holeDiameter: 6 * detailScale,
      slitWidth: 25 * detailScale,
      slitHeight: 3.2 * detailScale,
      attachmentInset: 4 * detailScale,
    },
    paletteIds: [...plan.palette.ids],
    groups: [
      { id: frontGroup, name: 'Front composition' },
      { id: backGroup, name: 'Flat multicolor back' },
    ],
    elements,
    designPlan: {
      schema: plan.schema,
      version: plan.version,
      sourceFingerprint: plan.sourceFingerprint,
      event: { ...plan.event },
      creative: { ...plan.creative },
      variant: { id: variant.id, label: variant.label },
      planarScaleForNozzle: detailScale,
      flatBack: true,
    },
  });
  // normalizeProject is the final authority; this guard makes object budgets
  // explicit even if the application limit changes later.
  normalized.elements = normalized.elements.slice(0, MAX_GENERATED_ELEMENTS);
  return normalized;
}

/**
 * Generate four complete, editable, deterministic concepts and their shared
 * constrained plan. This is the main integration API for the Ideas panel.
 */
export function generateMedalConcepts(briefOrPlan, options = {}) {
  const plan = typeof briefOrPlan === 'string' || briefOrPlan == null
    ? parseMedalBrief(briefOrPlan, options)
    : normalizeMedalDesignPlan(briefOrPlan);
  const validation = validateMedalDesignPlan(plan);
  if (!validation.valid) throw new TypeError(`Invalid MedalDesignPlan v1: ${validation.errors.join(' ')}`);
  const concepts = plan.variants.map((variant, index) => {
    // Concept generation is an acceptance-gated pipeline, not a collection of
    // unchecked templates.  Geometry is polished and rescored deterministically
    // on this device; a weak result is rejected instead of being shown as if it
    // were a finished medal.
    const polished = requirePolishedMedal(projectForVariant(plan, variant, index));
    return {
      id: variant.id,
      label: variant.label,
      description: variant.description,
      quality: polished.assessment,
      polishIterations: polished.iterations,
      project: polished.project,
    };
  });
  return { plan, concepts };
}

/** Convenience API for callers that only need normalized project objects. */
export function generateMedalProjects(briefOrPlan, options = {}) {
  return generateMedalConcepts(briefOrPlan, options).concepts.map(concept => concept.project);
}
