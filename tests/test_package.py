"""Root package contracts; optional real Hermes installer/discovery integration."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_root_is_a_unified_hermes_package():
    # Electron detectPluginComponents requires YAML AND __init__.py for agent;
    # findDesktopEntry accepts plugin.js or desktop/plugin.js, not deeper paths.
    assert (ROOT / 'plugin.yaml').is_file()
    manifest = yaml.safe_load((ROOT / 'plugin.yaml').read_text())
    assert manifest['name'] == 'purikura'
    spec = importlib.util.spec_from_file_location('purikura', ROOT / '__init__.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.register(object())  # API-only registration must have no side effects.
    assert (ROOT / 'desktop/plugin.js').is_file()
    dashboard = json.loads((ROOT / 'dashboard/manifest.json').read_text())
    assert dashboard == {'name': 'purikura', 'api': 'plugin_api.py'}
    assert (ROOT / 'dashboard' / dashboard['api']).is_file()


def test_real_hermes_git_install_and_discovery(tmp_path, monkeypatch):
    source = os.environ.get('HERMES_SOURCE')
    if not source:
        pytest.skip('Set HERMES_SOURCE to exercise the real Hermes installer')
    monkeypatch.syspath_prepend(source)
    home = tmp_path / 'home'
    home.mkdir()
    monkeypatch.setenv('HERMES_HOME', str(home))
    from hermes_cli import plugins_cmd as installer
    monkeypatch.setattr(installer, 'get_hermes_home', lambda: home)
    # Snapshot uncommitted sources into an offline Git remote, never the live install.
    repo = tmp_path / 'source'
    shutil.copytree(ROOT, repo, ignore=shutil.ignore_patterns(
        '.git', 'node_modules', '__pycache__', '.pytest_cache', '.venv'))
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()
    git('init', '-q')
    git('add', '.')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture')
    revision = git('rev-parse', 'HEAD')
    target, manifest, name = installer._install_plugin_core(repo.as_uri(), force=False)
    assert name == manifest['name'] == 'purikura'
    assert target == home / 'plugins/purikura'
    assert git('rev-parse', 'HEAD') == revision
    assert subprocess.check_output(['git', '-C', str(target), 'rev-parse', 'HEAD'], text=True).strip() == revision
    assert installer._looks_like_plugin_dir(target)
    metadata = installer._read_install_metadata()
    assert metadata['purikura']['revision'] == revision
    from hermes_cli import web_server_dashboard as dashboard
    monkeypatch.setattr(dashboard, '_dashboard_plugin_search_dirs', lambda: [(home / 'plugins', 'user')])
    discovered = dashboard._discover_dashboard_plugins()
    assert len(discovered) == 1
    assert discovered[0]['name'] == 'purikura'
    # Exercise the installed API, not the source checkout.
    spec = importlib.util.spec_from_file_location('installed_purikura_api', target / 'dashboard/plugin_api.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, '_hermes_home', lambda: home)
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(module.router, prefix='/api/plugins/purikura')
    with TestClient(app) as client:
        assert client.get('/api/plugins/purikura/state').json()['identities'] == [
            {'id': 'person:user', 'display_name': 'User', 'enabled': True}]
    assert not (home / 'desktop-plugins').exists()  # Python install is not a remote desktop installer.
