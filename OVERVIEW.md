Shows draw.io diagrams inside Paseo and lets agents draw them with the official draw.io tools.

## What it does

- **File tab.** `.drawio` files open read-only in a draw.io file panel. Multi-page and
  compressed files are supported, with the viewer's page, zoom and layer controls. The tab
  follows changes on disk and reports a deleted file. The plugin never writes the file.
- **Diagrams in replies.** A fenced block with the language `drawio` in an agent reply is shown
  as a read-only diagram in the conversation, without creating a file. Every such block in a
  reply is rendered. While a block is still streaming, a placeholder is shown instead of an
  error.
- **Agent tools.** Agents of supported providers get the official draw.io Tool Server
  (`@drawio/mcp` 1.10.1): read, list and replace pages of `.drawio` files in the workspace,
  the draw.io XML reference and shape search. Paths resolve from the workspace root.
  `prepare_drawio_xml` runs the official XML repair, model normalization, label fitting,
  optional ELK layout and optional obstacle-avoiding edge routing (libavoid) on the daemon and
  returns the XML; it opens no browser and writes no workspace files, and the agent then saves
  the result
  or shows it. CSV and Mermaid conversion are not offered.
- **`/drawio`.** `/drawio <request>` sends the request to the current agent. `/drawio` alone asks
  the agent to find out what you want drawn. While the agent is working, `/drawio` is refused
  so it never interrupts the running turn.

A diagram that declares a DOCTYPE is expanded on the daemon before it is shown: its internal
entities are resolved by libxml2 under libxml2's own expansion limit, and the result, without
the DTD, is what the viewer renders. External DTDs, external entities and parameter entities
are never loaded; such diagrams show a notice instead.

## Requirements

- Paseo 0.15.0 or later on the daemon and the app. Plugins must be enabled on the daemon.
- Managed installation prepares locked production dependencies, so Node.js and npm must be
  on the daemon's path, and then downloads the official ELK layout bundle (see below). A plugin
  installed from a local directory needs dependencies and ELK prepared manually; see the
  [repository setup instructions](https://github.com/ivolnistov/paseo-plugin-drawio#install-from-github).
  Without dependencies, agents get no draw.io tools; without ELK, layout is skipped with a note
  while repair, normalization, label fitting and routing still run.
- Rendering runs in the desktop app and in web browsers. iOS and Android clients show a notice
  instead of the diagram.
- The Tool Server is added for `claude`, `codex` and `opencode` agents. Other providers still get
  diagram rendering and `/drawio`, but no draw.io tools.

## Data and network

- Diagrams are rendered by the official draw.io viewer (32.6.10), shipped with the plugin and
  sent from the daemon to the app over Paseo's own connection. The viewer runs in a sandboxed
  frame with network access blocked, so external images, web fonts and remote stencils in a
  diagram are not loaded, and links in diagrams do not open.
- The Tool Server tools that open diagrams in a browser at app.diagrams.net are removed. The
  icon service is disabled. Shape search uses a copy of the draw.io shape index shipped with the
  plugin and runs locally.
- The ELK layout bundle is not shipped. Installation, or `npm run prepare-elk`, downloads it once
  from the draw.io v32.6.10 release on GitHub into the plugin's folder in your user cache
  directory and keeps it only if it matches the SHA-256 pinned in the plugin. After that, layout
  works offline from the verified copy with no further network checks; a changed or broken
  download is rejected and never replaces a verified copy.
- Edge routing runs the official Tool Server routing code with the routing library bundled in
  the `@drawio/mcp` package. The plugin points the Tool Server at that copy, so routing never
  downloads code from viewer.diagrams.net and works offline.
- Diagram content an agent reads or writes is part of that agent's conversation and goes to its
  model provider like any other tool result.

## Limits

- Viewing in Paseo is read-only: there is no editor and no action to open a diagram in draw.io.
  Agents with the Tool Server can still replace pages of `.drawio` files in the workspace.
- A small number of reply diagrams stay live at once to limit memory use; older ones pause and
  can be shown again.
- Diagrams whose source is over 2,000,000 characters, or whose compressed pages expand beyond
  8,000,000 bytes, are not rendered. With a DTD, the expanded XML is also limited to 2,000,000
  characters, and libxml2 refuses entities that expand too much relative to the source even
  below that size.
