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
const koreaStatusEl = document.getElementById("koreaStatus");
const usStatusEl = document.getElementById("usStatus");
const fxStatusEl = document.getElementById("fxStatus");
const weatherStatusEl = document.getElementById("weatherStatus");
const gasStatusEl = document.getElementById("gasStatus");
const martStatusEl = document.getElementById("martStatus");
const newsStatusEl = document.getElementById("newsStatus");
const REFRESH_STORAGE_KEY = "xevious-refresh-minutes";
const DATA_ENDPOINT = "./dashboard-data.json";
const SCRIPT_DATA_ENDPOINT = "./dashboard-data.js";
const IS_FILE_PROTOCOL = window.location.protocol === "file:";
const LIVE_WEATHER_LOCATIONS = [
    { location: "서울", latitude: 37.5665, longitude: 126.978 },
    { location: "김포", latitude: 37.6153, longitude: 126.7156 },
    { location: "파주", latitude: 37.7599, longitude: 126.7802 },
    { location: "익산", latitude: 35.9483, longitude: 126.9576 }
];
const LIVE_WEATHER_REFRESH_MINUTES = 10;
const LOCAL_MART_REFRESH_MINUTES = 30;
const LIVE_NEWS_REFRESH_MINUTES = 10;
const RSS_TO_JSON_ENDPOINT = "https://api.rss2json.com/v1/api.json";
const GOOGLE_NEWS_RECENT_RSS = "https://news.google.com/rss/search?q=%EC%A3%BC%EC%9A%94+%EB%89%B4%EC%8A%A4+when:1h&hl=ko&gl=KR&ceid=KR:ko";
const GOOGLE_NEWS_LATEST_RSS = "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko";
const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const SEOUL_WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const SNAPSHOT_STALE_LIMITS_HOURS = {
    koreaMarkets: 72,
    usMarkets: 96,
    currencies: 72,
    gasoline: 96
};
const MART_CLOSURE_AREAS = [
    {
        region: "서울",
        weekday: 6,
        occurrences: [2, 4],
        chains: [
            { label: "이마트" },
            { label: "롯데마트" },
            { label: "홈플러스" },
            { label: "코스트코" }
        ]
    },
    {
        region: "김포",
        weekday: 2,
        occurrences: [2, 4],
        chains: [
            { label: "이마트" },
            { label: "롯데마트" },
            { label: "홈플러스", available: false },
            { label: "코스트코", available: false }
        ]
    },
    {
        region: "일산",
        weekday: 2,
        occurrences: [2, 4],
        chains: [
            { label: "이마트" },
            { label: "롯데마트" },
            { label: "홈플러스" },
            { label: "코스트코" }
        ]
    },
    {
        region: "익산",
        weekday: 6,
        occurrences: [2, 4],
        chains: [
            { label: "이마트" },
            { label: "롯데마트" },
            { label: "홈플러스" },
            { label: "코스트코", available: false }
        ]
    }
];

let autoRefreshTimer = 0;
let viewRenderedAt = new Date();
let liveWeatherTimer = 0;
let localMartTimer = 0;
let liveNewsTimer = 0;

const WEATHER_CODE_LABELS = {
    0: "맑음",
    1: "대체로 맑음",
    2: "구름 조금",
    3: "흐림",
    45: "안개",
    48: "짙은 안개",
    51: "약한 이슬비",
    53: "이슬비",
    55: "강한 이슬비",
    61: "약한 비",
    63: "비",
    65: "강한 비",
    71: "약한 눈",
    73: "눈",
    75: "강한 눈",
    77: "싸락눈",
    80: "소나기",
    81: "강한 소나기",
    82: "매우 강한 소나기",
    85: "약한 눈 소나기",
    86: "강한 눈 소나기",
    95: "뇌우",
    96: "약한 우박 동반 뇌우",
    99: "강한 우박 동반 뇌우"
};

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

