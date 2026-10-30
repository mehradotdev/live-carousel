# Living Carousel — Hackathon MVP Product & Technical Specification

**Document Version:** 1.0 Discussion Draft  
**Prepared Date:** 28 October 2026  
**Audience:** Developer / Implementation-Planning Handoff  
**Status:** Product direction agreed; implementation choices marked _[Proposed]_ or _[Needs Validation]_ are open for verification.  
**Target Event:** PayPal AI Hackathon (Devpost)  
**Submission Deadline:** 12 November 2026, 12:00 PM (noon) PST (stated in the MVP draft; absent from the supplied rules draft)

---

## 1. Product Summary & Core Principles

### Product Definition

- **One-Sentence Product:** Turn a collection of ordinary photographs into a visually continuous multi-slide Instagram carousel, with free static Bento or Scrapbook designs and optional AI-generated subtle motion purchased using PayPal credits.
- **North Star Flow:** Upload photos $\rightarrow$ generate free static multi-slide collage $\rightarrow$ optionally animate selected photos using PayPal Sandbox credits $\rightarrow$ download individual social-ready MP4 clips.

### Product Principles

1. **Casual User First:** Choose format, upload photos, preview a complete static collage, and optionally trigger **Bring to Life**. No complex prompt engineering or design expertise required.
2. **Robust Free Offering:** Static carousel creation, interactive editing, and image export are completely free and require no user registration.
3. **Creative Control When Desired:** An optional editor allows position and crop adjustments; AI processing never irreversibly flattens or destroys original user assets.
4. **True Spatial Continuity:** The composition is laid out on **one wide logical canvas** and cropped into identically sized slides. Visual continuity exists across manual swipes; it does **not** assume synchronized video playback in Instagram.
5. **Local-First & Privacy-Sensitive:** Single local workspace automatically preserved on the client device/browser. Cloud storage is utilized temporarily only for paid AI operations. No cloud project dashboard in MVP.
6. **Strict Cost Control:** Template- and heuristic-based automatic layout and client-side static rendering; paid compute is reserved exclusively for AI animations. Long-running video processing inside Cloudflare Workers is prohibited.
7. **Complete End-to-End Demo Priority:** Delivering a functional path (Creation $\rightarrow$ PayPal Sandbox Purchase $\rightarrow$ AI Animation $\rightarrow$ MP4 Export) outranks adding extraneous features.

---

## 2. Target Users & Success Criteria

### Target Users

- **Primary:** Casual Instagram creators seeking a polished, seamless carousel in minutes without learning professional design tools.
- **Secondary:** Power users seeking granular control over Bento grid cell sizes, scrapbook collage layers, photo crops, and selective animations.

### Core Jobs to Be Done

- Assemble mixed portrait, landscape, and square photos into a visually unified carousel.
- Produce seamless visual continuity across slide boundaries when swiping.
- Animate select photos subtly without jarring edge artifacts or seam jumps.
- Export separate, platform-compliant static images or MP4 clips (direct social publishing is out of scope).

### Quantifiable Success Criteria

- **Free Guest Flow:** A first-time user can upload 6 photos, generate a 3-slide static collage, customize at least one element, and export the slides without signing in.
- **Paid Motion Flow:** An authenticated user can purchase credits via PayPal Sandbox, trigger generation for at least one animated photo, and download a 3-slide MP4 carousel.

---

## 3. Scope Specification

### Feature Matrix

