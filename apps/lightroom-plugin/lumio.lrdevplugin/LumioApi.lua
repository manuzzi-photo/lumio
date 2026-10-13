--[[
    LumioApi.lua

    HTTP wrapper for the Lumio plug-in API. Reads host + token from the
    plug-in preferences, builds the Authorization header, parses JSON.

    All methods must run from an LrTask (LrHttp does not block the UI
    thread, but it is asynchronous -- Lightroom SDK convention).

    Read side (Selection-Import into LR):
      testConnection, listGalleries, getSelection

    Write side (Publish-Service: LR -> Lumio):
      createGallery, patchGallery, listGalleryFiles, deleteGalleryFile,
      getUploadPolicy, initUpload, completeUpload, resignUpload,
      uploadFileToS3 (single PUT), uploadFileMultipart (files > 100 MB)
]]

local LrHttp           = import "LrHttp"
local LrTasks          = import "LrTasks"
local LrPrefs          = import "LrPrefs"
local LrPathUtils      = import "LrPathUtils"
local LrFileUtils      = import "LrFileUtils"

local json   = require "Json"
local log    = require "Logger"

local M = {}

local prefs = LrPrefs.prefsForPlugin()

-- Read host + token from prefs, strip a trailing slash just in case
local function getBase()
    local host = (prefs.host or ""):gsub("/+$", "")
    if host == "" then
        error("Lumio: please configure the host in the plug-in options")
    end
    return host
end

local function getToken()
    local token = prefs.token or ""
    if token == "" then
        error("Lumio: please configure the API token in the plug-in options")
    end
    return token
end

-- RETRY.
-- Before: a single HTTP 429 failed the call permanently. Observed in real use
-- (Lumio.log 14:15:45): at the end of a 23-photo batch the PATCH status=live
-- got a 429 and the gallery stayed a draft. The rate limit is 300/min and is
-- SHARED with the browser.
-- Now: 429, transient 5xx and network errors are retried with delays of
-- 5/15/45 s (four attempts in total), honouring the Retry-After header.
local RETRY_DELAYS   = { 5, 15, 45 }
local MAX_DELAY      = 30   -- cap for a single wait, including Retry-After
local MAX_TOTAL_WAIT = 90   -- total budget per call
local MAX_NET_RETRIES = 1   -- a network error is often PERMANENT (wrong host) -> only 1 retry

-- Explicit timeouts (seconds) for the S3 PUTs. The SDK documents neither a
-- default nor whether the value covers the whole transfer or each phase of
-- it, so we set generous values ourselves: a 100 MB single PUT on a slow
-- uplink, resp. one 8 MiB multipart part.
local PUT_TIMEOUT_SINGLE = 600
local PUT_TIMEOUT_PART   = 180

-- A caller can set this so that long waits are interrupted by a cancellation.
-- Without it LrTasks.sleep does not react to the Cancel button at all.
M.isCanceled = nil

local function interruptibleSleep(seconds)
    local slept = 0
    while slept < seconds do
        if M.isCanceled and M.isCanceled() then
            error("Lumio: canceled")
        end
        local step = math.min(1, seconds - slept)
        LrTasks.sleep(step)
        slept = slept + step
    end
end

local function retryAfterSeconds(responseHeaders, fallback)
    for _, h in ipairs(responseHeaders or {}) do
        if h.field and tostring(h.field):lower() == "retry-after" then
            local n = tonumber(h.value)  -- HTTP date format -> nil -> fallback
            if n and n > 0 then return math.min(n, MAX_DELAY) end
        end
    end
    return math.min(fallback, MAX_DELAY)
end

local function httpDispatch(method, url, headers, body)
    if method == "GET" then
        return LrHttp.get(url, headers)
    elseif method == "POST" then
        table.insert(headers, { field = "Content-Type", value = "application/json" })
        return LrHttp.post(url, body and json.encode(body) or "", headers)
    elseif method == "PATCH" then
        table.insert(headers, { field = "Content-Type", value = "application/json" })
        return LrHttp.post(url, body and json.encode(body) or "", headers, "PATCH")
    elseif method == "DELETE" then
        return LrHttp.post(url, "", headers, "DELETE")
    else
        error("unsupported method: " .. method)
    end
