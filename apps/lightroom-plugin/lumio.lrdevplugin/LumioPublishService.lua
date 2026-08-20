--[[
    LumioPublishService.lua

    Lightroom Publish-Service-Provider fuer Lumio.

    Was es macht
    ============
    Der Fotograf legt im Lightroom-Modul „Bibliothek" → „Veroeffentlichungs-
    dienste" einen „Lumio"-Publish-Service an. Pro Lumio-Galerie eine
    Published-Collection. Drag-and-Drop oder Smart-Collection-Regeln
    bestimmen, welche Fotos in die Galerie kommen. Klick auf
    „Veroeffentlichen" rendert Lightroom die Fotos zu JPEGs (Export-
    Engine), wir laden sie zu Lumio hoch.

    Lightroom-Hooks-Cheatsheet
    ==========================
    Service-Level (= alle Collections):
      - startDialog / endDialog               : Service-Setup
      - sectionsForTopOfDialog                : Auth-Check + Token-Hinweis

    Collection-Level (= eine Lumio-Galerie):
      - viewForCollectionSettings             : Galerie waehlen / anlegen,
                                                Status-Schalter
      - updateCollectionSettings              : nach Settings-Save

    Photo-Level (= Upload + Delete):
      - processRenderedPhotos                 : pro Veroeffentlichen-Batch
      - deletePhotosFromPublishedCollection   : Fotos aus LR-Coll. entfernt

    Metadaten-getriggert:
      - metadataThatTriggersRepublish         : was muss sich aendern damit
                                                LR den Knopf 'Republish' setzt

    Datenflow
    =========
    1. LR rendert Photo → temp JPEG
    2. processRenderedPhotos bekommt jedes gerenderte Photo
    3. Wir initUpload(gallery, [{ filename, sizeBytes, mimeType }])
    4. S3-PUT zu der presigned URL
    5. completeUpload(fileId)
    6. rendition:recordPublishedPhotoId(fileId) - LR merkt sich die Lumio-ID
]]

local LrApplication        = import "LrApplication"
local LrBinding            = import "LrBinding"
local LrColor              = import "LrColor"
local LrDate               = import "LrDate"
local LrDialogs            = import "LrDialogs"
local LrFunctionContext    = import "LrFunctionContext"
local LrPathUtils          = import "LrPathUtils"
local LrPrefs              = import "LrPrefs"
local LrTasks              = import "LrTasks"
local LrView               = import "LrView"
local LrFileUtils          = import "LrFileUtils"

local api  = require "LumioApi"
local log  = require "Logger"
local json = require "Json"

local exportServiceProvider = {}

-- ============================================================================
-- Plugin-Metadaten
-- ============================================================================
exportServiceProvider.supportsIncrementalPublish = "only"
exportServiceProvider.exportPresetFields = {
    -- Service-weite Defaults (kommen aus Plugin-Manager-Section)
}
exportServiceProvider.hideSections = {
    -- Default-Export-Sektionen die wir NICHT anzeigen wollen
    "exportLocation",  -- Lumio kennt keine 'Where to save' — geht direkt online
    "fileNaming",       -- wir nutzen den Original-Filename
    "video",            -- aktuell kein Video-Upload
    "watermarking",     -- Watermark macht Lumio server-side
    "postProcessing",   -- macht Lumio (Renditions/Watermark/HLS)
}
exportServiceProvider.allowFileFormats = { "JPEG" }
exportServiceProvider.allowColorSpaces = { "sRGB" }
exportServiceProvider.titleForPublishedCollection           = "Lumio Gallery"
exportServiceProvider.titleForPublishedCollection_standalone = "Lumio Gallery"
exportServiceProvider.titleForPublishedSmartCollection      = "Lumio Smart Gallery"
exportServiceProvider.titleForPublishedSmartCollection_standalone = "Lumio Smart Gallery"
exportServiceProvider.titleForGoToPublishedCollection       = "Show in Lumio"
exportServiceProvider.titleForGoToPublishedPhoto            = "Show in Lumio"
exportServiceProvider.small_icon = "icon.png"
exportServiceProvider.supportsCustomSortOrder = false
exportServiceProvider.disableRenamePublishedCollection      = false
exportServiceProvider.disableRenamePublishedCollectionSet   = true

