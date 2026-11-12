'use strict';

// 仅供测试使用的再导出入口：礼物面板、盲盒模块、通知模块与状态服务必须来自同一个
// 模块图与同一个 vm 上下文，因为 loadModuleExports 每次调用都会新建模块注册表。
// 该再导出写法依赖仓库所有测试命令都会传入的 --experimental-vm-modules
// （vm.SourceTextModule 路径），以保留再导出绑定与模块作用域。
export { giftBlindbox } from '../../public/js/admin/gifts/blindbox.js';
export { giftNotification } from '../../public/js/admin/gifts/notification.js';
export { renderGiftPanel } from '../../public/js/admin/gifts/index.js';
export { stateService } from '../../public/js/admin/state.js';
export { eventBus } from '../../public/js/shared/event-bus.js';
export { initGiftArtworkCatalog } from '../../public/js/admin/gifts/artwork-catalog.js';
export { giftRecent } from '../../public/js/admin/gifts/recent.js';