end

-- Turns an HTTP error response into one readable line. The Lumio API answers
-- limit violations (413 file_too_large, 415 file_type_not_allowed, 402 storage
-- plan) with a JSON body carrying a human-readable "message"; showing that
-- beats dumping raw JSON into a dialog. Anything else keeps the plain form.
local function describeHttpError(status, responseBody)
    local raw = responseBody or ""
    local okParse, parsed = pcall(json.decode, raw)
    if okParse and type(parsed) == "table"
        and type(parsed.message) == "string" and parsed.message ~= "" then
        return parsed.message .. " (HTTP " .. tostring(status) .. ")"
    end
    return "HTTP " .. tostring(status) .. " " .. raw:sub(1, 200)
end

-- Low-level request. Returns body + status, throws on an auth error.
--
-- opts (optional):
--   headers    = { { field = ..., value = ... }, ... }  extra request headers
--   idempotent = true  the server tolerates a repeated call (see below), so a
--                      POST may be retried after a network error as well
function M.request(method, path, body, opts)
    opts = opts or {}
    local url = getBase() .. "/api/v1" .. path
    log:info("HTTP " .. method .. " " .. url)

    -- POST IS NOT IDEMPOTENT. /uploads/init, /uploads/complete and
    -- /plugin/galleries change server state: if the response is lost to a
    -- network error, the request may still have been processed. A retry would
    -- create a second file row (stuck in 'uploading' forever) or an entirely
    -- second gallery. A 429 is safe for every method, because the rate limit
    -- rejects the request BEFORE the handler runs.
    -- Exception, via opts.idempotent: /uploads/complete (answers a repeat with
    -- the current status instead of acting twice) and /uploads/:id/resign
    -- (only signs URLs). Losing the response of /uploads/complete after
    -- uploading a 2 GB file would otherwise throw the whole upload away.
    local isPost = (method == "POST") and not opts.idempotent

    local responseBody, responseHeaders, status
    local totalWait, netRetries = 0, 0

    for attempt = 0, #RETRY_DELAYS do
        local headers = {
            { field = "Authorization", value = "Bearer " .. getToken() },
            { field = "Accept",        value = "application/json" },
        }
        for _, h in ipairs(opts.headers or {}) do
            table.insert(headers, h)
        end
        responseBody, responseHeaders = httpDispatch(method, url, headers, body)

        -- LrHttp signals a network error in responseHeaders.error, NOT as an exception
        local netErr = responseHeaders and responseHeaders.error
        status = responseHeaders and tonumber(responseHeaders.status) or nil
        local isNetworkFailure = (not responseHeaders) or netErr or (status == nil)

        local retryable
        if status == 429 then
            retryable = true
        elseif isPost then
            retryable = false
        elseif isNetworkFailure then
            retryable = (netRetries < MAX_NET_RETRIES)
            if retryable then netRetries = netRetries + 1 end
        else
            retryable = (status == 502 or status == 503 or status == 504)
        end

        if not retryable or attempt >= #RETRY_DELAYS then
            if isNetworkFailure then
                if netErr then
                    error("Lumio: connection failed: " ..
                        tostring(netErr.name or netErr.errorCode or "unknown network error"))
                end
                -- Was `responseHeaders.status or 0`, which let a response with no
                -- status pass as a "success" and silently returned nil.
                error("Lumio: server did not respond as expected (status code missing)")
            end
            break -- 4xx/5xx: handled below as a normal HTTP error
        end

        local delay = retryAfterSeconds(responseHeaders, RETRY_DELAYS[attempt + 1])
        if totalWait + delay > MAX_TOTAL_WAIT then
            log:warn("wait budget exhausted (" .. totalWait .. " s), no more attempts")
            break
        end
        totalWait = totalWait + delay
        log:warn(string.format("HTTP %s %s -> attempt %d/%d failed (%s), waiting %d s",
            method, path, attempt + 1, #RETRY_DELAYS + 1,
            netErr and "network error" or tostring(status), delay))
        interruptibleSleep(delay)
    end

    if not responseHeaders then
        error("Lumio: no response from server (is the host reachable?)")
    end
    if status == 401 then
        error("Lumio: API token invalid or expired")
    elseif status == 204 then
        return nil
    elseif status and status >= 400 then
        error("Lumio: " .. describeHttpError(status, responseBody))
    end

    if not responseBody or responseBody == "" then
        return nil
    end
    local ok, parsed = pcall(json.decode, responseBody)
    if not ok then
        error("Lumio: response is not valid JSON")
    end
    return parsed