| Capability           | MVP Status        | Specification / Boundary                                                                                                                                                           |
| -------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Aspect Ratios**    | Locked / Proposed | Portrait 4:5 (Default), Square 1:1; Landscape preset proposed at 1.91:1 _[Needs Validation against Instagram specs]_                                                               |
| **Slide Count**      | Locked            | 2 to 5 slides; Default is 3                                                                                                                                                        |
| **Input Formats**    | Locked / Proposed | JPEG, PNG, WebP; respect EXIF orientation. HEIC/HEIF deferred or requires proven conversion path. Still photos only (no video/Live Photos)                                         |
| **Photo Quantities** | Locked / Proposed | Minimum 1 photo per slide (e.g., 5 slides require $\ge 5$ photos); recommended 2–3 per slide; suggested upper limit of 15 photos _[Needs Validation via device performance tests]_ |
| **Layout Styles**    | Locked            | **Bento Grid** (structured, shared dividers) and **Scrapbook** (layered, rotated, overlaps)                                                                                        |
| **Composition**      | Locked            | Algorithmic/heuristic one-click layout with Shuffle Layout capability                                                                                                              |
| **Editor**           | Locked            | Style-aware direct manipulation, per-photo cropping, boundary guides, undo/redo                                                                                                    |
| **Static Export**    | Locked            | Individual PNG/JPEG slides cropped from wide canvas; optional ZIP download; no auth/payment required                                                                               |
| **AI Motion**        | Locked            | Selective image-to-video animation capped at **1 to 3 photos** per collage; credit cost quoted upfront                                                                             |
| **Video Export**     | Locked            | Separate MP4 files (one per slide); identical dimensions and duration (target 4–6 seconds, 24/30 fps, no audio, H.264)                                                             |
| **Monetization**     | Locked            | One-time PayPal credit packages exclusively; Sandbox implementation                                                                                                                |
| **Authentication**   | Locked            | Required only when initiating credit purchases or cloud AI generation                                                                                                              |
| **Persistence**      | Locked            | Exactly one local workspace in browser IndexedDB; no multi-project selection dashboard                                                                                             |
| **Concurrency**      | Locked            | Single active editing tab enforced via Web Locks API + BroadcastChannel; second tab provides takeover                                                                              |
| **Cloud Storage**    | Locked / Proposed | Ephemeral private Cloudflare R2 storage for AI inputs/outputs; proposed 7-day expiration                                                                                           |

- Avoid automatic image duplication or blank slides; offer Add Photos or Reduce Slides when needed.
- Suggested starter Bento template count: 3–5.

### Explicitly Excluded from Scope

- Living Panorama / complex human segmentation and cutout integration
- Motion transfer across disparate layers
- Real-time collaborative multi-user editing
- Multi-project management dashboard or cross-device cloud sync
- Subscription billing models or recurring payments
- Template or asset marketplace
- Text-to-image AI panorama generation
- Direct social API publishing (Instagram Graph API)
- Arbitrary cell split/merge engine for Bento layouts
- Complex sticker, text, or vector overlay packs
- Video or Apple Live Photo file imports
- Heavy client-side WebGL real-time shaders
- Offline PWA install guarantees
- Native iOS or Android mobile applications

---

## 4. User Flows & System Interactions

### 4.1 Free Quick-Create Flow

1. **Application Launch:** Client checks for existing local workspace in IndexedDB. If found, it automatically restores state without displaying a recovery prompt; otherwise, presents an empty initial state.
2. **Configuration:** User selects Layout Style (Bento Grid or Scrapbook), Aspect Ratio (Portrait 4:5 default, Square 1:1, or Landscape 1.91:1), and Slide Count (2–5, default 3).
3. **Asset Ingestion:** Drag-and-drop or file picker ingestion. Displays thumbnails and count. Rejects non-image files; enforces minimum photo rule ($\ge 1$ photo per slide).
4. **Layout Generation:** User clicks "Create My Collage". Algorithm renders continuous composition on the shared global canvas and displays an interactive swipeable preview. Actions available: **Shuffle**, **Customize**, **Download Images**, **Bring to Life**.
5. **Optional Editing:** User modifies layer positions, crops images inside tiles, adjusts shared Bento dividers, or reorders Scrapbook layers with undo/redo support.
6. **Static Export:** User clicks "Download Images". Renderer slices the logical canvas into $N$ slides and exports individual PNG/JPEG files (or a bundled ZIP). User remains anonymous.
7. **Workspace Reset:** "New Collage" button resets canvas only after explicit user confirmation if unsaved changes or assets are present.

