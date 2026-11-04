# 关键词列表设计验收

- Source visual truth: `C:/Users/79031/AppData/Local/Temp/codex-clipboard-7ab967b4-ff65-491c-bd43-5fbdf4fbbcf5.png`
- Implementation: `.artifacts/keyword-list-desktop.png`; mobile: `.artifacts/keyword-list-mobile.png`
- Combined full-view comparison: `.artifacts/keyword-list-comparison.png` (left: source; right: implementation)
- Viewport/state: desktop 1920 x 910 CSS px, 1x density; both source and implementation are 1920 x 910 px. The source uses live data and an active job, while the implementation uses six explicitly synthetic records and no active job. The combined image scales both to 960 x 455 px for layout comparison; full-resolution images were used to inspect copy and typography.

## Findings

No actionable P0-P2 visual issue remains for the requested layout. The header summary is one compact band, filter/period/saved-view controls occupy two rows, and six synthetic rows fit in the first desktop viewport. Search volume and both related-query columns precede the trend columns. The four trends are the last data columns before actions.

The live-data source and synthetic preview differ in metric contents, so trend values and populated related-query cells cannot be compared visually in this capture. A separate browser check of the related-query component showed both popovers with Chinese primary names and muted original terms, including all returned items. Real production data and a paid translation request were not used for QA.

## Fidelity Surfaces

- Typography: retained the product's existing font, weight, and blue link hierarchy; original phrases use smaller muted text. No clipped Chinese labels were seen in the desktop capture.
- Spacing/layout: compact summary, controls, table cells, and row rhythm remove the large gaps visible in the source. The 390 px mobile capture keeps controls accessible and the table horizontally scrollable.
- Colors/tokens: existing product colors and semantic status styles remain in use; the summary uses the established paper and border tokens.
- Image quality/assets: this is a data table; no image asset was added or replaced.
- Copy/content: removed the redundant “中文参考” label. Keyword, seed, and related-query translation use Chinese first with the original below when a Chinese name is available.

## Interaction Checks

The local preview showed working search and period selection, with no browser script errors. Both related-query popovers opened and showed the complete synthetic Chinese/original pairs. The screenshot does not prove translated names from the live AI provider, persisted cache behavior, or populated trend rendering.

## Implementation Checklist

- [x] Compact filter and summary layout.
- [x] Chinese-first keyword, seed, and related-query presentation.
- [x] Search volume and related queries before the four trend columns.
- [x] Denser desktop table and responsive mobile controls.
- [ ] Verify a paid model response and production data after integration in an authorized environment.

final result: passed