function parseTimestamp(value) {
    if (!value) {
        return null;
    }

    const normalized = typeof value === "string" && value.includes(" ") && !value.includes("T")
        ? value.replace(" ", "T")
        : value;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function weatherLabel(code) {
    return WEATHER_CODE_LABELS[code] || "알 수 없음";
}

function aqiLabel(value) {
    if (value == null || Number.isNaN(Number(value))) {
        return "정보 없음";
    }

    const numeric = Number(value);
    if (numeric <= 20) return "좋음";
    if (numeric <= 40) return "보통";
    if (numeric <= 60) return "나쁨";
    if (numeric <= 80) return "매우 나쁨";
    return "매우 나쁨";
}

function getSeoulDateParts(now = new Date()) {
    const formatter = new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        weekday: "short"
    });
    const parts = formatter.formatToParts(now);
    const getValue = (type) => parts.find((part) => part.type === type)?.value || "";
    const weekdayLabel = getValue("weekday");

    return {
        year: Number(getValue("year")),
        month: Number(getValue("month")),
        day: Number(getValue("day")),
        weekday: SEOUL_WEEKDAY_LABELS.indexOf(weekdayLabel),
        weekdayLabel
    };
}

function nthWeekdayOfMonth(year, month, pythonWeekday, occurrence) {
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const firstPythonWeekday = (firstDay.getUTCDay() + 6) % 7;
    const offset = (pythonWeekday - firstPythonWeekday + 7) % 7;
    const day = 1 + offset + (occurrence - 1) * 7;

    return { year, month, day, weekday: pythonWeekday };
}

function formatMonthDayLabel(dateValue) {
    return `${String(dateValue.month).padStart(2, "0")}/${String(dateValue.day).padStart(2, "0")}(${WEEKDAY_LABELS[dateValue.weekday]})`;
}

function formatFullDateLabel(dateValue) {
    return `${dateValue.year}년 ${dateValue.month}월 ${dateValue.day}일 (${WEEKDAY_LABELS[dateValue.weekday]})`;
}

function monthlyHolidays(year, month, weekday, occurrences) {
    return occurrences.map((occurrence) => nthWeekdayOfMonth(year, month, weekday, occurrence));
}

function formatMartUpdatedAt(dateValue) {
    return `${dateValue.year}-${String(dateValue.month).padStart(2, "0")}-${String(dateValue.day).padStart(2, "0")} 00:00`;
}

function buildLocalMartClosures(now = new Date()) {
    const currentDate = getSeoulDateParts(now);
    const updatedAt = formatMartUpdatedAt(currentDate);

    return {
        todayLabel: formatFullDateLabel(currentDate),
        areas: MART_CLOSURE_AREAS.map((area) => {
            const holidays = monthlyHolidays(currentDate.year, currentDate.month, area.weekday, area.occurrences);
            const holidayText = holidays.map(formatMonthDayLabel).join(", ");
            const isTodayClosed = holidays.some((holiday) =>
                holiday.year === currentDate.year &&
                holiday.month === currentDate.month &&
                holiday.day === currentDate.day
            );

            return {
                region: area.region,
                monthLabel: `${currentDate.year}년 ${currentDate.month}월`,
                chains: area.chains.map((chain) => {
                    const available = chain.available !== false;
                    return {
                        label: chain.label,
                        todayClosed: available && isTodayClosed,
                        todayStatus: available ? (isTodayClosed ? "오늘 휴업" : "오늘 영업") : "점포 없음",
                        holidayText: available ? holidayText : "점포 없음",
                        updatedAt
                    };
                })
            };
        })
    };
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

function latestTimestampFromItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return null;
    }

    let latest = null;
    for (const item of items) {
        const parsed = parseTimestamp(item?.updatedAt);
        if (!parsed) {
            continue;
        }
        if (!latest || parsed.getTime() > latest.getTime()) {
            latest = parsed;
        }
    }

    return latest;
}

function snapshotWarningMessages() {
    if (!state) {
        return [];
    }

    const now = new Date();
    const checks = [
        { key: "koreaMarkets", label: "한국 주가지수" },
        { key: "usMarkets", label: "미국 주가지수" },
        { key: "currencies", label: "환율" },
        { key: "gasoline", label: "주유소" }
    ];

    return checks.flatMap((section) => {
        const items = section.key === "gasoline" ? state.gasoline?.areas : state[section.key];
        const latest = latestTimestampFromItems(items);
        if (!latest) {
            return [`${section.label} 기준 시각 없음`];
        }

        const ageHours = (now.getTime() - latest.getTime()) / 3600000;
        if (ageHours <= SNAPSHOT_STALE_LIMITS_HOURS[section.key]) {
            return [];
        }

        return [`${section.label} 스냅샷 ${Math.floor(ageHours)}시간 경과`];
    });
}

function latestAgeHoursFromItems(items) {
    const latest = latestTimestampFromItems(items);
    if (!latest) {
        return null;
    }

    return (Date.now() - latest.getTime()) / 3600000;
}

