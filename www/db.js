/* db.js — jednoduchá obálka nad IndexedDB.
   Ukládáme dvě "tabulky": decks (balíčky) a questions (otázky). */

const DB = (() => {
  const DB_NAME = 'prijimacky-db';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('decks')) {
          db.createObjectStore('decks', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('questions')) {
          const qs = db.createObjectStore('questions', { keyPath: 'id' });
          qs.createIndex('status', 'status', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    uid,

    async addDeck(name) {
      const store = await tx('decks', 'readwrite');
      const deck = { id: uid(), name, createdAt: Date.now() };
      await reqToPromise(store.add(deck));
      return deck;
    },
    async renameDeck(id, name) {
      const store = await tx('decks', 'readwrite');
      const deck = await reqToPromise(store.get(id));
      deck.name = name;
      await reqToPromise(store.put(deck));
    },
    async deleteDeck(id) {
      const store = await tx('decks', 'readwrite');
      await reqToPromise(store.delete(id));
      // odebrat referenci z otázek (otázky samotné neztrácíme)
      const qStore = await tx('questions', 'readwrite');
      const all = await reqToPromise(qStore.getAll());
      for (const q of all) {
        if (q.deckIds && q.deckIds.includes(id)) {
          q.deckIds = q.deckIds.filter(d => d !== id);
          qStore.put(q);
        }
      }
    },
    async getDecks() {
      const store = await tx('decks', 'readonly');
      const all = await reqToPromise(store.getAll());
      return all.sort((a, b) => a.createdAt - b.createdAt);
    },
    async getDeck(id) {
      const store = await tx('decks', 'readonly');
      return reqToPromise(store.get(id));
    },

    async addQuestion(q) {
      const store = await tx('questions', 'readwrite');
      const question = {
        id: uid(),
        text: q.text || '',
        options: q.options || [], // [{id, text, correct, image}]
        deckIds: q.deckIds || [],
        note: q.note || '',
        image: q.image || '', // volitelný obrázek (vzorec/schéma) k otázce
        status: 'new', // new | learned | priority
        createdAt: Date.now(),
      };
      await reqToPromise(store.add(question));
      return question;
    },
    async updateQuestion(question) {
      const store = await tx('questions', 'readwrite');
      await reqToPromise(store.put(question));
    },
    async deleteQuestion(id) {
      const store = await tx('questions', 'readwrite');
      await reqToPromise(store.delete(id));
    },
    async getQuestions() {
      const store = await tx('questions', 'readonly');
      const all = await reqToPromise(store.getAll());
      return all.sort((a, b) => b.createdAt - a.createdAt);
    },
    async getQuestion(id) {
      const store = await tx('questions', 'readonly');
      return reqToPromise(store.get(id));
    },
    async getQuestionsByDeck(deckId) {
      const all = await this.getQuestions();
      return all.filter(q => q.deckIds && q.deckIds.includes(deckId));
    },

    /* Záloha: vrátí kompletní obsah (balíčky + otázky) jako obyčejný
       objekt, který jde uložit do souboru nezávisle na appce/telefonu. */
    async exportAll() {
      const decks = await this.getDecks();
      const questions = await this.getQuestions();
      return {
        app: 'prijimacky-app',
        exportedAt: new Date().toISOString(),
        decks,
        questions,
      };
    },

    /* Obnova ze zálohy: přidá balíčky a otázky ze souboru do aktuální
       databáze. Nic nemaže — pokud danou zálohu importuješ podruhé
       (stejná id), jen přepíše stejné záznamy tou stejnou hodnotou.
       Vrací počty pro potvrzující hlášku. */
    async importAll(data) {
      if (!data || !Array.isArray(data.decks) || !Array.isArray(data.questions)) {
        throw new Error('Neplatný formát zálohy');
      }
      const deckStore = await tx('decks', 'readwrite');
      for (const d of data.decks) {
        await reqToPromise(deckStore.put(d));
      }
      const qStore = await tx('questions', 'readwrite');
      for (const q of data.questions) {
        await reqToPromise(qStore.put(q));
      }
      return { decks: data.decks.length, questions: data.questions.length };
    },
  };
})();