end

-- "812 MB" / "2.5 GB" -- same units as the server's formatLimit(), so the
-- numbers in our own messages match the ones the server reports.
function M.formatBytes(n)
    n = tonumber(n) or 0
    local gib = 1024 * 1024 * 1024
    if n >= gib then
        local gb = n / gib
        -- Like formatLimit(): no decimal from 10 GB on ("10 GB", "2.5 GB").
        return string.format(gb >= 10 and "%.0f GB" or "%.1f GB", gb)
    end
    return string.format("%.0f MB", n / (1024 * 1024))
end

-- ============================================================================
-- Read side
-- ============================================================================

function M.testConnection()
    -- Throws on error, otherwise returns { ok = true, apiVersion = "1" }
    return M.request("GET", "/plugin/version")
end

function M.listGalleries()
    local res = M.request("GET", "/plugin/galleries")
    return (res and res.galleries) or {}
end

function M.getSelection(galleryId)
    return M.request("GET", "/plugin/galleries/" .. galleryId .. "/selection")
end

-- ============================================================================
-- Write side (Publish)
-- ============================================================================

function M.createGallery(title, mode, description)
    local res = M.request("POST", "/plugin/galleries", {
        title = title,
        mode = mode or "collaboration",
        description = description,
    })
    return res and res.gallery
end

function M.patchGallery(galleryId, fields)
    local res = M.request("PATCH", "/plugin/galleries/" .. galleryId, fields)
    return res and res.gallery
end

function M.listGalleryFiles(galleryId)
    local res = M.request("GET", "/plugin/galleries/" .. galleryId .. "/files")
    return (res and res.files) or {}
end

function M.deleteGalleryFile(galleryId, fileId)
    M.request(
        "DELETE",
        "/plugin/galleries/" .. galleryId .. "/files/" .. fileId
    )
end

-- ============================================================================
-- Chapters (Lumio "GallerySection")
-- ============================================================================
-- No plug-in-specific /plugin/... routes for these -- like /uploads/init
-- and /uploads/complete above, the generic Studio routes already accept
-- Bearer-token auth, so we call them directly (galleries.ts's Section-CRUD
-- block). Used by processRenderedPhotos/renamePublishedCollection/
-- deletePublishedCollection for a chapter (non-default) child collection.

function M.createSection(galleryId, title)
    local res = M.request("POST", "/galleries/" .. galleryId .. "/sections", { title = title })
    return res and res.section
end

function M.patchSection(galleryId, sectionId, fields)
    local res = M.request("PATCH", "/galleries/" .. galleryId .. "/sections/" .. sectionId, fields)
    return res and res.section
end

function M.deleteSection(galleryId, sectionId)
    -- NB: the server returns 200 { ok = true }, not 204 -- M.request already
    -- handles both shapes fine (returns the decoded body either way), no
    -- special-casing needed here.
    M.request("DELETE", "/galleries/" .. galleryId .. "/sections/" .. sectionId)
end