function panelStatusHtml(mode, detail, stale = false) {
    const modeLabels = {
        live: "라이브",
        hybrid: "하이브리드",
        snapshot: "스냅샷"
    };
    const notes = {
        live: "브라우저 안에서 즉시 갱신",
        hybrid: "실패 시 스냅샷 유지",
        snapshot: "Pages 스냅샷 재생성 필요"
    };

    return `
        <span class="panel-status-badge ${mode}">${modeLabels[mode] || mode}</span>
        <span class="panel-status-meta${stale ? " stale" : ""}">${escapeHtml(detail)}</span>
        <span class="panel-status-note">${escapeHtml(notes[mode] || "")}</span>
    `;
}

function renderPanelStatuses() {
    if (!state) {
        return;
    }

    const koreaAge = latestAgeHoursFromItems(state.koreaMarkets);
    const usAge = latestAgeHoursFromItems(state.usMarkets);
    const fxAge = latestAgeHoursFromItems(state.currencies);
    const gasAge = latestAgeHoursFromItems(state.gasoline?.areas);

    if (koreaStatusEl) {
        koreaStatusEl.innerHTML = panelStatusHtml(
            "snapshot",
            koreaAge == null ? "기준 시각 없음" : `${Math.floor(koreaAge)}시간 경과`,
            koreaAge != null && koreaAge > SNAPSHOT_STALE_LIMITS_HOURS.koreaMarkets
        );
    }

    if (usStatusEl) {
        usStatusEl.innerHTML = panelStatusHtml(
            "snapshot",
            usAge == null ? "기준 시각 없음" : `${Math.floor(usAge)}시간 경과`,
            usAge != null && usAge > SNAPSHOT_STALE_LIMITS_HOURS.usMarkets
        );
    }

    if (fxStatusEl) {
        fxStatusEl.innerHTML = panelStatusHtml(
            "snapshot",
            fxAge == null ? "기준 시각 없음" : `${Math.floor(fxAge)}시간 경과`,
            fxAge != null && fxAge > SNAPSHOT_STALE_LIMITS_HOURS.currencies
        );
    }

    if (weatherStatusEl) {
        weatherStatusEl.innerHTML = panelStatusHtml("live", "브라우저 직접 조회");
    }

    if (gasStatusEl) {
        gasStatusEl.innerHTML = panelStatusHtml(
            "snapshot",
            gasAge == null ? "기준 시각 없음" : `${Math.floor(gasAge)}시간 경과`,
            gasAge != null && gasAge > SNAPSHOT_STALE_LIMITS_HOURS.gasoline
        );
    }

    if (martStatusEl) {
        martStatusEl.innerHTML = panelStatusHtml("live", "브라우저 날짜 계산");
    }

    if (newsStatusEl) {
        newsStatusEl.innerHTML = panelStatusHtml("hybrid", "브라우저 재조회 우선");
    }
}

function splitNewsTitleAndSource(title) {
    const parts = String(title || "").split(" - ");
    if (parts.length >= 2) {
        const source = parts.pop();
        return {
            title: parts.join(" - ").trim(),
            source: source.trim() || "Google News"
        };
    }

    return {
        title: String(title || "").trim(),
        source: "Google News"
    };
}