-- This was missing entirely. Without getCollectionBehaviorInfo, Lightroom
-- assumes Collection Set support and fails with
-- "?:0: attempt to call method 'hierarchyCreated' (a nil value)" when a
-- collection is created in the publish service. The plug-in has NO set-level
-- callbacks (e.g. updateCollectionSetSettings), so tell LR outright that
-- hierarchies are unsupported: maxCollectionSetDepth = 0.
function exportServiceProvider.getCollectionBehaviorInfo(publishSettings)
    return {
        defaultCollectionName         = "Lumio Gallery",
        defaultCollectionCanBeDeleted = true,
        canAddCollection              = true,
        maxCollectionSetDepth         = 0,
    }
end

-- Republish-Trigger: nur Datei-Inhalt, nicht Metadaten. Lightroom-Filename-
-- Aenderungen wuerden zwar einen Republish triggern, sind aber selten — wir
-- listen 'default = false' damit der Republish-Knopf nicht standardmaessig
-- nach jedem Edit angeht. Photographer muss explizit auf 'Republish' klicken.
function exportServiceProvider.metadataThatTriggersRepublish(publishSettings)
    return {
        default = false,
    }
end

-- ============================================================================
-- Service-Setup-Dialog (im Plug-in-Manager)
-- ============================================================================
-- Das Plug-in-Manager-UI (PluginManager.lua) hat schon Host + Token.
-- Hier zeigen wir nur einen Hinweis im Publish-Service-Sektion.

function exportServiceProvider.sectionsForTopOfDialog(viewFactory, propertyTable)
    return {
        {
            title = "Lumio Connection",
            synopsis = "API token is managed in the plug-in options",
            viewFactory:row {
                viewFactory:static_text {
                    title = "Host and API token are managed globally in the plug-in options.",
                    width_in_chars = 60,
                },
            },
            viewFactory:row {
                viewFactory:static_text {
                    title = "Note: one published collection is created per Lumio gallery.",
                    width_in_chars = 60,
                    text_color = LrColor(0.5, 0.5, 0.5),
                },
            },
        },
    }
end

-- ============================================================================
-- Collection-Settings (pro Lumio-Galerie)
-- ============================================================================
-- Hier waehlt der Fotograf, welche Lumio-Galerie zu dieser LR-Sammlung
-- gehoert. Wenn keine existiert: neu anlegen.

