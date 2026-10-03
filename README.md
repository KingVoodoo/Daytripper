# Daytripper

Standalone Windows EVE Online wormhole mapper, extracted from Companion. React 19, TypeScript, Vite, Tauri 2, Rust, and bundled SQLite. No Companion checkout, WOKAuth server, or external database is required.

## Run

Windows installers are available from the repository's GitHub Releases page.

Install Node.js and Rust with the Windows MSVC build tools, then run:

```powershell
npm ci
npm run desktop
```

`npm run dev` runs a browser preview. EVE login, local SQLite backup, live pilots, clipboard capture, and native overlay windows require the desktop app. `npm run desktop:build` creates a local Windows installer.

## EVE sign-in

The public Daytripper Client ID is configured. Register its callback exactly as `http://localhost:17321/callback`, with these scopes:

- `esi-location.read_location.v1`
- `esi-location.read_online.v1`
- `esi-location.read_ship_type.v1`
- `esi-ui.write_waypoint.v1`

Use **Sign in with EVE** once for each character. Login uses authorization code with PKCE, state verification, and signed JWT validation; the app does not use a client secret. Tokens stay in Windows Credential Manager. Removing a linked character removes its local credential without deleting maps.

## Mapping and home

Choose a home system in Settings. Search includes the bundled 8,490-system universe. New chains start at that system, and the home appears among routing destinations. Changing home preserves existing chains. There is no corporation-specific home preset. Any prototype preset map is retired into a local backup rather than silently discarded.

The original Mapping HUD retains scanner selection, signatures, outward/return bookmarks, K162 assignment, window dragging, and content-based sizing. Use **Mapping HUD** to open it. Keep the main mapper running while using the HUD. Native capture only ingests fresh scanner clipboard revisions while an EVE client owns focus. Local EVE logs provide transit evidence; ESI supplies linked pilots, locations, and ships.

Maps, signatures, notes, preferences, and home selection use shared WebView local storage, backed up to `daytripper.sqlite3` in Tauri's `com.daytripper.desktop` app-data directory. The SQLite database also stores public application settings and linked-character identities, never tokens. Public EVE-Scout, ESI, and zKillboard data still require internet access. Corporate shared-chain relay and server-wide fleet coordination are not part of this self-contained app.

## Login splash and callback

Startup opens the branded splash. Sign in there, enter with already linked pilots, or continue locally. The mapper stays mounted behind it so returning to the character screen does not reset your chain. The callback displays the verified login result and rotates eight Daytripper features with practical tips, including home naming and the Mapping HUD. It includes pause and manual navigation controls and honors reduced-motion preferences.

Eight ship-free wormhole backgrounds are bundled in `public/splash`: the four empire palettes, Guristas/Angel/Sansha-inspired palettes, and Triglavian crimson. The supplied logo is in `public/brand/daytripper.png` and is also the source for Tauri app icons. Regenerate icon sizes with `node scripts/icon.mjs`.

The callback automatically removes the background from each signed-in character’s EVE portrait using the bundled U2Net model and native Rust processing. It preserves original color pixels, adds an alpha mask, and caches the PNG by portrait hash in the local app cache. No background-removal service or runtime model download is used. Tips display immediately while processing finishes; a failed portrait never prevents sign-in. Callback art is embedded in its HTML, so the page and carousel remain usable after the temporary sign-in listener closes. Reloading that closed callback URL is not supported; begin a new login in the desktop app.

Generation prompts and reference information are recorded in `art-direction/wormhole-prompts.json`. The labeled callback design preview can be regenerated with `cargo test --manifest-path src-tauri/Cargo.toml export_design_preview -- --ignored`; this does not perform a live sign-in.

The complete main interface uses Arwes core SVG frames and assembly animation, angular controls, circuit detail, and locally bundled Orbitron, Rajdhani, and Share Tech Mono fonts. Arwes is pinned to 1.0.0-next.25020502; preset dimensions are resolved without eval to preserve the native and callback Content Security Policy. Quiet synthesized click sounds have a Sound on/off control. Those styles and sound handlers are scoped to the main app; the Mapping HUD is unchanged. Callback portraits meet the bottom edge of their backdrop.

## Validation commands

```powershell
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Live EVE login, refreshed credentials, pilot movement, and in-game waypoints require a user-authorized EVE session to verify. Compilation alone does not establish those results.

