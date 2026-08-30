# Medal Studio — 100-point release audit

Audit date: 2026-08-31  
Audience: event organizers and runners with no CAD experience  
Release rule: every item below is either improved in the product or positively verified. The honest platform boundaries at the end are not presented as available controls.

## 1. Starting a medal

1. **First choice is understandable — Improved.** New Medal now begins with a plain choice between a clean medal and polished editable examples.
2. **Examples in the wizard match the gallery — Improved.** The wizard uses the same curated projects rather than older look-alike templates.
3. **The setup has visible progress — Improved.** Five progress marks and “step X of 5” identify position in the flow.
4. **The blank start is useful — Improved.** It starts as a clean black medal with safe printer defaults.
5. **Event information is requested early — Improved.** Event name, distance/award and date are collected before the editor opens.
6. **Starter wording remains editable — Verified.** Each entered line becomes an independent text item.
7. **Shape comes before decoration — Improved.** Body shape and overall size have their own plain-language step.
8. **Ribbon choice uses recognizable outcomes — Improved.** External bar, double bar, round hole, internal slit, quick-load slit and none are explained visually.
9. **Common ribbon widths do not require engineering knowledge — Improved.** 22, 25 and 38 mm presets set safe clearances automatically.
10. **Fine dimensions do not overwhelm beginners — Improved.** Exact attachment dimensions are behind “Fine-tune the opening.”

## 2. Navigation and language

11. **The app reads as one workspace — Verified.** Design, model interaction and print layers stay in a single editor.
12. **The primary navigation is short — Improved.** Desktop exposes only Add, Medal and Items as persistent tools.
13. **Creation tools stay together — Improved.** Text, Image, Shape, Draw and Ideas share one shelf.
14. **Printer settings stay out of the main workflow — Improved.** Colors come first and technical defaults are collapsed.
15. **“Objects” is expressed as “Items” — Improved.** This is more familiar to non-CAD users.
16. **“CAD tree” is expressed as “Design items” — Improved.** The right-hand structure uses ordinary language.
17. **Surface operations are outcome-based — Improved.** Users choose Raised, Recessed, Flat color or Hole.
18. **Height language replaces unexplained Z language — Improved.** Visible guidance refers to height, depth and distance from the build plate.
19. **Export is named by the user’s goal — Improved.** “Print it myself,” “Send to a print maker,” “Send a preview,” and “Continue in CAD” lead each format.
20. **The top bar remains usable at laptop width — Improved.** Save-copy and verbose help labels collapse while their functions remain available.

## 3. 3D interaction

21. **The medal rotates freely — Verified.** Dragging empty model space orbits the complete model.
22. **The medal can be viewed from below — Verified.** Back-side and unrestricted orbit views expose the underside.
23. **Front and back are one click away — Improved.** Explicit Front side and Back side camera buttons replace ambiguous top/bottom labels.
24. **Edge and side views are available — Improved.** Dedicated camera presets make thickness inspection easy.
25. **The model fits itself to the view — Verified.** Fit view frames the current body, artwork and optional ribbon preview.
26. **Projection can be changed — Verified.** Perspective and orthographic viewing are both supported.
27. **Keyboard-only camera control exists — Improved.** Arrows orbit, Shift+arrows pan, +/- zoom, 1/2 switch sides, 0 returns to 3D and F fits.
28. **The canvas explains its controls to assistive technology — Improved.** It is focusable and has a complete interaction label.
29. **Hover identifies real printable surfaces — Verified.** Face, side, selected item and physical height are reported.
30. **The preview is smoother without changing print geometry — Verified.** Supersampling and shared-wall normal smoothing improve appearance while printable vertices remain exact.

## 4. Selecting, moving and changing height