function exportServiceProvider.viewForCollectionSettings(viewFactory, publishSettings, info)
    local f = viewFactory
    local props = info.collectionSettings

    -- Defaults setzen — sonst sind die Property-Felder nil und LR meckert
    props.galleryId = props.galleryId or ""
    props.galleryTitle = props.galleryTitle or ""
    props.galleryMode = props.galleryMode or "collaboration"
    props.galleryStatus = props.galleryStatus or "draft"
    props.makeLive = props.makeLive or false

    -- Existing galleries did not show up in the menu. The server was not at
    -- fault: GET /plugin/galleries returns 200 and the correct list (verified
    -- with a direct API call). Two bugs in the plug-in:
    --   1. The list was set ONLY asynchronously, after the dialog had been
    --      built, by which time the binding no longer refreshed the popup_menu.
    --   2. The old line was `props.availableGalleries = props.availableGalleries or {...}`
    --      and because props = info.collectionSettings PERSISTS, on the second
    --      open the `or` kept the stale (usually "Loading…") value and the list
    --      never refreshed.
    -- Fix: build the menu SYNCHRONOUSLY from the prefs cache right away, and
    -- refresh that cache in the background for the next open.
    local prefs = LrPrefs.prefsForPlugin()

    local function buildGalleryItems(list)
        local items = { { title = "— Create new gallery (enter title below) —", value = "" } }
        for _, g in ipairs(list or {}) do
            table.insert(items, {
                title = string.format("%s (%s, %d files)",
                    tostring(g.title), tostring(g.status), g.fileCount or 0),
                value = g.id,
            })
        end
        return items
    end

    -- The cache does NOT go into prefs as a table. LrPrefs only stores simple
    -- values reliably; a table of tables was lost silently, so on the next open
    -- the list read back empty. The log proved it: "gallery list refreshed:
    -- 1 galleries" was written, yet the menu stayed empty. Store it as a JSON
    -- string instead.
    local cached = {}
    if type(prefs.galleryCacheJson) == "string" and prefs.galleryCacheJson ~= "" then
        local okDecode, decoded = pcall(json.decode, prefs.galleryCacheJson)
        if okDecode and type(decoded) == "table" then cached = decoded end
    end

    -- 1) heti näkyviin: viimeksi haettu lista (tyhjä vasta ensimmäisellä kerralla)
    props.availableGalleries = buildGalleryItems(cached)

    -- If the collection already has a gallery but the cache is empty (the first
    -- open after this change), the menu would show ONLY the "Create new gallery"
    -- row with the value "". The user would pick it, galleryId would reset, and
    -- the NEXT publish would create a stray extra gallery for the client.
    -- Always keep the currently bound value in the list.
    if props.galleryId and props.galleryId ~= "" then
        local found = false
        for _, it in ipairs(props.availableGalleries) do
            if it.value == props.galleryId then found = true break end
        end
        if not found then
            local label = (props.galleryTitle and props.galleryTitle ~= "")
                and props.galleryTitle or props.galleryId
            table.insert(props.availableGalleries, 2,
                { title = "(current) " .. tostring(label), value = props.galleryId })
        end
    end

    -- 2) taustalla tuore haku: päivittää välimuistin ja yrittää myös elävää sidontaa
    LrTasks.startAsyncTask(function()
        local ok, galleries = LrTasks.pcall(api.listGalleries)
        if not ok then
            log:warn("gallery list could not be loaded: " .. tostring(galleries))
            return
        end
        -- NOTE: an empty list is cached on purpose. The error path is already
        -- handled above (if not ok then ... return end), so an empty result that
        -- reaches this point genuinely means an empty account. If we skipped
        -- caching it, a gallery deleted in the Studio would linger in the menu
        -- forever.
        local okEnc, encoded = pcall(json.encode, galleries)
        if okEnc then prefs.galleryCacheJson = encoded end
        props.availableGalleries = buildGalleryItems(galleries)
        log:info("gallery list refreshed: " .. #galleries ..
                 " galleries, cache " .. (okEnc and "written" or "FAILED"))
    end)

    -- THIS was the real cause of the 'hierarchyCreated' failure.
    -- sectionsForTopOfDialog returns a table of SECTIONS (title/synopsis/…),
    -- but viewForCollectionSettings has to return a SINGLE VIEW. This returned
    -- a sections-shaped table, so LR tried to call the method
    -- 'hierarchyCreated' on it -> "An internal error has occurred". The
    -- function itself ran to completion (hence the gallery fetches in the log),
    -- but the dialog died on the return value -- which is why the dropdown was
    -- never seen at all.
    return f:group_box {
        title = "Lumio Gallery",
        fill_horizontal = 1,
        f:column {
            spacing = f:control_spacing(),
            fill_horizontal = 1,
            f:row {
                f:static_text {
                    title = "Existing gallery:",
                    width = LrView.share "label_width",
                    alignment = "right",
                },
                f:popup_menu {
                    bind_to_object = props,
                    value = LrView.bind("galleryId"),
                    items = LrView.bind("availableGalleries"),
                    width_in_chars = 40,
                },
            },
            f:row {
                f:static_text {
                    title = "OR create new:",
                    width = LrView.share "label_width",
                    alignment = "right",
                },
                f:edit_field {
                    bind_to_object = props,
                    value = LrView.bind("galleryTitle"),
                    placeholder_string = "Gallery title (e.g. 'Mäyränkatu 14')",
                    width_in_chars = 40,
                },
            },
            f:row {
                f:static_text {
                    title = "Mode:",
                    width = LrView.share "label_width",
                    alignment = "right",
                },
                f:popup_menu {
                    bind_to_object = props,
                    value = LrView.bind("galleryMode"),
                    items = {
                        { title = "Selection / proofing (client likes & picks)", value = "collaboration" },
                        { title = "Presentation (view only)", value = "presentation" },
                    },
                    width_in_chars = 40,
                },
            },
            f:row {
                f:static_text {
                    title = " ",
                    width = LrView.share "label_width",
                },
                f:checkbox {
                    bind_to_object = props,
                    value = LrView.bind("makeLive"),
                    title = "Set gallery live automatically after upload",
                },
            },
            f:row {
                f:static_text {
                    title = " ",
                    width = LrView.share "label_width",
                },
                f:static_text {
                    title = "Tip: configure header, branding and password in Lumio Studio after the first upload.",
                    width_in_chars = 50,
                    text_color = LrColor(0.5, 0.5, 0.5),
                    height_in_lines = 2,
                },
            },
        },
    }
