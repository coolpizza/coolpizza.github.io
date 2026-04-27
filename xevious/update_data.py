import datetime as dt
import html
import json
import math
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = BASE_DIR / "dashboard-data.js"
JSON_OUTPUT_FILE = BASE_DIR / "dashboard-data.json"
TIMEZONE = dt.timezone(dt.timedelta(hours=9))
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36"
OPINET_HOME_URL = "https://www.opinet.co.kr/"
OPINET_SEARCH_URL = "https://www.opinet.co.kr/searRgSelect.do"
OPINET_KEY_PATTERN = r"frm\.opinet_key\.value\s*=\s*'([^']+)'"
KMA_AUTH_KEY = os.environ.get("KMA_AUTH_KEY", "").strip()
OPINET_TIMEOUT = 12
OPINET_RETRIES = 2
WEATHER_LOCATIONS = [
    {"label": "서울", "latitude": 37.5665, "longitude": 126.9780},
    {"label": "김포", "latitude": 37.6153, "longitude": 126.7156},
    {"label": "파주", "latitude": 37.7599, "longitude": 126.7802},
    {"label": "익산", "latitude": 35.9483, "longitude": 126.9577},
]

WEATHER_CODE_LABELS = {
    0: "맑음",
    1: "대체로 맑음",
    2: "약간 흐림",
    3: "흐림",
    45: "안개",
    48: "착빙 안개",
    51: "약한 이슬비",
    53: "이슬비",
    55: "강한 이슬비",
    56: "약한 어는 이슬비",
    57: "어는 이슬비",
    61: "약한 비",
    63: "비",
    65: "강한 비",
    66: "약한 어는 비",
    67: "어는 비",
    71: "약한 눈",
    73: "눈",
    75: "강한 눈",
    77: "진눈깨비",
    80: "약한 소나기",
    81: "소나기",
    82: "강한 소나기",
    85: "약한 눈 소나기",
    86: "강한 눈 소나기",
    95: "뇌우",
    96: "약한 우박 동반 뇌우",
    99: "강한 우박 동반 뇌우",
}

AQI_LABELS = [
    (20, "좋음"),
    (40, "보통"),
    (60, "약간 나쁨"),
    (80, "나쁨"),
    (100, "매우 나쁨"),
]
WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]
MART_CLOSURE_AREAS = [
    {
        "region": "서울",
        "weekday": 6,
        "occurrences": [2, 4],
        "chains": [
            {"label": "이마트"},
            {"label": "롯데마트"},
            {"label": "홈플러스"},
            {"label": "코스트코"},
        ],
    },
    {
        "region": "김포",
        "weekday": 2,
        "occurrences": [2, 4],
        "chains": [
            {"label": "이마트"},
            {"label": "롯데마트"},
            {"label": "홈플러스", "available": False},
            {"label": "코스트코", "available": False},
        ],
    },
    {
        "region": "일산",
        "weekday": 2,
        "occurrences": [2, 4],
        "chains": [
            {"label": "이마트"},
            {"label": "롯데마트"},
            {"label": "홈플러스"},
            {"label": "코스트코"},
        ],
    },
    {
        "region": "익산",
        "weekday": 6,
        "occurrences": [2, 4],
        "chains": [
            {"label": "이마트"},
            {"label": "롯데마트"},
            {"label": "홈플러스"},
            {"label": "코스트코", "available": False},
        ],
    },
]

KMA_GRID_WIDTH = 149
KMA_SKY_LABELS = {
    1: "맑음",
    3: "구름많음",
    4: "흐림",
}
KMA_PTY_LABELS = {
    0: None,
    1: "비",
    2: "비/눈",
    3: "눈",
    4: "소나기",
    5: "빗방울",
    6: "빗방울/눈날림",
    7: "눈날림",
}


class FetchError(RuntimeError):
    pass


_opinet_public_key_cache = None


def fetch_text(url, data=None, timeout=20, retries=1, retry_delay=1.5):
    last_error = None

    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, data=data)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                charset = response.headers.get_content_charset()

            if charset:
                return raw.decode(charset, errors="ignore")

            meta_match = re.search(br'charset=["\']?([a-zA-Z0-9_-]+)', raw[:2000])
            if meta_match:
                return raw.decode(meta_match.group(1).decode("ascii", errors="ignore"), errors="ignore")

            for encoding in ("utf-8", "cp949", "euc-kr"):
                try:
                    return raw.decode(encoding)
                except UnicodeDecodeError:
                    continue

            return raw.decode("utf-8", errors="ignore")
        except Exception as error:
            last_error = error
            if attempt < retries - 1:
                time.sleep(retry_delay * (attempt + 1))

    raise FetchError(f"요청 실패: {url} ({last_error})")


def fetch_json(url, data=None, timeout=20, retries=1):
    return json.loads(fetch_text(url, data=data, timeout=timeout, retries=retries))


