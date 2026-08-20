--[[
    ImportSelectionTask.lua

    Holt die aggregierte Auswahl einer Lumio-Galerie und schreibt sie in
    den aktiven Lightroom-Katalog. Match erfolgt anhand des
    Original-Dateinamens (case-insensitive).

    Mapping:
      Lumio picked=true   →  photo:setRawMetadata("pickStatus", 1)
      Lumio liked=true    →  Rating = max(rating, 1)
      Lumio rating=N      →  photo:setRawMetadata("rating", N)
      Lumio color=red/yellow/green
                          →  photo:setRawMetadata("colorNameForLabel", ...)

    Color-Label-Mapping: in Lumio gibt es derzeit red/yellow/green;
    Lightroom kennt Red/Yellow/Green/Blue/Purple. Wir mappen 1:1.
]]

local LrApplication    = import "LrApplication"
local LrPathUtils      = import "LrPathUtils"
local LrTasks          = import "LrTasks"
local LrFunctionContext = import "LrFunctionContext"
local LrProgressScope  = import "LrProgressScope"
local LrDialogs        = import "LrDialogs"

local LumioApi = require "LumioApi"
local log      = require "Logger"

local M = {}

local COLOR_MAP = {
    red    = "Red",
    yellow = "Yellow",
    green  = "Green",
}

-- Index aufbauen: lowercase filename → photo. Wenn mehrere Photos denselben
-- Dateinamen haben (z.B. zwei Kameras mit DSC_0001.NEF im selben Katalog),
-- speichern wir alle und matchen jeden Lumio-File gegen ALLE Treffer.
local function buildIndex(photos)
    local byFull, byBase = {}, {}
    for _, p in ipairs(photos) do
        local fname = p:getFormattedMetadata("fileName")
        if fname then
            local full = fname:lower()
            byFull[full] = byFull[full] or {}
            table.insert(byFull[full], p)

            -- Also index the extension-less basename; see findMatches.
            local base = LrPathUtils.removeExtension(fname):lower()
            byBase[base] = byBase[base] or {}
            table.insert(byBase[base], p)
        end
    end
    return { byFull = byFull, byBase = byBase }
end

