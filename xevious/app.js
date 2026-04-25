let state = window.DASHBOARD_DATA || null;

const generatedAtEl = document.getElementById("generatedAt");
const refreshPageButton = document.getElementById("refreshPageButton");
const refreshIntervalEl = document.getElementById("refreshInterval");
const koreaMarketsEl = document.getElementById("koreaMarkets");
const usMarketsEl = document.getElementById("usMarkets");
const currenciesEl = document.getElementById("currencies");
const weatherCardEl = document.getElementById("weatherCard");
const gasCardEl = document.getElementById("gasCard");
const martClosureCardEl = document.getElementById("martClosureCard");
const newsListEl = document.getElementById("newsList");
const sourceListEl = document.getElementById("sourceList");
const REFRESH_STORAGE_KEY = "xevious-refresh-minutes";
const DATA_ENDPOINT = "./dashboard-data.json";
const SCRIPT_DATA_ENDPOINT = "./dashboard-data.js";
const IS_FILE_PROTOCOL = window.location.protocol === "file:";

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

function currentDataTimestamp() {
    return state?.generatedAt || null;
}

function itemSourceTimestamp(item) {
    return item?.updatedAt || null;
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
            <div class="meta-text">데이터 기준 ${escapeHtml(formatDateTime(itemSourceTimestamp(item) || currentDataTimestamp() || viewRenderedAt.toISOString()))}</div>
        </article>
    `).join("");
}

function renderWeather(weather) {
    if (!weather || !weather.areas || weather.areas.length === 0) {
        weatherCardEl.innerHTML = '<p class="empty-state">날씨 정보를 불러오지 못했습니다.</p>';
        return;
    }

    const renderedAtText = formatDateTime(viewRenderedAt.toISOString());

    weatherCardEl.innerHTML = `
        <div class="weather-grid">
            ${weather.areas.map((area) => {
                const chips = [];

                if (area.feelsLike) chips.push(`체감 ${escapeHtml(area.feelsLike)}`);
                if (area.highLow) chips.push(escapeHtml(area.highLow));
                if (area.humidity) chips.push(`습도 ${escapeHtml(area.humidity)}`);
                if (area.wind) chips.push(`바람 ${escapeHtml(area.wind)}`);
                if (area.rainChance) chips.push(`강수확률 ${escapeHtml(area.rainChance)}`);
                if (area.airQuality) {
                    chips.push(`대기질 ${escapeHtml(area.airQuality)}${area.airQualityIndex ? ` (${escapeHtml(area.airQualityIndex)})` : ""}`);
                }
                if (area.pm10) chips.push(`미세먼지 ${escapeHtml(area.pm10)}`);
                if (area.pm25) chips.push(`초미세먼지 ${escapeHtml(area.pm25)}`);

                return `
                    <article class="weather-shell">
                        <div class="weather-main">
                            <div>
                                <p class="stat-label">${escapeHtml(area.location)} 오늘 날씨</p>
                                <p class="weather-summary">${escapeHtml(area.summary)}</p>
                            </div>
                            <p class="weather-temp">${escapeHtml(area.temperature)}</p>
                        </div>
                        <div class="weather-details">
                            ${chips.map((chip) => `<div class="weather-chip">${chip}</div>`).join("")}
                        </div>
                        <div class="meta-text">표시 시각 ${escapeHtml(renderedAtText)}</div>
                        <div class="meta-text">데이터 기준 ${escapeHtml(formatDateTime(itemSourceTimestamp(area) || currentDataTimestamp() || viewRenderedAt.toISOString()))}</div>
                    </article>
                `;
            }).join("")}
        </div>
    `;
}

function renderGas(gas) {
    if (!gas || !gas.areas || gas.areas.length === 0) {
        gasCardEl.innerHTML = '<p class="empty-state">휘발유 정보를 불러오지 못했습니다.</p>';
        return;
    }

    const renderedAtText = formatDateTime(viewRenderedAt.toISOString());
    gasCardEl.innerHTML = `
        <div class="gas-grid">
            ${gas.areas.map((area) => {
                const districtList = (area.districtSamples || [])
                    .slice(0, 5)
                    .map((item) => `${item.district} ${item.price}`)
                    .join(" · ");

                return `
                    <article class="gas-area-card">
                        <div class="gas-highlight">
                            <div>
                                <p class="stat-label">${escapeHtml(area.areaLabel)}</p>
                                <p class="gas-price">${escapeHtml(area.lowestPrice)}</p>
                            </div>
                            <span class="pill flat">${escapeHtml(area.lowestDistrict)}</span>
                        </div>
                        <p class="gas-station"><strong>${escapeHtml(area.stationName)}</strong></p>
                        <p class="gas-location">${escapeHtml(area.address)}</p>
                        <p class="gas-meta">표시 시각 ${escapeHtml(renderedAtText)}</p>
                        <p class="gas-meta">데이터 기준 ${escapeHtml(formatDateTime(itemSourceTimestamp(area) || currentDataTimestamp() || viewRenderedAt.toISOString()))}</p>
                        <p class="gas-meta">최저가 지역 요약: ${escapeHtml(districtList || "정보 없음")}</p>
                    </article>
                `;
            }).join("")}
        </div>
    `;
}

function renderMartClosures(martClosures) {
    if (!martClosures || !martClosures.chains || martClosures.chains.length === 0) {
        martClosureCardEl.innerHTML = '<p class="empty-state">휴업일 정보를 불러오지 못했습니다.</p>';
        return;
    }

    const renderedAtText = formatDateTime(viewRenderedAt.toISOString());
    const todayLabel = martClosures.todayLabel || "날짜 정보 없음";
    const regionLabel = martClosures.region || "서울";

    martClosureCardEl.innerHTML = `
        <p class="mart-summary">${escapeHtml(regionLabel)} 기준 · 오늘 ${escapeHtml(todayLabel)}</p>
        <div class="mart-grid">
            ${martClosures.chains.map((chain) => `
                <article class="mart-chain-card">
                    <div class="mart-chain-head">
                        <p class="stat-label">${escapeHtml(chain.label)}</p>
                        <span class="pill ${chain.todayClosed ? "down" : "up"}">${chain.todayClosed ? "휴업" : "영업"}</span>
                    </div>
                    <p class="mart-status">${escapeHtml(chain.todayStatus || "정보 없음")}</p>
                    <p class="mart-holidays">이번 달 휴업일 ${escapeHtml(chain.holidayText || "정보 없음")}</p>
                    <div class="meta-text">표시 시각 ${escapeHtml(renderedAtText)}</div>
                    <div class="meta-text">데이터 기준 ${escapeHtml(formatDateTime(itemSourceTimestamp(chain) || currentDataTimestamp() || viewRenderedAt.toISOString()))}</div>
                </article>
            `).join("")}
        </div>
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
        renderWeather(null);
        renderGas(null);
        renderMartClosures(null);
        renderNews([]);
        renderSources([]);
        return;
    }

    generatedAtEl.textContent = `표시 시각: ${formatDateTime(viewRenderedAt.toISOString())} | 데이터 기준: ${formatDateTime(currentDataTimestamp() || viewRenderedAt.toISOString())} (${state.timezone || "시간대 미표시"})`;
    renderStats(koreaMarketsEl, state.koreaMarkets);
    renderStats(usMarketsEl, state.usMarkets);
    renderStats(currenciesEl, state.currencies);
    renderWeather(state.weather);
    renderGas(state.gasoline);
    renderMartClosures(state.martClosures);
    renderNews(state.news);
    renderSources(state.sources);
}

function loadDashboardScript() {
    return new Promise((resolve, reject) => {
        const existingScript = document.getElementById("dashboardDataScript");
        const script = document.createElement("script");

        script.id = "dashboardDataScript";
        script.src = `${SCRIPT_DATA_ENDPOINT}?t=${Date.now()}`;
        script.onload = () => resolve(window.DASHBOARD_DATA || null);
        script.onerror = () => reject(new Error("dashboard-data.js load failed"));

        if (existingScript && existingScript.parentNode) {
            existingScript.parentNode.removeChild(existingScript);
        }

        document.body.appendChild(script);
    });
}

async function fetchLatestDashboardData() {
    try {
        if (IS_FILE_PROTOCOL) {
            const nextState = await loadDashboardScript();

            if (!nextState) {
                throw new Error("dashboard-data.js returned no data");
            }

            state = nextState;
            render();
            return;
        }

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

if (!IS_FILE_PROTOCOL && "serviceWorker" in navigator) {
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
fetchLatestDashboardData();
