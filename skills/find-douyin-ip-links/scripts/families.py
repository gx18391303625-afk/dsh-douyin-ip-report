#!/usr/bin/env python3
"""视频族聚类与已知素材族命中（仅标准库，无第三方依赖）。

用途：在逐条打开视频之前，先用列表阶段就能拿到的信号（时长、标题、可选帧哈希）
把疑似"同一段素材的重复投稿"折叠成素材族。每族只需人工核对 1 条，
命中 known-negative 的族直接跳过。

数据格式
--------
fingerprints.json::

    {
      "schema_version": 1,
      "items": [
        {
          "video_id": "7693618238218865956",
          "url": "https://www.douyin.com/video/7693618238218865956",
          "creator": "某某专卖店",
          "duration_seconds": 54.1,
          "text": "原来这种藏在细节里的惦记……",
          "hash": "8f3a1c0d9b2e4f61"
        }
      ]
    }

`duration_seconds` 必填（未知填 null）；`text`、`hash` 可省略。
`hash` 为 64 位感知哈希的 16 位十六进制字符串，缺失时只用时长+标题判断。

素材族库（默认 `--library` 指向的目录，读取其中所有 *.json）::

    {"schema_version": 1, "families": [
      {"id": "elevator-double-warmth",
       "label": "电梯口 棕蓝外套 蓝格围巾 DOUBLE WARMTH",
       "verdict": "excluded",
       "reason": "本批参考产品不同，且无原创对应镜头",
       "durations": [54.1, 53.7],
       "hashes": ["8f3a1c0d9b2e4f61"],
       "texts": ["原来比冬天更早来的"]}
    ]}

命令
----
    python3 families.py init   --library DIR
    python3 families.py cluster --fingerprints F [--library DIR] [--json-out O] [--md-out O]
    python3 families.py learn  --library DIR --fingerprints F --members ID,ID \
                               --verdict excluded|candidate --label 名称 [--reason 说明]
    python3 families.py selftest

`cluster` 的每族给出 action：
  skip             命中 known-negative，不必打开
  inherit_candidate 命中已确认候选族，可直接沿用结论并复核 1 条
  review           新族，需要实际打开视频核对
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SCHEMA_VERSION = 1
DEFAULT_LIBRARY = "families"


# ---------------------------------------------------------------- 基础工具


def parse_hash(value: str | None) -> int | None:
    """把 16 位十六进制哈希转成整数；非法或不完整返回 None。"""
    if not value:
        return None
    text = str(value).strip().lower()
    if text.startswith("0x"):
        text = text[2:]
    if len(text) != 16 or any(c not in "0123456789abcdef" for c in text):
        return None
    return int(text, 16)


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"#[^\s#]+", " ", str(value))
    text = re.sub(r"[^\w\u4e00-\u9fff]+", "", text)
    return text.lower()


def bigrams(text: str) -> set[str]:
    if len(text) < 2:
        return {text} if text else set()
    return {text[i : i + 2] for i in range(len(text) - 1)}


def text_similarity(a: str | None, b: str | None) -> float:
    ta, tb = bigrams(normalize_text(a)), bigrams(normalize_text(b))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


# ---------------------------------------------------------------- 载入数据


def load_fingerprints(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise SystemExit(f"{path}: 需要 items 数组")
    out: list[dict] = []
    seen: set[str] = set()
    for raw in items:
        vid = str(raw.get("video_id") or "").strip()
        if not vid:
            continue
        if vid in seen:  # 同一视频只保留第一条
            continue
        seen.add(vid)
        duration = raw.get("duration_seconds")
        try:
            duration = float(duration) if duration is not None else None
        except (TypeError, ValueError):
            duration = None
        out.append(
            {
                "video_id": vid,
                "url": raw.get("url") or f"https://www.douyin.com/video/{vid}",
                "creator": raw.get("creator"),
                "duration_seconds": duration,
                "text": raw.get("text") or "",
                "hash": parse_hash(raw.get("hash")),
                "hash_raw": raw.get("hash"),
            }
        )
    return out


def load_library(path: Path) -> list[dict]:
    families: list[dict] = []
    if not path.exists():
        return families
    files = sorted(path.glob("*.json"))
    for file in files:
        try:
            data = json.loads(file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"[warn] 跳过无法解析的 {file.name}: {exc}", file=sys.stderr)
            continue
        for fam in data.get("families", []) or []:
            fam = dict(fam)
            fam.setdefault("verdict", "candidate")
            fam["_file"] = file.name
            fam["_hashes_int"] = [h for h in (parse_hash(x) for x in fam.get("hashes") or []) if h is not None]
            families.append(fam)
    return families


# ---------------------------------------------------------------- 聚类


def same_family(a: dict, b: dict, duration_tol: float, hash_tol: int, text_tol: float) -> tuple[bool, str]:
    """判断两条是否同一素材族，返回 (是否同族, 依据)。"""
    da, db = a["duration_seconds"], b["duration_seconds"]
    if da is None or db is None:
        duration_ok = da is None and db is None
    else:
        duration_ok = abs(da - db) <= duration_tol
    if not duration_ok:
        return False, "duration"
    if a["hash"] is not None and b["hash"] is not None:
        dist = hamming(a["hash"], b["hash"])
        if dist <= hash_tol:
            return True, f"hash:{dist}"
        # 哈希都算得出但差得远 → 不同族，避免只看时长误并
        return False, f"hash:{dist}"
    sim = text_similarity(a["text"], b["text"])
    if sim >= text_tol:
        return True, f"text:{sim:.2f}"
    # 只有双方时长都已知且已通过时长容差，才允许"仅凭时长"并族。
    # 时长未知又无标题时视为信号不足，宁可多核一条，也不静默并成巨族。
    if (
        da is not None
        and db is not None
        and a["hash"] is None
        and b["hash"] is None
        and not normalize_text(a["text"])
        and not normalize_text(b["text"])
    ):
        return True, "duration_only"
    return False, "insufficient_signal" if (da is None or db is None) else f"text:{sim:.2f}"


class UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def build_clusters(items: list[dict], duration_tol: float, hash_tol: int, text_tol: float) -> list[dict]:
    uf = UnionFind(len(items))
    evidence: dict[tuple[int, int], str] = {}
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            ok, basis = same_family(items[i], items[j], duration_tol, hash_tol, text_tol)
            if ok:
                uf.union(i, j)
                evidence[(i, j)] = basis
    groups: dict[int, list[int]] = {}
    for idx in range(len(items)):
        groups.setdefault(uf.find(idx), []).append(idx)
    clusters = []
    for root, members in groups.items():
        clusters.append(
            {
                "members": [items[i] for i in members],
                "indexes": members,
                "basis": sorted({ev for (i, j), ev in evidence.items() if i in members and j in members}),
            }
        )
    clusters.sort(key=lambda c: (-len(c["members"]), min(m["duration_seconds"] or 0 for m in c["members"])))
    return clusters


def match_library(cluster: dict, library: list[dict], duration_tol: float, hash_tol: int, text_tol: float) -> dict | None:
    """为一族找最接近的已知素材族。要求时长对得上，且哈希或标题能印证。"""
    best: dict | None = None
    best_score = -1.0
    members = cluster["members"]
    for fam in library:
        dur_hit = 0.0
        for fam_d in fam.get("durations") or []:
            try:
                fam_d = float(fam_d)
            except (TypeError, ValueError):
                continue
            for m in members:
                if m["duration_seconds"] is not None and abs(m["duration_seconds"] - fam_d) <= duration_tol:
                    dur_hit = 1.0
                    break
            if dur_hit:
                break
        if not dur_hit:
            continue

        hash_hit = None
        for m in members:
            if m["hash"] is None:
                continue
            for fh in fam.get("_hashes_int") or []:
                dist = hamming(m["hash"], fh)
                if dist <= hash_tol and (hash_hit is None or dist < hash_hit):
                    hash_hit = dist

        text_hit = 0.0
        for m in members:
            for fam_text in fam.get("texts") or []:
                text_hit = max(text_hit, text_similarity(m["text"], fam_text))

        hint_only = hash_hit is None and text_hit < text_tol
        # 只有时长重合、没有哈希也没有标题可以印证 → 仅作提示，不自动套用旧结论

        score = (1.0 - (0 if hash_hit is None else hash_hit / 64.0)) * 0.7 + text_hit * 0.3
        if score > best_score:
            best_score = score
            best = {
                "family_id": fam.get("id"),
                "label": fam.get("label"),
                "verdict": fam.get("verdict"),
                "reason": fam.get("reason"),
                "source_file": fam.get("_file"),
                "matched_by": {
                    "duration_within": duration_tol,
                    "hash_distance": hash_hit,
                    "text_similarity": round(text_hit, 3) if text_hit else None,
                },
                "score": round(score, 3),
                "hint_only": hint_only,
            }
    return best


def annotate(clusters: list[dict], library: list[dict], duration_tol: float, hash_tol: int, text_tol: float) -> list[dict]:
    out = []
    for i, cluster in enumerate(clusters):
        hit = match_library(cluster, library, duration_tol, hash_tol, text_tol)
        if hit and hit.get("hint_only"):
            # 只有时长重合，缺少哈希/标题印证：只提示"可能同族"，仍要实际核对
            action = "review"
        elif hit and hit["verdict"] == "excluded":
            action = "skip"
        elif hit and hit["verdict"] == "candidate":
            action = "inherit_candidate"
        else:
            action = "review"
        durations = sorted({round(m["duration_seconds"], 3) for m in cluster["members"] if m["duration_seconds"] is not None})
        out.append(
            {
                "cluster_id": f"c{i + 1:03d}",
                "size": len(cluster["members"]),
                "action": action,
                "known_family": hit,
                "durations": durations[:6],
                "representative": {
                    "video_id": cluster["members"][0]["video_id"],
                    "url": cluster["members"][0]["url"],
                    "text": (cluster["members"][0]["text"] or "")[:80],
                },
                "members": [
                    {"video_id": m["video_id"], "url": m["url"], "creator": m["creator"], "duration_seconds": m["duration_seconds"]}
                    for m in cluster["members"]
                ],
                "evidence": cluster["basis"],
            }
        )
    return out


# ---------------------------------------------------------------- 输出


def render_markdown(result: dict) -> str:
    lines = [
        "# 素材族聚类结果",
        "",
        f"- 输入条目：{result['stats']['items']}",
        f"- 素材族：{result['stats']['clusters']}",
        f"- 需实际核对族：{result['stats']['review_clusters']}（{result['stats']['review_videos']} 条）",
        f"- 命中已排除族：{result['stats']['skip_clusters']}（{result['stats']['skip_videos']} 条，可直接跳过）",
        f"- 命中已确认候选族：{result['stats']['inherit_clusters']}（{result['stats']['inherit_videos']} 条）",
        "",
        "| 族 | 条数 | 时长(s) | 动作 | 已知族 | 代表视频 |",
        "|---|---:|---|---|---|---|",
    ]
    for c in result["clusters"]:
        fam = c.get("known_family") or {}
        lines.append(
            "| {cid} | {size} | {dur} | {action} | {fam} | {url} |".format(
                cid=c["cluster_id"],
                size=c["size"],
                dur=", ".join(str(d) for d in c["durations"][:3]) or "未知",
                action=c["action"],
                fam=fam.get("label") or "—",
                url=c["representative"]["url"],
            )
        )
    return "\n".join(lines) + "\n"


def summarize(result: dict) -> None:
    s = result["stats"]
    print(f"条目 {s['items']} → 素材族 {s['clusters']}")
    print(f"  需实际核对：{s['review_clusters']} 族 / {s['review_videos']} 条")
    print(f"  可直接跳过：{s['skip_clusters']} 族 / {s['skip_videos']} 条")
    print(f"  沿用候选：  {s['inherit_clusters']} 族 / {s['inherit_videos']} 条")
    for c in result["clusters"][:12]:
        fam = (c.get("known_family") or {}).get("label")
        print(f"  [{c['cluster_id']}] {c['size']:>3} 条 {c['action']:<18} {c['representative']['url']}" + (f"  ← {fam}" if fam else ""))


# ---------------------------------------------------------------- 命令


def cmd_cluster(args: argparse.Namespace) -> int:
    items = load_fingerprints(Path(args.fingerprints))
    library = load_library(Path(args.library)) if args.library else []
    clusters = build_clusters(items, args.duration_tol, args.hash_tol, args.text_tol)
    annotated = annotate(clusters, library, args.duration_tol, args.hash_tol, args.text_tol)

    def total(action: str) -> tuple[int, int]:
        sel = [c for c in annotated if c["action"] == action]
        return len(sel), sum(c["size"] for c in sel)

    rv = total("review")
    sk = total("skip")
    ih = total("inherit_candidate")
    result = {
        "schema_version": SCHEMA_VERSION,
        "generated_by": "families.py",
        "thresholds": {"duration_tol": args.duration_tol, "hash_tol": args.hash_tol, "text_tol": args.text_tol},
        "library_families": len(library),
        "stats": {
            "items": len(items),
            "clusters": len(annotated),
            "review_clusters": rv[0],
            "review_videos": rv[1],
            "skip_clusters": sk[0],
            "skip_videos": sk[1],
            "inherit_clusters": ih[0],
            "inherit_videos": ih[1],
        },
        "clusters": annotated,
    }
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.md_out:
        Path(args.md_out).write_text(render_markdown(result), encoding="utf-8")
    summarize(result)
    return 0


def cmd_learn(args: argparse.Namespace) -> int:
    items = {i["video_id"]: i for i in load_fingerprints(Path(args.fingerprints))}
    members = [m.strip() for m in args.members.split(",") if m.strip()]
    picked = [items[m] for m in members if m in items]
    missing = [m for m in members if m not in items]
    if missing:
        print(f"[warn] 指纹文件中找不到：{', '.join(missing)}", file=sys.stderr)
    if not picked:
        raise SystemExit("没有可用成员，未写入素材族库")

    library_dir = Path(args.library)
    library_dir.mkdir(parents=True, exist_ok=True)
    target = library_dir / ("known-negative.json" if args.verdict == "excluded" else "family-fingerprints.json")
    if target.exists():
        data = json.loads(target.read_text(encoding="utf-8"))
    else:
        data = {"schema_version": SCHEMA_VERSION, "families": []}
    families = data.setdefault("families", [])
    families[:] = [f for f in families if f.get("id") != args.family_id]
    families.append(
        {
            "id": args.family_id,
            "label": args.label,
            "verdict": args.verdict,
            "reason": args.reason or "",
            "durations": sorted({round(i["duration_seconds"], 3) for i in picked if i["duration_seconds"] is not None}),
            "hashes": sorted({i["hash_raw"] for i in picked if i.get("hash_raw")}),
            "texts": sorted({i["text"][:60] for i in picked if i.get("text")}),
            "learned_at": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds"),
            "member_count": len(picked),
        }
    )
    if not any(f.get("hashes") for f in families if f.get("id") == args.family_id) and not any(
        f.get("texts") for f in families if f.get("id") == args.family_id
    ):
        print(
            "[warn] 该族只有时长信号（无帧哈希、无标题），下次只能作为\"可能同族\"提示，不会自动跳过。",
            file=sys.stderr,
        )
    data["families"] = sorted(families, key=lambda f: f["id"])
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写入 {target}（{args.family_id}，{len(picked)} 条成员）")
    return 0


def cmd_init(args: argparse.Namespace) -> int:
    directory = Path(args.library)
    directory.mkdir(parents=True, exist_ok=True)
    for name, verdict in (("known-negative.json", "excluded"), ("family-fingerprints.json", "candidate")):
        file = directory / name
        if file.exists():
            continue
        file.write_text(
            json.dumps({"schema_version": SCHEMA_VERSION, "families": []}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"已创建 {file}（{verdict} 库）")
    return 0


def cmd_selftest(_: argparse.Namespace) -> int:
    base = 54.10
    items = [
        {"video_id": "a1", "duration_seconds": base, "text": "原来比冬天更早来的，是男朋友的爱 提升幸福感好物", "hash": "f0f0f0f0f0f0f0f0"},
        {"video_id": "a2", "duration_seconds": 53.70, "text": "原来比冬天更早来的，是男朋友的爱 提升幸福感好物", "hash": "f0f0f0f0f0f0f0f1"},
        {"video_id": "a3", "duration_seconds": 54.13, "text": "电梯口暖手宝对 一到外边你的小手冰冰凉", "hash": None},
        {"video_id": "b1", "duration_seconds": 30.41, "text": "感谢高中不虚荣的自己 Becouse", "hash": "0000ffff0000ffff"},
        {"video_id": "b2", "duration_seconds": 30.77, "text": "感谢高中不虚荣的自己 Becouse", "hash": "0000ffff0000fffe"},
        {"video_id": "c1", "duration_seconds": 37.30, "text": "送女生的话 就买这个粉蓝色", "hash": "ffff0000ffff0000"},
    ]
    for it in items:
        it["url"] = f"https://www.douyin.com/video/{it['video_id']}"
        it["hash"] = parse_hash(it["hash"]) if it["hash"] else None
        it["hash_raw"] = None
        it["creator"] = "selftest"

    clusters = build_clusters(items, 0.6, 8, 0.5)
    sizes = sorted(len(c["members"]) for c in clusters)
    # a1+a2 并族（时长差 0.4s、哈希差 1 位）；a3 无哈希且标题不同 → 单独成族（保守）
    assert sizes == [1, 1, 2, 2], f"期望 [1,1,2,2]，实际 {sizes}"

    library = [
        {
            "id": "elevator",
            "label": "电梯口",
            "verdict": "excluded",
            "reason": "selftest",
            "durations": [54.1],
            "_hashes_int": [parse_hash("f0f0f0f0f0f0f0f0")],
            "texts": ["原来比冬天更早来的"],
            "_file": "known-negative.json",
        }
    ]
    annotated = annotate(clusters, library, 0.6, 8, 0.5)
    actions = sorted(c["action"] for c in annotated)
    assert actions == ["review", "review", "review", "skip"], f"期望 3×review+skip，实际 {actions}"

    # 只有时长相同、哈希差很远时不应被并成同族
    a = {"duration_seconds": 54.1, "text": "x", "hash": parse_hash("ffffffffffffffff")}
    b = {"duration_seconds": 54.1, "text": "x", "hash": parse_hash("0000000000000000")}
    ok, basis = same_family(a, b, 0.6, 8, 0.5)
    assert not ok and basis.startswith("hash:"), basis

    # 时长未知时不互相并族（避免把所有未知时长条目堆成巨族）
    c = {"duration_seconds": None, "text": "同标题", "hash": None}
    d = {"duration_seconds": None, "text": "同标题", "hash": None}
    ok2, _ = same_family(c, d, 0.6, 8, 0.5)
    assert ok2, "未知时长但标题相同时应可并族"

    print("selftest ok")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="视频族聚类与已知素材族命中")
    sub = p.add_subparsers(dest="command", required=True)

    c = sub.add_parser("cluster", help="对指纹文件做聚类并匹配已知素材族")
    c.add_argument("--fingerprints", required=True)
    c.add_argument("--library", default=DEFAULT_LIBRARY)
    c.add_argument("--duration-tol", type=float, default=0.6, help="时长容差秒数，默认 0.6")
    c.add_argument("--hash-tol", type=int, default=8, help="64 位感知哈希汉明距离阈值，默认 8")
    c.add_argument("--text-tol", type=float, default=0.5, help="标题 2-gram Jaccard 阈值，默认 0.5")
    c.add_argument("--json-out")
    c.add_argument("--md-out")
    c.set_defaults(func=cmd_cluster)

    l = sub.add_parser("learn", help="把一次人工结论沉淀为素材族")
    l.add_argument("--library", default=DEFAULT_LIBRARY)
    l.add_argument("--fingerprints", required=True)
    l.add_argument("--members", required=True, help="属于该族的 video_id，逗号分隔")
    l.add_argument("--family-id", required=True)
    l.add_argument("--verdict", choices=["excluded", "candidate"], required=True)
    l.add_argument("--label", required=True)
    l.add_argument("--reason", default="")
    l.set_defaults(func=cmd_learn)

    i = sub.add_parser("init", help="初始化素材族库目录")
    i.add_argument("--library", default=DEFAULT_LIBRARY)
    i.set_defaults(func=cmd_init)

    s = sub.add_parser("selftest", help="内置断言自检")
    s.set_defaults(func=cmd_selftest)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
