"""Local-only preparation of explicit target -> original video associations."""
import json
from pathlib import Path
from prepare_job import InputError, normalize_link, read_links

KIND_ALIASES = {'原创': 'original', 'original': 'original',
                '专利': 'patent', 'patent': 'patent',
                '商标': 'trademark', 'trademark': 'trademark'}


def complaint_kind(value):
    try:
        return KIND_ALIASES[value]
    except KeyError as exc:
        raise ValueError('kind must be patent/专利, trademark/商标 or original/原创') from exc


def original_url(value):
    if not isinstance(value, str):
        raise InputError('Original links must be URL strings')
    url = normalize_link(value)
    return url + '/' if url.startswith('https://v.douyin.com/') else url


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InputError('Duplicate target keys in original mapping')
        result[key] = value
    return result


def prepare_original(links_path, workbook=False, original_link=None, originals_file=None):
    if bool(original_link) == bool(originals_file):
        raise InputError('原创 requires exactly one explicit --original-link or --originals-file; never reuse an old evidence link implicitly')
    links, duplicates = read_links(links_path, 'original', workbook, {'link_label': '原创举报链接'})
    links = [original_url(link) for link in links]
    if original_link:
        original = original_url(original_link)
        originals = {target: original for target in links}
    else:
        try:
            path = Path(originals_file)
            if path.stat().st_size > 2 * 1024 * 1024:
                raise InputError('Original mapping exceeds 2 MB')
            data = json.loads(path.read_text(encoding='utf-8-sig'), object_pairs_hook=unique_object)
        except (OSError, UnicodeError, ValueError) as exc:
            raise InputError('Cannot read original mapping JSON') from exc
        if not isinstance(data, dict) or not data:
            raise InputError('Original mapping must be a nonempty JSON object: target URL -> original URL')
        originals = {}
        for target, original in data.items():
            target = original_url(target)
            if target in originals:
                raise InputError('Duplicate normalized targets in original mapping')
            originals[target] = original_url(original)
        if set(originals) != set(links):
            raise InputError('Original mapping must match all and only the explicitly supplied target links')
    if any(target == original for target, original in originals.items()):
        raise InputError('A target cannot be its own original evidence')
    return {'schema_version': 1, 'status': 'prepared_not_submitted',
            'authorization': False, 'kind': 'original', 'links': links,
            'originals': originals, 'duplicates_removed': duplicates}


def validate_original_job(job):
    if not isinstance(job, dict) or job.get('schema_version') != 1 or job.get('kind') != 'original':
        raise InputError('Invalid original manifest kind/schema')
    links, originals = job.get('links'), job.get('originals')
    if not isinstance(links, list) or not 1 <= len(links) <= 1000 or not isinstance(originals, dict):
        raise InputError('Original job requires explicit target list and evidence mapping')
    normalized = [original_url(link) for link in links]
    if normalized != links or len(set(links)) != len(links) or set(originals) != set(links):
        raise InputError('Original job targets and mappings must be normalized, unique and exact')
    for target, original in originals.items():
        if original_url(original) != original or target == original:
            raise InputError('Original job evidence must be normalized and distinct from the target')
    return job


def local_original_status(home, job_path=None):
    states = []
    unreadable = []
    wanted = None
    if job_path:
        import hashlib
        job = json.loads(Path(job_path).read_text(encoding='utf-8-sig'))
        if job.get('kind') != 'original':
            raise InputError('Original status requires an original job')
        wanted = hashlib.sha256(json.dumps(job, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24] + '.state.json'
    for path in sorted((home / 'jobs').glob('*.state.json')):
        if wanted and path.name != wanted:
            continue
        try:
            data = json.loads(path.read_text(encoding='utf-8-sig'))
            if not isinstance(data, dict):
                raise ValueError('State must be a JSON object')
        except (OSError, ValueError):
            unreadable.append(path.name)
            continue
        if data.get('kind') == 'original':
            states.append({'state_file': str(path), **data})
    return {'kind': 'original', 'source': 'local_only', 'platform_receipt_verified': False,
            'checked_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
            'tasks': states, 'unreadable_state_count': len(unreadable),
            'unreadable_state_files': unreadable[:20],
            'matching_state_found': bool(states) if wanted else None,
            'notice': '原创记录不是专利/商标 qinquan 回执；平台结果请以抖音举报通知为准。'}