### 4.2 Paid AI Motion Flow

1. **Initiation:** User clicks "Bring to Life" from an active static layout.
2. **Photo Selection & Quote:** Engine identifies 1–3 candidate photos suitable for subtle motion (with manual toggle option). UI displays motion preview suggestions and quotes exact credit cost.
3. **Authentication Gate:** If guest, user is prompted to sign in (WorkOS AuthKit or Clerk). Local workspace state is preserved across auth redirects without data loss.
4. **Credit Verification & Purchase:**
   - Server checks user credit balance via Convex.
   - If insufficient, user initiates PayPal Sandbox checkout for a credit pack.
   - Server validates PayPal Orders v2 capture independently; server ledger is credited once.
5. **Job Dispatch & Asset Transfer:**
   - User confirms generation. Server atomically reserves credits in Convex ledger.
   - Client uploads selected source images to private temporary Cloudflare R2 storage via presigned short-lived PUT URLs.
   - Server triggers asynchronous image-to-video API (e.g., fal.ai).
6. **Background Processing & Polling:**
   - Provider executes video generation. Convex tracks job lifecycle state.
   - User may navigate away or close browser without aborting the server/provider job.
7. **Result Delivery & Compositing:**
   - Generated MP4 clips are written to private R2 storage.
   - Client fetches video blobs, stores them locally in IndexedDB if quota permits, and displays animation preview inside the original tile crop.
   - User may accept animation, regenerate (at documented cost), or revert to static photo.
8. **Final Video Slicing:** Client (or fallback renderer) composites animated clips into the global composition and renders $N$ separate slide MP4 files matching exact dimensions and duration.
9. **File Download & Expiry:** User downloads final video clips (or ZIP). Cloud assets in R2 expire on a documented schedule (proposed: 7 days); access is authenticated and time-limited. Confirm file receipt and offer manual Download Animation.

#### Error & Failure Recovery Policies

- **Generation Failures:** Any server-side or provider failure before producing usable video results in an automatic, idempotent release/refund of reserved credits.
- **Duplicate Prevention:** Retried webhook deliveries or capture confirmations must never result in duplicate balance credits or redundant jobs.
- **Storage Limits:** If client IndexedDB quota is exceeded, the application bypasses local caching and triggers direct browser downloads.

### 4.3 Workspace Persistence & Tab Concurrency

- **Single Workspace Model:** Exactly one active workspace per browser origin/profile.
- **Autosave Engine:** Debounced persistence to IndexedDB on user actions, with flushes triggered on visibility state transitions (`visibilitychange` / page hide). UI surfaces status indicators: `Saving`, `Saved`, or `Storage Error`.
- **Concurrency Control:**
  - Active tab requests an exclusive lock using the Web Locks API (`navigator.locks.request`) and coordinates via `BroadcastChannel`.
  - Secondary tabs detect the lock and enter read-only mode, displaying: _"Your collage is open in another tab. Return there or [Edit Here]."_
  - Clicking "Edit Here" initiates a cooperative takeover: primary tab flushes pending state and releases the lock; secondary tab acquires the lock and loads fresh state.
  - Handle tab crashes and stale message timeouts without allowing concurrent writers. Use a safe read-only fallback if locks are unsupported; the former editing tab becomes read-only after takeover.
- **Backup Mechanism:** Includes an optional "Download Project Backup" action exporting a ZIP containing `workspace.json` and asset blobs.

---

## 5. Composition & Rendering Specifications

### Coordinate System & Logical Canvas

- **Units:** Fixed canonical logical units (not CSS viewport pixels).
- **Global Dimensions:** For slide width $W$, slide height $H$, and slide count $N$:
  $$\text{Global Canvas Width} = N \times W, \quad \text{Global Canvas Height} = H$$
- **Slide Extraction Rectangles:** Slide index $i \in [0, N-1]$ corresponds strictly to logical crop box:
  $$\text{CropBox}_i = [i \times W, \, 0, \, W, \, H]$$