def load_existing_dashboard_data():
    if not JSON_OUTPUT_FILE.exists():
        return {}

    try:
        return json.loads(JSON_OUTPUT_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def get_opinet_public_key():
    global _opinet_public_key_cache

    if _opinet_public_key_cache:
        return _opinet_public_key_cache

    page = fetch_text(OPINET_HOME_URL, timeout=OPINET_TIMEOUT, retries=OPINET_RETRIES)
    key_match = re.search(OPINET_KEY_PATTERN, page)
    if not key_match:
        raise FetchError("오피넷 공개 접근 키를 찾을 수 없습니다.")

    _opinet_public_key_cache = key_match.group(1).strip()
    return _opinet_public_key_cache


def digits_from_number_markup(markup):
    pieces = re.findall(r'<span class="([^"]+)">([^<]+)</span>', markup)
    if not pieces:
        return ""

    value_parts = []
    for class_name, text in pieces:
        if class_name.startswith("no"):
            value_parts.append(text)
        elif class_name == "shim":
            value_parts.append(",")
        elif class_name == "jum":
            value_parts.append(".")
        elif class_name == "per":
            value_parts.append("%")
        elif class_name == "minus":
            value_parts.append("-")
        elif class_name == "plus":
            value_parts.append("+")

    return "".join(value_parts).strip()


def parse_direction(markup):
    lowered = markup.lower()
    if "ico up" in lowered or "no_up" in lowered:
        return "up"
    if "ico down" in lowered or "no_down" in lowered:
        return "down"
    return "flat"


def parse_world_quote(html, label):
    now_match = re.search(r'<p class="no_today">([\s\S]*?)</p>', html)
    diff_match = re.search(r'<p class="no_exday">([\s\S]*?)</p>', html)
    if not now_match or not diff_match:
        raise FetchError(f"{label} 데이터를 파싱할 수 없습니다.")

    value = digits_from_number_markup(now_match.group(1))
    diff_markup = diff_match.group(1)
    em_blocks = re.findall(r"<em[^>]*>([\s\S]*?)</em>", diff_markup)
    if len(em_blocks) < 2:
        raise FetchError(f"{label} 등락 정보를 파싱할 수 없습니다.")

    direction = parse_direction(diff_markup)
    change = digits_from_number_markup(em_blocks[0])
    change_percent = digits_from_number_markup(em_blocks[1])
    sign = "+" if direction == "up" else "-" if direction == "down" else ""

    if sign and not change.startswith(("+", "-")):
        change = sign + change
    if sign and not change_percent.startswith(("+", "-")):
        change_percent = sign + change_percent

    return {
        "label": label,
        "value": value,
        "change": change,
        "changePercent": change_percent,
        "direction": direction,
    }


def parse_simple_quote(html, label):
    value_match = re.search(r'id="now_value">([^<]+)<', html)
    diff_match = re.search(r'id="change_value_and_rate"><span>([^<]+)</span>\s*([+-]?[0-9.,]+%)', html)
    if not value_match or not diff_match:
        raise FetchError(f"{label} 데이터를 파싱할 수 없습니다.")

    if diff_match.group(2).startswith("+"):
        direction_text = "상승"
    elif diff_match.group(2).startswith("-"):
        direction_text = "하락"
    else:
        direction_text = "보합"
    direction = {"상승": "up", "하락": "down", "보합": "flat"}[direction_text]
    sign = ""
    if direction == "up" and not diff_match.group(1).startswith(("+", "-")):
        sign = "+"
    elif direction == "down" and not diff_match.group(1).startswith(("+", "-")):
        sign = "-"

    return {
        "label": label,
        "value": value_match.group(1).strip(),
        "change": f"{sign}{diff_match.group(1).strip()}",
        "changePercent": diff_match.group(2).strip(),
        "direction": direction,
    }


def parse_fx_quote(html, label):
    return parse_world_quote(html, label)


def parse_google_finance_quote(url, label, value_multiplier=1):
    page = fetch_text(url)

    price_match = re.search(r'data-last-price="([^"]+)"', page)
    if not price_match:
        raise FetchError(f"{label} Google Finance 현재가를 찾을 수 없습니다.")

    displayed_price_match = re.search(
        r'data-last-price="[^"]+"[^>]*>.*?<div class="YMlKec fxKbKc">([^<]+)</div>',
        page,
        re.S,
    )
    previous_close_match = re.search(r'Previous close</div>.*?<div class="P6K39c">([^<]+)</div>', page, re.S)
    timestamp_match = re.search(r'data-last-normal-market-timestamp="([^"]+)"', page)
    offset_match = re.search(r'data-tz-offset=([^ >]+)', page)

    if not displayed_price_match or not previous_close_match:
        raise FetchError(f"{label} Google Finance 기준값을 찾을 수 없습니다.")

    current_value = float(price_match.group(1)) * value_multiplier
    previous_close = float(previous_close_match.group(1).replace(",", "")) * value_multiplier

    if value_multiplier == 1:
        value_text = displayed_price_match.group(1).strip()
    else:
        value_text = f"{current_value:,.2f}"

    change_value = current_value - previous_close
    change_percent_value = 0 if previous_close == 0 else (change_value / previous_close) * 100

    if change_value > 0:
        direction = "up"
    elif change_value < 0:
        direction = "down"
    else:
        direction = "flat"

    updated_at = now_text()
    if timestamp_match and offset_match:
        tz_offset_ms = int(html.unescape(offset_match.group(1)).replace('"', ""))
        quote_tz = dt.timezone(dt.timedelta(milliseconds=tz_offset_ms))
        updated_at = (
            dt.datetime.fromtimestamp(int(timestamp_match.group(1)), tz=quote_tz)
            .astimezone(TIMEZONE)
            .strftime("%Y-%m-%d %H:%M")
        )

    return {
        "label": label,
        "value": value_text,
        "change": f"{change_value:+,.2f}",
        "changePercent": f"{change_percent_value:+.2f}%",
        "direction": direction,
        "updatedAt": updated_at,
    }


def now_text():
    return dt.datetime.now(TIMEZONE).strftime("%Y-%m-%d %H:%M")


def us_eastern_to_seoul_text(date_text):
    parsed = dt.datetime.strptime(date_text.strip(), "%Y.%m.%d %H:%M")
    year = parsed.year

    dst_start_day = nth_weekday_of_month(year, 3, 6, 2).day
    dst_end_day = nth_weekday_of_month(year, 11, 6, 1).day
    dst_start = dt.datetime(year, 3, dst_start_day, 2, 0)
    dst_end = dt.datetime(year, 11, dst_end_day, 2, 0)
    offset_hours = -4 if dst_start <= parsed < dst_end else -5

    eastern = dt.timezone(dt.timedelta(hours=offset_hours))
    return parsed.replace(tzinfo=eastern).astimezone(TIMEZONE).strftime("%Y-%m-%d %H:%M")


def parse_naver_fx_quote(url, label):
    page = fetch_text(url)
    quote = parse_world_quote(page, label)
    updated_match = re.search(r'<span class="date">([0-9. ]+[0-9:]+)</span>', page)

    updated_at = now_text()
    if updated_match:
        updated_at = updated_match.group(1).strip().replace(".", "-")

    return {
        **quote,
        "updatedAt": updated_at,
    }


def parse_naver_index_quote(url, label):
    return {
        **parse_simple_quote(fetch_text(url), label),
        "updatedAt": now_text(),
    }


def parse_naver_world_quote(url, label):
    page = fetch_text(url)
    quote = parse_world_quote(page, label)
    updated_match = re.search(r'<span class="date"><em>([0-9. ]+[0-9:]+)</em>\s*현지시간 기준', page)

    updated_at = now_text()
    if updated_match:
        updated_at = us_eastern_to_seoul_text(updated_match.group(1))

    return {
        **quote,
        "updatedAt": updated_at,
    }


def nth_weekday_of_month(year, month, weekday, occurrence):
    first_day = dt.date(year, month, 1)
    offset = (weekday - first_day.weekday()) % 7
    day = 1 + offset + (occurrence - 1) * 7
    return dt.date(year, month, day)


def format_month_day_label(date_value):
    return f"{date_value.month:02d}/{date_value.day:02d}({WEEKDAY_LABELS[date_value.weekday()]})"


def format_full_date_label(date_value):
    return f"{date_value.year}년 {date_value.month}월 {date_value.day}일 ({WEEKDAY_LABELS[date_value.weekday()]})"


def monthly_holidays(year, month, weekday, occurrences):
    return [nth_weekday_of_month(year, month, weekday, occurrence) for occurrence in occurrences]


def format_local_time(iso_text):
    if not iso_text:
        return now_text()

    try:
        parsed = dt.datetime.fromisoformat(iso_text)
    except ValueError:
        return iso_text

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TIMEZONE)
    else:
        parsed = parsed.astimezone(TIMEZONE)

    return parsed.strftime("%Y-%m-%d %H:%M")


