/* =========================================================================
   SHEETS.JS — ດຶງຂໍ້ມູນຈາກ Google Sheets API v4 (batchGet) + parsing logic
   =========================================================================
   ໝາຍເຫດສຳຄັນ: Named Range "DAILY_ORDER" ແລະ "mond" ອາດມີໂຄງສ້າງໄດ້ຫຼາຍແບບ
   (cell ດຽວ / ຖັນດຽວ 7 ແຖວ / 2 ຖັນ [ວັນທີ, ຄ່າ]) — ໂຄ້ດນີ້ພະຍາຍາມກວດຈັບອັດຕະໂນມັດ
   ຖ້າຜົນທີ່ອອກມາຜິດ ໃຫ້ເປີດ Console (F12) ເບິ່ງ log "RAW:" ແລ້ວປັບຟັງຊັນ parse*
   ດ້ານລຸ່ມໃຫ້ຕົງກັບໂຄງສ້າງຈິງຂອງ Sheet.
   ========================================================================= */

const SheetsAPI = (() => {

  function currentLaoMonthSheetName() {
    const now = new Date();
    const monthIndex = now.getMonth(); // 0-11
    const monthName = CONFIG.LAO_MONTH_SHEET_NAMES[monthIndex];
    const year = CONFIG.YEAR_OVERRIDE || now.getFullYear();
    const template = CONFIG.MONTH_SHEET_NAME_TEMPLATE || "{month}";
    return template.replace("{month}", monthName).replace("{year}", year);
  }

  function buildValuesUrl(spreadsheetId, ranges) {
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet`;
    const params = new URLSearchParams();
    ranges.forEach(r => params.append("ranges", r));
    params.append("key", CONFIG.API_KEY);
    params.append("valueRenderOption", "UNFORMATTED_VALUE");
    params.append("dateTimeRenderOption", "FORMATTED_STRING");
    return `${base}?${params.toString()}`;
  }

  async function batchGet(spreadsheetId, ranges) {
    const url = buildValuesUrl(spreadsheetId, ranges);
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Sheets API error (${res.status}) for ${spreadsheetId}: ${body}`);
    }
    const json = await res.json();
    return json.valueRanges || [];
  }

  // ---- ດຶງຂໍ້ມູນຈາກ Production Sheet (cell L128 ຂອງ tab ເດືອນປັດຈຸບັນ) ------
  async function fetchTodayProduction() {
    const sheetName = currentLaoMonthSheetName();
    const range = `'${sheetName}'!${CONFIG.TODAY_PRODUCTION_CELL}`;
    try {
      const [vr] = await batchGet(CONFIG.SHEETS.PRODUCTION, [range]);
      console.log("RAW today production:", vr);
      const val = vr?.values?.[0]?.[0];
      return toNumber(val);
    } catch (err) {
      console.error("fetchTodayProduction failed (ກວດຊື່ tab ເດືອນໃນ config.js):", err);
      return null;
    }
  }

  // ---- ດຶງ Named Ranges ທັງໝົດຈາກ Orders Sheet ໃນຄັ້ງດຽວ --------------------
  async function fetchOrderRanges() {
    const ranges = [
      CONFIG.NAMED_RANGES.DAILY_ORDER,
      CONFIG.NAMED_RANGES.TOTAL_ORDER,
      CONFIG.NAMED_RANGES.YEAR,
      CONFIG.NAMED_RANGES.MONTH_STATS,
    ];
    const results = await batchGet(CONFIG.SHEETS.ORDERS, ranges);
    console.log("RAW order ranges:", results);

    const byRange = {};
    results.forEach(vr => { byRange[vr.range?.split("!")[0]?.replace(/'/g, "")] = vr.values || []; });

    // fallback: match by index if key names don't come back cleanly
    const dailyRaw = results[0]?.values || [];
    const totalRaw = results[1]?.values || [];
    const yearRaw = results[2]?.values || [];
    const monthRaw = results[3]?.values || [];

    return {
      daily: parseDailyOrder(dailyRaw),
      totalPending: toNumber(totalRaw?.[0]?.[0]),
      yearTotal: toNumber(yearRaw?.[0]?.[0]),
      monthly: parseMonthlyStats(monthRaw),
    };
  }

  // ---- Parse DAILY_ORDER -> { todayCount, weekSeries: [{label, value}] } ---
  function parseDailyOrder(rows) {
    if (!rows || rows.length === 0) return { todayCount: 0, weekSeries: [] };

    // ກໍລະນີ 1: cell ດຽວ (1 row, 1 col) => ຄ່າວັນນີ້ຄ່າດຽວ ບໍ່ມີປະຫວັດລາຍວັນ
    if (rows.length === 1 && rows[0].length <= 1) {
      const v = toNumber(rows[0][0]);
      return { todayCount: v, weekSeries: [{ label: "ມື້ນີ້", value: v }] };
    }

    const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

    // ກໍລະນີ 2: ຫຼາຍແຖວ, 2 ຖັນ [ວັນທີ, ຄ່າ]
    if (rows[0].length >= 2) {
      const parsed = rows
        .map(r => ({ dateRaw: r[0], value: toNumber(r[1]) }))
        .filter(r => r.dateRaw !== undefined && r.dateRaw !== "");

      const weekRows = filterCurrentWeek(parsed);
      const todayRow = parsed.find(r => matchesToday(r.dateRaw, todayStr));
      const todayCount = todayRow ? todayRow.value : (weekRows.at(-1)?.value ?? 0);

      return {
        todayCount,
        weekSeries: weekRows.map(r => ({ label: formatShortDate(r.dateRaw), value: r.value })),
      };
    }

    // ກໍລະນີ 3: ຫຼາຍແຖວ, ຖັນດຽວ (ສົມມຸດວ່າ 7 ແຖວລ້າສຸດ = ຈັນ..ອາທິດ ຫຼືມື້ລ້າສຸດ 7 ມື້)
    const values = rows.map(r => toNumber(r[0])).filter(v => v !== null);
    const last7 = values.slice(-7);
    const dayLabels = CONFIG.WEEK_STARTS_ON_MONDAY
      ? ["ຈັນ", "ອັງຄານ", "ພຸດ", "ພະຫັດ", "ສຸກ", "ເສົາ", "ອາທິດ"]
      : ["ອາທິດ", "ຈັນ", "ອັງຄານ", "ພຸດ", "ພະຫັດ", "ສຸກ", "ເສົາ"];
    const weekSeries = last7.map((v, i) => ({
      label: dayLabels[i] ?? `ວັນທີ ${i + 1}`,
      value: v,
    }));
    return { todayCount: values.at(-1) ?? 0, weekSeries };
  }

  // ---- Parse mond -> [{label, value}] ສະຖິຕິລາຍເດືອນ ------------------------
  function parseMonthlyStats(rows) {
    if (!rows || rows.length === 0) return [];
    const monthLabels = ["ມ.ກ.", "ກ.ພ.", "ມີ.ນາ", "ມ.ສ.", "ພ.ພ.", "ມິ.ຖ.", "ກ.ລ.", "ສ.ຫ.", "ກ.ຍ.", "ຕ.ລ.", "ພ.ຈ.", "ທ.ວ."];

    if (rows[0].length >= 2) {
      // 2 ຖັນ [ຊື່ເດືອນ/ໝາຍເລກເດືອນ, ຄ່າ]
      return rows.map((r, i) => ({
        label: (r[0] ?? monthLabels[i] ?? `ດ${i + 1}`).toString(),
        value: toNumber(r[1]) ?? 0,
      }));
    }
    // ຖັນດຽວ 12 ຄ່າ ສົມມຸດ ມ.ກ.-ທ.ວ.
    return rows.map((r, i) => ({
      label: monthLabels[i] ?? `ດ${i + 1}`,
      value: toNumber(r[0]) ?? 0,
    }));
  }

  function filterCurrentWeek(parsedRows) {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diffToMonday = CONFIG.WEEK_STARTS_ON_MONDAY ? (day === 0 ? -6 : 1 - day) : -day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const inWeek = parsedRows.filter(r => {
      const d = parseFlexibleDate(r.dateRaw);
      return d && d >= monday && d <= sunday;
    });
    return inWeek.length > 0 ? inWeek : parsedRows.slice(-7);
  }

  function matchesToday(dateRaw, todayStr) {
    const d = parseFlexibleDate(dateRaw);
    if (!d) return false;
    return d.toLocaleDateString("en-CA") === todayStr;
  }

  function parseFlexibleDate(raw) {
    if (raw instanceof Date) return raw;
    if (typeof raw === "number") {
      // Google Sheets serial date (days since 1899-12-30)
      const epoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(epoch.getTime() + raw * 86400000);
    }
    if (typeof raw === "string") {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  function formatShortDate(raw) {
    const d = parseFlexibleDate(raw);
    if (!d) return String(raw);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  function toNumber(v) {
    if (v === undefined || v === null || v === "") return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
    return isNaN(n) ? 0 : n;
  }

  return {
    fetchTodayProduction,
    fetchOrderRanges,
    currentLaoMonthSheetName,
  };
})();