- **Asset Immutability:** Original uploaded image blobs remain immutable. Transformations (scale, translation, rotation, crop window) apply exclusively to Layer instances.

### Bento Grid Mode Rules

- Structured on an underlying unit grid with configurable gutters and optional border radius.
- Tiles span integer column and row intervals; select tiles deliberately span across slide seams ($x = i \times W$).
- **Shared Divider Manipulation:** Dragging a boundary divider resizes adjacent neighbor tiles proportionally, maintaining a 100% filled rectangular geometry without creating voids, overlapping layers, or triggering grid reflow.
- Resizing clamps to predefined minimum tile dimensions.
- Tile bounding frame and internal image crop are controlled independently.

### Scrapbook Mode Rules

- Freeform layers supporting independent translation, scaling, rotation ($\pm \theta$), z-index reordering, optional drop shadows, and border frames.
- Procedural auto-layout uses seeded random placement constrained by composition heuristics:
  - Subject visibility protection (avoid obscuring focal points).
  - Bounds enforcement (prevent elements from drifting mostly off-canvas).
  - Density balancing across slides to avoid clustering.

### Visual Seam Continuity Rules

- **Playback Synchronization Reality:** Instagram does **not** synchronize video playback timing between adjacent slides. Swiping introduces variable temporal offsets.
- **Seam Protection:**
  - Background elements spanning slide seams must remain completely static and visually aligned.
  - Dynamic AI video elements should ideally be placed away from seams or confined deeper within the tile frame.
  - If an animated photo crosses a seam, boundary masking must freeze the seam-crossing edge, or the system must default/warn that the tile remain static.
  - Every individual slide must function as a standalone aesthetic composition.

### Animation Processing Pipeline

- Subtle image-to-video processing applied as an internal texture/fill within a static tile bounding box.
- Optional ping-pong (forward-reverse) looping evaluation to prevent abrupt cut jumps.
- Tile boundaries, corner radii, borders, and shadows remain completely stable throughout playback.

---

## 6. Technical Architecture & Tech Stack

### System Architecture

```text
                  Browser / SvelteKit UI
            ┌────────────────────────────┐
            │ Quick Create + Canvas Editor│
            │ Workspace + Image Blobs    │
            │ IndexedDB (via 'idb')      │
            │ Client-Side Static Render  │
            │ WebCodecs Video Export     │
            └─────────────┬──────────────┘
                          │ (Paid AI Flow Only)
               Auth + Orders + Job Polling
                          │
              Cloudflare Workers (SvelteKit)
                   │              │
             PayPal API       Private R2
             (Sandbox)            │
                   │              │ (Presigned PUT/GET)
                   └── Convex ────┴────────┐
                       - Users             ▼
                       - Credit Ledger   AI Video Provider
                       - Job Records     (e.g., fal.ai)
```

### Component Stack

- Keep Svelte reactive state and one canonical local workspace; do not replicate the full canvas or media in Convex.
- Use Vercel only for a concrete Cloudflare incompatibility.
- Confirm provider delivery method and model availability before implementing the adapter.