end

-- ============================================================================
-- Upload-Helper (forward-declared damit processRenderedPhotos zugreifen kann)
-- ============================================================================
-- uploadOnePhoto: schickt EINE Rendition zu Lumio. Wirft bei Fehler.
-- rendition:recordPublishedPhotoId(fileId) wird gesetzt damit LR sich
-- merkt welches Lumio-File diesem LR-Photo entspricht.
local function uploadOnePhoto(rendition, filepath, galleryId)
    -- Original-Filename aus dem LR-Photo lesen (NICHT vom Renderpfad,
    -- der ist eine temp.jpg)
    local photo = rendition.photo
    local origName = photo:getFormattedMetadata("fileName") or LrPathUtils.leafName(filepath)
    -- Endung anpassen: wir rendern als JPEG, also .jpg
    local nameNoExt = LrPathUtils.removeExtension(origName)
    local filename = nameNoExt .. ".jpg"

    -- Filesize
    local sizeBytes = LrFileUtils.fileAttributes(filepath).fileSize or 0
    if sizeBytes == 0 then
        error("Datei ist leer: " .. filepath)
    end

    -- Init-Call: bekommt presigned PUT-URL zurueck
    local uploads = api.initUpload(galleryId, {
        {
            filename = filename,
            sizeBytes = sizeBytes,
            mimeType = "image/jpeg",
        },
    })
    if not uploads or not uploads[1] then
        error("init: keine Upload-Anweisung erhalten")
    end
    local u = uploads[1]
    if u.method ~= "single" then
        error("multipart-Upload aktuell nicht unterstuetzt (Photo > 100 MB)")
    end

    -- S3-PUT
    api.uploadFileToS3(u.uploadUrl, filepath, "image/jpeg")

    -- Complete: Worker-Verarbeitung anstossen
    api.completeUpload(u.fileId, nil)

    -- LR merkt sich die Lumio-File-ID. Bei spaeterem Republish/Delete
    -- liefert LR diese ID an deletePhotosFromPublishedCollection.
    rendition:recordPublishedPhotoId(u.fileId)
    -- This was `rendition:recordPublishedPhotoUrl(nil)`. LR requires a string
    -- and failed every photo with
    -- "AgExportRendition:recordRemotePhotoUrl: URL must be a string".
    -- The photos DID reach Lumio (the upload happens before this line), but LR
    -- never marked them as published -> they stayed in "New Photos to Publish"
    -- and would have been uploaded again on every publish = duplicates.
    -- The URL call is optional in the SDK and the upload response carries no
    -- viewable address (only a presigned PUT), so it is removed.
    -- "Show in Lumio" at gallery level still works (host + /g/<slug>).
end

-- ============================================================================
-- processRenderedPhotos — Upload-Schleife
-- ============================================================================
-- Lightroom hat die Photos zu temp-JPEGs gerendert und uebergibt uns
-- den exportContext. Wir iterieren ueber alle Renditions und laden hoch.

