# London home lights

`london-home-lights.mp4` is a 10-second, 1200 × 960, silent H.264 animation. It populates a dark map with lights over 6.5 seconds and holds the finished map. The JPEG is its final-frame poster. The About page places it between the introduction and Why, with native playback controls and reduced-motion support.

Each generated point represents one domestic property in the rounded borough totals: 3,880,560 points across 32 boroughs and the City of London. The published London total is 3,880,530; the 30-property discrepancy comes from independently rounded totals. Both round to 3.88 million.

Positions are seeded, uniformly sampled within borough polygons. They are illustrative, not property coordinates; they may fall on parks or non-residential land. Overlapping points merge at video resolution. This should not be described as an address-level map or a count of advertised listings.

## Sources and attribution

- HMRC/Valuation Office, Council Tax stock of properties 2026, CTSOP1.0 supplementary table at 8 September 2026: https://www.gov.uk/government/statistics/council-tax-stock-of-properties-2026
- GLA/Ordnance Survey London borough boundary layer (2017): https://gis.london.gov.uk/arcgis/rest/services/apps/Air_Quality_map_service_01/MapServer/0
- Contains public sector information licensed under the Open Government Licence v3.0. Contains Ordnance Survey data © Crown copyright and database right.

The existing map's published polygons were projected with d3-geo's Mercator projection. The exported video uses the same borough counts, sampled with seed 19217; no visitor data or network map API is needed to play it.