| System Role                 | Selected Technology                        | Technical Notes                                                                       |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Web Framework & UI**      | **SvelteKit + TypeScript**                 | Tailwind CSS, shadcn-svelte; desktop-first editing, responsive mobile viewer          |
| **Hosting & Edge Compute**  | **Cloudflare Workers**                     | `@sveltejs/adapter-cloudflare`; compute strictly bounded (no long media processing)   |
| **Client Storage**          | **IndexedDB** (via `idb`)                  | Stores raw Blobs (`LocalAsset`) and single `Workspace` record. OPFS deferred          |
| **Canvas Manipulation**     | **Evaluate Konva.js** vs Native Canvas/SVG | _[Needs Validation]_ Must share identical data model with server/export renderers     |
| **Authentication**          | **WorkOS AuthKit** (Preferred) / Clerk     | _[Needs Validation with SvelteKit + Convex JWT]_; guest access for static flows       |
| **Backend State & DB**      | **Convex**                                 | Manages user entities, transactional credit ledger, PayPal order states, job queues   |
| **Temporary Media Storage** | **Cloudflare R2**                          | Private bucket, short-lived presigned URLs, CORS policy, 7-day lifecycle deletion     |
| **AI Video Generation**     | Managed API (e.g., **fal.ai**)             | _[Needs Validation on fidelity, cost, latency, subtle motion]_; asynchronous calls    |
| **Payment Gateway**         | **PayPal Orders v2 (Sandbox)**             | Server-side capture verification, webhook signature validation, idempotent ledger     |
| **Static Renderer**         | Client-side Canvas 2D                      | Deterministic rendering from logical canvas model; ZIP packaging                      |
| **Video Renderer**          | Browser **WebCodecs + OffscreenCanvas**    | _[Needs Validation]_; managed server-side rendering fallback for unsupported browsers |

_Architectural Constraint:_ Cloudflare Workers must never execute multi-minute video encoding tasks. Background tasks are orchestrated via Convex scheduler/actions and external provider webhooks.

---

## 7. Data Contracts & State Schemas

### Proposed TypeScript Data Models

```typescript
type LayoutMode = 'bento' | 'scrapbook';
type AspectPreset = 'portrait_4_5' | 'square_1_1' | 'landscape_1_91_1';
type AnimationKind = 'none' | 'ai_subtle' | 'ken_burns';

interface Workspace {
  schemaVersion: 1;
  id: string; // Stable UUID for local workspace
  updatedAt: number;
  layoutMode: LayoutMode;
  format: {
    aspect: AspectPreset;
    slideCount: 2 | 3 | 4 | 5;
    slideWidth: number;
    slideHeight: number;
  };
  templateId?: string;
  layers: Layer[];
}

interface Layer {
  id: string;
  assetId: string; // Foreign key referencing LocalAsset.id
  x: number; // Logical canvas coordinates
  y: number;
  width: number;
  height: number;
  rotation: number; // Degrees
  zIndex: number;
  crop: {
    x: number; // Normalized coordinates (0.0 to 1.0)
    y: number;
    width: number;
    height: number;
  };
  style?: {
    borderRadius?: number;
    borderWidth?: number;
    shadow?: boolean;
  };
  animation: {
    kind: AnimationKind;
    generatedAssetId?: string;
    intensity?: number;
    durationSeconds?: number;
  };
  gridRect?: {
    col: number;
    row: number;
    colSpan: number;
    rowSpan: number;
  };
}

interface LocalAsset {
  id: string;
  mimeType: string;
  originalBlob: Blob; // Persisted in IndexedDB assets store
  thumbnailBlob?: Blob;
  width: number;
  height: number;
  kind: 'image' | 'generated_video';
}
```

### Storage Stores & Database Collections

#### Client IndexedDB Stores

- `workspace`: Contains one workspace record.
- `assets`: Keyed by `id` storing `LocalAsset` records with raw `Blob` values.
- `exportCache` _(Optional)_: Ephemeral store for exported images/videos.
- Add versioned migrations; persist blobs rather than object URLs and recreate URLs on load. Saves must be transactional or version-checked to prevent layer/asset mismatches.

#### Convex Collections

- `users`: User profile, authentication linkage, and active status.
- `creditLedger`: Transactional ledger records tracking credit grants, reservations, deductions, and refunds.
- `paypalOrders`: PayPal capture IDs, order IDs, payment status, amounts, and webhook receipt tracking.
- `animationJobs`: Tracks AI generation jobs, provider IDs, target asset IDs, and lifecycle states.
- `webhookEvents` _(Optional)_: Webhook event records.
- `temporaryAssets` _(Optional)_: Tracks R2 object keys and scheduled expiry timestamps.

### Suggested AI Job Lifecycle State Machine

