"""Authenticated streaming uploads and range media; no client filesystem paths."""

import fcntl
import hashlib
import os
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query, Request, Response
from python_multipart import MultipartParser
from python_multipart.exceptions import MultipartParseError
from python_multipart.multipart import parse_options_header
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import col, select
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect
from starlette.responses import FileResponse

from app import crud
from app.api.deps import CurrentUser, MediaUserDep, SessionDep, owned_project
from app.media_settings import MAX_VIDEO_BYTES
from app.models import ProjectMember
from app.upload_models import UploadedVideo, UploadReceipt
from app.uploads import (
    cleanup_abandoned,
    lock_owner,
    media_path,
    media_root,
    owned_video,
    prepare_media,
    problem,
    storage_lock,
    video_public,
)

router = APIRouter(prefix="/projects/{project_id}/videos", tags=["videos"])


class MultipartVideo:
    """Incremental multipart consumer with one bounded file and bounded headers."""

    def __init__(self, content_type: str, destination: Path):
        media_type, options = parse_options_header(content_type)
        boundary = options.get(b"boundary")
        if media_type != b"multipart/form-data" or not boundary or len(boundary) > 200:
            raise problem(422, "invalid_input", "需要 multipart/form-data 视频文件")
        self.file = destination.open("xb")
        self.filename = ""
        self.extension = ""
        self.size = 0
        self.digest = hashlib.sha256()
        self.headers: dict[bytes, bytes] = {}
        self.field = bytearray()
        self.value = bytearray()
        self.parts = 0
        self.header_size = 0
        self.complete = False
        self.parser = MultipartParser(
            boundary,
            {
                "on_part_begin": self.part_begin,
                "on_header_field": self.header_field,
                "on_header_value": self.header_value,
                "on_header_end": self.header_end,
                "on_headers_finished": self.headers_finished,
                "on_part_data": self.data,
                "on_end": self.end,
            },
        )

    def part_begin(self) -> None:
        self.parts += 1
        if self.parts != 1:
            raise problem(422, "invalid_input", "必须恰好上传一个 file，不接受额外字段")

    def header_field(self, data: bytes, start: int, end: int) -> None:
        self.header_size += end - start
        if self.header_size > 8192:
            raise problem(413, "payload_too_large", "上传头过大")
        self.field.extend(data[start:end])

    def header_value(self, data: bytes, start: int, end: int) -> None:
        self.header_size += end - start
        if self.header_size > 8192:
            raise problem(413, "payload_too_large", "上传头过大")
        self.value.extend(data[start:end])

    def header_end(self) -> None:
        name = bytes(self.field).lower()
        if name in self.headers:
            raise problem(422, "invalid_input", "重复上传头")
        self.headers[name] = bytes(self.value)
        self.field.clear()
        self.value.clear()

    def headers_finished(self) -> None:
        disposition, options = parse_options_header(
            self.headers.get(b"content-disposition", b"")
        )
        raw = options.get(b"filename", b"")
        try:
            self.filename = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise problem(422, "invalid_input", "文件名必须为 UTF-8") from None
        if (
            disposition != b"form-data"
            or options.get(b"name") != b"file"
            or not self.filename
            or len(self.filename) > 255
            or any(c in self.filename for c in ("/", "\\"))
            or any(ord(c) < 32 for c in self.filename)
        ):
            raise problem(422, "invalid_input", "无效的文件字段或文件名")
        self.extension = Path(self.filename).suffix.lower().lstrip(".")
        mime = (
            self.headers.get(b"content-type", b"application/octet-stream")
            .split(b";", 1)[0]
            .lower()
        )
        allowed = {
            "mp4": {b"video/mp4", b"application/octet-stream"},
            "avi": {
                b"video/avi",
                b"video/x-msvideo",
                b"video/msvideo",
                b"application/octet-stream",
            },
        }
        if self.extension not in allowed or mime not in allowed[self.extension]:
            raise problem(415, "unsupported_media_type", "仅支持 mp4 或 avi 视频")

    def data(self, data: bytes, start: int, end: int) -> None:
        self.size += end - start
        if self.size > MAX_VIDEO_BYTES:
            raise problem(413, "file_too_large", "视频不得超过 2,000,000,000 bytes")
        chunk = memoryview(data)[start:end]
        self.file.write(chunk)
        self.digest.update(chunk)

    def end(self) -> None:
        self.complete = True


