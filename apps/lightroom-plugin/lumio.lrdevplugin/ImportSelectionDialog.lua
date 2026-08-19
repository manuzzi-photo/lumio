--[[
    ImportSelectionDialog.lua

    Wird vom Menüpunkt "Lumio-Auswahl importieren…" aufgerufen.

    Flow:
      1. Galerie-Liste vom Server holen
      2. Modal: User wählt eine Galerie aus + Optionen (was anwenden:
         Pick-Flag, Sterne, Color-Label)
      3. ImportSelectionTask.run() startet die eigentliche Anwendung
]]

local LrTasks          = import "LrTasks"
local LrDialogs        = import "LrDialogs"
local LrFunctionContext = import "LrFunctionContext"
local LrView           = import "LrView"
local LrBinding        = import "LrBinding"
local LrPrefs          = import "LrPrefs"

local LumioApi = require "LumioApi"
local Task     = require "ImportSelectionTask"
local log      = require "Logger"

LrTasks.startAsyncTask(function()
    LrFunctionContext.callWithContext("ImportSelectionDialog", function(context)

        -- Galerien laden, mit User-friendly Error
        local ok, galleries = LrTasks.pcall(LumioApi.listGalleries)
        if not ok then
            LrDialogs.message(
                "Lumio: connection failed",
                tostring(galleries):gsub("^.-: ", ""),
                "critical"
            )
            return
        end
        if #galleries == 0 then
            LrDialogs.message(
                "Lumio",
                "No galleries found. Create one in the studio, or check " ..
                "that the token belongs to the right user."
            )
            return
        end

        -- View bauen
        local props = LrBinding.makePropertyTable(context)
        local prefs = LrPrefs.prefsForPlugin()

        -- Galerien-Optionen für popup_menu
        local galleryItems = {}
        for _, g in ipairs(galleries) do
            table.insert(galleryItems, {
                title = g.title .. "  (" .. g.fileCount .. " Files, " .. g.mode .. ")",
                value = g.id,
            })
        end

        props.galleryId      = prefs.lastGalleryId or galleries[1].id
        props.applyPick      = prefs.applyPick      ~= false  -- default true
        props.applyLikes     = prefs.applyLikes     ~= false
        props.applyRating    = prefs.applyRating    ~= false
        props.applyColor     = prefs.applyColor     ~= false
        props.matchScope     = prefs.matchScope     or "library"

        local f = LrView.osFactory()

        local contents = f:column {
            bind_to_object = props,
            spacing = f:control_spacing(),

            f:row {
                f:static_text {
                    title = "Gallery:",
                    width = 100,
                },
                f:popup_menu {
                    items = galleryItems,
                    value = LrView.bind("galleryId"),
                    width_in_chars = 50,
                },
            },

            f:separator { fill_horizontal = 1 },

            f:static_text {
                title = "What to import?",
                font = "<system/bold>",
            },
            f:checkbox {
                title = "Set picks as Lightroom flags",
                value = LrView.bind("applyPick"),
            },
            f:checkbox {
                title = "Likes as 1-star rating (in addition to picks)",
                value = LrView.bind("applyLikes"),
            },
            f:checkbox {
                title = "Apply ratings (1–5 stars)",
                value = LrView.bind("applyRating"),
            },
            f:checkbox {
                title = "Apply colour labels",
                value = LrView.bind("applyColor"),
            },

            f:separator { fill_horizontal = 1 },

            f:static_text {
                title = "Match by filename:",
                font = "<system/bold>",
            },
            f:radio_button {
                title    = "In the whole catalog",
                value    = LrView.bind("matchScope"),
                checked_value = "library",
            },
            f:radio_button {
                title    = "Only in the active collection",
                value    = LrView.bind("matchScope"),
                checked_value = "collection",
            },

            f:static_text {
                title = "Note: Lumio matches on the original filename. If you have renamed " ..
                        "the files, they cannot be found.",
                width_in_chars = 70,
                height_in_lines = 2,
                size = "small",
            },
        }

        local result = LrDialogs.presentModalDialog {
            title = "Import Lumio selection",
            contents = contents,
            resizable = false,
        }
        if result ~= "ok" then return end

        -- Auswahl in Prefs für nächstes Mal merken
        prefs.lastGalleryId = props.galleryId
        prefs.applyPick     = props.applyPick
        prefs.applyLikes    = props.applyLikes
        prefs.applyRating   = props.applyRating
        prefs.applyColor    = props.applyColor
        prefs.matchScope    = props.matchScope

        log:info("starting import for gallery " .. tostring(props.galleryId))
        Task.run({
            galleryId   = props.galleryId,
            applyPick   = props.applyPick,
            applyLikes  = props.applyLikes,
            applyRating = props.applyRating,
            applyColor  = props.applyColor,
            matchScope  = props.matchScope,
        })
    end)
end)
