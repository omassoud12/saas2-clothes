@echo off
set "PATH=%~dp0.tools\node-v24.20.0-win-x64;%PATH%"
call npm.cmd run dev
