I couldn't write `SCRATCH/ux/findings-design.md`: the harness blocks subagents from writing report files and told me to return the content as text instead. The full report is below, ready to save under that path. The screenshots and the scripts that take them are saved. No app code was changed.

Screenshots are in `/private/tmp/claude-501/-Users-ericgladstone-My-Drive--eric-c-gladstone-gmail-com--Projects-Software-Org-Signal/28c7544b-bf65-4ca4-99cc-4f4f74736ee5/scratchpad/ux/design/shots/`:
- site captures `site-*`
- app captures `app-<view>-{1440,390}.png`
- side-by-side images `sbs-type-header.png`, `sbs-figures.png`, `sbs-palette-drift.png`, `sbs-head-drift.png`, `sbs-phone.png`

To retake them, run `site.mjs`, `app.mjs`, `app2.mjs` and `sbs.mjs` in `ux/design/` (`node app.mjs 1440|390`). The app server on port 8825 is still running.

## Top 12 findings
1. **V1 (major) Type scale too small:** view title 28px vs the site's 44.7px, body 15px vs 17.6px, intro 15px vs the site's 20.7px lead (`theme.css --fs-*`, `.view__title`, `.view__intro`).
2. **V4 (major) Boxed buttons everywhere; the site has none.** Network's head has three equal boxes and Methods has 11 download boxes. Secondary actions should be the site's `.tlink` text links.
3. **V10 (major) Build uses its own group colours:** blue/orange `--grp-*` in `build.css` vs teal/ochre `--cat-*`, so drawn groups change colour once analysed (`build/shared.js:126`).
4. **V9 (major) Build/Generate heads differ:** a mono eyebrow over a 1.3rem h2 ("Synthetic network"), against an h1 naming the view everywhere else.
5. **V11 + V12 (major) Build/Generate forms are a second system:** 2px radii, weaker borders, native OS selects, and field labels in mono uppercase.
6. **V29 (major) Two community colours fail the all-pairs check on the map:** I ran the dataviz validator. `#6ba04b`/`#d36757` is ΔE 0.6 under deuteranopia, and `#6ba04b`/`#13aa89` is ΔE 8.1 for normal vision, below the 15 floor. On the map, community 6 sits right against community 1. Fix: community numbers at cluster centres, and fold groups past 5 into "Other".
7. **V28 (major) Network labels collide, have no halo, and clip at the canvas edge** ("Rohan Vidal" over "Ines Lindqvist"; "Rohan V" cut off at 390). Sigma settings in `network.js:264–273`.
8. **V22 (major) The network colour key is below the fold** at 1440×900, under ten metrics.
9. **V31 (major) Mixing matrix:** the colour ramp starts too bright, so 0, 0.002 and 0.04 look the same. Column labels are cut off ("Financ", "Operat"), every cell has a number, there is no scale legend, and values overflow at 390.
10. **V32 (major) Affect chart token names are inverted:** positive bars use `--div-neg-1` and negative bars `--div-pos-1` (`content.js:80`).
11. **V3 (major) Two page frames:** Data, Ask and Methods are centred at x=224, the other views are full-bleed at x=37, so the title jumps 187px between views.
12. **V44 (major, phone) Selecting a person scrolls their profile title under the sticky header.** The site sets `scroll-padding-top:5.5rem`; the app doesn't.

---

# Org Signal v2: visual design audit against graystoneindustries.co

## Verdict

The tokens are right and the voice is right. The ground, ink, mint, Geist and Geist Mono are the site's own, the masthead copies `Header.astro` including the active-route underline, and the copy is calm and plain. The app drifts in three ways:

1. **Scale and air.** Every type role is 30–40% smaller than on the site, and boxed buttons fill the page where the site uses text links. Side by side (`sbs-type-header.png`) it reads as a generic dark dashboard.
2. **Two products in one shell.** Build and Generate (`build.css`) have their own head, tabs, labels, controls, chip rows and palette (`sbs-head-drift.png`, `sbs-palette-drift.png`).
3. **Figures.** The site draws quiet near-white rings with mint lines and spaced mono captions (`site-systems-1440-s3.png`). The network map uses saturated discs with no outline, colliding labels and a hidden key. The other charts are sound, with fixable faults.

On a phone the shell keeps the site's character. The weak points are the dense views (Network, Draw, the Groups table and matrix) and the scroll offset in V44.

## Design rules to adopt (put them in `theme.css`; `build.css` keeps no tokens or control styles of its own)