function exportServiceProvider.processRenderedPhotos(functionContext, exportContext)
    local exportSession = exportContext.exportSession

    -- Galerie-ID aus den Collection-Settings holen. Wenn keine: Galerie
    -- jetzt anlegen (User hatte "neue Galerie" + Titel angegeben).
    local galleryId, gallerySlug, collProps
    if exportContext.publishedCollection then
        local collInfo = exportContext.publishedCollection:getCollectionInfoSummary()
        if collInfo and collInfo.collectionSettings then
            collProps = collInfo.collectionSettings
            galleryId = collProps.galleryId
            gallerySlug = collProps.gallerySlug
        end
    end

    if (not galleryId or galleryId == "") and collProps then
        -- Neue Galerie anlegen
        local title = (collProps.galleryTitle or ""):gsub("^%s+", ""):gsub("%s+$", "")
        if title == "" then
            LrDialogs.message(
                "Lumio",
                "This collection has no gallery assigned. Open 'Edit Published Collection' and either choose an existing gallery or enter a title for a new one.",
                "critical"
            )
            return
        end
        local ok, created = LrTasks.pcall(
            api.createGallery, title, collProps.galleryMode, nil
        )
        if not ok then
            LrDialogs.message("Lumio", "Could not create gallery: " .. tostring(created), "critical")
            return
        end
        galleryId = created.id
        gallerySlug = created.slug
        -- In den Collection-Settings persistieren — LR speichert das beim
        -- naechsten Dialog-Open. Direkter Schreibzugriff auf
        -- publishedCollection-Settings ist via catalog:withWriteAccessDo.
        local catalog = LrApplication.activeCatalog()
        catalog:withWriteAccessDo("Lumio: Galerie zuordnen", function()
            local current = exportContext.publishedCollection:getCollectionInfoSummary().collectionSettings or {}
            current.galleryId = galleryId
            current.gallerySlug = gallerySlug
            exportContext.publishedCollection:setCollectionSettings(current)
        end)
    end

    if not galleryId or galleryId == "" then
        LrDialogs.message("Lumio", "No Lumio gallery assigned.", "critical")
        return
    end

    local nPhotos = exportSession:countRenditions()
    local progressScope = exportContext:configureProgress {
        title = nPhotos > 1
            and (nPhotos .. " Photos nach Lumio hochladen")
            or "1 Photo nach Lumio hochladen",
    }

    local uploaded = 0
    local failed = 0
    local failedList = {}

    -- Wire cancellation into the API layer's waits. Without this the retry
    -- sleeps do not react to the Cancel button at all, because cancellation is
    -- only checked BETWEEN photos.
    api.isCanceled = function() return progressScope:isCanceled() end

    for i, rendition in exportContext:renditions { stopIfCanceled = true } do
        progressScope:setPortionComplete((i - 1) / nPhotos)

        -- Render abwarten — LR rendert in Threads, wir bekommen den
        -- fertigen Pfad per waitForRender.
        local success, pathOrMessage = rendition:waitForRender()
        if progressScope:isCanceled() then break end

        if not success then
            failed = failed + 1
            table.insert(failedList,
                (rendition.photo:getFormattedMetadata("fileName") or "?") ..
                ": " .. tostring(pathOrMessage))
            log:warn("Render failed: " .. tostring(pathOrMessage))
            -- Tell LR that THIS photo failed. Without it LR's publish state is
            -- left undefined and the photo can appear published even though it
            -- was never uploaded.
            rendition:uploadFailed(tostring(pathOrMessage))
        else
            local ok, errMsg = LrTasks.pcall(uploadOnePhoto, rendition, pathOrMessage, galleryId)
            if ok then
                uploaded = uploaded + 1
            else
                failed = failed + 1
                local fname = rendition.photo:getFormattedMetadata("fileName") or "?"
                table.insert(failedList, fname .. ": " .. tostring(errMsg))
                log:warn("Upload failed for " .. fname .. ": " .. tostring(errMsg))
                rendition:uploadFailed(tostring(errMsg))
            end
            -- Temp-File aufraeumen
            if pathOrMessage and LrFileUtils.exists(pathOrMessage) then
                LrFileUtils.delete(pathOrMessage)
            end
        end

        progressScope:setPortionComplete(i / nPhotos)
    end

    -- Status auf 'live' setzen wenn gewuenscht
    -- A failure here used to surface only in the log, so the photographer
    -- believed the gallery was published and sent the client a link to a
    -- gallery that was still a draft. This actually happened at 14:15 (HTTP 429).
    local statusPatchError = nil
    if collProps and collProps.makeLive and uploaded > 0 then
        local ok, err = LrTasks.pcall(function()
            api.patchGallery(galleryId, { status = "live" })
        end)
        if not ok then
            statusPatchError = tostring(err)
            log:warn("status=live failed: " .. statusPatchError)
        end
    end

    -- Close the progress bar and detach the cancellation hook BEFORE showing
    -- dialogs. done() used to run only after all the modals, which left the bar
    -- spinning for as long as the user was reading them.
    progressScope:done()
    api.isCanceled = nil

    -- Combined summary: LR already shows its own "Export Results" modal for
    -- failed renditions (rendition:uploadFailed), so rather than stacking three
    -- dialogs we show a single message of our own.
    local notes = {}
    if statusPatchError then
        table.insert(notes,
            "Gallery status could NOT be set to live:\n" .. statusPatchError ..
            "\nThe gallery is still a draft — set it live in Lumio Studio.")
    end
    if failed > 0 then
        local msg = uploaded .. " succeeded, " .. failed .. " failed.\n"
        for i, line in ipairs(failedList) do
            if i > 10 then
                msg = msg .. "(and " .. (failed - 10) .. " more)\n"
                break
            end
            msg = msg .. line .. "\n"
        end
        table.insert(notes, msg)
    end
    if #notes > 0 then
        LrDialogs.message("Lumio", table.concat(notes, "\n\n"), "warning")
    end