def weather_label(code):
    return WEATHER_CODE_LABELS.get(code, "알 수 없음")


def aqi_label(value):
    if value is None:
        return "정보 없음"

    for threshold, label in AQI_LABELS:
        if value <= threshold:
            return label

    return "매우 나쁨"


def parse_grid_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if number <= -90:
        return None

    return number


def latlon_to_kma_grid(latitude, longitude):
    re_value = 6371.00877 / 5.0
    slat1 = 30.0 * (math.pi / 180.0)
    slat2 = 60.0 * (math.pi / 180.0)
    olon = 126.0 * (math.pi / 180.0)
    olat = 38.0 * (math.pi / 180.0)

    sn = math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5)
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(sn)
    sf = math.tan(math.pi * 0.25 + slat1 * 0.5)
    sf = (sf ** sn) * math.cos(slat1) / sn
    ro = math.tan(math.pi * 0.25 + olat * 0.5)
    ro = re_value * sf / (ro ** sn)

    ra = math.tan(math.pi * 0.25 + latitude * (math.pi / 180.0) * 0.5)
    ra = re_value * sf / (ra ** sn)
    theta = longitude * (math.pi / 180.0) - olon

    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi

    theta *= sn

    return {
        "x": int(math.floor(ra * math.sin(theta) + 43 + 0.5)),
        "y": int(math.floor(ro - ra * math.cos(theta) + 136 + 0.5)),
    }


