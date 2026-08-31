import {
  LANGUAGE_CHANGE_EVENT,
  getCurrentLocale,
  initializeLocalization,
  setCurrentLocale,
} from './localization-runtime.js?v=20260831-release30';

const COPY = Object.freeze({
  en: Object.freeze({
    title: 'Workspace not found · PrintForge', heading: 'That workspace does not exist.',
    description: 'The link may be incomplete, or the product studio has not been published yet.', action: 'Return to workspace gallery',
  }),
  sk: Object.freeze({
    title: 'Pracovné prostredie sa nenašlo · PrintForge', heading: 'Toto pracovné prostredie neexistuje.',
    description: 'Odkaz môže byť neúplný alebo produktové štúdio zatiaľ nebolo zverejnené.', action: 'Späť do galérie pracovných prostredí',
  }),
  cs: Object.freeze({
    title: 'Pracovní prostředí nebylo nalezeno · PrintForge', heading: 'Toto pracovní prostředí neexistuje.',
    description: 'Odkaz může být neúplný nebo produktové studio zatím nebylo zveřejněno.', action: 'Zpět do galerie pracovních prostředí',
  }),
  de: Object.freeze({
    title: 'Arbeitsbereich nicht gefunden · PrintForge', heading: 'Dieser Arbeitsbereich ist nicht vorhanden.',
    description: 'Der Link ist möglicherweise unvollständig oder das Produktstudio wurde noch nicht veröffentlicht.', action: 'Zurück zur Arbeitsbereich-Galerie',
  }),
  pl: Object.freeze({
    title: 'Nie znaleziono środowiska · PrintForge', heading: 'To środowisko nie istnieje.',
    description: 'Łącze może być niepełne albo studio produktu nie zostało jeszcze opublikowane.', action: 'Wróć do galerii środowisk',
  }),
});

const scriptPath = new URL(import.meta.url).pathname;
const scriptSegments = scriptPath.split('/').filter(Boolean);
const hostedInGithubProject = location.hostname.endsWith('.github.io') && scriptSegments.length > 1;
document.querySelector('#returnHome').href = hostedInGithubProject ? `/${scriptSegments[0]}/` : '/';

function renderNotFound() {
  const copy = COPY[getCurrentLocale()] || COPY.en;
  document.title = copy.title;
  document.querySelector('#notFoundTitle').textContent = copy.heading;
  document.querySelector('#notFoundDescription').textContent = copy.description;
  document.querySelector('#returnHome').textContent = copy.action;
}

initializeLocalization({ context: 'hub' });
document.querySelector('[data-language-select]')?.addEventListener('change', event => setCurrentLocale(event.target.value, { updateUrl: true }));
window.addEventListener(LANGUAGE_CHANGE_EVENT, renderNotFound);
renderNotFound();
