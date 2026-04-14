let state = window.DASHBOARD_DATA || null;

const generatedAtEl = document.getElementById("generatedAt");
const refreshPageButton = document.getElementById("refreshPageButton");
const refreshIntervalEl = document.getElementById("refreshInterval");
const koreaMarketsEl = document.getElementById("koreaMarkets");
const usMarketsEl = document.getElementById("usMarkets");
const currenciesEl = document.getElementById("currencies");
const gasCardEl = document.getElementById("gasCard");
const newsListEl = document.getElementById("newsList");
const sourceListEl = document.getElementById("sourceList");
const REFRESH_STORAGE_KEY = "xevious-refresh-minutes";
const DATA_ENDPOINT = "./dashboard-data.json";

let autoRefreshTimer = 0;
let viewRenderedAt = new Date();

function formatDateTime(isoText) {
    if (!isoText) {
        return "시각 정보 없음";
    }

    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) {
        return isoText;
    }

    return new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
}

function formatPublishedDateTime(text) {
    if (!text) {
        return "";
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return text;
    }

    return new Intl.DateTimeFormat("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(date);
}

function escapeHtml(text) {
    return String(text ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function badgeClass(direction) {
    if (direction === "up") {
        return "up";
    }
    if (direction === "down") {
        return "down";
    }
    return "flat";
}

function badgeText(direction) {
    if (direction === "up") {
        return "상승";
    }
    if (direction === "down") {
        return "하락";
    }
    return "보합";
}

function renderStats(target, items) {
    if (!items || items.length === 0) {
        target.innerHTML = '<p class="empty-state">표시할 데이터가 없습니다.</p>';
        return;
    }

    const renderedAtText = formatDateTime(viewRenderedAt.toISOString());

    target.innerHTML = items.map((item) => `
        <article class="stat-card">
            <p class="stat-label">${escapeHtml(item.label)}</p>
            <p class="stat-value">${escapeHtml(item.value)}</p>
            <div class="delta-row">
                <span class="pill ${badgeClass(item.direction)}">${badgeText(item.direction)}</span>
                <span class="delta-text">${escapeHtml(item.change)} / ${escapeHtml(item.changePercent)}</span>
            </div>
            <div class="meta-text">표시 시각 ${escapeHtml(renderedAtText)}</div>
            <div class="meta-text">데이터 기준 ${escapeHtml(renderedAtText)}</div>
        </article>
    `).join("");
}

function renderGas(gas) {
    if (!gas) {
        gasCardEl.innerHTML = '<p class="empty-state">휘발유 정보를 불러오지 못했습니다.</p>';
        return;
    }

    const renderedAtText = formatDateTime(viewRenderedAt.toISOString());
    const districtList = (gas.districtSamples || [])
        .slice(0, 5)
        .map((item) => `${item.district} ${item.price}`)
        .join(" · ");

    gasCardEl.innerHTML = `
        <div class="gas-highlight">
            <div>
                <p class="stat-label">서울 최저 휘발유 가격</p>
                <p class="gas-price">${escapeHtml(gas.lowestPrice)}</p>
            </div>
            <span class="pill flat">${escapeHtml(gas.lowestDistrict)}</span>
        </div>
        <p class="gas-station"><strong>${escapeHtml(gas.stationName)}</strong></p>
        <p class="gas-location">${escapeHtml(gas.address)}</p>
        <p class="gas-meta">표시 시각 ${escapeHtml(renderedAtText)}</p>
        <p class="gas-meta">데이터 기준 ${escapeHtml(renderedAtText)}</p>
        <p class="gas-meta">서울 자치구 최저가 예시: ${escapeHtml(districtList || "정보 없음")}</p>
    `;
}

function renderNews(news) {
    if (!news || news.length === 0) {
        newsListEl.innerHTML = '<li class="empty-state">뉴스를 불러오지 못했습니다.</li>';
        return;
    }

    newsListEl.innerHTML = news.map((item) => `
        <li>
            <a class="news-link" href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">
                ${escapeHtml(item.title)}
            </a>
            <span class="news-source">${escapeHtml(item.source)}${item.publishedAt ? ` · ${escapeHtml(formatPublishedDateTime(item.publishedAt))}` : ""}</span>
        </li>
    `).join("");
}

function renderSources(sources) {
    if (!sources || sources.length === 0) {
        sourceListEl.innerHTML = "<li>출처 정보 없음</li>";
        return;
    }

    sourceListEl.innerHTML = sources.map((source) => `
        <li>
            <a class="news-link" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">
                ${escapeHtml(source.label)}
            </a>
        </li>
    `).join("");
}

function render() {
    viewRenderedAt = new Date();

    if (!state) {
        generatedAtEl.textContent = "dashboard-data.js가 없어 데이터를 표시할 수 없습니다.";
        renderStats(koreaMarketsEl, []);
        renderStats(usMarketsEl, []);
        renderStats(currenciesEl, []);
        renderGas(null);
        renderNews([]);
        renderSources([]);
        return;
    }

    generatedAtEl.textContent = `최근 새로고침: ${formatDateTime(viewRenderedAt.toISOString())} | 데이터 기준: ${formatDateTime(viewRenderedAt.toISOString())} (${state.timezone || "시간대 미표시"})`;
    renderStats(koreaMarketsEl, state.koreaMarkets);
    renderStats(usMarketsEl, state.usMarkets);
    renderStats(currenciesEl, state.currencies);
    renderGas(state.gasoline);
    renderNews(state.news);
    renderSources(state.sources);
}

async function fetchLatestDashboardData() {
    try {
        const response = await fetch(`${DATA_ENDPOINT}?t=${Date.now()}`, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        state = await response.json();
        render();
    } catch (error) {
        console.error("Failed to refresh dashboard data", error);
    }
}

function applyAutoRefresh(minutes) {
    if (autoRefreshTimer) {
        window.clearInterval(autoRefreshTimer);
        autoRefreshTimer = 0;
    }

    if (!minutes || minutes < 1) {
        return;
    }

    autoRefreshTimer = window.setInterval(fetchLatestDashboardData, minutes * 60 * 1000);
}

function initializeRefreshControl() {
    if (!refreshIntervalEl) {
        return;
    }

    const storedValue = window.localStorage.getItem(REFRESH_STORAGE_KEY) || "0";
    refreshIntervalEl.value = storedValue;
    applyAutoRefresh(Number(storedValue));

    refreshIntervalEl.addEventListener("change", () => {
        const minutes = Number(refreshIntervalEl.value || "0");
        window.localStorage.setItem(REFRESH_STORAGE_KEY, String(minutes));
        applyAutoRefresh(minutes);
    });
}

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./service-worker.js").catch(() => {
            // Keep the dashboard usable even when offline caching is unavailable.
        });
    });
}

refreshPageButton.addEventListener("click", () => {
    fetchLatestDashboardData();
});

render();
initializeRefreshControl();