def latest_kma_tmfc(now=None):
    current = (now or dt.datetime.now(TIMEZONE)).astimezone(TIMEZONE)
    release_hours = [2, 5, 8, 11, 14, 17, 20, 23]
    candidates = [
        current.replace(hour=hour, minute=0, second=0, microsecond=0)
        for hour in release_hours
        if current.hour > hour or (current.hour == hour and current.minute >= 10)
    ]

    if candidates:
        return candidates[-1]

    previous_day = current - dt.timedelta(days=1)
    return previous_day.replace(hour=23, minute=0, second=0, microsecond=0)


def latest_kma_tmef(now=None):
    current = (now or dt.datetime.now(TIMEZONE)).astimezone(TIMEZONE)
    return current.replace(minute=0, second=0, microsecond=0)


def fetch_kma_grid_values(var_name, tmfc, tmef, cache):
    cache_key = (var_name, tmfc.strftime("%Y%m%d%H"), tmef.strftime("%Y%m%d%H"))
    if cache_key in cache:
        return cache[cache_key]

    if not KMA_AUTH_KEY:
        raise FetchError("KMA_AUTH_KEY 환경 변수가 설정되지 않았습니다.")

    url = (
        "https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-dfs_shrt_grd"
        f"?tmfc={tmfc:%Y%m%d%H}"
        f"&tmef={tmef:%Y%m%d%H}"
        f"&vars={var_name}"
        f"&authKey={KMA_AUTH_KEY}"
    )
    grid_text = fetch_text(url, timeout=35, retries=2, retry_delay=2.0)
    values = [parse_grid_number(piece.strip()) for piece in grid_text.replace("\n", "").split(",") if piece.strip()]

    if len(values) != KMA_GRID_WIDTH * 253:
        raise FetchError(f"기상청 격자 자료 길이가 예상과 다릅니다. ({var_name})")

    cache[cache_key] = values
    return values


def grid_value_at(values, grid):
    index = (grid["y"] - 1) * KMA_GRID_WIDTH + (grid["x"] - 1)
    if index < 0 or index >= len(values):
        raise FetchError("기상청 격자 인덱스가 범위를 벗어났습니다.")
    return values[index]


def kma_weather_summary(sky_code, pty_code):
    precipitation_label = KMA_PTY_LABELS.get(int(pty_code or 0))
    if precipitation_label:
        return precipitation_label
    return KMA_SKY_LABELS.get(int(sky_code or 0), "정보 없음")


def fetch_open_meteo_air_quality(location):
    air_url = (
        "https://air-quality-api.open-meteo.com/v1/air-quality"
        f"?latitude={location['latitude']}"
        f"&longitude={location['longitude']}"
        "&current=pm10,pm2_5,european_aqi"
        "&timezone=Asia%2FSeoul"
    )
    air_data = fetch_json(air_url, timeout=25, retries=2)
    air_current = air_data.get("current", {})
    aqi_value = air_current.get("european_aqi")

    return {
        "pm10": f"{air_current.get('pm10', 0):.1f} μg/m³",
        "pm25": f"{air_current.get('pm2_5', 0):.1f} μg/m³",
        "airQuality": aqi_label(aqi_value),
        "airQualityIndex": None if aqi_value is None else f"{aqi_value:.0f}",
    }


def fetch_open_meteo_weather_location(location):
    weather_url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={location['latitude']}"
        f"&longitude={location['longitude']}"
        "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
        "&timezone=Asia%2FSeoul"
        "&forecast_days=1"
    )
    weather_data = fetch_json(weather_url, timeout=25, retries=2)
    current = weather_data.get("current", {})
    daily = weather_data.get("daily", {})
    air = fetch_open_meteo_air_quality(location)

    daily_code = (daily.get("weather_code") or [current.get("weather_code", -1)])[0]
    max_temp = (daily.get("temperature_2m_max") or [current.get("temperature_2m", 0)])[0]
    min_temp = (daily.get("temperature_2m_min") or [current.get("temperature_2m", 0)])[0]
    rain_chance = (daily.get("precipitation_probability_max") or [0])[0]

    return {
        "location": location["label"],
        "summary": weather_label(daily_code),
        "temperature": f"{current.get('temperature_2m', 0):.1f}°C",
        "feelsLike": f"{current.get('apparent_temperature', 0):.1f}°C",
        "highLow": f"최고 {max_temp:.1f}° / 최저 {min_temp:.1f}°",
        "humidity": f"{current.get('relative_humidity_2m', 0)}%",
        "wind": f"{current.get('wind_speed_10m', 0):.1f} m/s",
        "rainChance": f"{rain_chance}%",
        **air,
        "updatedAt": format_local_time(current.get("time")),
    }


