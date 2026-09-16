/**
 * Service Worker 注册脚本
 *
 * #14 修复要点（去掉无保护的强制刷新）：
 *
 * 旧实现有两处无条件的 window.location.reload()：
 *   1. 安装完成（state === "installed"）时刷新一次；
 *   2. 被接管（controllerchange）时再刷新一次。
 * 组合结果是：同一次访问可能连续刷新两次，且完全没有"只刷一次"的保护，
 * 一旦刷新后问题依旧就会变成刷新循环；更糟的是，这些刷新可能恰好发生在
 * 页面正在下载分包（JS/CSS chunk）的过程中，直接把请求打断，
 * 表现为用户点击「设置」时出现 Loading CSS chunk failed。
 *
 * 新实现：
 *   - 页面被接管或换手时，只更新标志位，绝不主动刷新页面；
 *   - 依靠 serviceWorker.js 里的 clients.claim() 让首次访问也能立刻被接管，
 *     从而保留 /api/cache 上传能力，不再需要"刷新一下才生效"；
 *   - 只有当页面确实处于 SW 控制之下才把上传走 SW 通道，否则由
 *     app/utils/chat.ts 自动回退到本地压缩方案，不会出现上传失败。
 */
(function () {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  function setSwEnabled(enabled) {
    try {
      window._SW_ENABLED = !!enabled;
    } catch (err) {
      // 忽略：极端情况下 window 不可写也不应影响页面
    }
  }

  function isControlled() {
    return !!navigator.serviceWorker.controller;
  }

  function register() {
    navigator.serviceWorker
      .register("/serviceWorker.js")
      .then(function (registration) {
        setSwEnabled(isControlled());

        var pending = registration.installing || registration.waiting;
        if (pending) {
          pending.addEventListener("statechange", function () {
            if (pending.state === "activated") {
              setSwEnabled(isControlled());
            }
          });
        }

        // 主动检查是否有新版本；失败不影响页面
        return registration.update();
      })
      .catch(function (err) {
        console.error("ServiceWorker registration failed: ", err);
        setSwEnabled(false);
      });
  }

  // 接管/换手只同步标志位。这里绝不做 location.reload()：
  // 本 Service Worker 只代理 /api/cache，接管本身不会造成页面资源版本不一致，
  // 主动刷新只会打断用户正在进行的操作（含分包加载）。
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    console.log("ServiceWorker controllerchange");
    setSwEnabled(isControlled());
  });

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", register);
  } else {
    register();
  }
})();
