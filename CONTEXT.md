# WalnutPi

WalnutPi is an AI-native terminal system for a headless Debian device with a 480x320 screen. This context defines the language for the Walnut Agent Console, the device capabilities it can orchestrate, and the screen results it can synchronize to the device.

## Language

### Product And Device

**Walnut Agent Console**:
The natural-language user surface for WalnutPi that interprets intent, orchestrates controlled device capabilities, creates screen results, and presents evidence. It may use CLI commands, memory, retrieval, and the Screen Workspace, but it is not a general-purpose IDE.
_Avoid_: IDE, generic IDE, tool button panel, desktop application platform

**WalnutPi Device**:
The headless Debian hardware target that runs the Device Execution Surface, WalnutAI, and the LVGL Screen App. It is the real device synchronized by the Walnut Agent Console, not a simulated preview or generic Linux computer.
_Avoid_: generic board, desktop Linux, preview device, ESP32 board

### Agent And Execution

**Intent Route**:
The controlled interpretation of a user request that selects whether it should enter normal answering, the Screen Workspace, a Local Action, Daily Notes, Durable Memory, Retrieval Corpus, or a confirmation flow. It may be produced by local rules or AI assistance, but it is only a planning entry point and must be validated against Local Action Policy before any Local Action executes.
_Avoid_: model decision, free-form command, execution permission

**Device Execution Surface**:
The stable command surface on WalnutPi for executing device capabilities such as status checks, screen control, notes, media tools, maintenance, and controlled local actions. The Walnut Agent Console orchestrates this surface, while advanced users may also use it directly in a terminal.
_Avoid_: IDE backend, shell wrapper, random scripts, tool menu

**Human CLI Command**:
A `walnut` command intended for a person using the terminal directly, including menus, TUI tools, demos, maintenance entry points, and manual operations. It may prioritize discoverability and terminal experience, but it is not automatically a stable Agent contract.
_Avoid_: agent action, policy action, machine contract

**Agent Action Command**:
A stable, policy-governed command in the Device Execution Surface intended for Walnut Agent Console or WalnutAI invocation. It should have an action identifier, risk class, parameters, machine-readable evidence shape, and Action Policy Manifest entry.
_Avoid_: menu command, TUI command, human shortcut, arbitrary shell

**Device Transport**:
The controlled connection path between the Walnut Agent Console and the WalnutPi Device for running Local Actions, synchronizing Runtime Screen Assets, and collecting evidence. It may use SSH or a local agent, but it does not define Local Action Policy or the Screen Sync contract.
_Avoid_: random SSH, public shell, sync contract

**Local Action**:
A single controlled device action requested through the Device Execution Surface by the Walnut Agent Console or WalnutAI. Read-only Local Actions may run directly, while high-risk Local Actions must enter a confirmation flow before any side effect.
_Avoid_: Arbitrary shell, terminal command, script execution, tool call

**Confirmed Local Action**:
A high-risk Local Action that requires explicit user confirmation before execution, such as system writes, service replacement, reboot, shutdown, GPIO output, storage writes, image flashing, firmware delivery, or eMMC changes. Without confirmation, the system may explain the impact or prepare the action but must not perform the side effect.
_Avoid_: automatic fix, silent write, direct shell command

**System Write**:
An operation that changes WalnutPi Device system state, such as installing services, writing `/usr/local/bin` or `/opt`, replacing systemd units, enabling boot services, installing packages, changing overlays, rebooting, or shutting down. System Writes must be handled as Confirmed Local Actions or explicit manual operations.
_Avoid_: setup helper, silent install, safe write

**Local Action Policy**:
The explicit, auditable policy layer that decides which Local Actions may run directly, require confirmation, or must be refused. It may use rules, allowlists, risk categories, and AI-assisted intent recognition, but execution authority must not depend on a model freely choosing commands.
_Avoid_: prompt-only safety, model decides execution, ad hoc if statements

**Action Policy Manifest**:
The auditable declaration source for Local Action Policy, defining action identifiers, risk classes, confirmation requirements, allowed executors, input parameters, evidence shapes, and whether an action may be exposed through the Walnut Agent Console. Web, WalnutAI, and the Device Execution Surface should derive Local Action behavior from it.
_Avoid_: router hints, hard-coded action list, prompt schema only

