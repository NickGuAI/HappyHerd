# Timestamp and composer Web journeys

These twelve Chromium captures accompany automated production-component interactions at 1440×900 and 390×844, light/dark. All were independently inspected. The manifest binds images to the test and fixture source; the final PR checks rerun the committed cases.

- **Group 2:** The real FlatSessionRow and Unistyles runtime render a 12-hour timestamp wider than the old 56px slot. Both text edges remain visible and the same timestamp node and bounds survive unread on/off updates. A fully transparent desktop hover control is not counted as visual occlusion; this is readability proof, not timestamp pointer-target proof. Phone touch layout retains its separate menu column.
- **Group 18:** The production composer opens its model picker from the label edge, switches long→short→long labels while Send retains its exact bounds, and submits once through synthetic transport. Real icons are loaded in these captures.
- **Owned Streamline:** The real New Session owner retains one Agent chip and its Settings action in all four combinations. This longstanding fixture substitutes icon glyphs; these captures prove layout and interaction, not exact whole-screen pixels.

Files beginning `group2-timestamp`, `group18-long-model-send`, and `group18-streamline-single-chip` correspond to those three journeys. KILV supplies exact appearance comparison separately. Native rendering, native menus and authenticated provider effects are not claimed.

The first timestamp harness omitted Web style classes and exposed a menu overlay; its assertions were insufficient despite passing. That evidence was rejected and retained locally. The final case uses the existing production-style harness, actual timestamp formatter and explicit visual-occlusion assertions. A pre-existing fixed timestamp stub and transparent pointer-hit box were diagnosed without changing production CSS, timeout limits or existing assertions.