-- CRITICAL. Publishing forces the uploaded name to "<basename>.jpg"
-- (LumioPublishService.lua:308) and the server stores it verbatim. Import,
-- on the other hand, indexed the catalog by its REAL filename including the
-- extension, so "int_4325.jpg" could never match the catalog's
-- "int_4325.nef". Measured on a real catalog: dng 1083, nef 967, jpg 91,
-- tif 7 -> 95.8 % of the photos would NEVER have been found.
-- Now: try the exact name first, then the extension-less basename.
-- Returns (photos, kind) where kind is "ok" | "ambiguous" | "none".
local function findMatches(idx, filename)
    local fn = (filename or ""):lower()
    if fn == "" then return nil, "none" end

    -- Publishing ALWAYS sends the name as "<basename>.jpg", so both the exact
    -- name and the basename are relevant. Collect both and only then decide --
    -- returning on the first exact hit would let an exported JPEG in the
    -- catalog win over the RAW master.
    local candidates, seen = {}, {}
    local function add(list)
        for _, p in ipairs(list or {}) do
            if not seen[p] then seen[p] = true; table.insert(candidates, p) end
        end
    end
    add(idx.byFull[fn])
    add(idx.byBase[LrPathUtils.removeExtension(fn)])
    if #candidates == 0 then return nil, "none" end

    -- Prefer the master (RAW/DNG/TIF) over an exported copy
    local masters = {}
    for _, p in ipairs(candidates) do
        local n = (p:getFormattedMetadata("fileName") or ""):lower()
        if not n:match("%.jpe?g$") then table.insert(masters, p) end
    end
    local chosen = (#masters > 0) and masters or candidates

    -- Several masters sharing one basename = e.g. the same shot as both .NEF
    -- and .DNG, two cameras with the same running number, or virtual copies.
    -- We cannot know which one the client's selection refers to, so we write
    -- to NONE of them -- a silent multi-write is worse than a skip.
    if #chosen > 1 then return chosen, "ambiguous" end
    return chosen, "ok"
end

local function applyOne(photo, file, opts)
    -- Pick-Flag
    if opts.applyPick and file.picked then
        photo:setRawMetadata("pickStatus", 1)  -- 1 = picked, 0 = none, -1 = rejected
    end

    -- Rating: explicit rating gewinnt; Likes geben mindestens 1 Stern, falls
    -- noch kein Rating gesetzt ist
    if opts.applyRating and file.rating and file.rating > 0 then
        photo:setRawMetadata("rating", file.rating)
    elseif opts.applyLikes and file.liked then
        local current = photo:getRawMetadata("rating") or 0
        if current < 1 then
            photo:setRawMetadata("rating", 1)
        end
    end

    -- Color-Label
    if opts.applyColor and file.color then
        local lr = COLOR_MAP[file.color]
        if lr then
            photo:setRawMetadata("colorNameForLabel", lr)
        end
    end
end

function M.run(opts)
    LrTasks.startAsyncTask(function()
        LrFunctionContext.callWithContext("ImportSelectionTask", function(context)

            local catalog = LrApplication.activeCatalog()
            local progress = LrProgressScope {
                title = "Importing Lumio selection",
                functionContext = context,
            }
            progress:setCancelable(true)

            -- 1. Selection vom Server holen
            progress:setCaption("Loading selection from Lumio…")
            local ok, data = LrTasks.pcall(LumioApi.getSelection, opts.galleryId)
            if not ok or not data then
                LrDialogs.message(
                    "Lumio",
                    tostring(data):gsub("^.-: ", ""),
                    "critical"
                )
                return
            end

            local files = data.files or {}
            if #files == 0 then
                LrDialogs.message(
                    "Lumio",
                    "This gallery has no files with status 'ready' yet."
                )
                return
            end

            -- 2. Photo-Pool bestimmen
            progress:setCaption("Searching catalog…")
            local pool
            if opts.matchScope == "collection" then
                local sources = catalog:getActiveSources()
                pool = {}
                for _, source in ipairs(sources) do
                    -- getPhotos auf Collection / Folder funktioniert beides
                    if source.getPhotos then
                        for _, p in ipairs(source:getPhotos()) do
                            table.insert(pool, p)
                        end
                    end
                end
                if #pool == 0 then
                    LrDialogs.message(
                        "Lumio",
                        "The active collection is empty. Choose another one or " ..
                        "switch to 'In the whole catalog'."
                    )
                    return
                end
            else
                pool = catalog:getAllPhotos()
            end

            local idx = buildIndex(pool)

            -- 3. Pro File matchen und Metadaten anwenden — alles innerhalb
            --    EINER withWriteAccessDo, damit der User es als einzigen
            --    Undo-Step rückgängig machen kann.
            local matchedFiles = 0
            local matchedPhotos = 0
            local missing = {}

            -- The whole transaction had no error handling. Any exception (most
            -- commonly: the catalog write lock is unavailable because another
            -- operation holds it) ended up in LR's generic "An internal error
            -- has occurred" dialog -- no log, no summary, and no indication of
            -- whether anything had been written to the catalog at all.
            -- Now: pcall + timeout, and progress:done() plus the summary ALWAYS run.
            local ambiguousList, applyErrors, canceled = {}, 0, false

            local okTx, txErr = LrTasks.pcall(function()
                catalog:withWriteAccessDo("Lumio-Auswahl importieren", function()
                    for i, file in ipairs(files) do
                        if progress:isCanceled() then canceled = true break end

                        progress:setPortionComplete(i, #files)
                        progress:setCaption(
                            "Wende Auswahl an (" .. i .. "/" .. #files .. ")"
                        )

                        local matches, kind = findMatches(idx, file.filename)
                        if kind == "none" then
                            table.insert(missing, file.filename)
                        elseif kind == "ambiguous" then
                            table.insert(ambiguousList,
                                string.format("%s (%d photos)", file.filename, #matches))
                        else
                            matchedFiles = matchedFiles + 1
                            for _, photo in ipairs(matches) do
                                -- This used to be a plain pcall, on the assumption
                                -- that applyOne does not yield. That was wrong: the
                                -- log proved "Yielding is not allowed within a C or
                                -- metamethod call". photo:getRawMetadata and
                                -- setRawMetadata ARE yielding catalog operations, so
                                -- every write that carried real data failed silently
                                -- (57 "successes" were no-ops).
                                local okApply, applyErr = LrTasks.pcall(applyOne, photo, file, opts)
                                if okApply then
                                    matchedPhotos = matchedPhotos + 1
                                else
                                    applyErrors = applyErrors + 1
                                    log:warn(string.format("applyOne failed for %s (%s): %s",
                                        tostring(file.filename),
                                        tostring(photo:getFormattedMetadata("fileName")),
                                        tostring(applyErr)))
                                end
                            end
                        end
                    end
                end, { timeout = 30 })
            end)

            progress:done()

            if not okTx then
                log:error("import transaction failed: " .. tostring(txErr))
                LrDialogs.message(
                    "Lumio import failed",
                    "The catalog could not be updated:\n\n" .. tostring(txErr) ..
                    "\n\nThis usually means another operation is holding the " ..
                    "catalog lock. Close other dialogs and try again.",
                    "critical"
                )
                return
            end

            -- 4. Zusammenfassung
            local summary = string.format(
                "Imported for %d of %d files (%d photos updated in the catalog).",
                matchedFiles, #files, matchedPhotos
            )
            if canceled then
                summary = "IMPORT WAS CANCELED.\n\n" .. summary ..
                    "\n\nWhat was already written stays in the catalog — " ..
                    "undo it with Cmd+Z if you want it reverted."
            end
            if #ambiguousList > 0 then
                summary = summary .. string.format(
                    "\n\n%d filename(s) SKIPPED because they matched several " ..
                    "photos (e.g. the same shot as both NEF and DNG, or virtual " ..
                    "copies). Nothing was written for these — pick the right " ..
                    "photo by hand:\n", #ambiguousList)
                for i = 1, math.min(10, #ambiguousList) do
                    summary = summary .. "  • " .. ambiguousList[i] .. "\n"
                end
                if #ambiguousList > 10 then
                    summary = summary .. "  …and " .. (#ambiguousList - 10) .. " more"
                end
            end
            if applyErrors > 0 then
                summary = summary .. string.format(
                    "\n\n%d photo(s) could not be updated.", applyErrors)
            end
            if #missing > 0 then
                summary = summary .. "\n\nNot found:\n"
                for i = 1, math.min(20, #missing) do
                    summary = summary .. "  • " .. missing[i] .. "\n"
                end
                if #missing > 20 then
                    summary = summary .. "  …and " .. (#missing - 20) .. " more"
                end
            end

            log:info("import done: " .. summary:gsub("\n", " | "))
            LrDialogs.message("Lumio import finished", summary)
        end)
    end)
end

return M