**WalnutAI**:
The local AI agent runtime for WalnutPi, usable directly from the CLI and available to support the Walnut Agent Console with intent routing, Local Action summaries, Durable Memory, and Retrieval Corpus context. It is not a separate chat product or the cloud model itself.
_Avoid_: chatbot only, separate product, cloud model

### Memory And Retrieval

**Durable Memory**:
Long-lived, non-secret facts, preferences, environment notes, workflows, and goals distilled from user-authored conversations or explicit notes. It is not the raw chat history, daily note text, command logs, or project corpus.
_Avoid_: Chat history, daily notes, logs, corpus

**Daily Notes**:
User-authored dated notes kept as raw personal material for later reading or memory distillation. Daily Notes may inform Durable Memory, but they remain the user's original note text.
_Avoid_: memory.json, chat log, retrieval corpus

**Session Log**:
An append-only record of raw Walnut Agent Console or WalnutAI interactions used as source material for later Durable Memory distillation. It is not Durable Memory, Daily Notes, or a user-facing knowledge base.
_Avoid_: memory, notes, corpus, transcript database

**Retrieval Corpus**:
Project knowledge that WalnutAI and the Walnut Agent Console can search before answering or planning, including device skills, compact real-device success patterns, verified workflows, and screen sync experience. It is not user private memory, raw conversation history, or the authoritative Sync Record.
_Avoid_: memory, daily notes, chat history, docs dump, sync record

### Screen Workspace

**Screen Content**:
The semantic material a user wants to show on the WalnutPi screen, such as text, weather, device status, notes, images, GIFs, videos, or generated visuals. Screen Content must be turned into Source Assets or directly rendered into Screen Outputs before Sync.
_Avoid_: Screen Output, playlist item, LVGL widget

**Source Asset**:
An original image, GIF, sprite sheet, frame sequence, palette, hand-authored visual file, generated image, or programmatically generated visual used to create a Screen Output. Source Assets may have any dimensions; they must be processed into a final 480x320 Screen Output before Sync.
_Avoid_: Screen Output, framebuffer evidence, synced artifact

**Candidate Source Asset**:
A search result or discovered asset that may become a Source Asset after user selection. Candidate Source Assets are not automatically downloaded, processed, synced, or treated as part of the current screen contract.
_Avoid_: Source Asset, Screen Output, selected asset

**Unknown-License Source**:
A Source Asset whose license or usage rights are not known. It may be used for personal device Sync when clearly marked in Processing Provenance, but it must not be treated as commercially cleared material.
_Avoid_: Open asset, commercial asset, license-free source

**Screen Plan**:
An AI- or user-authored intent for what the WalnutPi screen should show, including Screen Content, source selection, search terms, style direction, processing parameters, and playlist suggestions. It guides the Tool-Assisted Processing Pipeline but is not the authoritative Screen Manifest.
_Avoid_: Screen Manifest, output hash, synced artifact

**Executed Screen Plan**:
A Screen Plan that led to a selected Source Asset and generated Screen Output. Executed plans should be saved in the Screen Workspace so the creative intent and processing choices remain traceable.
_Avoid_: Chat transcript, abandoned idea, authoritative manifest

**Tool-Assisted Processing Pipeline**:
The process that turns Source Assets into Screen Outputs by composing established tools for decoding, frame extraction, resizing, cropping, compositing, hashing, and LVGL resource preparation. It should prefer tools such as ffmpeg, Sharp, and LVGL converters over hand-written image processing cores.
_Avoid_: Hand-rolled decoder, bespoke scaler, runtime asset search

**Processing Provenance**:
The source and transformation history used to create a Screen Output, such as search terms, prompts, source names, source URLs, local source hashes, license or usage notes, crop boxes, scaling choices, palette choices, tool names and versions, seeds when available, and source hashes. It explains how the output was produced, but Sync is authoritative only for the local Screen Output hash.
_Avoid_: Sync input, live recipe, runtime dependency

