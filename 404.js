const scriptPath = new URL(document.currentScript.src).pathname;
const scriptSegments = scriptPath.split('/').filter(Boolean);
const hostedInGithubProject = location.hostname.endsWith('.github.io') && scriptSegments.length > 1;
document.querySelector('#returnHome').href = hostedInGithubProject ? `/${scriptSegments[0]}/` : '/';
