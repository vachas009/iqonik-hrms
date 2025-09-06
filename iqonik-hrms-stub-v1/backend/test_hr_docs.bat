@echo off
setlocal enabledelayedexpansion

REM === CONFIGURATION ===
set EMAIL=hr@example.com
set PASSWORD=yourpassword
set DOCID=1234-uuid
set ACTION=approved
set BASEURL=http://localhost:8080

REM === STEP 1: LOGIN AND GET TOKEN ===
for /f "tokens=* delims=" %%a in ('curl -s -X POST %BASEURL%/auth/login -H "Content-Type: application/json" -d "{\"email\":\"%EMAIL%\",\"password\":\"%PASSWORD%\"}"') do set RESPONSE=%%a

REM Extract token from JSON (quick hack: remove braces and quotes)
set TOKEN=!RESPONSE:*"token":"=!
set TOKEN=!TOKEN:"=!
for /f "delims=}" %%b in ("!TOKEN!") do set TOKEN=%%b

echo Retrieved Token: %TOKEN%

REM === STEP 2: APPROVE / REJECT DOC ===
curl -X POST %BASEURL%/api/hr/docs/update ^
  -H "Authorization: Bearer %TOKEN%" ^
  -H "Content-Type: application/json" ^
  -d "{\"docId\":\"%DOCID%\",\"action\":\"%ACTION%\"}"

pause
