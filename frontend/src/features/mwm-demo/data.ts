/** Fictional, internally consistent data for the interface preview. */
export type VideoStatus = "待确认" | "分析中" | "已完成";
export type VideoRow = {
  id: string;
  group: "对照组" | "实验组";
  mouse: string;
  day: number;
  trial: number;
  status: VideoStatus;
};
export const videos: VideoRow[] = [
  {
    id: "MWM_D3_A01_T1.mp4",
    group: "对照组",
    mouse: "A01",
    day: 3,
    trial: 1,
    status: "待确认",
  },
  {
    id: "MWM_D3_A02_T1.mp4",
    group: "对照组",
    mouse: "A02",
    day: 3,
    trial: 1,
    status: "待确认",
  },
  {
    id: "MWM_D3_B01_T1.mp4",
    group: "实验组",
    mouse: "B01",
    day: 3,
    trial: 1,
    status: "分析中",
  },
  {
    id: "MWM_D2_A01_T1.mp4",
    group: "对照组",
    mouse: "A01",
    day: 2,
    trial: 1,
    status: "已完成",
  },
  {
    id: "MWM_D2_B01_T1.mp4",
    group: "实验组",
    mouse: "B01",
    day: 2,
    trial: 1,
    status: "已完成",
  },
  {
    id: "MWM_D2_B02_T1.mp4",
    group: "实验组",
    mouse: "B02",
    day: 2,
    trial: 1,
    status: "已完成",
  },
];
export const counts = { total: 120, review: 6, processing: 2, complete: 112 };
export const experiment = "水迷宫学习与记忆实验";
export const sampleTrial = "MWM_D3_A01_T1.mp4";
export const learning = [
  { day: "第 1 天", control: 48, treatment: 49 },
  { day: "第 2 天", control: 40, treatment: 45 },
  { day: "第 3 天", control: 32, treatment: 40 },
  { day: "第 4 天", control: 24, treatment: 35 },
  { day: "第 5 天", control: 18, treatment: 30 },
];
export const speed = Array.from({ length: 24 }, (_, i) => ({
  time: i * 2,
  value: 15 + Math.sin(i * 1.6) * 4 + (i % 4) * 1.2,
}));
