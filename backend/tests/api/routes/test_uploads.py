"""Upload HTTP contracts with generated, nonresearch media."""

import asyncio
import fcntl
import hashlib
import os
import shutil
import struct
import subprocess
import threading
import uuid
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
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


@pytest.mark.usefixtures("media_root")
def test_upload_survives_reload_and_media_range(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
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


@pytest.mark.usefixtures("media_root")
def test_upload_reference_cannot_be_stolen_or_orphaned(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
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


@pytest.mark.usefixtures("media_root")
# Chromium's File.type for .avi is video/vnd.avi; the others are legacy aliases.
@pytest.mark.parametrize(
    "mime",
    [
        "video/vnd.avi",
        "video/x-msvideo",
        "video/avi",
        "video/msvideo",
        "application/octet-stream",
    ],
)
def test_avi_original_and_lossless_preview_preserve_all_frames(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    mime: str,
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
        files={"file": ("mouse.AVI", source.read_bytes(), mime)},
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
    # Accepting the browser MIME must not skip the actual container check.
    disguised = client.post(
        url,
        headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
        files={"file": ("a.avi", mp4, "video/vnd.avi")},
    )
    assert disguised.status_code == 415, disguised.text
    assert disguised.json()["detail"] == {
        "code": "unsupported_media_type",
        "message": "实际容器不是 AVI",
    }
    for filename, content, mime, status in [
        ("a.mp4", b"", "video/mp4", 422),
        ("../a.mp4", mp4, "video/mp4", 422),
        ("a.avi", mp4, "video/x-msvideo", 415),
        ("a.mp4", mp4, "text/plain", 415),
        ("a.avi", mp4, "text/plain", 415),
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


@pytest.mark.usefixtures("media_root")
def test_concurrent_removals_keep_one_valid_project_reference(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    mp4: bytes,
) -> None:
    headers = normal_user_token_headers
    projects = [
        client.post(
            "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
        ).json()["id"]
        for _ in range(2)
    ]
    uploaded = client.post(
        f"/api/v1/projects/{projects[0]}/videos",
        headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
        files={"file": ("a.mp4", mp4, "video/mp4")},
    ).json()
    assert (
        client.post(
            f"/api/v1/projects/{projects[1]}/members",
            headers=headers,
            json={"kind": "video", "id": uploaded["video_id"]},
        ).status_code
        == 201
    )

    def remove(project: str) -> int:
        return client.delete(
            f"/api/v1/projects/{project}/members/video/{uploaded['video_id']}",
            headers=headers,
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(remove, projects))
    assert sorted(statuses) == [204, 409]
    assert (
        sum(
            client.get(f"/api/v1/projects/{p}/videos", headers=headers).json()["count"]
            for p in projects
        )
        == 1
    )


def test_auth_before_body_and_disconnect_cleanup(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    media_root: Path,
) -> None:
    from starlette.requests import ClientDisconnect

    from app.main import app

    headers = normal_user_token_headers
    project = client.post(
        "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
    ).json()["id"]

    async def forbidden_body() -> AsyncIterator[bytes]:
        raise AssertionError("Unauthorized request body was consumed")
        yield b""  # pragma: no cover

    async def interrupted() -> AsyncIterator[bytes]:
        yield b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="a.mp4"\r\n\r\npartial'
        raise ClientDisconnect

    async def exercise() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as http:
            request_headers = {
                **headers,
                "Idempotency-Key": str(uuid.uuid4()),
                "Content-Type": "multipart/form-data; boundary=boundary",
            }
            denied = await http.post(
                f"/api/v1/projects/{uuid.uuid4()}/videos",
                headers=request_headers,
                content=forbidden_body(),
            )
            assert denied.status_code == 404
            failed = await http.post(
                f"/api/v1/projects/{project}/videos",
                headers=request_headers,
                content=interrupted(),
            )
            assert failed.status_code == 422

    asyncio.run(exercise())
    assert not list((media_root / "staging").iterdir())
    assert (
        client.get(f"/api/v1/projects/{project}/videos", headers=headers).json()[
            "count"
        ]
        == 0
    )


@pytest.mark.parametrize("failure", ["disk", "database"])
def test_storage_failures_do_not_publish_or_leave_files(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    media_root: Path,
    mp4: bytes,
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    from sqlalchemy import event
    from sqlalchemy.exc import OperationalError

    from app.core.db import engine

    headers = normal_user_token_headers
    project = client.post(
        "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
    ).json()["id"]
    original_open = Path.open

    def unavailable(path: Path, *args: object, **kwargs: object):
        if path.name == "incoming":
            raise OSError(28, "disk full")
        return original_open(path, *args, **kwargs)

    def fail_insert(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.startswith("INSERT INTO uploaded_video"):
            raise OperationalError(
                "synthetic storage failure", {}, Exception("unavailable")
            )

    if failure == "disk":
        monkeypatch.setattr(Path, "open", unavailable)
    else:
        event.listen(engine, "before_cursor_execute", fail_insert)
    try:
        response = client.post(
            f"/api/v1/projects/{project}/videos",
            headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
            files={"file": ("a.mp4", mp4, "video/mp4")},
        )
        assert response.status_code == 503, response.text
    finally:
        if failure == "database":
            event.remove(engine, "before_cursor_execute", fail_insert)
    assert (
        client.get(f"/api/v1/projects/{project}/videos", headers=headers).json()[
            "count"
        ]
        == 0
    )
    assert not list((media_root / "staging").iterdir())
    assert not list((media_root / "objects").iterdir())


def test_historical_unowned_upload_reference_is_hidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db,
) -> None:
    from app.crud import project_member_key
    from app.models import ProjectMember

    project = client.post(
        "/api/v1/projects/",
        headers=normal_user_token_headers,
        json={"name": uuid.uuid4().hex},
    ).json()["id"]
    db.add(
        ProjectMember(
            project_id=uuid.UUID(project),
            member_kind="video",
            member_id="upl_legacy-foreign",
            member_key=project_member_key("upl_legacy-foreign"),
            label="private-video-name",
        )
    )
    db.commit()
    listing = client.get("/api/v1/projects/", headers=normal_user_token_headers)
    stored = next(p for p in listing.json()["data"] if p["id"] == project)
    assert stored["members"] == []


def test_restart_recovers_abandoned_files_but_preserves_committed_and_active(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    media_root: Path,
    mp4: bytes,
) -> None:
    from app.main import app

    headers = normal_user_token_headers
    project = client.post(
        "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
    ).json()["id"]
    response = client.post(
        f"/api/v1/projects/{project}/videos",
        headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
        files={"file": ("a.mp4", mp4, "video/mp4")},
    )
    assert response.status_code == 201, response.text
    abandoned = media_root / "staging" / uuid.uuid4().hex
    abandoned.mkdir()
    (abandoned / "incoming").write_bytes(b"partial")
    orphan = media_root / "objects" / uuid.uuid4().hex
    orphan.mkdir()
    (orphan / "original.mp4").write_bytes(mp4)
    active = media_root / "staging" / uuid.uuid4().hex
    active.mkdir()
    with (active / ".lock").open("wb") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with TestClient(app) as restarted:
            assert (
                restarted.get(response.json()["media_url"], headers=headers).content
                == mp4
            )
        assert active.exists()
    assert not abandoned.exists()
    assert not orphan.exists()
    with TestClient(app):
        pass
    assert not active.exists()


def test_upload_recovery_observes_commit_after_request_auth_snapshot(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    media_root: Path,
    mp4: bytes,
) -> None:
    from sqlalchemy import event

    from app.core.db import engine
    from app.main import app

    headers = normal_user_token_headers
    first, second = [
        client.post(
            "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
        ).json()["id"]
        for _ in range(2)
    ]
    entered, resume = threading.Event(), threading.Event()

    def pause_after_project(
        _conn, _cursor, statement, parameters, _context, _executemany
    ):
        if (
            "FROM project" in statement
            and isinstance(parameters, dict)
            and second in [str(v) for v in parameters.values()]
            and not entered.is_set()
        ):
            entered.set()
            assert resume.wait(20), "concurrent upload did not complete"

    def delayed_upload() -> httpx.Response:
        with TestClient(app) as other:
            return other.post(
                f"/api/v1/projects/{second}/videos",
                headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
                files={"file": ("second.mp4", mp4, "video/mp4")},
            )

    event.listen(engine, "after_cursor_execute", pause_after_project)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            delayed = pool.submit(delayed_upload)
            assert entered.wait(20), "second upload did not reach auth snapshot"
            try:
                committed = client.post(
                    f"/api/v1/projects/{first}/videos",
                    headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
                    files={"file": ("first.mp4", mp4, "video/mp4")},
                )
                assert committed.status_code == 201, committed.text
            finally:
                resume.set()
            assert delayed.result(timeout=20).status_code == 201
        assert client.get(committed.json()["media_url"], headers=headers).content == mp4
        assert len(list((media_root / "objects").iterdir())) == 2
    finally:
        resume.set()
        event.remove(engine, "after_cursor_execute", pause_after_project)


@pytest.mark.usefixtures("media_root")
def test_media_query_token_invalid_ranges_and_same_name_isolation(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
    mp4: bytes,
) -> None:
    videos = []
    for headers in [normal_user_token_headers, superuser_token_headers]:
        project = client.post(
            "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
        ).json()["id"]
        response = client.post(
            f"/api/v1/projects/{project}/videos",
            headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
            files={"file": ("same.mp4", mp4, "video/mp4")},
        )
        assert response.status_code == 201
        videos.append(response.json())
    assert videos[0]["video_id"] != videos[1]["video_id"]
    assert videos[0]["source_id"] != videos[1]["source_id"]
    token = normal_user_token_headers["Authorization"].split()[1]
    assert (
        client.get(
            videos[0]["media_url"] + "?token=" + token, headers={"Range": "bytes=-8"}
        ).content
        == mp4[-8:]
    )
    assert (
        client.get(
            videos[1]["media_url"] + "?token=" + token, headers={"Range": "bytes=0-1"}
        ).status_code
        == 404
    )
    for value in ["bytes=99999999-", "bytes=broken", "cats=0-1"]:
        response = client.get(
            videos[0]["media_url"],
            headers={**normal_user_token_headers, "Range": value},
        )
        assert response.status_code == 416, response.text
        assert response.headers["cache-control"] == "private, no-store"


def test_multipart_extra_fields_and_untrusted_storage_configuration(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    media_root: Path,
    mp4: bytes,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    headers = {**normal_user_token_headers, "Idempotency-Key": str(uuid.uuid4())}
    project = client.post(
        "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
    ).json()["id"]
    url = f"/api/v1/projects/{project}/videos"
    extra = client.post(
        url,
        headers=headers,
        files=[
            ("file", ("a.mp4", mp4, "video/mp4")),
            ("file", ("b.mp4", mp4, "video/mp4")),
        ],
    )
    assert extra.status_code == 422
    override = client.post(
        url,
        headers=headers,
        files={"file": ("a.mp4", mp4, "video/mp4")},
        data={"owner": str(uuid.uuid4())},
    )
    assert override.status_code == 422
    linked = tmp_path / "link"
    linked.symlink_to(media_root, target_is_directory=True)
    code = tmp_path / "code"
    code.mkdir()
    (code / ".git").write_text("gitdir: /not-a-real-repository")
    for root in [linked, code, Path("/mnt/ugnas_forbidden/media")]:
        monkeypatch.setenv("PLATFORM_MEDIA_ROOT", str(root))
        rejected = client.post(
            url, headers=headers, files={"file": ("a.mp4", mp4, "video/mp4")}
        )
        assert rejected.status_code == 503
        assert str(root) not in rejected.text


def test_nonempty_unmarked_directory_is_never_adopted_or_cleaned(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    mp4: bytes,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    unrelated = tmp_path / "unrelated"
    important = unrelated / "objects" / uuid.uuid4().hex
    important.mkdir(parents=True)
    artifact = important / "important.txt"
    artifact.write_text("unrelated existing data")
    monkeypatch.setenv("PLATFORM_MEDIA_ROOT", str(unrelated))
    headers = normal_user_token_headers
    project = client.post(
        "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
    ).json()["id"]
    response = client.post(
        f"/api/v1/projects/{project}/videos",
        headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
        files={"file": ("a.mp4", mp4, "video/mp4")},
    )
    assert response.status_code == 503
    assert artifact.read_text() == "unrelated existing data"
    assert not (unrelated / ".lingsight-media-root").exists()


@pytest.mark.usefixtures("media_root")
def test_concurrent_same_idempotency_key_creates_one_upload(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    mp4: bytes,
) -> None:
    from sqlalchemy import event

    from app.core.db import engine
    from app.main import app

    headers = {**normal_user_token_headers, "Idempotency-Key": str(uuid.uuid4())}
    project = client.post(
        "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
    ).json()["id"]
    url = f"/api/v1/projects/{project}/videos"
    entered, resume = threading.Event(), threading.Event()

    def pause(_conn, _cursor, statement, parameters, _context, _executemany):
        if (
            "FROM project" in statement
            and isinstance(parameters, dict)
            and project in [str(v) for v in parameters.values()]
            and not entered.is_set()
        ):
            entered.set()
            assert resume.wait(20)

    def delayed() -> httpx.Response:
        with TestClient(app) as other:
            return other.post(
                url, headers=headers, files={"file": ("same.mp4", mp4, "video/mp4")}
            )

    event.listen(engine, "after_cursor_execute", pause)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(delayed)
            assert entered.wait(20)
            try:
                first = client.post(
                    url, headers=headers, files={"file": ("same.mp4", mp4, "video/mp4")}
                )
                assert first.status_code == 201, first.text
            finally:
                resume.set()
            replay = pending.result(timeout=20)
        assert replay.status_code == 200, replay.text
        assert first.json() == replay.json()
        assert client.get(url, headers=headers).json()["count"] == 1
    finally:
        resume.set()
        event.remove(engine, "after_cursor_execute", pause)


@pytest.mark.parametrize("stage", ["evidence", "inference.mp4", "preview.mp4"])
def test_ffmpeg_disk_exhaustion_is_retryable_and_cleans_partial_upload(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    media_root: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    stage: str,
) -> None:
    extension = "avi" if stage == "inference.mp4" else "mp4"
    source = tmp_path / f"clip.{extension}"
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
            "mpeg4",
            str(source),
        ],
        check=True,
    )
    real_ffmpeg = shutil.which("ffmpeg")
    assert real_ffmpeg
    shim = tmp_path / "bin"
    shim.mkdir()
    executable = shim / "ffmpeg"
    executable.write_text(
        "#!/usr/bin/python3\n"
        "import os, sys\n"
        f"target = {stage!r}\n"
        "output = sys.argv[-1]\n"
        "if (target == 'evidence' and output == '-') or output.endswith(target):\n"
        "    if output == '-':\n"
        "        os.write(1, b'partial evidence')\n"
        "    else:\n"
        "        with open(output, 'wb') as partial: partial.write(b'partial video')\n"
        "    os.write(2, b'No space left on device: /private/storage/secret.mp4\\n')\n"
        "    for _ in range(32): os.write(2, b'x' * 4096)\n"
        "    sys.exit(1)\n"
        f"os.execv({real_ffmpeg!r}, [{real_ffmpeg!r}, *sys.argv[1:]])\n"
    )
    executable.chmod(0o700)
    monkeypatch.setenv("PATH", str(shim) + os.pathsep + os.environ["PATH"])
    headers = normal_user_token_headers
    project = client.post(
        "/api/v1/projects/", headers=headers, json={"name": uuid.uuid4().hex}
    ).json()["id"]
    url = f"/api/v1/projects/{project}/videos"
    key = str(uuid.uuid4())
    response = client.post(
        url,
        headers={**headers, "Idempotency-Key": key},
        files={"file": (source.name, source.read_bytes(), "application/octet-stream")},
    )
    assert response.status_code == 503, response.text
    assert response.json()["detail"]["code"] == "service_unavailable"
    assert "/private/" not in response.text
    assert str(media_root) not in response.text
    assert client.get(url, headers=headers).json()["count"] == 0
    assert not list((media_root / "staging").iterdir())
    assert not list((media_root / "objects").iterdir())
    executable.unlink()
    retry = client.post(
        url,
        headers={**headers, "Idempotency-Key": key},
        files={"file": (source.name, source.read_bytes(), "application/octet-stream")},
    )
    assert retry.status_code == 201, retry.text
    assert client.get(url, headers=headers).json()["count"] == 1
