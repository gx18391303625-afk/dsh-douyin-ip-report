"""Offline tests: original routing and evidence association; never submits."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'skills' / 'douyin-ip-report' / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import host
from original_job import prepare_original, validate_original_job, original_url, local_original_status
from prepare_job import InputError

TARGET = 'https://www.douyin.com/video/1000000000000000001'
SECOND = 'https://www.douyin.com/video/1000000000000000002'
ORIGINAL = 'https://v.douyin.com/UnitTestOriginal/'


class OriginalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='original-host-test-')
        self.root = Path(self.tmp.name)
        self.links = self.root / 'links.txt'
        self.links.write_text(TARGET + '\n' + TARGET + '\n', encoding='utf-8')
        self.home = self.root / 'douyin-report'
        self.home.mkdir()
        (self.home / 'config.json').write_text(json.dumps({'host': 'deepseek', 'node': '/test/node', 'node_path': '/test/modules'}), encoding='utf-8')

    def tearDown(self):
        self.tmp.cleanup()

    def cli(self, args):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['host.py', '--host', 'deepseek', *args]), patch.object(host, 'host_home', return_value=self.home), contextlib.redirect_stdout(output):
            result = host.main()
        return result, output.getvalue()

    def test_alias_and_normalize(self):
        self.assertEqual(host.complaint_kind('原创'), 'original')
        self.assertEqual(host.complaint_kind('商标'), 'trademark')
        self.assertEqual(host.complaint_kind('专利'), 'patent')
        self.assertEqual(original_url('https://v.douyin.com/UnitTestOriginal/?foo=bar'), ORIGINAL)

    def test_prepare_exact_evidence(self):
        job = prepare_original(self.links, original_link=ORIGINAL)
        self.assertEqual(job['links'], [TARGET])
        self.assertEqual(job['duplicates_removed'], 1)
        self.assertEqual(job['originals'], {TARGET: ORIGINAL})
        self.assertFalse(job['authorization'])
        self.assertEqual(validate_original_job(job), job)

    def test_missing_original_no_fallback(self):
        with self.assertRaises(InputError):
            prepare_original(self.links)
        with self.assertRaises(InputError):
            prepare_original(self.links, original_link=TARGET)
        with self.assertRaises(InputError):
            prepare_original(self.links, original_link='https://evil.example/video')

    def test_mapping_requires_exact_targets(self):
        mapping = self.root / 'originals.json'
        for data in ({SECOND: ORIGINAL}, {TARGET: ORIGINAL, SECOND: ORIGINAL}, {TARGET: 3}):
            mapping.write_text(json.dumps(data), encoding='utf-8')
            with self.assertRaises(InputError):
                prepare_original(self.links, originals_file=mapping)
        mapping.write_text(json.dumps({TARGET: ORIGINAL}), encoding='utf-8')
        self.assertEqual(prepare_original(self.links, originals_file=mapping)['originals'], {TARGET: ORIGINAL})

    def test_duplicate_json_mapping_rejected(self):
        mapping = self.root / 'originals.json'
        mapping.write_text('{"' + TARGET + '":"' + ORIGINAL + '","' + TARGET + '":"' + ORIGINAL + '"}', encoding='utf-8')
        with self.assertRaises(InputError):
            prepare_original(self.links, originals_file=mapping)

    def test_prepare_stable_no_browser(self):
        args = ['prepare', '--kind', '原创', '--links-file', str(self.links), '--original-link', ORIGINAL]
        with patch.object(host.subprocess, 'call') as call:
            self.assertEqual(self.cli(args), self.cli(args))
            call.assert_not_called()
        self.assertEqual(len(list((self.home / 'jobs').glob('*.json'))), 1)

    def test_run_original_uses_headless_runner_no_identity(self):
        with patch.object(host.subprocess, 'call', return_value=0) as call:
            result, _ = self.cli(['run', '--kind', '原创', '--links-file', str(self.links), '--original-link', ORIGINAL])
            self.assertEqual(result, 0)
            command = call.call_args.args[0]
            self.assertTrue(command[1].endswith('original-runner.mjs'))
            self.assertIn(str(self.home / 'original-browser-profile'), command)
            self.assertNotIn('--submit', command)
            self.assertNotIn('--headed', command)
            self.assertNotIn('--identity-json', command)

    def test_job_original_routes_without_kind(self):
        _, out = self.cli(['prepare', '--kind', 'original', '--links-file', str(self.links), '--original-link', ORIGINAL])
        job = json.loads(out)['job']
        with patch.object(host.subprocess, 'call', return_value=0) as call:
            self.cli(['run', '--job', job])
            self.assertTrue(call.call_args.args[0][1].endswith('original-runner.mjs'))
            self.assertNotIn('--submit', call.call_args.args[0])

    def test_original_check_and_status_skip_materials(self):
        _, out = self.cli(['check', '--kind', '原创'])
        self.assertFalse(json.loads(out)['identity_required'])
        with patch.object(host.subprocess, 'call') as call:
            _, out = self.cli(['status', '--kind', 'original'])
            call.assert_not_called()
        self.assertEqual(json.loads(out)['source'], 'local_only')
        self.assertFalse(json.loads(out)['platform_receipt_verified'])

    def test_mixed_kind_evidence_rejected(self):
        with self.assertRaises(SystemExit):
            self.cli(['prepare', '--kind', 'patent', '--links-file', str(self.links), '--original-link', ORIGINAL])

    def test_patent_trademark_routing_unchanged(self):
        for kind in ['patent', 'trademark']:
            with patch.object(host.subprocess, 'call', return_value=0) as call:
                self.cli(['login', '--kind', kind])
                command = call.call_args.args[0]
                self.assertTrue(command[1].endswith('/runner.mjs'))
                self.assertIn(str(self.home / 'browser-profile'), command)

    def test_status_tolerates_unrelated_malformed_state(self):
        jobs = self.home / 'jobs'
        jobs.mkdir()
        (jobs / 'broken.state.json').write_text('{', encoding='utf-8')
        (jobs / 'original.state.json').write_text(json.dumps({'kind': 'original', 'status': 'prepared'}), encoding='utf-8')
        result = local_original_status(self.home)
        self.assertEqual(len(result['tasks']), 1)
        self.assertEqual(result['unreadable_state_count'], 1)

    def test_original_login_explicit_separate(self):
        with patch.object(host.subprocess, 'call', return_value=0) as call:
            self.cli(['login', '--kind', '原创'])
            command = call.call_args.args[0]
            self.assertTrue(command[1].endswith('original-runner.mjs'))
            self.assertIn('--login', command)
            self.assertIn(str(self.home / 'original-browser-profile'), command)


if __name__ == '__main__':
    unittest.main()
