"""
Tests für encoder_profile.py — reine Logik, kein echtes ffmpeg/keine echte
Plattform nötig (subprocess.check_output und platform.system werden
gemockt).
"""
from __future__ import annotations

import subprocess

import pytest

import encoder_profile as ep


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    """_available_encoders ist modulweit gecacht — pro Test zurücksetzen,
    sonst beeinflussen sich die Tests gegenseitig über den Cache."""
    monkeypatch.setattr(ep, "_available_encoders", None)
    monkeypatch.delenv("LUMIO_HW_ENCODER", raising=False)


def _mock_encoders_output(monkeypatch, output: str) -> None:
    monkeypatch.setattr(subprocess, "check_output", lambda *a, **k: output)


# ---------------------------------------------------------------------------
# videotoolbox — Erkennung + Plattform-Gate
# ---------------------------------------------------------------------------
def test_videotoolbox_selected_on_macos_when_in_auto_chain(monkeypatch):
    _mock_encoders_output(monkeypatch, "V..... h264_videotoolbox\nV..... libx264")
    monkeypatch.setattr(ep.platform, "system", lambda: "Darwin")
    monkeypatch.setenv("LUMIO_HW_ENCODER", "auto")
    assert ep.select_encoder() == "videotoolbox"


def test_videotoolbox_not_selected_on_linux_even_if_ffmpeg_lists_it(monkeypatch):
    # Ein Linux-Build sollte h264_videotoolbox nie listen, aber falls doch
    # (z.B. ein falsch getaggtes Cross-Build-Artefakt): der Plattform-Check
    # muss trotzdem greifen und auf software zurückfallen.
    _mock_encoders_output(monkeypatch, "V..... h264_videotoolbox\nV..... libx264")
    monkeypatch.setattr(ep.platform, "system", lambda: "Linux")
    monkeypatch.setenv("LUMIO_HW_ENCODER", "auto")
    assert ep.select_encoder() == "software"


def test_videotoolbox_explicit_request_falls_back_without_codec(monkeypatch):
    _mock_encoders_output(monkeypatch, "V..... libx264")  # kein videotoolbox im Build
    monkeypatch.setattr(ep.platform, "system", lambda: "Darwin")
    monkeypatch.setenv("LUMIO_HW_ENCODER", "videotoolbox")
    assert ep.select_encoder() == "software"


def test_videotoolbox_explicit_request_succeeds_when_available(monkeypatch):
    _mock_encoders_output(monkeypatch, "V..... h264_videotoolbox\nV..... libx264")
    monkeypatch.setattr(ep.platform, "system", lambda: "Darwin")
    monkeypatch.setenv("LUMIO_HW_ENCODER", "videotoolbox")
    assert ep.select_encoder() == "videotoolbox"


def test_auto_prefers_vaapi_over_videotoolbox_when_both_look_available(monkeypatch):
    # Realistisch kommt das nie gleichzeitig vor (VAAPI-Device existiert nur
    # auf Linux), aber die Reihenfolge in der Doku (NVENC->QSV->VAAPI->
    # VideoToolbox) soll trotzdem stimmen, falls beide Checks je grün wären.
    _mock_encoders_output(
        monkeypatch, "V..... h264_vaapi\nV..... h264_videotoolbox\nV..... libx264"
    )
    monkeypatch.setattr(ep, "_render_device_present", lambda: True)
    monkeypatch.setattr(ep, "_videotoolbox_present", lambda: True)
    monkeypatch.setenv("LUMIO_HW_ENCODER", "auto")
    assert ep.select_encoder() == "vaapi"


# ---------------------------------------------------------------------------
# profile_for — ffmpeg-Argumente für videotoolbox
# ---------------------------------------------------------------------------
def test_profile_for_videotoolbox(monkeypatch):
    _mock_encoders_output(monkeypatch, "V..... h264_videotoolbox\nV..... libx264")
    monkeypatch.setattr(ep.platform, "system", lambda: "Darwin")
    monkeypatch.setenv("LUMIO_HW_ENCODER", "videotoolbox")

    profile = ep.profile_for(1080)

    assert profile.name == "videotoolbox"
    assert profile.codec == "h264_videotoolbox"
    # Kein hwupload/format-Filter-Bedarf wie bei VAAPI: keine extra Input-Args.
    assert profile.extra_input_args == []
    assert profile.extra_video_args == []


def test_profile_for_falls_back_to_software_without_videotoolbox(monkeypatch):
    _mock_encoders_output(monkeypatch, "V..... libx264")
    monkeypatch.setattr(ep.platform, "system", lambda: "Darwin")
    monkeypatch.setenv("LUMIO_HW_ENCODER", "videotoolbox")

    profile = ep.profile_for(1080)

    assert profile.name == "software"
    assert profile.codec == "libx264"
