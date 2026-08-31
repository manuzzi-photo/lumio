--[[
    Logger.lua

    Thin wrapper around LrLogger. Writes to
    `~/Documents/LrClassicLogs/Lumio.log` (macOS) resp.
    `%USERPROFILE%\Documents\LrClassicLogs\Lumio.log` (Windows).

    Usage:
        local log = require "Logger"
        log:trace("debug")
        log:info("info")
        log:warn("warning")
        log:error("error")
]]

local LrLogger = import "LrLogger"

local logger = LrLogger("Lumio")
logger:enable("logfile")

return logger
