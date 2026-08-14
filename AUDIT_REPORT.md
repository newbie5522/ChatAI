# AUDIT REPORT

Date: 2026-08-14
Project: Next.js 14 gateway proxy application (`/home/runner/work/ChatAI/ChatAI`)

## Executive summary

This audit reviewed the requested API routes, client adapters, stores, components, build config, and tests, plus a small set of directly referenced support modules (`app/config/account-auth.ts`, `app/config/admin-auth.ts`, `app/config/admin-store.ts`, `app/config/usage.ts`) where they materially affect the audited behavior.

### Overall assessment

The codebase has good breadth of provider support and some solid defensive pieces (for example: provider allowlisting in `app/api/gateway/[provider]/[[...path]]/route.ts`, response-header cleanup in gateway adapters, and safe markdown rendering without `rehypeRaw`).

The biggest risks are architectural and perimeter-related:
- **A critical unauthenticated generic proxy/SSRF path exists** and can also **spend the server's OpenAI key**.
- **The artifacts endpoint is an unauthenticated server-credentialed Cloudflare KV proxy**.
- **Global wildcard CORS** makes proxy-style endpoints easier to abuse from browsers.
- **File-backed JSON persistence** is unsafe under concurrent or multi-instance deployment.

## Findings

### Security

#### 1. [Critical][P0] Unauthenticated generic proxy allows SSRF and server-key abuse
**Evidence**
- `app/api/[provider]/[...path]/route.ts:18-40` routes every unrecognized provider to `proxyHandler`.
- `app/api/proxy.ts:20-29` deletes a couple of query params, then builds `fetchUrl` directly from `x-base-url` and the user-controlled path.
- `app/api/proxy.ts:30-42` forwards most non-hop-by-hop headers to the attacker-selected upstream.
- `app/api/proxy.ts:44-52` injects the server-side OpenAI API key whenever `x-base-url` contains `api.openai.com`.
- `app/store/plugin.ts:55-60` and `app/store/plugin.ts:71-77` show the client can set `X-Base-URL` from plugin-controlled OpenAPI server metadata and route requests through `/api/proxy`.

**Impact**
- Any unauthenticated caller can make the server fetch arbitrary URLs.
- Attackers can pivot to internal services/metadata endpoints if reachable from the runtime.
- Attackers can also force the server to proxy requests to `api.openai.com` using the server-owned key, turning the app into a billable public relay.

**Remediation**
- Remove the header-driven generic proxy entirely, or restrict it to a strict server-side allowlist.
- Never accept upstream base URLs from client headers.
- Never inject server API keys into requests derived from unauthenticated/user-controlled routing.
- If plugin proxying is required, store vetted upstream definitions server-side and address them by ID.

#### 2. [High][P1] `/api/artifacts` is an unauthenticated Cloudflare KV write/read proxy
**Evidence**
- `app/api/artifacts/route.ts:7-11` builds Cloudflare Authorization headers from server config.
- `app/api/artifacts/route.ts:12-39` accepts arbitrary POST bodies and stores them with server credentials.
- `app/api/artifacts/route.ts:52-62` serves arbitrary stored objects by caller-supplied `id`.

**Impact**
- Anyone can use the application's Cloudflare account/namespace as a storage backend.
- This can consume quota/storage and host untrusted content at the server's expense.
- Stored object IDs are deterministic MD5 hashes of content (`app/api/artifacts/route.ts:13-22`), which weakens privacy for known/predictable payloads.

**Remediation**
- Require authentication and authorization.
- Use unguessable IDs instead of raw content hashes.
- Enforce size/type limits and per-user quotas.
- Consider signed upload/download tokens instead of directly exposing the storage proxy.

#### 3. [High][P1] Global wildcard CORS policy is too broad for sensitive API routes
**Evidence**
- `next.config.mjs:38-63` applies `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Methods: *`, and `Access-Control-Allow-Headers: *` to **all** `/api/:path*` routes.

**Impact**
- Open proxy-style endpoints become much easier to abuse from browsers.
- The policy is inconsistent (`*` with credentials) and too coarse for mixed-sensitivity APIs.
- It increases the blast radius of the SSRF/proxy findings above.

**Remediation**
- Remove the global `/api/*` CORS blanket.
- Apply route-specific CORS only where needed.
- Use an explicit origin allowlist and only send `Access-Control-Allow-Credentials` for trusted origins.

