# Make Walnut Agent Console the Web home

The Web home should be the Walnut Agent Console, not a standalone Screen Workspace tool page. The Screen Workspace UI remains the current screen-focused workspace, but the product entry should be a natural-language console that can route users into screen creation, device status, notes, memory, retrieval, sync, and diagnostics without requiring them to understand import/process/sync mechanics first.

**Consequences**

Future frontend work should avoid growing `/workspace.html` into the whole product. The screen workflow should remain available inside the Console, while beginner-facing navigation starts from intent and keeps hashes, raw evidence, and terminal details in Developer Diagnostics.