function parseNewsDate(text) {
    if (!text) {
        return null;
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
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
    if (!martClosures || !martClosures.areas || martClosures.areas.length === 0) {
        martClosureCardEl.innerHTML = '<p class="empty-state">휴업일 정보를 불러오지 못했습니다.</p>';
        return;
    }

    const renderedAtText = formatDateTime(viewRenderedAt.toISOString());
    const todayLabel = martClosures.todayLabel || "날짜 정보 없음";

    martClosureCardEl.innerHTML = `
        <p class="mart-summary">오늘 ${escapeHtml(todayLabel)}</p>
        ${martClosures.areas.map((area) => `
            <section class="mart-region">
                <div class="mart-region-head">
                    <p class="mart-region-title">${escapeHtml(area.region || "지역 정보 없음")}</p>
                    <p class="mart-region-month">${escapeHtml(area.monthLabel || "기준 월 정보 없음")}</p>
                </div>
                <div class="mart-grid">
                    ${(area.chains || []).map((chain) => {
                        const unavailable = chain.todayStatus === "점포 없음";
                        const pillClass = unavailable ? "flat" : chain.todayClosed ? "down" : "up";
                        const pillText = unavailable ? "없음" : chain.todayClosed ? "휴업" : "영업";

                        return `
                            <article class="mart-chain-card">
                                <div class="mart-chain-head">
                                    <p class="stat-label">${escapeHtml(chain.label)}</p>
                                    <span class="pill ${pillClass}">${pillText}</span>
                                </div>
                                <p class="mart-status">${escapeHtml(chain.todayStatus || "정보 없음")}</p>
                                <p class="mart-holidays">이번 달 휴업일 ${escapeHtml(chain.holidayText || "정보 없음")}</p>
                                <div class="meta-text">표시 시각 ${escapeHtml(renderedAtText)}</div>
                                <div class="meta-text">데이터 기준 ${escapeHtml(formatDateTime(itemSourceTimestamp(chain) || currentDataTimestamp() || viewRenderedAt.toISOString()))}</div>
                            </article>
                        `;
                    }).join("")}
                </div>
            </section>
        `).join("")}
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

    state = {
        ...state,
        martClosures: buildLocalMartClosures()
    };

    const warnings = snapshotWarningMessages();
    generatedAtEl.innerHTML = [
        `표시 시각: ${escapeHtml(formatDateTime(viewRenderedAt.toISOString()))} | 데이터 기준: ${escapeHtml(formatDateTime(currentDataTimestamp() || viewRenderedAt.toISOString()))} (${escapeHtml(state.timezone || "시간대 미표시")})`,
        '<span class="status-note">브라우저 직접 갱신: 날씨 · 대형마트 휴업일 · 뉴스 | 스냅샷 기준: 한국/미국 지수 · 환율 · 주유소 (Pages 스냅샷 재생성 필요)</span>',
        warnings.length > 0 ? `<span class="status-warn">주의: ${escapeHtml(warnings.join(" / "))}</span>` : ""
    ].filter(Boolean).join("<br>");
    renderStats(koreaMarketsEl, state.koreaMarkets);
    renderStats(usMarketsEl, state.usMarkets);
    renderStats(currenciesEl, state.currencies);
    renderWeather(state.weather);
    renderGas(state.gasoline);
    renderMartClosures(state.martClosures);
    renderNews(state.news);
    renderSources(state.sources);
    renderPanelStatuses();
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

async function fetchLiveWeatherArea(area) {
    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.searchParams.set("latitude", String(area.latitude));
    weatherUrl.searchParams.set("longitude", String(area.longitude));
    weatherUrl.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m");
    weatherUrl.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    weatherUrl.searchParams.set("forecast_days", "1");
    weatherUrl.searchParams.set("timezone", "Asia/Seoul");

    const airUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    airUrl.searchParams.set("latitude", String(area.latitude));
    airUrl.searchParams.set("longitude", String(area.longitude));
    airUrl.searchParams.set("current", "european_aqi,pm10,pm2_5");
    airUrl.searchParams.set("timezone", "Asia/Seoul");

    const [weatherResponse, airResponse] = await Promise.all([
        fetch(weatherUrl, { cache: "no-store" }),
        fetch(airUrl, { cache: "no-store" })
    ]);

    if (!weatherResponse.ok) {
        throw new Error(`weather HTTP ${weatherResponse.status}`);
    }
    if (!airResponse.ok) {
        throw new Error(`air HTTP ${airResponse.status}`);
    }

    const weatherData = await weatherResponse.json();
    const airData = await airResponse.json();
    const current = weatherData.current || {};
    const daily = weatherData.daily || {};
    const airCurrent = airData.current || {};
    const maxTemp = (daily.temperature_2m_max || [current.temperature_2m])[0];
    const minTemp = (daily.temperature_2m_min || [current.temperature_2m])[0];
    const weatherCode = (daily.weather_code || [current.weather_code])[0];
    const rainChance = (daily.precipitation_probability_max || [0])[0];

    return {
        location: area.location,
        summary: weatherLabel(weatherCode),
        temperature: `${Number(current.temperature_2m ?? 0).toFixed(1)}°C`,
        feelsLike: `${Number(current.apparent_temperature ?? 0).toFixed(1)}°C`,
        highLow: `최고 ${Number(maxTemp ?? 0).toFixed(1)}° / 최저 ${Number(minTemp ?? 0).toFixed(1)}°`,
        humidity: `${Math.round(Number(current.relative_humidity_2m ?? 0))}%`,
        wind: `${Number(current.wind_speed_10m ?? 0).toFixed(1)} m/s`,
        rainChance: `${Math.round(Number(rainChance ?? 0))}%`,
        pm10: `${Number(airCurrent.pm10 ?? 0).toFixed(1)} μg/m³`,
        pm25: `${Number(airCurrent.pm2_5 ?? 0).toFixed(1)} μg/m³`,
        airQuality: aqiLabel(airCurrent.european_aqi),
        airQualityIndex: airCurrent.european_aqi != null ? String(Math.round(Number(airCurrent.european_aqi))) : "정보 없음",
        updatedAt: current.time || new Date().toISOString()
    };
}

async function refreshLiveWeather() {
    if (!state) {
        return;
    }

    try {
        const areas = await Promise.all(LIVE_WEATHER_LOCATIONS.map(fetchLiveWeatherArea));
        state = {
            ...state,
            weather: {
                ...(state.weather || {}),
                areas
            }
        };
        render();
    } catch (error) {
        console.error("Failed to refresh live weather", error);
    }
}

async function fetchNewsFeed(feedUrl) {
    const url = new URL(RSS_TO_JSON_ENDPOINT);
    url.searchParams.set("rss_url", feedUrl);

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`news HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload.status !== "ok") {
        throw new Error(payload.message || "rss2json failed");
    }

    return (payload.items || []).map((item) => {
        const parsed = splitNewsTitleAndSource(item.title || "");
        return {
            title: parsed.title,
            source: parsed.source,
            link: item.link || "",
            publishedAt: item.pubDate || item.publishedAt || ""
        };
    });
}

