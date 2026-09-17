/* parse.js — rozdělí surový OCR text jedné otázky na text otázky
   a jednotlivé možnosti odpovědi.

   Očekávaný vstup je text jedné otázky, např.:
     1. Jaké je hlavní město Francie?
     a) Berlín
     b) Paříž
     c) Madrid

   Podporované uvozovací znaky možností: a) b) c)  /  a. b. c.  /  - • *  / 1) 2) 3)
   Pokud se nic nepozná, vrátí celý text jako otázku bez možností —
   uživatel si pak možnosti doplní/rozdělí ručně v potvrzovací obrazovce. */

const Parser = (() => {
  // Možnosti odpovědí poznáváme podle písmenného / odrážkového uvození
  // (a) b) c) / a. b. / - • *). Číselné uvození (1. 2. 3.) záměrně
  // nepovažujeme za odpověď, protože stejným způsobem bývá číslovaná
  // samotná otázka — viz QUESTION_START níže.
  // Skupina 1 = písmeno (pokud jde o písmenné uvození), skupina 2 = text možnosti.
  const OPTION_LINE = /^\s*(?:([a-zA-Z])[\).]|[-•*])\s*(.*\S)\s*$/;

  // Řádky, které OCR vytvoří z kresby (chemický vzorec, schéma) místo
  // skutečného textu, bývají krátké a s nízkou jistotou. Takové rovnou
  // zahazujeme, ať nezpůsobí falešné rozdělení na dvě otázky (viz níže).
  const NOISE_CONF_FLOOR = 20;
  const SHORT_LEN = 2;
  const SHORT_CONF_FLOOR = 65;

  function isNoiseLine(l) {
    const conf = typeof l.confidence === 'number' ? l.confidence : 100;
    const len = l.text.trim().length;
    if (conf < NOISE_CONF_FLOOR) return true;
    if (len <= SHORT_LEN && conf < SHORT_CONF_FLOOR) return true;
    return false;
  }

  function splitLines(raw) {
    return raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);
  }

  function parseQuestionBlock(raw) {
    const lines = splitLines(raw);
    if (lines.length === 0) return { question: '', options: [] };

    const optionLines = [];
    const questionLines = [];
    let seenOption = false;

    for (const line of lines) {
      const m = line.match(OPTION_LINE);
      if (m) {
        seenOption = true;
        optionLines.push(m[2]);
      } else if (!seenOption) {
        questionLines.push(line.replace(/^\s*\d+[\).]\s*/, ''));
      } else if (optionLines.length > 0) {
        optionLines[optionLines.length - 1] += ' ' + line;
      }
    }

    return {
      question: questionLines.join(' ').trim(),
      options: optionLines.map(t => ({ text: t.trim() })),
    };
  }

  /* Rozdělí celý přepsaný text z fotky (může obsahovat víc otázek najednou)
     na bloky - odděluje bloky podle řádků, které vypadají jako začátek nové
     otázky (číslo následované tečkou/závorkou). Pokud je otázka jen jedna,
     vrátí jeden blok = celý text. */
  function splitIntoQuestionBlocks(raw) {
    const lines = splitLines(raw);
    const blocks = [];
    let current = [];
    const QUESTION_START = /^\s*\d+[\).]\s+\S/;

    for (const line of lines) {
      if (QUESTION_START.test(line) && current.length > 0) {
        blocks.push(current.join('\n'));
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) blocks.push(current.join('\n'));
    return blocks.length > 0 ? blocks : [raw];
  }

  /* Vyhodnotí, které možnosti v rámci JEDNÉ otázky vypadají tučně
     výrazněji než ostatní (na základě "bold" skóre z ocr.js) a označí
     je jako suggestedCorrect = true. Je to jen NÁVRH — uživatel ho
     v potvrzovací obrazovce vidí předzaškrtnutý a může ho opravit. */
  function scoreOptions(options) {
    if (options.length === 0) return options;
    const scores = options.map(o => o.bold || 0);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / scores.length;
    const std = Math.sqrt(variance);
    const threshold = mean + 0.4 * std;
    return options.map(o => ({
      text: o.text,
      bold: o.bold,
      confidence: o.confidence,
      suggestedCorrect: std > 0.008 && (o.bold || 0) > threshold && (o.bold || 0) > mean * 1.08,
    }));
  }

  function letterIndex(letter) {
    if (!letter) return -1;
    return letter.toLowerCase().charCodeAt(0) - 97; // a=0, b=1, c=2...
  }

  /* Hlavní vstupní bod pro fotky: staví otázky přímo z řádků vrácených
     OCR enginem (viz ocr.js).

     Dvě vylepšení oproti naivnímu "další netextový řádek = nová otázka":

     1) Řádky, které vypadají jako šum z kresby/vzorce (krátké, nejistý
        OCR), se rovnou zahazují — nemůžou tak omylem založit falešnou
        "možnost" a rozseknout otázku na dvě.

     2) Když po nějaké možnosti přijde řádek bez uvozovacího písmene,
        NEROZHODUJEME hned. Počkáme na další řádek, který JE možností:
        - pokud pokračuje v abecedním pořadí (za b) přišlo c) tak, jak
          má) → ten "osamocený" řádek byl jen zalomení dlouhé
          předchozí odpovědi na 2 řádky → přilepí se zpátky k ní.
        - pokud se písmeno vrátí zpátky na a) (nebo jinam mimo pořadí)
          → jde opravdu o novou otázku a "osamocené" řádky jsou její
          začátek.
  */
  function buildQuestionsFromOcrLines(lineObjs) {
    const lines = lineObjs.filter(l => !isNoiseLine(l));
    const blocks = [];
    let qLines = [];
    let options = [];
    let pending = [];

    function flush() {
      if (qLines.length === 0 && options.length === 0) return;
      blocks.push({ qLines, options });
      qLines = [];
      options = [];
    }

    function cleanText(t) {
      return t.replace(/^\s*\d+[\).]\s*/, '');
    }

    for (const line of lines) {
      const conf = typeof line.confidence === 'number' ? line.confidence : 100;
      const yTop = typeof line.yTop === 'number' ? line.yTop : null;
      const yBottom = typeof line.yBottom === 'number' ? line.yBottom : null;
      const m = line.text.match(OPTION_LINE);

      if (m) {
        const letter = m[1];
        const text = m[2];
        const lastLetter = options.length ? options[options.length - 1].letter : null;
        const expectedNext = lastLetter ? letterIndex(lastLetter) + 1 : 0;
        const isSequential = letter ? letterIndex(letter) === expectedNext : options.length === 0;

        if (pending.length > 0) {
          if (options.length > 0 && isSequential) {
            // "osamocené" řádky byly jen zalomení PŘEDCHOZÍ možnosti
            const contText = pending.map(p => p.text).join(' ');
            options[options.length - 1].text = (options[options.length - 1].text + ' ' + contText).trim();
            options[options.length - 1].yBottom = pending[pending.length - 1].yBottom ?? options[options.length - 1].yBottom;
          } else {
            // opravdu nová otázka — osamocené řádky jsou její začátek
            flush();
            qLines.push(...pending);
          }
          pending = [];
        }

        options.push({ letter, text: text.trim(), bold: line.bold || 0, confidence: conf, yTop, yBottom });
      } else if (options.length === 0) {
        // ještě žádná možnost -> patří k (případně víceřádkovému) textu otázky
        qLines.push({ text: cleanText(line.text), confidence: conf, yTop, yBottom });
      } else {
        // po nějaké možnosti přišel netextový řádek — počkáme, co bude dál
        pending.push({ text: cleanText(line.text), confidence: conf, yTop, yBottom });
      }
    }

    // Na konci fotky nezbývá žádný "další řádek", podle kterého bychom
    // se rozhodli — bezpečný výchozí předpoklad je, že šlo o zalomení
    // poslední možnosti (jde snadno opravit ručně, kdyby to tak nebylo).
    if (pending.length > 0) {
      if (options.length > 0) {
        const contText = pending.map(p => p.text).join(' ');
        options[options.length - 1].text = (options[options.length - 1].text + ' ' + contText).trim();
        options[options.length - 1].yBottom = pending[pending.length - 1].yBottom ?? options[options.length - 1].yBottom;
      } else {
        qLines.push(...pending);
      }
    }
    flush();

    return blocks.map(({ qLines, options }) => {
      const opts = scoreOptions(options.map(o => ({ text: o.text, bold: o.bold, confidence: o.confidence })));
      const allConf = [...qLines.map(l => l.confidence), ...options.map(o => o.confidence)];
      const confidence = allConf.length ? allConf.reduce((a, b) => a + b, 0) / allConf.length : 100;
      const allY = [...qLines, ...options].flatMap(l => [l.yTop, l.yBottom]).filter(v => typeof v === 'number');
      const yTop = allY.length ? Math.min(...allY) : null;
      const yBottom = allY.length ? Math.max(...allY) : null;
      return {
        question: qLines.map(l => l.text).join(' ').trim(),
        options: opts,
        confidence,
        yTop,
        yBottom,
      };
    });
  }

  return { parseQuestionBlock, splitIntoQuestionBlocks, splitLines, buildQuestionsFromOcrLines };
})();
