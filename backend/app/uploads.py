"""Owned upload authorization and bounded, verified media storage."""

import fcntl
import hashlib
import json
import logging
import math
import os
import re
import shutil
import subprocess
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass
from datetime import UTC
from fractions import Fraction
from pathlib import Path
from threading import Thread
from typing import Any, BinaryIO

from fastapi import FastAPI, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select
from starlette.concurrency import run_in_threadpool

from app.api.deps import owned_project
from app.contracts import ErrorCode
from app.inference_access import encode_video
from app.inference_client import (
    InferenceArtifactTooLarge,
    InferenceClient,
    InferenceNotFound,
    InferenceUnconfigured,
    InferenceUnreachable,
    InferenceUpstreamError,
)
from app.media_settings import MediaSettings
from app.models import Project, ProjectMember, User
from app.upload_models import UploadedVideo


def problem(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message})


def owned_references(
    session: Session, user: User, video_id: str
) -> list[ProjectMember]:
    return list(
        session.exec(
            select(ProjectMember)
            .join(Project)
            .where(
                Project.user_id == user.id,
                ProjectMember.member_kind == "video",
                ProjectMember.member_id == video_id,
            )
            .with_for_update()
        ).all()
    )


def get_owned_upload(session: Session, user: User, video_id: str) -> UploadedVideo:
    video = session.get(UploadedVideo, video_id)
    if (
        video is None
        or video.owner_user_id != user.id
        or not owned_references(session, user, video_id)
    ):
        raise problem(404, ErrorCode.RESOURCE_NOT_FOUND, "视频不存在")
    return video


def owned_video(
    session: Session, user: User, project_id: uuid.UUID, video_id: str
) -> UploadedVideo:
    owned_project(session, user, project_id)
    video = get_owned_upload(session, user, video_id)
    if not any(
        m.project_id == project_id for m in owned_references(session, user, video_id)
    ):
        raise problem(404, ErrorCode.RESOURCE_NOT_FOUND, "视频不存在")
    return video


def lock_owner(session: Session, user: User) -> None:
    """Serialize membership changes across all of an owner's projects."""
    session.exec(select(User).where(User.id == user.id).with_for_update()).one()


def protect_last_references(
    session: Session, user: User, project: Project, video_id: str | None = None
) -> None:
    lock_owner(session, user)
    videos = session.exec(
        select(UploadedVideo).where(UploadedVideo.owner_user_id == user.id)
    ).all()
    for video in videos:
        if video_id is not None and video.video_id != video_id:
            continue
        refs = owned_references(session, user, video.video_id)
        if any(r.project_id == project.id for r in refs) and not any(
            r.project_id != project.id for r in refs
        ):
            raise problem(
                409, ErrorCode.LAST_PROJECT_REFERENCE, "请先将视频归组到另一个项目"
            )


def media_root() -> Path:
    configured = MediaSettings().PLATFORM_MEDIA_ROOT
    if not configured:
        raise problem(503, ErrorCode.SERVICE_UNAVAILABLE, "平台媒体存储尚未配置")
    root = Path(configured)
    repo = Path(__file__).resolve().parents[2]
    if (
        not root.is_absolute()
        or root == Path("/")
        or any(p.is_symlink() for p in (root, *root.parents))
    ):
        raise problem(503, ErrorCode.SERVICE_UNAVAILABLE, "平台媒体存储配置无效")
    root = root.resolve()
    if (
        root.is_relative_to(repo)
        or any((parent / ".git").exists() for parent in (root, *root.parents))
        or any(part.startswith("ugnas_") for part in root.parts)
        or any(
            part in {"tasks", "inference", "lingsight-inference", ".git"}
            for part in root.parts
        )
    ):
        raise problem(503, ErrorCode.SERVICE_UNAVAILABLE, "请配置专用平台媒体目录")
    if not root.is_dir():
        raise problem(503, ErrorCode.SERVICE_UNAVAILABLE, "平台媒体存储不可用")
    marker = root / ".lingsight-media-root"
    try:
        if not marker.exists() and any(root.iterdir()):
            raise problem(
                503, ErrorCode.SERVICE_UNAVAILABLE, "平台媒体目录必须为空的专用目录"
            )
        fd = os.open(marker, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "r+b") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            identity = handle.read(128)
            if not identity:
                if any(child != marker for child in root.iterdir()):
                    raise problem(
                        503,
                        ErrorCode.SERVICE_UNAVAILABLE,
                        "平台媒体目录必须为空的专用目录",
                    )
                handle.write(b"lingsight-platform-media-v1\n")
                handle.flush()
                os.fsync(handle.fileno())
            elif identity != b"lingsight-platform-media-v1\n":
                raise problem(
                    503, ErrorCode.SERVICE_UNAVAILABLE, "平台媒体目录标识无效"
                )
    except OSError:
        raise problem(
            503, ErrorCode.SERVICE_UNAVAILABLE, "平台媒体存储不可用"
        ) from None
    return root