-- fileIds: sectionAssignSchema caps this at 500 per call server-side --
-- callers with a larger batch (e.g. a big wedding publish) must chunk
-- before calling this, see processRenderedPhotos.
function M.assignFilesToSection(galleryId, sectionId, fileIds)
    local res = M.request(
        "POST",
        "/galleries/" .. galleryId .. "/sections/" .. sectionId .. "/files",
        { fileIds = fileIds }
    )
    return res and res.assigned
end

-- ============================================================================
-- Upload
-- ============================================================================

-- Upload policy of the signed-in studio: the per-file size limit and the
-- allowed file kinds, so the plug-in can refuse an oversized or disallowed
-- file with a clear message BEFORE spending minutes uploading it.
--
-- Read from GET /settings (a Studio route that, like /uploads/init, accepts
-- the Bearer token). The effective limit mirrors the server's
-- effectiveUploadLimitBytes(): the studio's own maxUploadMib, else the
-- instance default, never above the hard cap. The allowed kinds mirror
-- effectiveAllowedKinds(): the studio's override, else the instance default.
--
-- BEST-EFFORT. This is only a convenience; the server enforces both limits
-- on /uploads/init anyway. Any failure (older server, missing permission,
-- changed response shape) returns nil and the caller simply skips the check.
--
-- Returns { maxBytes = number|nil, allowedKinds = { image = true, ... }|nil }
function M.getUploadPolicy()
    local res = M.request("GET", "/settings")
    if type(res) ~= "table" then return nil end

    local tenant = type(res.tenant) == "table" and res.tenant or {}
    local limits = type(res.uploadLimits) == "table" and res.uploadLimits or {}

    local maxBytes
    local mib = tonumber(tenant.maxUploadMib) or tonumber(limits.defaultMib)
    if mib then
        local hardCap = tonumber(limits.hardCapMib)
        if hardCap and mib > hardCap then mib = hardCap end
        maxBytes = mib * 1024 * 1024
    end

    local allowed = {}
    if type(tenant.uploadAllowedKinds) == "string" and tenant.uploadAllowedKinds ~= "" then
        for kind in tenant.uploadAllowedKinds:gmatch("[^,%s]+") do
            allowed[kind:lower()] = true
        end
    elseif type(res.allowedKinds) == "table" and type(res.allowedKinds.default) == "table" then
        for _, kind in ipairs(res.allowedKinds.default) do
            allowed[tostring(kind):lower()] = true
        end
    end
    if next(allowed) == nil then allowed = nil end

    return { maxBytes = maxBytes, allowedKinds = allowed }
end

-- Upload-init: registers n files, gets back presigned PUT URLs. We use the
-- existing Studio upload endpoint -- no plug-in-specific path needed, since
-- it already supports Bearer-token auth.
--
-- Each returned upload has method = "single" (one presigned PUT, files up to
-- 100 MB) or "multipart" (uploadId, partSize, totalParts and one presigned URL
-- per part). The SERVER picks the method -- callers follow it instead of
-- recomputing the threshold.
function M.initUpload(galleryId, files)
    local res = M.request("POST", "/uploads/init", {
        galleryId = galleryId,
        files = files,
    })
    return (res and res.uploads) or {}
end

-- Upload-complete: after the S3 PUT, the plug-in reports success to Lumio
-- so worker processing (thumbs/preview/web/watermark) starts.
--
-- Multipart: `parts` is { { partNumber = 1, eTag = "..." }, ... } and the
-- uploadId travels in the "x-upload-id" REQUEST HEADER, not in the body -- the
-- API reads it from there (routes/files.ts), same as the browser does.
-- Leaving it out makes S3 reject the completion.
function M.completeUpload(fileId, parts, uploadId)
    local opts = { idempotent = true }
    if uploadId then
        opts.headers = { { field = "x-upload-id", value = uploadId } }
    end
    return M.request("POST", "/uploads/complete", {
        fileId = fileId,
        parts = parts,  -- nil for single-PUT, array for multipart
    }, opts)
end

