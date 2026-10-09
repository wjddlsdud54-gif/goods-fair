"""
배치도 그림에서 부스 칸을 찾고, 칸마다 부스 번호(A01, B-12, SC 03 …)를 글자 인식(OCR)으로 읽어요.
사용법:  python3 scripts/find_booth_positions.py maps/행사id.jpg [확인용그림.png] > 결과.json
결과: [{"code": "B13", "pos": [x%, y%, 너비%, 높이%]}, ...]
※ 자동 인식이라 틀리거나 빠질 수 있어요. 확인용 그림을 열어 꼭 비교해서 확인하세요.
"""
import sys, re, json
import cv2, numpy as np, pytesseract

CODE = re.compile(r"^([A-Z]{1,2})[-\s]?(\d{1,3})$")
FIX = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "|": "1"})

def norm_code(raw):
    t = re.sub(r"[^A-Za-z0-9\-|]", "", raw).upper()
    # 첫 글자는 영문, 그 뒤는 (영문 1글자 더 가능) + 숫자. 숫자 자리의 O/Q/I는 0/0/1로 고쳐요
    m = re.match(r"^([A-Z])([A-Z]?)-?([0-9OQIL|]{1,3})$", t)
    if not m:
        return None
    first, second, digits = m.group(1), m.group(2), m.group(3)
    if second in ("O", "Q"):          # "BO8" → "B08"
        digits, second = "0" + digits, ""
    digits = digits.translate(str.maketrans({"O": "0", "Q": "0", "I": "1", "L": "1", "|": "1"}))
    if not digits.isdigit() or len(digits) > 3:
        return None
    return first + second + digits

def candidate_boxes(img):
    """비슷한 크기의 사각형 칸(부스) 후보 찾기"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape
    boxes = []
    # 1) 테두리/색 차이로 닫힌 사각형 찾기
    edges = cv2.Canny(gray, 30, 90)
    edges = cv2.dilate(edges, np.ones((2, 2), np.uint8))
    cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if w < W * 0.012 or h < H * 0.015 or w > W * 0.12 or h > H * 0.12:
            continue
        area = cv2.contourArea(cv2.convexHull(c))
        if area < 0.75 * w * h:
            continue
        boxes.append((x, y, w, h))
    # 겹치는 후보 정리 (거의 같은 칸은 하나만)
    boxes.sort(key=lambda b: b[2] * b[3])
    keep = []
    for b in boxes:
        cx, cy = b[0] + b[2] / 2, b[1] + b[3] / 2
        if any(abs(cx - (k[0] + k[2] / 2)) < k[2] * 0.4 and abs(cy - (k[1] + k[3] / 2)) < k[3] * 0.4 for k in keep):
            continue
        keep.append(b)
    return keep

def read_box(img, b):
    x, y, w, h = b
    crop = img[y + 2:y + h - 2, x + 2:x + w - 2]
    if crop.size == 0:
        return None
    crop = cv2.resize(crop, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if th.mean() < 127:
        th = 255 - th
    th = cv2.copyMakeBorder(th, 16, 16, 16, 16, cv2.BORDER_CONSTANT, value=255)
    for psm in (7, 6):
        txt = pytesseract.image_to_string(th, config=f"--psm {psm} -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-").strip()
        txt = " ".join(txt.split())
        code = norm_code(txt)
        if code:
            return code
    return None

def page_tokens(img):
    """그림 전체를 크게 키워 한 번에 글자 인식 → (글자, 가운데 x, 가운데 y)"""
    S = 3
    big = cv2.resize(img, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)
    g = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY)
    toks = []
    for psm in (11, 12):
        d = pytesseract.image_to_data(g, config=f"--psm {psm}", output_type=pytesseract.Output.DICT)
        for i, t in enumerate(d["text"]):
            t = t.strip()
            if t and float(d["conf"][i]) > 30:
                toks.append((t, (d["left"][i] + d["width"][i] / 2) / S, (d["top"][i] + d["height"][i] / 2) / S, d["top"][i] / S))
    return toks

def find(path):
    img = cv2.imread(path)
    H, W = img.shape[:2]
    toks = page_tokens(img)
    found, unknown = {}, []
    for b in candidate_boxes(img):
        x, y, w, h = b
        inside = {}
        for t, cx, cy, top in toks:  # 칸 안에 들어온 글자를 위→아래 순서로 이어붙이기 ("SC" + "01")
            if x <= cx <= x + w and y <= cy <= y + h:
                inside.setdefault(round(top / 4), set()).add(t)
        joined = "".join(sorted(v)[0] for k, v in sorted(inside.items()))
        code = norm_code(joined) if joined else None
        if not code:
            code = read_box(img, b)
        if code and code not in found:
            found[code] = b
        elif not code:
            unknown.append(b)
    infer_from_grid(found, unknown)
    return img, found, W, H

def infer_from_grid(found, unknown):
    """격자 배치도용: 못 읽은 칸은 같은 세로줄의 영문 + 같은 가로줄의 숫자로 추측해요"""
    known = [(c, b) for c, b in found.items() if re.match(r"^[A-Z]\d{2}$", c)]
    for b in unknown:
        x, y, w, h = b
        cx, cy = x + w / 2, y + h / 2
        col = [c[0] for c, k in known if abs(k[0] + k[2] / 2 - cx) < w * 0.35]
        row = [c[1:] for c, k in known if abs(k[1] + k[3] / 2 - cy) < h * 0.35 and abs(k[2] - w) < w * 0.3]
        if len(col) >= 3 and len(row) >= 3:
            letter = max(set(col), key=col.count)
            num = max(set(row), key=row.count)
            if col.count(letter) / len(col) > 0.7 and row.count(num) / len(row) > 0.6:
                code = letter + num
                if code not in found:
                    found[code] = b

if __name__ == "__main__":
    img, found, W, H = find(sys.argv[1])
    out = [{"code": c, "pos": [round(x / W * 100, 2), round(y / H * 100, 2), round(w / W * 100, 2), round(h / H * 100, 2)]}
           for c, (x, y, w, h) in sorted(found.items())]
    json.dump(out, sys.stdout, ensure_ascii=False)
    if len(sys.argv) > 2:  # 확인용 그림: 찾은 칸에 빨간 테두리 + 번호
        for c, (x, y, w, h) in found.items():
            cv2.rectangle(img, (x, y), (x + w, y + h), (0, 0, 255), 2)
            cv2.putText(img, c, (x + 2, y + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 0, 0), 1)
        cv2.imwrite(sys.argv[2], img)
    print(f"\n# {len(out)}개 찾음", file=sys.stderr)