31. **Clicking artwork selects it — Verified.** Direct 3D picking works on text, images, symbols and drawings.
32. **Selected items show handles — Verified.** Move, rotate, side, corner and height controls appear around the real item.
33. **Movement previews in real time — Verified.** The transformed object proxy follows the pointer without waiting for confirmation.
34. **Height previews in real time — Verified.** The blue height handle and millimeter/layer label update while it moves.
35. **A deliberate Apply/Restore choice exists — Improved.** Height changes have explicit confirmation instead of requiring a click in empty space.
36. **Text can be edited by double-clicking — Verified.** Direct inline wording edit supports Enter to apply and Escape to restore.
37. **Exact width and height can be typed — Verified.** Physical dimensions are available in the selection details.
38. **Aspect ratio can be locked or freed — Verified.** Corner scaling is proportional by default and independent scaling is opt-in.
39. **Any selected item can be fitted safely — Improved.** “Fit inside medal” centers and scales it within the protected edge.
40. **An item can be copied to the other side — Improved.** The copy changes face, maintains readable orientation and becomes flat when copied to the back.

## 5. Medal body and ribbon construction

41. **Overall thickness is editable — Verified.** Base thickness changes geometry, weight and price.
42. **The face material is independently selectable — Verified.** Base color is not coupled to artwork colors.
43. **The raised edge material is independently selectable — Verified.** Rim/edge color can differ from the base.
44. **Multiple edge styles are physical, not decorative — Verified.** Plain, double, segmented, laurel, wings, rope and related masks affect exported geometry.
45. **Edge width and height are adjustable — Verified.** Both are constrained in millimeters.
46. **Common medal bodies are available — Verified.** Circle, rounded, polygonal, shield, gear, scalloped, star and custom outlines are supported.
47. **Custom outlines are validated — Verified.** Self-crossing and unsafe rings are rejected instead of silently exporting bad bodies.
48. **Internal ribbon openings are actual holes — Verified.** Slits and eyelets remove material and survive export.
49. **External bars extend the real bounds — Verified.** Fit, report dimensions and geometry include them.
50. **Ribbon visualization is optional — Verified.** A configurable-color ribbon preview can be shown without entering the print export.

## 6. Text, symbols and drawing

51. **Text size is chosen before placement — Improved.** A clear millimeter input precedes the 3D preview.
52. **Long text can fit automatically — Improved.** A default safe-fit option shrinks wording before placement.
53. **Starting placement can be suggested — Improved.** Center, near top and near bottom reduce unnecessary dragging.
54. **Typography has simple style choices — Improved.** Clean, wide and classic serif families avoid font jargon.
55. **Weight has clear choices — Verified.** Bold, extra bold and heavy map to printable stroke expectations.
56. **Twelve useful symbols are available — Improved.** Basic geometry plus heart, mountain, finish flag, trophy and a recognizable runner are included.
57. **Symbol size is set before placement — Improved.** Symbols no longer begin at an unexplained fixed size.
58. **Manual drawing stays on the selected face — Verified.** Brush, line and polygon work in a face-aligned sketch view.
59. **Drawing shortcuts are documented — Verified.** V/B/L/P/E/M, Enter, Backspace and Escape match visible tools.
60. **Nozzle-aware minimum detail is checked — Verified.** Text strokes, paths, gaps and islands are evaluated in physical millimeters.

## 7. Images and generated ideas

61. **Existing artwork is the primary hosted action — Improved.** The static site leads with a large “Use my image” action.
62. **A dead generator is not advertised on static hosting — Improved.** Local image creation is shown only where the local runtime can actually provide it.
63. **PNG and JPEG work without CAD conversion — Verified.** Browser decoding leads directly to the cleanup editor.
64. **SVG and basic 2D DXF imports are accepted — Verified.** They enter the same safe preview workflow.
65. **Large/unsafe files are bounded — Verified.** Type and 24 MB limits fail with actionable messages.
66. **Studio backgrounds can be removed safely — Verified.** Only connected background regions are removed, preserving isolated matching details.
67. **A full medal photograph can be detected — Verified.** Ribbon and studio background are cropped and the medal face is masked.
68. **Colors become separate editable pieces — Verified.** Segmentation keeps spatially distinct regions instead of flattening everything into one blob.
69. **Detected text lines become editable text when confidence permits — Verified.** Aligned characters are grouped semantically.
70. **Text-to-medal does not paste the prompt — Improved.** The local planner extracts event, date, distance and visual subject into scored editable concepts, then runs a mandatory nozzle-aware polish pass until no visible detail relies on a fragile one-line feature.

