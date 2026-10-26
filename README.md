# Match Report — Android PWA starter

This is a Progressive Web App starter for football and tennis post-match reports. It fetches current/recent match lists from SportScore's public widget endpoint and formats available timestamps in India Standard Time (Asia/Kolkata).

## Use it quickly
1. Unzip this folder.
2. Publish the folder on a static HTTPS host (for example, a GitHub Pages site or another static host).
3. Open the HTTPS URL in Chrome on Android.
4. Chrome menu (⋮) → **Add to Home screen** / **Install app**.
5. Open the app, allow notifications, and select Football or Tennis.

## Important limitations in this starter
- This is a PWA, not a signed Android APK.
- Automatic finish detection runs only while the app is open and its periodic check is enabled. Android browsers suspend pages in the background; reliable alerts while the app is closed require a server-side scheduled checker plus Web Push and a subscription backend.
- Exact real-world goal times, VAR decisions, and tennis set-completion timestamps only appear if the API returns them. This starter does not fabricate missing timestamps.
- SportScore's public endpoint is described as free with an attribution link requirement; keep the visible Powered by SportScore link in the app. Check their current terms before commercial use.
- The response schema may evolve. This starter tries common field names but should be validated against real responses before relying on it.

## Data endpoint used
`https://sportscore.com/api/widget/matches/?sport=football&limit=20`
`https://sportscore.com/api/widget/matches/?sport=tennis&limit=20`

Match details may be available via the provider's documented `/api/widget/match/` endpoint when a valid match slug is returned. The current starter displays event timelines if they are included in the match-list response; fetching match detail per item can be added once the live schema is verified.

## Free hosting options
- GitHub Pages (requires a GitHub account and repository)
- Cloudflare Pages / Netlify static hosting

No passwords or API keys are embedded in this app.