1. **Type:**
   - View title `clamp(1.9rem,1.5rem+1.2vw,2.4rem)`, weight 500, letter-spacing −.022em.
   - Intro 1.0625rem, line-height 1.55, `--text-2`, max 54ch.
   - Body 1rem, line-height 1.6; tables stay at .8125rem.
   - Section heading 1.125rem, weight 600.
   - Footnotes .8125rem, muted, max 66ch.
2. **Mono labels:** `.75rem`, letter-spacing `.12em`, uppercase, muted (the site uses 12.74px at .12em). Use them only for section labels, metadata and captions, never form labels. Table headers `.6875rem` at `.08em`.
3. **One frame:**
   - The header and every view share one wrap: `max-width:90rem; margin-inline:auto`.
   - Reading views cap at 62rem, left-aligned in that wrap.
   - `html{scroll-padding-top:calc(var(--header-h) + 1rem)}`.
4. **Actions:** at most one boxed primary per view. Secondary actions are `.tlink` (weight 600, .875rem, mint, `--accent-dim` underline, → when it navigates). Square corners everywhere.
5. **Inputs:**
   - One style: `--panel` fill, 1px `--rule-strong` border, radius 0, .875rem.
   - Selects get the custom chevron.
   - Field labels sans .8125rem, muted.
   - Radios and checkboxes custom-drawn, with no OS grey.
6. **Choices:** `.seg` for 5 options or fewer, radio lists for more; no chip rows.
7. **Tabs:** one style, .875rem `--text-2`; the active tab is `--text` at weight 600 with a 2px mint underline.
8. **Mint budget:** current location, the one primary action, links and focus only.
9. **Data colour:**
   - One `--cat-1…8` plus `--cat-other` palette for every group in every view.
   - Single series use `--cat-1`.
   - Name the diverging tokens cool/warm, not by sign.
   - Text never takes a series colour.
10. **Network figure:** solid edges in the `--edge` mint family, a 1.5px `--bg-deep` ring on nodes, 12px labels in `--text-2` with a 3px halo and collision culling, and a legend always in view.
11. **Numbers and dates:** fixed decimals per table column; `6 Jan 2025` everywhere, with "week of …" for weeks; month and week tick boundaries on time axes.
12. **Words:** American spelling as on the site; "person" and "tie" in the interface; sentence case.

## Findings (17 major, 23 minor, 6 polish)

### Site fidelity
- **V1 (major) All views: type too small.** Title 28px vs 44.7px; body 15px vs 17.6px; intro 15px vs 20.7px; line-height 1.55 vs 1.65. `sbs-type-header.png`.
  - Where: `theme.css --fs-*`, `app.css .view__title` / `.view__intro`.
  - Fix: `--fs-h1:clamp(1.9rem,1.5rem+1.2vw,2.4rem)`, `--fs-body:1rem`, `body{line-height:1.6}`, `.view__intro{font-size:1.0625rem;max-width:54ch}`, and 1.75rem titles on phones.
- **V2 (major) Mono labels too small and spaced five different ways:** `.label` 11px at .09em, `.meta` .05em, `.tbl th` .65rem at .07em, `.vt__th` .06em, `.flag`, and the `.ob-*` labels .06em. The site uses 12.74px at .12em. `site-research-1440.png` vs `app-network-1440.png`.
  - Fix: tokens `--fs-mono:.75rem` and `--ls-mono:.12em`; table headers .6875rem at .08em.
- **V3 (major) Two page frames.** Data, Ask and Methods are centred at x=224; the other views are full-bleed at x=37; the header is full-bleed. `app-data-loaded-1440` vs `app-network-1440`.
  - Where: `.view`, `.view--col`, `.app-header__inner`.
  - Fix: a shared 90rem centred wrap; `.view--col` left-aligned with `margin-inline:0`.
- **V4 (major) Boxed buttons, which the site never uses.** Network's head has three equal boxes; Methods has 11 downloads with ragged right edges. `app-network-1440`, `app-methods-1440`.
  - Where: `.btn`, `ConstructionButton`, `ExportMenu`, `methods.js`.
  - Fix: "Construction settings →" as a `.tlink`; one "Export figure" menu button; downloads as `.tlink` "GraphML ↓".
- **V5 (polish) The header rule is always on;** the site's header is transparent until you scroll.
  - Fix: copy the site's `[data-scrolled]` behaviour into `.app-header` with backgrounds .82 and .94.
- **V6 (minor) The dashed drop box (`.drop`) has no counterpart on the site.**
  - Fix: `border:0; border-block:1px solid var(--rule)`, with a mint border only when a file is dragged over.