def fetch_kma_weather_location(location, tmfc, tmef, grid_cache):
    grid = latlon_to_kma_grid(location["latitude"], location["longitude"])
    current_temperature = grid_value_at(fetch_kma_grid_values("TMP", tmfc, tmef, grid_cache), grid)
    humidity = grid_value_at(fetch_kma_grid_values("REH", tmfc, tmef, grid_cache), grid)
    wind_speed = grid_value_at(fetch_kma_grid_values("WSD", tmfc, tmef, grid_cache), grid)
    sky_code = grid_value_at(fetch_kma_grid_values("SKY", tmfc, tmef, grid_cache), grid)
    precipitation_type = grid_value_at(fetch_kma_grid_values("PTY", tmfc, tmef, grid_cache), grid)
    rain_chance = grid_value_at(fetch_kma_grid_values("POP", tmfc, tmef, grid_cache), grid)

    if current_temperature is None:
        raise FetchError(f"{location['label']} 기상청 기온 값을 찾지 못했습니다.")

    try:
        air = fetch_open_meteo_air_quality(location)
    except FetchError:
        air = {
            "pm10": "정보 없음",
            "pm25": "정보 없음",
            "airQuality": "정보 없음",
            "airQualityIndex": None,
        }

    return {
        "location": location["label"],
        "summary": kma_weather_summary(sky_code, precipitation_type),
        "temperature": f"{current_temperature:.1f}°C",
        "feelsLike": None,
        "highLow": None,
        "humidity": None if humidity is None else f"{humidity:.0f}%",
        "wind": None if wind_speed is None else f"{wind_speed:.1f} m/s",
        "rainChance": None if rain_chance is None else f"{rain_chance:.0f}%",
        **air,
        "updatedAt": tmef.strftime("%Y-%m-%d %H:%M"),
    }


def load_weather_data():
    tmfc = latest_kma_tmfc()
    tmef = latest_kma_tmef()
    grid_cache = {}

    try:
        areas = [fetch_kma_weather_location(location, tmfc, tmef, grid_cache) for location in WEATHER_LOCATIONS]
    except FetchError:
        areas = [fetch_open_meteo_weather_location(location) for location in WEATHER_LOCATIONS]

    return {"areas": areas}


def load_mart_closure_data(current_dt=None):
    current_dt = (current_dt or dt.datetime.now(TIMEZONE)).astimezone(TIMEZONE)
    current_date = current_dt.date()
    areas = []

    for area in MART_CLOSURE_AREAS:
        holidays = monthly_holidays(
            current_date.year,
            current_date.month,
            area["weekday"],
            area["occurrences"],
        )
        holiday_text = ", ".join(format_month_day_label(item) for item in holidays)
        today_closed = current_date in holidays
        chains = []

        for chain in area["chains"]:
            available = chain.get("available", True)
            chains.append(
                {
                    "label": chain["label"],
                    "todayClosed": today_closed if available else False,
                    "todayStatus": "오늘 휴업" if available and today_closed else "오늘 영업" if available else "점포 없음",
                    "holidayText": holiday_text if available else "점포 없음",
                    "updatedAt": now_text(),
                }
            )

        areas.append(
            {
                "region": area["region"],
                "monthLabel": f"{current_date.year}년 {current_date.month}월",
                "chains": chains,
            }
        )

    return {
        "todayLabel": format_full_date_label(current_date),
        "areas": areas,
    }


def preserve_mart_closure_updated_at(mart_closures, previous_mart_closures):
    previous_by_region = {}

    if previous_mart_closures:
        for area in previous_mart_closures.get("areas", []):
            region = area.get("region")
            if region:
                previous_by_region[region] = area

        legacy_region = previous_mart_closures.get("region")
        legacy_chains = previous_mart_closures.get("chains")
        if legacy_region and legacy_chains and legacy_region not in previous_by_region:
            previous_by_region[legacy_region] = {"chains": legacy_chains}

    for area in mart_closures.get("areas", []):
        previous_area = previous_by_region.get(area.get("region"), {})
        if area.get("chains"):
            area["chains"] = preserve_list_updated_at(
                area["chains"],
                previous_area.get("chains"),
                "label",
            )

    return mart_closures


def fallback_market_item(section_name, previous_items, label, error):
    for item in previous_items or []:
        if isinstance(item, dict) and item.get("label") == label:
            print(f"[{section_name}] Reusing previous snapshot for {label}: {error}")
            return item

    raise error


def load_market_item_with_fallback(loaders):
    last_error = None

    for loader in loaders:
        try:
            return loader()
        except FetchError as error:
            last_error = error

    if last_error:
        raise last_error

    raise FetchError("시장 데이터 로더가 비어 있습니다.")


def load_market_group(section_name, previous_items, definitions):
    items = []

    for label, loaders in definitions:
        try:
            items.append(load_market_item_with_fallback(loaders))
        except FetchError as error:
            items.append(fallback_market_item(section_name, previous_items, label, error))

    return items


