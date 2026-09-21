import importlib.util
from pathlib import Path


MODULE = Path(__file__).parents[1] / "backend/speaker_identity/dashboard/plugin_api.py"


def load_api(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location("purikura_plugin_api", MODULE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_default_roster_and_device_assignment(monkeypatch, tmp_path):
    api = load_api(monkeypatch, tmp_path)

    initial = api.state("device:nixos")
    assert [person["id"] for person in initial["identities"]] == [
        "person:user",
    ]
    assert initial["default_identity_id"] is None

    result = api.set_device_default(
        "device:nixos", {"default_identity_id": "person:user"}
    )
    assert result == {
        "device_id": "device:nixos",
        "default_identity_id": "person:user",
    }
    assert api.state("device:nixos")["default_identity_id"] == "person:user"


def test_identity_changes_are_shared(monkeypatch, tmp_path):
    api = load_api(monkeypatch, tmp_path)

    result = api.upsert_identity(
        "person:tsum", {"display_name": "Tsum"}
    )
    assert result["display_name"] == "Tsum"
    assert any(
        person["id"] == "person:tsum"
        for person in api.state()["identities"]
    )
