'use strict';

// 仅供测试使用的再导出入口：引导步骤配置与状态服务必须来自同一个模块图
// 和同一个 vm 上下文，因为 loadModuleExports 每次调用都会新建模块注册表。
// 该再导出写法依赖仓库所有测试命令都会传入的 --experimental-vm-modules
// （vm.SourceTextModule 路径）；readJsModuleBundle 回退路径无法解析再导出绑定。
export { TOUR_CONFIG_STEPS } from '../../public/js/admin/interactive-tour-config.js';
export { stateService } from '../../public/js/admin/state.js';