## 8. Items, projects and recovery

71. **Front and back items are visibly separated — Improved.** The item tree labels the back as always flat.
72. **Groups can be created — Verified.** Related items retain independent editability while moving as a unit.
73. **Groups can be renamed, arranged, copied, locked and hidden — Improved.** Actions are visible words rather than tiny unexplained icons.
74. **Interactive controls are not illegally nested — Improved.** Selection, visibility and lock controls are sibling buttons with accessible names.
75. **Item order can be changed — Verified.** Up/down ordering controls define overlap predictably.
76. **Autosave is explicit — Improved.** The top bar reports saving, saved and failed states.
77. **Save failure has a recovery route — Improved.** Clicking the error downloads an emergency local backup.
78. **Multiple local medals are supported — Improved.** “My medals” lists recent designs with open and copy actions.
79. **A previous version can be restored — Improved.** A rolling local recovery snapshot is available from My medals.
80. **Mobile users can reach project management — Improved.** My medals is present in the mobile tool rail.

## 9. Colors, checks, estimate and export

81. **Color can be added where it is needed — Verified.** Add-color appears in text, image, drawing and selected-item contexts.
82. **A color includes real filament properties — Verified.** Material, effect, stock, price, density and abrasive status are captured together.
83. **Filament stock is searchable — Improved.** The advanced local catalog can be filtered by color, brand, material or effect.
84. **Unknown stock is not treated as available — Verified.** Quote logic distinguishes unknown from a known amount.
85. **Custom quantities are honored — Improved.** The estimate table includes the quantity typed in the footer.
86. **Price language is honest — Improved.** It is an estimate with clear exclusions and never claims a production quote.
87. **Checks lead to the affected item — Improved.** “Show item” closes the report and selects the exact problem.
88. **Safe-area failures have a one-click repair — Improved.** “Fix automatically” fits the affected item inside the medal.
89. **Passing checks do not claim guaranteed printability — Improved.** Every pass still tells the user to inspect the result in a slicer.
90. **Exports are complete and goal-oriented — Verified.** Multicolor 3MF, aligned STL ZIP, PDF, B-Rep STEP, SVG and editable JSON are available.

## 10. Reliability, responsive layout and accessibility

91. **Large 3MF packaging is streamed — Verified.** Compression does not require a second giant in-memory model string or lower the selected detail.
92. **Export has a visible stop action — Improved.** It terminates the geometry worker immediately, stops after an already-running packaging step, and suppresses any delayed download.
93. **STEP is described accurately — Improved.** It is a valid B-Rep rebuilt from production contours, not falsely advertised as an analytic sketch history.
94. **The technical PDF is self-contained — Verified.** It includes front, readable reverse, 3D/side context, dimensions, weight, colors and estimate.
95. **Back artwork is always build-plate flat — Verified.** Normalization, preview and export enforce first-layer color ownership.
96. **Touch targets expand on touch devices — Improved.** Coarse-pointer controls meet a practical 44 px target.
97. **Reduced-motion preference is respected — Improved.** Nonessential animation and the spinner stop when requested.
98. **High-contrast forced-color mode is supported — Improved.** Active tools, status and selection remain visible.
99. **Important updates are announced — Improved.** Toasts, camera changes, saves and editor actions use live status output.
100. **Release behavior is regression-tested — Verified.** Model, image, concepts, persistence, geometry, exports and static-host boundaries are covered by the automated suite and real-browser workflow QA.

## Honest capability boundary

Medal Studio is a specialized parametric medal editor, not a general solid modeller or a replacement for the printer’s slicer. It intentionally does not advertise side-face sketching, analytic feature-history editing, final G-code generation, hosted-static installation of local AI, cloud collaboration, checkout, or maker fulfilment as working controls. The shipped workflow covers the full novice medal path: start, construct, decorate both printable faces, validate, estimate, save, report and export. The final 3MF/STL must still be checked with the chosen printer profile in PrusaSlicer, OrcaSlicer, Bambu Studio or another production slicer.