#### 4. [Medium][P1] WebDAV proxy path handling is suffix-based and not canonicalized
**Evidence**
- `app/api/webdav/[...path]/route.ts:65-124` concatenates `endpoint` and `params.path.join("/")`, then authorizes by `endsWith(folder)` / `endsWith(fileName)`.
- No normalization or rejection of `..`, encoded separators, or canonical path comparison is performed before forwarding.

**Impact**
- Path traversal or path-confusion payloads can potentially bypass the intended “only backup folder / backup file” restriction depending on upstream WebDAV path normalization.

**Remediation**
- Reject `.` / `..` / encoded slash patterns in path segments.
- Build paths from validated segments, not raw joined strings.
- Canonicalize before policy checks and compare against exact allowed resource paths.

#### 5. [Medium][P1] Authentication endpoints have no visible rate limiting or lockout controls
**Evidence**
- `app/api/account/login/route.ts:23-67` performs username/password login with no throttling.
- `app/api/employee-auth/route.ts:19-63` validates access keys with no throttling.
- `app/api/admin/[[...path]]/route.ts:178-199` performs legacy admin password login with no throttling.

**Impact**
- Online brute-force and credential-stuffing resistance is weak.

**Remediation**
- Add IP/account-based rate limits, exponential backoff, and lockout/alerting.
- Log failed attempts with safe metadata only.

#### 6. [Low][P2] `/api/config` exposes internal model catalog/policy metadata to unauthenticated clients
**Evidence**
- `app/api/config/route.ts:5-18` returns `customModels`, `defaultModel`, `visionModels`, and multiple server policy flags.
- `app/api/config/route.ts:25-30` serves the same payload on both GET and POST without authentication.

**Impact**
- This reveals internal model inventory and deployment/policy choices to any caller.

**Remediation**
- Return only the minimum client bootstrap fields.
- Gate company-internal model metadata behind authenticated session checks where feasible.

#### 7. [Low][P2] Session-token signing falls back to the admin password instead of a dedicated secret
**Evidence**
- `app/config/account-auth.ts:20-24` uses `ADMIN_SECRET` or falls back to `ADMIN_PASSWORD`.
- `app/config/admin-auth.ts:19-21` does the same for legacy admin tokens.

**Impact**
- Secret separation is reduced; password quality/rotation now directly affects token integrity.

**Remediation**
- Require a dedicated high-entropy session secret.
- Refuse to boot session auth when the dedicated secret is missing.

### Code Quality

#### 8. [Medium][P2] Extensive `any`/`@ts-ignore` use weakens type safety in critical flows
**Evidence (representative, not exhaustive)**
- `app/client/platforms/openai.ts:160`, `app/client/platforms/openai.ts:246`, `app/client/platforms/openai.ts:457-459`
- `app/client/platforms/google.ts:71-72`, `app/client/platforms/google.ts:135`, `app/client/platforms/google.ts:160`, `app/client/platforms/google.ts:188`, `app/client/platforms/google.ts:341-343`
- `app/client/platforms/anthropic.ts:93`, `app/client/platforms/anthropic.ts:142`, `app/client/platforms/anthropic.ts:301-304`
- `app/store/sd.ts:31-40`, `app/store/sd.ts:58`, `app/store/sd.ts:65`, `app/store/sd.ts:137-150`
- `app/store/config.ts:64`, `app/store/config.ts:261-263`, `app/store/config.ts:329`

**Impact**
- Weakens the value of `"strict": true` in `tsconfig.json:7`.
- Makes provider-specific streaming/tool-call bugs easier to ship silently.

**Remediation**
- Define shared typed DTOs for streaming chunks, tool calls, and provider responses.
- Replace `any` with `unknown` + narrowers where full typing is impractical.
- Eliminate `@ts-ignore` in adapter hot paths.

