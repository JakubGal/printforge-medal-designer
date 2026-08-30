# PrintForge privacy and local data

This document describes the current static/local-first release. Update it with
the final operator identity, contact address, domain, jurisdiction, retention,
and any analytics before publishing it as a legal privacy notice.

## Static website

The static PrintForge site does not require an account and has no analytics,
advertising tracker, order system, or project-sync backend. Medal projects,
filament inventory, preferences, and imported artwork are stored in the
visitor's browser using IndexedDB/localStorage. Editing, image cleanup,
segmentation, geometry, pricing, checks, and exports run on the visitor's
device.

Clearing site data can erase locally stored projects. Export project JSON for a
portable backup. Browser storage belongs to the exact origin, so data does not
automatically move between localhost, a preview hostname, and the final domain.

## Local/desktop AI companion

The optional Windows local-image companion is started only after the user asks
to create an image. Prompts and results stay between the local browser app and a
loopback service on that computer. The remote static website cannot silently
install or launch this companion.

## Optional managed AI

Managed OpenAI image or medal planning is disabled in the static release. If a
future operator enables it, the UI must disclose what prompt data is sent, to
which processor, for what purpose, and for how long it is retained. Provider
credentials must remain on the server; users must never paste API keys into the
browser app.

## User choices

Users can export their project, remove individual projects through future data
controls, or clear the site's storage through browser settings. A public launch
should add a visible in-product data-management action and operator contact
before account, analytics, cloud sync, quotes, or ordering features are enabled.
