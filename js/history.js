/* =========================================================================
   HISTORY.JS — ບັນທຶກ + ດຶງ ປະຫວັດຄ່າລາຍວັນ (localStorage, ເກັບໄວ້ໃນເຄື່ອງນີ້ເທົ່ານັ້ນ)
   ໃຊ້ສຳລັບ "ຍອດຜະລິດ" ແລະ "ອໍເດີຄ້າງ" ເພາະ Sheet ບໍ່ມີປະຫວັດລາຍວັນເກັບໄວ້
   ========================================================================= */

const HistoryStore = (() => {

  function dateKey(d = new Date()) {
    return d.toLocaleDateString("en-CA"); // YYYY-MM-DD ຕາມເວລາເຄື່ອງຜູ້ໃຊ້
  }

  function storageKey(dateStr) {
    return `${CONFIG.HISTORY_STORAGE_PREFIX}${dateStr}`;
  }

  // ບັນທຶກ snapshot ຂອງມື້ນີ້ (ຂຽນທັບຄ່າເກົ່າຂອງມື້ດຽວກັນ ເພື່ອໃຫ້ໄດ້ຄ່າລ່າສຸດສະເໝີ)
  function recordToday({ production, newOrder, pending }) {
    try {
      const key = storageKey(dateKey());
      const payload = { production, newOrder, pending, savedAt: Date.now() };
      localStorage.setItem(key, JSON.stringify(payload));
      pruneOldEntries();
    } catch (err) {
      console.warn("HistoryStore.recordToday failed (localStorage ອາດເຕັມ/ຖືກປິດ):", err);
    }
  }

  function pruneOldEntries() {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - CONFIG.HISTORY_DAYS_TO_KEEP);
      Object.keys(localStorage)
        .filter(k => k.startsWith(CONFIG.HISTORY_STORAGE_PREFIX))
        .forEach(k => {
          const ds = k.replace(CONFIG.HISTORY_STORAGE_PREFIX, "");
          const d = new Date(ds);
          if (!isNaN(d.getTime()) && d < cutoff) localStorage.removeItem(k);
        });
    } catch (err) { /* noop */ }
  }

  // ດຶງ 7 ມື້ຂອງອາທິດປັດຈຸບັນ (ຈັນ-ອາທິດ) — ມື້ໃດບໍ່ມີຂໍ້ມູນ = null (ຈຸດຂາດໃນກາຟ)
  function getCurrentWeekSeries() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diffToMonday = CONFIG.WEEK_STARTS_ON_MONDAY ? (day === 0 ? -6 : 1 - day) : -day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const dayLabels = CONFIG.WEEK_STARTS_ON_MONDAY
      ? ["ຈັນ", "ອັງຄານ", "ພຸດ", "ພະຫັດ", "ສຸກ", "ເສົາ", "ອາທິດ"]
      : ["ອາທິດ", "ຈັນ", "ອັງຄານ", "ພຸດ", "ພະຫັດ", "ສຸກ", "ເສົາ"];

    const labels = [];
    const production = [];
    const newOrder = [];
    const pending = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ds = dateKey(d);
      labels.push(dayLabels[i]);

      let entry = null;
      try {
        const raw = localStorage.getItem(storageKey(ds));
        if (raw) entry = JSON.parse(raw);
      } catch (err) { /* noop */ }

      production.push(entry ? entry.production : null);
      newOrder.push(entry ? entry.newOrder : null);
      pending.push(entry ? entry.pending : null);
    }

    return { labels, production, newOrder, pending };
  }

  return { recordToday, getCurrentWeekSeries };
})();