def load_market_data(previous_data=None):
    previous_data = previous_data or {}

    korea = load_market_group(
        "koreaMarkets",
        previous_data.get("koreaMarkets"),
        [
            (
                "코스피",
                [
                    lambda: parse_naver_index_quote(
                        "https://finance.naver.com/sise/sise_index.naver?code=KOSPI",
                        "코스피",
                    ),
                ],
            ),
            (
                "코스닥",
                [
                    lambda: parse_naver_index_quote(
                        "https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ",
                        "코스닥",
                    ),
                ],
            ),
        ],
    )

    us = load_market_group(
        "usMarkets",
        previous_data.get("usMarkets"),
        [
            (
                "다우존스",
                [
                    lambda: parse_google_finance_quote("https://www.google.com/finance/quote/.DJI:INDEXDJX?hl=en", "다우존스"),
                    lambda: parse_naver_world_quote("https://finance.naver.com/world/sise.naver?symbol=DJI@DJI", "다우존스"),
                ],
            ),
            (
                "S&P 500",
                [
                    lambda: parse_google_finance_quote("https://www.google.com/finance/quote/.INX:INDEXSP?hl=en", "S&P 500"),
                    lambda: parse_naver_world_quote("https://finance.naver.com/world/sise.naver?symbol=SPI@SPX", "S&P 500"),
                ],
            ),
            (
                "나스닥",
                [
                    lambda: parse_google_finance_quote("https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ?hl=en", "나스닥"),
                    lambda: parse_naver_world_quote("https://finance.naver.com/world/sise.naver?symbol=NAS@IXIC", "나스닥"),
                ],
            ),
        ],
    )

    currencies = load_market_group(
        "currencies",
        previous_data.get("currencies"),
        [
            (
                "달러/원",
                [lambda: parse_naver_fx_quote("https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_USDKRW", "달러/원")],
            ),
            (
                "100엔/원",
                [lambda: parse_naver_fx_quote("https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_JPYKRW", "100엔/원")],
            ),
        ],
    )

    return korea, us, currencies


def load_opinet_default_page():
    payload = urllib.parse.urlencode(
        {
            "netfunnel_key": "dummy",
            "opinet_key": get_opinet_public_key(),
        }
    ).encode()
    return fetch_text(
        OPINET_SEARCH_URL,
        data=payload,
        timeout=OPINET_TIMEOUT,
        retries=OPINET_RETRIES,
    )


def extract_seoul_districts(html):
    select_match = re.search(
        r'<select\s+style="width:108px;"\s+id="SIGUNGU_NM0"[\s\S]*?</select>',
        html,
    )
    if not select_match:
        raise FetchError("오피넷 서울 자치구 목록을 찾을 수 없습니다.")

    districts = re.findall(r'<option value="([^"]+)"', select_match.group(0))
    return [item for item in districts if item and item != "시/군/구"]


def load_sigungu_names(sido_name):
    payload = urllib.parse.urlencode({"SIDO_NM": sido_name}).encode()
    data = fetch_json(
        "https://www.opinet.co.kr/common/sigunguGisSelect.do",
        data=payload,
        timeout=OPINET_TIMEOUT,
        retries=OPINET_RETRIES,
    )
    return [item["SIGUNGU_NM"] for item in data.get("result", []) if item.get("SIGUNGU_NM")]


def fetch_district_gasoline(sido_name, sido_code, district):
    payload = urllib.parse.urlencode(
        {
            "netfunnel_key": "dummy",
            "opinet_key": get_opinet_public_key(),
            "BTN_DIV": "os_btn",
            "BTN_DIV_STR": "",
            "POLL_ALL": "all",
            "SIDO_NM": sido_name,
            "SIDO_CD": sido_code,
            "SIGUNGU_NM": district,
            "SEARCH_MOD": "addr",
            "OS_NM": "",
            "OS_ADDR": "",
        }
    ).encode()

    html = fetch_text(
        OPINET_SEARCH_URL,
        data=payload,
        timeout=OPINET_TIMEOUT,
        retries=OPINET_RETRIES,
    )
    price_match = re.search(r'var B027_P\s*=\s*"([^"]+)"', html)
    station_match = re.search(r'var OS_NM\s*=\s*"([^"]+)"', html)
    address_match = re.search(r'var RD_ADDR\s*=\s*"([^"]+)"', html)
    updated_match = re.search(r'var B027_DT\s*=\s*"([^"]+)"', html)

    if not price_match or not station_match or not address_match:
        raise FetchError(f"{district} 휘발유 데이터를 파싱할 수 없습니다.")

    price_value = price_match.group(1).strip()
    price_number = int(re.sub(r"[^\d]", "", price_value))

    return {
        "district": district,
        "priceNumber": price_number,
        "price": f"{price_number:,}원/L",
        "stationName": station_match.group(1).strip(),
        "address": address_match.group(1).strip(),
        "updatedAt": updated_match.group(1).strip() if updated_match else now_text(),
    }


def summarize_gasoline_area(area_label, district_results):
    district_results.sort(key=lambda item: item["priceNumber"])
    best = district_results[0]
    return {
        "areaLabel": area_label,
        "lowestPrice": best["price"],
        "lowestDistrict": best["district"],
        "stationName": best["stationName"],
        "address": best["address"],
        "updatedAt": best["updatedAt"],
        "districtSamples": [
            {"district": item["district"], "price": item["price"]}
            for item in district_results[:5]
        ],
    }


def fallback_gasoline_area(previous_gasoline, area_label, error):
    if not previous_gasoline:
        print(f"[gasoline] {area_label} fallback unavailable: {error}")
        return None

    for area in previous_gasoline.get("areas", []):
        if area.get("areaLabel") == area_label:
            print(f"[gasoline] Reusing previous snapshot for {area_label}: {error}")
            return area

    print(f"[gasoline] {area_label} fallback unavailable: {error}")
    return None


