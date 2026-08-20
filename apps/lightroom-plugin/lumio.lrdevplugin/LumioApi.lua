--[[
    LumioApi.lua

    HTTP-Wrapper für die Lumio Plugin-API. Liest Host + Token aus den
    Plugin-Preferences, baut Authorization-Header, parst JSON.

    Alle Methoden müssen aus einer LrTask laufen (LrHttp blockiert nicht
    den UI-Thread, ist aber asynchron — Lightroom-SDK-Konvention).

    Read-Side (Selection-Import nach LR):
      testConnection, listGalleries, getSelection

    Write-Side (Publish-Service: LR → Lumio):
      createGallery, patchGallery, listGalleryFiles, deleteGalleryFile,
      initUpload, completeUpload, uploadFileToS3
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

-- Host + Token aus Prefs holen, sicherheitshalber Trailing-Slash strippen
local function getBase()
    local host = (prefs.host or ""):gsub("/+$", "")
    if host == "" then
        error("Lumio: Bitte Host in den Plug-in-Optionen konfigurieren")
    end
    return host
end

local function getToken()
    local token = prefs.token or ""
    if token == "" then
        error("Lumio: Bitte API-Token in den Plug-in-Optionen konfigurieren")
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
local MAX_DELAY      = 30   -- katto yhdelle odotukselle, myös Retry-Afterille
local MAX_TOTAL_WAIT = 90   -- kokonaisbudjetti yhtä kutsua kohti
local MAX_NET_RETRIES = 1   -- verkkovirhe on usein PYSYVÄ (väärä host) -> vain 1 uusinta

-- A caller can set this so that long waits are interrupted by a cancellation.
-- Without it LrTasks.sleep does not react to the Cancel button at all.
M.isCanceled = nil

local function interruptibleSleep(seconds)
    local slept = 0
    while slept < seconds do
        if M.isCanceled and M.isCanceled() then
            error("Lumio: peruutettu")
        end
        local step = math.min(1, seconds - slept)
        LrTasks.sleep(step)
        slept = slept + step
    end
end

local function retryAfterSeconds(responseHeaders, fallback)
    for _, h in ipairs(responseHeaders or {}) do
        if h.field and tostring(h.field):lower() == "retry-after" then
            local n = tonumber(h.value)  -- HTTP-päiväysmuoto -> nil -> fallback
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

-- Low-Level Request. Gibt body + status zurück, throws bei Auth-Fehler.
function M.request(method, path, body)
    local url = getBase() .. "/api/v1" .. path
    log:info("HTTP " .. method .. " " .. url)

    -- POST IS NOT IDEMPOTENT. /uploads/init, /uploads/complete and
    -- /plugin/galleries change server state: if the response is lost to a
    -- network error, the request may still have been processed. A retry would
    -- create a second file row (stuck in 'uploading' forever) or an entirely
    -- second gallery. A 429 is safe for every method, because the rate limit
    -- rejects the request BEFORE the handler runs.
    local isPost = (method == "POST")

    local responseBody, responseHeaders, status
    local totalWait, netRetries = 0, 0

    for attempt = 0, #RETRY_DELAYS do
        local headers = {
            { field = "Authorization", value = "Bearer " .. getToken() },
            { field = "Accept",        value = "application/json" },
        }
        responseBody, responseHeaders = httpDispatch(method, url, headers, body)

        -- LrHttp signaloi verkkovirheen responseHeaders.error-kentässä, EI poikkeuksena
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
                    error("Lumio: yhteys epäonnistui: " ..
                        tostring(netErr.name or netErr.errorCode or "tuntematon verkkovirhe"))
                end
                -- Was `responseHeaders.status or 0`, which let a response with no
                -- status pass as a "success" and silently returned nil.
                error("Lumio: palvelin ei vastannut odotetusti (statuskoodi puuttuu)")
            end
            break -- 4xx/5xx: käsitellään alla normaalina HTTP-virheenä
        end

        local delay = retryAfterSeconds(responseHeaders, RETRY_DELAYS[attempt + 1])
        if totalWait + delay > MAX_TOTAL_WAIT then
            log:warn("odotusbudjetti täynnä (" .. totalWait .. " s), ei enää yrityksiä")
            break
        end
        totalWait = totalWait + delay
        log:warn(string.format("HTTP %s %s -> yritys %d/%d epäonnistui (%s), odotetaan %d s",
            method, path, attempt + 1, #RETRY_DELAYS + 1,
            netErr and "verkkovirhe" or tostring(status), delay))
        interruptibleSleep(delay)
    end

    if not responseHeaders then
        error("Lumio: keine Antwort vom Server (Host erreichbar?)")
    end
    if status == 401 then
        error("Lumio: API-Token ungültig oder abgelaufen")
    elseif status == 204 then
        return nil
    elseif status and status >= 400 then
        error("Lumio: HTTP " .. tostring(status) ..
            " " .. (responseBody or ""):sub(1, 200))
    end

    if not responseBody or responseBody == "" then
        return nil
    end
    local ok, parsed = pcall(json.decode, responseBody)
    if not ok then
        error("Lumio: Antwort ist kein gültiges JSON")
    end
    return parsed
end

-- ============================================================================
-- Read-Side
-- ============================================================================

function M.testConnection()
    -- Wirft bei Fehler, gibt sonst { ok = true, apiVersion = "1" } zurück
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
-- Write-Side (Publish)
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

-- Upload-Init: meldet n Files an, bekommt presigned PUT-URLs zurueck.
-- Wir nutzen den existierenden Studio-Upload-Endpoint — kein Plugin-
-- Sonderpfad noetig, da er bereits Bearer-Token-faehig ist.
function M.initUpload(galleryId, files)
    local res = M.request("POST", "/uploads/init", {
        galleryId = galleryId,
        files = files,
    })
    return (res and res.uploads) or {}
end

-- Upload-Complete: nach S3-PUT meldet das Plugin den Erfolg an Lumio,
-- damit Worker-Verarbeitung (Thumbs/Preview/Web/Watermark) startet.
function M.completeUpload(fileId, parts)
    local res = M.request("POST", "/uploads/complete", {
        fileId = fileId,
        parts = parts,  -- nil bei single-PUT, array bei multipart
    })
    return res
end

-- Single-Part-Upload zu S3 via presigned PUT-URL.
-- Lightroom-Renders sind typischerweise < 50 MB JPEG (selbst bei 100%
-- Quality), also single-PUT statt multipart. multipart-Support kommt
-- spaeter wenn jemand RAW exportiert.
function M.uploadFileToS3(presignedUrl, filepath, mimeType)
    -- Datei lesen — Lr SDK liefert keine streamed-Upload-API,
    -- also komplett in RAM laden. Bei riesigen Files (100 MB+) wuerde
    -- das problematisch, aber JPEG-Renders sind selten so gross.
    local f, err = io.open(filepath, "rb")
    if not f then
        error("Lumio: kann Datei nicht oeffnen: " .. tostring(err))
    end
    local data = f:read("*all")
    f:close()
    if not data then
        error("Lumio: Datei ist leer oder unlesbar: " .. filepath)
    end

    local headers = {
        { field = "Content-Type", value = mimeType or "application/octet-stream" },
    }
    log:info("S3 PUT " .. presignedUrl:sub(1, 80) .. "... (" .. #data .. " bytes)")

    -- Retry here as well. This is the only multi-megabyte transfer and at the
    -- same time the only call that is SAFE to repeat: a presigned PUT to the
    -- same key with the same content is idempotent, unlike POST /uploads/init.
    -- Without this, a single network hiccup discarded the whole photo.
    local responseBody, responseHeaders
    local waited = 0
    for attempt = 0, #RETRY_DELAYS do
        responseBody, responseHeaders = LrHttp.post(presignedUrl, data, headers, "PUT")

        local netErr = responseHeaders and responseHeaders.error
        local st = responseHeaders and tonumber(responseHeaders.status) or nil
        local shouldRetry = (not responseHeaders) or netErr or (st == nil)
            or st == 500 or st == 502 or st == 503 or st == 504

        if not shouldRetry or attempt >= #RETRY_DELAYS then break end

        local delay = math.min(RETRY_DELAYS[attempt + 1], MAX_DELAY)
        if waited + delay > MAX_TOTAL_WAIT then break end
        waited = waited + delay
        log:warn(string.format("S3 PUT yritys %d epäonnistui (%s), odotetaan %d s",
            attempt + 1, netErr and "verkkovirhe" or tostring(st), delay))
        interruptibleSleep(delay)
    end

    if not responseHeaders then
        error("Lumio: kein Response von S3 (Netzwerkproblem?)")
    end
    -- Was `responseHeaders.status or 0`, so a MISSING status code (connection
    -- dropped mid-transfer) was read as SUCCESS -> the server was left with a
    -- file row and no object, and the user saw no error at all.
    -- An explicit 2xx is now required.
    local netErr = responseHeaders.error
    local status = tonumber(responseHeaders.status)
    if netErr then
        error("Lumio: S3-lataus epäonnistui verkkovirheeseen: " ..
            tostring(netErr.name or netErr.errorCode or "tuntematon"))
    end
    if type(status) ~= "number" or status < 200 or status >= 300 then
        error("Lumio: S3-lataus epäonnistui (status " .. tostring(status) .. ") " ..
            (responseBody or ""):sub(1, 200))
    end
    -- S3 liefert ein ETag-Header zurueck — nicht zwingend benoetigt
    -- bei single-PUT, aber wir geben ihn zurueck fuer evtl. multipart-
    -- Erweiterung.
    local etag
    for _, h in ipairs(responseHeaders) do
        if (h.field or ""):lower() == "etag" then
            etag = h.value
            break
        end
    end
    return etag
end

return M
