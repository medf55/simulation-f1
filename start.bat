@echo off
title Lancement du Grand Prix F1 - Steering Behaviors
echo ==============================================================
echo    DEMARRAGE DU GRAND PRIX F1 (Steering Behaviors & IA)
echo ==============================================================
echo.
echo Demarrage du serveur local sur le port 8080...
start "" "http://localhost:8080/"

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Serveur lance avec Python 3...
    python -m http.server 8080
    goto end
)

where npx >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Serveur lance avec Node.js (npx serve)...
    npx -y serve -l 8080 .
    goto end
)

echo [AVERTISSEMENT] Ni Python ni Node.js n'ont ete trouves.
echo Ouverture directe de la page HTML dans le navigateur...
start "" "index.html"

:end
pause
