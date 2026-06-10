# Screen Delivery Adapter Design

## Goal

Move the screen sync delivery details out of the Web server route and into a small adapter boundary.

The first adapter remains the existing SSH/local-agent path. This change does not add USB, eMMC, image flashing, OTA, or a new confirmation flow.

## Scope

In scope:

- A `ssh-local-agent` adapter module under `web-interface/screen-delivery-adapters/`.
- Adapter-owned LVGL build, artifact hash, activation, screen state evidence, framebuffer frame evidence, delivery manifest, and delivery hash.
- Web server-owned manifest hash validation, `?nossh` blocking, sync record persistence, and on-demand PNG capture ticketing.
- No visible UX change.

Out of scope:

- Additional delivery adapters.
- AI code generation.
- Web/LVGL pixel diff.
- High-risk confirmation flow.
- Long-term memory schema.

## Adapter Contract

The Web server calls:

```text
adapter.deliver({ buildId, manifest, manifestHash })
```

The adapter returns:

- `ok`
- `risk`
- `mode`
- `deliveryManifest`
- `deliveryHash`
- `artifactHash`
- `screenEvidence`
- `screenFrameUrl`
- `frameTicket`
- `command`
- `commandResults`
- `code`
- `output`
- `summary`
- `failedStage`

The server persists these fields without needing to know the adapter's internal command order.

## Boundary

The adapter is responsible for delivery mechanics and evidence classification. The route is responsible for request safety and storage.

This keeps the current behavior stable while creating a real extension point for future `usb`, `emmc-image`, or other adapters.
