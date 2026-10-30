# Living Carousel

A local-first web collage editor built with SvelteKit, TypeScript, pnpm workspaces and Vite+.

## Run

Use Node **26.13.0** and pnpm **12.16.1**.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:5173. No API keys are needed for the free editor; email sign-in requires the configured backend described below.

## Available now

- Three 1080×1350 portrait slides on one continuous logical canvas.
- Four Bento template families (Mosaic, Editorial, Balanced, Panorama), geometric shuffle variations, drag-to-swap and shared-divider resizing with minimum cell sizes.
- Freeform Scrapbook photos: mouse dragging across slide seams, corner resizing, rotation handle, deletion, and forward/backward/front/back stacking.
- Crop mode (double-click or Crop photo), crop/zoom controls, precise numeric transforms, and undo/redo. One mouse gesture creates one undo entry; Escape cancels an in-progress gesture.
- Canvas zoom and horizontal scrolling. Keyboard arrows move a selected Scrapbook photo (Shift for larger steps); Delete removes it. Original photos remain in the library and can be added back.
- JPEG, PNG and WebP input (initially 3–15 photos, 20 MB and 40 megapixels per photo). After creating a collage, Scrapbook photos can be intentionally deleted down to an empty canvas; originals remain in the library.
- Transactional IndexedDB saves with original image blobs, reload restoration and exclusive-tab ownership with cooperative takeover.
- PNG or JPEG slides packaged in a ZIP; a project backup ZIP containing JSON and original assets.
- Responsive desktop/mobile layouts and keyboard-accessible form controls.

The project backup is an archive; importing backups is not implemented. Storage is per browser and can be cleared or evicted. Files stay local. The page currently loads typography from Google Fonts; it does not send photo data there.

## Quality checks

```sh
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Vite+ 1.4.0 runs linting, formatting for supported files, unit tests, builds and staged checks. The installed formatter **skips `.svelte` files**, so Prettier with its Svelte plugin handles those files only. ESLint supplies Svelte template rules; `svelte-check` validates component types and compiler diagnostics. There is one formatter per file type.

Vite+ installs `.vite-hooks` through `prepare` without editing `AGENTS.md`. Pre-commit runs staged format/lint fixes; commit-msg runs commitlint with Conventional Commits. CI runs checks, tests and production build, plus commitlint on PR commits. Hooks do not replace CI.

```sh
pnpm exec vp hooks status
pnpm format
```

## Workspace

- `apps/web`: SvelteKit app; root `vite.config.ts` owns shared tooling.
- `tests`: Chromium user-flow tests, including real ZIP pixel dimensions and tab takeover.
- `AGENTS.md`: Ponytail rules plus project-specific constraints.
- `MVP_Spec.md`: original broader draft; the narrower implementation scope agreed in conversation governs this first slice.

Do not create Astro/mobile apps or shared packages until they are actually needed. Framework-independent geometry is in `apps/web/src/lib/editor/model.ts`.

## Authentication and private media backend

A Convex development project has been provisioned. Its public addresses live in the ignored `apps/web/.env.local`. On a fresh clone, configure your own deployment:

```sh
pnpm backend
```

Backend source lives in `apps/web/src/convex`; commit the generated API types. Better Auth uses the Convex component and the community-maintained SvelteKit 3 bridge. WorkOS is no longer used.

- Magic-link sign-in only, no passwords; links expire after ten minutes and token identifiers are hashed.
- A same-origin `/api/auth/*` proxy forwards to Convex. Authentication never gates the free editor.
- Better Auth verifies identity and live sessions before private media operations.
- The Resend component queues messages and handles provider retries. Sending fails explicitly until the API key and verified sender are configured. No links are logged or returned to the browser.
- Media upload authorization requires sign-in, explicit consent, allowed type/size, and available capacity (maximum 30 temporary records per user).
- Upload keys are generated server-side. Finalization verifies actual object metadata against the request; only finalized, owned, unexpired media receives a short-lived download URL.
- Owner-authorized deletion and hourly cleanup of expired media are implemented. Configure a seven-day R2 lifecycle rule as a second cleanup mechanism, including unfinalized/orphaned uploads. The component's PUT URLs cannot enforce a byte limit at upload time; type/size are checked on finalization, and this API is not yet enabled in the editor.
- Email content cleanup is scheduled daily after seven days.

### Configure services

Use private secret prompts for credentials; never paste secrets in chat, README, or source control. App code reads email and R2 secrets from Convex environment variables, not browser env.

1. **Resend:** Create an account, verify a sending domain, and supply `RESEND_API_KEY` plus `AUTH_EMAIL_FROM`. Optionally add the `/resend-webhook` endpoint on your `.convex.site` URL and configure `RESEND_WEBHOOK_SECRET` for delivery/bounce status. Queueing a message does not guarantee inbox placement or delivery before its link expires.
2. **Better Auth:** `SITE_URL` must match the public app origin. A cryptographically random `BETTER_AUTH_SECRET` was generated on the development deployment; set one independently on production. Use http://localhost:5173 for local email sign-in, matching the configured origin. `127.0.0.1` is a different cookie origin.
3. **R2:** Create a private bucket with bucket-scoped Object Read & Write credentials. Set `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` and `R2_BUCKET` on Convex. Apply `docs/r2-cors.json` for local GET/PUT CORS, add the deployed site origin when available, and configure lifecycle deletion. Do not enable public bucket access.

The development deployment currently uses `http://localhost:5173` as its auth origin and `Living Carousel <signin@mail.mehra.dev>` as its sender. The Resend key is stored on Convex. The sender domain is verified; a real sign-in link was sent and the user confirmed successful sign-in on 29 October 2026. Restart `pnpm dev` after changing `.env.local` (the current Vite+/SvelteKit combination can fail a hot restart after env changes).

No Wrangler/global CLI is needed for these integrations. The project-local Convex CLI manages backend deployment. Hosting the web app on Cloudflare will require selecting its adapter and configuring Wrangler later.

### Remaining paid workflow

PayPal checkout/ledger, fal.ai generation, and Render MP4 export are not implemented or enabled yet. The editor's Bring to Life panel provides sign-in, but does not pretend to charge or generate media. The private media APIs are prepared for the future paid flow and not automatically called on photo upload.

Next: validate R2 PUT/finalization/download/deletion against the private bucket, then implement server-confirmed PayPal Sandbox credit accounting and durable AI/render jobs. Cloud rendering requires explicit consent to upload all assets in the final composition; static exports stay local.

## Known limits

Shared Bento dividers preserve the layout partition; arbitrary cell split/merge and multi-selection are not implemented. Existing saved layouts retain their transforms; choose a new Bento template to enable shared dividers on a legacy layout. No paid AI/video flow, native mobile app, social publishing, cloud sync, or multi-project dashboard yet. Browser tests currently cover Chromium; Safari/iOS and Android hardware testing remains outstanding. Fast tab closure before a pending IndexedDB save completes can lose the latest edits; wait for Saved or export first. Adapter-auto supports local validation; select the deployment adapter when wiring the hosting environment.

## License

MIT. Ponytail rules are derived from DietrichGebert/ponytail under MIT; see THIRD_PARTY_NOTICES.md.
