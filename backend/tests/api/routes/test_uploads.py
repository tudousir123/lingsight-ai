"""Upload HTTP contracts with generated, nonresearch media."""

import subprocess
import uuid
import hashlib
import asyncio
import struct
import shutil
from collections.abc import AsyncIterator

import httpx
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def media_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "media"
    root.mkdir()
    monkeypatch.setenv("PLATFORM_MEDIA_ROOT", str(root))
    return root


@pytest.fixture
def mp4(tmp_path: Path) -> bytes:
    path = tmp_path / "fixture.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=64x48:rate=5:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
    )
    return path.read_bytes()


def test_upload_survives_reload_and_media_range(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    media_root: Path,
    mp4: bytes,
) -> None:
    headers = normal_user_token_headers
    project = client.post(
        "/api/v1/projects/",
        headers=headers,
        json={"name": "upload-" + uuid.uuid4().hex},
    ).json()
    url = f"/api/v1/projects/{project['id']}/videos"
    response = client.post(
        url,
        headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
        files={"file": ("mouse.MP4", mp4, "video/mp4")},
    )
    assert response.status_code == 201, response.text
    video = response.json()
    assert (video["width"], video["height"], video["frame_count"], video["fps"]) == (
        64,
        48,
        5,
        5,
    )
    assert video["source_kind"] == "user_upload"
    assert client.get(url, headers=headers).json()["data"] == [video]
    assert client.get(video["media_url"], headers=headers).content == mp4
    part = client.get(video["media_url"], headers={**headers, "Range": "bytes=2-9"})
    assert part.status_code == 206
    assert part.content == mp4[2:10]
    assert part.headers["content-range"] == f"bytes 2-9/{len(mp4)}"
    assert part.headers["cache-control"] == "private, no-store"


def test_upload_reference_cannot_be_stolen_or_orphaned(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
    media_root: Path,
    mp4: bytes,
) -> None:
    headers = normal_user_token_headers

    def project(auth: dict[str, str]) -> str:
        return client.post(
            "/api/v1/projects/", headers=auth, json={"name": uuid.uuid4().hex}
        ).json()["id"]

    first, second, other = (
        project(headers),
        project(headers),
        project(superuser_token_headers),
    )
    response = client.post(
        f"/api/v1/projects/{first}/videos",
        headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
        files={"file": ("a.mp4", mp4, "video/mp4")},
    )
    assert response.status_code == 201, response.text
    video = response.json()
    member = {"kind": "video", "id": video["video_id"]}
    stolen = client.post(
        f"/api/v1/projects/{other}/members",
        headers=superuser_token_headers,
        json=member,
    )
    assert stolen.status_code == 404
    assert (
        client.get(
            video["media_url"],
            headers={**superuser_token_headers, "Range": "bytes=0-5"},
        ).status_code
        == 404
    )
    assert (
        client.delete(f"/api/v1/projects/{first}", headers=headers).status_code == 409
    )
    assert (
        client.delete(
            f"/api/v1/projects/{first}/members/video/{video['video_id']}",
            headers=headers,
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/v1/projects/{second}/members", headers=headers, json=member
        ).status_code
        == 201
    )
    assert (
        client.delete(f"/api/v1/projects/{first}", headers=headers).status_code == 200
    )
    assert (
        client.get(
            f"/api/v1/projects/{second}/videos/{video['video_id']}/media",
            headers=headers,
        ).content
        == mp4
    )


def test_avi_original_and_lossless_preview_preserve_all_frames(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    media_root: Path,
    tmp_path: Path,
) -> None:
    source = tmp_path / "input.avi"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=64x48:rate=5:duration=1",
            "-c:v",
            "rawvideo",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        check=True,
    )
    headers = normal_user_token_headers
    project = client.post(
        "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
    ).json()
    response = client.post(
        f"/api/v1/projects/{project['id']}/videos",
        headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
        files={"file": ("mouse.AVI", source.read_bytes(), "application/octet-stream")},
    )
    assert response.status_code == 201, response.text
    video = response.json()
    assert video["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert (
        client.get(video["media_url"], headers=headers).content == source.read_bytes()
    )
    preview = tmp_path / "preview.mp4"
    preview.write_bytes(client.get(video["preview_url"], headers=headers).content)

    def frames(path: Path) -> bytes:
        return subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-i",
                str(path),
                "-map",
                "0:v:0",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "yuv420p",
                "-",
            ],
            check=True,
            capture_output=True,
        ).stdout

    assert frames(source) == frames(preview)
    assert len(frames(preview)) == 64 * 48 * 3 // 2 * 5
    assert video["fps"] == 5


