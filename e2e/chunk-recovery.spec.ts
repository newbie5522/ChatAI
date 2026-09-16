import { expect, test, type Page } from "@playwright/test";

/**
 * #14 端到端验收：员工账号 + 「部署切换后打开设置页」。
 *
 * 这一号问题的真实现场：
 *   1. 员工正在使用系统（浏览器里是旧版本的页面）；
 *   2. 运维把容器换成了新版本（旧版本的带哈希分包文件已经不存在）；
 *   3. 员工点击侧边栏的「设置」——旧页面去请求旧分包 → 404 → 白屏。
 *
 * 单元测试只能证明"判定逻辑正确"，证明不了"在真实构建产物里真的会这样触发"，
 * 所以这里跑真实的 standalone 产物，并在网络层精确模拟"分包已被新版本删掉"。
 *
 * 模拟方式：只让接下来第一个 `/_next/static/**` 请求返回 404。
 * 这与"旧页面请求了一个新容器里不存在的分包文件"在网络表现上完全一致。
 */

const RECOVERY_KEY = "newbiechat:chunk-recovery";
const LOAD_COUNTER_KEY = "__e2e_document_loads__";
const SETTINGS_TITLE = ".window-header-main-title";

/**
 * 侧边栏的「设置」入口。
 * 用地址而不是按钮文案来定位：文案会随界面语言变化，地址不会。
 */
const SETTINGS_ENTRY = 'a[href="#/settings"]';

/** 员工账号会话（员工角色是这一号问题明确要求覆盖的场景） */
const EMPLOYEE_SESSION = {
  authenticated: true,
  user: {
    userId: "e2e-employee-14",
    username: "e2e-employee",
    name: "E2E 员工",
    role: "employee",
    allowedModelIds: [],
    allowedCategories: [],
    quotaUnlimited: true,
  },
  models: [],
};

/** 用固定的员工会话替换真实登录接口，测试才能稳定跑在员工视角 */
async function mockEmployeeSession(page: Page) {
  await page.route("**/api/account/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPLOYEE_SESSION),
    }),
  );
}

type ChunkFault = {
  /**
   * 让接下来 N 个分包请求失败"一次"。
   * 对应真实情形：切版本的一瞬间拿到了已经不存在的旧文件，
   * 重新加载后拿到的是新文件，问题自然消失。
   */
  failOnce: number;
  /**
   * 让接下来 N 个分包请求失败，并记住这些地址，之后一直失败。
   * 对应真实情形：这个分包在新版本里确实没有了（新旧版本长期不一致）。
   */
  failForever: number;
  /** 已被判定为"新版本里不存在"的分包地址 */
  broken: Set<string>;
  /** 实际被中断的请求地址，用来证明"确实发生过分包 404" */
  served: string[];
};

/**
 * 安装"分包已不存在"的模拟开关。
 *
 * 默认两个开关都是 0，即一切正常；测试在需要的时间点再手动打开，
 * 这样"新版本上线"这个时刻才是可控的。
 *
 * 注意只打断**命中的那个分包**，不会牵连页面主包：
 * 如果连页面主包也打断，浏览器会直接白屏、页面脚本根本不执行，
 * 那就测不到错误页和自动恢复了，与真实现场也不符。
 */
async function installChunkFault(page: Page): Promise<ChunkFault> {
  const fault: ChunkFault = {
    failOnce: 0,
    failForever: 0,
    broken: new Set<string>(),
    served: [],
  };

  await page.route("**/_next/static/**", async (route) => {
    const url = route.request().url();

    const shouldFail =
      fault.failOnce > 0 ||
      fault.failForever > 0 ||
      fault.broken.has(url);

    if (!shouldFail) {
      await route.continue();
      return;
    }

    if (fault.failOnce > 0) {
      fault.failOnce -= 1;
    } else {
      if (fault.failForever > 0) {
        fault.failForever -= 1;
      }
      fault.broken.add(url);
    }

    fault.served.push(url);
    await route.fulfill({
      status: 404,
      contentType: "text/plain",
      body: "Not Found",
    });
  });

  return fault;
}

/** 统计"文档加载次数"：正常打开是 1；自动刷新一次就是 2 */
async function installLoadCounter(page: Page) {
  await page.addInitScript((key) => {
    const next = Number(sessionStorage.getItem(key) ?? "0") + 1;
    sessionStorage.setItem(key, String(next));
  }, LOAD_COUNTER_KEY);
}

/**
 * 固定界面语言为中文。
 * 应用默认跟随浏览器语言，测试环境不固定的话文案会变成英文，
 * 断言就会和线上真实看到的界面不一致。
 */
async function seedChineseLocale(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("lang", "cn");
    } catch {
      // 存储不可写时忽略；配置里的 locale 已经保证浏览器语言是 zh-CN
    }
  });
}

async function readLoadCount(page: Page): Promise<number> {
  const value = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    LOAD_COUNTER_KEY,
  );
  return Number(value ?? "0");
}

async function readRecoveryRecord(page: Page) {
  const raw = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    RECOVERY_KEY,
  );
  return raw
    ? (JSON.parse(raw) as { lastAttemptAt: number; totalAttempts: number })
    : null;
}

