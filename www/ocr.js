/* ocr.js — přepis fotky na text (Tesseract.js) + odhad, které řádky
   jsou tučné (pro návrh správné odpovědi).

   PŘEDZPRACOVÁNÍ OBRAZU (nové):
   Než fotku pošleme do OCR, projde třemi kroky, které přesnost čtení
   z fotky mobilem zásadně zlepšují:
     1) Sjednocení velikosti — text na fotce z mobilu je často buď
        zbytečně malý (OCR nemá dost detailu), nebo naopak obří
        (zpomaluje zpracování) → sjednotíme na optimální rozlišení.
     2) Převod na šedotón.
     3) Adaptivní černobílé prahování (Bradleyho metoda) — na rozdíl
        od jednoho pevného prahu pro celou fotku počítá práh zvlášť
        pro každou malou oblast, takže si poradí i se stínem přes půl
        stránky nebo nerovnoměrným osvětlením, což bývá hlavní důvod
        špatného přepisu z fotky mobilem.

   Tučnost stále neposuzujeme podle Tesseractu (nespolehlivé), ale
   vlastní heuristikou: pro řádek spočítáme podíl "inkoustu" (tmavých
   pixelů) na stejném (už předzpracovaném) obrázku, ze kterého čte
   i OCR — takže souřadnice sedí. */

const OCR = (() => {
  const TARGET_MIN_SIDE = 1500; // pod touto hranicí fotku zvětšíme
  const TARGET_MAX_SIDE = 2400; // nad touto hranicí naopak zmenšíme (rychlost)

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /* Krok 1+2: nakreslí fotku do canvasu v optimální velikosti a rovnou
     převede na šedotón. Vrací canvas + jeho 2D kontext. */
  function drawScaledGray(img) {
    const longSide = Math.max(img.naturalWidth, img.naturalHeight);
    let scale = 1;
    if (longSide < TARGET_MIN_SIDE) scale = TARGET_MIN_SIDE / longSide;
    else if (longSide > TARGET_MAX_SIDE) scale = TARGET_MAX_SIDE / longSide;

    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(imageData, 0, 0);
    return { canvas, ctx, w, h };
  }

  /* Krok 3: adaptivní prahování přes integrální obraz (Bradleyho metoda).
     Pro každý pixel porovná jeho jas s průměrem okolí (ne s pevnou
     hodnotou pro celou fotku) — díky tomu funguje i na nerovnoměrně
     nasvícené fotce z mobilu. */
  function adaptiveThreshold(ctx, w, h) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const gray = new Float64Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) gray[p] = d[i];

    const integral = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += gray[y * w + x];
        integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
      }
    }

    const s = Math.max(15, Math.round(w / 8));
    const half = Math.floor(s / 2);
    const t = 0.15;

    for (let y = 0; y < h; y++) {
      const y1 = Math.max(0, y - half);
      const y2 = Math.min(h - 1, y + half);
      for (let x = 0; x < w; x++) {
        const x1 = Math.max(0, x - half);
        const x2 = Math.min(w - 1, x + half);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum =
          integral[(y2 + 1) * (w + 1) + (x2 + 1)] -
          integral[(y1) * (w + 1) + (x2 + 1)] -
          integral[(y2 + 1) * (w + 1) + (x1)] +
          integral[(y1) * (w + 1) + (x1)];

        const p = y * w + x;
        const isInk = gray[p] * count < sum * (1 - t);
        const v = isInk ? 0 : 255;
        const di = p * 4;
        d[di] = d[di + 1] = d[di + 2] = v;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function inkDensityForRect(ctx, x, y, w, h) {
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    let data;
    try {
      data = ctx.getImageData(x, y, w, h).data;
    } catch (e) {
      return 0;
    }
    let ink = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) ink++;
    return ink / n;
  }

  /* Připraví fotku pro OCR — vrací canvas i s jeho kontextem, aby šel
     použít jak pro Tesseract, tak (na stejných souřadnicích) pro
     odhad tučnosti řádků. */
  async function preprocess(imageSrc) {
    const img = await loadImage(imageSrc);
    const { canvas, ctx, w, h } = drawScaledGray(img);
    adaptiveThreshold(ctx, w, h);
    return { canvas, ctx };
  }

  async function recognize(imageSrc, onProgress) {
    const { canvas, ctx } = await preprocess(imageSrc);

    const { data } = await Tesseract.recognize(canvas, 'ces', {
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text' && typeof m.progress === 'number') {
          onProgress(m.progress);
        }
      },
    });

    const rawLines = (data.lines || []);
    const lines = rawLines
      .map((l) => {
        const text = (l.text || '').trim();
        if (!text) return null;
        const { x0, y0, x1, y1 } = l.bbox;
        const bold = inkDensityForRect(ctx, x0, y0, x1 - x0, y1 - y0);
        const confidence = typeof l.confidence === 'number' ? l.confidence : 100;
        // Pozice řádku jako % výšky obrázku — nezávislé na tom, jak moc
        // se fotka uvnitř zvětšila/zmenšila, takže se dá přímo porovnávat
        // s procentuální pozicí oblastí, které uživatel označil ručně.
        const yTop = (y0 / canvas.height) * 100;
        const yBottom = (y1 / canvas.height) * 100;
        return { text, bold, confidence, yTop, yBottom };
      })
      .filter(Boolean);

    return { rawText: data.text || '', lines };
  }

  return { recognize, preprocess, loadImage };
})();