end

-- ============================================================================
-- deletePhotosFromPublishedCollection
-- ============================================================================
-- Wird gerufen wenn der Photographer Photos aus der Published-Collection
-- entfernt oder die Collection insgesamt loescht. Wir loeschen die
-- entsprechenden Lumio-Files via API.

function exportServiceProvider.deletePhotosFromPublishedCollection(
    publishSettings, arrayOfPhotoIds, deletedCallback, localCollectionId
)
    -- Lumio-Galerie ermitteln: aus der publishedCollection-Property,
    -- die LR an der publishSettings nicht direkt durchgibt. Wir muessen
    -- es ueber LrApplication.activeCatalog():getPublishedCollectionByLocalIdentifier.
    local catalog = LrApplication.activeCatalog()
    local publishedColl = catalog:getPublishedCollectionByLocalIdentifier(localCollectionId)
    if not publishedColl then
        log:warn("delete: publishedCollection nicht gefunden")
        return
    end
    local collInfo = publishedColl:getCollectionInfoSummary()
    local galleryId = collInfo and collInfo.collectionSettings and collInfo.collectionSettings.galleryId
    if not galleryId or galleryId == "" then
        log:warn("delete: galleryId nicht gesetzt")
        return
    end

    for _, photoId in ipairs(arrayOfPhotoIds) do
        local ok, err = LrTasks.pcall(api.deleteGalleryFile, galleryId, photoId)
        if ok then
            deletedCallback(photoId)
            log:info("deleted file " .. photoId)
        else
            log:warn("delete failed " .. photoId .. ": " .. tostring(err))
        end
    end
end

-- ============================================================================
-- goToPublishedCollection
-- ============================================================================
-- Wird vom "Show in Lumio"-Menueeintrag gerufen. Oeffnet die
-- Galerie im Browser.
function exportServiceProvider.goToPublishedCollection(publishSettings, info)
    local LrHttp = import "LrHttp"
    local collInfo = info.publishedCollection and info.publishedCollection:getCollectionInfoSummary()
    if not collInfo then return end
    local collSettings = collInfo.collectionSettings or {}
    local slug = collSettings.gallerySlug
    -- Was `publishSettings.host`, which does not exist -- the host is set in
    -- the plug-in's own settings (PluginManager), not in the publish service
    -- settings. That is why "Show in Lumio" could never have worked.
    local host = (LrPrefs.prefsForPlugin().host or ""):gsub("/+$", "")

    -- The slug is missing if the gallery was picked from the dropdown (it was
    -- only stored when creating a new one). Look it up in the cache by galleryId.
    if (not slug or slug == "") and collSettings.galleryId then
        local prefs = LrPrefs.prefsForPlugin()
        if type(prefs.galleryCacheJson) == "string" and prefs.galleryCacheJson ~= "" then
            local okDecode, cached = pcall(json.decode, prefs.galleryCacheJson)
            if okDecode and type(cached) == "table" then
                for _, g in ipairs(cached) do
                    if g.id == collSettings.galleryId then slug = g.slug break end
                end
            end
        end
    end

    if not slug or slug == "" or host == "" then
        LrDialogs.message("Lumio",
            "Gallery slug or host is missing. Publish the collection once, " ..
            "or set the server address in Plug-in Manager.", "warning")
        return
    end
    -- Public-Galerie-URL
    LrHttp.openUrlInBrowser(host:gsub("/+$", "") .. "/g/" .. slug)
end

return exportServiceProvider