def test_upload_replay_conflict_and_rejection_leave_no_extra_files(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    media_root: Path,
    mp4: bytes,
) -> None:
    headers = {**normal_user_token_headers, "Idempotency-Key": str(uuid.uuid4())}
    project = client.post(
        "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
    ).json()
    url = f"/api/v1/projects/{project['id']}/videos"
    first = client.post(
        url, headers=headers, files={"file": ("a.mp4", mp4, "video/mp4")}
    )
    replay = client.post(
        url, headers=headers, files={"file": ("renamed.mp4", mp4, "video/mp4")}
    )
    assert first.status_code == 201
    assert replay.status_code == 200
    assert first.json() == replay.json()
    conflict = client.post(
        url, headers=headers, files={"file": ("a.mp4", mp4 + b"changed", "video/mp4")}
    )
    assert conflict.status_code == 409
    for filename, content, mime, status in [
        ("a.mp4", b"", "video/mp4", 422),
        ("../a.mp4", mp4, "video/mp4", 422),
        ("a.avi", mp4, "video/x-msvideo", 415),
        ("a.mp4", mp4, "text/plain", 415),
        ("a.mp4", mp4[:64], "video/mp4", 422),
    ]:
        result = client.post(
            url,
            headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
            files={"file": (filename, content, mime)},
        )
        assert result.status_code == status, result.text
    assert len(list((media_root / "objects").iterdir())) == 1
    assert list((media_root / "staging").iterdir()) == []
    assert client.get(url, headers=headers).json()["count"] == 1


@pytest.mark.parametrize("extra", [0, 1])
def test_real_two_gigabyte_stream_without_content_length(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    media_root: Path,
    mp4: bytes,
    extra: int,
) -> None:
    from app.main import app

    headers = normal_user_token_headers
    project = client.post(
        "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
    ).json()
    size = 2_000_000_000 + extra

    async def stream() -> AsyncIterator[bytes]:
        yield b'--testboundary\r\nContent-Disposition: form-data; name="file"; filename="large.mp4"\r\nContent-Type: video/mp4\r\n\r\n'
        yield mp4
        # A legal ISO BMFF free box pads a generated five-frame video, without
        # allocating a two-gigabyte fixture or changing its decoded contents.
        padding = size - len(mp4)
        yield struct.pack(">I4s", padding, b"free")
        remaining = padding - 8
        chunk = bytes(1024 * 1024)
        while remaining:
            count = min(remaining, len(chunk))
            yield chunk[:count]
            remaining -= count
        yield b"\r\n--testboundary--\r\n"

    async def send() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as http:
            return await http.post(
                f"/api/v1/projects/{project['id']}/videos",
                headers={
                    **headers,
                    "Idempotency-Key": str(uuid.uuid4()),
                    "Content-Type": "multipart/form-data; boundary=testboundary",
                },
                content=stream(),
            )

    try:
        response = asyncio.run(send())
        assert response.status_code == (201 if extra == 0 else 413), response.text
        if not extra:
            assert response.json()["bytes"] == 2_000_000_000
            assert response.json()["frame_count"] == 5
        else:
            assert response.json()["detail"]["code"] == "file_too_large"
            assert (
                client.get(
                    f"/api/v1/projects/{project['id']}/videos", headers=headers
                ).json()["count"]
                == 0
            )
        assert not list((media_root / "staging").iterdir())
    finally:
        # This test owns the isolated root; don't retain multi-GB pytest files.
        shutil.rmtree(media_root)
