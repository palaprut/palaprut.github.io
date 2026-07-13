@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File .\merge.ps1
echo Done! Press any key to exit...
pause

@REM commcand
@REM .\run.bat