**Screen Output**:
The local final 480x320 image artifact referenced by a Screen Manifest and identified by file SHA-256 plus the screen evidence hashes. Synchronization and device evidence should be tied to this artifact's rendered frame content rather than to live search results or remote source material.
_Avoid_: Remote image, search result, processing recipe

**Animated Screen Output**:
A local animation artifact whose frames are final 480x320 screen images with explicit timing. A GIF may be a Source Asset or derived export, but the canonical animation output is a 480x320 frame sequence plus timing; its overall hash is derived from each frame's RGB565 evidence hash and duration.
_Avoid_: Source GIF, live animation recipe, single-frame hash

**Pre-rendered Screen**:
A Screen Output where text, UI, imagery, and visual styling have already been composed into a final 480x320 image before Sync. The LVGL Screen App displays this image instead of interpreting UI components at runtime.
_Avoid_: Runtime UI component, LVGL layout, device-side text rendering

**Default Screen Output**:
The first Screen Output generated automatically after a user selects a Source Asset, using conservative processing defaults such as fitting or cropping to 480x320 and bounded animation frame rates. Users can adjust processing parameters and regenerate before Sync.
_Avoid_: Final approval, source selection, manual-only render

**Terminal Print Source**:
A generated Source Asset that intentionally looks like terminal or printed console output and may use logical cell placement before being rendered into a final 480x320 Screen Output artifact. It belongs to Wallpaper Mode or terminal-style visual output, not Widget App Mode or the desktop product model.
_Avoid_: Widget App schema, desktop layout, LVGL catalog, interactive app

**Terminal Print Renderer**:
The local renderer that turns a Terminal Print Source specification into PNG frames or a static 480x320 Screen Output. It may own terminal-style placement rules because terminal output is a pre-rendered visual source, but it must not be used to infer LVGL Widget App structure.
_Avoid_: desktop generator, Widget App renderer, A2UI generator

**Wallpaper Mode**:
The Screen Workspace mode for turning user-selected or user-generated images, GIFs, videos, and visual assets into Screen Outputs, Screen Manifests, Screen Playlists, and Runtime Screen Assets for playback. It owns static and animated wallpaper-style results, not live UI state or user actions.
_Avoid_: Widget App, interactive surface, live UI, LVGL app schema

**Widget App Mode**:
The Interactive Screen App mode for turning natural-language intent into a Walnut LVGL Widget Catalog rendered by LVGL as a playable small-screen application. It borrows A2UI-over-MCP ideas for static surface delivery, dynamic tool-produced surfaces, catalog negotiation, data binding, and action events, but WalnutPi's authoritative device contract is its own LVGL catalog. It owns UI semantics, data model updates, input events, exits, and policy-mediated actions; it may snapshot into a Screen Output, but it is not defined by Screen Manifest v2 or Terminal Print Source.
_Avoid_: Wallpaper, pre-rendered screen, playlist item, Screen Manifest schema, terminal print source

**Widget App Artifact**:
A saved generated Widget App that can be previewed, activated, versioned, synced, and diagnosed. It is not automatically the current device display and is not a Screen Playlist item.
_Avoid_: default desktop, default music player, playlist item, wallpaper

**A2UI Surface**:
A declarative Agent-to-UI surface concept used as inspiration for Widget App semantics: components, data binding, catalog negotiation, static resource-style surfaces, dynamic tool-produced surfaces, and action events that return to the server as tool calls. WalnutPi may import or project an A2UI-like surface, but the Walnut LVGL Widget Catalog remains the authoritative device-facing contract.
_Avoid_: Screen Output, Screen Manifest, Terminal Print Source, LVGL runtime txt, device runtime contract

**Walnut LVGL Widget Catalog**:
The small device-facing Widget App Mode contract that defines which UI elements, layout primitives, style tokens, bindings, exits, and actions the WalnutPi LVGL runtime supports. It is validated before device delivery and may be derived from an A2UI-like surface or an MCP tool/resource result, but it remains Walnut-owned so the device runtime is stable across A2UI, tool-call, or MCP changes.
_Avoid_: Full A2UI compliance, web UI schema, arbitrary LVGL calls, Screen Manifest, TerminalPrintSource

