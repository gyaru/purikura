import importlib.util
import sqlite3
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

MODULE = Path(__file__).parents[1] / 'dashboard/plugin_api.py'

@pytest.fixture
def api(monkeypatch, tmp_path):
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    spec = importlib.util.spec_from_file_location('purikura_plugin_api', MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app = FastAPI()
    app.include_router(module.router, prefix='/api/plugins/purikura')
    with TestClient(app) as client:
        yield module, client

def test_fresh_database_bootstraps_once(api):
    module, client = api
    url = '/api/plugins/purikura/state'
    assert client.get(url).json()['identities'] == [
        {'id': 'person:user', 'display_name': 'User', 'enabled': True}]
    with sqlite3.connect(module._db_path()) as conn:
        conn.execute('DELETE FROM identities')
    assert client.get(url).json()['identities'] == []

@pytest.mark.parametrize('name', ['A\nB', '[Speaker: Alice]', 'A\x00B', '', ' ' * 3, 'x' * 81])
def test_invalid_display_names_rejected_over_http(api, name):
    _, client = api
    assert client.put('/api/plugins/purikura/identities/person:alice', json={'display_name':name}).status_code == 400

def test_http_shared_roster_and_independent_device_defaults(api):
    module, client = api
    root='/api/plugins/purikura'
    assert client.put(root+'/identities/person:alice', json={'display_name':'Alice'}).status_code == 200
    assert client.put(root+'/identities/person:bob', json={'display_name':'Bob'}).status_code == 200
    for device, person in [('device:a','person:alice'),('device:b','person:bob')]:
        assert client.put(root+'/devices/'+device, json={'default_identity_id':person}).status_code == 200
    assert client.put(root+'/identities/person:alice', json={'display_name':'Alice Updated'}).json()['id']=='person:alice'
    a=client.get(root+'/state?device_id=device:a').json()
    b=client.get(root+'/state?device_id=device:b').json()
    assert a['identities']==b['identities']
    assert a['default_identity_id']=='person:alice'
    assert b['default_identity_id']=='person:bob'
    assert client.put(root+'/devices/device:a',json={'default_identity_id':'person:missing'}).status_code==404
    assert client.put(root+'/identities/INVALID',json={'display_name':'Alice'}).status_code==400
    assert client.put(root+'/identities/person:alice',json=[]).status_code==422
    with sqlite3.connect(module._db_path()) as conn:
        conn.execute("UPDATE identities SET enabled=0 WHERE id='person:alice'")
    assert client.get(root+'/state?device_id=device:a').json()['default_identity_id'] is None


def test_existing_legacy_database_is_preserved(monkeypatch,tmp_path):
    monkeypatch.setenv('HERMES_HOME',str(tmp_path))
    path=tmp_path/'plugin-data'/'speaker-identity.sqlite3'
    path.parent.mkdir()
    with sqlite3.connect(path) as conn:
        conn.executescript('CREATE TABLE identities (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE devices (id TEXT PRIMARY KEY, default_identity_id TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);')
        conn.execute("INSERT INTO identities (id,display_name) VALUES ('person:alice','Alice')")
        conn.execute("INSERT INTO devices (id,default_identity_id) VALUES ('device:a','person:alice')")
    spec=importlib.util.spec_from_file_location('legacy_api',MODULE)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    result=module.state('device:a')
    assert result['identities']==[{'id':'person:alice','display_name':'Alice','enabled':True}]
    assert result['default_identity_id']=='person:alice'
    assert module._db_path()==path


def test_context_local_hermes_home_takes_precedence(api,monkeypatch,tmp_path):
    import sys
    from types import SimpleNamespace
    module,_=api
    profile=tmp_path/'profile-scoped'
    monkeypatch.setitem(sys.modules,'hermes_constants',SimpleNamespace(get_hermes_home=lambda:profile))
    assert module._db_path()==profile/'plugin-data'/'speaker-identity.sqlite3'


def test_backend_namespace_matches_desktop_slug():
    manifest=json.loads((MODULE.parent/'manifest.json').read_text())
    assert manifest['name']=='purikura'
    assert manifest['api']==MODULE.name