- **V7 (minor) Footnotes run to about 150 characters per line:** Join attributes, Methods, the Groups E-I note, and Paste help at 11px. `app-data-join-1440`.
  - Fix: `.small/.basis/.ob-help/.ob-note{max-width:66ch}`; `.ob-help` .8125rem.
- **V8 (minor) Network edges render grey-blue, not the site's mint.**
  - Where: `network.js` `edgeMix` .72–.86.
  - Fix: `.55` when there are 3,000 edges or fewer.

### Internal consistency
- **V9 (major) Build/Generate head:** a mono eyebrow over a 1.3rem h2, and the nav says "Generate" while the title says "Synthetic network". `sbs-head-drift.png`.
  - Where: `.ob-head`, `.ob h2`.
  - Fix: the shared `ViewHead` titled "Build" or "Generate"; the sub-tab title becomes a 1.125rem/600 section heading; drop the eyebrow.
- **V10 (major) `--grp-*` blue/orange vs `--cat-*` teal/ochre.**
  - Where: `build.css:15–17`, `build/shared.js:126`.
  - Fix: delete `--grp-*` and return `var(--cat-n)` and `var(--cat-other)`.
- **V11 (major) Controls:** `.ob-input/.ob-select/.ob-btn` use a 2px radius, a `--rule` border and .8125rem, and native selects show the OS "⌄" (`app-build-draw-example-1440`).
  - Fix: use `.btn/.input/.select`, or alias the `.ob-*` classes to identical values.
- **V12 (major) Mono uppercase field labels** (NAME OR PSEUDONYM, DAYS, SEED, TYPE) vs sans "Colour by".
  - Where: `.ob-field>label`, `.ob-label`.
  - Fix: sans, .8125rem, sentence case, muted; mono stays only on fieldset legends.
- **V13 (minor) `.ob-tab`** is muted .8125rem/500 and the active tab isn't bold. Fix: copy `.tabs button`.
- **V14 (major) Generate's chip rows read as pills,** and the disabled option uses strikethrough. `app-generate-full-1440`.
  - Where: `.ob-choices`, `.ob-choice`.
  - Fix: `.seg` for 5 options or fewer; a radio list with descriptions for Setting; disabled options in muted text plus a stated reason.
- **V15 (minor) Unchecked radios and checkboxes show OS grey** (Generate, Ego, Ask, Drawer).
  - Fix: `appearance:none`, 1rem, 1px `--rule-strong` ring; when checked, an accent border and fill with a `--bg-deep` mark.
- **V16 (minor) Ego says "33% COMPLETE" on step 5 of 6 while the bar shows about 83%.** `app-build-ego-who-1440`.
  - Fix: "Step 5 of 6" with the bar at 5/6.
- **V17 (minor) Draw encodes tie type with dashes and has no key;** dashes also mean "in progress".
  - Where: `draw/canvas.js:235`.
  - Fix: solid by default; dashes only when there are several types, with a key in `.ob-status`.
- **V18 (polish) Paste preview:** the count sits outside the rule. Fix: one header row across the full column.
- **V19 (polish) The Roster textarea placeholder is mono.** Fix: `::placeholder{font-family:var(--sans)}`.
- **V20 (minor) Disabled buttons look enabled,** including "Back" on step 1.
  - Fix: `border-color:var(--rule); color:var(--text-muted); opacity:1`; hide Back on the first step.

### Hierarchy and density
- **V21 (major) Data, once loaded:** the drop zone still leads the page and "Open network" is a neutral button. `app-data-loaded-full-1440`.
  - Fix: collapse the drop zone to one text-link line below the report, and make "Open network" `.btn--primary`.
- **V22 (major) The network key starts at y≈846,** below 10 metrics.
  - Fix: legend first in `.split__side`, or as a canvas overlay; the metrics go in a disclosure.
- **V23 (minor) Profile:** six mint "How stable is this rank?" links and a dotted underline on every measure name.
  - Fix: a quiet per-row "stability" link or one action at the head; show glossary underlines on hover and focus only.
- **V24 (minor) Draw has 16 equal 11px toolbar buttons,** which push the canvas off the first screen at 390.
  - Fix: modes as a `.seg`; a File menu; icon buttons for undo and redo; layout controls move to the inspector; text at least .75rem.
- **V25 (minor) The network graph uses less than half the canvas.** Fix: fit to the bounding box with 6% padding.
- **V26 (minor) Diffusion is 8 stacked panels repeating the same paragraph, each with its own y-axis** (3,300px tall).
  - Fix: a 3-up grid of small charts with a shared y-axis, a status flag plus z and p per term, and one method note.