**Frame Hash**:
A SHA-256 hash of normalized decoded 480x320 frame content. RGBA frame hashes support preview and processing checks, while RGB565 frame hashes are authoritative for device framebuffer evidence; file hashes prove delivery integrity for specific encoded artifacts.
_Avoid_: File hash, manifest hash, source hash

**Screen Manifest**:
A contract for one final 480x320 Screen Output or Animated Screen Output, including the source material, processing steps, and evidence needed to reproduce or verify the displayed result. The final screen output is authoritative; recipes, searches, and source references support that output.
_Avoid_: Screen config, LVGL config, component manifest, display spec, launch command

**Screen Manifest v2**:
The `walnutpi.screen-manifest.v2` schema for one Screen Output or Animated Screen Output plus Processing Provenance.
_Avoid_: component manifest, playlist

**Screen Playlist**:
A playback contract that sequences multiple Screen Manifests for the WalnutPi screen. It owns playback concerns such as item order, duration, repeat behavior, and transitions while each referenced manifest keeps its own output artifact hash and provenance; it only accepts already-normalized Screen Manifest v2 outputs.
_Avoid_: Multi-page manifest, asset folder, LVGL config

**Screen Playlist v1**:
The `walnutpi.screen-playlist.v1` schema for sequencing multiple Screen Manifest v2 files.
_Avoid_: multi-page manifest, source folder

**Playlist Item**:
One entry in a Screen Playlist. The first version should identify a Screen Manifest and include the playback duration, repeat count, and a simple cut transition.
_Avoid_: Raw output file, source asset, nested manifest

**Playlist Loop**:
The behavior that restarts a Screen Playlist from the beginning after its last Playlist Item. Infinite playback belongs to the playlist loop setting, while Playlist Item repeat counts remain finite.
_Avoid_: Item repeat, animation frame timing, sync completion

**Screen Workspace**:
The root-level `screen/` area that owns Screen Manifests, Screen Outputs, Screen Playlists, Source Assets, and their provenance. The LVGL app consumes generated resources from this workspace but does not own the screen contract.
_Avoid_: lvgl_app, generated build directory, device filesystem

**Current Screen Assets**:
The Screen Manifests, Screen Playlist files, and Screen Outputs needed to reproduce the currently intended device playback. These assets should be versioned, while broad search caches and large candidate Source Assets are not automatically part of the tracked contract.
_Avoid_: Search cache, candidate dump, generated build output

**Screen Workspace UI**:
The screen-focused workspace within the Walnut Agent Console for selecting Source Assets, processing them into Screen Outputs, previewing playback, adding items to a Screen Playlist, and explicitly syncing to the WalnutPi. Manifest JSON, hashes, and raw evidence belong in developer diagnostics rather than the beginner flow.
_Avoid_: Full Agent Console, JSON editor, hash dashboard, generic IDE

**Screen Preview**:
A local preview shown in the Walnut Agent Console or Screen Workspace UI for checking the expected Screen Output or Screen Playlist playback before Sync. It is not device evidence and does not prove that the WalnutPi Device is displaying the result.
_Avoid_: device evidence, sync result, frame capture

**LVGL Screen App**:
The program that displays a Screen Manifest result on the real WalnutPi framebuffer. It renders the final screen output; it is not the Screen Manifest itself.
_Avoid_: Manifest, screen contract

**Device Display Mode**:
The current product mode occupying the WalnutPi screen, such as Screen Playlist playback, a Widget App, a demo, or the system TTY. Display mode changes are explicit device operations and must not be implied by generating an artifact.
_Avoid_: generated output, app type, preview state, default screen

**Interactive Screen App**:
A local WalnutPi screen application that accepts user input such as keys, buttons, or touch. It is distinct from Screen Output and Screen Playlist playback, and should enter the current product spine only after a separate interaction contract is defined.
_Avoid_: Screen Manifest, Playlist Item, pre-rendered screen

**Runtime Screen Assets**:
The hot-reloadable assets consumed by the LVGL Screen App on WalnutPi, including the runtime playlist index and RGB565 frame files under `screen/runtime/`. They are the normal delivery format for Screen Playlist playback.
_Avoid_: Embedded C array, rebuilt LVGL binary, source asset

