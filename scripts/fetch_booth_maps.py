"""
부스 배치도 그림 자동 저장 (GitHub Actions에서 실행돼요)

events.json에서 boothMap.imageUrl(공식 배치도 그림 주소)이 있는데
아직 maps/ 폴더에 그림이 없는 행사를 찾아서,
그림을 내려받아 maps/<행사id>.<확장자> 로 저장하고
boothMap.image 에 그 경로를 적어 넣어요.
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTS = os.path.join(ROOT, "events.json")
MAPS = os.path.join(ROOT, "maps")
EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
MAX_BYTES = 8 * 1024 * 1024  # 8MB 넘는 파일은 받지 않아요

def download(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (goods-fair booth map fetcher)",
        "Accept": "image/*",
    })
    with urllib.request.urlopen(req, timeout=30) as res:
        ctype = res.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if ctype not in EXT:
            raise ValueError(f"그림 파일이 아니에요 ({ctype or '알 수 없음'})")
        data = res.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("파일이 너무 커요")
        return data, EXT[ctype]

def main():
    with open(EVENTS, encoding="utf-8") as f:
        data = json.load(f)
    os.makedirs(MAPS, exist_ok=True)
    changed = False
    for ev in data.get("events", []):
        bm = ev.get("boothMap") or {}
        url = bm.get("imageUrl")
        if not url:
            continue
        current = bm.get("image")
        if current and os.path.exists(os.path.join(ROOT, current)):
            continue  # 이미 저장된 그림이 있으면 건드리지 않아요
        try:
            blob, ext = download(url)
        except Exception as e:  # 실패해도 다른 행사는 계속 진행
            print(f"[실패] {ev['id']}: {e}")
            bm["imageError"] = str(e)[:120]
            changed = True
            continue
        rel = f"maps/{ev['id']}.{ext}"
        with open(os.path.join(ROOT, rel), "wb") as f:
            f.write(blob)
        bm["image"] = rel
        bm.pop("imageError", None)
        changed = True
        print(f"[저장] {ev['id']} -> {rel} ({len(blob)//1024}KB)")
    if changed:
        with open(EVENTS, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
    return 0

if __name__ == "__main__":
    sys.exit(main())
