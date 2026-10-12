---
status: accepted
---

# 脚手架采用 FastAPI 官方 full-stack-fastapi-template，替换青戈 ZIP 方案

原计划使用青戈 Vue+FastAPI 脚手架 ZIP，但 ZIP 一直未获取、许可证无法预审，M0 被卡住。2026-10-12 决定改用 FastAPI 官方 [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template)（MIT 许可）：前端 React + TypeScript + Vite + Tailwind/shadcn，后端 SQLModel + Alembic，自带 JWT 用户体系、admin 后台、Docker Compose、CI、Pytest 与 Playwright。

## Considered Options

- **青戈 Vue ZIP**：与既有课程资料同栈（Vue），但来源与许可证不可预审，且获取时间不可控。
- **从零自建**：无第三方风险，但认证、CI、E2E 等通用设施全部重复实现，挤占核心链路时间。

## Consequences

- 模板默认 **PostgreSQL**，需适配 MySQL：docker-compose 服务替换、`asyncmy` 驱动、`mysql+asyncmy://` 连接串、Alembic 环境微调、UUID 列按 MySQL 方言调整（CHAR(36)）。实验数据仍以本机 MySQL `water_maze` 为权威，模板适配数据源而非相反。（2026-10-12 导入实测：模板为全同步数据层，驱动改用同步 `pymysql`，详见 ADR-0005。）
- 前端由 Vue 改为 **React**（用户已确认接受），README/01-product-spec/02-source-audit 同步更新。
- 模板自带 JWT 用户体系，是 Text-to-SQL「输入含用户身份」与后续实验 ACL 的落点。