def fallback_snapshot(section_name, previous_value, error, empty_value=None):
    if previous_value is not None:
        print(f"[{section_name}] Reusing previous snapshot: {error}")
        return previous_value

    if empty_value is not None:
        print(f"[{section_name}] Fallback unavailable, using empty value: {error}")
        return empty_value

    raise error


def comparable_item(item):
    if not isinstance(item, dict):
        return item

    return {key: value for key, value in item.items() if key != "updatedAt"}


def preserve_item_updated_at(item, previous_item):
    if not previous_item:
        return item

    if comparable_item(item) == comparable_item(previous_item) and previous_item.get("updatedAt"):
        item["updatedAt"] = previous_item["updatedAt"]

    return item


def preserve_list_updated_at(items, previous_items, key_name):
    previous_by_key = {
        item.get(key_name): item
        for item in (previous_items or [])
        if isinstance(item, dict) and item.get(key_name)
    }

    return [
        preserve_item_updated_at(item, previous_by_key.get(item.get(key_name)))
        if isinstance(item, dict)
        else item
        for item in items
    ]


def preserve_snapshot_generated_at(data, previous_data):
    if not previous_data:
        return data

    comparable_current = {key: value for key, value in data.items() if key != "generatedAt"}
    comparable_previous = {key: value for key, value in previous_data.items() if key != "generatedAt"}

    if comparable_current == comparable_previous and previous_data.get("generatedAt"):
        data["generatedAt"] = previous_data["generatedAt"]

    return data


def collect_gasoline_results(sido_name, sido_code, districts):
    results = []
    for district in districts:
        try:
            results.append(fetch_district_gasoline(sido_name, sido_code, district))
        except FetchError:
            continue

    if not results:
        raise FetchError(f"{sido_name} 지역 휘발유 데이터를 모두 가져오지 못했습니다.")

    return results


def load_gasoline_data(previous_gasoline=None):
    areas = []

    try:
        seoul_html = load_opinet_default_page()
        seoul_districts = extract_seoul_districts(seoul_html)
        seoul_results = collect_gasoline_results("서울특별시", "01", seoul_districts)
        areas.append(summarize_gasoline_area("서울 최저가", seoul_results))
    except FetchError as error:
        fallback_area = fallback_gasoline_area(previous_gasoline, "서울 최저가", error)
        if fallback_area:
            areas.append(fallback_area)

    try:
        incheon_districts = load_sigungu_names("인천광역시")
        incheon_results = collect_gasoline_results("인천광역시", "04", incheon_districts)
        areas.append(summarize_gasoline_area("인천 최저가", incheon_results))
    except FetchError as error:
        fallback_area = fallback_gasoline_area(previous_gasoline, "인천 최저가", error)
        if fallback_area:
            areas.append(fallback_area)

    try:
        iksan_result = fetch_district_gasoline("전북특별자치도", "13", "익산시")
        areas.append(summarize_gasoline_area("익산 최저가", [iksan_result]))
    except FetchError as error:
        fallback_area = fallback_gasoline_area(previous_gasoline, "익산 최저가", error)
        if fallback_area:
            areas.append(fallback_area)

    try:
        gimpo_result = fetch_district_gasoline("경기도", "02", "김포시")
        areas.append(summarize_gasoline_area("김포 최저가", [gimpo_result]))
    except FetchError as error:
        fallback_area = fallback_gasoline_area(previous_gasoline, "김포 최저가", error)
        if fallback_area:
            areas.append(fallback_area)

    try:
        paju_result = fetch_district_gasoline("경기도", "02", "파주시")
        areas.append(summarize_gasoline_area("파주 최저가", [paju_result]))
    except FetchError as error:
        fallback_area = fallback_gasoline_area(previous_gasoline, "파주 최저가", error)
        if fallback_area:
            areas.append(fallback_area)

    return {"areas": areas}


def clean_google_news_title(title):
    parts = [part.strip() for part in title.rsplit(" - ", 1)]
    if len(parts) == 2:
        return parts[0], parts[1]
    return title.strip(), "Google News"


def parse_google_news_items(xml_text):
    root = ET.fromstring(xml_text)
    items = []

    for item in root.findall("./channel/item"):
        title_text = item.findtext("title", default="").strip()
        title, source = clean_google_news_title(title_text)
        link = item.findtext("link", default="").strip()
        published = item.findtext("pubDate", default="").strip()

        published_dt = None
        if published:
            try:
                published_dt = parsedate_to_datetime(published).astimezone(TIMEZONE)
            except (TypeError, ValueError):
                published_dt = None

        items.append(
            {
                "title": title,
                "source": source,
                "link": link,
                "publishedAt": published,
                "_publishedDt": published_dt,
            }
        )

    return items


