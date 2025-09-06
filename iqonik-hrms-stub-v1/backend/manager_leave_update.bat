@echo off
setlocal enabledelayedexpansion

REM === CONFIGURATION ===
set EMAIL=manager@example.com
set PASSWORD=yourpassword
set LEAVEID=abcd-uuid
set STATUS=APPROVED
set BASEURL=http://localhost:8080

REM === STEP 1: LOGIN AND GET TOKEN ===
for /f "tokens=* delims=" %%a in ('curl -s -X POST %BASEURL%/auth/login -H "Content-Type: application/json" -d "{\"email\":\"%EMAIL%\",\"password\":\"%PASSWORD%\"}"') do set RESPONSE=%%a

REM Extract token from JSON (quick hack: remove braces and quotes)
set TOKEN=!RESPONSE:*"token":"=!
set TOKEN=!TOKEN:"=!
for /f "delims=}" %%b in ("!TOKEN!") do set TOKEN=%%b

echo Retrieved Token: %TOKEN%

REM === STEP 2: APPROVE / REJECT LEAVE ===
curl -X PUT %BASEURL%/api/leave/%LEAVEID%/status ^
  -H "Authorization: Bearer %TOKEN%" ^
  -H "Content-Type: application/json" ^
  -d "{\"status\":\"%STATUS%\"}"

pause