**Runtime Asset Budget**:
The processing and sync budget for Runtime Screen Assets. The first version defaults to 6 fps, 8 seconds, and at most 24 final 480x320 frames; larger or smoother outputs are explicit advanced choices governed by transfer size, storage, validation time, and runtime stability.
_Avoid_: Unlimited GIF import, video archive, C compile budget

**Sync**:
The explicit operation that delivers the current local Screen Output to the real WalnutPi and collects device evidence. Sync uses local artifacts and hashes; it does not re-fetch source material, depend on live search results, or regenerate missing outputs. Missing artifacts or hash mismatches fail Sync and must be fixed through the processing pipeline.
_Avoid_: Regeneration, remote search, live download

**Playlist Sync**:
The default Sync mode that delivers the current Screen Playlist and every referenced Screen Manifest output needed for playback. A single-output test can still sync one manifest directly, but normal user-facing sync targets the current playlist.
_Avoid_: Source sync, search sync, partial playlist delivery

### Evidence And Diagnostics

**Beginner Sync Status**:
The simplified Screen Playlist Sync state shown to ordinary users, limited to whether the screen is unsynced, syncing, synced to WalnutPi, or failed. It does not expose hashes, build identifiers, command output, or raw device evidence.
_Avoid_: developer diagnostics, hash status, build status, raw evidence

**Developer Diagnostics**:
Detailed technical evidence for debugging synchronization, device execution, and screen rendering, including hashes, command output, delivery evidence, frame evidence, frame differences, and sync history. It is not the beginner-facing status or normal user result.
_Avoid_: beginner status, user-facing result, normal UI

**Agent Observability**:
Developer and operator visibility into Walnut Agent Console behavior, including calls, latency, failures, token use, cost signals, and tool execution metrics. It is not user memory, ordinary chat content, or Beginner Sync Status.
_Avoid_: user memory, chat content, beginner status

**Sync Record**:
A persisted Developer Diagnostics record for one Screen Playlist Sync, including the sync result, delivery evidence, device evidence, optional captured frame, and later frame-diff findings. It is not Durable Memory, a Session Log, or a beginner-facing status.
_Avoid_: log file, memory, screenshot cache, chat record

**Repair Proposal**:
A Developer Diagnostics recommendation based on a Sync Record or failure evidence that explains a likely fix and may prepare a safe patch. Applying the patch or re-running Sync requires user confirmation.
_Avoid_: auto repair, silent patch, automatic resync

**Playlist Evidence**:
Device evidence that ties the current framebuffer state to a Screen Playlist, the active Playlist Item, that item's Screen Manifest, and the displayed output or frame hash. It proves the current display belongs to the playlist without requiring a full playlist cycle during ordinary Sync.
_Avoid_: Full playback audit, source-material proof, preview-only evidence

**Real-Device Verification**:
Verification performed against the real WalnutPi Device, including Sync, delivery, activation, service state, frame evidence, or capture evidence. Screen Preview and preview-only safety modes may help inspect or regress local behavior, but they do not prove that the device is running the intended result.
_Avoid_: preview verification, nossh verification, local-only proof

### Archived And Extension Capabilities

**Archived Capability**:
A historical experiment or prototype that may inform the Walnut Agent Console, Device Execution Surface, input methods, or media processing, but is not part of the current product spine. Archived Capabilities must not be treated as parallel platforms or shortcuts around current safety boundaries.
_Avoid_: current product, core workflow, parallel platform

**Input Accessory**:
A hardware add-on that expands how users interact with WalnutPi, such as a microphone for voice input. Input Accessories may enable future Walnut Agent Console workflows, but an accessory does not automatically make an archived implementation part of the current product spine.
_Avoid_: separate platform, required core hardware, archived experiment

**Hardware Peripheral**:
A hardware add-on connected to the WalnutPi Device, such as sensors, cameras, microphones, USB devices, or GPIO, I2C, SPI, and UART modules. Hardware Peripherals can extend device capabilities, but using or configuring them must still follow Local Action Policy and System Write boundaries.
_Avoid_: separate platform, built-in device, unrestricted hardware access
