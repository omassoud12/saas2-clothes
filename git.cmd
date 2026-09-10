@echo off
"%~dp0.tools\git\cmd\git.exe" -c safe.directory="%~dp0." %*