- **V27 (minor) The Time formation chart is 55% wide.** Fix: full width, or span 2 grid columns.

### Data visualization
- **V28 (major) Network labels collide, have no halo, and clip at the canvas edge.**
  - Where: `network.js:264–273`.
  - Fix:
    - a label renderer that draws a 3px `#051521` halo first
    - grid cell 200, density .12
    - label only the 8 largest nodes on desktop and 4 on phones, plus hovered and selected
    - skip any label that would overlap another or the canvas edge
- **V29 (major) Two community colours fail the all-pairs check on the map:** `#6ba04b`/`#d36757` ΔE 0.6 (deuteranopia) and `#6ba04b`/`#13aa89` ΔE 8.1 (normal vision). The palette passes for adjacent pairs, which suits bars and legends, but not a map where any two colours can touch.
  - Fix: community numbers at cluster centres; above 5 communities, fold the extras to `--cat-other` until the user picks one.
- **V30 (minor) Nodes have no outline,** so dense clusters merge into blobs. Fix: a bordered node program with a 1.5px `#051521` border.
- **V31 (major) Mixing matrix:** `--seq-0 #16594b` makes 0, 0.002 and 0.04 look the same; column labels are cut off; every cell has a number; no legend; values overflow at 390.
  - Fix:
    - prepend `#0d2a35` so zero recedes
    - scale the diagonal separately, drawn as outlined cells
    - add a `.ramp` legend
    - rotate column labels −45°
    - show values only in cells at least 44px wide
    - leave zero cells empty
- **V32 (major) Diverging tokens inverted** (`content.js:80`).
  - Fix: rename to `--div-cool/-warm`, add a `divergingColor()` helper, and name the poles in the subtitle.
- **V33 (minor) BarList values sit far from the bar ends;** gutter of about 440px; the Topics domain is fixed at 100%.
  - Where: `charts.js:91`.
  - Fix: `minmax(6rem,14rem) minmax(0,26rem) 3.5rem`; domain = the maximum value.
- **V34 (minor) Repeated month ticks** ("Jan Jan Feb Feb Feb…").
  - Where: `charts.js:59`.
  - Fix: `d3.utcMonth.every(1)` ticks with `%b`, otherwise weekly ticks with `%-d %b`.
- **V35 (minor) "Formed" and "Dissolved" end labels overlap.** Fix: space them at least 13px apart, or drop them since a legend is present.
- **V36 (minor) Formed and Dissolved use the colours that mean Community 1 and 2 elsewhere.** Fix: `--div-cool-1` and `--div-warm-1`.
- **V37 (minor) Ragged decimals** (0.174 / 0.0878 / 0.00692). Fix: fixed decimals per table column.
- **V38 (polish) The selection bar clips the row's colour swatch** (`.vt__row.is-focus`). Fix: pad the first cell.

### Copy
- **V39 (minor) British and American spelling mixed** (Colour, organisation, neighbourhood next to Analyze, organization); the site is American. Fix: American throughout.
- **V40 (minor) "node/edge" in Draw and the Groups basis vs "person/tie" elsewhere.** Fix: "Add person", "tie swaps".
- **V41 (minor) Raw identifiers shown:** "reply/dm/reaction", "(slack, …)", "loaded", "community 1".
  - Fix: Replies, Direct messages, Slack, Community 1.
- **V42 (polish) Jargon leads instead of following a plain gloss:** name generators, TF-IDF, MAD, "z 70". Fix: the plain idea first, the term in brackets.
- **V43 (polish) Four date formats.** Fix: `6 Jan 2025` and "week of …" everywhere.

The tone otherwise matches the site: scholarly and specific, with no marketing voice. Keep it.

### Phone (390)
- **V44 (major) Selecting a person scrolls their profile title under the sticky header.** `app-people-profile-390.png`.
  - Fix: `scroll-padding-top` plus `scrollIntoView({block:'start'})`.
- **V45 (minor) Network's head buttons take about 180px;** the Time `.seg` stretches to full width with an empty half.
  - Fix: head actions as one row of text links; map at 70vh; `.seg{width:auto}`.
- **V46 (minor) Groups table:** swatches wrap above names, and the table is cut off with no sign it scrolls.
  - Fix: `nowrap` names, a sticky first column, a right-edge fade.

What already works at 390: the masthead, menu and nav (`sbs-phone.png`), the empty Data view, the drawer sheet and the Time charts.