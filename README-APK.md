# Přijímačky – APK

Tento projekt zabalí původní webovou aplikaci do Android aplikace pomocí Capacitoru.

## Co je potřeba

- Node.js + npm
- Android Studio
- Android SDK / Build Tools
- Java JDK kompatibilní s aktuálním Android Gradle pluginem

## Vytvoření Android projektu

V kořeni tohoto projektu spusť:

```bash
npm install
npx cap add android
npx cap sync android
```

Potom můžeš otevřít projekt v Android Studiu:

```bash
npx cap open android
```

V Android Studiu lze aplikaci spustit na telefonu nebo vytvořit APK.

Pro debug APK z příkazové řádky:

```bash
cd android
./gradlew assembleDebug
```

Výsledný soubor bude typicky v:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Důležité

Webová aplikace používá IndexedDB a vlastní JavaScriptové soubory, které jsou v adresáři `www`.

OCR knihovna Tesseract.js je v původním `index.html` načítána z CDN. Proto je pro OCR v této verzi potřeba internetové připojení. Ostatní lokální části aplikace jsou zabalené přímo v APK.

## Ikona

Používají se původní `icon-192.png` a `icon-512.png`. Pro produkční APK může Android Studio/Capacitor vygenerovat nativní sadu ikon z 512px ikony.


### Vestavěné otázky

Soubor `www/seed-data.js` obsahuje 3 vestavěné dávky (celkem 3 036 otázek).
Při startu aplikace se dávky importují do IndexedDB. Dávka se do `seededBatches`
zapíše až po úspěšném dokončení importu, takže při chybě se při dalším spuštění
automaticky zkusí znovu.
