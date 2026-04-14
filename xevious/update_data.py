import datetime as dt
import json
import re
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


class FetchError(RuntimeError):
    pass


def fetch_text(url, data=None):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, data=data)
    with urllib.request.urlopen(request, timeout=20) as response:
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


def now_text():
    return dt.datetime.now(TIMEZONE).strftime("%Y-%m-%d %H:%M")


def load_market_data():
    kospi_html = fetch_text("https://finance.naver.com/sise/sise_index.naver?code=KOSPI")
    kosdaq_html = fetch_text("https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ")
    dji_html = fetch_text("https://finance.naver.com/world/sise.naver?symbol=DJI@DJI")
    spx_html = fetch_text("https://finance.naver.com/world/sise.naver?symbol=SPI@SPX")
    ixic_html = fetch_text("https://finance.naver.com/world/sise.naver?symbol=NAS@IXIC")
    usd_html = fetch_text("https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_USDKRW")
    jpy_html = fetch_text("https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_JPYKRW")

    updated_at = now_text()

    korea = [
        parse_simple_quote(kospi_html, "코스피"),
        parse_simple_quote(kosdaq_html, "코스닥"),
    ]
    for item in korea:
        item["updatedAt"] = updated_at

    us = [
        parse_world_quote(dji_html, "다우존스"),
        parse_world_quote(spx_html, "S&P 500"),
        parse_world_quote(ixic_html, "나스닥"),
    ]
    for item in us:
        item["updatedAt"] = updated_at

    currencies = [
        parse_fx_quote(usd_html, "달러/원"),
        parse_fx_quote(jpy_html, "100엔/원"),
    ]
    for item in currencies:
        item["updatedAt"] = updated_at

    return korea, us, currencies


def load_opinet_default_page():
    payload = urllib.parse.urlencode(
        {
            "netfunnel_key": "dummy",
            "opinet_key": "ZbFgD2Xm6B5PTJzDhTtLJNM3yM5pOE80K+g4g9+pono=",
        }
    ).encode()
    return fetch_text("https://www.opinet.co.kr/searRgSelect.do", data=payload)


def extract_seoul_districts(html):
    select_match = re.search(
        r'<select\s+style="width:108px;"\s+id="SIGUNGU_NM0"[\s\S]*?</select>',
        html,
    )
    if not select_match:
        raise FetchError("오피넷 서울 자치구 목록을 찾을 수 없습니다.")

    districts = re.findall(r'<option value="([^"]+)"', select_match.group(0))
    return [item for item in districts if item and item != "시/군/구"]


def fetch_district_gasoline(district):
    payload = urllib.parse.urlencode(
        {
            "netfunnel_key": "dummy",
            "opinet_key": "ZbFgD2Xm6B5PTJzDhTtLJNM3yM5pOE80K+g4g9+pono=",
            "BTN_DIV": "os_btn",
            "BTN_DIV_STR": "",
            "POLL_ALL": "all",
            "SIDO_NM": "서울특별시",
            "SIDO_CD": "01",
            "SIGUNGU_NM": district,
            "SEARCH_MOD": "addr",
            "OS_NM": "",
            "OS_ADDR": "",
        }
    ).encode()

    html = fetch_text("https://www.opinet.co.kr/searRgSelect.do", data=payload)
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


def load_gasoline_data():
    default_html = load_opinet_default_page()
    districts = extract_seoul_districts(default_html)
    district_results = [fetch_district_gasoline(district) for district in districts]
    district_results.sort(key=lambda item: item["priceNumber"])

    best = district_results[0]
    return {
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


def build_dashboard_data():
    korea_markets, us_markets, currencies = load_market_data()
    gasoline = load_gasoline_data()
    news = load_news()

    return {
        "generatedAt": dt.datetime.now(TIMEZONE).isoformat(),
        "timezone": "Asia/Seoul",
        "koreaMarkets": korea_markets,
        "usMarkets": us_markets,
        "currencies": currencies,
        "gasoline": gasoline,
        "news": news,
        "sources": [
            {
                "label": "네이버 금융: 코스피",
                "url": "https://finance.naver.com/sise/sise_index.naver?code=KOSPI",
            },
            {
                "label": "네이버 금융: 세계 주요 지수",
                "url": "https://finance.naver.com/world/",
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
                "label": "Google News RSS",
                "url": "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko",
            },
        ],
    }


def write_output(data):
    json_text = json.dumps(data, ensure_ascii=False, indent=2)
    script = "window.DASHBOARD_DATA = " + json_text + ";\n"
    OUTPUT_FILE.write_text(script, encoding="utf-8")
    JSON_OUTPUT_FILE.write_text(json_text + "\n", encoding="utf-8")


def main():
    data = build_dashboard_data()
    write_output(data)
    print(f"Updated {OUTPUT_FILE.name}")


if __name__ == "__main__":
    main()
