# Research Map Design QA

- Source visual truth: `design-reference/midnight-operations.png`
- Implementation screenshot: `design-reference/research-map-qa-after.png`
- Combined comparison: `design-reference/research-map-qa-comparison.png`
- Viewport: 1280 × 720
- State: authenticated owner, Research employee selected, Research Map active, one sourced prospect selected

## Full-view comparison evidence

The implementation preserves the Midnight Operations composition: midnight-navy desktop, framed employee window, portrait/profile rail, compact tab bar, right approvals/activity rail, and bottom portrait dock. The new Research surface uses the existing gold eyebrow, serif section heading, blue-gray controls, restrained borders, and dense operational hierarchy. The live OpenStreetMap surface is visually subdued to sit inside the established palette without overpowering the employee workspace.

## Focused region comparison evidence

The Research workspace was inspected at readable scale because the map, portfolio list, relationship state, and directions actions are the fidelity-critical region. Typography uses the existing Georgia display treatment and compact sans-serif UI hierarchy; spacing follows the established 6–14px control rhythm; colors reuse the navy, slate, gold, blue, and green semantic palette; the Research portrait and Leaflet marker/tile assets are real image/library assets; copy clearly separates research prospects from active relationships and explains that SMS is only drafted.

## Findings

- No remaining P0, P1, or P2 issues.
- P3: the relationship detail and owner-entry form sit below the visible fold at 1280 × 720. This is intentional because the map and portfolio are the primary above-the-fold task, and the employee content region has its own visible vertical scrollbar.

## Comparison history

### Iteration 1

- Earlier finding: P1 horizontal overflow in the Research workspace. The initial three-column map/list/detail grid exceeded the content width beside the persistent employee profile and produced a horizontal scrollbar.
- Fix made: converted the surface to a container-responsive two-column map/list layout at compact workspace widths, moved relationship detail below the map, constrained the map track with `minmax(0, 1fr)`, and hid horizontal overflow while retaining vertical access.
- Post-fix evidence: `design-reference/research-map-qa-after.png` shows the map and portfolio fitting entirely between the profile rail and employee-window scrollbar with no horizontal scrollbar.

## Primary interactions tested

- Opened the Research employee and Research Map tab.
- Loaded a canonical Markdown-backed organization and map marker.
- Verified website and Google Maps directions links.
- Entered a recipient phone number and verified generation of a prefilled `sms:` directions draft.
- Confirmed the Research Map filter, owner-entry form, and geocoding controls are present and accessible.
- Browser-rendered page contained no visible error state.

## Implementation checklist

- [x] Preserve Midnight Operations visual hierarchy.
- [x] Keep map data private and Markdown-backed.
- [x] Separate prospect, researching, contacted, active, partner, and not-a-fit states.
- [x] Make geographic lookup and AI-created pins source-aware and approval-gated.
- [x] Prevent silent SMS sending; open a user-reviewed draft only.
- [x] Remove horizontal overflow at the employee-window width.

final result: passed
