/* geometry.js — perspektivní transformace (homografie).

   Používá se pro "narovnání" fotky, kde stránka není vyfocená kolmo
   (je nakřivo/lichoběžníkově zkreslená). Uživatel označí 4 rohy
   textu na fotce (mohou svírat libovolné, ne jen pravé úhly) a tady
   spočítáme transformaci, která tenhle čtyřúhelník "narovná" do
   pravoúhlého obdélníku — teprve TOHLE jde do OCR, což výrazně
   pomáhá přesnosti u fotek pořízených z boku nebo shora pod úhlem. */

const Geometry = (() => {
  /* Vyřeší soustavu lineárních rovnic Ax = b Gaussovou eliminací
     s částečnou pivotací. A je pole polí (n×n), b je pole (n). */
  function solveLinear(A, b) {
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);

    for (let col = 0; col < n; col++) {
      let pivotRow = col;
      let maxVal = Math.abs(M[col][col]);
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > maxVal) {
          maxVal = Math.abs(M[r][col]);
          pivotRow = r;
        }
      }
      if (maxVal < 1e-12) continue; // téměř singulární — degenerovaný výběr
      [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
      const pivot = M[col][col];
      for (let c = col; c <= n; c++) M[col][c] /= pivot;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col];
        if (factor === 0) continue;
        for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
      }
    }
    return M.map(row => row[n]);
  }

  /* Spočítá projektivní transformaci (8 stupňů volnosti) mapující
     4 body "from" na 4 body "to". Vrací pole [a,b,c,d,e,f,g,h] tak, že:
       X = (a*x + b*y + c) / (g*x + h*y + 1)
       Y = (d*x + e*y + f) / (g*x + h*y + 1) */
  function computeHomography(from, to) {
    const A = [];
    const bvec = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = from[i];
      const { x: X, y: Y } = to[i];
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
      bvec.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
      bvec.push(Y);
    }
    return solveLinear(A, bvec);
  }

  /* "Narovná" čtyřúhelník quad (4 body [TL,TR,BR,BL] v pixelech
     zdrojového canvasu) do nového obdélníkového canvasu o rozměrech
     outW×outH. Používá bilineární vzorkování pro hladký výsledek. */
  function warpQuadToRect(srcCanvas, quad, outW, outH) {
    const sw = srcCanvas.width;
    const sh = srcCanvas.height;
    const srcCtx = srcCanvas.getContext('2d');
    const srcData = srcCtx.getImageData(0, 0, sw, sh).data;

    const dstRect = [
      { x: 0, y: 0 }, { x: outW, y: 0 },
      { x: outW, y: outH }, { x: 0, y: outH },
    ];
    // mapování cíl -> zdroj (přesně to, co potřebujeme pro vzorkování)
    const H = computeHomography(dstRect, quad);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');
    const outImageData = outCtx.createImageData(outW, outH);
    const outData = outImageData.data;

    function sample(sx, sy) {
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) return [255, 255, 255, 255];
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const out = [0, 0, 0, 255];
      for (let k = 0; k < 3; k++) {
        const top = srcData[i00 + k] * (1 - fx) + srcData[i10 + k] * fx;
        const bot = srcData[i01 + k] * (1 - fx) + srcData[i11 + k] * fx;
        out[k] = top * (1 - fy) + bot * fy;
      }
      return out;
    }

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const denom = H[6] * x + H[7] * y + 1;
        const sx = (H[0] * x + H[1] * y + H[2]) / denom;
        const sy = (H[3] * x + H[4] * y + H[5]) / denom;
        const [r, g, b, a] = sample(sx, sy);
        const di = (y * outW + x) * 4;
        outData[di] = r; outData[di + 1] = g; outData[di + 2] = b; outData[di + 3] = a;
      }
    }
    outCtx.putImageData(outImageData, 0, 0);
    return outCanvas;
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /* Odhadne rozumnou velikost výstupu z délek stran čtyřúhelníku. */
  function outputSizeFromQuad(quad) {
    const [tl, tr, br, bl] = quad;
    const w = Math.round((dist(tl, tr) + dist(bl, br)) / 2);
    const h = Math.round((dist(tl, bl) + dist(tr, br)) / 2);
    return {
      w: Math.min(3000, Math.max(200, w)),
      h: Math.min(3000, Math.max(200, h)),
    };
  }

  return { computeHomography, warpQuadToRect, outputSizeFromQuad, solveLinear };
})();