#### 9. [Low][P2] Dead/unfinished code and naming inconsistencies remain in production paths
**Evidence**
- `app/client/api.ts:114-133` defines unused `ProviderName`, `Model`, and `ChatProvider` types/interfaces.
- `app/client/api.ts:180-184` contains empty `config()`, `prompts()`, and `masks()` methods.
- `app/store/chat.ts:316-319` and `app/store/chat.ts:998-999` contain TODOs in active logic.
- `app/components/chat.tsx:2019-2020` contains a TODO beside message filtering.
- `app/client/platforms/google.ts:370` contains a TODO in tool-response shaping.
- `test/model-available.test.ts:56-67` contains a FIXME with the test commented out.
- Naming is inconsistent between provider identifiers such as `"xAI"`, `ServiceProvider.XAI`, `provider.id === "xai"`, and `COMPANY_API_PATH.XAI` (`app/client/api.ts:360-370`, `app/client/platforms/company-openai-compatible.ts:22-35`).

**Impact**
- Increases maintenance cost and creates room for subtle provider-selection bugs.

**Remediation**
- Delete unused abstractions.
- Resolve or ticket TODO/FIXME items with owners and due dates.
- Normalize provider naming through a single enum/value map.

#### 10. [Low][P2] Error handling is inconsistent across proxy/adaptor routes
**Evidence**
- `app/api/gateway/adapters/openai-compatible-video.ts:128-132` parses JSON without a local validation guard; malformed input becomes a generic 502 later.
- `app/api/upstash/[action]/[...key]/route.ts:15` uses `new URL(endpoint)` inline in a condition; malformed input will throw before a clean JSON error is returned.
- `app/api/gateway/[provider]/[[...path]]/route.ts:562-570` logs only a generic gateway failure on adapter exceptions.

**Impact**
- Callers get less actionable errors, and operators lose debugging detail.

**Remediation**
- Standardize request validation and bad-input responses (400/422).
- Preserve structured provider error details after safe redaction.

### Performance

#### 11. [Medium][P1] Video generation adapter holds a Node worker open for up to 6 minutes
**Evidence**
- `app/api/gateway/adapters/openai-compatible-video.ts:18-20` defines `MAX_POLLS = 120` and `POLL_INTERVAL_MS = 3000`.
- `app/api/gateway/adapters/openai-compatible-video.ts:183-223` performs synchronous polling inside the request lifecycle.

**Impact**
- Long-lived server requests increase runtime cost and reduce concurrency under load.
- This pattern is particularly risky on serverless/edge-adjacent infrastructure.

**Remediation**
- Return a job ID immediately and expose a separate polling/status endpoint.
- Prefer background jobs/webhooks/queue workers for long-running media generation.

#### 12. [Medium][P2] Chat UI is a large monolith with render-time work and an always-running scroll effect
**Evidence**
- `app/components/chat.tsx:1070-2518` contains message rendering, TTS, uploads, shortcuts, prompt hints, image preview, and realtime side panel logic in one component.
- `app/components/chat.tsx:471-475` runs an effect on every render and may call `scrollTo` repeatedly.
- `app/components/chat.tsx:1838-1913` adds a document-level keyboard listener inside the main chat component.

**Impact**
- Higher rerender cost, harder memoization boundaries, and more UI jank as chat history/features grow.

**Remediation**
- Split `_Chat` into smaller memoized subcomponents/hooks.
- Add a dependency array to the auto-scroll effect and trigger it only on relevant state changes.
- Consider list virtualization for long histories.

#### 13. [Medium][P2] Sync path double-fetches remote state and rewrites whole documents
**Evidence**
- `app/store/sync.ts:98-108` calls `client.get(config.username)` twice during one sync.
- `app/store/sync.ts:117` writes back the entire serialized app state after merge.

**Impact**
- Doubles latency for remote sync and increases inconsistency windows.
- Whole-document rewrites are more conflict-prone and expensive than versioned/patch approaches.

**Remediation**
- Fetch once, reuse the parsed result, and attach version/etag metadata.
- Prefer conflict-aware merge/version checks before overwriting remote state.

#### 14. [Low][P2] Build config can deliberately collapse output into a single chunk
**Evidence**
- `next.config.mjs:17-20` enables `LimitChunkCountPlugin({ maxChunks: 1 })` when `DISABLE_CHUNK` is set or export mode is used.

**Impact**
- Increases bundle size and startup cost when enabled.

**Remediation**
- Keep chunk collapsing limited to deployment modes that truly require it.
- Measure bundle impact before enabling it broadly.

### Architecture