@router.post("")
async def upload_video(
    request: Request,
    session: SessionDep,
    current_user: CurrentUser,
    project_id: uuid.UUID,
    response: Response,
) -> dict[str, Any]:
    # Request.stream is first touched after project/auth/idempotency validation.
    owned_project(session, current_user, project_id)
    try:
        key = str(uuid.UUID(request.headers.get("idempotency-key", "")))
    except ValueError:
        raise problem(422, "invalid_input", "需要 UUID Idempotency-Key") from None
    root = media_root()
    stage: Path | None = None
    consumer: MultipartVideo | None = None
    lock_fd: int | None = None
    published = False
    try:
        with storage_lock(root):
            cleanup_abandoned(session, root)
            stage = root / "staging" / uuid.uuid4().hex
            stage.mkdir(mode=0o700)
            lock_fd = os.open(
                stage / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600
            )
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
        consumer = MultipartVideo(
            request.headers.get("content-type", ""), stage / "incoming"
        )
        request_bytes = 0
        async for chunk in request.stream():
            request_bytes += len(chunk)
            if request_bytes > MAX_VIDEO_BYTES + 65536:
                raise problem(413, "payload_too_large", "上传请求过大")
            await run_in_threadpool(consumer.parser.write, chunk)
        consumer.parser.finalize()
        consumer.file.flush()
        os.fsync(consumer.file.fileno())
        consumer.file.close()
        if not consumer.complete or consumer.parts != 1 or not consumer.size:
            raise problem(422, "invalid_video", "视频为空或传输不完整")
        digest = consumer.digest.hexdigest()
        # Replays do not need a second media decode. Lock protects first insert.
        await run_in_threadpool(lock_owner, session, current_user)
        owned_project(session, current_user, project_id)
        receipt = session.exec(
            select(UploadReceipt).where(
                UploadReceipt.owner_user_id == current_user.id,
                UploadReceipt.project_id == project_id,
                UploadReceipt.idempotency_key == key,
            )
        ).first()
        if receipt:
            video = owned_video(session, current_user, project_id, receipt.video_id)
            if video.sha256 != digest:
                raise problem(409, "idempotency_conflict", "相同幂等键的视频内容不同")
            response.status_code = 200
            return video_public(video, project_id)
        original = stage / f"original.{consumer.extension}"
        (stage / "incoming").rename(original)
        prepared = await run_in_threadpool(prepare_media, original, consumer.extension)
        object_id = stage.name
        prefix = f"objects/{object_id}"
        video = UploadedVideo(
            video_id="upl_" + uuid.uuid4().hex,
            owner_user_id=current_user.id,
            source_id="upload-" + current_user.id.hex,
            filename=consumer.filename,
            format=consumer.extension,
            bytes=consumer.size,
            sha256=digest,
            storage_key=f"{prefix}/{original.name}",
            inference_storage_key=f"{prefix}/{prepared.pop('inference_name')}",
            preview_storage_key=f"{prefix}/{prepared.pop('preview_name')}",
            **prepared,
        )
        with storage_lock(root):
            final = root / prefix
            stage.rename(final)
            stage = final
            # Ensure file contents and atomic directory rename survive a crash.
            for path in final.iterdir():
                with path.open("rb") as file:
                    os.fsync(file.fileno())
            parent_fd = os.open(final.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
            session.add(video)
            session.flush()
            session.add(
                ProjectMember(
                    project_id=project_id,
                    member_kind="video",
                    member_id=video.video_id,
                    member_key=crud.project_member_key(video.video_id),
                    label=video.filename,
                )
            )
            session.add(
                UploadReceipt(
                    owner_user_id=current_user.id,
                    project_id=project_id,
                    idempotency_key=key,
                    video_id=video.video_id,
                )
            )
            session.commit()
            published = True
        response.status_code = 201
        return video_public(video, project_id)
    except ClientDisconnect:
        raise problem(422, "invalid_video", "视频传输中断，请完整重传") from None
    except MultipartParseError:
        raise problem(422, "invalid_input", "无效的 multipart 上传") from None
    except OSError, SQLAlchemyError:
        session.rollback()
        raise problem(503, "service_unavailable", "平台媒体存储暂时不可用") from None
    finally:
        if consumer:
            consumer.file.close()
        if stage and not published:
            shutil.rmtree(stage, ignore_errors=True)
        if lock_fd is not None:
            os.close(lock_fd)


@router.get("")
def list_videos(
    session: SessionDep,
    current_user: CurrentUser,
    project_id: uuid.UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    owned_project(session, current_user, project_id)
    videos = session.exec(
        select(UploadedVideo)
        .join(ProjectMember, col(ProjectMember.member_id) == UploadedVideo.video_id)
        .where(
            ProjectMember.project_id == project_id,
            ProjectMember.member_kind == "video",
            UploadedVideo.owner_user_id == current_user.id,
        )
        .order_by(col(UploadedVideo.created_at), col(UploadedVideo.video_id))
    ).all()
    return {
        "data": [video_public(v, project_id) for v in videos[offset : offset + limit]],
        "count": len(videos),
        "offset": offset,
        "limit": limit,
    }


@router.get("/{video_id}")
def get_video(
    session: SessionDep, current_user: CurrentUser, project_id: uuid.UUID, video_id: str
) -> dict[str, Any]:
    return video_public(
        owned_video(session, current_user, project_id, video_id), project_id
    )


@router.get("/{video_id}/media")
def original_media(
    session: SessionDep,
    current_user: MediaUserDep,
    project_id: uuid.UUID,
    video_id: str,
) -> FileResponse:
    video = owned_video(session, current_user, project_id, video_id)
    return FileResponse(
        media_path(video.storage_key),
        media_type="video/mp4" if video.format == "mp4" else "video/x-msvideo",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/{video_id}/preview")
def preview_media(
    session: SessionDep,
    current_user: MediaUserDep,
    project_id: uuid.UUID,
    video_id: str,
) -> FileResponse:
    video = owned_video(session, current_user, project_id, video_id)
    return FileResponse(
        media_path(video.preview_storage_key),
        media_type="video/mp4",
        headers={"Cache-Control": "private, no-store"},
    )
