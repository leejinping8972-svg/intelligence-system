# Advertising media delivery

Authenticated GET/HEAD `/api/media?ad=<saved Meta ad id>&kind=video|image|poster&index=0` streams only an asset saved in that ad record. It does not accept arbitrary upstream URLs or call ScrapeCreators. Session cookies authorize browser media requests; the gateway strips client-supplied bridge keys.

Only HTTPS Facebook/Instagram CDN hosts are allowed. Every redirect and all resolved addresses must remain public, with DNS pinned per request. Only video or raster-image MIME types are delivered, with bounded content length, single HTTP byte ranges, and stream backpressure. Source expiry returns a clear error; it does not spend provider credits to refresh automatically.

New ads preserve HD and SD video URLs and provider preview images. Existing ads play their already-saved video URL using metadata preloading. Video takes priority over image when both exist. The player falls back to another saved video variant, and offers retry/source inspection on failure.

Ad collection accepts up to 100 entered search terms per job and still links exact matches to selected keywords. Direct terms remain job inputs, not synthetic selected keyword records. An optional batch name is retained on each matching ad across repeated collections and can be filtered in the ad list. The existing source-field AI job translates the saved advertiser name, headline, and copy with source quotes, including descriptive parts of Vietnamese advertiser names. Ad and advertiser lists show Chinese first with source text underneath; unavailable translations show an explicit pending label. Reanalysis of historical ads is an explicit, charged admin action. The job saves ad creatives and verifies/associates landing sites, merging with existing search-discovered sites. Queued/running/terminal states and ad counts remain on selected keywords. No full product crawl is added to this stage.

Products use one filtered data set and shared comparison/detail state in card and table modes. Both modes page through 10/20/50/100 rows. Filters reset to page 1; shrinking results clamps page bounds. CSV export continues to export all filtered rows.
