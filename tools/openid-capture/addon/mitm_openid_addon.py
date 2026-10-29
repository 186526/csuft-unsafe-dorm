import json
import os

from mitmproxy import http


CAPTURE_FILE = os.environ.get("MITM_OPENID_CAPTURE_FILE", "")
TARGET_PATH = "getOpenidByJsCode"


def response(flow: http.HTTPFlow) -> None:
    url = flow.request.pretty_url
    if TARGET_PATH not in url:
        return

    try:
        response_text = flow.response.get_text(strict=False)
    except Exception:
        response_text = ""

    openid = None
    try:
        payload = json.loads(response_text)
        if isinstance(payload, dict):
            data = payload.get("data")
            if isinstance(data, str) and data.strip():
                openid = data.strip()
    except Exception:
        openid = None

    if not CAPTURE_FILE:
        return

    record = {
        "matched_url": url,
        "openid": openid,
        "response_text": response_text,
    }

    with open(CAPTURE_FILE, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False))
        handle.write("\n")
