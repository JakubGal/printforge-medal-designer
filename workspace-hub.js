import { WORKSPACES } from './workspace-registry.js?v=20260830-release8';
import {
  LANGUAGE_CHANGE_EVENT,
  getCurrentLocale,
  initializeLocalization,
} from './localization-runtime.js?v=20260901-release35';

const legacyQuery = new URLSearchParams(window.location.search);
if (legacyQuery.has('qa')) {
  window.location.replace(`./workspaces/medals/${window.location.search}${window.location.hash}`);
}

const grid = document.querySelector('#workspaceGrid');

const WORKSPACE_COPY = Object.freeze({
  en: Object.freeze({
    medals: Object.freeze({
      name: 'Medal Studio', category: 'Events & awards',
      description: 'Design detailed, multicolor, single- or double-sided medals with ribbon attachments, live pricing, print checks, and production exports.',
      action: 'Open studio', capabilities: Object.freeze(['3D direct editing', 'Image to objects', '3MF · STL · STEP · PDF']),
    }),
    skadis: Object.freeze({
      name: 'Skådis Organizer Studio', category: 'Home & workshop',
      description: 'A focused parametric workspace for IKEA Skådis holders, trays, hooks, and custom tool organizers.',
      action: 'Coming next', capabilities: Object.freeze(['Board-safe fittings', 'Parametric compartments', 'Material-aware walls']),
    }),
    custom: Object.freeze({
      name: 'Custom Product Studio', category: 'Creator workspace',
      description: 'A planned reusable studio for makers who want to publish their own guided parametric product configurator.',
      action: 'Planned', capabilities: Object.freeze(['Guided parameters', 'Reusable design tools', 'Future ordering']),
    }),
    ready: 'Ready now', planned: 'Planned',
  }),
  sk: Object.freeze({
    medals: Object.freeze({
      name: 'Štúdio medailí', category: 'Podujatia a ocenenia',
      description: 'Navrhujte detailné viacfarebné jednostranné aj obojstranné medaily s uchytením stuhy, okamžitým odhadom ceny, kontrolou tlače a výrobnými exportmi.',
      action: 'Otvoriť štúdio', capabilities: Object.freeze(['Priame úpravy v 3D', 'Obrázok na objekty', '3MF · STL · STEP · PDF']),
    }),
    skadis: Object.freeze({
      name: 'Štúdio organizérov Skådis', category: 'Domácnosť a dielňa',
      description: 'Špecializované parametrické prostredie pre držiaky, podnosy, háčiky a vlastné organizéry náradia na dosky IKEA Skådis.',
      action: 'Pripravujeme', capabilities: Object.freeze(['Bezpečné uchytenie do dosky', 'Parametrické priehradky', 'Steny podľa materiálu']),
    }),
    custom: Object.freeze({
      name: 'Štúdio vlastných výrobkov', category: 'Prostredie pre tvorcov',
      description: 'Plánované opakovane použiteľné štúdio pre tvorcov, ktorí chcú zverejniť vlastný vedený konfigurátor parametrického výrobku.',
      action: 'Plánované', capabilities: Object.freeze(['Vedené parametre', 'Opakovane použiteľné nástroje', 'Budúce objednávanie']),
    }),
    ready: 'Pripravené', planned: 'Plánované',
  }),
  cs: Object.freeze({
    medals: Object.freeze({
      name: 'Studio medailí', category: 'Události a ocenění',
      description: 'Navrhujte detailní vícebarevné jednostranné i oboustranné medaile s uchycením stuhy, okamžitým odhadem ceny, kontrolou tisku a výrobními exporty.',
      action: 'Otevřít studio', capabilities: Object.freeze(['Přímé úpravy ve 3D', 'Obrázek na objekty', '3MF · STL · STEP · PDF']),
    }),
    skadis: Object.freeze({
      name: 'Studio organizérů Skådis', category: 'Domácnost a dílna',
      description: 'Specializované parametrické prostředí pro držáky, podnosy, háčky a vlastní organizéry nářadí na desky IKEA Skådis.',
      action: 'Připravujeme', capabilities: Object.freeze(['Bezpečné uchycení do desky', 'Parametrické přihrádky', 'Stěny podle materiálu']),
    }),
    custom: Object.freeze({
      name: 'Studio vlastních výrobků', category: 'Prostředí pro tvůrce',
      description: 'Plánované opakovaně použitelné studio pro tvůrce, kteří chtějí zveřejnit vlastní průvodce parametrickým konfigurátorem výrobku.',
      action: 'Plánováno', capabilities: Object.freeze(['Vedené parametry', 'Opakovaně použitelné nástroje', 'Budoucí objednávání']),
    }),
    ready: 'Připraveno', planned: 'Plánováno',
  }),
  de: Object.freeze({
    medals: Object.freeze({
      name: 'Medaillen-Studio', category: 'Veranstaltungen und Auszeichnungen',
      description: 'Gestalten Sie detailreiche, mehrfarbige, ein- oder beidseitige Medaillen mit Bandbefestigung, sofortiger Preisschätzung, Druckprüfung und Produktionsdateien.',
      action: 'Studio öffnen', capabilities: Object.freeze(['Direkte 3D-Bearbeitung', 'Bild in Objekte umwandeln', '3MF · STL · STEP · PDF']),
    }),
    skadis: Object.freeze({
      name: 'Skådis-Organizer-Studio', category: 'Haushalt und Werkstatt',
      description: 'Ein spezialisiertes parametrisches Studio für Halter, Ablagen, Haken und individuelle Werkzeug-Organizer für IKEA Skådis.',
      action: 'Als Nächstes', capabilities: Object.freeze(['Sichere Plattenbefestigung', 'Parametrische Fächer', 'Materialgerechte Wände']),
    }),
    custom: Object.freeze({
      name: 'Studio für eigene Produkte', category: 'Arbeitsbereich für Kreative',
      description: 'Ein geplantes, wiederverwendbares Studio für Maker, die einen eigenen geführten parametrischen Produktkonfigurator veröffentlichen möchten.',
      action: 'Geplant', capabilities: Object.freeze(['Geführte Parameter', 'Wiederverwendbare Werkzeuge', 'Künftige Bestellungen']),
    }),
    ready: 'Jetzt verfügbar', planned: 'Geplant',
  }),
  pl: Object.freeze({
    medals: Object.freeze({
      name: 'Studio medali', category: 'Wydarzenia i nagrody',
      description: 'Projektuj szczegółowe, wielokolorowe, jedno- lub dwustronne medale z mocowaniem wstążki, natychmiastową wyceną, kontrolą druku i eksportem produkcyjnym.',
      action: 'Otwórz studio', capabilities: Object.freeze(['Bezpośrednia edycja 3D', 'Obraz na obiekty', '3MF · STL · STEP · PDF']),
    }),
    skadis: Object.freeze({
      name: 'Studio organizerów Skådis', category: 'Dom i warsztat',
      description: 'Specjalistyczne środowisko parametryczne do tworzenia uchwytów, półek, haczyków i organizerów narzędzi na tablice IKEA Skådis.',
      action: 'W przygotowaniu', capabilities: Object.freeze(['Bezpieczne mocowania do tablicy', 'Parametryczne przegródki', 'Ścianki dobrane do materiału']),
    }),
    custom: Object.freeze({
      name: 'Studio własnych produktów', category: 'Środowisko twórcy',
      description: 'Planowane studio wielokrotnego użytku dla twórców, którzy chcą opublikować własny prowadzony konfigurator produktu parametrycznego.',
      action: 'Planowane', capabilities: Object.freeze(['Prowadzone parametry', 'Narzędzia wielokrotnego użytku', 'Przyszłe zamówienia']),
    }),
    ready: 'Dostępne teraz', planned: 'Planowane',
  }),
});