```text
[created]
    │
    ▼
[awaiting_upload]
    │
    ▼
[queued]
    │
    ▼
[generating] ───────► [failed] (Triggers credit refund/release)
    │
    ▼
[generated]
    │
    ▼
[ready_for_download]
    │
    ▼
[completed]
```

_Terminal States:_ `completed`, `failed`, `expired`, `cancelled`. Define credit policies for terminal outcomes; provider work may not be cancellable once started.

### Transactional & Payment Invariants

1. Credit package pricing and credit amounts are defined on the server; never accepted from client payloads.
2. Order verification requires server-to-server validation of PayPal capture status, currency, and amount.
3. Every PayPal capture ID is recorded and can credit user balances exactly once.
4. Each unique generation request reserves credits atomically; failed jobs release the reservation.
5. Webhook signatures must be cryptographically verified; out-of-order or duplicate webhook events must execute idempotently.
6. Multi-tenant security enforces that users cannot query, access, or manipulate jobs or R2 storage keys belonging to other accounts.

---

## 8. Client Storage, Eviction & Privacy

- **Quota Monitoring:** Query `navigator.storage.estimate()` to inspect storage usage and quota limits. Attempt `navigator.storage.persist()` on supported browsers. Gracefully catch and handle `QuotaExceededError`.
- **Eviction Caveats:** Browser IndexedDB storage is inherently ephemeral (subject to OS cleanup, Safari eviction, or private browsing restrictions). UI must explicitly communicate that browser storage is not a permanent backup.
- **Resource Hygiene:** Free object URLs (`URL.revokeObjectURL`) and temporary canvas render buffers immediately following export generation.
- **Data Privacy & Retention:**
  - Disclose provider processing; upload only needed images, limit file types/sizes, and offer temporary data deletion.
  - Retain server-side AI job metadata and credit history separately from expiring cloud media.
  - Local source photos remain exclusively on device unless explicitly submitted for AI processing.
  - Uploads to R2 use private endpoints and presigned URLs.
  - Ephemeral assets stored in Cloudflare R2 are scheduled for automatic hard deletion on a documented schedule (proposed: **7 days**).

---

## 9. Rendering Pipeline & Technical Spikes

### Static Slicing Pipeline (Phase 1 Priority)

- Unified deterministic 2D Canvas renderer consumes `Workspace` schema and referenced `LocalAsset` blobs.
- Iterates across slide indices $i \in [0, N-1]$, clipping the viewport to $[i \times W, 0, W, H]$ and outputting discrete high-resolution PNG or JPEG blobs.
- Enforces proper EXIF rotation handling and normalized image crop boundaries.

### Video Compositing Pipeline & Technical Spike

- Feature-detect codec and encoder support. Record encoding time, memory, codec, frame rate, and upload/download behavior.
- **Spike Requirement:** Prototype client-side video composition using Canvas/OffscreenCanvas, frame sampling, and WebCodecs (`VideoEncoder`).
- **Container Requirement:** WebCodecs provides raw encoded frames; integration with an MP4 multiplexer library (e.g., `mp4-muxer`) is required.
- **Cross-Browser Verification Matrix:** Must test desktop Chrome, desktop Safari, mobile Safari (iOS), and mobile Chrome (Android).
- **Fallback Architecture:** If mobile Safari or client hardware fails WebCodecs capability checks or experiences memory exhaustion, the client sends the identical `Workspace` JSON payload to an external managed rendering service for server-side MP4 generation.

---

## 10. User Experience & Screen Specifications

