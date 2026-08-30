const hostname = window.location.hostname.toLowerCase();
const localHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
const declaredApiMode = document.querySelector('meta[name="printforge-api"]')?.content?.trim().toLowerCase();
const forcedStatic = new URLSearchParams(window.location.search).get('runtime') === 'static';
const sameOriginApi = !forcedStatic && (localHost || declaredApiMode === 'same-origin');

/**
 * Runtime capability boundary shared by every product studio.
 *
 * Static deployments intentionally ship without same-origin AI endpoints.
 * A future managed deployment can opt in by adding
 * <meta name="printforge-api" content="same-origin"> to its document shell.
 */
export const RUNTIME_CONFIG = Object.freeze({
  mode: sameOriginApi ? 'local-server' : 'static-web',
  localHost,
  sameOriginApi,
  staticHosting: !sameOriginApi,
});

export function unavailableHostedCapability(kind = 'service') {
  return {
    available: false,
    configured: false,
    hostedStatic: true,
    setup: null,
    message: `${kind} is not included in this static deployment. Import existing artwork, or use the local/desktop edition with its companion service.`,
  };
}