#### 15. [High][P1] File-backed JSON persistence is unsafe for concurrent or scaled deployment
**Evidence**
- `app/config/admin-store.ts:439-458` performs read/normalize/write on a local JSON file with no locking/version check.
- `app/config/usage.ts:92`, `app/config/usage.ts:155-185`, `app/config/usage.ts:188-204` use an in-process promise queue, but still read/write a local JSON file and only serialize within a single process.

**Impact**
- Concurrent writers across multiple Node processes/containers can lose updates.
- Ephemeral filesystems or multi-instance deployments can diverge or lose admin/usage state entirely.

**Remediation**
- Move admin/usage state to a transactional database or managed KV/document store.
- If migration is staged, add optimistic versioning and distributed locking around writes.

#### 16. [Medium][P2] Provider adapters duplicate path construction, SSE parsing, and tool-call stitching
**Evidence**
- `app/client/platforms/openai.ts:377-473`
- `app/client/platforms/deepseek.ts:148-238`
- `app/client/platforms/xai.ts:119-179`
- `app/client/platforms/alibaba.ts:167-261`
- `app/client/platforms/glm.ts:217-276`
- `app/client/platforms/google.ts:299-379`
- `app/client/platforms/anthropic.ts:219-340`
- `app/client/platforms/company-openai-compatible.ts:219-239`

**Impact**
- Bugs and security fixes must be patched in many places.
- Behavior already diverges subtly (`stream` vs `streamWithThink`, different tool-call accumulation rules, different error handling).

**Remediation**
- Extract a shared adapter framework for:
  - path normalization
  - timeout handling
  - SSE parsing
  - tool-call accumulation
  - error redaction

#### 17. [Medium][P2] Test coverage does not meaningfully exercise the audited server and UI surfaces
**Evidence**
- `test/sum-module.test.ts:1-9` is a trivial placeholder.
- `test/model-available.test.ts:1-80`, `test/model-provider.test.ts:1-31`, and `test/vision-model-checker.test.ts:1-68` cover utility logic only.
- No tests were found for `app/api/gateway/*`, `app/api/proxy.ts`, `app/api/webdav/*`, `app/api/admin/*`, `app/components/chat.tsx`, `app/components/markdown.tsx`, or the store synchronization flows.

**Impact**
- Highest-risk code paths (proxying, auth, storage, streaming adapters) are effectively unguarded by regression tests.

**Remediation**
- Add focused route tests for proxy/auth/storage policy.
- Add adapter contract tests for streaming/tool-call parsing.
- Add component/store tests for chat upload and sync flows.

#### 18. [Low][P2] File-size hotspots indicate boundary erosion
**Evidence**
- `app/components/chat.tsx:1-2518`
- `app/store/chat.ts:1-1134`
- `app/api/admin/[[...path]]/route.ts:1-759`
- `app/client/platforms/openai.ts:1-604`
- `app/api/gateway/[provider]/[[...path]]/route.ts:1-577`

**Impact**
- Large mixed-responsibility files are harder to review, optimize, and test.

**Remediation**
- Split files by responsibility (routing/auth/service layer, rendering/actions/hooks, provider protocol vs transport).
- Use size thresholds/code ownership rules to prevent continued growth.

## Notable positive observations

- `app/components/markdown.tsx:275-315` uses `react-markdown` without `rehypeRaw`/`dangerouslySetInnerHTML`, which materially reduces direct markdown-to-XSS risk.
- Gateway adapters consistently strip `www-authenticate`, `content-encoding`, and `OpenAI-Organization` in `app/api/gateway/adapters/types.ts:26-32`.
- Account/admin cookies are `httpOnly` and `sameSite: "lax"` in `app/config/account-auth.ts:135-152` and `app/config/admin-auth.ts:113-130`.

## Priority summary

### P0
- Remove or heavily restrict the unauthenticated generic proxy / SSRF path.

### P1
- Protect `/api/artifacts` with auth/quotas.
- Replace global wildcard API CORS with route-specific policy.
- Add brute-force protection to login/access-key endpoints.
- Fix WebDAV path canonicalization.
- Replace file-backed admin/usage persistence for concurrent/scaled deployments.
- Make video generation asynchronous.

### P2
- Reduce `any`/`@ts-ignore` usage.
- Remove dead code/TODO/FIXME debt.
- Refactor monolithic files and duplicated adapters.
- Improve sync efficiency/conflict handling.
- Expand tests over the audited surfaces.