- **Quick Create Screen:** Format selection (aspect, slide count, style), drag-and-drop ingestion zone, photo counter with minimum requirement indicators, "Create My Collage" CTA.
- **Preview Screen:** Interactive swipeable carousel mimicking Instagram UI, "View Full Collage" wide-canvas toggle, primary actions (**Customize**, **Shuffle**, **Download Images**, **Bring to Life**).
- **Editor Canvas:** Wide-aspect canvas viewport, persistent vertical slide seam indicators, layer drag/scale/rotate handles, Bento divider split handles, image crop modal, z-index controls, undo/redo stack, autosave status badge.
- **Animation Modal / Panel:** Selected photo preview, quoted credit cost, auth/checkout prompts, progress bar with realistic status messaging, video preview comparison, and "Download Videos" action.
- **Errors to handle:** Too few photos, invalid/oversized or unsupported HEIC files, low resolution, empty/crowded layouts, storage full, deleted referenced assets, failed R2 uploads, unusable AI output, canceled PayPal checkout, duplicate webhooks, unsupported WebCodecs, closed mobile tabs, tab takeover, and auth return.
- **Accessibility (a11y):** Keyboard-navigable UI focus states, descriptive `aria-label` tags on canvas manipulation controls, and strict compliance with `prefers-reduced-motion` for editor UI animations (without altering exported content).

---

## 11. Acceptance Criteria Checklist

### Must-Pass Free Static Editor

- [ ] User can launch app without logging in and configure layout mode, aspect ratio, and 2–5 slide count.
- [ ] Ingestion handles mixed portrait, landscape, and square photos without image stretching or EXIF orientation distortion.
- [ ] Minimum photo restriction ($\ge 1$ photo per slide) is enforced with clear UI messaging blocking layout creation until met.
- [ ] Bento Grid and Scrapbook modes each generate coherent initial layouts; "Shuffle Layout" generates distinct usable variations.
- [ ] Shared global canvas accurately renders across slides; exported PNG/JPEG slides exactly match the preview boundaries and seams.
- [ ] Bento divider dragging resizes adjacent neighbor cells without leaving unmapped gaps or overlapping boundaries; photo crop remains an independent control.
- [ ] Scrapbook editor supports move, scale, rotate, z-index reordering, and undo/redo operations.
- [ ] Single workspace automatically persists across page reloads via IndexedDB without showing recovery popups.
- [ ] Secondary browser tabs enter read-only mode and execute cooperative lock handover upon clicking "Edit Here".
- [ ] Users can download separate static slide images without creating an account or paying.

### Must-Pass AI & PayPal Integration

- [ ] Guest user can authenticate without losing or corrupting their active in-memory/local workspace.
- [ ] PayPal Sandbox checkout executes successfully, verifies server-side, and updates credit ledger.
- [ ] Replaying a PayPal capture ID or webhook notification does not result in duplicate credit allocations.
- [ ] AI motion flow quotes upfront credit costs, atomically reserves credits, and avoids duplicate deduction on retries.
- [ ] System successfully generates a subtle motion video clip from at least one uploaded photo tile.
- [ ] Job state persists in Convex; user can close browser and retrieve completed generation within the recovery window.
- [ ] Failed AI generation triggers an automatic release/refund of reserved credits.
- [ ] Output provides downloadable separate slide MP4 clips with identical durations, matched pixel dimensions, and static seam lines.
- [ ] Media assets in R2 remain strictly private and expire on the documented retention schedule (proposed: 7 days).

### Hackathon Submission & Demo Deliverables

- [ ] Functional hosted application URL or documented local setup instructions in repository.
- [ ] Public code repository on GitHub/GitLab/Bitbucket containing all source code, assets, and an open-source license visible in the About section.
- [ ] Under-3-minute demonstration video uploaded to YouTube demonstrating end-to-end free creation, PayPal Sandbox checkout, and MP4 generation.
- [ ] Sandbox test credentials and documentation provided for hackathon judges; state rate limits and known limitations.
- [ ] README includes setup steps; no secrets committed.

---

## 12. Implementation Plan & Delivery Milestones

```text
Gate 0: 1-Day Feasibility Spikes
  ├── AI Video Generation Fidelity & Cost (fal.ai / alternative)
  ├── Browser MP4 Export (WebCodecs + Muxer vs Managed Fallback)
  └── SvelteKit + WorkOS AuthKit + Convex Token Integration
        │
Milestone 1: Core Free Utility (SvelteKit, Layout Engine, Static PNG Export)
        │
Milestone 2: Interactive Editing & Local Persistence (IndexedDB, Web Locks, Undo/Redo)
        │
Milestone 3: Cloud Infrastructure & Payments (Convex, PayPal Sandbox, R2, Auth)
        │
Milestone 4: AI Animation Pipeline & Video Compositing (Provider Jobs, MP4 Export)
        │
Milestone 5: Polish, QA Testing & Submission Readiness (Demo Video, Docs, Public Repo)
```

