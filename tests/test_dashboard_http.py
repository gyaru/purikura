"""Actual Hermes discovery/auth/static routing, in an isolated subprocess."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from contextlib import contextmanager

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def dashboard_server(root):
    source = os.environ.get('HERMES_SOURCE')
    if not source:
        pytest.skip('Set HERMES_SOURCE to test the assembled dashboard')
    home = root / '.hermes'
    home.mkdir()
    shutil.copytree(ROOT, home / 'plugins/purikura', ignore=shutil.ignore_patterns(
        '.git', 'node_modules', '__pycache__', '.pytest_cache', 'artifacts'))
    (home / 'config.yaml').write_text('plugins:\n  enabled: [purikura]\n  disabled: []\n')
    env = {k: os.environ[k] for k in ('PATH', 'LANG') if k in os.environ}
    env.update(HOME=str(root), HERMES_HOME=str(home), TMPDIR=str(root),
               PYTHONPATH=source, HERMES_DASHBOARD_SESSION_TOKEN='isolated-test-token')
    with socket.socket() as sock, (root / 'server.log').open('w+') as log:
        sock.bind(('127.0.0.1', 0))
        sock.listen()
        base = f'http://127.0.0.1:{sock.getsockname()[1]}'
        proc = subprocess.Popen([os.environ.get('HERMES_PYTHON', sys.executable), '-m', 'uvicorn',
            'hermes_cli.web_server:app', '--fd', str(sock.fileno()), '--lifespan', 'off', '--no-access-log'],
            env=env, cwd=root, pass_fds=(sock.fileno(),), stdout=log, stderr=log)
        try:
            with httpx.Client(base_url=base, trust_env=False, timeout=2) as client:
                deadline = time.monotonic() + 45
                while True:
                    try:
                        client.get('/api/plugins/purikura/state')
                        break
                    except httpx.TransportError:
                        if proc.poll() is not None or time.monotonic() > deadline:
                            log.seek(0)
                            raise RuntimeError(log.read())
                        time.sleep(.1)
                yield client, home
        finally:
            proc.terminate()
            proc.wait(timeout=10)


def test_dashboard_page_has_a_real_script_and_shared_writes(tmp_path):
    with dashboard_server(tmp_path) as (client, home):
        assert client.get('/api/plugins/purikura/state').status_code == 401
        client.headers['X-Hermes-Session-Token'] = 'isolated-test-token'
        plugins = client.get('/api/dashboard/plugins').json()
        # Host versions wrap the manifest list in a plugins field.
        if isinstance(plugins, dict):
            plugins = plugins['plugins']
        manifest = next(p for p in plugins if p['name'] == 'purikura')
        script = client.get('/dashboard-plugins/purikura/' + manifest['entry'])
        assert script.status_code == 200, 'Navigation must never point at a missing script'
        assert '__HERMES_PLUGINS__' in script.text
        assert '@hermes/plugin-sdk' not in script.text
        assert client.get('/purikura?profile=default').status_code == 200
        for name in ('Alice', 'Bob'):
            response = client.put('/api/plugins/purikura/identities/person:alice', json={'display_name': name})
            assert response.status_code == 200
            assert any(p['display_name'] == name for p in client.get('/api/plugins/purikura/state').json()['identities'])
        assert (home / 'plugin-data/speaker-identity.sqlite3').is_file()
        other = home / 'profiles/work'
        other.mkdir(parents=True)
        (other / 'config.yaml').write_text('plugins:\n  enabled: [purikura]\n')
        scoped = client.get('/api/plugins/purikura/state?profile=work')
        assert scoped.status_code == 200
        assert scoped.json()['identities'] == [{'id':'person:user','display_name':'User','enabled':True}], 'Profile switch must not show the launch roster'
        assert client.put('/api/plugins/purikura/identities/person:work?profile=work',json={'display_name':'Alice'}).status_code == 200
        assert not any(p['id']=='person:work' for p in client.get('/api/plugins/purikura/state?profile=default').json()['identities'])
        assert client.get('/api/plugins/purikura/state?profile=missing').status_code == 404
        (other / 'config.yaml').write_text('plugins:\n  enabled: []\n  disabled: [purikura]\n')
        assert client.put('/api/plugins/purikura/identities/person:blocked?profile=work',json={'display_name':'Bob'}).status_code == 403


if __name__ == '__main__':
    import tempfile
    with tempfile.TemporaryDirectory(prefix='purikura-ui-') as tmp:
        with dashboard_server(Path(tmp)) as (client, home):
            print(str(client.base_url), flush=True)
            # Disposable visual-test server; stop with Ctrl-C or terminate this process.
            while True:
                time.sleep(1)