-- Fresh presigned URLs for a file that is still 'uploading': presigned URLs
-- are valid for one hour, which a multi-gigabyte upload on a slow uplink can
-- exceed. For multipart the uploadId is required (it is not stored server-side)
-- and partNumbers selects which parts to sign again.
function M.resignUpload(fileId, uploadId, partNumbers)
    return M.request("POST", "/uploads/" .. fileId .. "/resign", {
        uploadId = uploadId,
        partNumbers = partNumbers,
    }, { idempotent = true })
end

-- One presigned PUT with retries. Shared by the single-part upload and every
-- part of a multipart upload.
--
-- Retry here as well. This is the only multi-megabyte transfer and at the
-- same time the only call that is SAFE to repeat: a presigned PUT to the
-- same key with the same content is idempotent, unlike POST /uploads/init.
-- Without this, a single network hiccup discarded the whole photo.
--
-- Returns  true,  etag|nil                 on success
--          false, message, httpStatus|nil  on failure (status is nil for a
--                                          network failure)
-- A network-level failure after the last retry is a failure too, not a throw,
-- so the multipart caller can look at the status (expired URL -> resign).
-- A cancellation DOES throw (from interruptibleSleep).
local function putWithRetry(url, data, headers, timeout)
    local responseBody, responseHeaders
    local waited = 0
    for attempt = 0, #RETRY_DELAYS do
        responseBody, responseHeaders = LrHttp.post(url, data, headers, "PUT", timeout)

        local netErr = responseHeaders and responseHeaders.error
        local st = responseHeaders and tonumber(responseHeaders.status) or nil
        local shouldRetry = (not responseHeaders) or netErr or (st == nil)
            or st == 500 or st == 502 or st == 503 or st == 504

        if not shouldRetry or attempt >= #RETRY_DELAYS then break end

        local delay = math.min(RETRY_DELAYS[attempt + 1], MAX_DELAY)
        if waited + delay > MAX_TOTAL_WAIT then break end
        waited = waited + delay
        log:warn(string.format("S3 PUT attempt %d failed (%s), waiting %d s",
            attempt + 1, netErr and "network error" or tostring(st), delay))
        interruptibleSleep(delay)
    end

    if not responseHeaders then
        return false, "no response from S3 (network problem?)", nil
    end
    -- Was `responseHeaders.status or 0`, so a MISSING status code (connection
    -- dropped mid-transfer) was read as SUCCESS -> the server was left with a
    -- file row and no object, and the user saw no error at all.
    -- An explicit 2xx is now required.
    local netErr = responseHeaders.error
    local status = tonumber(responseHeaders.status)
    if netErr then
        return false, "S3 upload failed due to a network error: " ..
            tostring(netErr.name or netErr.errorCode or "unknown"), nil
    end
    if type(status) ~= "number" or status < 200 or status >= 300 then
        return false, "S3 upload failed (status " .. tostring(status) .. ") " ..
            (responseBody or ""):sub(1, 200), status
    end
    -- S3 returns an ETag header. Single-PUT does not need it; multipart
    -- needs the ETag of every part to complete the upload.
    local etag
    for _, h in ipairs(responseHeaders) do
        if (h.field or ""):lower() == "etag" then
            etag = h.value
            break
        end
    end
    return true, etag
end

