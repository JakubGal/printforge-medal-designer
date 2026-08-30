export const WORKSPACES = Object.freeze([
  Object.freeze({
    id: 'medals',
    name: 'Medal Studio',
    category: 'Events & awards',
    description: 'Design detailed, multicolor, single- or double-sided medals with ribbon attachments, live pricing, print checks, and production exports.',
    href: './workspaces/medals/',
    status: 'ready',
    action: 'Open studio',
    visual: 'medal',
    capabilities: ['3D direct editing', 'Image to objects', '3MF · STL · STEP · PDF'],
  }),
  Object.freeze({
    id: 'skadis',
    name: 'Skådis Organizer Studio',
    category: 'Home & workshop',
    description: 'A focused parametric workspace for IKEA Skådis holders, trays, hooks, and custom tool organizers.',
    status: 'planned',
    action: 'Coming next',
    visual: 'skadis',
    capabilities: ['Board-safe fittings', 'Parametric compartments', 'Material-aware walls'],
  }),
  Object.freeze({
    id: 'custom',
    name: 'Custom Product Studio',
    category: 'Creator workspace',
    description: 'A planned reusable studio for makers who want to publish their own guided parametric product configurator.',
    status: 'planned',
    action: 'Planned',
    visual: 'custom',
    capabilities: ['Guided parameters', 'Reusable design tools', 'Future ordering'],
  }),
]);

export function workspaceById(id) {
  return WORKSPACES.find(workspace => workspace.id === id) || null;
}