def media_path(key: str) -> Path:
    root = media_root()
    path = root / key
    if (
        Path(key).is_absolute()
        or ".." in Path(key).parts
        or any(p.is_symlink() for p in (path, *path.parents))
        or not path.is_file()
        or not path.resolve().is_relative_to(root)
    ):
        raise problem(503, ErrorCode.SERVICE_UNAVAILABLE, "平台媒体文件不可用")
    return path


@contextmanager
def storage_lock(root: Path) -> Iterator[None]:
    fd = os.open(root / ".storage.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def cleanup_abandoned(session: Session, root: Path) -> None:
    """Called under the shared storage lock; active uploads hold per-dir locks."""
    # Authentication may have opened a repeatable-read snapshot before another
    # worker committed. Recovery needs a fresh snapshot under publication lock.
    with Session(session.get_bind()) as snapshot:
        known = {
            v.storage_key.split("/")[1]
            for v in snapshot.exec(select(UploadedVideo)).all()
        }
    for bucket in ("staging", "objects"):
        directory = root / bucket
        if directory.is_symlink():
            raise problem(503, ErrorCode.SERVICE_UNAVAILABLE, "平台媒体存储配置无效")
        directory.mkdir(mode=0o700, exist_ok=True)
        for item in directory.iterdir():
            if (
                item.is_symlink()
                or not item.is_dir()
                or re.fullmatch(r"[0-9a-f]{32}", item.name) is None
                or (bucket == "objects" and item.name in known)
            ):
                continue
            lock_path = item / ".lock"
            fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    continue
                shutil.rmtree(item)


def recover_media_storage() -> None:
    """Restart recovery; failures stay fail-closed at each media operation."""
    if not MediaSettings().PLATFORM_MEDIA_ROOT:
        return
    from app.core.db import engine

    try:
        root = media_root()
        with Session(engine) as session, storage_lock(root):
            cleanup_abandoned(session, root)
    except HTTPException, OSError, SQLAlchemyError:
        # Never log credentials, research filenames or configured host paths.
        logging.getLogger(__name__).warning("Platform media recovery unavailable")


@asynccontextmanager
async def media_lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await run_in_threadpool(recover_media_storage)
    yield


def file_hash(path: Path) -> str:
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


@dataclass
class MediaDiagnostics:
    # Keep bounded evidence internally; raw tool output includes private paths
    # and must never be returned to the browser or written to application logs.
    tail: bytes = b""
    storage_failure: bool = False

    def read(self, reader: BinaryIO) -> None:
        while chunk := reader.read(4096):
            evidence = (self.tail + chunk).lower()
            self.storage_failure |= any(
                marker in evidence
                for marker in (
                    b"no space left on device",
                    b"disk quota exceeded",
                    b"read-only file system",
                    b"input/output error",
                )
            )
            self.tail = (self.tail + chunk)[-8192:]


@contextmanager
def media_diagnostics() -> Iterator[tuple[BinaryIO, MediaDiagnostics]]:
    read_fd, write_fd = os.pipe()
    diagnostics = MediaDiagnostics()
    with os.fdopen(read_fd, "rb") as reader, os.fdopen(write_fd, "wb") as writer:
        worker = Thread(target=diagnostics.read, args=(reader,), daemon=True)
        worker.start()
        try:
            yield writer, diagnostics
        finally:
            writer.close()
            worker.join()


def run_media(args: list[str], output: BinaryIO | int = subprocess.PIPE) -> bytes:
    try:
        with media_diagnostics() as (stderr, diagnostics):
            result = subprocess.run(
                args,
                stdout=output,
                stderr=stderr,
                timeout=MediaSettings().PLATFORM_MEDIA_TOOL_TIMEOUT,
                check=False,
            )
    except FileNotFoundError:
        raise problem(
            503, ErrorCode.SERVICE_UNAVAILABLE, "媒体校验工具尚未安装"
        ) from None
    except subprocess.TimeoutExpired:
        raise problem(422, ErrorCode.INVALID_VIDEO, "视频校验超时") from None
    if result.returncode:
        logging.getLogger(__name__).warning(
            "Media tool failed: exit=%s category=%s",
            result.returncode,
            "storage" if diagnostics.storage_failure else "invalid_media",
        )
        if diagnostics.storage_failure:
            raise problem(503, ErrorCode.SERVICE_UNAVAILABLE, "平台媒体存储不可用")
        raise problem(422, ErrorCode.INVALID_VIDEO, "视频不可解码或无法无损适配")
    return result.stdout or b""


def probe(path: Path) -> dict[str, Any]:
    payload = json.loads(
        run_media(
            [
                "ffprobe",
                "-v",
                "error",
                "-count_frames",
                "-show_entries",
                "stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,nb_read_frames,time_base:format=format_name",
                "-of",
                "json",
                str(path),
            ]
        )
    )
    streams = [s for s in payload["streams"] if s["codec_type"] == "video"]
    if len(streams) != 1:
        raise problem(422, ErrorCode.INVALID_VIDEO, "需要恰好一个视频流")
    stream = streams[0]
    try:
        fps = float(Fraction(stream["avg_frame_rate"]))
        count = int(stream["nb_read_frames"])
        if (
            not math.isfinite(fps)
            or fps <= 0
            or count < 1
            or min(stream["width"], stream["height"]) < 1
        ):
            raise ValueError
    except ValueError, KeyError, ZeroDivisionError:
        raise problem(422, ErrorCode.INVALID_VIDEO, "视频帧信息无效") from None
    return {
        **stream,
        "frame_count": count,
        "fps": fps,
        "container": payload["format"]["format_name"],
    }


def frame_evidence(path: Path, destination: Path) -> tuple[str, str]:
    """Hash decoded pixels plus exact rational presentation timestamps, in order."""
    with destination.open("wb") as out:
        run_media(
            [
                "ffmpeg",
                "-v",
                "error",
                "-xerror",
                "-noautorotate",
                "-i",
                str(path),
                "-map",
                "0:v:0",
                "-fps_mode",
                "passthrough",
                "-f",
                "framehash",
                "-hash",
                "sha256",
                "-",
            ],
            out,
        )
    time_base = Fraction(0)
    digest = hashlib.sha256()
    with destination.open() as source:
        for line in source:
            if line.startswith("#tb 0:"):
                time_base = Fraction(line.split(":", 1)[1].strip())
            elif not line.startswith("#"):
                fields = [f.strip() for f in line.split(",")]
                digest.update(
                    f"{Fraction(int(fields[2])) * time_base}:{Fraction(int(fields[3])) * time_base}:{fields[4]}:{fields[5]}\n".encode()
                )
    destination.unlink()
    return digest.hexdigest(), str(time_base)


def prepare_media(original: Path, extension: str) -> dict[str, Any]:
    with original.open("rb") as source:
        header = source.read(64)
    if extension == "mp4":
        if (
            header[4:8] != b"ftyp"
            or header[8:12] == b"qt  "
            or header[8:12]
            not in {
                b"isom",
                b"iso2",
                b"iso3",
                b"iso4",
                b"iso5",
                b"iso6",
                b"mp41",
                b"mp42",
                b"avc1",
                b"dash",
                b"M4V ",
            }
        ):
            raise problem(
                415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, "实际容器不是支持的 MP4"
            )
    elif header[:4] != b"RIFF" or header[8:12] != b"AVI ":
        raise problem(415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, "实际容器不是 AVI")
    info = probe(original)
    containers = info["container"].split(",")
    if (extension == "mp4" and "mp4" not in containers) or (
        extension == "avi" and containers != ["avi"]
    ):
        raise problem(415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, "视频容器与扩展名不符")
    evidence, time_base = frame_evidence(original, original.parent / "original.frames")
    inference = original
    conversion = "original"
    if extension == "avi":
        inference = original.parent / "inference.mp4"
        conversion = "remux-verified"
        try:
            run_media(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-y",
                    "-noautorotate",
                    "-i",
                    str(original),
                    "-map",
                    "0:v:0",
                    "-c:v",
                    "copy",
                    "-fps_mode",
                    "passthrough",
                    str(inference),
                ]
            )
            if (
                frame_evidence(inference, original.parent / "derived.frames")[0]
                != evidence
            ):
                raise problem(422, ErrorCode.INVALID_VIDEO, "无损重封装验证失败")
        except HTTPException as exc:
            if exc.status_code != 422:
                raise
            conversion = "libx264-qp0-verified"
            run_media(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-y",
                    "-noautorotate",
                    "-i",
                    str(original),
                    "-map",
                    "0:v:0",
                    "-c:v",
                    "libx264",
                    "-qp",
                    "0",
                    "-pix_fmt",
                    info["pix_fmt"],
                    "-fps_mode",
                    "passthrough",
                    str(inference),
                ]
            )
        derived = probe(inference)
        if (
            any(
                derived[k] != info[k]
                for k in ("width", "height", "frame_count", "fps", "pix_fmt")
            )
            or frame_evidence(inference, original.parent / "derived.frames")[0]
            != evidence
        ):
            raise problem(
                422, ErrorCode.INVALID_VIDEO, "无法保持解码像素、帧序和时间依据"
            )
    preview = inference
    compatible = probe(inference)
    if compatible["codec_name"] != "h264" or compatible["pix_fmt"] != "yuv420p":
        preview = original.parent / "preview.mp4"
        run_media(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-noautorotate",
                "-i",
                str(original),
                "-map",
                "0:v:0",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-fps_mode",
                "passthrough",
                "-movflags",
                "+faststart",
                str(preview),
            ]
        )
    return {
        "width": info["width"],
        "height": info["height"],
        "frame_count": info["frame_count"],
        "fps": info["fps"],
        "inference_name": inference.name,
        "preview_name": preview.name,
        "inference_sha256": file_hash(inference),
        "preview_sha256": file_hash(preview),
        "conversion": conversion,
        "frame_digest": evidence,
        "time_base": time_base,
    }


