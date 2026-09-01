const guideFile = (stem, extension) => `${stem}.${extension}`;
const GUIDE_ASSET_VERSION = '20260901-release34';

const guides = [
  {
    id: 'overview',
    stem: '01-overview',
    title: 'Make a complete medal',
    durationSeconds: 29,
    outcome: 'Follow the complete beginner flow—from a blank medal to a checked design.',
    transcript: [
      'Choose New medal and pick a body shape, size, and ribbon attachment.',
      'Add artwork, place it directly on the medal, and adjust it in the 3D view.',
      'Choose colors, check the printable layers, then open Check and export.',
    ],
  },
  {
    id: 'body-and-ribbon',
    stem: '02-body-and-ribbon',
    title: 'Choose the body & ribbon',
    durationSeconds: 25,
    outcome: 'Start with the right medal outline, dimensions, edge, and attachment.',
    transcript: [
      'Open New medal and choose a blank or editable example.',
      'Select the circular, hexagonal, or custom body and set its finished size.',
      'Compare the real attachment previews, adjust the opening, and create the medal.',
    ],
  },
  {
    id: 'text-and-surfaces',
    stem: '03-text-and-surfaces',
    title: 'Add text & set its surface',
    durationSeconds: 24,
    outcome: 'Place readable text, resize it, and make it raised, recessed, or flat color.',
    transcript: [
      'Choose Add, then Text, type your wording, set its starting size, and place it.',
      'Drag the on-medal handles to move, resize, or rotate the selected text.',
      'Choose Raised, Recessed, or Flat color and preview the exact height in 3D.',
    ],
  },
  {
    id: 'symbols-and-drawing',
    stem: '04-symbols-and-drawing',
    title: 'Use symbols & free drawing',
    durationSeconds: 23,
    outcome: 'Add detailed runners, mountains, shapes, and your own printable lines.',
    transcript: [
      'Open Add and choose Symbol to browse runners, mountains, event icons, and basic shapes.',
      'Place a symbol and use the handles to fit it to the medal.',
      'Choose Draw for custom lines, set a printable width, finish the sketch, and inspect it in 3D.',
    ],
  },
  {
    id: 'image-to-objects',
    stem: '05-image-to-objects',
    title: 'Turn an image into objects',
    durationSeconds: 25,
    outcome: 'Clean an uploaded image, separate its colors, and place editable printable parts.',
    transcript: [
      'Choose Add, then Image, and select a PNG, JPEG, SVG, or DXF file.',
      'Crop the artwork, remove the background, simplify tiny details, and choose the color regions to keep.',
      'Create editable objects, place them on the medal, and adjust each part independently.',
    ],
  },
  {
    id: 'ideas-to-medal',
    stem: '06-ideas-to-medal',
    title: 'Create a medal from an idea',
    durationSeconds: 22,
    outcome: 'Describe an event and turn a generated concept into editable medal geometry.',
    transcript: [
      'Open Add, then Ideas, and describe the event, mood, wording, and important symbols.',
      'Review the proposed layouts and choose the strongest direction.',
      'Build the concept as separate editable text and shape objects, then polish their placement in 3D.',
    ],
  },
  {
    id: 'colors-and-back',
    stem: '07-colors-and-back',
    title: 'Set colors & design the back',
    durationSeconds: 22,
    outcome: 'Choose real filament effects and add a printable flat-color back design.',
    transcript: [
      'Use the plus beside a color choice to add a filament, material, and special effect.',
      'Assign colors to the body, edge, attachment, and artwork directly where you are editing.',
      'Switch to the back side and add artwork; back items stay flush in the first printable layer.',
    ],
  },
  {
    id: 'check-and-export',
    stem: '08-check-and-export',
    title: 'Check & export for printing',
    durationSeconds: 27,
    outcome: 'Inspect layers, resolve print warnings, and download the right production file.',
    transcript: [
      'Open Print layers to inspect how the color and height changes will be printed.',
      'Review Design checks and use Show item or Fix automatically where offered.',
      'Open Check and export, then download 3MF, STL, STEP, SVG, or the presentation PDF you need.',
    ],
  },
];

export const GUIDE_LIBRARY = Object.freeze(guides.map(guide => Object.freeze({
  ...guide,
  video: guideFile(guide.stem, 'mp4'),
  poster: guideFile(guide.stem, 'webp'),
  captions: guideFile(guide.stem, 'vtt'),
  transcript: Object.freeze([...guide.transcript]),
})));

export function guideAssetUrl(filename) {
  if (!/^[\w-]+\.(?:mp4|webp|vtt)$/u.test(String(filename))) throw new TypeError('Invalid guide asset name');
  const url = new URL(`./guides/${filename}`, import.meta.url);
  url.searchParams.set('v', GUIDE_ASSET_VERSION);
  return url.href;
}

export function guideDurationLabel(seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}
