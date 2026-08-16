# ADR-0007: Enforce Explicit Module Boundaries Incrementally

## Status
Accepted

## Context

LIRA 已经按目录拆分为模块化单体，但部分边界仍依赖大型编排对象、浏览器全局对象、直接 SQLite 句柄和高扇入工具文件。行为测试覆盖充分，因此一次性重写会放大回归风险，也不符合本地单用户应用的运维约束。

## Decision

继续使用模块化单体，并通过增量式边界收敛降低耦合：

- 组合根只装配 runtime、port 和 adapter。
- 领域服务通过窄 store/repository 接口访问持久化。
- Admin 的遗留全局对象集中到单一 bridge，新代码只使用 ESM。
- 播放器工厂只接收实际依赖，删除通用 `sharedDeps`。
- 通用工具按主题拆分，并用结构测试维护依赖方向。

每次迁移保持 HTTP、WebSocket、IPC、数据库和页面行为兼容，并由现有全量测试验证。

## Consequences

### Positive

- 模块依赖可由源码直接识别，修改影响范围更小。
- 领域服务可使用 fake store 做更快的单元测试。
- 遗留全局迁移具有明确收口点，不需要大爆炸式重写。
- 架构边界由自动化测试保护。

### Negative

- 迁移期会同时存在新接口和受控兼容适配器。
- 组合代码可能增加少量显式参数和 facade 文件。
- 旧测试中依赖源码文本或全局对象的断言需要同步更新。

### Neutral

- 运行进程、端口、数据文件、部署方式和依赖数量不变。

## Alternatives Considered

**一次性重写前端或引入框架**

- 拒绝：回归面过大，且当前 Vanilla JS 架构没有框架级需求。

**引入通用 DI 容器**

- 拒绝：现有规模使用显式工厂参数更透明；未实际解析服务的容器只增加间接层。

**保持直接数据库 context**

- 拒绝：表结构会继续泄漏到领域层，无法建立稳定持久化边界。

**拆分微服务**

- 拒绝：本地单用户应用不需要额外网络和运维边界。

## References

- `../engineering/modularity-standard.md`
- `0001-runtime-boundaries.md`
- `../backend/server-core.md`
- `../frontend/app.md`
- `../frontend/playback.md`
