import { WORKSPACES } from './workspace-registry.js?v=20260830-release8';
import {
  LANGUAGE_CHANGE_EVENT,
  getCurrentLocale,
  initializeLocalization,
} from './localization-runtime.js?v=20260901-release37';

const legacyQuery = new URLSearchParams(window.location.search);
if (legacyQuery.has('qa')) {
  window.location.replace(`./workspaces/medals/${window.location.search}${window.location.hash}`);
}

const grid = document.querySelector('#workspaceGrid');

const WORKSPACE_COPY = Object.freeze({
  en: Object.freeze({
    voronoi: Object.freeze({
      name: 'Voronoi lattice', category: 'Generative structures',
      description: 'Turn an STL into an organic cellular structure. Explore true internal 3D lattices, surface networks, and extruded patterns with a live cutaway view.',
      action: 'Open studio', capabilities: Object.freeze(['STL import', '3D volume & surface lattices', 'Binary STL']),
    }),
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
    voronoi: Object.freeze({
      name: 'Voronoi mriežka', category: 'Generatívne štruktúry',
      description: 'Premeňte STL na organickú bunkovú štruktúru. Preskúmajte vnútorné 3D mriežky, povrchové siete a extrudované vzory s interaktívnym rezom.',
      action: 'Otvoriť štúdio', capabilities: Object.freeze(['Import STL', 'Objemové a povrchové 3D mriežky', 'Binárne STL']),
    }),
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
    voronoi: Object.freeze({
      name: 'Voronoi mřížka', category: 'Generativní struktury',
      description: 'Proměňte STL v organickou buněčnou strukturu. Prozkoumejte vnitřní 3D mřížky, povrchové sítě a extrudované vzory s interaktivním řezem.',
      action: 'Otevřít studio', capabilities: Object.freeze(['Import STL', 'Objemové a povrchové 3D mřížky', 'Binární STL']),
    }),
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
    voronoi: Object.freeze({
      name: 'Voronoi-Gitter', category: 'Generative Strukturen',
      description: 'Verwandeln Sie eine STL-Datei in eine organische Zellstruktur. Erkunden Sie innere 3D-Gitter, Oberflächennetze und extrudierte Muster mit interaktiver Schnittansicht.',
      action: 'Studio öffnen', capabilities: Object.freeze(['STL-Import', '3D-Volumen- und Oberflächengitter', 'Binäres STL']),
    }),
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
    voronoi: Object.freeze({
      name: 'Siatka Voronoi', category: 'Struktury generatywne',
      description: 'Zamień plik STL w organiczną strukturę komórkową. Odkrywaj wewnętrzne siatki 3D, sieci powierzchniowe i wytłaczane wzory z interaktywnym przekrojem.',
      action: 'Otwórz studio', capabilities: Object.freeze(['Import STL', 'Siatki objętościowe i powierzchniowe 3D', 'Binarny STL']),
    }),
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

function voronoiVisual() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 400 174');
  svg.setAttribute('focusable', 'false');
  const network = 'M116 47 L155 39 L177 55 L171 83 L136 91 L112 72 Z M155 39 L188 26 L217 44 L214 71 L177 55 M217 44 L250 34 L275 53 L263 79 L234 89 L214 71 M275 53 L296 78 L286 111 L257 113 L234 89 M257 113 L249 140 L214 148 L195 123 L207 100 L234 89 M214 148 L177 145 L160 125 L173 104 L195 123 M177 145 L143 137 L129 116 L136 91 M160 125 L129 116 M173 104 L171 83 M207 100 L214 71 M112 72 L105 101 L129 116 M188 26 L222 21 L250 34';
  const connectors = 'M116 47 L95 35 M155 39 L134 27 M177 55 L156 43 M171 83 L150 71 M136 91 L115 79 M112 72 L91 60 M188 26 L167 14 M217 44 L196 32 M214 71 L193 59 M250 34 L229 22 M275 53 L254 41 M263 79 L242 67 M234 89 L213 77 M296 78 L275 66 M286 111 L265 99 M257 113 L236 101 M249 140 L228 128 M214 148 L193 136 M195 123 L174 111 M207 100 L186 88 M177 145 L156 133 M160 125 L139 113 M173 104 L152 92 M143 137 L122 125 M129 116 L108 104 M105 101 L84 89';
  for (const [className, d, transform] of [
    ['lattice-depth', network, 'translate(-21 -12)'],
    ['lattice-connectors', connectors, ''],
    ['lattice-front', network, ''],
  ]) {
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('class', className);
    path.setAttribute('d', d);
    if (transform) path.setAttribute('transform', transform);
    svg.append(path);
  }
  return svg;
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
  if (workspace.visual === 'voronoi') visual.append(voronoiVisual());
  else visual.replaceChildren(document.createElement('span'), document.createElement('i'), document.createElement('b'));

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