def load_news():
    now = dt.datetime.now(TIMEZONE)
    recent_query_url = "https://news.google.com/rss/search?q=%EC%A3%BC%EC%9A%94+%EB%89%B4%EC%8A%A4+when:1h&hl=ko&gl=KR&ceid=KR:ko"
    latest_url = "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko"

    recent_items = parse_google_news_items(fetch_text(recent_query_url))
    latest_items = parse_google_news_items(fetch_text(latest_url))

    picked = []
    seen_links = set()

    for item in recent_items:
        published_dt = item.get("_publishedDt")
        if not published_dt:
            continue

        age_seconds = (now - published_dt).total_seconds()
        if age_seconds < 0 or age_seconds > 3600:
            continue
        if item["link"] in seen_links:
            continue

        seen_links.add(item["link"])
        picked.append(item)

        if len(picked) >= 10:
            break

    if len(picked) < 10:
        remaining_recent = [item for item in recent_items if item["link"] not in seen_links]
        fallback_pool = remaining_recent + [item for item in latest_items if item["link"] not in seen_links]

        fallback_pool.sort(
            key=lambda item: item.get("_publishedDt") or dt.datetime.min.replace(tzinfo=TIMEZONE),
            reverse=True,
        )

        for item in fallback_pool:
            if item["link"] in seen_links:
                continue
            seen_links.add(item["link"])
            picked.append(item)
            if len(picked) >= 10:
                break

    return [
        {
            "title": item["title"],
            "source": item["source"],
            "link": item["link"],
            "publishedAt": item["publishedAt"],
        }
        for item in picked[:10]
    ]


def build_dashboard_data(previous_data=None):
    previous_data = previous_data or {}
    try:
        korea_markets, us_markets, currencies = load_market_data(previous_data)
    except FetchError as error:
        korea_markets = fallback_snapshot("koreaMarkets", previous_data.get("koreaMarkets"), error, empty_value=[])
        us_markets = fallback_snapshot("usMarkets", previous_data.get("usMarkets"), error, empty_value=[])
        currencies = fallback_snapshot("currencies", previous_data.get("currencies"), error, empty_value=[])

    try:
        weather = load_weather_data()
    except FetchError as error:
        weather = fallback_snapshot("weather", previous_data.get("weather"), error, empty_value={"areas": []})

    mart_closures = load_mart_closure_data()

    gasoline = load_gasoline_data(previous_data.get("gasoline"))
    if not gasoline.get("areas"):
        gasoline = fallback_snapshot("gasoline", previous_data.get("gasoline"), FetchError("No gasoline areas were fetched."), empty_value={"areas": []})

    try:
        news = load_news()
    except FetchError as error:
        news = fallback_snapshot("news", previous_data.get("news"), error, empty_value=[])

    korea_markets = preserve_list_updated_at(korea_markets, previous_data.get("koreaMarkets"), "label")
    us_markets = preserve_list_updated_at(us_markets, previous_data.get("usMarkets"), "label")
    currencies = preserve_list_updated_at(currencies, previous_data.get("currencies"), "label")

    if weather.get("areas"):
        weather["areas"] = preserve_list_updated_at(
            weather["areas"],
            previous_data.get("weather", {}).get("areas"),
            "location",
        )

    if mart_closures.get("areas"):
        mart_closures = preserve_mart_closure_updated_at(
            mart_closures,
            previous_data.get("martClosures"),
        )

    if gasoline.get("areas"):
        gasoline["areas"] = preserve_list_updated_at(
            gasoline["areas"],
            previous_data.get("gasoline", {}).get("areas"),
            "areaLabel",
        )

    data = {
        "generatedAt": dt.datetime.now(TIMEZONE).isoformat(),
        "timezone": "Asia/Seoul",
        "koreaMarkets": korea_markets,
        "usMarkets": us_markets,
        "currencies": currencies,
        "weather": weather,
        "martClosures": mart_closures,
        "gasoline": gasoline,
        "news": news,
        "sources": [
            {
                "label": "네이버 금융: 코스피",
                "url": "https://finance.naver.com/sise/sise_index.naver?code=KOSPI",
            },
            {
                "label": "네이버 금융: 코스닥",
                "url": "https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ",
            },
            {
                "label": "Google Finance: 세계 주요 지수",
                "url": "https://www.google.com/finance/",
            },
            {
                "label": "네이버 금융: 환율",
                "url": "https://finance.naver.com/marketindex/",
            },
            {
                "label": "오피넷: 싼 주유소 찾기",
                "url": "https://www.opinet.co.kr/searRgSelect.do",
            },
            {
                "label": "기상청 단기예보 + Open-Meteo 대기질",
                "url": "https://apihub.kma.go.kr/apiList.do?seqApi=10",
            },
            {
                "label": "Google News RSS",
                "url": "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko",
            },
        ],
    }

    return preserve_snapshot_generated_at(data, previous_data)


def write_output(data):
    json_text = json.dumps(data, ensure_ascii=False, indent=2)
    script = "window.DASHBOARD_DATA = " + json_text + ";\n"
    OUTPUT_FILE.write_text(script, encoding="utf-8")
    JSON_OUTPUT_FILE.write_text(json_text + "\n", encoding="utf-8")


def main():
    previous_data = load_existing_dashboard_data()
    data = build_dashboard_data(previous_data)
    write_output(data)
    print(f"Updated {OUTPUT_FILE.name}")


if __name__ == "__main__":
    main()