### Scope Reduction Priority (Cut Order if Constrained)

1. Drop image-aware automated heuristic layout suggestions $\rightarrow$ fallback to static predefined templates.
2. Reduce the quantity of starter Bento templates.
3. Drop custom Bento divider dragging $\rightarrow$ maintain fixed grid cells with swap and crop controls.
4. Eliminate animation variety $\rightarrow$ support a single subtle motion style.
5. Replace client-side WebCodecs MP4 encoding entirely with a cloud-managed rendering fallback.

If necessary, reduce to 3-slide portrait mode with fixed Bento and Scrapbook presets.

_Non-Negotiable Requirement:_ The complete end-to-end loop (Free Collage Creation $\rightarrow$ PayPal Sandbox Checkout $\rightarrow$ AI Motion Generation $\rightarrow$ MP4 Slide Export) must remain intact.

---

## 13. Open Technical Decisions & Uncertainties

The following items are unresolved in the source draft and require empirical validation:

1. **Canvas Abstraction Engine:** Determine whether Konva.js integrates cleanly with SvelteKit reactivity and static/video export requirements, or if a lightweight custom Canvas/SVG renderer is preferable.
2. **Client-Side MP4 Export Feasibility:** Validate whether WebCodecs + `mp4-muxer` functions reliably across desktop and mobile Safari, and establish the cost profile of a cloud video-rendering fallback service.
3. **AI Video Provider Selection:** Test at least two candidate models (e.g., via fal.ai) using 3–5 representative benchmark photos to measure subject fidelity, boundary stability, loop artifacts, latency, and per-generation API cost.
4. **Credit Unit Economics:** Final package pricing, free trial credits, and generation costs remain undefined pending actual AI provider cost benchmarks.
5. **Authentication Provider Compatibility:** Validate WorkOS AuthKit JWT integration with SvelteKit and Convex; switch to Clerk if integration friction threatens milestone velocity.
6. **Layout Intelligence:** Confirm whether procedural layout rules suffice, or if an LLM-based layout director adds tangible value without introducing latency or cost.
7. **Project Backup Interchange Format:** Standardize the JSON structure and asset serialization format for ZIP project backups if time permits implementation.
8. **Real-World Asset Limits:** Empirically establish client-side memory limits and upload file size caps across target mobile and desktop hardware.
9. **Production Payment Compliance:** Acknowledge that PayPal Sandbox meets hackathon criteria, but production deployment requires resolving merchant eligibility and cross-border currency handling (specifically regarding Indian merchant regulations).

---

## 14. Source Reference Links (Draft Reports Checked 28 October 2026)

- **PayPal AI Hackathon Rules & Requirements:** https://paypalaihackathon.devpost.com/rules
- **Cloudflare SvelteKit Deployment on Workers:** https://developers.cloudflare.com/workers/framework-guides/web-apps/sveltekit/
- **Convex Svelte Client Documentation:** https://docs.convex.dev/client/svelte/overview
- **Convex Svelte Authentication Setup:** https://docs.convex.dev/client/svelte/authentication
- **Cloudflare R2 Presigned S3 URLs:** https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- **PayPal Checkout Server Integration (Orders v2):** https://developer.paypal.com/studio/checkout/standard/integrate
- **PayPal Webhooks API & Signature Verification:** https://developer.paypal.com/api/rest/webhooks/rest/
- **MDN Storage Quotas and Eviction Criteria:** https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- **MDN Web Locks API:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- **MDN BroadcastChannel API:** https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
- **MDN WebCodecs VideoEncoder API:** https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder
