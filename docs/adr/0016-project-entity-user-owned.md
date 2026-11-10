---
status: accepted
---

# Project 实体归属：用户所有、平台库存储、成员仅存引用

2026-11-10（#42）：「项目（Project）」从浏览器 localStorage 文件夹升格为登录用户所有的真实平台实体（GLOSSARY 词条已冻结）。归属与存储拆开定义：

- **归属**：项目属于单个登录用户（`project.user_id` 外键到 `user`，级联删除）。同一账号换设备登录看到同一份项目；用户删除即项目删除。
- **存储**：项目与成员关系存平台应用库（`project`、`project_member` 两表），经平台 API 读写，唯一所有者凭证在平台后端。
- **成员是引用不是所有权**：`project_member` 的 `(member_kind, member_id)` 指向 Agent 任务或推理视频时**不建外键**——这些行属于 lingsight-agent / lingsight-inference（ADR-0012 不变）。平台只拥有"归组"这一层关系，把任务或视频从项目移出不影响上游本体，上游删除也不自动清理引用（读取端按引用失配处理）。

替代方案与代价：

- 继续用浏览器 localStorage：换设备不可见，Agent 无法按项目消费数据，父工单 #40 已否决。
- 把成员复制进平台库（复制任务状态/视频元数据）：引入双写一致性，且违反"Agent/推理的任务所有权不变"；仅存引用 + 名称快照（`label` 列）是最小充分集。
- 由 Agent 服务拥有 Project：项目是登录用户的研究组织单元，属于平台身份域；Agent 经 DBHub 只读消费即可，不需要写权限。

约束与边界：

- 项目名按用户唯一（MySQL 默认排序规则下大小写不敏感），重名创建/改名返回 409。
- localStorage 旧分组经 `POST /api/v1/projects/import` 一次性迁移：重放幂等，同名项目整体跳过、不覆盖用户在服务端已做的整理（含手工移出的成员）。迁移按浏览器打标记，避免已删除的项目被旧缓存复活。
- 首期个人使用，不做成员级共享/多租户授权；`ensure_workspace_user` 网关门（agent/inference 转发）与 Project API 的按用户隔离互不替代。
