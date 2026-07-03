/* =========================================================================
   APP.JS — Render UI, Theme toggle, Charts, Real-time refresh loop
   ========================================================================= */

(() => {
  const $ = (id) => document.getElementById(id);

  // ປະກາດຕົວແປກ່ອນ ເພື່ອປ້ອງກັນ "Cannot access before initialization"
  // (applyTheme() ຖືກເອີ້ນຕັ້ງແຕ່ຕົ້ນໄຟລ໌ ແລະ ຕ້ອງໃຊ້ຕົວແປນີ້ຜ່ານ refreshChartColors)
  let weeklyChart, monthlyChart;

  /* --------------------------- THEME TOGGLE ----------------------------- */
  const themeToggleBtn = $("themeToggle");
  const iconMoon = $("iconMoon");
  const iconSun = $("iconSun");

  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("dashboard-theme", theme);
    iconMoon.style.display = theme === "dark" ? "block" : "none";
    iconSun.style.display = theme === "dark" ? "none" : "block";
    refreshChartColors();
  }
  themeToggleBtn.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });
  applyTheme(localStorage.getItem("dashboard-theme") || "dark");

  /* --------------------------- HEADER LINKS ------------------------------ */
  $("linkOrders").href = CONFIG.HEADER_LINKS.ORDER_LIST;
  $("linkWarehouse").href = CONFIG.HEADER_LINKS.WAREHOUSE;
  $("linkCutSew").href = CONFIG.HEADER_LINKS.CUT_SEW_SUMMARY;
  $("refreshSeconds").textContent = Math.round(CONFIG.REFRESH_INTERVAL_MS / 1000);
  $("todaySheetName").textContent = `ອ້າງອີງ Sheet ເດືອນ: ${SheetsAPI.currentLaoMonthSheetName()}`;
  $("revenueFormula").textContent = `year × ${CONFIG.PRICE_PER_UNIT_KIP.toLocaleString()} ກີບ`;
  $("etaFormula").textContent = `ອໍເດີຄ້າງ ÷ ກຳລັງຜະລິດ ${CONFIG.MONTHLY_PRODUCTION_CAPACITY.toLocaleString()} ຊິ້ນ/ເດືອນ`;

  /* --------------------------- HELPERS ----------------------------------- */
  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return Math.round(n).toLocaleString("en-US");
  }

  function setValue(id, text) {
    const el = $(id);
    el.classList.remove("skeleton");
    el.textContent = text;
  }

  function showError(msg) {
    const el = $("errorBanner");
    el.textContent = msg;
    el.classList.add("show");
  }
  function clearError() {
    $("errorBanner").classList.remove("show");
  }

  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  /* --------------------------- CHARTS ------------------------------------ */
  function buildBarChart(canvasId, labels, data) {
    const ctx = $(canvasId).getContext("2d");
    const primary = cssVar("--primary-2") || "#E01B33";
    const primaryDark = cssVar("--primary-dark") || "#7A0E1C";
    const gridColor = cssVar("--border") || "#2E211F";
    const textColor = cssVar("--text-muted") || "#A8938D";

    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, primary);
    gradient.addColorStop(1, primaryDark);

    return new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: gradient,
          borderRadius: 6,
          maxBarThickness: 38,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { intersect: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, font: { family: "'Noto Serif Lao'" } } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: "'Noto Serif Lao'" } }, beginAtZero: true },
        },
      },
    });
  }

  function buildLineChart(canvasId, labels, series) {
    // series = [{ key, label, color, data }]
    const ctx = $(canvasId).getContext("2d");
    const gridColor = cssVar("--border") || "#2E211F";
    const textColor = cssVar("--text-muted") || "#A8938D";

    const datasets = series.map(s => ({
      label: s.label,
      data: s.data,
      borderColor: s.color,
      backgroundColor: s.color,
      pointBackgroundColor: s.color,
      pointBorderColor: s.color,
      pointRadius: 4,
      pointHoverRadius: 6,
      borderWidth: 3,
      tension: 0.4,      // ເສັ້ນໂຄ້ງ smooth ຄືຮູບຕົວຢ່າງ
      spanGaps: true,    // ຂ້າມມື້ທີ່ຍັງບໍ່ມີຂໍ້ມູນ (localStorage ຍັງບໍ່ທັນສະສົມ)
      fill: false,
    }));

    return new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false }, // ໃຊ້ legend ແບບ custom ດ້ານເທິງກາຟແທນ
          tooltip: { mode: "index", intersect: false },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, font: { family: "'Noto Serif Lao'" } } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: "'Noto Serif Lao'" } }, beginAtZero: true },
        },
      },
    });
  }

  function refreshChartColors() {
    [weeklyChart, monthlyChart].forEach(c => c && c.destroy());
    if (window.__lastWeekData) renderWeeklyChart(window.__lastWeekData);
    if (window.__lastMonthSeries) renderMonthlyChart(window.__lastMonthSeries);
  }

  function renderWeeklyChart(weekData) {
    // weekData = { labels, production[], newOrder[], pending[] }
    window.__lastWeekData = weekData;
    if (weeklyChart) weeklyChart.destroy();
    const colors = CONFIG.CHART_COLORS;
    weeklyChart = buildLineChart("weeklyChart", weekData.labels, [
      { label: "ຜະລິດ", color: colors.PRODUCTION, data: weekData.production },
      { label: "ອໍເດີໃໝ່", color: colors.NEW_ORDER, data: weekData.newOrder },
      { label: "ອໍເດີຄ້າງ", color: colors.PENDING, data: weekData.pending },
    ]);
  }
  function renderMonthlyChart(series) {
    window.__lastMonthSeries = series;
    if (monthlyChart) monthlyChart.destroy();
    monthlyChart = buildBarChart("monthlyChart", series.map(s => s.label), series.map(s => s.value));
  }

  /* --------------------------- MAIN FETCH + RENDER ------------------------ */
  let isFirstLoad = true;

  async function loadDashboard(manual = false) {
    const refreshBtn = $("refreshBtn");
    const refreshIcon = refreshBtn.querySelector("svg");
    refreshIcon.classList.add("spin");
    $("statusText").textContent = "ກຳລັງດຶງຂໍ້ມູນຈາກ Google Sheets…";

    if (CONFIG.API_KEY === "YOUR_GOOGLE_SHEETS_API_KEY_HERE") {
      showError("⚠️ ຍັງບໍ່ໄດ້ໃສ່ Google Sheets API Key — ກະລຸນາເປີດໄຟລ໌ js/config.js ແລ້ວໃສ່ API_KEY ຂອງທ່ານ (ອ່ານວິທີໃນ README.md)");
      refreshIcon.classList.remove("spin");
      $("statusText").textContent = "ຢຸດເຊື່ອມຕໍ່ — ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ API Key";
      return;
    }

    try {
      const [todayProduction, orderData] = await Promise.all([
        SheetsAPI.fetchTodayProduction(),
        SheetsAPI.fetchOrderRanges(),
      ]);

      clearError();

      // 1. ຍອດຜະລິດສຳເລັດມື້ນີ້
      setValue("todayProduction", "");
      $("todayProduction").innerHTML = `${fmt(todayProduction)}<span class="unit">ຊິ້ນ</span>`;

      // 2. ອໍເດີໃໝ່ວັນນີ້
      setValue("dailyOrder", fmt(orderData.daily.todayCount));

      // 3. ອໍເດີຄ້າງທັງໝົດ
      setValue("totalOrder", fmt(orderData.totalPending));

      // 5. ຍອດຜະລິດລວມທັງປີ
      $("yearTotal").classList.remove("skeleton");
      $("yearTotal").innerHTML = `${fmt(orderData.yearTotal)} <small>ຊິ້ນ</small>`;

      // 6. ປະມານການຍອດຂາຍລວມທັງປີ
      const revenue = (orderData.yearTotal || 0) * CONFIG.PRICE_PER_UNIT_KIP;
      $("yearRevenue").classList.remove("skeleton");
      $("yearRevenue").innerHTML = `${fmt(revenue)} <small>ກີບ</small>`;

      // 4. ພະຍາກອນໄລຍະເວລາເຄລຍວຽກ
      const monthsRemaining = CONFIG.MONTHLY_PRODUCTION_CAPACITY > 0
        ? (orderData.totalPending || 0) / CONFIG.MONTHLY_PRODUCTION_CAPACITY
        : 0;
      const wholeMonths = Math.floor(monthsRemaining);
      const remDays = Math.round((monthsRemaining - wholeMonths) * 30);
      const etaLabel = wholeMonths > 0
        ? `${wholeMonths} ເດືອນ ${remDays > 0 ? remDays + " ວັນ" : ""}`
        : `${remDays} ວັນ`;
      $("etaText").classList.remove("skeleton");
      $("etaText").textContent = etaLabel;
      const pct = Math.min(100, Math.max(4, monthsRemaining * 20)); // ໂຕເລກ visual ບໍ່ອີງຄ່າ absolute
      $("etaFill").style.width = pct + "%";

      // 7. ສະຖິຕິການຜະລິດລາຍອາທິດ (3 ເສັ້ນ: ຜະລິດ / ອໍເດີໃໝ່ / ອໍເດີຄ້າງ)
      HistoryStore.recordToday({
        production: todayProduction,
        newOrder: orderData.daily.todayCount,
        pending: orderData.totalPending,
      });
      renderWeeklyChart(HistoryStore.getCurrentWeekSeries());

      // 8. ສະຖິຕິການຜະລິດລາຍເດືອນ
      renderMonthlyChart(orderData.monthly.length ? orderData.monthly : [{ label: "—", value: 0 }]);

      const now = new Date();
      $("lastUpdated").textContent = now.toLocaleTimeString("lo-LA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      $("statusText").textContent = "ເຊື່ອມຕໍ່ສຳເລັດ — ຂໍ້ມູນສົດ (Live)";

    } catch (err) {
      console.error(err);
      showError("⚠️ ດຶງຂໍ້ມູນບໍ່ສຳເລັດ — ກວດສອບວ່າ Sheet ຖືກເປີດ 'Anyone with the link can view' ແລະ API Key ຖືກຕ້ອງ (ເບິ່ງລາຍລະອຽດ Console F12)");
      $("statusText").textContent = "ເຊື່ອມຕໍ່ບໍ່ສຳເລັດ";
    } finally {
      refreshIcon.classList.remove("spin");
      isFirstLoad = false;
    }
  }

  $("refreshBtn").addEventListener("click", () => loadDashboard(true));

  /* --------------------------- TOAST ------------------------------------- */
  function showToast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      el.innerHTML = `<span class="dot"></span><span id="toastMsg"></span>`;
      document.body.appendChild(el);
    }
    el.querySelector("#toastMsg").textContent = msg;
    el.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  /* --------------------------- SCREENSHOT (ບັນທຶກຮູບໜ້າຈໍ) ----------------- */
  $("screenshotBtn").addEventListener("click", async () => {
    const btn = $("screenshotBtn");
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "ກຳລັງບັນທຶກ…";
    try {
      const target = $("captureArea");
      const bgColor = cssVar("--bg") || "#0A0807";
      const canvas = await html2canvas(target, {
        backgroundColor: bgColor,
        scale: Math.min(2, window.devicePixelRatio || 1.5),
        useCORS: true,
      });
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      link.download = `daily-report-${stamp}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      showToast("✅ ບັນທຶກຮູບໜ້າຈໍສຳເລັດແລ້ວ — ສົ່ງໃຫ້ຫົວໜ້າໄດ້ເລີຍ");
    } catch (err) {
      console.error("Screenshot failed:", err);
      showToast("⚠️ ບັນທຶກຮູບບໍ່ສຳເລັດ ລອງໃໝ່ອີກຄັ້ງ");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  });

  /* --------------------------- PRINT / SAVE AS PDF (ບິນ) ------------------ */
  $("printBtn").addEventListener("click", () => {
    window.print();
  });

  loadDashboard();
  setInterval(() => loadDashboard(false), CONFIG.REFRESH_INTERVAL_MS);
})();