-- Single-part upload to S3 via a presigned PUT URL (files up to 100 MB; the
-- server hands out a multipart upload above that, see uploadFileMultipart).
function M.uploadFileToS3(presignedUrl, filepath, mimeType)
    -- Read the file -- the LR SDK offers no streamed-upload API, so we
    -- load it entirely into RAM. Fine up to the 100 MB single-PUT ceiling;
    -- larger files never come through here.
    local f, err = io.open(filepath, "rb")
    if not f then
        error("Lumio: cannot open file: " .. tostring(err))
    end
    local data = f:read("*all")
    f:close()
    if not data then
        error("Lumio: file is empty or unreadable: " .. filepath)
    end

    local headers = {
        { field = "Content-Type", value = mimeType or "application/octet-stream" },
    }
    log:info("S3 PUT " .. presignedUrl:sub(1, 80) .. "... (" .. #data .. " bytes)")

    local ok, etagOrMessage = putWithRetry(presignedUrl, data, headers, PUT_TIMEOUT_SINGLE)
    if not ok then
        error("Lumio: " .. etagOrMessage)
    end
    return etagOrMessage
end

-- Multipart upload for files above the single-PUT ceiling. `upload` is one
-- entry of initUpload()'s result with method = "multipart". The file is read
-- one part at a time (8 MiB by default), so memory use stays flat no matter
-- how large the file is -- the reason multipart exists here at all, since the
-- SDK cannot stream a body from disk.
--
-- Parts are sent one after the other. Lightroom tasks are cooperative and a
-- single connection already saturates most uplinks; parallel parts can come
-- later if measurements ask for it.
--
-- onProgress(partsDone, totalParts) is called after every finished part.
-- Returns the parts for completeUpload(): { { partNumber, eTag }, ... }.
function M.uploadFileMultipart(upload, filepath, onProgress)
    local partSize = tonumber(upload.partSize)
    local totalParts = tonumber(upload.totalParts)
    if not (upload.uploadId and upload.fileId and partSize and partSize > 0
            and totalParts and totalParts > 0 and type(upload.parts) == "table") then
        error("Lumio: invalid multipart upload instructions from the server")
    end

    local urls = {}
    for _, p in ipairs(upload.parts) do
        urls[p.partNumber] = p.uploadUrl
    end

    local f, err = io.open(filepath, "rb")
    if not f then
        error("Lumio: cannot open file: " .. tostring(err))
    end

    local headers = {
        { field = "Content-Type", value = "application/octet-stream" },
    }

    -- Sends one part. A 400/403/410 means the presigned URL is expired or
    -- otherwise dead (they last one hour): fetch fresh URLs once and try again.
    -- The fresh URLs are requested for this part AND all that follow, so a
    -- long upload pays for one resign call instead of one per remaining part.
    local resigned = false
    local function putPart(n, data)
        while true do
            local url = urls[n]
            if not url then
                error("Lumio: no upload URL for part " .. n)
            end
            local ok, etagOrMessage, status = putWithRetry(url, data, headers, PUT_TIMEOUT_PART)
            if ok then
                if not etagOrMessage then
                    error("Lumio: S3 did not return an ETag for part " .. n)
                end
                -- S3 quotes the ETag; the API takes it unquoted (as the browser sends it).
                return (etagOrMessage:gsub('"', ''))
            end
            if (status == 400 or status == 403 or status == 410) and not resigned then
                resigned = true
                log:warn("part " .. n .. ": presigned URL rejected (" .. status .. "), requesting new URLs")
                local wanted = {}
                for k = n, totalParts do table.insert(wanted, k) end
                local fresh = M.resignUpload(upload.fileId, upload.uploadId, wanted)
                for _, p in ipairs((fresh and fresh.parts) or {}) do
                    urls[p.partNumber] = p.uploadUrl
                end
            else
                error("Lumio: " .. tostring(etagOrMessage))
            end
        end
    end

    -- LrTasks.pcall (not pcall): LrHttp yields, which a plain pcall forbids.
    -- Needed so the file handle is closed on every exit path, cancel included.
    local ok, result = LrTasks.pcall(function()
        local completed = {}
        for n = 1, totalParts do
            if M.isCanceled and M.isCanceled() then
                error("Lumio: canceled")
            end
            f:seek("set", (n - 1) * partSize)
            local data = f:read(partSize)
            if not data or #data == 0 then
                error("Lumio: could not read part " .. n .. " of " .. filepath)
            end
            log:info(string.format("S3 PUT part %d/%d (%d bytes)", n, totalParts, #data))
            local eTag = putPart(n, data)
            table.insert(completed, { partNumber = n, eTag = eTag })
            if onProgress then onProgress(n, totalParts) end
        end
        return completed
    end)
    f:close()
    if not ok then
        error(result, 0)  -- already carries its own "Lumio: ..." message
    end
    return result
end

return M
