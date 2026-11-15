import { expect, test } from "@playwright/test"
import {
  formatBytes,
  MAX_UPLOAD_BYTES,
  uploadPrecheck,
} from "../src/features/agent/uploadRules"
import {
  clampPool,
  clientToImage,
  type Draft,
  draftFromCandidate,
  nextMarkLabel,
  polygonSelfIntersects,
  validateDraft,
  validateMark,
} from "../src/features/inference/preannotationGeometry"

const frame = { width: 1000, height: 800, frame_count: 300 }
const square: [number, number][] = [
  [100, 100],
  [200, 100],
  [200, 200],
  [100, 200],
]
const good: Draft = {
  seed: { frame: 7, x: 500, y: 400 },
  pool: { cx: 500, cy: 400, radius: 300 },
  marks: [{ label: "A", polygon: square }],
}

test.describe("预标注几何（原视频像素）", () => {
  test("CSS 坐标按显示比例换算成原像素，并留在最后一个像素之内", () => {
    // 画布显示为 500x400（缩放 0.5），左上角在 (10, 20)。
    const box = { left: 10, top: 20, width: 500, height: 400 }
    expect(clientToImage(260, 220, box, frame)).toEqual([500, 400])
    expect(clientToImage(10, 20, box, frame)).toEqual([0, 0])
    const [x, y] = clientToImage(9999, 9999, box, frame)
    expect(x).toBeLessThan(frame.width)
    expect(y).toBeLessThan(frame.height)
    expect(clientToImage(-50, -50, box, frame)).toEqual([0, 0])
  })

  test("候选缺失字段时给出可编辑草稿，且不假定帧号为 0", () => {
    const draft = draftFromCandidate(
      {
        frame_index: 12,
        seed: null,
        pool: null,
        marks: [
          { label: "有轮廓", polygon: square },
          { label: "缺轮廓", polygon: null },
          { label: "太少", polygon: [[1, 1]] },
        ],
      },
      frame,
    )
    expect(draft.seed.frame).toBe(12)
    expect(draft.marks.map((mark) => mark.label)).toEqual(["有轮廓"])
    expect(validateDraft(draft, frame)).toEqual([])
    // 草稿是拷贝，改动不回写候选。
    expect(draft.marks[0].polygon).not.toBe(square)
  })

  test("合法草稿通过，空标志物列表也合法", () => {
    expect(validateDraft(good, frame)).toEqual([])
    expect(validateDraft({ ...good, marks: [] }, frame)).toEqual([])
  })

  test("越界、非有限数、起点在池外、起始帧非法都被拒绝", () => {
    expect(
      validateDraft({ ...good, seed: { ...good.seed, x: 1000 } }, frame),
    ).toContain("小鼠起点落在画面外")
    expect(
      validateDraft({ ...good, seed: { ...good.seed, x: Number.NaN } }, frame),
    ).toEqual(["存在无效数值"])
    expect(
      validateDraft({ ...good, seed: { frame: 7, x: 10, y: 10 } }, frame),
    ).toContain("小鼠起点需在水池内")
    expect(
      validateDraft({ ...good, seed: { ...good.seed, frame: 300 } }, frame),
    ).toContain("起始帧需为 0 到 299 的整数")
    expect(
      validateDraft({ ...good, seed: { ...good.seed, frame: 1.5 } }, frame),
    ).toContain("起始帧需为 0 到 299 的整数")
    expect(
      validateDraft(
        { ...good, pool: { cx: 500, cy: 400, radius: 450 } },
        frame,
      ),
    ).toContain("水池圆需完整落在画面内")
    expect(
      validateDraft({ ...good, pool: { cx: 500, cy: 400, radius: 0 } }, frame),
    ).toContain("水池圆需完整落在画面内")
  })

  test("多边形：少于 3 点、重复点、零面积、自相交、出界、重名、空名都被拒绝", () => {
    const mark = (polygon: [number, number][], label = "A") => ({
      label,
      polygon,
    })
    expect(validateMark(mark(square.slice(0, 2)), frame)).toContain("至少")
    expect(validateMark(mark([...square, [100, 100]]), frame)).toContain("重复")
    expect(
      validateMark(
        mark([
          [0, 0],
          [10, 10],
          [20, 20],
        ]),
        frame,
      ),
    ).toContain("面积为 0")
    // 非对称的蝴蝶结：有符号面积不为 0，只有自相交这一个问题。
    const bowtie: [number, number][] = [
      [100, 100],
      [300, 300],
      [300, 100],
      [100, 250],
    ]
    expect(polygonSelfIntersects(bowtie)).toBe(true)
    expect(polygonSelfIntersects(square)).toBe(false)
    expect(validateMark(mark(bowtie), frame)).toContain("自相交")
    expect(
      validateMark(
        mark([
          [100, 100],
          [1000, 100],
          [100, 200],
        ]),
        frame,
      ),
    ).toContain("画面外")
    expect(validateMark(mark(square, "  "), frame)).toContain("不能为空")
    expect(
      validateDraft(
        {
          ...good,
          marks: [mark(square, "X"), mark(square, "X")],
        },
        frame,
      ),
    ).toContain("标志物名称重复：X")
  })

  test("水池拖动被夹在画面内，新标志物取未占用名称", () => {
    const pool = clampPool({ cx: -50, cy: 5000, radius: 100 }, frame)
    expect(pool.cx - pool.radius).toBeGreaterThanOrEqual(0)
    expect(pool.cy + pool.radius).toBeLessThan(frame.height)
    expect(nextMarkLabel([{ label: "标志物 1", polygon: square }])).toBe(
      "标志物 2",
    )
    expect(nextMarkLabel([{ label: "标志物 2", polygon: square }])).toBe(
      "标志物 3",
    )
  })
})

test.describe("上传客户端预检", () => {
  test("扩展名、空文件与 2GB 上限（以服务器错误码为准）", () => {
    expect(uploadPrecheck({ name: "a.MP4", size: 10 })).toBeNull()
    expect(uploadPrecheck({ name: "a.avi", size: MAX_UPLOAD_BYTES })).toBeNull()
    expect(
      uploadPrecheck({ name: "a.avi", size: MAX_UPLOAD_BYTES + 1 }),
    ).toContain("2 GB")
    expect(uploadPrecheck({ name: "a.mov", size: 10 })).toContain("mp4 或 avi")
    expect(uploadPrecheck({ name: "noext", size: 10 })).toContain("mp4 或 avi")
    expect(uploadPrecheck({ name: "a.mp4", size: 0 })).toContain("为空")
    expect(formatBytes(1_500_000_000)).toBe("1.50 GB")
  })
})