async function refreshLiveNews() {
    if (!state || IS_FILE_PROTOCOL) {
        return;
    }

    try {
        const [recentItems, latestItems] = await Promise.all([
            fetchNewsFeed(GOOGLE_NEWS_RECENT_RSS),
            fetchNewsFeed(GOOGLE_NEWS_LATEST_RSS)
        ]);

        const now = new Date();
        const picked = [];
        const seenLinks = new Set();

        for (const item of recentItems) {
            const publishedAt = parseNewsDate(item.publishedAt);
            if (!publishedAt) {
                continue;
            }

            const ageSeconds = (now.getTime() - publishedAt.getTime()) / 1000;
            if (ageSeconds < 0 || ageSeconds > 3600) {
                continue;
            }
            if (seenLinks.has(item.link)) {
                continue;
            }

            seenLinks.add(item.link);
            picked.push(item);
            if (picked.length >= 10) {
                break;
            }
        }

        if (picked.length < 10) {
            const fallbackPool = [...recentItems, ...latestItems]
                .filter((item) => !seenLinks.has(item.link))
                .sort((a, b) => {
                    const left = parseNewsDate(a.publishedAt)?.getTime() || 0;
                    const right = parseNewsDate(b.publishedAt)?.getTime() || 0;
                    return right - left;
                });

            for (const item of fallbackPool) {
                if (seenLinks.has(item.link)) {
                    continue;
                }

                seenLinks.add(item.link);
                picked.push(item);
                if (picked.length >= 10) {
                    break;
                }
            }
        }

        if (picked.length > 0) {
            state = {
                ...state,
                news: picked
            };
            render();
        }
    } catch (error) {
        console.error("Failed to refresh live news", error);
    }
}

function applyLiveWeatherRefresh() {
    if (liveWeatherTimer) {
        window.clearInterval(liveWeatherTimer);
        liveWeatherTimer = 0;
    }

    if (IS_FILE_PROTOCOL) {
        return;
    }

    liveWeatherTimer = window.setInterval(refreshLiveWeather, LIVE_WEATHER_REFRESH_MINUTES * 60 * 1000);
}

function applyLocalMartRefresh() {
    if (localMartTimer) {
        window.clearInterval(localMartTimer);
        localMartTimer = 0;
    }

    localMartTimer = window.setInterval(() => {
        if (!state) {
            return;
        }

        state = {
            ...state,
            martClosures: buildLocalMartClosures()
        };
        render();
    }, LOCAL_MART_REFRESH_MINUTES * 60 * 1000);
}

function applyLiveNewsRefresh() {
    if (liveNewsTimer) {
        window.clearInterval(liveNewsTimer);
        liveNewsTimer = 0;
    }

    if (IS_FILE_PROTOCOL) {
        return;
    }

    liveNewsTimer = window.setInterval(refreshLiveNews, LIVE_NEWS_REFRESH_MINUTES * 60 * 1000);
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
refreshLiveWeather();
applyLiveWeatherRefresh();
applyLocalMartRefresh();
refreshLiveNews();
applyLiveNewsRefresh();