function localizedWorkspace(workspace, locale) {
  return WORKSPACE_COPY[locale]?.[workspace.id] || WORKSPACE_COPY.en[workspace.id] || workspace;
}

function workspaceCard(workspace, locale) {
  const copy = localizedWorkspace(workspace, locale);
  const localeCopy = WORKSPACE_COPY[locale] || WORKSPACE_COPY.en;
  const article = document.createElement('article');
  article.className = `workspace-card ${workspace.status}`;
  article.dataset.workspace = workspace.id;

  const visual = document.createElement('div');
  visual.className = `workspace-visual ${workspace.visual}`;
  visual.setAttribute('aria-hidden', 'true');
  visual.replaceChildren(document.createElement('span'), document.createElement('i'), document.createElement('b'));

  const body = document.createElement('div');
  body.className = 'workspace-card-body';
  const meta = document.createElement('div');
  meta.className = 'workspace-meta';
  const category = document.createElement('span');
  category.textContent = copy.category;
  const availability = document.createElement('em');
  availability.textContent = workspace.status === 'ready' ? localeCopy.ready : localeCopy.planned;
  meta.append(category, availability);
  const title = document.createElement('h3');
  title.textContent = copy.name;
  const description = document.createElement('p');
  description.textContent = copy.description;
  const capabilities = document.createElement('ul');
  capabilities.replaceChildren(...copy.capabilities.map(capability => {
    const item = document.createElement('li');
    item.textContent = capability;
    return item;
  }));
  const action = document.createElement(workspace.href ? 'a' : 'span');
  action.className = `workspace-action${workspace.href ? '' : ' unavailable'}`;
  if (workspace.href) action.href = workspace.href;
  else action.setAttribute('aria-disabled', 'true');
  action.append(document.createTextNode(copy.action), Object.assign(document.createElement('span'), { textContent: workspace.href ? '→' : '○' }));
  body.append(meta, title, description, capabilities, action);
  article.append(visual, body);
  return article;
}

function renderWorkspaceCards() {
  if (grid) grid.replaceChildren(...WORKSPACES.map(workspace => workspaceCard(workspace, getCurrentLocale())));
}

initializeLocalization({ context: 'hub' });
renderWorkspaceCards();
window.addEventListener(LANGUAGE_CHANGE_EVENT, renderWorkspaceCards);