/**
 * 等页面进入可交互状态（侧边栏出现）。
 * 会话接口是本地替换的，但仍然有异步时序，所以显式等待而不是 sleep。
 */
async function waitForAppReady(page: Page) {
  await page.locator(SETTINGS_ENTRY).first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

/**
 * 点击设置入口。
 *
 * 分包缺失时页面会自动重新加载，这回销毁点击动作所在的执行上下文，
 * Playwright 会抛出 "Execution context was destroyed"。
 * 那是这一号问题**预期内**的行为，不算测试失败，因此这里放行；
 * 其他异常照常抛出。
 */
async function clickSettings(page: Page) {
  try {
    await page.locator(SETTINGS_ENTRY).first().click({ timeout: 15_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/context was destroyed|Target (page|closed)|navigat/i.test(message)) {
      throw error;
    }
  }
}

/** 每个用例统一的起始状态：中文界面 + 员工会话 + 加载次数统计 + 分包故障开关 */
async function startAsEmployee(page: Page) {
  await seedChineseLocale(page);
  await installLoadCounter(page);
  await mockEmployeeSession(page);
  return installChunkFault(page);
}

test.describe("#14 设置页分包崩溃与全局恢复", () => {
  test("员工账号打开设置页可以正常渲染", async ({ page }) => {
    await startAsEmployee(page);

    await page.goto("/");
    await waitForAppReady(page);

    await clickSettings(page);

    await expect(page.locator(SETTINGS_TITLE)).toHaveText("设置");
    await expect(page.getByText("账号：e2e-employee")).toBeVisible();

    // 正常路径下不应该出现任何错误页，也不应该发生自动刷新
    await expect(page.getByText("页面加载失败")).toHaveCount(0);
    await expect(page.getByText("这一步没能完成")).toHaveCount(0);
    expect(await readLoadCount(page)).toBe(1);
    expect(await readRecoveryRecord(page)).toBeNull();
  });

  test("部署切换后打开设置：自动恢复一次即可正常打开，刷新不超过一次", async ({
    page,
  }) => {
    const fault = await startAsEmployee(page);

    await page.goto("/");
    await waitForAppReady(page);
    expect(await readLoadCount(page)).toBe(1);

    // ↓ 时间点：服务器换成了新版本，旧页面手里的分包地址已经不存在
    fault.failOnce = 1;

    await clickSettings(page);

    // 恢复后应该直接落回设置页（地址里还留着 #/settings），并且内容正常
    await expect(page.locator(SETTINGS_TITLE)).toHaveText("设置", {
      timeout: 45_000,
    });
    await expect(page.getByText("账号：e2e-employee")).toBeVisible();

    // 确实发生过一次分包 404 —— 否则这个用例说明不了任何问题
    expect(fault.served.length).toBe(1);
    expect(fault.served[0]).toContain("/_next/static/");

    // 只自动刷新了一次
    expect(await readLoadCount(page)).toBe(2);

    const record = await readRecoveryRecord(page);
    expect(record?.totalAttempts).toBe(1);

    // 恢复之后不应再有错误页残留
    await expect(page.getByText("页面加载失败")).toHaveCount(0);
  });

  test("分包持续缺失时不会无限刷新，改为展示中文可操作错误页", async ({
    page,
  }) => {
    const fault = await startAsEmployee(page);

    await page.goto("/");
    await waitForAppReady(page);

    // ↓ 时间点：这个分包一直拿不到（模拟新旧版本长期不一致）
    fault.failForever = 1;

    await clickSettings(page);

    // 自动刷新一次后仍然失败，此时冷却窗口生效，必须停在错误页上
    await expect(page.getByText("页面加载失败")).toBeVisible({
      timeout: 45_000,
    });
    await expect(
      page.getByText("刚刚已经自动重新加载过一次"),
    ).toBeVisible();

    const loadsWhenErrored = await readLoadCount(page);
    expect(loadsWhenErrored).toBe(2);

    // 被判定失效的始终只有那一个分包；页面主包必须正常，否则就是白屏而不是错误页
    expect(fault.broken.size).toBe(1);
    // 第一次点击失败 1 次、刷新后又失败 1 次
    expect(fault.served.length).toBeGreaterThanOrEqual(2);

    // 再等一段时间，确认没有继续刷新（这是本用例的核心断言）
    await page.waitForTimeout(6_000);
    expect(await readLoadCount(page)).toBe(2);
    await expect(page.getByText("页面加载失败")).toBeVisible();

    // 错误页里不能出现会破坏用户数据的「清空全部数据」
    await expect(page.getByText("清空全部数据")).toHaveCount(0);
  });

  test("不存在的地址展示中文提示页，且没有破坏性操作", async ({ page }) => {
    await seedChineseLocale(page);
    await mockEmployeeSession(page);
    await installLoadCounter(page);

    await page.goto("/e2e-nonexistent-path-14");

    await expect(page.getByText("页面不存在")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "回到聊天" })).toBeVisible();
    await expect(page.getByText("清空全部数据")).toHaveCount(0);
  });
});
