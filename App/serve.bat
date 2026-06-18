@echo off
echo.
echo  ============================================
echo   SPEEDY SEED INSURANCE - Local Server
echo  ============================================
echo.
echo  Starting server on http://localhost:8765
echo.
echo  To use on your phone:
echo    1. Connect phone to same WiFi as this PC
echo    2. Open browser on phone and go to:
echo       http://[this-PC-IP-address]:8765
echo    3. On iPhone: tap Share > Add to Home Screen
echo    4. On Android: tap menu > Add to Home Screen
echo.
echo  Press CTRL+C to stop the server.
echo.
python -m http.server 8765
pause
