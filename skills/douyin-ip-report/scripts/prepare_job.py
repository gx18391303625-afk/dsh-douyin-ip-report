#!/usr/bin/env python3
"""Validate local Douyin complaint inputs; never open a browser or submit a report.

The generated JSON contains private complaint text and local paths. Keep it local.
Only the Python standard library is required.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import sys
from urllib.parse import parse_qs, urlsplit, urlunsplit
import xml.etree.ElementTree as ET
import zipfile

MAX_IMAGE_BYTES = 5_000_000
MAX_LINKS = 1000
MAX_XML_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
M = "{" + MAIN_NS + "}"
DEFAULT_SPECS = {
    "patent": {
        "template_label": "专利侵权话术",
        "link_label": "专利侵权链接",
        "evidence": [f"专利投诉材料{i}.jpg" for i in range(1, 7)],
        "identity_reference": "专利侵权的组织身份.png",
        "license": "patent-license.jpg",
    },
    "trademark": {
        "template_label": "商标侵权话术",
        "link_label": "商标侵权链接",
        "evidence": ["商标投诉材料.png"],
        "identity_reference": "商标侵权的组织身份.png",
        "license": "trademark-license.jpg",
    },
}


class InputError(ValueError):
    """An input needs user correction; messages deliberately omit private text."""


def _plain_name(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InputError(f"materials.json: {field} must be a non-empty file name")
    name = value.strip()
    if Path(name).name != name or "/" in name or "\\" in name:
        raise InputError(f"materials.json: {field} must be a plain file name without directories")
    return name


def _label(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InputError(f"materials.json: {field} must be a non-empty text label")
    return value.strip()


def load_specs(materials: Path) -> dict[str, dict]:
    """Read an optional materials.json; fall back to the generic file names."""
    path = materials / "materials.json"
    if not path.exists():
        return DEFAULT_SPECS
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InputError("Cannot read materials.json") from exc
    if not isinstance(raw, dict):
        raise InputError("materials.json must contain patent and trademark sections")
    specs: dict[str, dict] = {}
    for kind in ("patent", "trademark"):
        item = raw.get(kind)
        if not isinstance(item, dict):
            raise InputError(f"materials.json: missing {kind} section")
        default = DEFAULT_SPECS[kind]
        evidence = item.get("evidence", default["evidence"])
        if not isinstance(evidence, list) or not evidence:
            raise InputError(f"materials.json: {kind}.evidence must be a non-empty list")
        evidence = [_plain_name(value, f"{kind}.evidence") for value in evidence]
        expected = 6 if kind == "patent" else 1
        if len(evidence) != expected:
            raise InputError(f"materials.json: {kind}.evidence must list exactly {expected} image file names")
        specs[kind] = {
            "template_label": _label(item.get("template_label", default["template_label"]),
                                     f"{kind}.template_label"),
            "link_label": _label(item.get("link_label", default["link_label"]),
                                 f"{kind}.link_label"),
            "evidence": evidence,
            "identity_reference": _plain_name(item.get("identity_reference", default["identity_reference"]),
                                              f"{kind}.identity_reference"),
            "license": _plain_name(item.get("license", default["license"]), f"{kind}.license"),
        }
    return specs


def _xml(archive: zipfile.ZipFile, name: str) -> ET.Element:
    try:
        data = archive.read(name)
    except KeyError as exc:
        raise InputError("XLSX is missing a required XML part") from exc
    # OOXML normally uses UTF-8. Reject NUL-bearing UTF-16/32 XML so encoded
    # declarations cannot bypass the explicit DTD/entity rejection below.
    if (len(data) > MAX_XML_BYTES or b"\x00" in data
            or re.search(br"<!\s*(DOCTYPE|ENTITY)\b", data, re.I)):
        raise InputError("XLSX XML exceeds safety limits or contains unsupported declarations")
    try:
        return ET.fromstring(data)
    except ET.ParseError as exc:
        raise InputError("XLSX contains malformed XML") from exc


def _part_target(target: str) -> str:
    # Relationship targets are URI-like archive paths, never filesystem paths.
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or "\\" in target:
        raise InputError("XLSX contains an unsupported relationship target")
    raw = target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target)
    name = posixpath.normpath(raw)
    if name in (".", "..") or name.startswith("../"):
        raise InputError("XLSX relationship escapes the archive root")
    return name


def read_xlsx(path: Path) -> dict[str, dict[tuple[int, str], str]]:
    """Return sheet names and cells, following workbook relationships correctly."""
    try:
        if path.stat().st_size > MAX_ARCHIVE_BYTES:
            raise InputError("XLSX file exceeds the supported size limit")
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if (len(infos) > 1000 or len({i.filename for i in infos}) != len(infos)
                    or sum(i.file_size for i in infos) > MAX_ARCHIVE_BYTES
                    or any(i.file_size > MAX_XML_BYTES for i in infos)):
                raise InputError("XLSX archive exceeds safety limits or has duplicate parts")
            workbook = _xml(archive, "xl/workbook.xml")
            relroot = _xml(archive, "xl/_rels/workbook.xml.rels")
            relations = {}
            shared_part = None
            for rel in relroot.findall("{" + PACKAGE_REL_NS + "}Relationship"):
                rid = rel.get("Id")
                if not rid or rid in relations:
                    raise InputError("XLSX contains ambiguous relationships")
                if rel.get("TargetMode") == "External":
                    relations[rid] = None
                    continue
                target = _part_target(rel.get("Target", ""))
                relations[rid] = target
                if rel.get("Type", "").endswith("/sharedStrings"):
                    if shared_part is not None:
                        raise InputError("XLSX contains ambiguous shared strings")
                    shared_part = target
            shared = []
            if shared_part:
                shared = ["".join(t.text or "" for t in si.iter(M + "t"))
                          for si in _xml(archive, shared_part).findall(M + "si")]
            sheets = {}
            for sheet in workbook.findall(M + "sheets/" + M + "sheet"):
                name = sheet.get("name")
                rid = sheet.get("{" + DOC_REL_NS + "}id")
                if not name or name in sheets or not relations.get(rid):
                    raise InputError("XLSX contains missing or ambiguous sheets")
                cells = {}
                for cell in _xml(archive, relations[rid]).iter(M + "c"):
                    match = re.fullmatch(r"([A-Z]{1,3})([1-9][0-9]{0,6})", cell.get("r", ""))
                    if not match:
                        raise InputError("XLSX contains an unsupported cell address")
                    key = (int(match.group(2)), match.group(1))
                    if key in cells:
                        raise InputError("XLSX contains duplicate cell addresses")
                    if cell.find(M + "f") is not None:
                        raise InputError("Formula cells are unsupported; provide plain values")
                    kind = cell.get("t", "n")
                    value = cell.findtext(M + "v", "")
                    if kind == "inlineStr":
                        value = "".join(t.text or "" for t in cell.iter(M + "t"))
                    elif kind == "s":
                        try:
                            index = int(value)
                            if index < 0:
                                raise IndexError
                            value = shared[index]
                        except (ValueError, IndexError) as exc:
                            raise InputError("XLSX contains an invalid shared-string reference") from exc
                    elif kind == "e":
                        raise InputError("XLSX contains an error cell")
                    cells[key] = value
                sheets[name] = cells
            if not sheets:
                raise InputError("XLSX has no worksheets")
            return sheets
    except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
        raise InputError("Cannot read XLSX input") from exc


def read_template(materials: Path, kind: str, spec: dict) -> str:
    sheets = read_xlsx(materials / "侵权问题话术.xlsx")
    label = spec["template_label"]
    matches = [(cells, row, col) for cells in sheets.values()
               for (row, col), value in cells.items() if value.strip() == label]
    if len(matches) != 1:
        raise InputError(f"Complaint template label must occur exactly once: {label}")
    cells, row, col = matches[0]
    value = cells.get((row + 1, col), "").strip()
    if not value:
        raise InputError("Complaint description below its label is empty")
    if len(value.encode("utf-16-le")) // 2 > 500:
        raise InputError("Complaint description exceeds 500 UTF-16 code units")
    return value


def normalize_link(value: str) -> str:
    value = value.strip()
    if not value or re.search(r"[\s\x00-\x1f\x7f\\]", value):
        raise InputError("A supplied link is empty or contains forbidden characters")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise InputError("A supplied link is malformed") from exc
    if (parsed.scheme != "https" or host not in ("v.douyin.com", "www.douyin.com")
            or parsed.username is not None or parsed.password is not None or port is not None
            or parsed.netloc.lower() != host):
        raise InputError("Links must use HTTPS and an allowed Douyin host without credentials or port")
    path = parsed.path.rstrip("/")
    if host == "www.douyin.com":
        if path == "/jingxuan":
            try:
                modal_ids = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=1000).get("modal_id", [])
            except ValueError as exc:
                raise InputError("Douyin jingxuan query exceeds supported limits") from exc
            if len(modal_ids) != 1 or not re.fullmatch(r"[0-9]+", modal_ids[0]):
                raise InputError("Douyin jingxuan links require exactly one numeric modal_id")
            path = "/video/" + modal_ids[0]
        if not re.fullmatch(r"/video/[0-9]+", path):
            raise InputError("Full Douyin links need a /video/numeric-id path or /jingxuan with one numeric modal_id")
    else:
        # Reject encoded separators and dot paths. Short-link tokens are case-sensitive.
        if not re.fullmatch(r"/[A-Za-z0-9_-]+", path):
            raise InputError("Short Douyin links must contain one nonempty short-link token")
    return urlunsplit(("https", host, path, "", ""))


def read_links(path: Path, kind: str, workbook: bool, spec: dict) -> tuple[list[str], int]:
    if workbook:
        sheets = read_xlsx(path)
        label = spec["link_label"]
        matches = [(cells, col) for cells in sheets.values()
                   for (row, col), value in cells.items() if row == 1 and value.strip() == label]
        if len(matches) != 1:
            raise InputError(f"Selected complaint type must have exactly one matching row-1 link header: {label}")
        cells, col = matches[0]
        values = [value for (row, column), value in sorted(cells.items()) if row > 1 and column == col]
    else:
        try:
            if path.stat().st_size > 2 * 1024 * 1024:
                raise InputError("Link text file exceeds supported size")
            values = path.read_text(encoding="utf-8-sig").splitlines()
        except (OSError, UnicodeError) as exc:
            raise InputError("Cannot read UTF-8 link text file") from exc
    result = []
    seen = set()
    supplied_count = 0
    for value in values:
        if not value.strip():
            continue
        supplied_count += 1
        normalized = normalize_link(value)
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    if not result:
        raise InputError("The explicitly supplied link input contains no links for the selected type")
    if len(result) > MAX_LINKS:
        raise InputError("More than 1000 unique links supplied; this helper does not split batches")
    return result, supplied_count - len(result)


def image_record(path: Path) -> dict:
    try:
        if not path.is_file():
            raise InputError(f"A required material image is missing: {path.name}")
        size = path.stat().st_size
        if size == 0 or size > MAX_IMAGE_BYTES:
            raise InputError(f"A material image is empty or exceeds the 5 MB limit (5,000,000 bytes): {path.name}")
        data = path.read_bytes()
    except OSError as exc:
        raise InputError(f"Cannot read a required material image: {path.name}") from exc
    if path.suffix.lower() in (".jpg", ".jpeg") and data.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif path.suffix.lower() == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    else:
        raise InputError(f"A material image does not match its JPEG/PNG signature: {path.name}")
    return {"path": str(path.resolve()), "bytes": len(data), "media_type": mime,
            "sha256": hashlib.sha256(data).hexdigest()}


def prepare(materials: Path, kind: str, links_path: Path | None = None,
            links_workbook: bool = False) -> dict:
    if not materials.is_dir():
        raise InputError("Materials directory does not exist")
    spec = load_specs(materials)[kind]
    description = read_template(materials, kind, spec)
    evidence = [image_record(materials / name) for name in spec["evidence"]]
    identity = image_record(materials / spec["identity_reference"])
    license_image = image_record(materials / spec["license"])
    links, duplicates = read_links(links_path, kind, links_workbook, spec) if links_path else ([], 0)
    return {
        "schema_version": 1,
        "status": "prepared_not_submitted",
        "authorization": False,
        "kind": kind,
        "description": description,
        "description_utf16_units": len(description.encode("utf-16-le")) // 2,
        "evidence": evidence,
        "identity_reference": identity,
        "business_license": license_image,
        "links": links,
        "duplicates_removed": duplicates,
        "limits": {"links": MAX_LINKS, "image_bytes": MAX_IMAGE_BYTES,
                   "description_utf16_units": 500},
    }


def write_manifest(path: Path, manifest: dict) -> None:
    data = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise InputError("Output already exists; choose a new output path") from exc
    except OSError as exc:
        raise InputError("Cannot create the requested output file") from exc
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
    except OSError as exc:
        try:
            path.unlink()
        except OSError:
            pass
        raise InputError("Could not finish writing the private manifest") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--materials", type=Path, required=True)
    parser.add_argument("--kind", choices=tuple(DEFAULT_SPECS), required=True)
    sources = parser.add_mutually_exclusive_group()
    sources.add_argument("--links-file", type=Path)
    sources.add_argument("--links-workbook", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args(argv)
    source = args.links_file or args.links_workbook
    if args.check_only and args.out:
        parser.error("--check-only does not write output; omit --out")
    if not args.check_only and (source is None or args.out is None):
        parser.error("preparation requires an explicit link input and --out")
    try:
        manifest = prepare(args.materials.resolve(), args.kind, source, args.links_workbook is not None)
        if not args.check_only:
            write_manifest(args.out, manifest)
        images = manifest["evidence"] + [manifest["identity_reference"], manifest["business_license"]]
        print(json.dumps({
            "status": "checked_only" if args.check_only else manifest["status"],
            "authorization": False,
            "kind": args.kind,
            "links": len(manifest["links"]),
            "duplicates_removed": manifest["duplicates_removed"],
            "evidence_images": len(manifest["evidence"]),
            "total_image_bytes": sum(item["bytes"] for item in images),
            "description_utf16_units": manifest["description_utf16_units"],
        }, ensure_ascii=False))
        return 0
    except InputError as exc:
        print("Input error: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
