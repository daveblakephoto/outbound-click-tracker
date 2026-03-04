# StartMyLoveEngine Analytics Dashboard - Contract-First Migration

## Phase 2.5: Mobile Responsive UX (In Progress)

### Mobile Optimization Tasks:
- #25: KPI row mobile layout (2-col grid, stacked CTR/confidence) ✓
- #26: Engagement funnel mobile (vertical stacked cards) ✓
- #27: Engagement quality panel mobile (2x2 grid, collapsible info) ✓
- #28: Performance chart mobile (full-width, toggle comparison)
- #29: Vendor table mobile (responsive cards) ✓ (component created, needs integration)
- #30: Filters bar mobile (stacked, sticky header)
- #31: Typography & spacing polish (line-height, padding)

---

## Phase 2 Hardening (Completed)

### Contract-First Architecture - Stabilisation

#### Tasks:
- #13: Contract drift auto-recovery (auto-refresh schema on version mismatch) ✓
- #14: Schema validation hardening (validate required fields on load) ✓
- #15: Enum-driven UI rendering (remove hardcoded plan/placement mappings) ✓
- #16: Diagnostics completeness (schemaFetchedAt, expiresAt, lastError) ✓
- #17: Performance guardrails (prevent duplicate fetches, memoization) ✓
- #18: Developer tooling (?debug=schema toggle + clickable contract version) ✓
- #19: Contract compliance tests
- #20: Documentation sync

---

## Completed (Phase 2 - Contract Migration)

### Schema Service & Context ✓
- #1: Create schema service with caching and types ✓
- #2: Add /schema proxy endpoint to worker ✓
- #3: Create SchemaContext provider for React ✓
- #4: Update Dashboard to use schema-driven configuration ✓
- #5: Add vendor metadata display (plan pill, placement badges, metaStatus) ✓
- #6: Enhance diagnostics with contract version and validation warnings ✓

### Plan/Placement Contract Alignment ✓
- #21: Visit data normalisation (plan primary, tier legacy fallback) ✓
- #22: Legacy tier fallback detection in diagnostics ✓
- #23: Schema validation warnings for unknown plans/placements ✓
- #24: Tooltip text update ("Billing plan" not "tier") ✓

### Engagement Quality Layer ✓
- Unique Visitor Rate, Click Rate (CTR), Clicks per Visitor
- Engagement Quality qualitative assessment

### Attribution Enhancements ✓
- Traffic Sources panel with horizontal bar charts
- Expandable internal/external referrer lists

### Confidence Badges ✓
- Multi-factor confidence scoring
- Sample size + tracking duration

### Enhanced Diagnostics Panel ✓
- Data source indicator
- Sample size display
- Cache status and TTL

---

## Metric Definitions

| Metric | Formula | Min Sample | Source |
|--------|---------|------------|--------|
| Profile Views | Raw count | 0 | stats/csv |
| Unique Visitors | Raw count | 0 | stats/csv |
| Outbound Clicks | Raw count | 0 | stats/csv |
| Clicks per Visitor | clicks ÷ unique_visitors | 10 visitors | computed |
| CTR | clicks ÷ views × 100 | 25 views | server (csv) |

---

## Future Phase 3 Items

### #7: Vendor Benchmarking Widgets
- Requires: percentile calculation from vendor list
- Complexity: Medium

### #8: Tier Performance Panel  
- Requires: tier data from API (plan field)
- Complexity: Medium

### #9: Time to First Click Analysis
- Requires: session-level timestamps (not available)
- Complexity: High (blocked)
