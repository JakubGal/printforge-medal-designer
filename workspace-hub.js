import { WORKSPACES } from './workspace-registry.js?v=20260830-release8';

const legacyQuery = new URLSearchParams(window.location.search);
if (legacyQuery.has('qa')) {
  window.location.replace(`./workspaces/medals/${window.location.search}${window.location.hash}`);
}

const grid = document.querySelector('#workspaceGrid');

function workspaceCard(workspace) {
  const article = document.createElement('article');
  article.className = `workspace-card ${workspace.status}`;
  article.dataset.workspace = workspace.id;

  const capabilities = workspace.capabilities.map(capability => `<li>${capability}</li>`).join('');
  const action = workspace.href
    ? `<a class="workspace-action" href="${workspace.href}">${workspace.action}<span>→</span></a>`
    : `<span class="workspace-action unavailable" aria-disabled="true">${workspace.action}<span>○</span></span>`;

  article.innerHTML = `
    <div class="workspace-visual ${workspace.visual}" aria-hidden="true"><span></span><i></i><b></b></div>
    <div class="workspace-card-body">
      <div class="workspace-meta"><span>${workspace.category}</span><em>${workspace.status === 'ready' ? 'Ready now' : 'Planned'}</em></div>
      <h3>${workspace.name}</h3>
      <p>${workspace.description}</p>
      <ul>${capabilities}</ul>
      ${action}
    </div>`;
  return article;
}

if (grid) grid.replaceChildren(...WORKSPACES.map(workspaceCard));