def inference_input(video: UploadedVideo) -> tuple[str, str]:
    config = MediaSettings()
    source = config.PLATFORM_MEDIA_INFERENCE_SOURCE_ID
    if not config.PLATFORM_MEDIA_READONLY_READY or not source:
        raise problem(
            503, ErrorCode.SERVICE_UNAVAILABLE, "推理服务只读媒体挂载尚未就绪"
        )
    if file_hash(media_path(video.inference_storage_key)) != video.inference_sha256:
        raise problem(409, ErrorCode.STATE_CONFLICT, "推理输入内容已变化")
    directory = str(Path(video.inference_storage_key).parent)
    try:
        listing = InferenceClient().fetch_directory(source, directory)
    except (
        InferenceUnconfigured,
        InferenceUnreachable,
        InferenceUpstreamError,
        InferenceNotFound,
        InferenceArtifactTooLarge,
    ):
        raise problem(
            503, ErrorCode.SERVICE_UNAVAILABLE, "推理服务无法读取平台媒体来源"
        ) from None
    # The directory must expose the exact server-mapped input, not merely exist.
    encoded = encode_video(source, video.inference_storage_key)
    if not any(
        item.get("type") == "video" and item.get("id") == encoded
        for item in listing["items"]
        if isinstance(item, dict)
    ):
        raise problem(503, ErrorCode.SERVICE_UNAVAILABLE, "推理服务读取映射尚未核验")
    return source, video.inference_storage_key


def video_public(video: UploadedVideo, project_id: uuid.UUID) -> dict[str, Any]:
    from app.core.config import settings

    url = f"{settings.API_V1_STR}/projects/{project_id}/videos/{video.video_id}"
    return {
        k: getattr(video, k)
        for k in (
            "video_id",
            "source_id",
            "filename",
            "format",
            "bytes",
            "sha256",
            "width",
            "height",
            "frame_count",
            "fps",
            "created_at",
        )
    } | {
        "created_at": video.created_at.replace(tzinfo=UTC)
        if video.created_at.tzinfo is None
        else video.created_at,
        "project_id": project_id,
        "source_kind": "user_upload",
        "media_url": url + "/media",
        "preview_url": url + "/preview",
        "inference_ready": True,
    }
