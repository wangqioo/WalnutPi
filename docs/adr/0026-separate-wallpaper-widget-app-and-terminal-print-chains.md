# Separate Wallpaper, Widget App, and Terminal Print chains

WalnutPi screen work now has three related but separate generation chains.

**Decision**

Keep these chains separate:

```text
Wallpaper / GIF
-> Source Asset
-> Screen Output
-> Screen Manifest v2
-> Screen Playlist v1
-> Runtime Screen Assets
-> Playlist Sync
```

```text
Widget App / desktop
-> Widget App Plan
-> A2UI-over-MCP-inspired resource/tool surface
-> Walnut LVGL Widget Catalog
-> Widget runtime current/state/events
-> explicit Widget App activation and sync
```

```text
Terminal print visual
-> Terminal Print Source
-> Terminal Print Renderer
-> Screen Output
-> optional Screen Playlist item
```

The terminal print renderer may control terminal-style placement because it
produces a pre-rendered visual source, like printed terminal output. It is not
the desktop or Widget App generator.

Widget App generation is LVGL catalog-first at the device seam. It may use
A2UI-over-MCP concepts such as static UI via resources, dynamic UI via tools,
catalog negotiation, data binding, and action events that return to server-side
tool calls. It must not derive the desktop from `TerminalPrintSource`, prompt
regexes, or wallpaper provenance.

**Consequences**

Screen Workspace playlist preview stays image/animation playback.

Widget App preview uses the Widget App runtime endpoint and LVGL renderer.

Generated Widget Apps are saved app artifacts. They do not become default
playlist items unless they explicitly snapshot to an ordinary Screen Output.

Failures in Widget App catalog generation are surfaced as generation failures;
they are not hidden behind a terminal-print dashboard fallback.
